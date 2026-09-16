import { createFakeAi, fakeRecord, SAFE_DEFAULTS } from "@vela/ai";
import type { LocalDate, LocalTime, OutboundKind } from "@vela/contracts";
import { addMinutes, outboundKey, zonedInstant } from "@vela/core";
import {
  answers,
  awayPeriods,
  type Exchange,
  events,
  exchanges,
  families,
  media,
  members,
  outbound,
  quietEvents,
  turns,
  weeklyReads,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverOutbound } from "./gateway.ts";
import { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness, type JobHandlers } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
} from "./testing/seed.ts";
import { FAILURE_NOTE_AFTER_HOURS, loadScheduleInput, reconcile, tickMember } from "./tick.ts";

const TZ = "Asia/Taipei";
const HER_CHAT = "2001";
const ORGANISER_CHAT = "1001";
const GROUP = "-100500";
const ADMIN_CHAT = "9001";

let h: Harness;
/** What the fake `flag` does on each call, oldest first; an empty plan raises nothing. */
const flagPlan: ("fail" | "raise" | "clear")[] = [];

beforeAll(async () => {
  h = await createHarness({
    ai: {
      flag: async (input) => {
        const step = flagPlan.shift() ?? "clear";
        if (step === "fail") {
          return {
            ok: false,
            value: SAFE_DEFAULTS.flag(input),
            record: fakeRecord("flag", "http_529"),
            error: "http_529",
          };
        }
        if (step === "raise") {
          return {
            ok: true,
            value: { flag: true, category: "health", severity: "concern", evidenceQuote: "unwell" },
            record: fakeRecord("flag"),
          };
        }
        return { ok: true, value: SAFE_DEFAULTS.flag(input), record: fakeRecord("flag") };
      },
    },
  });
}, 60_000);

beforeEach(async () => {
  flagPlan.length = 0;
  await h.reset();
});

afterAll(async () => {
  await h.close();
});

function at(date: LocalDate, time: LocalTime): Date {
  return zonedInstant(date, time, TZ);
}

function handlers(): JobHandlers {
  return {
    outbound: (job) => deliverOutbound(h.deps, job.outboundId),
    understand: (job) => understandAnswer(h.deps, job.answerId),
  };
}

async function nextWake(memberId: string): Promise<Date | null> {
  const [row] = await h.db
    .select({ at: members.nextWakeAt })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.at ?? null;
}

/**
 * Runs the jobs due now and, while a send has asked her scheduler to look again at once (the
 * gateway wakes it at the send time), ticks again, as the Durable Object alarm would.
 */
async function settle(memberId: string): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await h.runDue(handlers());
    const wake = h.scheduler.wakes.get(memberId) ?? null;
    if (wake === null || wake.getTime() > h.clock.now().getTime()) {
      return;
    }
    await tickMember(h.deps, memberId);
  }
  throw new Error("her scheduler never settled");
}

/** Moves the clock to `target`, firing every scheduler wake on the way. */
async function advanceTo(memberId: string, target: Date): Promise<void> {
  for (let fired = 0; fired < 100; fired += 1) {
    const wake = h.scheduler.wakes.get(memberId) ?? null;
    if (wake === null || wake.getTime() > target.getTime()) {
      h.clock.set(target);
      return;
    }
    h.clock.set(wake);
    await tickMember(h.deps, memberId);
    await settle(memberId);
  }
  throw new Error("too many wakes on the way");
}

async function exchangeOn(memberId: string, date: LocalDate): Promise<Exchange> {
  const rows = await h.db.select().from(exchanges).where(eq(exchanges.recipientId, memberId));
  const row = rows.find((exchange) => exchange.scheduledFor === date);
  if (row === undefined) {
    throw new Error(`no exchange on ${date}`);
  }
  return row;
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

function texts(conversationId: string): string[] {
  return h.telegram.sentTo(conversationId).map((sent) => sent.message.text);
}

interface AnswerSeed {
  exchangeId: string;
  kind: "text" | "voice";
  externalId: string;
  minutesAgo: number;
  transcript?: string | null;
  mediaId?: string | null;
  attempts?: number;
  understood?: boolean;
}

async function seedAnswer(seed: SeededFamily, input: AnswerSeed): Promise<string> {
  const receivedAt = addMinutes(h.clock.now(), -input.minutesAgo);
  const [row] = await h.db
    .insert(answers)
    .values({
      exchangeId: input.exchangeId,
      memberId: seed.member.id,
      kind: input.kind,
      channel: "telegram",
      externalId: `${HER_CHAT}:${input.externalId}`,
      payload: input.kind === "text" ? { text: "I feel unwell today" } : {},
      mediaId: input.mediaId ?? null,
      transcript: input.transcript ?? null,
      processingAttempts: input.attempts ?? 0,
      understoodAt: input.understood === true ? receivedAt : null,
      receivedAt,
    })
    .returning({ id: answers.id });
  if (row === undefined) {
    throw new Error("answer not inserted");
  }
  return row.id;
}

async function answerRow(id: string) {
  const [row] = await h.db.select().from(answers).where(eq(answers.id, id));
  if (row === undefined) {
    throw new Error("answer vanished");
  }
  return row;
}

describe("loadScheduleInput", () => {
  it("maps her state to the schedule's input exactly", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const her = seed.member.id;
    const yesterday = await seedExchange(h.db, seed, {
      date: "2026-09-13",
      state: "answered",
      deliveredAt: at("2026-09-13", "08:00"),
      answeredAt: at("2026-09-13", "10:00"),
    });
    await h.db
      .update(exchanges)
      .set({ repeatedAt: at("2026-09-13", "10:30") })
      .where(eq(exchanges.id, yesterday.id));
    await h.db.insert(quietEvents).values({
      exchangeId: yesterday.id,
      memberId: her,
      openedAt: at("2026-09-13", "14:00"),
      lastNotifiedAt: at("2026-09-13", "16:00"),
      waitUntil: at("2026-09-13", "18:00"),
      resolvedAt: at("2026-09-13", "16:30"),
      outcome: "answered_late",
      notifyCount: 1,
      notifiedMemberIds: [seed.organiser.id],
    });
    await seedExchange(h.db, seed, { date: "2026-09-14", state: "scheduled" });
    await seedExchange(h.db, seed, { date: "2026-09-15", state: "composed" });
    // Two answers attached to yesterday's exchange: one before its recorded answer time, one this
    // morning before today's arrival, which counts for today (flows §3.9).
    await h.db.insert(answers).values(
      [at("2026-09-13", "09:30"), at("2026-09-14", "07:00")].map((receivedAt, index) => ({
        exchangeId: yesterday.id,
        memberId: her,
        kind: "text" as const,
        channel: "telegram" as const,
        externalId: `${HER_CHAT}:${index + 1}`,
        payload: { text: "Fine" },
        receivedAt,
      })),
    );
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: "2026-09-15",
      recipientId: her,
      holderId: seed.organiser.id,
    });
    await h.db.insert(awayPeriods).values([
      {
        memberId: her,
        fromDate: "2026-09-15",
        toDate: "2026-09-17",
        source: "organiser",
        setBy: seed.organiser.id,
        createdAt: h.clock.now(),
      },
      {
        memberId: her,
        fromDate: "2026-09-14",
        toDate: null,
        source: "answer",
        createdAt: h.clock.now(),
        endedAt: h.clock.now(),
      },
    ]);
    await h.db.insert(weeklyReads).values({
      familyId: seed.family.id,
      memberId: her,
      weekStart: "2026-09-07",
      lines: [],
      suggestion: "Ask about the garden.",
      stats: {},
      promptVersion: "weekly_read.test",
      createdAt: h.clock.now(),
    });

    const input = await loadScheduleInput(h.deps, her, h.clock.now());

    expect(input).toMatchObject({
      now: h.clock.now(),
      member: {
        timeZone: TZ,
        arrivalTime: "08:00",
        status: "active",
        lightOn: true,
        quietAfterMinutes: 360,
        startsOn: "2026-09-15",
        learningUntil: "2026-09-28",
      },
      family: { turnsEnabled: true },
      days: [
        {
          date: "2026-09-13",
          prepared: true,
          deliveredAt: at("2026-09-13", "08:00"),
          deliveryFailed: false,
          answeredAt: at("2026-09-13", "09:30"),
          repeatSentAt: at("2026-09-13", "10:30"),
          quiet: {
            openedAt: at("2026-09-13", "14:00"),
            lastNotifiedAt: at("2026-09-13", "16:00"),
            waitUntil: at("2026-09-13", "18:00"),
            resolvedAt: at("2026-09-13", "16:30"),
          },
        },
        {
          date: "2026-09-14",
          prepared: true,
          deliveredAt: null,
          deliveryFailed: false,
          answeredAt: at("2026-09-14", "07:00"),
          repeatSentAt: null,
          quiet: null,
        },
      ],
      tomorrow: { prepared: false, turnPromptSent: true, askScheduled: true },
    });
    expect(
      ["2026-09-14", "2026-09-15", "2026-09-17", "2026-09-18"].map((date) => input?.awayOn(date)),
    ).toEqual([false, true, true, false]);
    expect(input?.weeklyReadDoneFor("2026-09-13")).toBe(true);
    expect(input?.weeklyReadDoneFor("2026-09-20")).toBe(false);
  });

  it("is null for a member who does not exist or whose family is being deleted", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    expect(
      await loadScheduleInput(h.deps, "00000000-0000-7000-8000-000000000000", h.clock.now()),
    ).toBeNull();

    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));

    expect(await loadScheduleInput(h.deps, seed.member.id, h.clock.now())).toBeNull();
  });
});

describe("tickMember", () => {
  it("runs her through her first days at the exact times", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    await seedGroupMember(h.db, seed, {
      now: addMinutes(h.clock.now(), 1),
      name: "Sam",
      externalId: "1002",
    });
    const her = seed.member.id;

    // Monday 14 September, 08:00: her light starts tomorrow, so the evening prompt is next.
    expect(await tickMember(h.deps, her)).toEqual(at("2026-09-14", "19:00"));
    expect(await nextWake(her)).toEqual(at("2026-09-14", "19:00"));
    expect(h.scheduler.wakes.get(her)).toEqual(at("2026-09-14", "19:00"));
    expect(await h.db.select().from(outbound)).toHaveLength(0);

    await advanceTo(her, at("2026-09-14", "19:00"));
    const [turn] = await h.db.select().from(turns);
    expect(turn).toMatchObject({
      localDay: "2026-09-15",
      holderId: seed.organiser.id,
      promptedAt: at("2026-09-14", "19:00"),
      promptMessageId: "1",
    });
    expect(texts(GROUP)).toEqual([
      "Tomorrow is Mia's turn with Mom. Reply to this message with a question, a photo, or a voice note.",
    ]);
    expect(await nextWake(her)).toEqual(at("2026-09-14", "22:00"));

    await advanceTo(her, at("2026-09-14", "22:00"));
    expect(await exchangeOn(her, "2026-09-15")).toMatchObject({
      type: "hello",
      state: "scheduled",
    });
    expect(await nextWake(her)).toEqual(at("2026-09-15", "08:00"));

    await advanceTo(her, at("2026-09-15", "08:00"));
    expect(await exchangeOn(her, "2026-09-15")).toMatchObject({
      state: "delivered",
      deliveredAt: at("2026-09-15", "08:00"),
      deliveryLate: false,
    });
    expect(texts(HER_CHAT)).toHaveLength(1);
    expect(await nextWake(her)).toEqual(at("2026-09-15", "10:30"));

    await advanceTo(her, at("2026-09-15", "10:30"));
    expect((await exchangeOn(her, "2026-09-15")).repeatedAt).toEqual(at("2026-09-15", "10:30"));
    expect(texts(HER_CHAT)[1]).toContain("In case you missed it:");
    expect(await nextWake(her)).toEqual(at("2026-09-15", "14:00"));

    await advanceTo(her, at("2026-09-15", "14:00"));
    const [quiet] = await h.db.select().from(quietEvents);
    expect(quiet).toMatchObject({
      openedAt: at("2026-09-15", "14:00"),
      lastNotifiedAt: null,
      notifyCount: 0,
    });
    expect(texts(ORGANISER_CHAT)).toHaveLength(0);
    expect(await nextWake(her)).toEqual(at("2026-09-15", "16:00"));

    await advanceTo(her, at("2026-09-15", "16:00"));
    const [notified] = await h.db.select().from(quietEvents);
    expect(notified).toMatchObject({
      lastNotifiedAt: at("2026-09-15", "16:00"),
      notifyCount: 1,
      notifiedMemberIds: [seed.organiser.id],
    });
    expect(texts(ORGANISER_CHAT)).toEqual([
      "It's been quiet at Mom's today. The morning message went out at 08:00. Nothing worrying is known.",
    ]);
    expect(await nextWake(her)).toEqual(at("2026-09-15", "19:00"));

    await advanceTo(her, at("2026-09-15", "19:00"));
    expect(texts(GROUP)[1]).toContain("Tomorrow is Sam's turn with Mom.");
    expect(await nextWake(her)).toEqual(at("2026-09-15", "22:00"));

    // The week runs on the same way to Sunday evening, when the read is drafted.
    await advanceTo(her, at("2026-09-20", "18:00"));
    const [read] = await h.db.select().from(weeklyReads);
    expect(read).toMatchObject({
      memberId: her,
      weekStart: "2026-09-14",
      stats: {
        counted_days: 6,
        answered_days: 0,
        hello_mornings: 6,
        family_asks: 0,
        usual_time: null,
        drift_min: null,
        topics: [],
        voice_len_drift: null,
      },
    });
    expect(texts(ADMIN_CHAT)).toEqual([
      `Weekly read draft for The Chens is ready: https://vela.test/admin/families/${seed.family.id}`,
    ]);
    expect(await nextWake(her)).toEqual(at("2026-09-20", "19:00"));
    const days = [
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ];
    expect((await outboundRows("arrival")).map((row) => row.localDay)).toEqual(days);
    expect((await outboundRows("repeat")).map((row) => row.localDay)).toEqual(days);
    expect(await h.db.select().from(quietEvents)).toHaveLength(6);
    expect(await outboundRows("quiet_notice")).toHaveLength(6);
  });

  it("produces one arrival when two ticks run at once", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    h.clock.set(at("2026-09-15", "08:00"));

    await Promise.all([tickMember(h.deps, seed.member.id), tickMember(h.deps, seed.member.id)]);
    await h.runDue(handlers());

    expect(await outboundRows("arrival")).toHaveLength(1);
    expect(await h.db.select().from(exchanges)).toHaveLength(1);
    expect(texts(HER_CHAT)).toHaveLength(1);
    expect((await eventRows()).map((event) => event.name)).toEqual([
      "exchange_prepared",
      "arrival_delivered",
    ]);
  });

  it("clears the scheduler for a paused member and for a family being deleted", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));

    expect(await tickMember(h.deps, seed.member.id)).toBeNull();
    expect(h.scheduler.wakes.get(seed.member.id)).toBeNull();
    expect(await nextWake(seed.member.id)).toBeNull();

    await h.db.update(members).set({ status: "active" }).where(eq(members.id, seed.member.id));
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));

    expect(await tickMember(h.deps, seed.member.id)).toBeNull();
    expect(h.scheduler.history.map((entry) => entry.at)).toEqual([null, null]);
  });
});

describe("reconcile", () => {
  it("catches a member whose wake was missed and delivers late with the note exactly once", async () => {
    // Consented yesterday, so her first morning is today, and the 08:00 alarm never fired.
    const seed = await seedFamily(h.db, { now: at("2026-09-13", "08:00") });
    const her = seed.member.id;
    await h.db
      .update(members)
      .set({ nextWakeAt: at("2026-09-14", "08:00") })
      .where(eq(members.id, her));
    h.clock.set(at("2026-09-14", "11:30"));

    expect(await reconcile(h.deps)).toEqual({ ticked: 1, missed: 1, rerun: 0, effects: 0 });

    const missed = (await eventRows()).filter((event) => event.name === "scheduler_missed");
    expect(missed.map((event) => event.props)).toEqual([{ late_minutes: 210 }]);
    await h.runDue(handlers());
    expect(texts(HER_CHAT)).toHaveLength(1);
    expect(texts(HER_CHAT)[0]).toContain("Sorry this is late.");
    expect(await exchangeOn(her, "2026-09-14")).toMatchObject({
      state: "delivered",
      deliveredAt: at("2026-09-14", "11:30"),
      deliveryLate: true,
    });

    // The send asked her scheduler to look again at once; a minute later that is not a missed wake.
    h.clock.set(at("2026-09-14", "11:31"));
    expect(await reconcile(h.deps)).toEqual({ ticked: 0, missed: 0, rerun: 0, effects: 0 });

    // A quarter of an hour later it is, and the tick finds nothing to send again.
    h.clock.set(at("2026-09-14", "11:45"));
    expect(await reconcile(h.deps)).toEqual({ ticked: 1, missed: 1, rerun: 0, effects: 0 });
    await h.runDue(handlers());
    expect(await outboundRows("arrival")).toHaveLength(1);
    expect(texts(HER_CHAT)).toHaveLength(1);
    expect(await nextWake(her)).toEqual(at("2026-09-14", "14:00"));
    expect(h.heartbeat.pings).toBe(3);
  });

  it("ticks a member with no wake at all, and leaves fresh wakes, paused members, and deleted families alone", async () => {
    const fresh = await seedFamily(h.db, { now: h.clock.now() });
    const recent = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    await h.db
      .update(members)
      .set({ nextWakeAt: addMinutes(h.clock.now(), -5) })
      .where(eq(members.id, recent.member.id));
    const paused = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "1201",
      memberExternalId: "2201",
    });
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, paused.member.id));
    const deleted = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "1301",
      memberExternalId: "2301",
    });
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, deleted.family.id));

    expect(await reconcile(h.deps)).toEqual({ ticked: 1, missed: 0, rerun: 0, effects: 0 });

    expect(await nextWake(fresh.member.id)).toEqual(at("2026-09-14", "19:00"));
    expect(await nextWake(recent.member.id)).toEqual(addMinutes(h.clock.now(), -5));
    expect(await nextWake(paused.member.id)).toBeNull();
    expect(await nextWake(deleted.member.id)).toBeNull();
    expect([...h.scheduler.wakes.keys()]).toEqual([fresh.member.id]);
    expect((await eventRows()).map((event) => event.name)).not.toContain("scheduler_missed");
  });

  it("re-enqueues the answers not understood, voice without a transcript to ingestion, and notes the exhausted ones once no attempt can be running", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, {
      date: "2026-09-14",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const base = { exchangeId: exchange.id };
    const [voiceMedia] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        uploadedBy: seed.member.id,
        kind: "audio",
        channel: "telegram",
        providerFileId: "voice-1",
        providerUniqueId: "u-voice-1",
      })
      .returning({ id: media.id });
    const text = await seedAnswer(seed, { ...base, kind: "text", externalId: "1", minutesAgo: 16 });
    const voiceSilent = await seedAnswer(seed, {
      ...base,
      kind: "voice",
      externalId: "2",
      minutesAgo: 16,
      mediaId: voiceMedia?.id ?? null,
    });
    const voiceHeard = await seedAnswer(seed, {
      ...base,
      kind: "voice",
      externalId: "3",
      minutesAgo: 20,
      transcript: "All well here",
    });
    await seedAnswer(seed, { ...base, kind: "text", externalId: "4", minutesAgo: 2 });
    await seedAnswer(seed, { ...base, kind: "text", externalId: "5", minutesAgo: 25 * 60 });
    await seedAnswer(seed, {
      ...base,
      kind: "text",
      externalId: "6",
      minutesAgo: 16,
      understood: true,
    });
    // Spent, but its third attempt may still be running: nothing is said about it yet.
    await seedAnswer(seed, { ...base, kind: "text", externalId: "7", minutesAgo: 16, attempts: 3 });
    // Spent a day and an hour ago, past every re-run: its job must have crashed.
    const exhausted = await seedAnswer(seed, {
      ...base,
      kind: "text",
      externalId: "8",
      minutesAgo: FAILURE_NOTE_AFTER_HOURS * 60 + 1,
      attempts: 3,
    });
    const gone = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const goneExchange = await seedExchange(h.db, gone, {
      date: "2026-09-14",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, gone.family.id));
    await h.db.insert(answers).values({
      exchangeId: goneExchange.id,
      memberId: gone.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2101:1",
      payload: { text: "Hello" },
      receivedAt: addMinutes(h.clock.now(), -16),
    });

    const first = await reconcile(h.deps);

    expect(first.rerun).toBe(3);
    expect(h.queues.understand.pending.map((entry) => entry.job.answerId).sort()).toEqual(
      [text, voiceHeard].sort(),
    );
    expect(h.queues.media.pending.map((entry) => entry.job)).toEqual([
      { type: "ingest_answer_media", answerId: voiceSilent },
    ]);
    const notes = await outboundRows("system");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      idempotencyKey: outboundKey("system", {
        conversationId: ADMIN_CHAT,
        suffix: `understand_failed:${exhausted}`,
      }),
      conversationId: ADMIN_CHAT,
      exchangeId: exchange.id,
    });
    expect(notes[0]?.payload).toMatchObject({
      message: {
        text: `Could not read an answer in The Chens after three tries. Open: https://vela.test/admin/families/${seed.family.id}`,
      },
    });

    h.clock.advanceMinutes(5);
    expect((await reconcile(h.deps)).rerun).toBe(3);
    expect(await outboundRows("system")).toHaveLength(1);
  });

  it("retries a failed understanding after 15 minutes without repeating the transcript post or the flag", async () => {
    flagPlan.push("fail", "raise");
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, {
      date: "2026-09-14",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const answerId = await seedAnswer(seed, {
      exchangeId: exchange.id,
      kind: "voice",
      externalId: "1",
      minutesAgo: 0,
      transcript: "I feel unwell today",
    });
    const transcriptKey = outboundKey("answer_post", {
      exchangeId: exchange.id,
      suffix: `${answerId}:transcript`,
    });

    await understandAnswer(h.deps, answerId);
    await h.runDue(handlers());

    expect(await answerRow(answerId)).toMatchObject({
      understoodAt: null,
      processingAttempts: 1,
      summary: "I feel unwell today",
      flag: false,
    });
    expect((await outboundRows("answer_post")).map((row) => row.idempotencyKey)).toEqual([
      transcriptKey,
    ]);
    expect(await outboundRows("flag")).toHaveLength(0);

    h.clock.advanceMinutes(14);
    expect((await reconcile(h.deps)).rerun).toBe(0);

    h.clock.advanceMinutes(1);
    expect((await reconcile(h.deps)).rerun).toBe(1);
    await h.runDue(handlers());

    expect(await answerRow(answerId)).toMatchObject({
      understoodAt: h.clock.now(),
      processingAttempts: 2,
      flag: true,
      flagReason: "health:concern",
    });
    expect((await outboundRows("answer_post")).map((row) => row.idempotencyKey)).toEqual([
      transcriptKey,
    ]);
    expect((await outboundRows("flag")).map((row) => row.conversationId).sort()).toEqual([
      ORGANISER_CHAT,
      ADMIN_CHAT,
    ]);
    expect(texts(ORGANISER_CHAT)).toEqual(['Mom said something you may want to hear: "unwell"']);
    expect(texts(ADMIN_CHAT)).toEqual([
      `Flag in The Chens. Open: https://vela.test/admin/families/${seed.family.id}`,
    ]);
    expect(texts(GROUP)).toEqual(["Mom (voice): I feel unwell today"]);
    expect((await eventRows()).filter((event) => event.name === "flag_raised")).toHaveLength(1);

    h.clock.advanceMinutes(5);
    expect((await reconcile(h.deps)).rerun).toBe(0);
    expect(await outboundRows("flag")).toHaveLength(2);
    expect(await outboundRows("answer_post")).toHaveLength(1);
    expect(await outboundRows("system")).toHaveLength(0);
  });

  it("stops after the third attempt with one note to the founder and no content", async () => {
    flagPlan.push("fail", "fail", "fail", "fail");
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, {
      date: "2026-09-14",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const answerId = await seedAnswer(seed, {
      exchangeId: exchange.id,
      kind: "voice",
      externalId: "1",
      minutesAgo: 0,
      transcript: "I feel unwell today",
    });

    await understandAnswer(h.deps, answerId);
    await h.runDue(handlers());
    for (const minutes of [15, 1, 1]) {
      h.clock.advanceMinutes(minutes);
      await reconcile(h.deps);
      await h.runDue(handlers());
    }

    expect(await answerRow(answerId)).toMatchObject({ understoodAt: null, processingAttempts: 3 });
    expect(h.queues.understand.pending).toHaveLength(0);
    expect(await outboundRows("answer_post")).toHaveLength(1);
    expect(await outboundRows("flag")).toHaveLength(0);
    const notes = await outboundRows("system");
    expect(notes.map((row) => row.idempotencyKey)).toEqual([
      outboundKey("system", {
        conversationId: ADMIN_CHAT,
        suffix: `understand_failed:${answerId}`,
      }),
    ]);
    expect(texts(ADMIN_CHAT)).toEqual([
      `Could not read an answer in The Chens after three tries. Open: https://vela.test/admin/families/${seed.family.id}`,
    ]);
    expect(texts(ADMIN_CHAT)[0]).not.toContain("unwell");
    expect(await answerRow(answerId)).toMatchObject({ processingAttempts: 3 });
  });

  it("says nothing to the founder while a third ingestion's understanding waits in the queue", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, {
      date: "2026-09-14",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const [voice] = await h.db
      .insert(media)
      .values({
        familyId: seed.family.id,
        uploadedBy: seed.member.id,
        kind: "audio",
        channel: "telegram",
        providerFileId: "voice-1",
        providerUniqueId: "u-voice-1",
        mime: "audio/ogg",
      })
      .returning({ id: media.id });
    h.telegram.mediaFiles.set("voice-1", { body: new Uint8Array([1]).buffer, mime: "audio/ogg" });
    // Two ingestions failed; the re-run 20 minutes in transcribes it on the third.
    const answerId = await seedAnswer(seed, {
      exchangeId: exchange.id,
      kind: "voice",
      externalId: "1",
      minutesAgo: 20,
      mediaId: voice?.id ?? null,
      attempts: 2,
    });
    await ingestAnswerMedia(h.deps, answerId);
    expect(await answerRow(answerId)).toMatchObject({ processingAttempts: 3, understoodAt: null });
    expect(h.queues.understand.pending).toHaveLength(1);

    h.clock.advanceMinutes(5);
    await reconcile(h.deps);

    expect(await outboundRows("system")).toHaveLength(0);
    await h.runDue(handlers());
    expect(await answerRow(answerId)).toMatchObject({
      processingAttempts: 4,
      understoodAt: h.clock.now(),
    });
    h.clock.advanceMinutes(FAILURE_NOTE_AFTER_HOURS * 60);
    await reconcile(h.deps);
    expect(await outboundRows("system")).toHaveLength(0);
  });

  it("says nothing to the founder while a third understanding is still waiting on the model", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, {
      date: "2026-09-14",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const answerId = await seedAnswer(seed, {
      exchangeId: exchange.id,
      kind: "text",
      externalId: "1",
      minutesAgo: 25,
      attempts: 2,
    });
    const notesDuringTheCall: number[] = [];
    const started = h.clock.now();
    h.deps.ai = createFakeAi({
      flag: async (input) => {
        // A reconciliation lands while the provider is still answering.
        h.clock.advanceMinutes(5);
        await reconcile(h.deps);
        notesDuringTheCall.push((await outboundRows("system")).length);
        return { ok: true, value: SAFE_DEFAULTS.flag(input), record: fakeRecord("flag") };
      },
    });

    await understandAnswer(h.deps, answerId);

    expect(notesDuringTheCall).toEqual([0]);
    expect(await answerRow(answerId)).toMatchObject({
      processingAttempts: 3,
      understoodAt: started,
    });
    expect(await outboundRows("system")).toHaveLength(0);
  });
});
