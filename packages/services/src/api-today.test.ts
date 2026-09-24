import { ApiToday } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { answers, exchanges, members, replies, suggestions, turns, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiToday } from "./api-today.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-2" };
const missingId = "00000000-0000-4000-8000-000000000001";

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
  if (user === undefined) throw new Error("expected a seeded account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
});
afterAll(async () => {
  await h.close();
});

function today(): string {
  return localDateOf(h.clock.now(), seed.member.tz);
}

async function load(who: SessionIdentity = identity, familyId = seed.family.id) {
  return loadApiToday(h.db, who, familyId, h.clock.now());
}

describe("loadApiToday", () => {
  it("answers an empty day with the lights row and nothing else", async () => {
    const day = await load();
    expect(ApiToday.parse(day)).toEqual({
      lights: [expect.objectContaining({ member_id: seed.member.id, state: "resting" })],
      exchanges: [],
      tomorrow: [],
    });
  });

  it("carries today's ask, her words, and the family's replies in the order they came", async () => {
    const answeredAt = new Date(h.clock.now().getTime() - 90 * 60_000);
    const exchange = await seedExchange(h.db, seed, {
      date: today(),
      state: "answered",
      text: "What did the garden look like this morning?",
      answeredAt,
    });
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2001:7",
      payload: { text: "The tomatoes finally turned." },
      receivedAt: answeredAt,
    });
    await h.db.insert(replies).values([
      {
        exchangeId: exchange.id,
        memberId: seed.organiser.id,
        kind: "heart",
        channel: "telegram",
        createdAt: new Date(answeredAt.getTime() + 60_000),
      },
      {
        exchangeId: exchange.id,
        memberId: seed.organiser.id,
        kind: "text",
        text: "Those are the seeds you saved",
        channel: "telegram",
        externalId: "1001:9",
        createdAt: new Date(answeredAt.getTime() + 120_000),
      },
    ]);

    const day = await load();
    expect(ApiToday.parse(day).exchanges).toEqual([
      {
        id: exchange.id,
        recipient_id: seed.member.id,
        recipient_name: "Mom",
        asker_name: "Mia",
        on_behalf_of: null,
        type: "question",
        ask: "What did the garden look like this morning?",
        answer: {
          kind: "text",
          text: "The tomatoes finally turned.",
          at: answeredAt.toISOString(),
        },
        replies: [
          { from: "Mia", kind: "heart", text: null },
          { from: "Mia", kind: "text", text: "Those are the seeds you saved" },
        ],
        seen_at: null,
      },
    ]);
  });

  it("reads her voice answer as its transcript, and a tap as the choice she made", async () => {
    const exchange = await seedExchange(h.db, seed, { date: today(), state: "answered" });
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "voice",
      channel: "telegram",
      externalId: "2001:8",
      transcript: "I walked to the market and back.",
      receivedAt: new Date(h.clock.now().getTime() - 60_000),
    });
    expect((await load())?.exchanges[0]?.answer?.text).toBe("I walked to the market and back.");

    await h.db.delete(answers).where(eq(answers.exchangeId, exchange.id));
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "chip",
      channel: "telegram",
      externalId: "2001:9",
      payload: { index: 1, choice: "Sunny all day" },
      receivedAt: new Date(h.clock.now().getTime() - 60_000),
    });
    expect((await load())?.exchanges[0]?.answer?.text).toBe("Sunny all day");
  });

  it("keeps her latest words when she sent more than one, and the receipt once she has opened it", async () => {
    const first = new Date(h.clock.now().getTime() - 3 * 60 * 60_000);
    const second = new Date(h.clock.now().getTime() - 60 * 60_000);
    const exchange = await seedExchange(h.db, seed, { date: today(), state: "answered" });
    await h.db.insert(answers).values([
      {
        exchangeId: exchange.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        externalId: "2001:10",
        payload: { text: "Morning." },
        receivedAt: first,
      },
      {
        exchangeId: exchange.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        externalId: "2001:11",
        payload: { text: "And the tomatoes turned." },
        receivedAt: second,
      },
    ]);
    expect((await load())?.exchanges[0]).toEqual(
      expect.objectContaining({
        answer: expect.objectContaining({ text: "And the tomatoes turned." }),
        seen_at: null,
      }),
    );

    await h.db.update(exchanges).set({ seenAt: first }).where(eq(exchanges.id, exchange.id));
    expect((await load())?.exchanges[0]?.seen_at).toBe(first.toISOString());
  });

  it("carries no answer while the day is only delivered, and no asker for a hello", async () => {
    await seedExchange(h.db, seed, {
      date: today(),
      type: "hello",
      text: null,
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const exchange = (await load())?.exchanges[0];
    expect(exchange?.answer).toBeNull();
    expect(exchange?.asker_name).toBeNull();
    expect(exchange?.ask).toBeNull();
    expect(exchange?.type).toBe("hello");
  });

  it("names tomorrow's turn holder and the suggestion waiting for them", async () => {
    const tomorrow = addDays(today(), 1);
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: tomorrow,
      recipientId: seed.member.id,
      holderId: seed.organiser.id,
      promptedAt: h.clock.now(),
    });
    const [suggestion] = await h.db
      .insert(suggestions)
      .values({
        familyId: seed.family.id,
        forMemberId: seed.organiser.id,
        aboutMemberId: seed.member.id,
        type: "mention",
        text: "Ask her about the seeds she saved last year",
        promptVersion: "suggest@1",
      })
      .returning();
    if (suggestion === undefined) throw new Error("expected a suggestion");

    expect(ApiToday.parse(await load()).tomorrow).toEqual([
      {
        local_day: tomorrow,
        recipient_id: seed.member.id,
        recipient_name: "Mom",
        holder_id: seed.organiser.id,
        holder_name: "Mia",
        ask: null,
        suggestion: { id: suggestion.id, text: suggestion.text },
      },
    ]);
  });

  it("leaves a used suggestion out and keeps the turn without one", async () => {
    const tomorrow = addDays(today(), 1);
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: tomorrow,
      recipientId: seed.member.id,
      holderId: seed.organiser.id,
    });
    await h.db.insert(suggestions).values({
      familyId: seed.family.id,
      forMemberId: seed.organiser.id,
      aboutMemberId: seed.member.id,
      type: "mention",
      text: "Already used",
      promptVersion: "suggest@1",
      usedAt: h.clock.now(),
    });
    expect((await load())?.tomorrow).toEqual([
      expect.objectContaining({ holder_name: "Mia", suggestion: null }),
    ]);
  });

  it("carries tomorrow's ask once a morning is claimed, and stops offering a suggestion", async () => {
    const tomorrow = addDays(today(), 1);
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: tomorrow,
      recipientId: seed.member.id,
      holderId: seed.organiser.id,
    });
    await h.db.insert(suggestions).values({
      familyId: seed.family.id,
      forMemberId: seed.organiser.id,
      aboutMemberId: seed.member.id,
      type: "mention",
      text: "Not for a morning that is taken",
      promptVersion: "suggest@1",
    });
    const composed = await seedExchange(h.db, seed, {
      date: tomorrow,
      state: "composed",
      text: "What did the garden look like this morning?",
    });

    expect(ApiToday.parse(await load()).tomorrow).toEqual([
      expect.objectContaining({
        holder_name: "Mia",
        suggestion: null,
        ask: {
          id: composed.id,
          type: "question",
          text: "What did the garden look like this morning?",
          asker_name: "Mia",
          on_behalf_of: null,
        },
      }),
    ]);
  });

  it("shows the card for an ask composed before the evening prompt has run", async () => {
    const tomorrow = addDays(today(), 1);
    const composed = await seedExchange(h.db, seed, { date: tomorrow, state: "composed" });
    expect(await h.db.select().from(turns).where(eq(turns.familyId, seed.family.id))).toEqual([]);

    expect(ApiToday.parse(await load()).tomorrow).toEqual([
      expect.objectContaining({
        holder_id: null,
        holder_name: null,
        suggestion: null,
        ask: expect.objectContaining({ id: composed.id }),
      }),
    ]);
  });

  it("holds no turn while tomorrow has not been prompted", async () => {
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: today(),
      recipientId: seed.member.id,
      holderId: seed.organiser.id,
    });
    expect((await load())?.tomorrow).toEqual([]);
  });

  it("tells a stranger and a missing family apart from nothing at all", async () => {
    expect(await load(stranger)).toBeNull();
    expect(await load(identity, missingId)).toBeNull();
  });
});
