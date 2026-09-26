import { ApiToday, type Lang, type LocalDate } from "@vela/contracts";
import { askBankText } from "@vela/copy";
import { addDays, localDateOf } from "@vela/core";
import {
  answers,
  exchanges,
  members,
  type NewSuggestion,
  replies,
  type Suggestion,
  suggestions,
  turns,
  users,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiToday } from "./api-today.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-2" };
const samIdentity: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-3" };
const momIdentity: SessionIdentity = { authSubject: "auth|Mom", sessionId: "session-4" };
const missingId = "00000000-0000-4000-8000-000000000001";
/** Two items of Vela's question bank, a question and a story. */
const BANK_ID = "life.childhood.home";
const STORY_ID = "life.family.grandparents";

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await signIn(identity, "Mia", seed.organiser.id);
});
afterAll(async () => {
  await h.close();
});

/** An account that reads Today as the member given. */
async function signIn(who: SessionIdentity, displayName: string, memberId: string): Promise<void> {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: who.authSubject, displayName })
    .returning();
  if (user === undefined) throw new Error("expected a seeded account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

function today(): LocalDate {
  return localDateOf(h.clock.now(), seed.member.tz);
}

function tomorrow(): LocalDate {
  return addDays(today(), 1);
}

async function load(who: SessionIdentity = identity, familyId = seed.family.id) {
  return loadApiToday(h.db, who, familyId, h.clock.now());
}

function bankText(id: string, lang: Lang): string {
  const text = askBankText(id, lang);
  if (text === undefined) throw new Error(`expected ${id} in the question bank`);
  return text;
}

/** The evening prompt's row for her day, with Mia holding the turn. */
async function seedTurn(localDay: LocalDate = tomorrow()): Promise<void> {
  await h.db.insert(turns).values({
    familyId: seed.family.id,
    localDay,
    recipientId: seed.member.id,
    holderId: seed.organiser.id,
    promptedAt: h.clock.now(),
  });
}

/** Her suggestion for tomorrow as the nightly writer stores a bank item, unless told otherwise. */
async function seedSuggestion(values: Partial<NewSuggestion> = {}): Promise<Suggestion> {
  const [row] = await h.db
    .insert(suggestions)
    .values({
      familyId: seed.family.id,
      aboutMemberId: seed.member.id,
      localDay: tomorrow(),
      bankId: BANK_ID,
      type: "question",
      text: "",
      promptVersion: "bank.v1",
      ...values,
    })
    .returning();
  if (row === undefined) throw new Error("expected a suggestion");
  return row;
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
      deliveredAt: new Date(answeredAt.getTime() - 60 * 60_000),
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
        replies_reach_her: true,
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

  it("names tomorrow's turn holder and the suggestion the family may use", async () => {
    await seedTurn();
    const suggestion = await seedSuggestion();

    expect(ApiToday.parse(await load()).tomorrow).toEqual([
      {
        local_day: tomorrow(),
        recipient_id: seed.member.id,
        recipient_name: "Mom",
        holder_id: seed.organiser.id,
        holder_name: "Mia",
        ask: null,
        suggestion: {
          id: suggestion.id,
          text: bankText(BANK_ID, "en"),
          type: "question",
          from_her_words: false,
        },
        turn_pending: false,
      },
    ]);
  });

  it("offers the suggestion before the evening prompt has chosen anyone", async () => {
    const suggestion = await seedSuggestion({ bankId: STORY_ID, type: "story" });
    expect(ApiToday.parse(await load()).tomorrow).toEqual([
      {
        local_day: tomorrow(),
        recipient_id: seed.member.id,
        recipient_name: "Mom",
        holder_id: null,
        holder_name: null,
        ask: null,
        suggestion: {
          id: suggestion.id,
          text: bankText(STORY_ID, "en"),
          type: "story",
          from_her_words: false,
        },
        turn_pending: true,
      },
    ]);
  });

  it("offers tomorrow's own suggestion and never one written for another day", async () => {
    await seedSuggestion({ localDay: today() });
    await seedSuggestion({ localDay: addDays(today(), 2), bankId: STORY_ID, type: "story" });
    expect((await load())?.tomorrow).toEqual([]);

    await seedTurn();
    expect((await load())?.tomorrow).toEqual([
      expect.objectContaining({ holder_name: "Mia", suggestion: null, turn_pending: false }),
    ]);
  });

  it("leaves a used suggestion out and keeps the turn without one", async () => {
    await seedSuggestion({ usedAt: h.clock.now() });
    expect((await load())?.tomorrow).toEqual([]);

    await seedTurn();
    expect((await load())?.tomorrow).toEqual([
      expect.objectContaining({ holder_name: "Mia", suggestion: null }),
    ]);
  });

  it("shows an AI draft in its own language, from her words only when it was drawn from them", async () => {
    const suggestion = await seedSuggestion({
      type: "recipe",
      text: "What did you cook with the herbs Lin brought?",
      lang: "en",
      source: { ai_source: "mention" },
      promptVersion: "suggest.v1",
    });
    expect((await load())?.tomorrow[0]?.suggestion).toEqual({
      id: suggestion.id,
      text: "What did you cook with the herbs Lin brought?",
      type: "recipe",
      from_her_words: true,
    });

    await h.db
      .update(suggestions)
      .set({ source: { ai_source: "rotation" } })
      .where(eq(suggestions.id, suggestion.id));
    expect((await load())?.tomorrow[0]?.suggestion).toEqual(
      expect.objectContaining({ type: "recipe", from_her_words: false }),
    );
  });

  it("shows the bank item and its type once retention has cleared a draft's words", async () => {
    const suggestion = await seedSuggestion({
      type: "word",
      text: "",
      lang: "en",
      source: { ai_source: "mention" },
      promptVersion: "suggest.v1",
    });
    expect((await load())?.tomorrow[0]?.suggestion).toEqual({
      id: suggestion.id,
      text: bankText(BANK_ID, "en"),
      type: "question",
      from_her_words: false,
    });
  });

  it("gives each reader the suggestion in their own language, and a draft only in its own", async () => {
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "3001",
    });
    await h.db.update(members).set({ language: "zh-TW" }).where(eq(members.id, sam.member.id));
    await signIn(samIdentity, "Sam", sam.member.id);
    const suggestion = await seedSuggestion();

    expect((await load())?.tomorrow[0]?.suggestion?.text).toBe(bankText(BANK_ID, "en"));
    expect((await load(samIdentity))?.tomorrow[0]?.suggestion?.text).toBe(
      bankText(BANK_ID, "zh-TW"),
    );

    // Drafted in Mia's English: Sam reads the bank item it stands on, in his own language.
    await h.db
      .update(suggestions)
      .set({
        text: "What did you and Lin find at the market?",
        lang: "en",
        source: { ai_source: "mention" },
        promptVersion: "suggest.v1",
      })
      .where(eq(suggestions.id, suggestion.id));
    expect((await load())?.tomorrow[0]?.suggestion).toEqual(
      expect.objectContaining({
        text: "What did you and Lin find at the market?",
        from_her_words: true,
      }),
    );
    expect((await load(samIdentity))?.tomorrow[0]?.suggestion).toEqual({
      id: suggestion.id,
      text: bankText(BANK_ID, "zh-TW"),
      type: "question",
      from_her_words: false,
    });

    // A reader in a language Vela does not yet write reads English: the English draft, and the
    // bank item once retention has cleared it.
    await h.db.update(members).set({ language: "ja" }).where(eq(members.id, sam.member.id));
    expect((await load(samIdentity))?.tomorrow[0]?.suggestion?.text).toBe(
      "What did you and Lin find at the market?",
    );
    await h.db.update(suggestions).set({ text: "" }).where(eq(suggestions.id, suggestion.id));
    expect((await load(samIdentity))?.tomorrow[0]?.suggestion?.text).toBe(bankText(BANK_ID, "en"));
  });

  it("never shows her a suggestion about herself", async () => {
    await signIn(momIdentity, "Mom", seed.member.id);
    await seedSuggestion();
    expect((await load(momIdentity))?.tomorrow).toEqual([]);

    await seedTurn();
    expect((await load(momIdentity))?.tomorrow).toEqual([
      expect.objectContaining({ recipient_id: seed.member.id, suggestion: null }),
    ]);
    expect((await load())?.tomorrow[0]?.suggestion).not.toBeNull();
  });

  it("offers no suggestion for a morning nobody may ask her for", async () => {
    await seedSuggestion();
    for (const change of [{ status: "paused" as const }, { lightOn: false }]) {
      await h.db.update(members).set(change).where(eq(members.id, seed.member.id));
      expect((await load())?.tomorrow, JSON.stringify(change)).toEqual([]);
      await h.db
        .update(members)
        .set({ status: "active", lightOn: true })
        .where(eq(members.id, seed.member.id));
    }
    expect((await load())?.tomorrow).toHaveLength(1);

    // A family whose other kept-light member has died has ended: nothing is composed for it.
    const dad = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Dad",
      externalId: "3002",
    });
    await h.db
      .update(members)
      .set({ lightOn: true, lightConsentedAt: h.clock.now(), status: "deceased" })
      .where(eq(members.id, dad.member.id));
    expect((await load())?.tomorrow).toEqual([]);
  });

  it("carries tomorrow's ask once a morning is claimed, and stops offering a suggestion", async () => {
    await seedTurn();
    await seedSuggestion();
    const composed = await seedExchange(h.db, seed, {
      date: tomorrow(),
      state: "composed",
      text: "What did the garden look like this morning?",
    });

    expect(ApiToday.parse(await load()).tomorrow).toEqual([
      expect.objectContaining({
        holder_name: "Mia",
        suggestion: null,
        turn_pending: false,
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
    await seedSuggestion();
    const composed = await seedExchange(h.db, seed, { date: tomorrow(), state: "composed" });
    expect(await h.db.select().from(turns).where(eq(turns.familyId, seed.family.id))).toEqual([]);

    expect(ApiToday.parse(await load()).tomorrow).toEqual([
      expect.objectContaining({
        holder_id: null,
        holder_name: null,
        suggestion: null,
        turn_pending: true,
        ask: expect.objectContaining({ id: composed.id }),
      }),
    ]);
  });

  it("holds no turn while tomorrow has not been prompted", async () => {
    await seedTurn(today());
    expect((await load())?.tomorrow).toEqual([]);
  });

  it("tells a stranger and a missing family apart from nothing at all", async () => {
    expect(await load(stranger)).toBeNull();
    expect(await load(identity, missingId)).toBeNull();
  });
});
