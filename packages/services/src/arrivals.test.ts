import { createFakeAi, createOffAi, fakeRecord, genericChips } from "@vela/ai";
import type { LocalDate, OutboundKind } from "@vela/contracts";
import { decodeButton, outboundKey, zonedInstant } from "@vela/core";
import {
  aiCalls,
  answers,
  chips,
  type Exchange,
  events,
  exchanges,
  media,
  members,
  messageRefs,
  outbound,
  replies,
  turns,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverArrival, prepareDay, sendRepeat, sendTurnPrompt } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
} from "./testing/seed.ts";

const TZ = "Asia/Taipei";
const TODAY: LocalDate = "2026-09-14";
const TOMORROW: LocalDate = "2026-09-15";
const GROUP = "-100500";

let h: Harness;
let chipsFail = false;

beforeAll(async () => {
  h = await createHarness({
    ai: {
      chips: async (input) => {
        const value = { chips: genericChips(input.lang) };
        return chipsFail
          ? { ok: false, value, record: fakeRecord("chips", "http_529"), error: "http_529" }
          : { ok: true, value, record: fakeRecord("chips") };
      },
    },
  });
}, 60_000);

beforeEach(async () => {
  chipsFail = false;
  await h.reset();
});

afterAll(async () => {
  await h.close();
});

function at(date: LocalDate, time: string): Date {
  return zonedInstant(date, time, TZ);
}

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

async function outboundRows(kind: OutboundKind) {
  return h.db
    .select()
    .from(outbound)
    .where(eq(outbound.kind, kind))
    .orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function eventRows() {
  return h.db.select().from(events).orderBy(asc(events.id));
}

async function exchangeById(id: string): Promise<Exchange> {
  const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, id));
  if (row === undefined) {
    throw new Error(`exchange ${id} vanished`);
  }
  return row;
}

async function seedMedia(
  seed: SeededFamily,
  kind: "audio" | "image",
  providerFileId: string,
): Promise<string> {
  const [row] = await h.db
    .insert(media)
    .values({
      familyId: seed.family.id,
      uploadedBy: seed.organiser.id,
      kind,
      channel: "telegram",
      providerFileId,
      providerUniqueId: `u-${providerFileId}`,
      createdAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 30 * 86_400_000),
    })
    .returning({ id: media.id });
  if (row === undefined) {
    throw new Error("media not inserted");
  }
  return row.id;
}

/** A question for tomorrow from Mia, scheduled and carrying one photo. */
async function seedSoupQuestion(seed: SeededFamily, date: LocalDate): Promise<Exchange> {
  const photoId = await seedMedia(seed, "image", "photo-1");
  const [ask] = await h.db
    .insert(exchanges)
    .values({
      familyId: seed.family.id,
      recipientId: seed.member.id,
      askerId: seed.organiser.id,
      type: "question",
      state: "scheduled",
      text: "Which soup today?",
      textLang: "en",
      whenRule: "tomorrow",
      scheduledFor: date,
      mediaIds: [photoId],
    })
    .returning();
  if (ask === undefined) {
    throw new Error("ask not inserted");
  }
  return ask;
}

/**
 * Yesterday's answered question with two replies to her, Sam's words and Mia's voice note, both
 * still to be read back.
 */
async function seedYesterdayWithReplies(
  seed: SeededFamily,
): Promise<{ previous: Exchange; replyIds: string[] }> {
  const sam = await seedGroupMember(h.db, seed, {
    now: at(TODAY, "07:00"),
    name: "Sam",
    externalId: "1002",
  });
  const previous = await seedExchange(h.db, seed, {
    date: TODAY,
    state: "answered",
    deliveredAt: at(TODAY, "08:00"),
    answeredAt: at(TODAY, "09:00"),
  });
  const voiceId = await seedMedia(seed, "audio", "voice-mia");
  const inserted = await h.db
    .insert(replies)
    .values([
      {
        exchangeId: previous.id,
        memberId: sam.member.id,
        kind: "text",
        text: "Looks great, Mom!",
        channel: "telegram",
        externalId: `${GROUP}:11`,
        toRecipient: true,
        createdAt: at(TODAY, "12:00"),
      },
      {
        exchangeId: previous.id,
        memberId: seed.organiser.id,
        kind: "voice",
        text: null,
        mediaId: voiceId,
        channel: "telegram",
        externalId: `${GROUP}:12`,
        toRecipient: true,
        createdAt: at(TODAY, "13:00"),
      },
    ])
    .returning({ id: replies.id });
  return { previous, replyIds: inserted.map((row) => row.id) };
}

describe("prepareDay", () => {
  it("settles the ask composed for the date and drafts its chips once", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const ask = await seedExchange(h.db, seed, { date: TOMORROW, state: "composed" });

    const id = await prepareDay(h.deps, seed.member.id, TOMORROW);
    const again = await prepareDay(h.deps, seed.member.id, TOMORROW);

    expect(id).toBe(ask.id);
    expect(again).toBe(ask.id);
    expect(await exchangeById(ask.id)).toMatchObject({
      state: "scheduled",
      scheduledFor: TOMORROW,
    });
    const [drafted] = await h.db.select().from(chips).where(eq(chips.exchangeId, ask.id));
    expect(drafted?.chips).toEqual(["Good", "Not yet", "Tell you later"]);
    expect(h.ai.calls.map((call) => call.call)).toEqual(["chips"]);
    expect(h.ai.calls[0]?.input).toMatchObject({
      lang: "en",
      askerName: "Mia",
      question: "What are you cooking tonight?",
      pastAnswers: [],
    });
    const [logged] = await h.db.select().from(aiCalls);
    expect(logged).toMatchObject({ call: "chips", ok: true, inputRef: { exchange_id: ask.id } });
    const prepared = (await eventRows()).filter((event) => event.name === "exchange_prepared");
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.props).toEqual({ date: TOMORROW, type: "question", source: "scheduled" });
  });

  it("takes the oldest whenever ask when nothing is scheduled for the date", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const [older, newer] = await h.db
      .insert(exchanges)
      .values(
        [2, 1].map((daysAgo) => ({
          familyId: seed.family.id,
          recipientId: seed.member.id,
          askerId: seed.organiser.id,
          type: "question" as const,
          state: "composed" as const,
          text: `Ask from ${daysAgo} days ago`,
          textLang: "en" as const,
          whenRule: "whenever" as const,
          scheduledFor: null,
          createdAt: new Date(h.clock.now().getTime() - daysAgo * 86_400_000),
        })),
      )
      .returning({ id: exchanges.id });
    if (older === undefined || newer === undefined) {
      throw new Error("whenever asks not inserted");
    }

    const id = await prepareDay(h.deps, seed.member.id, TOMORROW);

    expect(id).toBe(older.id);
    expect(await exchangeById(older.id)).toMatchObject({
      state: "scheduled",
      scheduledFor: TOMORROW,
    });
    expect(await exchangeById(newer.id)).toMatchObject({ state: "composed", scheduledFor: null });
    const [prepared] = (await eventRows()).filter((event) => event.name === "exchange_prepared");
    expect(prepared?.props).toMatchObject({ source: "whenever" });
  });

  it("creates the hello when nobody asked, with no chips and no model call", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });

    const id = await prepareDay(h.deps, seed.member.id, TOMORROW);

    expect(await exchangeById(id)).toMatchObject({
      type: "hello",
      state: "scheduled",
      askerId: null,
      text: null,
      textLang: "en",
      whenRule: "date",
      scheduledFor: TOMORROW,
      createdAt: h.clock.now(),
    });
    expect(h.ai.calls).toHaveLength(0);
    expect(await h.db.select().from(chips)).toHaveLength(0);
    const [prepared] = (await eventRows()).filter((event) => event.name === "exchange_prepared");
    expect(prepared?.props).toEqual({ date: TOMORROW, type: "hello", source: "hello" });
  });

  it("gives the chips her twenty latest answers in her words: what she said, else wrote, else the summary", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const answeredToday = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "answered",
      deliveredAt: at(TODAY, "08:00"),
      answeredAt: at(TODAY, "08:10"),
    });
    const ask = await seedExchange(h.db, seed, { date: TOMORROW, state: "composed" });
    const answer = (
      minute: number,
      values: { kind: "text" | "voice" | "chip" | "photo"; payload?: Record<string, string> } & {
        transcript?: string;
        summary?: string;
      },
    ) => ({
      exchangeId: answeredToday.id,
      memberId: seed.member.id,
      channel: "telegram" as const,
      externalId: `2001:${minute}`,
      payload: values.payload ?? {},
      kind: values.kind,
      transcript: values.transcript ?? null,
      summary: values.summary ?? null,
      receivedAt: new Date(at(TODAY, "08:00").getTime() + minute * 60_000),
    });
    const older = Array.from({ length: 20 }, (_, index) =>
      answer(index, { kind: "text", payload: { text: `Older ${index}` } }),
    );
    await h.db.insert(answers).values([
      ...older,
      answer(30, { kind: "photo" }),
      answer(31, {
        kind: "chip",
        payload: { choice: "Noodles" },
        summary: "Mom chose: Noodles.",
      }),
      answer(32, { kind: "text", payload: { text: "Went to the market" }, summary: "Market." }),
      answer(33, { kind: "voice", transcript: "Soup again", summary: "Soup." }),
    ]);
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const otherExchange = await seedExchange(h.db, other, { date: TODAY, state: "answered" });
    await h.db.insert(answers).values({
      ...answer(40, { kind: "text", payload: { text: "Not hers" } }),
      exchangeId: otherExchange.id,
      memberId: other.member.id,
      externalId: "2101:40",
    });

    await prepareDay(h.deps, seed.member.id, TOMORROW);

    expect(h.ai.calls[0]?.input).toMatchObject({
      question: "What are you cooking tonight?",
      // The photo without words takes one of the twenty places and gives nothing.
      pastAnswers: [
        "Soup again",
        "Went to the market",
        "Mom chose: Noodles.",
        ...Array.from({ length: 16 }, (_, index) => `Older ${19 - index}`),
      ],
    });
    expect((await exchangeById(ask.id)).state).toBe("scheduled");
  });

  it("logs a drafting step that throws by its error's name, never by the words in its message", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const ask = await seedExchange(h.db, seed, { date: TOMORROW, state: "composed" });
    h.deps.ai = createFakeAi({
      chips: async () => {
        throw new Error("Failed query: insert into chips\nparams: What are you cooking tonight?");
      },
    });

    await prepareDay(h.deps, seed.member.id, TOMORROW);

    expect((await exchangeById(ask.id)).state).toBe("scheduled");
    expect(
      h.logger.entries
        .filter((entry) => entry.event === "chips_failed")
        .map((entry) => entry.fields),
    ).toEqual([{ exchangeId: ask.id, error: "Error" }]);
  });

  // Decision X (2026-09-18): with AI off the question goes out as it does after a failed call, but
  // nothing claims a call was made or that one failed.
  it("lets the question go out without chips while AI is off, logging no call and no failure", async () => {
    h.deps.ai = createOffAi();
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const ask = await seedExchange(h.db, seed, { date: TOMORROW, state: "composed" });

    await prepareDay(h.deps, seed.member.id, TOMORROW);

    expect((await exchangeById(ask.id)).state).toBe("scheduled");
    expect(await h.db.select().from(chips)).toHaveLength(0);
    expect(await h.db.select().from(aiCalls)).toHaveLength(0);
    expect(h.logger.entries.map((entry) => entry.event)).not.toContain("chips_failed");
  });

  it("lets the question go out without chips when drafting fails", async () => {
    chipsFail = true;
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const ask = await seedExchange(h.db, seed, { date: TOMORROW, state: "composed" });

    await prepareDay(h.deps, seed.member.id, TOMORROW);

    expect((await exchangeById(ask.id)).state).toBe("scheduled");
    expect(await h.db.select().from(chips)).toHaveLength(0);
    const [logged] = await h.db.select().from(aiCalls);
    expect(logged).toMatchObject({ call: "chips", ok: false });
    expect(h.logger.entries.map((entry) => entry.event)).toContain("chips_failed");
  });
});

describe("deliverArrival", () => {
  it("prepares the day on demand and enqueues the hello with the effect the gateway needs", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);

    const rows = await outboundRows("arrival");
    expect(rows).toHaveLength(1);
    const [row] = rows;
    const hello = await exchangeById(row?.exchangeId ?? "");
    expect(hello.type).toBe("hello");
    expect(row).toMatchObject({
      idempotencyKey: outboundKey("arrival", { memberId: seed.member.id, date: TOMORROW }),
      memberId: seed.member.id,
      conversationId: seed.memberLink.externalId,
      localDay: TOMORROW,
      status: "queued",
    });
    expect(row?.payload).toEqual({
      message: {
        lang: "en",
        text: [
          "Good morning, Mrs Chen.",
          "Nothing new from the family today. How are you this morning?\nVela, from your family",
          "Reply with a voice message, or tap a button.",
        ].join("\n\n"),
        buttons: [[expect.objectContaining({ label: "❤️" }), expect.objectContaining({})]],
      },
      ref: { purpose: "arrival", exchangeId: hello.id },
      effect: { exchangeId: hello.id, late: false, readBackReplyIds: [], previousExchangeId: null },
    });

    await h.run(handlers());

    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(1);
    expect(await exchangeById(hello.id)).toMatchObject({
      state: "delivered",
      deliveredAt: h.clock.now(),
      deliveryLate: false,
    });
    const refs = await h.db.select().from(messageRefs);
    expect(refs.map((ref) => [ref.purpose, ref.exchangeId])).toEqual([["arrival", hello.id]]);
    expect(h.scheduler.wakes.get(seed.member.id)).toEqual(h.clock.now());
    expect((await eventRows()).map((event) => event.name)).toEqual([
      "exchange_prepared",
      "arrival_delivered",
    ]);

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    expect(await outboundRows("arrival")).toHaveLength(1);
  });

  it("renders the question with its chips and image, and reads yesterday's replies back with the voice first", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const { previous, replyIds } = await seedYesterdayWithReplies(seed);
    const ask = await seedSoupQuestion(seed, TOMORROW);
    await h.db.insert(chips).values({
      exchangeId: ask.id,
      chips: ["Fish", "Chicken", "Vegetable"],
      promptVersion: "chips.test",
    });
    h.clock.set(at(TOMORROW, "11:30"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, true);

    const [row] = await outboundRows("arrival");
    expect(row?.payload).toMatchObject({
      message: {
        text: [
          "From yesterday:\nSam: Looks great, Mom!\nMia sent a voice message.",
          "Sorry this is late.\nGood morning, Mrs Chen.",
          "Mia asks:\nWhich soup today?",
          "Reply with a voice message, or tap a button.",
        ].join("\n\n"),
        media: [
          { kind: "audio", providerFileId: "voice-mia" },
          { kind: "image", providerFileId: "photo-1" },
        ],
      },
      effect: {
        exchangeId: ask.id,
        late: true,
        readBackReplyIds: replyIds,
        previousExchangeId: previous.id,
      },
    });
    const payload = row?.payload as { message: { buttons: { id: string; label: string }[][] } };
    expect(
      payload.message.buttons.map((buttonRow) =>
        buttonRow.map((button) => [decodeButton(button.id), button.label]),
      ),
    ).toEqual([
      [[{ type: "chip", exchangeId: ask.id, index: 0 }, "Fish"]],
      [[{ type: "chip", exchangeId: ask.id, index: 1 }, "Chicken"]],
      [[{ type: "chip", exchangeId: ask.id, index: 2 }, "Vegetable"]],
      [
        [{ type: "answer", exchangeId: ask.id, answer: "heart" }, "❤️"],
        [{ type: "answer", exchangeId: ask.id, answer: "fine" }, "I'm fine"],
      ],
    ]);

    await h.run(handlers());

    expect(await exchangeById(ask.id)).toMatchObject({
      state: "delivered",
      deliveredAt: h.clock.now(),
      deliveryLate: true,
    });
    expect(await exchangeById(previous.id)).toMatchObject({
      state: "read_back",
      readBackAt: h.clock.now(),
    });
    const readBack = await h.db.select({ at: replies.readBackAt }).from(replies);
    expect(readBack.map((reply) => reply.at)).toEqual([h.clock.now(), h.clock.now()]);
    const refs = await h.db.select().from(messageRefs).orderBy(asc(messageRefs.messageId));
    expect(refs.map((ref) => [ref.messageId, ref.purpose, ref.exchangeId])).toEqual([
      ["1", "arrival", ask.id],
      ["2", "arrival", ask.id],
      ["3", "arrival", ask.id],
    ]);
    expect((await eventRows()).map((event) => event.name)).toEqual([
      "arrival_delivered",
      "readback_delivered",
    ]);
  });

  // Decision X (2026-09-18): the read-back is the product, so AI off must not take it away. Both it
  // and the hello are written from copy, with no model call.
  it("still reads yesterday's replies back and sends the hello's own copy while AI is off", async () => {
    h.deps.ai = createOffAi();
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const { replyIds } = await seedYesterdayWithReplies(seed);
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);

    const [row] = await outboundRows("arrival");
    expect(row?.payload).toMatchObject({
      message: {
        text: [
          "From yesterday:\nSam: Looks great, Mom!\nMia sent a voice message.",
          "Good morning, Mrs Chen.",
          "Nothing new from the family today. How are you this morning?\nVela, from your family",
          "Reply with a voice message, or tap a button.",
        ].join("\n\n"),
        media: [{ kind: "audio", providerFileId: "voice-mia" }],
      },
      effect: { readBackReplyIds: replyIds },
    });
    expect(await h.db.select().from(aiCalls)).toHaveLength(0);
  });

  it("sends a photo choice with exactly two images, and one image as a question", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const first = await seedMedia(seed, "image", "photo-1");
    const second = await seedMedia(seed, "image", "photo-2");
    const third = await seedMedia(seed, "image", "photo-3");
    const [choice, lone] = await h.db
      .insert(exchanges)
      .values(
        [
          { date: TOMORROW, mediaIds: [first, second] },
          { date: "2026-09-16" as LocalDate, mediaIds: [third] },
        ].map((ask) => ({
          familyId: seed.family.id,
          recipientId: seed.member.id,
          askerId: seed.organiser.id,
          type: "photo_choice" as const,
          state: "scheduled" as const,
          text: null,
          textLang: "en" as const,
          whenRule: "tomorrow" as const,
          scheduledFor: ask.date,
          mediaIds: ask.mediaIds,
        })),
      )
      .returning({ id: exchanges.id });
    if (choice === undefined || lone === undefined) {
      throw new Error("photo asks not inserted");
    }
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    h.clock.set(at("2026-09-16", "08:00"));
    await deliverArrival(h.deps, seed.member.id, "2026-09-16", false);

    const [asChoice, asQuestion] = (await outboundRows("arrival")).map(
      (row) =>
        row.payload as {
          message: { text: string; media?: unknown[]; buttons: { id: string }[][] };
        },
    );
    expect(asChoice?.message.text).toContain("Mia asks:\nWhich one? Tap 1 or 2.");
    expect(asChoice?.message.media).toEqual([
      { kind: "image", providerFileId: "photo-1" },
      { kind: "image", providerFileId: "photo-2" },
    ]);
    expect(asChoice?.message.buttons[0]?.map((button) => decodeButton(button.id))).toEqual([
      { type: "pick", exchangeId: choice.id, index: 0 },
      { type: "pick", exchangeId: choice.id, index: 1 },
    ]);
    expect(asQuestion?.message.text).toContain("Mia sent you a photo.");
    expect(asQuestion?.message.text).not.toContain("Tap 1 or 2");
    expect(asQuestion?.message.media).toEqual([{ kind: "image", providerFileId: "photo-3" }]);
    expect(asQuestion?.message.buttons.map((buttonRow) => buttonRow.length)).toEqual([2]);
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "photo_choice_without_two_images",
      fields: { exchangeId: lone.id, images: 1 },
    });
  });
});

describe("sendRepeat", () => {
  it("repeats the morning with the preface, without the read-back, once", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedYesterdayWithReplies(seed);
    const ask = await seedSoupQuestion(seed, TOMORROW);
    h.clock.set(at(TOMORROW, "08:00"));
    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    await h.run(handlers());
    h.clock.advanceMinutes(150);

    await sendRepeat(h.deps, seed.member.id, TOMORROW);
    await sendRepeat(h.deps, seed.member.id, TOMORROW);

    const rows = await outboundRows("repeat");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      idempotencyKey: outboundKey("repeat", { memberId: seed.member.id, date: TOMORROW }),
      exchangeId: ask.id,
      localDay: TOMORROW,
    });
    expect(rows[0]?.payload).toMatchObject({
      message: {
        text: [
          "In case you missed it:\nGood morning, Mrs Chen.",
          "Mia asks:\nWhich soup today?",
          "Reply with a voice message, or tap a button.",
        ].join("\n\n"),
        media: [{ kind: "image", providerFileId: "photo-1" }],
      },
      ref: { purpose: "repeat", exchangeId: ask.id },
      effect: { exchangeId: ask.id },
    });

    await h.run(handlers());

    expect((await exchangeById(ask.id)).repeatedAt).toEqual(h.clock.now());
    expect((await eventRows()).map((event) => event.name)).toContain("repeat_sent");
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(2);
  });

  it("sends nothing for a day not delivered, already answered, or whose delivery failed", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedExchange(h.db, seed, { date: "2026-09-15", state: "scheduled" });
    await seedExchange(h.db, seed, {
      date: "2026-09-16",
      state: "answered",
      deliveredAt: at("2026-09-16", "08:00"),
      answeredAt: at("2026-09-16", "08:20"),
    });
    const failed = await seedExchange(h.db, seed, { date: "2026-09-17", state: "scheduled" });
    await h.db
      .update(exchanges)
      .set({ deliveredAt: at("2026-09-17", "08:00"), deliveryFailedAt: at("2026-09-17", "09:00") })
      .where(eq(exchanges.id, failed.id));

    for (const date of ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]) {
      await sendRepeat(h.deps, seed.member.id, date);
    }

    expect(await outboundRows("repeat")).toHaveLength(0);
    expect(h.logger.entries.filter((entry) => entry.event === "repeat_skipped")).toHaveLength(4);
  });
});

describe("sendTurnPrompt", () => {
  async function turnRows() {
    return h.db.select().from(turns).orderBy(asc(turns.localDay));
  }

  it("records the turn with the organiser and sends nothing when no group is linked", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });

    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);
    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);

    expect(await turnRows()).toEqual([
      {
        familyId: seed.family.id,
        localDay: TOMORROW,
        recipientId: seed.member.id,
        holderId: seed.organiser.id,
        promptedAt: h.clock.now(),
        promptMessageId: null,
        actedAt: null,
      },
    ]);
    expect(await h.db.select().from(outbound)).toHaveLength(0);
  });

  it("names the holders in join order, wrapping round, and records the prompt when it is sent", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const sam = await seedGroupMember(h.db, seed, {
      now: new Date(h.clock.now().getTime() + 60_000),
      name: "Sam",
      externalId: "1002",
    });
    const lee = await seedGroupMember(h.db, seed, {
      now: new Date(h.clock.now().getTime() + 120_000),
      name: "Lee",
      externalId: "1003",
    });

    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);
    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);

    const [row] = await outboundRows("turn_prompt");
    expect(await outboundRows("turn_prompt")).toHaveLength(1);
    expect(row).toMatchObject({
      idempotencyKey: outboundKey("turn_prompt", { memberId: seed.member.id, date: TOMORROW }),
      memberId: seed.organiser.id,
      conversationId: GROUP,
      localDay: TODAY,
    });
    expect(row?.payload).toEqual({
      message: {
        lang: "en",
        text: "Tomorrow is Mia's turn with Mom. Reply to this message with a question, a photo, or a voice note.",
      },
      ref: { purpose: "turn_prompt", memberId: seed.member.id, localDate: TOMORROW },
      effect: { familyId: seed.family.id, recipientId: seed.member.id, localDay: TOMORROW },
    });

    await h.run(handlers());

    expect(await turnRows()).toEqual([
      expect.objectContaining({
        localDay: TOMORROW,
        holderId: seed.organiser.id,
        promptedAt: h.clock.now(),
        promptMessageId: "1",
      }),
    ]);
    const [ref] = await h.db.select().from(messageRefs);
    expect(ref).toMatchObject({
      conversationId: GROUP,
      messageId: "1",
      purpose: "turn_prompt",
      memberId: seed.member.id,
      localDate: TOMORROW,
      exchangeId: null,
    });
    const [sent] = (await eventRows()).filter((event) => event.name === "turn_prompt_sent");
    expect(sent?.props).toEqual({ date: TOMORROW, holder: seed.organiser.id });

    // One evening at a time: the prompt is budgeted per holder and local day, as it is in life.
    for (const date of ["2026-09-16", "2026-09-17", "2026-09-18"]) {
      h.clock.advanceMinutes(24 * 60);
      await sendTurnPrompt(h.deps, seed.member.id, date);
    }
    await h.run(handlers());

    expect((await turnRows()).map((turn) => turn.holderId)).toEqual([
      seed.organiser.id,
      sam.member.id,
      lee.member.id,
      seed.organiser.id,
    ]);
    expect(h.telegram.sentTo(GROUP).map((sent) => sent.message.text.split("'")[0])).toEqual([
      "Tomorrow is Mia",
      "Tomorrow is Sam",
      "Tomorrow is Lee",
      "Tomorrow is Mia",
    ]);
  });

  it("passes a departed holder's turn to whoever joined after them", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const sam = await seedGroupMember(h.db, seed, {
      now: new Date(h.clock.now().getTime() + 60_000),
      name: "Sam",
      externalId: "1002",
    });
    const lee = await seedGroupMember(h.db, seed, {
      now: new Date(h.clock.now().getTime() + 120_000),
      name: "Lee",
      externalId: "1003",
    });
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: TOMORROW,
      recipientId: seed.member.id,
      holderId: sam.member.id,
      promptedAt: h.clock.now(),
    });
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now(), turnsIn: false })
      .where(eq(members.id, sam.member.id));

    await sendTurnPrompt(h.deps, seed.member.id, "2026-09-16");

    const [, next] = await turnRows();
    expect(next?.holderId).toBe(lee.member.id);
  });

  it("invites anyone when nobody holds turns", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    await h.db.update(members).set({ turnsIn: false }).where(eq(members.id, seed.organiser.id));

    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);
    await h.run(handlers());

    expect((await turnRows()).map((turn) => turn.holderId)).toEqual([null]);
    const [row] = await outboundRows("turn_prompt");
    expect(row?.memberId).toBe(seed.member.id);
    expect(h.telegram.sentTo(GROUP)[0]?.message.text).toBe(
      "Tomorrow, anyone can ask Mom something. Reply to this message with a question, a photo, or a voice note.",
    );
  });
});
