import { ApiToday, type Lang, type LocalDate } from "@vela/contracts";
import { askBankChildText } from "@vela/copy";
import { addDays, localDateOf } from "@vela/core";
import {
  answers,
  events,
  exchanges,
  media,
  members,
  type NewSuggestion,
  replies,
  type Suggestion,
  suggestions,
  translations,
  turns,
  users,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

/** A bank suggestion as the family reads it: the item in the family's wording. */
function bankText(id: string, lang: Lang): string {
  const text = askBankChildText(id, lang);
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
  it("keeps each parent's tomorrow draft on their own date and inside their family", async () => {
    const { member } = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Dad",
      externalId: "today-dad",
    });
    await h.db
      .update(members)
      .set({
        lightOn: true,
        lightConsentedAt: h.clock.now(),
        tz: "America/Los_Angeles",
      })
      .where(eq(members.id, member.id));
    const dadTomorrow = addDays(localDateOf(h.clock.now(), "America/Los_Angeles"), 1);
    const momDraft = await seedSuggestion();
    const dadDraft = await seedSuggestion({
      aboutMemberId: member.id,
      localDay: dadTomorrow,
      bankId: STORY_ID,
      type: "story",
    });
    await seedSuggestion({ aboutMemberId: member.id, localDay: addDays(dadTomorrow, 1) });
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "today-other-organiser",
      memberExternalId: "today-other-parent",
    });
    await seedSuggestion({ familyId: other.family.id, aboutMemberId: other.member.id });
    const day = ApiToday.parse(await load());
    expect(day.tomorrow).toHaveLength(2);
    expect(day.tomorrow.find((turn) => turn.recipient_id === seed.member.id)).toMatchObject({
      local_day: tomorrow(),
      turn_pending: true,
      suggestion: { id: momDraft.id, text: bankText(BANK_ID, "en") },
    });
    expect(day.tomorrow.find((turn) => turn.recipient_id === member.id)).toMatchObject({
      local_day: dadTomorrow,
      turn_pending: true,
      suggestion: { id: dadDraft.id, text: bankText(STORY_ID, "en") },
    });
    expect(await load(identity, other.family.id)).toBeNull();
    expect(await load(stranger)).toBeNull();
  });

  it("batches conversations, connection days and tomorrow across parents in different zones", async () => {
    async function prepare(member: SeededFamily["member"], index: number) {
      const date = localDateOf(h.clock.now(), member.tz);
      const family = { ...seed, member };
      const exchange = await seedExchange(h.db, family, {
        date,
        state: "answered",
        deliveredAt: h.clock.now(),
      });
      await h.db.insert(answers).values({
        exchangeId: exchange.id,
        memberId: member.id,
        kind: "text",
        channel: "telegram",
        externalId: `today-batch-${index}`,
        payload: { text: `Words from parent ${index}` },
        receivedAt: h.clock.now(),
      });
      await seedExchange(h.db, family, { date: addDays(date, 1), state: "composed" });
      await h.db.insert(turns).values({
        familyId: seed.family.id,
        localDay: addDays(date, 1),
        recipientId: member.id,
        holderId: seed.organiser.id,
        promptedAt: h.clock.now(),
      });
      return member;
    }
    const parents = [await prepare(seed.member, 0)];
    const reads = vi.spyOn(h.db, "select");
    try {
      const first = ApiToday.parse(await load());
      const singleReads = reads.mock.calls.length;
      for (const [index, tz] of [
        "America/Los_Angeles",
        "Pacific/Kiritimati",
        "Asia/Ho_Chi_Minh",
      ].entries()) {
        const { member } = await seedGroupMember(h.db, seed, {
          now: h.clock.now(),
          name: `Parent ${index + 1}`,
          externalId: `today-parent-${index}`,
        });
        const [parent] = await h.db
          .update(members)
          .set({
            tz,
            lightOn: true,
            lightConsentedAt: h.clock.now(),
          })
          .where(eq(members.id, member.id))
          .returning();
        if (parent === undefined) throw new Error("expected parent");
        parents.push(await prepare(parent, index + 1));
      }
      reads.mockClear();
      const day = ApiToday.parse(await load());
      const familyReads = reads.mock.calls.length;
      expect(day.exchanges).toHaveLength(4);
      expect(day.tomorrow).toHaveLength(4);
      expect(day.exchanges.find((card) => card.recipient_id === seed.member.id)).toEqual(
        first.exchanges[0],
      );
      for (const [index, parent] of parents.entries()) {
        const date = localDateOf(h.clock.now(), parent.tz);
        expect(day.exchanges.find((card) => card.recipient_id === parent.id)?.answer?.text).toBe(
          `Words from parent ${index}`,
        );
        expect(day.tomorrow.find((turn) => turn.recipient_id === parent.id)).toMatchObject({
          local_day: addDays(date, 1),
          holder_name: "Mia",
          suggestion: null,
          ask: { asker_name: "Mia" },
        });
        expect(day.connection_days?.find((row) => row.member_id === parent.id)?.days).toEqual(
          Array.from({ length: 7 }, (_, i) => ({
            date: addDays(date, i - 6),
            has_message: i === 6,
          })),
        );
      }
      // Light status and card sources are shared by the whole screen, across all parents.
      expect(familyReads, `single=${singleReads}, four=${familyReads}`).toBe(singleReads);
    } finally {
      reads.mockRestore();
    }
  });
  it("reports pending, delivered and partial failed arrivals from gateway receipts", async () => {
    const exchange = await seedExchange(h.db, seed, { date: today() });
    expect((await load())?.exchanges[0]?.delivery_status).toBe("pending");
    await h.db
      .update(exchanges)
      .set({ deliveredAt: h.clock.now() })
      .where(eq(exchanges.id, exchange.id));
    expect((await load())?.exchanges[0]?.delivery_status).toBe("delivered");
    await h.db
      .update(exchanges)
      .set({ deliveryFailedAt: h.clock.now() })
      .where(eq(exchanges.id, exchange.id));
    expect((await load())?.exchanges[0]?.delivery_status).toBe("failed");
    expect(await load(stranger)).toBeNull();
  });

  it("says which asks Vela wrote and sent in the asker's name, today and tomorrow", async () => {
    const sent = await seedExchange(h.db, seed, { date: today(), deliveredAt: h.clock.now() });
    const next = await seedExchange(h.db, seed, { date: tomorrow(), state: "scheduled" });
    expect((await load())?.exchanges[0]?.drafted_by_vela).toBe(false);
    await h.db.update(exchanges).set({ draftedByVela: true }).where(eq(exchanges.id, sent.id));
    await h.db.update(exchanges).set({ draftedByVela: true }).where(eq(exchanges.id, next.id));
    const day = ApiToday.parse(await load());
    expect(day.exchanges[0]).toMatchObject({ asker_name: "Mia", drafted_by_vela: true });
    expect(day.tomorrow[0]?.ask).toMatchObject({ asker_name: "Mia", drafted_by_vela: true });
  });

  it("describes original answer, greeting and reply recordings independently of AI text", async () => {
    const exchange = await seedExchange(h.db, seed, { date: today(), state: "answered" });
    const [voice, greeting, replied] = await h.db
      .insert(media)
      .values([
        {
          familyId: seed.family.id,
          kind: "audio",
          channel: "telegram",
          providerFileId: "answer-source",
          mime: "audio/ogg",
          durationMs: 42000,
          createdAt: h.clock.now(),
          expiresAt: new Date(h.clock.now().getTime() + 86400000),
        },
        {
          familyId: seed.family.id,
          kind: "audio",
          mime: "audio/mp4",
          storageKey: "greeting.m4a",
          createdAt: h.clock.now(),
        },
        {
          familyId: seed.family.id,
          kind: "audio",
          mime: "audio/mp4",
          storageKey: "reply.m4a",
          createdAt: h.clock.now(),
        },
      ])
      .returning();
    await h.db
      .update(exchanges)
      .set({ voiceHelloId: greeting?.id })
      .where(eq(exchanges.id, exchange.id));
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      channel: "telegram",
      kind: "voice",
      mediaId: voice?.id,
      receivedAt: h.clock.now(),
    });
    await h.db.insert(replies).values({
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      channel: "app",
      kind: "voice",
      mediaId: replied?.id,
    });
    const shown = (await load())?.exchanges[0];
    expect(shown?.answer).toMatchObject({
      text: null,
      audio: {
        id: voice?.id,
        role: "original",
        mime: "audio/ogg",
        state: "pending",
        duration_ms: 42000,
      },
    });
    expect(shown?.voice_hello).toMatchObject({ id: greeting?.id, state: "ready" });
    expect(shown?.replies[0]?.audio).toMatchObject({ id: replied?.id, state: "ready" });
    h.clock.advance(86400000);
    // The older exchange still reads through exchangeRow, but an expired source is never offered.
    const { exchangeRow } = await import("./api-today.ts");
    expect(
      (await exchangeRow(h.db, exchange, seed.member, h.clock.now())).answer?.audio,
    ).toBeNull();
  });

  it("shows a photo answer and a failed source copy as unavailable after its retry day", async () => {
    const exchange = await seedExchange(h.db, seed, { date: today(), state: "answered" });
    const [photo, voice] = await h.db
      .insert(media)
      .values([
        {
          familyId: seed.family.id,
          kind: "image",
          mime: "image/jpeg",
          storageKey: "answer.jpg",
          width: 640,
          height: 480,
        },
        {
          familyId: seed.family.id,
          kind: "audio",
          channel: "telegram",
          providerFileId: "reply-source",
          mime: "audio/ogg",
          createdAt: new Date(h.clock.now().getTime() - 86400001),
        },
      ])
      .returning();
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      channel: "telegram",
      kind: "photo",
      mediaId: photo?.id,
      receivedAt: h.clock.now(),
    });
    await h.db.insert(replies).values({
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      channel: "telegram",
      kind: "voice",
      mediaId: voice?.id,
    });
    const shown = (await load())?.exchanges[0];
    expect(shown?.answer?.photo).toMatchObject({ id: photo?.id, stored: true });
    expect(shown?.replies[0]?.audio?.state).toBe("unavailable");
  });

  it("stops offering expired photos in an answer, reply and ask while keeping book photos", async () => {
    const exchange = await seedExchange(h.db, seed, { date: today(), state: "answered" });
    const [photo, keptPhoto] = await h.db
      .insert(media)
      .values([
        {
          familyId: seed.family.id,
          kind: "image",
          mime: "image/jpeg",
          storageKey: "expiring.jpg",
          expiresAt: new Date(h.clock.now().getTime() + 60_000),
          kept: false,
        },
        {
          familyId: seed.family.id,
          kind: "image",
          mime: "image/jpeg",
          storageKey: "kept.jpg",
          expiresAt: new Date(h.clock.now().getTime() - 60_000),
          kept: true,
        },
      ])
      .returning();
    if (photo === undefined || keptPhoto === undefined) throw new Error("Expected two photos");
    await h.db
      .update(exchanges)
      .set({ mediaIds: [photo.id, keptPhoto.id] })
      .where(eq(exchanges.id, exchange.id));
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      channel: "telegram",
      kind: "photo",
      mediaId: photo.id,
      receivedAt: h.clock.now(),
    });
    await h.db.insert(replies).values({
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      channel: "telegram",
      kind: "photo",
      mediaId: photo.id,
    });
    const before = (await load())?.exchanges[0];
    expect(before?.answer?.photo?.id).toBe(photo.id);
    expect(before?.answer?.photo?.expires_at).toBe(photo.expiresAt?.toISOString());
    expect(before?.replies[0]?.photo?.id).toBe(photo.id);
    expect(before?.photos.map((shown) => shown.id)).toEqual([photo.id, keptPhoto.id]);
    h.clock.advance(60_000);
    const expired = (await load())?.exchanges[0];
    expect(expired?.answer?.photo).toBeNull();
    expect(expired?.replies[0]?.photo).toBeNull();
    expect(expired?.photos.map((shown) => shown.id)).toEqual([keptPhoto.id]);
    expect(expired?.photos[0]?.expires_at).toBeNull();
  });

  it("lights only parent answer days, never a delivered family ask or reply", async () => {
    const earlier = addDays(today(), -3);
    await seedExchange(h.db, seed, {
      date: earlier,
      state: "delivered",
      deliveredAt: new Date(`${earlier}T10:00:00+08:00`),
      text: "mom, what did you plant?",
    });
    await seedExchange(h.db, seed, {
      date: addDays(today(), -1),
      type: "hello",
      state: "delivered",
      deliveredAt: new Date(`${addDays(today(), -1)}T08:00:00+08:00`),
      text: "An unattended bank question",
    });
    await seedExchange(h.db, seed, { date: today(), state: "scheduled", text: "Not sent yet" });
    const [ask] = await h.db.select().from(exchanges).where(eq(exchanges.scheduledFor, earlier));
    if (ask === undefined) throw new Error("expected ask");
    // A delivered family reply does not stand in for an answer from her either.
    await h.db.insert(replies).values({
      exchangeId: ask.id,
      memberId: seed.organiser.id,
      channel: "telegram",
      kind: "text",
      text: "Thinking of you",
      readBackAt: h.clock.now(),
    });
    expect((await load())?.connection_days?.[0]?.days.some((day) => day.has_message)).toBe(false);
    // An answer received today on an earlier ask lights today, not its scheduled date.
    await h.db.insert(answers).values({
      exchangeId: ask.id,
      memberId: seed.member.id,
      channel: "telegram",
      kind: "fine",
      receivedAt: h.clock.now(),
    });
    const days = (await load())?.connection_days?.[0]?.days;
    expect(days).toHaveLength(7);
    expect(days?.filter((day) => day.has_message).map((day) => day.date)).toEqual([today()]);
    expect(days?.find((day) => day.date === earlier)?.has_message).toBe(false);
  });
  it("retains answer windows across quiet days, including unattached parent messages", async () => {
    const earlier = addDays(today(), -3);
    await h.db.insert(events).values({
      name: "answer_recorded",
      familyId: seed.family.id,
      memberId: seed.member.id,
      at: new Date(`${earlier}T10:00:00+08:00`),
      props: { kind: "text", unattached: true },
    });
    const days = (await load())?.connection_days?.[0]?.days;
    expect(days?.filter((day) => day.has_message).map((day) => day.date)).toEqual([earlier]);
  });

  it("keeps her explicit Not okay visible after more words and on an earlier ask", async () => {
    const exchange = await seedExchange(h.db, seed, {
      date: addDays(today(), -1),
      state: "answered",
    });
    const at = h.clock.now();
    await h.db.insert(answers).values([
      {
        exchangeId: exchange.id,
        memberId: seed.member.id,
        channel: "telegram",
        kind: "not_okay",
        receivedAt: at,
      },
      {
        exchangeId: exchange.id,
        memberId: seed.member.id,
        channel: "telegram",
        kind: "text",
        receivedAt: new Date(at.getTime() + 1_000),
        payload: { text: "Please call" },
      },
    ]);
    h.clock.advance(1_000);
    expect((await load())?.not_okay).toEqual([{ member_id: seed.member.id, at: at.toISOString() }]);
    // Family authorization applies to this sensitive explicit tap too.
    expect(await load(stranger)).toBeNull();
    expect((await load())?.connection_days?.[0]?.days.at(-1)?.has_message).toBe(true);
  });

  it("uses the parent's calendar, even when another zone has already started tomorrow", async () => {
    const at = new Date(h.clock.now().getTime() - 9 * 3_600_000);
    const exchange = await seedExchange(h.db, seed, {
      date: addDays(today(), -1),
      state: "answered",
    });
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      channel: "telegram",
      kind: "not_okay",
      receivedAt: at,
    });
    // Yesterday in Taipei, but still the current day in Honolulu.
    expect((await load())?.not_okay).toBeUndefined();
    await h.db
      .update(members)
      .set({ tz: "Pacific/Honolulu" })
      .where(eq(members.id, seed.member.id));
    expect((await load())?.not_okay).toEqual([{ member_id: seed.member.id, at: at.toISOString() }]);
  });

  it("takes the latest explicit tap for each parent's own day, never text or an inferred flag", async () => {
    const exchange = await seedExchange(h.db, seed, { date: today(), state: "answered" });
    const at = h.clock.now();
    const latest = new Date(at.getTime() - 1_000);
    await h.db.insert(answers).values([
      {
        exchangeId: exchange.id,
        memberId: seed.member.id,
        channel: "telegram",
        kind: "not_okay",
        receivedAt: new Date(at.getTime() - 2_000),
      },
      {
        exchangeId: exchange.id,
        memberId: seed.member.id,
        channel: "telegram",
        kind: "not_okay",
        receivedAt: latest,
      },
      {
        exchangeId: exchange.id,
        memberId: seed.member.id,
        channel: "telegram",
        kind: "text",
        receivedAt: at,
        flag: true,
        payload: { text: "Not okay" },
      },
    ]);
    expect(ApiToday.parse(await load()).not_okay).toEqual([
      { member_id: seed.member.id, at: latest.toISOString() },
    ]);
    h.clock.advance(86_400_000);
    expect((await load())?.not_okay).toBeUndefined();
  });

  it("answers an empty day with the lights row and nothing else", async () => {
    const day = await load();
    expect(ApiToday.parse(day)).toEqual({
      connection_days: [
        {
          member_id: seed.member.id,
          days: Array.from({ length: 7 }, (_, index) => ({
            date: addDays(today(), index - 6),
            has_message: false,
          })),
        },
      ],
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
        recipient_tz: "Asia/Taipei",
        asker_name: "Mia",
        asker_id: seed.organiser.id,
        drafted_by_vela: false,
        on_behalf_of: null,
        type: "question",
        ask: "What did the garden look like this morning?",
        created_at: exchange.createdAt.toISOString(),
        voice_hello: null,
        answer: {
          kind: "text",
          text: "The tomatoes finally turned.",
          at: answeredAt.toISOString(),
          picked_media_id: null,
          picked_number: null,
          translation: null,
          audio: null,
          photo: null,
        },
        answers: [
          {
            kind: "text",
            text: "The tomatoes finally turned.",
            at: answeredAt.toISOString(),
            picked_media_id: null,
            picked_number: null,
            translation: null,
            audio: null,
            photo: null,
          },
        ],
        replies: [
          {
            from: "Mia",
            from_id: seed.organiser.id,
            at: new Date(answeredAt.getTime() + 60_000).toISOString(),
            kind: "heart",
            text: null,
            photo: null,
            audio: null,
          },
          {
            from: "Mia",
            from_id: seed.organiser.id,
            at: new Date(answeredAt.getTime() + 120_000).toISOString(),
            kind: "text",
            text: "Those are the seeds you saved",
            photo: null,
            audio: null,
          },
        ],
        delivery_status: "delivered",
        seen_at: null,
        replies_reach_her: true,
        photos: [],
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

  it("carries the family's translation of her words beside her own", async () => {
    const exchange = await seedExchange(h.db, seed, { date: today(), state: "answered" });
    const [answer] = await h.db
      .insert(answers)
      .values({
        exchangeId: exchange.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        externalId: "2001:7",
        payload: { text: "我煮了地瓜粥。" },
        receivedAt: new Date(h.clock.now().getTime() - 60_000),
      })
      .returning();
    expect((await load())?.exchanges[0]?.answer?.translation).toBeNull();

    await h.db.insert(translations).values({
      objectType: "answer",
      objectId: answer?.id ?? "",
      lang: "en",
      text: "I made sweet potato porridge.",
      provider: "claude:test",
    });
    expect((await load())?.exchanges[0]?.answer).toMatchObject({
      text: "我煮了地瓜粥。",
      translation: { lang: "en", text: "I made sweet potato porridge." },
    });
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

  // Flows §3.9: her tap today on yesterday's arrival is today's answer, so Today shows her lit at the
  // time she tapped. Her words belong to yesterday's ask, so today's ask still waits for its own.
  it("shows her lit from a tap today on yesterday's arrival, and today's ask still without an answer", async () => {
    const eight = h.clock.now();
    const yesterday = await seedExchange(h.db, seed, {
      date: addDays(today(), -1),
      state: "answered",
      deliveredAt: new Date(eight.getTime() - 24 * 60 * 60_000),
      answeredAt: new Date(eight.getTime() - 23 * 60 * 60_000),
    });
    const day = await seedExchange(h.db, seed, {
      date: today(),
      state: "delivered",
      deliveredAt: eight,
    });
    h.clock.advanceMinutes(6 * 60 + 32);
    await h.db.insert(answers).values({
      exchangeId: yesterday.id,
      memberId: seed.member.id,
      kind: "fine",
      channel: "telegram",
      externalId: "2001:12",
      receivedAt: h.clock.now(),
    });

    const read = ApiToday.parse(await load());
    expect(read.lights).toEqual([
      expect.objectContaining({ state: "lit", answered_at: h.clock.now().toISOString() }),
    ]);
    expect(read.exchanges).toEqual([expect.objectContaining({ id: day.id, answer: null })]);
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
          drafted_by_vela: false,
          on_behalf_of: null,
          withdrawable: true,
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
