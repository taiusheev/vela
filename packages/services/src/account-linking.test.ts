import { ApiLinkChallenge, ApiLinkCode, type InboundEvent } from "@vela/contracts";
import {
  accountLinkChallenges,
  apiRequestReceipts,
  channelLinks,
  consents,
  events,
  families,
  members,
  users,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { completeAccountLink, issueAccountLinkCode, startAccountLink } from "./account-linking.ts";
import type { SessionIdentity } from "./api-access.ts";
import { sha256Hex } from "./hash.ts";
import { forgetFamilySubjects, forgetMembersWithTheirContacts } from "./proofs.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let userId: string;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-one" };
const other: SessionIdentity = { authSubject: "auth|Other", sessionId: "session-other" };
const wrong = "W".repeat(22);
const denied = { name: "VelaError", code: "not_found" };
const conflict = { name: "ApiIdempotencyError", code: "conflict" };
const noLink = { status: 200, body: { linked: false } };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Mia" })
    .returning();
  if (user === undefined) throw new Error("Missing account");
  userId = user.id;
});
afterAll(async () => {
  await h.close();
});

function event(externalId = seed.memberLink.externalId): InboundEvent {
  return {
    channel: "telegram",
    eventId: "verified-private-start",
    at: h.clock.now().toISOString(),
    kind: "start",
    sender: { externalUserId: externalId },
    conversation: { externalId, kind: "private" },
  };
}

async function start(key = "start", actor = identity) {
  return ApiLinkChallenge.parse((await startAccountLink(h.deps, actor, key)).response.body);
}

async function issued(actor = identity, key = "start") {
  const challenge = await start(key, actor);
  const result = await issueAccountLinkCode(h.deps, challenge.challenge_id, event());
  return { id: challenge.challenge_id, ...result };
}

function complete(id: string, code: string, key = "complete", actor = identity) {
  return completeAccountLink(h.deps, actor, key, id, code);
}

async function challenge(id: string) {
  const [row] = await h.db
    .select()
    .from(accountLinkChallenges)
    .where(eq(accountLinkChallenges.id, id));
  if (row === undefined) throw new Error("Missing challenge");
  return row;
}

async function ancillary() {
  return {
    links: await h.db.select().from(channelLinks),
    consents: await h.db.select().from(consents),
    queues: [
      [...h.queues.outbound.pending],
      [...h.queues.media.pending],
      [...h.queues.understand.pending],
    ],
    logs: [...h.logger.entries],
    sent: [...h.telegram.sent],
    acknowledged: [...h.telegram.acknowledged],
  };
}

describe("account linking proof", () => {
  it("requires both original app session and private Telegram code, preserving all other state", async () => {
    const before = await ancillary();
    const memberRows = await h.db.select().from(members);
    const started = await startAccountLink(h.deps, identity, "start");
    const pointer = ApiLinkChallenge.parse(started.response.body);
    expect(started).toMatchObject({ response: { status: 201 }, replayed: false });
    expect(Object.keys(pointer).sort()).toEqual(["challenge_id", "expires_at"]);
    expect(pointer.expires_at).toBe(new Date(h.clock.now().getTime() + 900_000).toISOString());
    expect(await challenge(pointer.challenge_id)).toMatchObject({
      userId,
      sessionHash: await sha256Hex(identity.sessionId),
      memberId: null,
      familyId: null,
      codeHash: null,
      attempts: 0,
    });
    expect(await h.db.select().from(members)).toEqual(memberRows);
    const issued = await issueAccountLinkCode(h.deps, pointer.challenge_id, event());
    expect(ApiLinkCode.parse(issued.code)).toBe(issued.code);
    expect(issued.expires_at).toBe(pointer.expires_at);
    expect(await h.db.select().from(members)).toEqual(memberRows);
    expect(await h.db.select().from(events)).toEqual([]);
    const row = await challenge(pointer.challenge_id);
    expect(row).toMatchObject({
      familyId: seed.family.id,
      memberId: seed.member.id,
      channelLinkId: seed.memberLink.id,
      channelIdentityHash: await sha256Hex(seed.memberLink.externalId),
      codeHash: await sha256Hex(JSON.stringify([pointer.challenge_id, issued.code])),
    });
    const result = await complete(pointer.challenge_id, issued.code);
    expect(result).toEqual({
      replayed: false,
      response: {
        status: 200,
        body: { linked: true, member_id: seed.member.id, family_id: seed.family.id },
      },
    });
    expect(await h.db.select().from(members)).toEqual(
      memberRows.map((row) => (row.id === seed.member.id ? { ...row, userId } : row)),
    );
    expect(await ancillary()).toEqual(before);
    expect(await challenge(pointer.challenge_id)).toMatchObject({
      completedAt: h.clock.now(),
      codeHash: null,
      invalidatedAt: null,
    });
    expect(await h.db.select().from(events)).toEqual([
      expect.objectContaining({
        name: "account_linked",
        memberId: seed.member.id,
        familyId: seed.family.id,
        props: { user_id: userId, challenge_id: pointer.challenge_id, channel: "telegram" },
      }),
    ]);
    const stored = JSON.stringify({
      challenges: await h.db.select().from(accountLinkChallenges),
      receipts: await h.db.select().from(apiRequestReceipts),
      events: await h.db.select().from(events),
    });
    expect(stored).not.toContain(issued.code);
    expect(stored).not.toContain(identity.sessionId);
    expect(stored).not.toContain(identity.authSubject);
    expect(await complete(pointer.challenge_id, issued.code)).toEqual({
      ...result,
      replayed: true,
    });
    expect(await complete(pointer.challenge_id, issued.code, "another")).toEqual(result);
    expect(await h.db.select().from(events)).toHaveLength(1);
  });

  it("replays start without issuing secrets and conflicts on a new app session with the same key", async () => {
    const first = await startAccountLink(h.deps, identity, "start");
    expect(await startAccountLink(h.deps, identity, "start")).toEqual({ ...first, replayed: true });
    await expect(
      startAccountLink(h.deps, { ...identity, sessionId: "session-two" }, "start"),
    ).rejects.toMatchObject(conflict);
    expect(await h.db.select().from(accountLinkChallenges)).toHaveLength(1);
  });

  it.each(["unknown", "auth|mia", " auth|Mia", "auth|Mia "])(
    "never provisions or exposes scope for actor %j",
    async (authSubject) => {
      const proof = await issued();
      const actor = { ...identity, authSubject };
      await expect(start("unknown", actor)).rejects.toMatchObject(denied);
      await expect(complete(proof.id, proof.code, "unknown", actor)).rejects.toMatchObject(denied);
      expect(await h.db.select().from(users)).toHaveLength(1);
    },
  );

  it("rejects a different app session, unbound pointers, unknown pointers and malformed proofs", async () => {
    const pointer = await start();
    await expect(complete(pointer.challenge_id, wrong)).rejects.toMatchObject(conflict);
    const proof = await issueAccountLinkCode(h.deps, pointer.challenge_id, event());
    await expect(
      complete(pointer.challenge_id, proof.code, "other-session", {
        ...identity,
        sessionId: "session-two",
      }),
    ).rejects.toMatchObject(denied);
    await expect(
      complete("00000000-0000-4000-8000-000000000000", proof.code),
    ).rejects.toMatchObject(denied);
    for (const code of [
      "",
      pointer.challenge_id,
      "old-invite-token",
      "x".repeat(23),
      `${"x".repeat(21)}\n`,
    ]) {
      await expect(complete(pointer.challenge_id, code)).rejects.toMatchObject({ code: "invalid" });
    }
    expect((await complete(pointer.challenge_id, wrong)).response).toEqual(noLink);
    expect((await challenge(pointer.challenge_id)).attempts).toBe(1);
    expect((await h.db.select().from(members)).every((row) => row.userId === null)).toBe(true);
  });

  it("commits wrong attempts, replays without consuming twice, and locks at five", async () => {
    const proof = await issued();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const key = `bad-${attempt}`;
      expect(await complete(proof.id, wrong, key)).toEqual({ response: noLink, replayed: false });
      expect(await complete(proof.id, wrong, key)).toEqual({ response: noLink, replayed: true });
      expect((await challenge(proof.id)).attempts).toBe(attempt);
    }
    expect(await challenge(proof.id)).toMatchObject({
      attempts: 5,
      invalidatedAt: h.clock.now(),
      codeHash: null,
    });
    expect((await complete(proof.id, proof.code, "valid-too-late")).response).toEqual(noLink);
    expect((await complete(proof.id, wrong, "sixth")).response).toEqual(noLink);
    await expect(issueAccountLinkCode(h.deps, proof.id, event())).rejects.toMatchObject(conflict);
    expect((await challenge(proof.id)).attempts).toBe(5);
    expect(await h.db.select().from(events)).toEqual([]);
  });

  it("rotates only the code on resend and never resets the budget or rebinds", async () => {
    const proof = await issued();
    await complete(proof.id, wrong, "bad");
    const before = await challenge(proof.id);
    h.clock.advance(1_000);
    const resent = await issueAccountLinkCode(h.deps, proof.id, event());
    expect(resent.code).not.toBe(proof.code);
    expect(resent.expires_at).toBe(proof.expires_at);
    expect(await challenge(proof.id)).toEqual({
      ...before,
      codeHash: await sha256Hex(JSON.stringify([proof.id, resent.code])),
    });
    await expect(
      issueAccountLinkCode(h.deps, proof.id, event(seed.organiserLink.externalId)),
    ).rejects.toMatchObject(conflict);
    expect((await complete(proof.id, proof.code, "old")).response).toEqual(noLink);
    await expect(complete(proof.id, resent.code, "old")).rejects.toMatchObject(conflict);
    expect((await complete(proof.id, resent.code, "new")).response.body).toMatchObject({
      linked: true,
    });
  });

  it.each([899_999, 900_000, 900_001])(
    "enforces the exact expiry boundary at %i ms",
    async (elapsed) => {
      const proof = await issued();
      h.clock.advance(elapsed);
      expect((await complete(proof.id, proof.code)).response.body).toEqual(
        elapsed < 900_000
          ? { linked: true, member_id: seed.member.id, family_id: seed.family.id }
          : { linked: false },
      );
      if (elapsed >= 900_000) {
        await expect(issueAccountLinkCode(h.deps, proof.id, event())).rejects.toMatchObject(
          conflict,
        );
        expect((await challenge(proof.id)).attempts).toBe(0);
      }
    },
  );

  it("a fresh start cancels previous pending proof without invalidating completed proof", async () => {
    const proof = await issued();
    await start("replacement");
    expect(await challenge(proof.id)).toMatchObject({
      invalidatedAt: h.clock.now(),
      codeHash: null,
    });
    expect((await complete(proof.id, proof.code)).response).toEqual(noLink);
    await expect(issueAccountLinkCode(h.deps, proof.id, event())).rejects.toMatchObject(conflict);
    const next = await issued(identity, "third");
    await complete(next.id, next.code, "finish");
    await start("fourth");
    expect((await challenge(next.id)).invalidatedAt).toBeNull();
  });

  it("accepts paused members without changing status or consent", async () => {
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));
    const proof = await issued();
    await complete(proof.id, proof.code);
    const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(row).toMatchObject({ status: "paused", userId, role: "member", lightOn: true });
  });
});

describe("account linking boundaries and atomicity", () => {
  it("validates identity, UUID, keys and events before database access", async () => {
    const select = vi.spyOn(h.db, "select");
    const transaction = vi.spyOn(h.db, "transaction");
    try {
      for (const actor of [
        null,
        {},
        { ...identity, authSubject: " " },
        { ...identity, sessionId: "" },
      ] as SessionIdentity[]) {
        await expect(startAccountLink(h.deps, actor, "start")).rejects.toMatchObject({
          code: "invalid",
        });
        await expect(
          complete("00000000-0000-4000-8000-000000000000", wrong, "complete", actor),
        ).rejects.toMatchObject({ code: "invalid" });
      }
      await expect(startAccountLink(h.deps, identity, "bad/key")).rejects.toMatchObject({
        code: "invalid",
      });
      await expect(complete("bad-id", wrong)).rejects.toMatchObject({ code: "invalid" });
      const valid = event();
      for (const value of [
        null,
        {},
        { ...valid, channel: "line" },
        { ...valid, kind: "text" },
        { ...valid, conversation: { ...valid.conversation, kind: "group" } },
        { ...valid, sender: { externalUserId: "someone-else" } },
        { ...valid, at: "invalid" },
      ]) {
        await expect(
          issueAccountLinkCode(
            h.deps,
            "00000000-0000-4000-8000-000000000000",
            value as InboundEvent,
          ),
        ).rejects.toMatchObject({ code: "invalid" });
      }
      await expect(issueAccountLinkCode(h.deps, "bad-id", valid)).rejects.toMatchObject({
        code: "invalid",
      });
      expect(select).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
      transaction.mockRestore();
    }
  });

  it("rechecks the session-scoped challenge after the preliminary scope read", async () => {
    const proof = await issued();
    const transaction = h.db.transaction.bind(h.db);
    const wrapper = vi.spyOn(h.db, "transaction").mockImplementation(async (callback, config) => {
      await h.db
        .update(accountLinkChallenges)
        .set({ sessionHash: await sha256Hex("replaced-session") })
        .where(eq(accountLinkChallenges.id, proof.id));
      return transaction(callback, config);
    });
    try {
      await expect(complete(proof.id, proof.code)).rejects.toMatchObject(denied);
      expect(await h.db.select().from(events)).toEqual([]);
    } finally {
      wrapper.mockRestore();
    }
  });

  it("takes the shared actor lock before any issue transaction resource access", async () => {
    const pointer = await start();
    const transaction = h.db.transaction.bind(h.db);
    const actorHash = await sha256Hex(identity.authSubject);
    const wrapper = vi.spyOn(h.db, "transaction").mockImplementation((callback, config) =>
      transaction(async (tx) => {
        const execute = vi.spyOn(tx, "execute");
        const select = vi.spyOn(tx, "select");
        const result = await callback(tx);
        const query = execute.mock.calls[0]?.[0];
        if (query === undefined || typeof query === "string") throw new Error("Missing actor lock");
        expect(new PgDialect().sqlToQuery(query.getSQL())).toMatchObject({
          sql: "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          params: [actorHash],
        });
        expect(execute.mock.invocationCallOrder[0]).toBeLessThan(
          select.mock.invocationCallOrder[0] ?? 0,
        );
        return result;
      }, config),
    );
    try {
      await issueAccountLinkCode(h.deps, pointer.challenge_id, event());
    } finally {
      wrapper.mockRestore();
    }
  });

  it.each([
    "blocked",
    "external-id",
    "reassigned",
    "left",
    "deceased",
    "invited",
    "family-deleted",
    "user-deleted",
  ])("denies changed target %s at completion and replay", async (change) => {
    const proof = await issued();
    if (change === "blocked")
      await h.db
        .update(channelLinks)
        .set({ blockedAt: h.clock.now() })
        .where(eq(channelLinks.id, seed.memberLink.id));
    if (change === "external-id")
      await h.db
        .update(channelLinks)
        .set({ externalId: "new-external" })
        .where(eq(channelLinks.id, seed.memberLink.id));
    if (change === "reassigned")
      await h.db
        .update(channelLinks)
        .set({ memberId: seed.organiser.id })
        .where(eq(channelLinks.id, seed.memberLink.id));
    if (change === "left")
      await h.db
        .update(members)
        .set({ leftAt: h.clock.now() })
        .where(eq(members.id, seed.member.id));
    if (change === "deceased" || change === "invited")
      await h.db.update(members).set({ status: change }).where(eq(members.id, seed.member.id));
    if (change === "family-deleted")
      await h.db
        .update(families)
        .set({ deletedAt: h.clock.now() })
        .where(eq(families.id, seed.family.id));
    if (change === "user-deleted")
      await h.db.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, userId));
    await expect(complete(proof.id, proof.code)).rejects.toMatchObject(denied);
    await expect(issueAccountLinkCode(h.deps, proof.id, event())).rejects.toMatchObject(denied);
    expect((await challenge(proof.id)).completedAt).toBeNull();
    expect(await h.db.select().from(events)).toEqual([]);
  });

  it.each(["owner", "family", "member", "channel"])(
    "denies a physically removed %s and its cascaded proof",
    async (resource) => {
      const proof = await issued();
      if (resource === "owner") await h.db.delete(users).where(eq(users.id, userId));
      // Deleting a family or a member goes through the retention job's forgetting step first
      // (jobs.ts), which marks each consent's subject deleted and drops its proof; the schema
      // refuses the delete otherwise.
      if (resource === "family") {
        await forgetFamilySubjects(h.db, seed.family.id, h.clock.now());
        await h.db.delete(families).where(eq(families.id, seed.family.id));
      }
      if (resource === "member") {
        await forgetMembersWithTheirContacts(h.db, [seed.member.id], h.clock.now());
        await h.db.delete(members).where(eq(members.id, seed.member.id));
      }
      if (resource === "channel")
        await h.db.delete(channelLinks).where(eq(channelLinks.id, seed.memberLink.id));
      await expect(complete(proof.id, proof.code)).rejects.toMatchObject(denied);
      await expect(issueAccountLinkCode(h.deps, proof.id, event())).rejects.toMatchObject(denied);
    },
  );

  it("rejects unknown Telegram identities without binding and invalid random output without persistence", async () => {
    const pointer = await start();
    await expect(
      issueAccountLinkCode(h.deps, pointer.challenge_id, event("unknown")),
    ).rejects.toMatchObject(denied);
    const random = vi.spyOn(h.random, "token").mockReturnValue("invalid");
    try {
      await expect(
        issueAccountLinkCode(h.deps, pointer.challenge_id, event()),
      ).rejects.toBeInstanceOf(Error);
      expect(random).toHaveBeenCalledWith(16);
    } finally {
      random.mockRestore();
    }
    expect(await challenge(pointer.challenge_id)).toMatchObject({ memberId: null, codeHash: null });
  });

  it("rejects a claimed target and another membership belonging to the same app user", async () => {
    const [otherUser] = await h.db
      .insert(users)
      .values({ authSubject: other.authSubject, displayName: "Other" })
      .returning();
    if (otherUser === undefined) throw new Error("Missing account");
    const proof = await issued();
    await h.db.update(members).set({ userId: otherUser.id }).where(eq(members.id, seed.member.id));
    await expect(complete(proof.id, proof.code)).rejects.toMatchObject(conflict);
    await expect(issueAccountLinkCode(h.deps, proof.id, event())).rejects.toMatchObject(conflict);
    await h.db.update(members).set({ userId: null }).where(eq(members.id, seed.member.id));
    await h.db.update(members).set({ userId }).where(eq(members.id, seed.organiser.id));
    await expect(complete(proof.id, proof.code)).rejects.toMatchObject(conflict);
    expect(await h.db.select().from(events)).toEqual([]);
  });

  it.each([null, "other"])(
    "completed proof never restores cleared or reassigned membership %j",
    async (reassign) => {
      const proof = await issued();
      await complete(proof.id, proof.code);
      const [otherUser] = await h.db
        .insert(users)
        .values({ authSubject: other.authSubject, displayName: "Other" })
        .returning();
      if (otherUser === undefined) throw new Error("Missing account");
      const replacement = reassign === null ? null : otherUser.id;
      await h.db.update(members).set({ userId: replacement }).where(eq(members.id, seed.member.id));
      await expect(complete(proof.id, proof.code)).rejects.toMatchObject(conflict);
      await expect(complete(proof.id, proof.code, "fresh")).rejects.toMatchObject(conflict);
      const [member] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
      expect(member?.userId).toBe(replacement);
      expect(await h.db.select().from(events)).toHaveLength(1);
    },
  );

  it("serializes concurrent starts and completions under same and different keys", async () => {
    const starts = await Promise.all(
      Array.from({ length: 4 }, () => startAccountLink(h.deps, identity, "same")),
    );
    expect(starts.filter((result) => !result.replayed)).toHaveLength(1);
    const distinct = await Promise.all(Array.from({ length: 4 }, (_, i) => start(`start-${i}`)));
    const pending = (await h.db.select().from(accountLinkChallenges)).filter(
      (row) => row.invalidatedAt === null,
    );
    expect(pending).toHaveLength(1);
    const pointer = distinct.find((row) => row.challenge_id === pending[0]?.id);
    if (pointer === undefined) throw new Error("Missing pointer");
    const proof = await issueAccountLinkCode(h.deps, pointer.challenge_id, event());
    const results = await Promise.all(
      Array.from({ length: 4 }, () => complete(pointer.challenge_id, proof.code)),
    );
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        complete(pointer.challenge_id, proof.code, `finish-${i}`),
      ),
    );
    expect(await h.db.select().from(events)).toHaveLength(1);
  });

  it("allows only one of two app actors to claim a shared Telegram member", async () => {
    await h.db.insert(users).values({ authSubject: other.authSubject, displayName: "Other" });
    const one = await issued();
    const two = await issued(other);
    const results = await Promise.allSettled([
      complete(one.id, one.code),
      complete(two.id, two.code, "complete", other),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: conflict });
    expect(await h.db.select().from(events)).toHaveLength(1);
  });

  it("does not accept a valid code from another challenge or an old invite-shaped proof", async () => {
    const one = await issued();
    const two = await issued(identity, "replacement");
    expect((await complete(two.id, one.code, "cross-challenge")).response).toEqual(noLink);
    expect((await complete(two.id, "old-invite-token-xxxxx", "invite")).response).toEqual(noLink);
    expect((await challenge(two.id)).attempts).toBe(2);
    expect((await complete(two.id, two.code, "correct")).response.body).toMatchObject({
      linked: true,
    });
  });

  it("rechecks target access before serving a successful receipt", async () => {
    const proof = await issued();
    await complete(proof.id, proof.code);
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.memberLink.id));
    await expect(complete(proof.id, proof.code)).rejects.toMatchObject(denied);
    expect(await h.db.select().from(events)).toHaveLength(1);
  });

  it("keeps completed proof replayable after challenge expiry without another event", async () => {
    const proof = await issued();
    const result = await complete(proof.id, proof.code);
    h.clock.advance(900_000);
    expect(await complete(proof.id, proof.code)).toEqual({ ...result, replayed: true });
    expect(await complete(proof.id, proof.code, "fresh-after-expiry")).toEqual(result);
    await expect(issueAccountLinkCode(h.deps, proof.id, event())).rejects.toMatchObject(conflict);
    expect(await h.db.select().from(events)).toHaveLength(1);
  });

  it("counts concurrent wrong requests once per distinct key and never above five", async () => {
    const proof = await issued();
    const same = await Promise.all(
      Array.from({ length: 4 }, () => complete(proof.id, wrong, "same-bad")),
    );
    expect(same.filter((row) => !row.replayed)).toHaveLength(1);
    expect((await challenge(proof.id)).attempts).toBe(1);
    const different = await Promise.all(
      Array.from({ length: 7 }, (_, i) => complete(proof.id, wrong, `bad-${i}`)),
    );
    expect(
      different.every(
        (row) =>
          row.response.body !== null &&
          JSON.stringify(row.response.body) === JSON.stringify({ linked: false }),
      ),
    ).toBe(true);
    expect((await challenge(proof.id)).attempts).toBe(5);
  });

  it("rolls back membership, challenge and receipt when event insertion fails", async () => {
    const proof = await issued();
    const before = await challenge(proof.id);
    const receipts = await h.db.select().from(apiRequestReceipts);
    await h.db.execute(
      sql`create function pg_temp.fail_account_link_event() returns trigger language plpgsql as $$ begin raise exception 'event failure'; end; $$`,
    );
    await h.db.execute(
      sql`create trigger fail_account_link_event before insert on events for each row execute function pg_temp.fail_account_link_event()`,
    );
    try {
      await expect(complete(proof.id, proof.code)).rejects.toBeInstanceOf(Error);
      expect(await challenge(proof.id)).toEqual(before);
      expect(await h.db.select().from(apiRequestReceipts)).toEqual(receipts);
      expect((await h.db.select().from(members)).every((row) => row.userId === null)).toBe(true);
    } finally {
      await h.db.execute(sql`drop trigger fail_account_link_event on events`);
      await h.db.execute(sql`drop function pg_temp.fail_account_link_event()`);
    }
    expect((await complete(proof.id, proof.code)).response.body).toMatchObject({ linked: true });
  });
});
