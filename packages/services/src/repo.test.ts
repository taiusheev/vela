import { channelLinks, familyChannels, members, messageRefs, outbound } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activeOrganisersWithLinks,
  channelLinkOfMember,
  consentedNearbyContacts,
  exchangeForLocalDate,
  exchangesByIds,
  familyByLinkedGroup,
  familyHasEnded,
  keptLightMembersOfFamily,
  latestDeliveredExchangeWithin,
  linkedGroupOfFamily,
  markWakeDue,
  memberByChannelUser,
  messageRefFor,
  openQuietEventForExchange,
  recentAnswerTimes,
  repointFamilyGroup,
} from "./repo.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
  seedNearbyContact,
} from "./testing/seed.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
});

afterAll(async () => {
  await h.close();
});

describe("members and families", () => {
  it("finds the member behind a platform user with their link and family", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });

    const found = await memberByChannelUser(h.db, "telegram", seed.memberLink.externalId);

    expect(found?.member.id).toBe(seed.member.id);
    expect(found?.link.id).toBe(seed.memberLink.id);
    expect(found?.family.id).toBe(seed.family.id);
    expect(await memberByChannelUser(h.db, "telegram", "nobody")).toBeNull();
    expect(await memberByChannelUser(h.db, "line", seed.memberLink.externalId)).toBeNull();
  });

  it("finds a family by its linked group, and not by an unlinked one", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const group = await seedLinkedGroup(h.db, seed, { now: h.clock.now() });

    expect((await familyByLinkedGroup(h.db, "telegram", group.conversationId))?.family.id).toBe(
      seed.family.id,
    );
    expect((await linkedGroupOfFamily(h.db, seed.family.id, "telegram"))?.id).toBe(group.id);

    await h.db
      .update(familyChannels)
      .set({ unlinkedAt: h.clock.now() })
      .where(eq(familyChannels.id, group.id));
    expect(await familyByLinkedGroup(h.db, "telegram", group.conversationId)).toBeNull();
    expect(await linkedGroupOfFamily(h.db, seed.family.id, "telegram")).toBeNull();
  });

  it("lists active organisers with an unblocked link, in the order they joined", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    h.clock.advanceMinutes(1);
    const second = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
      role: "organiser",
    });
    const paused = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Pat",
      externalId: "1003",
      role: "organiser",
    });
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, paused.member.id));
    const blocked = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Blocked",
      externalId: "1004",
      role: "organiser",
    });
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, blocked.link.id));
    await seedGroupMember(h.db, seed, { now: h.clock.now(), name: "Kid", externalId: "1005" });

    const organisers = await activeOrganisersWithLinks(h.db, seed.family.id, "telegram");

    expect(organisers.map((row) => [row.member.displayName, row.link.externalId])).toEqual([
      ["Mia", "1001"],
      ["Sam", "1002"],
    ]);
    expect(organisers[1]?.member.id).toBe(second.member.id);
  });

  it("knows the kept-light members and a member's link", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedGroupMember(h.db, seed, { now: h.clock.now(), name: "Kid", externalId: "1005" });

    expect((await keptLightMembersOfFamily(h.db, seed.family.id)).map((m) => m.id)).toEqual([
      seed.member.id,
    ]);
    // The light goes off when she is marked deceased; her consent still names her.
    await h.db
      .update(members)
      .set({ lightOn: false, status: "deceased" })
      .where(eq(members.id, seed.member.id));
    expect((await keptLightMembersOfFamily(h.db, seed.family.id)).map((m) => m.id)).toEqual([
      seed.member.id,
    ]);
    expect((await channelLinkOfMember(h.db, seed.organiser.id, "telegram"))?.externalId).toBe(
      "1001",
    );
    expect(await channelLinkOfMember(h.db, seed.organiser.id, "line")).toBeNull();
  });

  it("says a family has ended once deleted or once its kept-light member is left or deceased", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const kid = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Kid",
      externalId: "1005",
    });
    expect(await familyHasEnded(h.db, seed.family.id)).toBe(false);

    await h.db.update(members).set({ status: "left" }).where(eq(members.id, kid.member.id));
    expect(await familyHasEnded(h.db, seed.family.id)).toBe(false);

    await h.db.update(members).set({ status: "left" }).where(eq(members.id, seed.member.id));
    expect(await familyHasEnded(h.db, seed.family.id)).toBe(true);

    await h.db.update(members).set({ status: "active" }).where(eq(members.id, seed.member.id));
    await h.db
      .update(members)
      .set({ status: "deceased", lightOn: false })
      .where(eq(members.id, seed.member.id));
    expect(await familyHasEnded(h.db, seed.family.id)).toBe(true);

    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "3001",
      memberExternalId: "3002",
    });
    expect(await familyHasEnded(h.db, other.family.id)).toBe(false);
    await h.db.execute(`update families set deleted_at = now() where id = '${other.family.id}'`);
    expect(await familyHasEnded(h.db, other.family.id)).toBe(true);
  });

  it("marks when the member's scheduler must look again", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const at = new Date("2026-09-14T03:00:00Z");
    await markWakeDue(h.db, seed.member.id, at);
    const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(row?.nextWakeAt).toEqual(at);
  });
});

describe("exchanges and refs", () => {
  it("finds her exchange for a date, ignoring a withdrawn one", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const withdrawn = await seedExchange(h.db, seed, { date: "2026-09-14", state: "withdrawn" });
    expect(await exchangeForLocalDate(h.db, seed.member.id, "2026-09-14")).toBeNull();

    const live = await seedExchange(h.db, seed, { date: "2026-09-14" });
    expect((await exchangeForLocalDate(h.db, seed.member.id, "2026-09-14"))?.id).toBe(live.id);
    expect((await exchangesByIds(h.db, [withdrawn.id, live.id])).map((e) => e.id).sort()).toEqual(
      [withdrawn.id, live.id].sort(),
    );
    expect(await exchangesByIds(h.db, [])).toEqual([]);
  });

  it("finds her latest delivered exchange within a window, never an archived one", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const old = await seedExchange(h.db, seed, {
      date: "2026-09-10",
      state: "answered",
      deliveredAt: new Date("2026-09-10T00:00:00Z"),
    });
    const recent = await seedExchange(h.db, seed, {
      date: "2026-09-13",
      state: "delivered",
      deliveredAt: new Date("2026-09-13T00:00:00Z"),
    });
    const since = new Date("2026-09-12T12:00:00Z");

    expect((await latestDeliveredExchangeWithin(h.db, seed.member.id, since))?.id).toBe(recent.id);
    expect(
      (await latestDeliveredExchangeWithin(h.db, seed.member.id, new Date("2026-09-09T00:00:00Z")))
        ?.id,
    ).toBe(recent.id);

    await h.db.execute(`update exchanges set state = 'archived' where id = '${recent.id}'`);
    expect(
      (await latestDeliveredExchangeWithin(h.db, seed.member.id, new Date("2026-09-09T00:00:00Z")))
        ?.id,
    ).toBe(old.id);
    expect(await latestDeliveredExchangeWithin(h.db, seed.member.id, since)).toBeNull();
  });

  it("returns her recent answer times newest first, up to the limit", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    for (const day of ["11", "12", "13"]) {
      await seedExchange(h.db, seed, {
        date: `2026-09-${day}`,
        state: "answered",
        deliveredAt: new Date(`2026-09-${day}T00:00:00Z`),
        answeredAt: new Date(`2026-09-${day}T01:00:00Z`),
      });
    }
    await seedExchange(h.db, seed, { date: "2026-09-14", state: "delivered" });

    expect(await recentAnswerTimes(h.db, seed.member.id, 2)).toEqual([
      new Date("2026-09-13T01:00:00Z"),
      new Date("2026-09-12T01:00:00Z"),
    ]);
  });

  it("resolves a message ref and an open quiet event", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, { date: "2026-09-14" });
    await h.db.insert(messageRefs).values({
      channel: "telegram",
      conversationId: "2001",
      messageId: "9",
      familyId: seed.family.id,
      exchangeId: exchange.id,
      purpose: "arrival",
    });

    expect((await messageRefFor(h.db, "telegram", "2001", "9"))?.exchangeId).toBe(exchange.id);
    expect(await messageRefFor(h.db, "telegram", "2001", "10")).toBeNull();
    expect(await openQuietEventForExchange(h.db, exchange.id)).toBeNull();
  });

  it("lists only nearby contacts with a yes and no later no", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const yes = await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      phone: "+886912000001",
      answer: "yes",
    });
    await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Bob",
      phone: "+886912000002",
      answer: null,
    });
    await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Cara",
      phone: "+886912000003",
      answer: "no",
    });

    expect((await consentedNearbyContacts(h.db, seed.member.id)).map((c) => c.id)).toEqual([
      yes.id,
    ]);
  });
});

describe("repointFamilyGroup", () => {
  it("moves the link, the refs, and the queued rows, keeping a ref the new chat already holds", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const group = await seedLinkedGroup(h.db, seed, { now: h.clock.now(), conversationId: "-1" });
    const exchange = await seedExchange(h.db, seed, { date: "2026-09-14" });
    await h.db.insert(messageRefs).values([
      {
        channel: "telegram",
        conversationId: "-1",
        messageId: "5",
        familyId: seed.family.id,
        exchangeId: exchange.id,
        purpose: "answer_post",
      },
      {
        channel: "telegram",
        conversationId: "-1",
        messageId: "6",
        familyId: seed.family.id,
        purpose: "ask_confirmation",
      },
      {
        channel: "telegram",
        conversationId: "-2",
        messageId: "5",
        familyId: seed.family.id,
        purpose: "turn_prompt",
      },
    ]);
    await h.db.insert(outbound).values([
      {
        memberId: seed.member.id,
        kind: "system",
        channel: "telegram",
        conversationId: "-1",
        localDay: "2026-09-14",
        idempotencyKey: "queued",
        payload: {},
      },
      {
        memberId: seed.member.id,
        kind: "system",
        channel: "telegram",
        conversationId: "-1",
        localDay: "2026-09-14",
        idempotencyKey: "sent",
        payload: {},
        status: "sent",
      },
    ]);

    await h.db.transaction((tx) => repointFamilyGroup(tx, "telegram", "-1", "-2"));
    // Telegram reports one move twice: the second finds nothing to move.
    await h.db.transaction((tx) => repointFamilyGroup(tx, "telegram", "-1", "-2"));

    const [link] = await h.db.select().from(familyChannels).where(eq(familyChannels.id, group.id));
    expect(link?.conversationId).toBe("-2");
    const refs = await h.db.select().from(messageRefs).orderBy(asc(messageRefs.messageId));
    expect(refs.map((ref) => [ref.conversationId, ref.messageId, ref.purpose])).toEqual([
      ["-2", "5", "turn_prompt"],
      ["-2", "6", "ask_confirmation"],
    ]);
    const rows = await h.db.select().from(outbound).orderBy(asc(outbound.idempotencyKey));
    expect(rows.map((row) => [row.idempotencyKey, row.conversationId])).toEqual([
      ["queued", "-2"],
      ["sent", "-1"],
    ]);
  });
});
