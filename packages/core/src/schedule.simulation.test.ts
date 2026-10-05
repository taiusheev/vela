import type { LocalDate, LocalTime } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { type DayState, type DueAction, decideSchedule, SCHEDULE } from "./schedule.ts";
import { addDays, addMinutes, localDateOf, weekdayOf, zonedInstant } from "./time.ts";
import { learningUntil, quietAfterMinutes } from "./tuning.ts";

/**
 * A deterministic run of one member for 400 local days, driven only by `nextWakeAt`, with every due
 * action applied the way the services tick would apply it. She is activated on the consent date and
 * her arrivals start the day after; deliveries succeed at the wake instant except on scripted failure
 * days; she answers at a scripted latency on most days and not at all on others; a few days are away
 * days.
 */

const MINUTE = 60_000;
const DAYS = 400;
const CONSENT_DATE = "2026-01-05";
/** A morning consent: without the start date, every run's arrival would still be due that day. */
const ACTIVATED_AT: LocalTime = "09:00";
const STARTS_ON = addDays(CONSENT_DATE, 1);
const FAILURE_DAYS = new Set([17, 18, 95, 203, 311]);
const AWAY_DAYS = new Set([40, 41, 42, 250, 251]);
/** One wake per threshold kind (arrival, repeat, quiet, learning push, turn prompt, prepare, weekly read), plus one. */
const MAX_WAKES_PER_DAY = 8;

interface SimDay {
  readonly date: LocalDate;
  readonly answerLatency: number | null;
  readonly failing: boolean;
  readonly away: boolean;
  prepared: boolean;
  turnPromptSent: boolean;
  deliveredAt: Date | null;
  deliveryFailed: boolean;
  quietAfterAtDelivery: number;
  quietOpenedAt: Date | null;
  lastNotifiedAt: Date | null;
  readonly attempts: { at: Date; late: boolean }[];
  readonly repeats: Date[];
  readonly quietOpens: { at: Date; notify: boolean }[];
  readonly notices: Date[];
  readonly turnPrompts: Date[];
  readonly prepares: Date[];
  readonly wakes: Date[];
}

interface Run {
  readonly zone: string;
  readonly arrivalTime: LocalTime;
  readonly startsOn: LocalDate;
  readonly learningUntil: LocalDate;
  readonly days: Map<LocalDate, SimDay>;
  readonly weeklyReads: { weekEnd: LocalDate; at: Date }[];
  readonly nextWakes: Date[];
  readonly failures: string[];
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function scriptDays(seed: number): Map<LocalDate, SimDay> {
  const random = mulberry32(seed);
  const days = new Map<LocalDate, SimDay>();
  for (let index = -1; index <= DAYS + 1; index += 1) {
    const date = addDays(CONSENT_DATE, index);
    const answers = random() >= 0.25;
    const latency = 1 + Math.floor(random() * 560);
    days.set(date, {
      date,
      answerLatency: answers ? latency : null,
      failing: FAILURE_DAYS.has(index),
      away: AWAY_DAYS.has(index),
      prepared: false,
      turnPromptSent: false,
      deliveredAt: null,
      deliveryFailed: false,
      quietAfterAtDelivery: 0,
      quietOpenedAt: null,
      lastNotifiedAt: null,
      attempts: [],
      repeats: [],
      quietOpens: [],
      notices: [],
      turnPrompts: [],
      prepares: [],
      wakes: [],
    });
  }
  return days;
}

function dayIn(run: Run, date: LocalDate): SimDay {
  const found = run.days.get(date);
  if (found === undefined) {
    throw new Error(`the simulation has no script for ${date}`);
  }
  return found;
}

function answeredAt(day: SimDay, now: Date): Date | null {
  if (day.deliveredAt === null || day.answerLatency === null) {
    return null;
  }
  const at = addMinutes(day.deliveredAt, day.answerLatency);
  return at <= now ? at : null;
}

function dayState(day: SimDay, now: Date): DayState {
  const answered = answeredAt(day, now);
  return {
    date: day.date,
    prepared: day.prepared,
    deliveredAt: day.deliveredAt,
    deliveryFailed: day.deliveryFailed,
    answeredAt: answered,
    repeatSentAt: day.repeats[0] ?? null,
    quiet:
      day.quietOpenedAt === null
        ? null
        : {
            openedAt: day.quietOpenedAt,
            lastNotifiedAt: day.lastNotifiedAt,
            waitUntil: null,
            resolvedAt: answered,
          },
  };
}

/** Recomputed each Sunday evening from her last 14 answered days, as the weekly job would. */
function tunedQuietAfter(run: Run, today: LocalDate): number {
  const latencies: number[] = [];
  for (let date = today; date >= CONSENT_DATE && latencies.length < 14; date = addDays(date, -1)) {
    const day = dayIn(run, date);
    if (day.deliveredAt !== null && day.answerLatency !== null) {
      latencies.push(day.answerLatency);
    }
  }
  return quietAfterMinutes(latencies);
}

function apply(run: Run, action: DueAction, now: Date, quietAfter: { value: number }): void {
  switch (action.kind) {
    case "deliver_arrival": {
      const day = dayIn(run, action.date);
      day.attempts.push({ at: now, late: action.late });
      if (day.failing) {
        day.deliveryFailed = true;
      } else {
        day.deliveredAt = now;
        day.quietAfterAtDelivery = quietAfter.value;
      }
      return;
    }
    case "send_repeat":
      dayIn(run, action.date).repeats.push(now);
      return;
    case "open_quiet": {
      const day = dayIn(run, action.date);
      day.quietOpens.push({ at: now, notify: action.notify });
      day.quietOpenedAt = now;
      if (action.notify) {
        day.lastNotifiedAt = now;
        day.notices.push(now);
      }
      return;
    }
    case "notify_quiet": {
      const day = dayIn(run, action.date);
      day.lastNotifiedAt = now;
      day.notices.push(now);
      return;
    }
    case "send_turn_prompt": {
      const day = dayIn(run, action.forDate);
      day.turnPromptSent = true;
      day.turnPrompts.push(now);
      return;
    }
    case "prepare": {
      const day = dayIn(run, action.forDate);
      day.prepared = true;
      day.prepares.push(now);
      return;
    }
    case "draft_weekly_read":
      run.weeklyReads.push({ weekEnd: action.weekEnd, at: now });
      quietAfter.value = tunedQuietAfter(run, action.weekEnd);
      return;
  }
}

function simulate(zone: string, arrivalTime: LocalTime, seed: number): Run {
  const run: Run = {
    zone,
    arrivalTime,
    startsOn: STARTS_ON,
    learningUntil: learningUntil(CONSENT_DATE),
    days: scriptDays(seed),
    weeklyReads: [],
    nextWakes: [],
    failures: [],
  };
  const quietAfter = { value: quietAfterMinutes([]) };
  const end = zonedInstant(addDays(CONSENT_DATE, DAYS + 1), "00:00", zone);
  let now = zonedInstant(CONSENT_DATE, ACTIVATED_AT, zone);
  while (now < end) {
    const today = localDateOf(now, zone);
    dayIn(run, today).wakes.push(now);
    const decision = decideSchedule({
      now,
      member: {
        timeZone: zone,
        arrivalTime,
        status: "active",
        lightOn: true,
        quietAfterMinutes: quietAfter.value,
        startsOn: run.startsOn,
        learningUntil: run.learningUntil,
        resumedAt: null,
        blockedAt: null,
      },
      family: { turnsEnabled: true },
      days: [dayState(dayIn(run, addDays(today, -1)), now), dayState(dayIn(run, today), now)],
      tomorrow: {
        prepared: dayIn(run, addDays(today, 1)).prepared,
        turnPromptSent: dayIn(run, addDays(today, 1)).turnPromptSent,
        askScheduled: false,
      },
      awayOn: (date) => dayIn(run, date).away,
      weeklyReadDoneFor: (weekEnd) => run.weeklyReads.some((read) => read.weekEnd === weekEnd),
    });
    for (const action of decision.due) {
      apply(run, action, now, quietAfter);
    }
    const next = decision.nextWakeAt;
    if (next === null || next <= now) {
      run.failures.push(`wake at ${now.toISOString()} returned ${next?.toISOString() ?? "null"}`);
      break;
    }
    const previous = run.nextWakes.at(-1);
    if (previous !== undefined && next <= previous) {
      run.failures.push(`nextWakeAt ${next.toISOString()} is not after ${previous.toISOString()}`);
    }
    run.nextWakes.push(next);
    now = next;
  }
  return run;
}

function times(instants: readonly Date[]): string[] {
  return instants.map((instant) => instant.toISOString());
}

/** Checks one scripted day against what the rules promise, appending any broken promise. */
function checkDay(run: Run, index: number): void {
  const day = dayIn(run, addDays(CONSENT_DATE, index));
  const fail = (message: string): void => {
    run.failures.push(`${run.zone} ${run.arrivalTime} ${day.date}: ${message}`);
  };
  const arrival = zonedInstant(day.date, run.arrivalTime, run.zone);

  const [attempt, ...extra] = day.attempts;
  if (attempt === undefined || extra.length > 0) {
    fail(`expected one delivery attempt, got ${day.attempts.length}`);
    return;
  }
  const lateBy = attempt.at.getTime() - arrival.getTime();
  if (lateBy < 0 || lateBy > MINUTE || attempt.late) {
    fail(`delivered at ${attempt.at.toISOString()} for an arrival at ${arrival.toISOString()}`);
  }
  if (localDateOf(attempt.at, run.zone) !== day.date) {
    fail(`delivered on local date ${localDateOf(attempt.at, run.zone)}`);
  }
  if (day.deliveryFailed !== day.failing) {
    fail(`delivery failed = ${day.deliveryFailed}, scripted ${day.failing}`);
  }

  const expectedRepeats: Date[] = [];
  const expectedOpens: { at: Date; notify: boolean }[] = [];
  const expectedNotices: Date[] = [];
  const { deliveredAt, answerLatency } = day;
  if (deliveredAt !== null && !day.away) {
    if (answerLatency === null || answerLatency > SCHEDULE.repeatAfterMinutes) {
      expectedRepeats.push(addMinutes(deliveredAt, SCHEDULE.repeatAfterMinutes));
    }
    const quietAfter = day.quietAfterAtDelivery;
    if (answerLatency === null || answerLatency > quietAfter) {
      const learning = day.date < run.learningUntil;
      const notify = !(learning && quietAfter < SCHEDULE.learningNotifyMinutes);
      const openAt = addMinutes(deliveredAt, quietAfter);
      expectedOpens.push({ at: openAt, notify });
      if (notify) {
        expectedNotices.push(openAt);
      } else if (answerLatency === null || answerLatency > SCHEDULE.learningNotifyMinutes) {
        expectedNotices.push(addMinutes(deliveredAt, SCHEDULE.learningNotifyMinutes));
      }
    }
  }
  if (times(day.repeats).join() !== times(expectedRepeats).join()) {
    fail(`repeats ${times(day.repeats)}, expected ${times(expectedRepeats)}`);
  }
  const opens = day.quietOpens.map((open) => `${open.at.toISOString()}/${open.notify}`);
  const wantedOpens = expectedOpens.map((open) => `${open.at.toISOString()}/${open.notify}`);
  if (opens.join() !== wantedOpens.join()) {
    fail(`quiet opened ${opens}, expected ${wantedOpens}`);
  }
  if (times(day.notices).join() !== times(expectedNotices).join()) {
    fail(`quiet notices ${times(day.notices)}, expected ${times(expectedNotices)}`);
  }

  const eve = addDays(day.date, -1);
  const expectedPrompts = [zonedInstant(eve, SCHEDULE.turnPromptTime, run.zone)];
  if (times(day.turnPrompts).join() !== times(expectedPrompts).join()) {
    fail(`turn prompts ${times(day.turnPrompts)}, expected ${times(expectedPrompts)}`);
  }
  const expectedPrepare = zonedInstant(eve, SCHEDULE.prepareTime, run.zone);
  if (times(day.prepares).join() !== times([expectedPrepare]).join()) {
    fail(`prepared ${times(day.prepares)}, expected ${expectedPrepare.toISOString()}`);
  }
  if (day.wakes.length > MAX_WAKES_PER_DAY) {
    fail(`${day.wakes.length} wakes in one day`);
  }
}

function checkRun(run: Run): void {
  for (let index = 1; index <= DAYS; index += 1) {
    checkDay(run, index);
  }
  const last = addDays(CONSENT_DATE, DAYS);
  const expectedReads: string[] = [];
  for (let date = addDays(CONSENT_DATE, 1); date <= last; date = addDays(date, 1)) {
    if (weekdayOf(date) === SCHEDULE.weeklyReadWeekday) {
      const at = zonedInstant(date, SCHEDULE.weeklyReadTime, run.zone).toISOString();
      expectedReads.push(`${date}@${at}`);
    }
  }
  const reads = run.weeklyReads.map((read) => `${read.weekEnd}@${read.at.toISOString()}`);
  if (reads.join() !== expectedReads.join()) {
    run.failures.push(`${run.zone} ${run.arrivalTime}: weekly reads ${reads}`);
  }
  let attempts = 0;
  for (const day of run.days.values()) {
    attempts += day.attempts.length;
  }
  if (attempts !== DAYS) {
    run.failures.push(
      `${run.zone} ${run.arrivalTime}: ${attempts} delivery attempts in ${DAYS} days`,
    );
  }
}

function totals(run: Run): { repeats: number; opens: number; inAppOpens: number; notices: number } {
  let repeats = 0;
  let opens = 0;
  let inAppOpens = 0;
  let notices = 0;
  for (const day of run.days.values()) {
    repeats += day.repeats.length;
    opens += day.quietOpens.length;
    inAppOpens += day.quietOpens.filter((open) => !open.notify).length;
    notices += day.notices.length;
  }
  return { repeats, opens, inAppOpens, notices };
}

/** Instants resolved by hand from the tz database, independent of `zonedInstant`. */
const TRANSITION_ARRIVALS: Record<string, Record<string, Record<LocalDate, string>>> = {
  "America/New_York": {
    "02:30": { "2026-03-08": "2026-03-08T07:00:00.000Z", "2026-11-01": "2026-11-01T07:30:00.000Z" },
    "08:00": { "2026-03-08": "2026-03-08T12:00:00.000Z", "2026-11-01": "2026-11-01T13:00:00.000Z" },
  },
  "Europe/Berlin": {
    "02:30": { "2026-03-29": "2026-03-29T01:00:00.000Z", "2026-10-25": "2026-10-25T00:30:00.000Z" },
    "08:00": { "2026-03-29": "2026-03-29T06:00:00.000Z", "2026-10-25": "2026-10-25T07:00:00.000Z" },
    "21:30": { "2026-03-29": "2026-03-29T19:30:00.000Z", "2026-10-25": "2026-10-25T20:30:00.000Z" },
  },
  "Australia/Lord_Howe": {
    "01:45": { "2026-04-05": "2026-04-04T14:45:00.000Z", "2026-10-04": "2026-10-03T15:15:00.000Z" },
    "02:15": { "2026-04-05": "2026-04-04T15:45:00.000Z", "2026-10-04": "2026-10-03T15:30:00.000Z" },
    "02:30": { "2026-04-05": "2026-04-04T16:00:00.000Z", "2026-10-04": "2026-10-03T15:30:00.000Z" },
    "08:00": { "2026-04-05": "2026-04-04T21:30:00.000Z", "2026-10-04": "2026-10-03T21:00:00.000Z" },
  },
  "Asia/Taipei": {
    "02:30": { "2026-03-08": "2026-03-07T18:30:00.000Z", "2026-11-01": "2026-10-31T18:30:00.000Z" },
    "08:00": { "2026-03-08": "2026-03-08T00:00:00.000Z", "2026-11-01": "2026-11-01T00:00:00.000Z" },
    "20:30": { "2026-03-08": "2026-03-08T12:30:00.000Z", "2026-11-01": "2026-11-01T12:30:00.000Z" },
  },
};

const RUNS: readonly { zone: string; arrivalTime: LocalTime }[] = Object.entries(
  TRANSITION_ARRIVALS,
).flatMap(([zone, byTime]) => Object.keys(byTime).map((arrivalTime) => ({ zone, arrivalTime })));

describe("400 days of one member", () => {
  it.each(RUNS)(
    "keeps every promise in $zone at $arrivalTime",
    ({ zone, arrivalTime }) => {
      const run = simulate(
        zone,
        arrivalTime,
        zone.length * 10_000 + Number(arrivalTime.replace(":", "")),
      );
      checkRun(run);
      expect(run.failures).toEqual([]);

      const beforeStart = [...run.days.values()].filter((day) => day.date < run.startsOn);
      expect(beforeStart.map((day) => day.date)).toContain(CONSENT_DATE);
      expect(
        beforeStart.flatMap((day) => [...day.attempts, ...day.repeats, ...day.quietOpens]),
      ).toEqual([]);

      for (const [date, expected] of Object.entries(
        TRANSITION_ARRIVALS[zone]?.[arrivalTime] ?? {},
      )) {
        expect(dayIn(run, date).attempts.map((attempt) => attempt.at.toISOString())).toEqual([
          expected,
        ]);
      }

      const scripted = Array.from({ length: DAYS }, (_, offset) =>
        dayIn(run, addDays(CONSENT_DATE, offset + 1)),
      );
      const delivered = scripted.filter((day) => day.deliveredAt !== null).length;
      expect(delivered).toBe(DAYS - FAILURE_DAYS.size);
      const summary = totals(run);
      expect(summary.repeats).toBeGreaterThan(40);
      expect(summary.opens).toBeGreaterThan(40);
      expect(summary.inAppOpens).toBeGreaterThan(0);
      expect(summary.notices).toBeGreaterThan(40);
      for (const index of FAILURE_DAYS) {
        const failed = dayIn(run, addDays(CONSENT_DATE, index));
        expect([failed.repeats.length, failed.quietOpens.length, failed.notices.length]).toEqual([
          0, 0, 0,
        ]);
      }
    },
    30_000,
  );
});
