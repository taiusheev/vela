import { createHash } from "node:crypto";
import { createFakeAi, createOffAi, fakeRecord, SAFE_DEFAULTS } from "@vela/ai";
import type { LocalDate, LocalTime } from "@vela/contracts";
import { localDateOf, outboundKey, zonedInstant } from "@vela/core";
import {
  aiCalls,
  answers,
  awayPeriods,
  chips,
  consents,
  deletions,
  type Exchange,
  events,
  exchanges,
  families,
  invites,
  media,
  members,
  messageRefs,
  metricsDaily,
  nearbyContacts,
  onboardingSessions,
  outbound,
  quietEvents,
  replies,
  suggestions,
  translations,
  turns,
  weeklyReads,
} from "@vela/db";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyRetention, draftWeeklyRead, rollupMetrics } from "./jobs.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedNearbyContact,
} from "./testing/seed.ts";

const TZ = "Asia/Taipei";
const ADMIN_CHAT = "9001";
const DAY_MS = 86_400_000;

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

function at(date: LocalDate, time: LocalTime): Date {
  return zonedInstant(date, time, TZ);
}

function daysAgo(days: number): Date {
  return new Date(h.clock.now().getTime() - days * DAY_MS);
}

function yearsAgo(years: number): Date {
  const date = new Date(h.clock.now().getTime());
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function monthsAgo(months: number): Date {
  const date = new Date(h.clock.now().getTime());
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

async function setStartsOn(seed: SeededFamily, date: LocalDate): Promise<void> {
  await h.db.update(members).set({ lightStartsOn: date }).where(eq(members.id, seed.member.id));
}

async function memberRow(memberId: string) {
  const [row] = await h.db.select().from(members).where(eq(members.id, memberId));
  return row;
}

/** The fortnight of mornings ending on Sunday 20 September 2026. */
function datesOfFortnight(): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let day = 7; day <= 20; day += 1) {
    dates.push(`2026-09-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

const SUNDAYS = new Set(["2026-09-13", "2026-09-20"]);

function isSunday(date: LocalDate): boolean {
  return SUNDAYS.has(date);
}

/** A delivered morning, answered at `answeredAt` with one answer row when given. */
async function seedMorning(
  seed: SeededFamily,
  input: {
    date: LocalDate;
    type?: "question" | "hello";
    answeredAt?: LocalTime;
    kind?: "chip" | "voice" | "text";
    summary?: string;
    mentions?: Record<string, string[]>;
    voiceMs?: number;
  },
): Promise<Exchange> {
  const answeredAt = input.answeredAt === undefined ? null : at(input.date, input.answeredAt);
  const exchange = await seedExchange(h.db, seed, {
    date: input.date,
    type: input.type ?? "question",
    state: answeredAt === null ? "delivered" : "answered",
    deliveredAt: at(input.date, "08:00"),
    answeredAt,
  });
  if (answeredAt === null) {
    return exchange;
  }
  let mediaId: string | null = null;
  if (input.voiceMs !== undefined) {
    const [voice] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        uploadedBy: seed.member.id,
        kind: "audio",
        channel: "telegram",
        providerFileId: `voice-${input.date}`,
        providerUniqueId: `u-voice-${input.date}`,
        durationMs: input.voiceMs,
      })
      .returning({ id: media.id });
    mediaId = voice?.id ?? null;
  }
  await h.db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: seed.member.id,
    kind: input.kind ?? "chip",
    channel: "telegram",
    externalId: `2001:${input.date}`,
    payload: input.kind === "voice" ? {} : { choice: "Good" },
    mediaId,
    summary: input.summary ?? null,
    mentions: input.mentions ?? {},
    receivedAt: answeredAt,
    understoodAt: answeredAt,
  });
  return exchange;
}

async function eventRows() {
  return h.db.select().from(events).orderBy(asc(events.id));
}

describe("draftWeeklyRead", () => {
  it("counts the days from her start, stores the numbers, and gives the model only the days she answered", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    // Her light started on the Friday, so the week holds three of her days.
    await setStartsOn(seed, "2026-09-18");
    await seedMorning(seed, {
      date: "2026-09-17",
      type: "hello",
      answeredAt: "09:00",
      summary: "Before her start",
    });
    await seedMorning(seed, {
      date: "2026-09-18",
      answeredAt: "09:00",
      summary: "Made soup for the neighbours",
      mentions: { people: ["Auntie Lin"] },
    });
    await seedMorning(seed, { date: "2026-09-19", type: "hello" });
    await seedMorning(seed, {
      date: "2026-09-20",
      answeredAt: "09:30",
      kind: "voice",
      voiceMs: 12_000,
      summary: "Went to the market with Auntie Lin",
      mentions: { people: ["auntie lin"], places: ["the market"] },
    });
    h.clock.set(at("2026-09-20", "18:00"));

    await draftWeeklyRead(h.deps, seed.member.id, "2026-09-20");
    await draftWeeklyRead(h.deps, seed.member.id, "2026-09-20");

    const reads = await h.db.select().from(weeklyReads);
    expect(reads).toHaveLength(1);
    const [read] = reads;
    expect(read).toMatchObject({
      familyId: seed.family.id,
      memberId: seed.member.id,
      weekStart: "2026-09-14",
      lines: ["Made soup for the neighbours", "Went to the market with Auntie Lin"],
      suggestion: "Mom, what was the best part of your week?",
      stats: {
        counted_days: 3,
        answered_days: 2,
        hello_mornings: 1,
        family_asks: 2,
        usual_time: "09:15",
        drift_min: null,
        topics: ["Auntie Lin"],
        voice_len_drift: null,
      },
      promptVersion: fakeRecord("weekly_read").promptVersion,
      sentLines: null,
      sentAt: null,
    });
    expect(h.ai.calls.map((call) => call.call)).toEqual(["weekly_read"]);
    expect(h.ai.calls[0]?.input).toEqual({
      lang: "en",
      elderName: "Mom",
      weekEnd: "2026-09-20",
      days: [
        {
          date: "2026-09-18",
          answeredAt: "09:00",
          askerName: "Mia",
          askType: "question",
          summary: "Made soup for the neighbours",
          voiceSeconds: null,
        },
        {
          date: "2026-09-20",
          answeredAt: "09:30",
          askerName: "Mia",
          askType: "question",
          summary: "Went to the market with Auntie Lin",
          voiceSeconds: 12,
        },
      ],
      usualAnswerTime: "09:15",
      answerTimeDriftMinutes: null,
      voiceLengthDriftPercent: null,
      repeatedMentions: ["Auntie Lin"],
    });
    const [logged] = await h.db.select().from(aiCalls);
    expect(logged).toMatchObject({
      call: "weekly_read",
      ok: true,
      inputRef: { member_id: seed.member.id, week_end: "2026-09-20" },
    });
    const drafted = (await eventRows()).filter((event) => event.name === "weekly_read_drafted");
    expect(drafted.map((event) => event.props)).toEqual([
      {
        week_end: "2026-09-20",
        counted_days: 3,
        answered_days: 2,
        lines: 2,
        ok: true,
        ai_off: false,
      },
    ]);
    const notes = await h.db.select().from(outbound);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: ADMIN_CHAT,
        suffix: `weekly_read_draft:${read?.id ?? ""}`,
      }),
      conversationId: ADMIN_CHAT,
      memberId: seed.member.id,
    });
    expect(notes[0]?.payload).toMatchObject({
      message: {
        text: `Weekly read draft for The Chens is ready: https://vela.test/admin/families/${seed.family.id}`,
      },
    });
    expect(JSON.stringify(notes[0]?.payload)).not.toContain("soup");
  });

  it("keeps her health words out of the stored topics and the model's input, even with her yes", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await setStartsOn(seed, "2026-09-01");
    await h.db.insert(consents).values({
      memberId: seed.member.id,
      subjectRef: `member:${seed.member.id}`,
      kind: "health_words",
      answer: "yes",
      textVersion: "consent.health_words@1",
      lang: "en",
      channel: "telegram",
      givenAt: at("2026-09-01", "09:00"),
    });
    for (const date of ["2026-09-15", "2026-09-17"] as const) {
      await seedMorning(seed, {
        date,
        answeredAt: "09:00",
        summary: "Walked in the park",
        mentions: { places: ["the park"], health: ["knee hurts"] },
      });
    }
    h.clock.set(at("2026-09-20", "18:00"));

    await draftWeeklyRead(h.deps, seed.member.id, "2026-09-20");

    const [read] = await h.db.select().from(weeklyReads);
    expect(read?.stats).toMatchObject({ topics: ["the park"] });
    expect(h.ai.calls[0]?.input).toMatchObject({ repeatedMentions: ["the park"] });
    expect(JSON.stringify(read)).not.toContain("knee");
  });

  it("measures the drifts against last week", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await setStartsOn(seed, "2026-09-01");
    for (const date of ["2026-09-08", "2026-09-10"] as const) {
      await seedMorning(seed, { date, answeredAt: "08:30", kind: "voice", voiceMs: 10_000 });
    }
    await seedMorning(seed, { date: "2026-09-14", type: "hello" });
    for (const date of ["2026-09-15", "2026-09-17"] as const) {
      await seedMorning(seed, {
        date,
        answeredAt: "09:00",
        kind: "voice",
        voiceMs: 15_000,
        summary: "A long chat",
      });
    }
    h.clock.set(at("2026-09-20", "18:00"));

    await draftWeeklyRead(h.deps, seed.member.id, "2026-09-20");

    const [read] = await h.db.select().from(weeklyReads);
    expect(read?.stats).toEqual({
      counted_days: 7,
      answered_days: 2,
      hello_mornings: 1,
      family_asks: 2,
      usual_time: "09:00",
      drift_min: 30,
      topics: [],
      voice_len_drift: 50,
    });
    expect(h.ai.calls[0]?.input).toMatchObject({
      usualAnswerTime: "09:00",
      answerTimeDriftMinutes: 30,
      voiceLengthDriftPercent: 50,
      days: [{ date: "2026-09-15" }, { date: "2026-09-17" }],
    });
  });

  it("stores the safe default when the model fails, so the week is still marked done", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await setStartsOn(seed, "2026-09-14");
    await seedMorning(seed, { date: "2026-09-15", answeredAt: "09:00", summary: "Fine" });
    h.clock.set(at("2026-09-20", "18:00"));
    const failing = createFakeAi({
      weeklyRead: async (input) => ({
        ok: false,
        value: SAFE_DEFAULTS.weekly_read(input),
        record: fakeRecord("weekly_read", "http_529"),
        error: "http_529",
      }),
    });

    await draftWeeklyRead({ ...h.deps, ai: failing }, seed.member.id, "2026-09-20");

    const [read] = await h.db.select().from(weeklyReads);
    expect(read).toMatchObject({
      lines: [],
      suggestion: "Mom, what was the best part of your week?",
      stats: { counted_days: 7, answered_days: 1 },
    });
    const [logged] = await h.db.select().from(aiCalls);
    expect(logged).toMatchObject({ call: "weekly_read", ok: false, output: null });
    const [drafted] = (await eventRows()).filter((event) => event.name === "weekly_read_drafted");
    expect(drafted?.props).toMatchObject({ lines: 0, ok: false, ai_off: false });
    expect(await h.db.select().from(outbound)).toHaveLength(1);
    expect(h.logger.entries.map((entry) => entry.event)).toContain("weekly_read_draft_failed");
  });

  // Decision X (2026-09-18): the founder still gets a draft to edit and send, with the counts; no
  // call is logged or warned about, because none was made.
  it("stores the safe default as the draft while AI is off, logs no call, and still tells the founder", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await setStartsOn(seed, "2026-09-14");
    await seedMorning(seed, { date: "2026-09-15", answeredAt: "09:00", summary: "Fine" });
    h.clock.set(at("2026-09-20", "18:00"));

    await draftWeeklyRead({ ...h.deps, ai: createOffAi() }, seed.member.id, "2026-09-20");

    const [read] = await h.db.select().from(weeklyReads);
    expect(read).toMatchObject({
      lines: [],
      suggestion: "Mom, what was the best part of your week?",
      stats: { counted_days: 7, answered_days: 1 },
      promptVersion: "ai_off",
    });
    expect(await h.db.select().from(aiCalls)).toEqual([]);
    const [drafted] = (await eventRows()).filter((event) => event.name === "weekly_read_drafted");
    expect(drafted?.props).toMatchObject({ lines: 0, ok: false, ai_off: true });
    expect((await h.db.select().from(outbound)).map((row) => row.conversationId)).toEqual([
      ADMIN_CHAT,
    ]);
    expect(h.logger.entries.map((entry) => entry.event)).not.toContain("weekly_read_draft_failed");
  });

  it("retunes T_quiet from her last fourteen answered days and records what it was computed from", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await setStartsOn(seed, "2026-09-07");
    // Fourteen delivered mornings: three hours to answer on a weekday, six on her two Sundays.
    for (const date of datesOfFortnight()) {
      await seedMorning(seed, {
        date,
        answeredAt: isSunday(date) ? "14:00" : "11:00",
        summary: `Day ${date}`,
      });
    }
    h.clock.set(at("2026-09-20", "18:00"));

    await draftWeeklyRead(h.deps, seed.member.id, "2026-09-20");

    // Median 180 minutes + two hours, inside the 240 to 600 band, instead of the 360 default.
    expect(await memberRow(seed.member.id)).toMatchObject({
      quietAfterMin: 300,
      answerStats: {
        median_latency_min: 180,
        sunday_median_min: 360,
        n_days: 14,
        updated_at: at("2026-09-20", "18:00").toISOString(),
      },
    });
  });

  it("leaves T_quiet at the six-hour default while fewer than fourteen days are answered", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await setStartsOn(seed, "2026-09-17");
    for (const date of ["2026-09-17", "2026-09-18", "2026-09-19"] as const) {
      await seedMorning(seed, { date, answeredAt: "11:00", summary: `Day ${date}` });
    }
    h.clock.set(at("2026-09-20", "18:00"));

    await draftWeeklyRead(h.deps, seed.member.id, "2026-09-20");

    expect(await memberRow(seed.member.id)).toMatchObject({
      quietAfterMin: 360,
      answerStats: { median_latency_min: 180, sunday_median_min: null, n_days: 3 },
    });
  });

  it("drafts nothing for a family whose deletion was requested", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await setStartsOn(seed, "2026-09-14");
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    h.clock.set(at("2026-09-20", "18:00"));

    await draftWeeklyRead(h.deps, seed.member.id, "2026-09-20");

    expect(await h.db.select().from(weeklyReads)).toHaveLength(0);
    expect(h.ai.calls).toHaveLength(0);
  });
});

describe("rollupMetrics", () => {
  it("writes her local yesterday's row from that day's exchange, and refreshes it on a second run", async () => {
    // Consented on the 13th, so the 14th is her first morning; the nightly run is early on the 15th.
    const seed = await seedFamily(h.db, { now: at("2026-09-13", "08:00") });
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
    });
    const exchange = await seedMorning(seed, {
      date: "2026-09-14",
      answeredAt: "09:05",
      kind: "chip",
      summary: "Fine",
    });
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2001:later",
      payload: { text: "And the garden is lovely" },
      receivedAt: at("2026-09-14", "09:10"),
    });
    await h.db.insert(replies).values(
      [true, false].map((toRecipient) => ({
        exchangeId: exchange.id,
        memberId: sam.member.id,
        kind: "text" as const,
        text: "Lovely",
        channel: "telegram" as const,
        externalId: `-100500:${toRecipient ? 1 : 2}`,
        toRecipient,
      })),
    );
    await h.db.insert(quietEvents).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      openedAt: at("2026-09-14", "14:00"),
      lastNotifiedAt: at("2026-09-14", "14:00"),
      notifyCount: 1,
      notifiedMemberIds: [seed.organiser.id],
      resolvedAt: at("2026-09-14", "15:00"),
      outcome: "answered_late",
    });
    await h.db.insert(awayPeriods).values({
      memberId: seed.member.id,
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
      source: "organiser",
      setBy: seed.organiser.id,
    });
    // A second family whose light starts tomorrow has no yesterday to count yet.
    await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    h.clock.set(at("2026-09-15", "02:00"));

    expect(await rollupMetrics(h.deps)).toBe(1);

    const rows = await h.db.select().from(metricsDaily);
    expect(rows).toEqual([
      {
        day: "2026-09-14",
        familyId: seed.family.id,
        memberId: seed.member.id,
        delivered: 1,
        answered: 1,
        answerKind: { chip: 1, text: 1 },
        latencyMin: 65,
        replies: 1,
        readBack: false,
        quietNotice: true,
        quietOutcome: "answered_late",
        away: true,
        quietDay: false,
      },
    ]);

    await h.db
      .update(exchanges)
      .set({ readBackAt: h.clock.now() })
      .where(eq(exchanges.id, exchange.id));
    expect(await rollupMetrics(h.deps)).toBe(1);

    const [refreshed] = await h.db.select().from(metricsDaily);
    expect(await h.db.select().from(metricsDaily)).toHaveLength(1);
    expect(refreshed?.readBack).toBe(true);
  });
});

describe("applyRetention", () => {
  const RULES = [
    "families_deleted",
    "family_media_deleted",
    "media_deleted",
    "members_deleted",
    "invited_members_deleted",
    "exchanges_cleared",
    "outbound_payloads_cleared",
    "chips_deleted",
    "translations_deleted",
    "replies_cleared",
    "answers_cleared",
    "suggestions_cleared",
    "ai_call_outputs_cleared",
    "ask_to_check_replies_cleared",
    "message_refs_deleted",
    "invites_deleted",
    "onboarding_sessions_deleted",
    "events_deleted",
    "metrics_deleted",
    "ai_calls_deleted",
    "outbound_deleted",
    "consents_deleted",
    "deletions_deleted",
  ];

  /** Everything the 30-day clearing touches, dated `age` days ago, around one delivered exchange. */
  async function seedAged(
    seed: SeededFamily,
    sam: { member: { id: string } },
    date: LocalDate,
    age: number,
  ): Promise<{ exchange: Exchange; answerId: string; replyId: string }> {
    const when = daysAgo(age);
    const exchange = await seedExchange(h.db, seed, {
      date,
      state: "answered",
      text: `Ask of ${date}`,
      deliveredAt: when,
      answeredAt: when,
    });
    await h.db
      .update(exchanges)
      .set({ options: { vote_options: ["Soup", "Salad"] } })
      .where(eq(exchanges.id, exchange.id));
    await h.db.insert(chips).values({
      exchangeId: exchange.id,
      chips: ["A", "B", "C"],
      promptVersion: "v",
      createdAt: when,
    });
    await h.db.insert(translations).values({
      objectType: "exchange",
      objectId: exchange.id,
      lang: "zh-TW",
      text: "翻譯",
      provider: "claude:v1",
      createdAt: when,
    });
    const [reply] = await h.db
      .insert(replies)
      .values({
        exchangeId: exchange.id,
        memberId: sam.member.id,
        kind: "text",
        text: "Lovely",
        channel: "telegram",
        externalId: `-100500:${date}`,
        createdAt: when,
      })
      .returning({ id: replies.id });
    const [answer] = await h.db
      .insert(answers)
      .values({
        exchangeId: exchange.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        externalId: `2001:${date}`,
        payload: { text: "her words", choice: "Soup" },
        transcript: "her transcript",
        summary: "her summary",
        moodWords: ["calm"],
        mentions: { people: ["Auntie"] },
        flag: true,
        flagReason: "health:concern",
        understoodAt: when,
        receivedAt: when,
      })
      .returning({ id: answers.id });
    await h.db.insert(suggestions).values({
      familyId: seed.family.id,
      forMemberId: seed.organiser.id,
      aboutMemberId: seed.member.id,
      type: "question",
      text: "Ask about the garden",
      promptVersion: "v",
      createdAt: when,
    });
    await h.db.insert(aiCalls).values({
      familyId: seed.family.id,
      memberId: seed.member.id,
      call: "understand",
      promptVersion: "v",
      model: "m",
      inputRef: { answer_id: answer?.id ?? "" },
      output: { summary: "her summary" },
      ok: true,
      at: when,
    });
    await h.db.insert(quietEvents).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      openedAt: when,
      askToCheck: [{ contact_id: "c1", sent_by: "m1", sent_at: "t", reply: "She is fine" }],
    });
    await h.db.insert(outbound).values({
      memberId: seed.member.id,
      exchangeId: exchange.id,
      kind: "system",
      channel: "telegram",
      conversationId: "2001",
      localDay: date,
      idempotencyKey: `system:2001:${date}`,
      payload: { message: { text: "sent words" } },
      status: "sent",
      attempts: 1,
      queuedAt: when,
      sentAt: when,
    });
    await h.db.insert(awayPeriods).values({
      memberId: seed.member.id,
      fromDate: date,
      toDate: date,
      source: "answer",
      createdAt: when,
    });
    return { exchange, answerId: answer?.id ?? "", replyId: reply?.id ?? "" };
  }

  it("clears the family's words at 30 days, keeps what is younger, and reports every rule in one event", async () => {
    const seed = await seedFamily(h.db, { now: daysAgo(40) });
    const sam = await seedGroupMember(h.db, seed, {
      now: daysAgo(40),
      name: "Sam",
      externalId: "1002",
    });
    const old = await seedAged(seed, sam, "2026-08-10", 31);
    const young = await seedAged(seed, sam, "2026-08-12", 29);

    const counts = await applyRetention(h.deps);

    expect(Object.keys(counts).sort()).toEqual([...RULES].sort());
    expect(counts).toMatchObject({
      exchanges_cleared: 1,
      outbound_payloads_cleared: 1,
      chips_deleted: 1,
      translations_deleted: 1,
      replies_cleared: 1,
      answers_cleared: 1,
      suggestions_cleared: 1,
      ai_call_outputs_cleared: 1,
      ask_to_check_replies_cleared: 1,
      families_deleted: 0,
      media_deleted: 0,
      members_deleted: 0,
    });
    const rows = await h.db.select().from(exchanges).orderBy(asc(exchanges.scheduledFor));
    expect(rows.map((row) => [row.text, row.options])).toEqual([
      [null, null],
      ["Ask of 2026-08-12", { vote_options: ["Soup", "Salad"] }],
    ]);
    expect((await h.db.select().from(chips)).map((row) => row.exchangeId)).toEqual([
      young.exchange.id,
    ]);
    expect((await h.db.select().from(translations)).map((row) => row.objectId)).toEqual([
      young.exchange.id,
    ]);
    const replyRows = await h.db.select().from(replies).orderBy(asc(replies.createdAt));
    expect(replyRows.map((row) => [row.id, row.text])).toEqual([
      [old.replyId, null],
      [young.replyId, "Lovely"],
    ]);
    const answerRows = await h.db.select().from(answers).orderBy(asc(answers.receivedAt));
    expect(answerRows[0]).toMatchObject({
      id: old.answerId,
      payload: { choice: "Soup" },
      transcript: null,
      mentions: {},
      moodWords: [],
      flagReason: null,
      flag: true,
      summary: "her summary",
    });
    expect(answerRows[1]).toMatchObject({
      id: young.answerId,
      payload: { text: "her words", choice: "Soup" },
      transcript: "her transcript",
      mentions: { people: ["Auntie"] },
      moodWords: ["calm"],
      flagReason: "health:concern",
    });
    expect(
      (await h.db.select().from(suggestions).orderBy(asc(suggestions.createdAt))).map(
        (row) => row.text,
      ),
    ).toEqual(["", "Ask about the garden"]);
    expect(
      (await h.db.select().from(aiCalls).orderBy(asc(aiCalls.at))).map((row) => row.output),
    ).toEqual([null, { summary: "her summary" }]);
    expect(
      (await h.db.select().from(quietEvents).orderBy(asc(quietEvents.openedAt))).map(
        (row) => row.askToCheck,
      ),
    ).toEqual([
      [{ contact_id: "c1", sent_by: "m1", sent_at: "t", reply: null }],
      [{ contact_id: "c1", sent_by: "m1", sent_at: "t", reply: "She is fine" }],
    ]);
    expect(
      (await h.db.select().from(outbound).orderBy(asc(outbound.sentAt))).map((row) => row.payload),
    ).toEqual([{}, { message: { text: "sent words" } }]);
    // Away dates are kept while the family uses Vela.
    expect(await h.db.select().from(awayPeriods)).toHaveLength(2);
    const [recorded] = (await eventRows()).filter((event) => event.name === "retention_deleted");
    expect(recorded?.props).toEqual(counts);
  });

  // delivered_at and sent_at stay null on everything that never reached anyone, and a NULL
  // comparison is never true, so these rows would keep their words until the 24-month sweep, which
  // exchanges do not even have. The promise is 30 days, whether or not the message went out.
  it("clears the ask of a morning that never reached her and the payload of a message that never sent", async () => {
    const seed = await seedFamily(h.db, { now: daysAgo(40) });
    const failed = await seedExchange(h.db, seed, {
      date: "2026-08-10",
      state: "scheduled",
      text: "Did the plumber come?",
      createdAt: daysAgo(32),
    });
    await h.db
      .update(exchanges)
      .set({ deliveryFailedAt: daysAgo(32) })
      .where(eq(exchanges.id, failed.id));
    // A whenever ask nobody ever scheduled: composed, with no date and no delivery.
    const [whenever] = await h.db
      .insert(exchanges)
      .values({
        familyId: seed.family.id,
        recipientId: seed.member.id,
        askerId: seed.organiser.id,
        type: "question",
        state: "composed",
        text: "Whatever happened to the cat?",
        whenRule: "whenever",
        createdAt: daysAgo(31),
      })
      .returning({ id: exchanges.id });
    const young = await seedExchange(h.db, seed, {
      date: "2026-08-12",
      state: "scheduled",
      text: "Still warm there?",
      createdAt: daysAgo(29),
    });
    const payload = { message: { text: "Nearby: Anna +886912000001" } };
    await h.db.insert(outbound).values(
      (
        [
          ["failed", daysAgo(32)],
          ["dropped", daysAgo(31)],
          ["queued", daysAgo(29)],
        ] as const
      ).map(([status, queuedAt], index) => ({
        memberId: seed.organiser.id,
        kind: "quiet_notice" as const,
        channel: "telegram" as const,
        conversationId: "1001",
        localDay: "2026-08-10",
        idempotencyKey: `quiet_notice:${index}`,
        payload,
        status,
        queuedAt,
      })),
    );

    const counts = await applyRetention(h.deps);

    expect(counts).toMatchObject({ exchanges_cleared: 2, outbound_payloads_cleared: 2 });
    const rows = await h.db.select().from(exchanges).orderBy(asc(exchanges.createdAt));
    expect(rows.map((row) => [row.id, row.text])).toEqual([
      [failed.id, null],
      [whenever?.id, null],
      [young.id, "Still warm there?"],
    ]);
    expect(
      (await h.db.select().from(outbound).orderBy(asc(outbound.queuedAt))).map((row) => [
        row.status,
        row.payload,
      ]),
    ).toEqual([
      ["failed", {}],
      ["dropped", {}],
      ["queued", payload],
    ]);
  });

  it("deletes message refs at 30 days, invites 30 days after expiry or acceptance, and expired onboarding sessions", async () => {
    const seed = await seedFamily(h.db, { now: daysAgo(40) });
    const exchange = await seedExchange(h.db, seed, { date: "2026-08-10", state: "delivered" });
    await h.db.insert(messageRefs).values(
      [31, 29].map((age) => ({
        channel: "telegram" as const,
        conversationId: "2001",
        messageId: `ref-${age}`,
        familyId: seed.family.id,
        exchangeId: exchange.id,
        purpose: "arrival" as const,
        createdAt: daysAgo(age),
      })),
    );
    await h.db.insert(invites).values(
      [
        { token: "expired-long-ago", expiresAt: daysAgo(31), acceptedAt: null },
        { token: "accepted-long-ago", expiresAt: daysAgo(1), acceptedAt: daysAgo(31) },
        { token: "expired-lately", expiresAt: daysAgo(29), acceptedAt: null },
        { token: "accepted-lately", expiresAt: daysAgo(1), acceptedAt: daysAgo(29) },
        { token: "still-open", expiresAt: daysAgo(-5), acceptedAt: null },
      ].map((invite) => ({
        familyId: seed.family.id,
        invitedBy: seed.organiser.id,
        forMemberId: seed.member.id,
        token: invite.token,
        createdAt: daysAgo(35),
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
      })),
    );
    await h.db.insert(onboardingSessions).values(
      [1, -1].map((age) => ({
        channel: "telegram" as const,
        conversationId: `500${age + 2}`,
        externalUserId: `500${age + 2}`,
        step: "name",
        expiresAt: daysAgo(age),
      })),
    );

    const counts = await applyRetention(h.deps);

    expect(counts).toMatchObject({
      message_refs_deleted: 1,
      invites_deleted: 2,
      onboarding_sessions_deleted: 1,
    });
    expect((await h.db.select().from(messageRefs)).map((row) => row.messageId)).toEqual(["ref-29"]);
    expect((await h.db.select().from(invites)).map((row) => row.token).sort()).toEqual([
      "accepted-lately",
      "expired-lately",
      "still-open",
    ]);
    expect((await h.db.select().from(onboardingSessions)).map((row) => row.conversationId)).toEqual(
      ["5001"],
    );
  });

  it("deletes expired media with its object and a proof, takes the id out of the exchange, and keeps the rest", async () => {
    const seed = await seedFamily(h.db, { now: daysAgo(40) });
    const storedKey = `families/${seed.family.id}/answers/a.ogg`;
    await h.media.put(storedKey, new ArrayBuffer(3), "audio/ogg");
    const [expired, kept, fresh, unstored] = await h.db
      .insert(media)
      .values([
        {
          familyId: seed.family.id,
          kind: "audio",
          storageKey: storedKey,
          channel: "telegram",
          providerFileId: "file-a",
          providerUniqueId: "u-a",
          expiresAt: daysAgo(1),
        },
        {
          familyId: seed.family.id,
          kind: "image",
          channel: "telegram",
          providerFileId: "file-b",
          providerUniqueId: "u-b",
          kept: true,
          expiresAt: daysAgo(1),
        },
        {
          familyId: seed.family.id,
          kind: "image",
          channel: "telegram",
          providerFileId: "file-c",
          providerUniqueId: "u-c",
          expiresAt: daysAgo(-1),
        },
        {
          familyId: seed.family.id,
          kind: "image",
          channel: "telegram",
          providerFileId: "file-d",
          providerUniqueId: "u-d",
          expiresAt: daysAgo(2),
        },
      ])
      .returning({ id: media.id });
    if (
      expired === undefined ||
      kept === undefined ||
      fresh === undefined ||
      unstored === undefined
    ) {
      throw new Error("media not inserted");
    }
    const exchange = await seedExchange(h.db, seed, {
      date: "2026-09-13",
      type: "photo_choice",
      state: "delivered",
      deliveredAt: daysAgo(1),
    });
    await h.db
      .update(exchanges)
      .set({
        mediaIds: [expired.id, kept.id, unstored.id],
        options: { photo_ids: [expired.id, kept.id], caption: "Which one?" },
      })
      .where(eq(exchanges.id, exchange.id));
    const [answer] = await h.db
      .insert(answers)
      .values({
        exchangeId: exchange.id,
        memberId: seed.member.id,
        kind: "voice",
        channel: "telegram",
        externalId: "2001:1",
        mediaId: expired.id,
        receivedAt: daysAgo(1),
      })
      .returning({ id: answers.id });

    const counts = await applyRetention(h.deps);

    expect(counts).toMatchObject({ media_deleted: 2, families_deleted: 0 });
    expect((await h.db.select().from(media)).map((row) => row.id).sort()).toEqual(
      [kept.id, fresh.id].sort(),
    );
    expect(h.media.objects.has(storedKey)).toBe(false);
    const proofs = await h.db.select().from(deletions).orderBy(asc(deletions.deletedAt));
    expect(
      proofs.map((row) => [row.objectType, row.objectId, row.contentHash, row.reason]).sort(),
    ).toEqual(
      [
        ["media", expired.id, sha256(`media:${expired.id}`), "expired"],
        ["media", unstored.id, sha256(`media:${unstored.id}`), "expired"],
      ].sort(),
    );
    // L4: a storage key or a provider file id has so few possible values that its hash gives it back.
    for (const proof of proofs) {
      expect([sha256(storedKey), sha256("file-d")]).not.toContain(proof.contentHash);
    }
    const [after] = await h.db.select().from(exchanges).where(eq(exchanges.id, exchange.id));
    expect(after?.mediaIds).toEqual([kept.id]);
    expect(after?.options).toEqual({ photo_ids: [kept.id], caption: "Which one?" });
    const [answerAfter] = await h.db
      .select()
      .from(answers)
      .where(eq(answers.id, answer?.id ?? ""));
    expect(answerAfter?.mediaId).toBeNull();
  });

  // Decision M (2026-09-20): with media storage off a row carries no storage key and there is no
  // object to delete, and the 30-day rule still takes the row and writes its proof, so what the
  // privacy notice promises about deletion is unchanged.
  it("deletes expired media with its proof while media storage is off", async () => {
    const seed = await seedFamily(h.db, { now: daysAgo(40) });
    const [expired] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        kind: "audio",
        channel: "telegram",
        providerFileId: "file-off",
        providerUniqueId: "u-off",
        expiresAt: daysAgo(1),
      })
      .returning({ id: media.id });
    if (expired === undefined) {
      throw new Error("media not inserted");
    }

    const counts = await applyRetention({ ...h.deps, media: null });

    expect(counts).toMatchObject({ media_deleted: 1 });
    expect(await h.db.select().from(media)).toEqual([]);
    expect(
      (await h.db.select().from(deletions)).map((row) => [
        row.objectType,
        row.objectId,
        row.contentHash,
        row.reason,
      ]),
    ).toEqual([["media", expired.id, sha256(`media:${expired.id}`), "expired"]]);
  });

  // An object stored before storage was switched off outlives its row, and only the founder can
  // reach it, so the run names it rather than leaving it unsaid.
  it("names the object it cannot reach when media storage is off and the row was stored", async () => {
    const seed = await seedFamily(h.db, { now: daysAgo(40) });
    const storedKey = `families/${seed.family.id}/answers/left.ogg`;
    await h.media.put(storedKey, new ArrayBuffer(3), "audio/ogg");
    const [expired] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        kind: "audio",
        storageKey: storedKey,
        channel: "telegram",
        providerFileId: "file-left",
        providerUniqueId: "u-left",
        expiresAt: daysAgo(1),
      })
      .returning({ id: media.id });

    const counts = await applyRetention({ ...h.deps, media: null });

    expect(counts).toMatchObject({ media_deleted: 1 });
    expect(await h.db.select().from(media)).toEqual([]);
    expect(h.logger.entries.filter((entry) => entry.event === "media_object_unreachable")).toEqual([
      {
        level: "error",
        event: "media_object_unreachable",
        fields: { mediaId: expired?.id, reason: "expired" },
      },
    ]);
    // Only the founder can delete it, so it is still there: nothing pretended otherwise.
    expect(h.media.objects.has(storedKey)).toBe(true);
  });

  it("deletes members 30 days after they left and keeps what only credits them", async () => {
    const seed = await seedFamily(h.db, { now: daysAgo(60) });
    const sam = await seedGroupMember(h.db, seed, {
      now: daysAgo(60),
      name: "Sam",
      externalId: "1002",
    });
    const lee = await seedGroupMember(h.db, seed, {
      now: daysAgo(60),
      name: "Lee",
      externalId: "1003",
    });
    await h.db
      .update(members)
      .set({ status: "left", leftAt: daysAgo(31), turnsIn: false })
      .where(eq(members.id, sam.member.id));
    await h.db
      .update(members)
      .set({ status: "left", leftAt: daysAgo(29), turnsIn: false })
      .where(eq(members.id, lee.member.id));
    const asked = await seedExchange(h.db, seed, {
      date: "2026-09-13",
      state: "delivered",
      askerId: sam.member.id,
      deliveredAt: daysAgo(1),
    });
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: "2026-09-13",
      recipientId: seed.member.id,
      holderId: sam.member.id,
    });
    await h.db.insert(invites).values({
      familyId: seed.family.id,
      invitedBy: sam.member.id,
      token: "sams-invite",
      createdAt: daysAgo(1),
      expiresAt: daysAgo(-6),
    });
    const params = { name: "Mom", notice: "https://vela.test/privacy/en" };
    await h.db.insert(consents).values({
      memberId: sam.member.id,
      subjectRef: `member:${sam.member.id}`,
      kind: "privacy_notice",
      answer: "yes",
      textVersion: "privacy-notice.v1",
      lang: "en",
      channel: "telegram",
      givenAt: daysAgo(40),
      evidence: { chat_id: "-100500", message_id: "7", params, text_sha256: "a".repeat(64) },
    });

    const counts = await applyRetention(h.deps);

    expect(counts).toMatchObject({ members_deleted: 1 });
    const [proof] = await h.db.select().from(consents).where(eq(consents.kind, "privacy_notice"));
    expect(proof).toMatchObject({
      memberId: null,
      subjectRef: `member:${sam.member.id}`,
      subjectDeletedAt: h.clock.now(),
      evidence: { chat_id: "-100500", message_id: "7", text_sha256: "a".repeat(64) },
    });
    expect((await h.db.select().from(members)).map((row) => row.displayName).sort()).toEqual([
      "Lee",
      "Mia",
      "Mom",
    ]);
    const [exchange] = await h.db.select().from(exchanges).where(eq(exchanges.id, asked.id));
    expect(exchange?.askerId).toBeNull();
    const [turn] = await h.db.select().from(turns);
    expect(turn?.holderId).toBeNull();
    expect(await h.db.select().from(invites)).toHaveLength(0);
    expect(h.scheduler.history).toHaveLength(0);
  });

  it("deletes a family whose deletion was requested, its media first, and clears her scheduler", async () => {
    const doomed = await seedFamily(h.db, { now: daysAgo(10), familyName: "The Lins" });
    const staying = await seedFamily(h.db, {
      now: daysAgo(10),
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const key = `families/${doomed.family.id}/answers/x.ogg`;
    await h.media.put(key, new ArrayBuffer(3), "audio/ogg");
    const [file] = await h.db
      .insert(media)
      .values({
        familyId: doomed.family.id,
        kind: "audio",
        storageKey: key,
        channel: "telegram",
        providerFileId: "file-x",
        providerUniqueId: "u-x",
        expiresAt: daysAgo(-20),
      })
      .returning({ id: media.id });
    await seedExchange(h.db, doomed, { date: "2026-09-13", state: "delivered" });
    const contact = await seedNearbyContact(h.db, doomed, {
      now: daysAgo(10),
      name: "Anna",
      answer: { yes: { phone: "+886912000001" } },
    });
    await h.db.insert(consents).values({
      contactId: contact.id,
      subjectRef: `contact:${contact.id}`,
      kind: "nearby",
      answer: "yes",
      textVersion: "nearby-contact-consent.en@1",
      lang: "en",
      channel: "line",
      givenAt: daysAgo(10),
      evidence: { note: "Anna said yes", recorded_by: "founder" },
    });
    await h.db
      .update(families)
      .set({ deletedAt: new Date(h.clock.now().getTime() - 12 * 3_600_000) })
      .where(eq(families.id, doomed.family.id));

    const counts = await applyRetention(h.deps);

    // Their consent rows outlive the family, forgotten: ids, answers, and hashes, no words or names.
    const proofs = await h.db
      .select()
      .from(consents)
      .where(inArray(consents.subjectRef, [`member:${doomed.member.id}`, `contact:${contact.id}`]))
      .orderBy(asc(consents.kind));
    expect(
      proofs.map((row) => [
        row.kind,
        row.memberId,
        row.contactId,
        row.subjectDeletedAt,
        row.evidence,
      ]),
    ).toEqual([
      ["light", null, null, h.clock.now(), { chat_id: "2001", message_id: "1" }],
      ["nearby", null, null, h.clock.now(), { recorded_by: "founder" }],
    ]);
    expect(
      await h.db.select().from(consents).where(eq(consents.memberId, staying.member.id)),
    ).toHaveLength(1);
    expect(counts).toMatchObject({
      families_deleted: 1,
      family_media_deleted: 1,
      media_deleted: 0,
    });
    expect((await h.db.select().from(families)).map((row) => row.id)).toEqual([staying.family.id]);
    expect((await h.db.select().from(members)).map((row) => row.familyId)).toEqual([
      staying.family.id,
      staying.family.id,
    ]);
    expect(await h.db.select().from(media)).toHaveLength(0);
    expect(h.media.objects.has(key)).toBe(false);
    const deleted = await h.db.select().from(deletions);
    expect(deleted.map((row) => [row.objectId, row.reason, row.contentHash])).toEqual([
      [file?.id ?? "", "family_deleted", sha256(`media:${file?.id}`)],
    ]);
    expect(h.scheduler.history).toEqual([{ memberId: doomed.member.id, at: null }]);
  });

  it("deletes an invited member who never answered 30 days after her last invite expired, and keeps her invites until then", async () => {
    const make = async (name: string, externalId: string, expiredDaysAgo: number[]) => {
      const seed = await seedFamily(h.db, {
        now: daysAgo(60),
        familyName: name,
        organiserExternalId: `1${externalId}`,
        memberExternalId: externalId,
      });
      await h.db.delete(consents).where(eq(consents.memberId, seed.member.id));
      await h.db
        .update(members)
        .set({ status: "invited", lightOn: false, lightConsentedAt: null, lightConsentText: null })
        .where(eq(members.id, seed.member.id));
      await h.db.insert(invites).values(
        expiredDaysAgo.map((age, index) => ({
          familyId: seed.family.id,
          invitedBy: seed.organiser.id,
          forMemberId: seed.member.id,
          token: `${externalId}-${index}`,
          createdAt: daysAgo(age + 7),
          expiresAt: daysAgo(age),
          // She opened the first link and never tapped: accepted long ago, still unanswered.
          acceptedAt: index === 0 ? daysAgo(age + 6) : null,
        })),
      );
      return seed;
    };
    const gone = await make("The Lins", "2101", [45, 31]);
    const waiting = await make("The Wus", "2201", [45, 29]);
    const contact = await seedNearbyContact(h.db, gone, {
      now: daysAgo(50),
      name: "Anna",
      answer: null,
    });
    await h.db.insert(consents).values({
      contactId: contact.id,
      subjectRef: `contact:${contact.id}`,
      kind: "nearby",
      answer: "no",
      textVersion: "nearby-contact-consent.en@1",
      lang: "en",
      channel: "line",
      givenAt: daysAgo(50),
      evidence: { note: "Anna said no", recorded_by: "founder" },
    });

    const counts = await applyRetention(h.deps);

    expect(counts).toMatchObject({ invited_members_deleted: 1, members_deleted: 0 });
    expect(await memberRow(gone.member.id)).toBeUndefined();
    expect(await memberRow(waiting.member.id)).toMatchObject({ status: "invited" });
    expect((await h.db.select().from(invites)).map((row) => row.token).sort()).toEqual([
      "2201-0",
      "2201-1",
    ]);
    expect(await h.db.select().from(nearbyContacts)).toEqual([]);
    const [proof] = await h.db.select().from(consents).where(eq(consents.contactId, contact.id));
    expect(proof).toBeUndefined();
    const [forgotten] = await h.db
      .select()
      .from(consents)
      .where(eq(consents.subjectRef, `contact:${contact.id}`));
    expect(forgotten).toMatchObject({
      contactId: null,
      answer: "no",
      subjectDeletedAt: h.clock.now(),
      evidence: { recorded_by: "founder" },
    });
    expect(h.scheduler.history).toHaveLength(0);
  });

  it("deletes consents that no longer permit anything and deletion proofs after 5 years, and never a standing yes", async () => {
    const seed = await seedFamily(h.db, { now: yearsAgo(7) });
    const justPast = new Date(yearsAgo(5).getTime() - 60_000);
    const justInside = new Date(yearsAgo(5).getTime() + 60_000);
    const subject = `member:${seed.member.id}`;
    const base = {
      subjectRef: subject,
      textVersion: "v",
      lang: "en",
      channel: "telegram",
    } as const;
    await h.db.insert(consents).values([
      // A standing yes of a member who still exists, however old.
      { ...base, memberId: seed.member.id, kind: "pilot", answer: "yes", givenAt: yearsAgo(7) },
      { ...base, memberId: seed.member.id, kind: "health_words", answer: "no", givenAt: justPast },
      {
        ...base,
        memberId: seed.member.id,
        kind: "privacy_notice",
        answer: "no",
        givenAt: justInside,
      },
      // Withdrawn: counted from the withdrawal, not from the yes.
      {
        ...base,
        memberId: seed.member.id,
        kind: "privacy_notice",
        answer: "yes",
        givenAt: yearsAgo(7),
        withdrawnAt: justPast,
        textVersion: "withdrawn-past",
      },
      {
        ...base,
        memberId: seed.member.id,
        kind: "privacy_notice",
        answer: "yes",
        givenAt: yearsAgo(7),
        withdrawnAt: justInside,
        textVersion: "withdrawn-inside",
      },
      // Forgotten: counted from when the subject was deleted.
      {
        subjectRef: "member:01990000-0000-7000-8000-000000000001",
        kind: "light",
        answer: "yes",
        textVersion: "forgotten-past",
        lang: "en",
        channel: "telegram",
        givenAt: yearsAgo(7),
        subjectDeletedAt: justPast,
      },
      {
        subjectRef: "member:01990000-0000-7000-8000-000000000002",
        kind: "light",
        answer: "yes",
        textVersion: "forgotten-inside",
        lang: "en",
        channel: "telegram",
        givenAt: yearsAgo(7),
        subjectDeletedAt: justInside,
      },
    ]);
    const deletedIds = [
      "01990000-0000-7000-8000-00000000000a",
      "01990000-0000-7000-8000-00000000000b",
    ];
    await h.db.insert(deletions).values([
      {
        objectType: "media",
        objectId: deletedIds[0] ?? "",
        contentHash: sha256(`media:${deletedIds[0]}`),
        reason: "expired",
        deletedAt: justPast,
      },
      {
        objectType: "media",
        objectId: deletedIds[1] ?? "",
        contentHash: sha256(`media:${deletedIds[1]}`),
        reason: "expired",
        deletedAt: justInside,
      },
    ]);

    const counts = await applyRetention(h.deps);

    expect(counts).toMatchObject({ consents_deleted: 3, deletions_deleted: 1 });
    const kept = await h.db
      .select()
      .from(consents)
      .orderBy(asc(consents.givenAt), asc(consents.textVersion));
    expect(kept.map((row) => [row.kind, row.answer, row.textVersion]).sort()).toEqual(
      [
        ["forgotten-inside"],
        ["light", "yes", "consent.request@2"],
        ["pilot", "yes", "v"],
        ["privacy_notice", "no", "v"],
        ["privacy_notice", "yes", "withdrawn-inside"],
      ]
        .map((row) => (row.length === 1 ? ["light", "yes", row[0]] : row))
        .sort(),
    );
    expect((await h.db.select().from(deletions)).map((row) => row.objectId)).toEqual([
      deletedIds[1],
    ]);
  });

  it("deletes events, daily metrics, AI calls, and outbound rows after 24 months", async () => {
    const seed = await seedFamily(h.db, { now: monthsAgo(30) });
    for (const age of [25, 23]) {
      const when = monthsAgo(age);
      await h.db
        .insert(events)
        .values({ at: when, name: "scheduler_tick", familyId: seed.family.id, props: {} });
      await h.db.insert(metricsDaily).values({
        day: localDateOf(when, "UTC"),
        familyId: seed.family.id,
        memberId: seed.member.id,
      });
      await h.db.insert(aiCalls).values({
        familyId: seed.family.id,
        call: "hello",
        promptVersion: "v",
        model: "m",
        inputRef: {},
        ok: true,
        at: when,
      });
      await h.db.insert(outbound).values({
        memberId: seed.member.id,
        kind: "system",
        channel: "telegram",
        conversationId: "2001",
        localDay: localDateOf(when, TZ),
        idempotencyKey: `system:2001:${age}`,
        payload: {},
        status: "sent",
        attempts: 1,
        queuedAt: when,
        sentAt: when,
      });
    }

    const counts = await applyRetention(h.deps);

    expect(counts).toMatchObject({
      events_deleted: 1,
      metrics_deleted: 1,
      ai_calls_deleted: 1,
      outbound_deleted: 1,
    });
    expect((await eventRows()).map((event) => event.name)).toEqual([
      "scheduler_tick",
      "retention_deleted",
    ]);
    expect((await h.db.select().from(metricsDaily)).map((row) => row.day)).toEqual([
      localDateOf(monthsAgo(23), "UTC"),
    ]);
    expect((await h.db.select().from(aiCalls)).map((row) => row.at)).toEqual([monthsAgo(23)]);
    expect((await h.db.select().from(outbound)).map((row) => row.queuedAt)).toEqual([
      monthsAgo(23),
    ]);
  });
});
