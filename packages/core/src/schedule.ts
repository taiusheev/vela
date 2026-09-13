/**
 * The daily decision for one kept-light member (architecture §6, spec §4.1, §4.6, §7, §8, §13).
 *
 * Given the member's state at `now`, `decideSchedule` returns what is due and when to look again.
 * The services tick executes the due actions and persists `nextWakeAt` from the same decision, so
 * the wake already covers the thresholds the due actions create (the ladder of an arrival being
 * delivered now, the in-app-only quiet that will need a push later). Changes that can make something
 * due sooner and do not come from the passing of time (a "wait 2 hours" tap, away being cleared, a
 * new arrival time, the light switched back on) must be followed by a fresh decision.
 */
import type { LocalDate, LocalTime, MemberStatus } from "@vela/contracts";
import {
  addDays,
  addMinutes,
  localDateOf,
  minutesBetween,
  weekdayOf,
  zonedInstant,
} from "./time.ts";

export const SCHEDULE = {
  repeatAfterMinutes: 150,
  lateNoteAfterMinutes: 180,
  learningNotifyMinutes: 480,
  waitMinutes: 120,
  turnPromptTime: "19:00",
  prepareTime: "22:00",
  weeklyReadTime: "18:00",
  weeklyReadWeekday: 0,
} as const;

export interface ScheduleInput {
  now: Date;
  member: {
    timeZone: string;
    arrivalTime: LocalTime;
    status: MemberStatus;
    lightOn: boolean;
    quietAfterMinutes: number;
    /** The first local date after the learning period; see `learningUntil` in tuning.ts. */
    learningUntil: LocalDate | null;
  };
  family: { turnsEnabled: boolean };
  /** The exchange days that can still need action: yesterday's and today's local dates. */
  days: DayState[];
  tomorrow: { prepared: boolean; turnPromptSent: boolean };
  awayOn: (date: LocalDate) => boolean;
  weeklyReadDoneFor: (weekEnd: LocalDate) => boolean;
}

export interface DayState {
  date: LocalDate;
  prepared: boolean;
  deliveredAt: Date | null;
  deliveryFailed: boolean;
  answeredAt: Date | null;
  repeatSentAt: Date | null;
  quiet: null | {
    openedAt: Date;
    lastNotifiedAt: Date | null;
    waitUntil: Date | null;
    resolvedAt: Date | null;
  };
}

/**
 * Executing an action records it in the state the next decision reads: `deliver_arrival` sets
 * `deliveredAt` or `deliveryFailed`, `send_repeat` sets `repeatSentAt`, `open_quiet` creates `quiet`
 * (with `lastNotifiedAt` when `notify` is true), `notify_quiet` sets `lastNotifiedAt`,
 * `send_turn_prompt` and `prepare` set the flags on `tomorrow`, and `draft_weekly_read` makes
 * `weeklyReadDoneFor(weekEnd)` true.
 */
export type DueAction =
  | { kind: "deliver_arrival"; date: LocalDate; late: boolean }
  | { kind: "send_repeat"; date: LocalDate }
  | { kind: "open_quiet"; date: LocalDate; notify: boolean }
  | { kind: "notify_quiet"; date: LocalDate }
  | { kind: "send_turn_prompt"; forDate: LocalDate }
  | { kind: "prepare"; forDate: LocalDate }
  | { kind: "draft_weekly_read"; weekEnd: LocalDate };

export interface ScheduleDecision {
  due: DueAction[];
  nextWakeAt: Date | null;
}

const DUE_ORDER: readonly DueAction["kind"][] = [
  "deliver_arrival",
  "send_repeat",
  "open_quiet",
  "notify_quiet",
  "send_turn_prompt",
  "prepare",
  "draft_weekly_read",
];

const START_OF_DAY: LocalTime = "00:00";

interface Context {
  readonly input: ScheduleInput;
  readonly now: Date;
  readonly today: LocalDate;
  readonly yesterday: LocalDate;
  readonly tomorrow: LocalDate;
  /** The instant of a local date and time in the member's zone, computed once per decision. */
  at(date: LocalDate, time: LocalTime): Date;
}

interface Collector {
  readonly due: DueAction[];
  readonly wakes: Date[];
}

export function decideSchedule(input: ScheduleInput): ScheduleDecision {
  if (!isActive(input.member)) {
    return { due: [], nextWakeAt: null };
  }
  const ctx = createContext(input);
  const out: Collector = { due: [], wakes: [] };

  arrivalRule(ctx, out);
  const today = dayOf(ctx, ctx.today);
  // Yesterday's repeat and quiet stop once today's arrival is delivered.
  if (today.deliveredAt === null) {
    ladderRules(ctx, dayOf(ctx, ctx.yesterday), out);
  }
  ladderRules(ctx, today, out);
  turnPromptRule(ctx, out);
  prepareRule(ctx, out);
  weeklyReadRule(ctx, out);

  return { due: inStableOrder(out.due), nextWakeAt: earliestAfter(ctx.now, out.wakes) };
}

function isActive(member: ScheduleInput["member"]): boolean {
  return member.lightOn && member.status === "active";
}

function createContext(input: ScheduleInput): Context {
  const { timeZone } = input.member;
  const today = localDateOf(input.now, timeZone);
  const instants = new Map<string, Date>();
  return {
    input,
    now: input.now,
    today,
    yesterday: addDays(today, -1),
    tomorrow: addDays(today, 1),
    at(date, time) {
      const key = `${date}T${time}`;
      const cached = instants.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const instant = zonedInstant(date, time, timeZone);
      instants.set(key, instant);
      return instant;
    },
  };
}

function dayOf(ctx: Context, date: LocalDate): DayState {
  return (
    ctx.input.days.find((day) => day.date === date) ?? {
      date,
      prepared: false,
      deliveredAt: null,
      deliveryFailed: false,
      answeredAt: null,
      repeatSentAt: null,
      quiet: null,
    }
  );
}

function reached(now: Date, threshold: Date): boolean {
  return now.getTime() >= threshold.getTime();
}

/**
 * Today's arrival, from her arrival time until the prepare time. After the prepare time the day is
 * skipped (reconciliation logs it as missed) rather than greeting her with a morning message late at
 * night.
 */
function arrivalRule(ctx: Context, out: Collector): void {
  const { arrivalTime } = ctx.input.member;
  const day = dayOf(ctx, ctx.today);
  if (day.deliveredAt === null && !day.deliveryFailed) {
    const arrival = ctx.at(ctx.today, arrivalTime);
    if (!reached(ctx.now, arrival)) {
      out.wakes.push(arrival);
    } else if (!reached(ctx.now, arrivalCutoff(ctx, arrival))) {
      out.due.push({
        kind: "deliver_arrival",
        date: ctx.today,
        late: minutesBetween(arrival, ctx.now) > SCHEDULE.lateNoteAfterMinutes,
      });
      ladderWakesAfterDelivery(ctx, day, out);
    }
  }
  out.wakes.push(ctx.at(ctx.tomorrow, arrivalTime));
}

/**
 * The prepare time closes today's arrival window. An arrival time at or after the prepare time would
 * otherwise never open a window at all, so such a member's window runs to the end of her day.
 */
function arrivalCutoff(ctx: Context, arrival: Date): Date {
  const prepare = ctx.at(ctx.today, SCHEDULE.prepareTime);
  return arrival.getTime() < prepare.getTime() ? prepare : ctx.at(ctx.tomorrow, START_OF_DAY);
}

/** The ladder thresholds of an arrival that the tick is about to deliver at `now`. */
function ladderWakesAfterDelivery(ctx: Context, day: DayState, out: Collector): void {
  const delivered: Collector = { due: [], wakes: [] };
  ladderRules(ctx, { ...day, deliveredAt: ctx.now }, delivered);
  out.wakes.push(...delivered.wakes);
}

/** Repeat and quiet apply only to a delivered, unanswered exchange on a day she is not away. */
function ladderRules(ctx: Context, day: DayState, out: Collector): void {
  if (day.deliveredAt === null || day.answeredAt !== null || ctx.input.awayOn(day.date)) {
    return;
  }
  repeatRule(ctx, day, day.deliveredAt, out);
  // The quiet ladder never fires on our own failure to deliver.
  if (day.deliveryFailed) {
    return;
  }
  openQuietRule(ctx, day, day.deliveredAt, out);
  notifyQuietRule(ctx, day, day.deliveredAt, out);
}

function repeatRule(ctx: Context, day: DayState, deliveredAt: Date, out: Collector): void {
  if (day.repeatSentAt !== null) {
    return;
  }
  const repeatAt = addMinutes(deliveredAt, SCHEDULE.repeatAfterMinutes);
  if (reached(ctx.now, repeatAt)) {
    out.due.push({ kind: "send_repeat", date: day.date });
  } else {
    out.wakes.push(repeatAt);
  }
}

function isLearning(ctx: Context, date: LocalDate): boolean {
  const { learningUntil } = ctx.input.member;
  return learningUntil !== null && date < learningUntil;
}

function openQuietRule(ctx: Context, day: DayState, deliveredAt: Date, out: Collector): void {
  if (day.quiet !== null) {
    return;
  }
  const quietAt = addMinutes(deliveredAt, ctx.input.member.quietAfterMinutes);
  if (!reached(ctx.now, quietAt)) {
    out.wakes.push(quietAt);
    return;
  }
  const learningPushAt = addMinutes(deliveredAt, SCHEDULE.learningNotifyMinutes);
  const notify = !(isLearning(ctx, day.date) && !reached(ctx.now, learningPushAt));
  out.due.push({ kind: "open_quiet", date: day.date, notify });
  if (!notify) {
    // The quiet opens in the app only; the push it will need later is this decision's to schedule.
    out.wakes.push(learningPushAt);
  }
}

/**
 * A quiet is (re)notified when the organiser's "wait 2 hours" has run out, or, if nobody has been
 * told yet, once the learning-period silence has lasted long enough. A pending wait takes precedence:
 * the organiser has seen the quiet and asked to hear again later, not sooner.
 */
function notifyQuietRule(ctx: Context, day: DayState, deliveredAt: Date, out: Collector): void {
  const { quiet } = day;
  if (quiet === null || quiet.resolvedAt !== null) {
    return;
  }
  const { lastNotifiedAt, waitUntil } = quiet;
  let notifyAt: Date | null = null;
  if (
    waitUntil !== null &&
    (lastNotifiedAt === null || waitUntil.getTime() > lastNotifiedAt.getTime())
  ) {
    notifyAt = waitUntil;
  } else if (lastNotifiedAt === null) {
    notifyAt = addMinutes(deliveredAt, SCHEDULE.learningNotifyMinutes);
  }
  if (notifyAt === null) {
    return;
  }
  if (reached(ctx.now, notifyAt)) {
    out.due.push({ kind: "notify_quiet", date: day.date });
  } else {
    out.wakes.push(notifyAt);
  }
}

function turnPromptRule(ctx: Context, out: Collector): void {
  if (!ctx.input.family.turnsEnabled) {
    return;
  }
  const { prepared, turnPromptSent } = ctx.input.tomorrow;
  if (!prepared && !turnPromptSent) {
    const promptAt = ctx.at(ctx.today, SCHEDULE.turnPromptTime);
    if (!reached(ctx.now, promptAt)) {
      out.wakes.push(promptAt);
    } else if (!reached(ctx.now, ctx.at(ctx.today, SCHEDULE.prepareTime))) {
      out.due.push({ kind: "send_turn_prompt", forDate: ctx.tomorrow });
    }
  }
  out.wakes.push(ctx.at(ctx.tomorrow, SCHEDULE.turnPromptTime));
}

function prepareRule(ctx: Context, out: Collector): void {
  if (!ctx.input.tomorrow.prepared) {
    const prepareAt = ctx.at(ctx.today, SCHEDULE.prepareTime);
    if (reached(ctx.now, prepareAt)) {
      out.due.push({ kind: "prepare", forDate: ctx.tomorrow });
    } else {
      out.wakes.push(prepareAt);
    }
  }
  out.wakes.push(ctx.at(ctx.tomorrow, SCHEDULE.prepareTime));
}

function weeklyReadRule(ctx: Context, out: Collector): void {
  const daysUntil = (7 + SCHEDULE.weeklyReadWeekday - weekdayOf(ctx.today)) % 7;
  if (daysUntil > 0) {
    out.wakes.push(ctx.at(addDays(ctx.today, daysUntil), SCHEDULE.weeklyReadTime));
    return;
  }
  if (!ctx.input.weeklyReadDoneFor(ctx.today)) {
    const readAt = ctx.at(ctx.today, SCHEDULE.weeklyReadTime);
    if (reached(ctx.now, readAt)) {
      out.due.push({ kind: "draft_weekly_read", weekEnd: ctx.today });
    } else {
      out.wakes.push(readAt);
    }
  }
  out.wakes.push(ctx.at(addDays(ctx.today, 7), SCHEDULE.weeklyReadTime));
}

function inStableOrder(due: readonly DueAction[]): DueAction[] {
  return [...due].sort((a, b) => DUE_ORDER.indexOf(a.kind) - DUE_ORDER.indexOf(b.kind));
}

function earliestAfter(now: Date, instants: readonly Date[]): Date | null {
  let earliest: Date | null = null;
  for (const instant of instants) {
    if (
      instant.getTime() > now.getTime() &&
      (earliest === null || instant.getTime() < earliest.getTime())
    ) {
      earliest = instant;
    }
  }
  return earliest;
}
