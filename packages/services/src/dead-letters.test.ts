import { InboundEvent } from "@vela/contracts";
import { encodeButton } from "@vela/core";
import {
  accountLinkChallenges,
  deadLetters,
  families,
  members,
  nearbyContacts,
  users,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteFamily } from "./admin.ts";
import { disableApiAccount } from "./api-account-writes.ts";
import {
  claimDeadLetterReplays,
  keepDeadLetter,
  loadDeadLetters,
  releaseDeadLetterReplay,
  requestDeadLetterReplay,
} from "./dead-letters.ts";
import { sha256Hex } from "./hash.ts";
import { insertInvite } from "./invites.ts";
import { applyRetention } from "./jobs.ts";
import { deleteContact } from "./nearby-consent.ts";
import { opsAlerts } from "./ops.ts";
import { forgetMembersWithTheirContacts } from "./proofs.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily, seedLinkedGroup } from "./testing/seed.ts";

let h: Harness;
let seeded: Awaited<ReturnType<typeof seedFamily>>;
const DAY = 24 * 60 * 60 * 1000;
let INBOUND: { type: string; events: InboundEvent[] };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  const family = await seedFamily(h.db, { now: h.clock.now() });
  seeded = family;
  INBOUND = {
    type: "handle_inbound",
    events: [
      InboundEvent.parse({
        channel: "telegram",
        kind: "text",
        eventId: "synthetic-failed-answer",
        at: h.clock.now().toISOString(),
        sender: { externalUserId: family.memberLink.externalId },
        conversation: { externalId: family.memberLink.externalId, kind: "private" },
        text: "我跌倒了",
      }),
    ],
  };
});
afterAll(async () => {
  await h.close();
});

async function keep(messageId = "m-1") {
  return keepDeadLetter(h.deps, { messageId, jobType: "handle_inbound", job: INBOUND });
}

describe("dead letters", () => {
  it("erases one family's events from a mixed recovery batch, and refuses late deliveries", async () => {
    const [family] = await h.db.select().from(families);
    if (family === undefined) throw new Error("missing family");
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "501",
      memberExternalId: "502",
    });
    const event = InboundEvent.parse({
      ...INBOUND.events[0],
      eventId: "other-family",
      sender: { externalUserId: other.memberLink.externalId },
      conversation: { kind: "private", externalId: other.memberLink.externalId },
      text: "Other synthetic family's words",
    });
    await keepDeadLetter(h.deps, {
      messageId: "mixed",
      jobType: "handle_inbound",
      job: { ...INBOUND, events: [...INBOUND.events, event] },
    });
    await deleteFamily(h.deps, { admin: "synthetic-founder" }, family.id);
    const [remaining] = await h.db.select().from(deadLetters);
    expect(remaining?.job.events).toEqual([event]);
    expect(await keep("late-erased-family")).toBe(false);
    if (remaining === undefined) throw new Error("missing other-family recovery");
    await requestDeadLetterReplay(h.deps, remaining.id);
    expect((await claimDeadLetterReplays(h.deps))[0]?.job.events).toEqual([event]);
  });

  it("erases a deleted group's words even when the sender belongs to another live family", async () => {
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "601",
      memberExternalId: "602",
    });
    const group = await seedLinkedGroup(h.db, other, { now: h.clock.now() });
    const event = InboundEvent.parse({
      ...INBOUND.events[0],
      conversation: { kind: "group", externalId: group.conversationId },
    });
    await keepDeadLetter(h.deps, {
      messageId: "group",
      jobType: "handle_inbound",
      job: { type: "handle_inbound", events: [event] },
    });
    expect(await h.db.select().from(deadLetters)).toHaveLength(1);
    await deleteFamily(h.deps, { admin: "synthetic-founder" }, other.family.id);
    expect(await h.db.select().from(deadLetters)).toEqual([]);
    expect(await keep("still-live-private-member")).toBe(true);
  });

  it("erases an app-link recovery copy even while its messenger sender remains in the family", async () => {
    const [user] = await h.db
      .insert(users)
      .values({ authSubject: "synthetic|linking-account", displayName: "Synthetic account" })
      .returning();
    if (user === undefined) throw new Error("missing account");
    const [challenge] = await h.db
      .insert(accountLinkChallenges)
      .values({
        userId: user.id,
        sessionHash: "a".repeat(64),
        createdAt: h.clock.now(),
        expiresAt: new Date(h.clock.now().getTime() + 900_000),
      })
      .returning();
    if (challenge === undefined) throw new Error("missing challenge");
    const event = InboundEvent.parse({
      ...INBOUND.events[0],
      kind: "start",
      startParam: `link_${challenge.id}`,
    });
    expect(
      await keepDeadLetter(h.deps, {
        messageId: "linking",
        jobType: "handle_inbound",
        job: { type: "handle_inbound", events: [event] },
      }),
    ).toBe(true);
    await disableApiAccount(h.deps, "synthetic|linking-account");
    expect(await h.db.select().from(deadLetters)).toEqual([]);
    expect(
      await keepDeadLetter(h.deps, {
        messageId: "late-linking",
        jobType: "handle_inbound",
        job: { type: "handle_inbound", events: [event] },
      }),
    ).toBe(false);
    expect(await keep("ordinary-member-message")).toBe(true);
  });

  it("discards malformed challenge ids without failing the recovery consumer", async () => {
    const event = InboundEvent.parse({
      ...INBOUND.events[0],
      kind: "start",
      startParam: `link_${"-".repeat(36)}`,
    });
    expect(
      await keepDeadLetter(h.deps, {
        messageId: "bad-link",
        jobType: "handle_inbound",
        job: { type: "handle_inbound", events: [event] },
      }),
    ).toBe(false);
  });

  it("recovers a live sealed invitation through its hash, and erases it with the family", async () => {
    const made = await h.db.transaction((tx) =>
      insertInvite(
        h.deps,
        tx,
        {
          familyId: seeded.family.id,
          invitedBy: seeded.organiser.id,
          forMemberId: seeded.member.id,
        },
        h.clock.now(),
      ),
    );
    const event = InboundEvent.parse({
      ...INBOUND.events[0],
      kind: "start",
      startParam: made.invite.token,
      sender: { externalUserId: "777" },
      conversation: { kind: "private", externalId: "777" },
    });
    const job = { type: "handle_inbound", events: [event] };
    expect(
      await keepDeadLetter(h.deps, { messageId: "sealed-invite", jobType: "handle_inbound", job }),
    ).toBe(true);
    await deleteFamily(h.deps, { admin: "synthetic-founder" }, seeded.family.id);
    expect(await h.db.select().from(deadLetters)).toEqual([]);
    expect(
      await keepDeadLetter(h.deps, {
        messageId: "late-sealed-invite",
        jobType: "handle_inbound",
        job,
      }),
    ).toBe(false);
  });

  it.each(["button", "start"] as const)(
    "does not rescue an erased nearby %s through the sender's other family",
    async (kind) => {
      const other = await seedFamily(h.db, {
        now: h.clock.now(),
        organiserExternalId: "801",
        memberExternalId: "802",
      });
      const token = `n${"a".repeat(32)}`;
      const [contact] = await h.db
        .insert(nearbyContacts)
        .values({
          familyId: seeded.family.id,
          memberId: seeded.member.id,
          name: "Synthetic nearby contact",
          channel: "telegram",
          createdAt: h.clock.now(),
          ...(kind === "start"
            ? { inviteTokenHash: await sha256Hex(token) }
            : { externalId: other.memberLink.externalId, consentedAt: h.clock.now() }),
        })
        .returning();
      if (contact === undefined) throw new Error("missing contact");
      const event = InboundEvent.parse({
        ...INBOUND.events[0],
        kind,
        sender: { externalUserId: other.memberLink.externalId },
        conversation: { kind: "private", externalId: other.memberLink.externalId },
        ...(kind === "start"
          ? { startParam: token }
          : {
              buttonData: encodeButton({
                type: "nearby_consent",
                contactId: contact.id,
                accept: false,
              }),
            }),
      });
      const job = { type: "handle_inbound", events: [event] };
      expect(
        await keepDeadLetter(h.deps, { messageId: "nearby-role", jobType: "handle_inbound", job }),
      ).toBe(true);
      await h.db.transaction((tx) =>
        deleteContact(tx, contact, "synthetic contact withdrawal", h.clock.now()),
      );
      expect(await h.db.select().from(deadLetters)).toEqual([]);
      expect(
        await keepDeadLetter(h.deps, {
          messageId: "late-nearby-role",
          jobType: "handle_inbound",
          job,
        }),
      ).toBe(false);
      const ordinary = { ...event, kind: "text", startParam: undefined, buttonData: undefined };
      expect(
        await keepDeadLetter(h.deps, {
          messageId: "other-family-role",
          jobType: "handle_inbound",
          job: { type: "handle_inbound", events: [ordinary] },
        }),
      ).toBe(true);
    },
  );

  it("erases a member's recovery copy with their consent proofs", async () => {
    await keep();
    const [member] = await h.db.select().from(members).where(eq(members.role, "member"));
    if (member === undefined) throw new Error("missing member");
    await h.db.transaction(async (tx) => {
      await forgetMembersWithTheirContacts(tx, [member.id], h.clock.now());
      await tx.delete(members).where(eq(members.id, member.id));
    });
    expect(await h.db.select().from(deadLetters)).toEqual([]);
    expect(await keep("late-deleted-member")).toBe(false);
  });

  it("does not replay an older Worker's orphaned recovery copy", async () => {
    await h.db.insert(deadLetters).values({
      messageId: "legacy",
      jobType: "handle_inbound",
      job: {
        ...INBOUND,
        events: [{ ...INBOUND.events[0], sender: { externalUserId: "unknown-deleted-sender" } }],
      },
      failedAt: h.clock.now(),
      replayRequestedAt: h.clock.now(),
    });
    expect(await claimDeadLetterReplays(h.deps)).toEqual([]);
    expect(await h.db.select().from(deadLetters)).toEqual([]);
  });

  it("does not renew the lifetime of her words through repeated queue recovery", async () => {
    h.clock.advance(31 * DAY);
    expect(await keep("too-old-to-recover")).toBe(false);
  });

  it("keeps a dead job once, however often the queue delivers it", async () => {
    expect(await keep()).toBe(true);
    expect(await keep()).toBe(false);
    const rows = await loadDeadLetters(h.deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobType: "handle_inbound", replayRequestedAt: null });
    // The overview's rows carry no content.
    expect(JSON.stringify(rows)).not.toContain("跌倒");
  });

  it("seals the job: its words are not readable in the column", async () => {
    await keep();
    const raw = await h.db.execute<{ job: unknown }>("select job::text as job from dead_letters");
    expect(JSON.stringify(raw)).not.toContain("跌倒");
  });

  it("replays a requested job once, and gives it back when the send fails", async () => {
    await keep();
    const [row] = await loadDeadLetters(h.deps);
    if (row === undefined) throw new Error("expected a row");
    expect(await claimDeadLetterReplays(h.deps)).toEqual([]);

    expect(await requestDeadLetterReplay(h.deps, row.id)).toBe("requested");
    expect(await requestDeadLetterReplay(h.deps, row.id)).toBe("already");
    expect(await requestDeadLetterReplay(h.deps, crypto.randomUUID())).toBe("not_found");
    expect(await requestDeadLetterReplay(h.deps, "not-a-uuid")).toBe("not_found");

    const claimed = await claimDeadLetterReplays(h.deps);
    expect(claimed).toEqual([{ id: row.id, jobType: "handle_inbound", job: INBOUND }]);
    expect(await claimDeadLetterReplays(h.deps)).toEqual([]);

    await releaseDeadLetterReplay(h.deps, row.id);
    expect(await claimDeadLetterReplays(h.deps)).toHaveLength(1);
  });

  it("deletes dead jobs after 14 days in the nightly retention", async () => {
    await keep("old");
    h.clock.advance(15 * DAY);
    await keep("new");
    const counts = await applyRetention(h.deps);
    expect(counts.dead_letters_deleted).toBe(1);
    expect((await h.db.select({ id: deadLetters.id }).from(deadLetters)).length).toBe(1);
  });

  it("tells the founder once an hour that jobs were kept as dead letters", async () => {
    await keep("a");
    await keep("b");
    expect(await opsAlerts(h.deps)).toBe(1);
    const [text] = h.telegram.sentTo("9001").map((entry) => entry.message.text ?? "");
    expect(text).toMatch(/^2 queue jobs failed every retry since/);
    expect(await opsAlerts(h.deps)).toBe(0);
  });
});
