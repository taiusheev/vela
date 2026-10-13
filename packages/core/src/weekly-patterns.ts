/**
 * The patterns of her week (ADR-46, spec §13): what changed against her own earlier weeks, found by
 * code with fixed thresholds and minimum samples, so the weekly read reports a pattern only when the
 * data shows one. The AI words the note patterns; it never decides that something is a pattern.
 *
 * Every comparison is with her own usual, never with other people, and is reported as a plain fact:
 * no score, no cause, no advice, no health word and no mood label. Note patterns are about the days
 * she answered only, because she can read the lines they become (spec §8, §9). Family patterns may
 * count days without an answer or the family's own part, and are shown to organisers only.
 *
 * The comparisons stay inside the 30 days her words are kept: a week and the three weeks before it.
 * Only answer times and deliveries, which are kept longer, look back four weeks.
 */
import type {
  AnswerForm,
  ExchangeType,
  FamilyPattern,
  LocalDate,
  WeeklyNotePattern,
} from "@vela/contracts";
import { ANSWER_FORMS } from "@vela/contracts";
import { addDays, weekdayOf } from "./time.ts";

export const PATTERNS = {
  /** History the caller passes before the week: four weeks. */
  historyDays: 28,
  /** Her usual is read from the three weeks before this one, inside the 30 days words are kept. */
  baselineDays: 21,
  /** Answered days this week below which no comparison is made. */
  minWeekAnswers: 3,
  /** Answered days in the baseline below which no comparison is made. */
  minBaselineAnswers: 6,
  /** Her usual answer time must move by more than this. */
  timeShiftMinutes: 30,
  /** A form of answer must change its share of her answered days by at least this many points. */
  formShiftPoints: 40,
  /** Words per answer and voice length must change by at least this share of her usual. */
  lengthShiftRatio: 0.4,
  /** Her usual answer must have at least this many words for a change in length to mean anything. */
  minUsualWords: 5,
  minWeekVoice: 2,
  minBaselineVoice: 3,
  /** The ask type that drew her out needs this many answered asks and this lead over the rest. */
  drewOutMinAsks: 2,
  drewOutFactor: 1.5,
  /** People, places and plans per answered day must halve or double against a usual of at least this. */
  minUsualMentions: 0.5,
  mentionsFactor: 2,
  /** A mention counts as came back to on this many days, or in this many weeks in a row. */
  comebackDays: 2,
  comebackWeeks: 3,
  maxComebacks: 5,
  /** A weekday is reported as quiet after this many weeks in a row. */
  quietWeekdayWeeks: 3,
  /** Answers after the second message are reported from this many in a week. */
  minAfterSecond: 2,
} as const;

/** One of her days as the patterns read it. */
export interface PatternDay {
  date: LocalDate;
  /** The day's arrival went out to her, so the day could be answered. */
  delivered: boolean;
  /** She was away that day; such a day is never quiet. */
  away: boolean;
  /** Minutes after her local midnight of the answer the day counts; null when unanswered. */
  answerMinute: number | null;
  /** That answer came only after the second message (the repeat). */
  afterSecond: boolean;
  /** The forms of her answers that day. */
  forms: readonly AnswerForm[];
  /** Words in her written answers and voice transcripts that day; null when none had words. */
  words: number | null;
  /** The length of her voice answer that day; null without one. */
  voiceSeconds: number | null;
  /** People, places, plans and dates she mentioned that day, as she said them; never health words. */
  mentions: readonly string[];
  /** The day's ask; `hello` for Vela's own morning; null with no exchange. */
  askType: ExchangeType | null;
  /** Who asked; null for Vela's own morning. */
  askerName: string | null;
  /** Replies and reactions from the family to her answer that day. */
  familyReplies: number;
}

export interface WeeklyPatternInput {
  /** The week's counted days, oldest first. */
  week: readonly PatternDay[];
  /** Her days in the `PATTERNS.historyDays` before the week, oldest first; none before her start. */
  history: readonly PatternDay[];
}

export interface WeeklyPatterns {
  notes: WeeklyNotePattern[];
  family: FamilyPattern[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function answered(days: readonly PatternDay[]): PatternDay[] {
  return days.filter((day) => day.answerMinute !== null);
}

/** The days from `daysBack` to `upTo` days before `first`, `upTo` excluded (1 = the day before). */
function window(
  days: readonly PatternDay[],
  first: LocalDate,
  daysBack: number,
  upTo = 0,
): PatternDay[] {
  const from = addDays(first, -daysBack);
  const to = addDays(first, -upTo);
  return days.filter((day) => day.date >= from && day.date < to);
}

function enough(week: readonly PatternDay[], base: readonly PatternDay[]): boolean {
  return week.length >= PATTERNS.minWeekAnswers && base.length >= PATTERNS.minBaselineAnswers;
}

/** The signed move of the median answer time, or null when it is within the threshold or unknown. */
function timeShift(week: readonly PatternDay[], base: readonly PatternDay[]): number | null {
  const thisWeek = answered(week);
  const usual = answered(base);
  if (!enough(thisWeek, usual)) {
    return null;
  }
  const shift =
    (median(thisWeek.map((day) => day.answerMinute as number)) ?? 0) -
    (median(usual.map((day) => day.answerMinute as number)) ?? 0);
  return Math.abs(shift) > PATTERNS.timeShiftMinutes ? shift : null;
}

function answerTime(input: WeeklyPatternInput, first: LocalDate): WeeklyNotePattern | null {
  const shift = timeShift(input.week, window(input.history, first, PATTERNS.baselineDays));
  if (shift === null) {
    return null;
  }
  const lastWeek = window(input.history, first, 7);
  const lastWeekShift = timeShift(lastWeek, window(input.history, first, PATTERNS.historyDays, 7));
  return {
    kind: "answer_time",
    direction: shift > 0 ? "later" : "earlier",
    minutes: Math.max(5, Math.round(Math.abs(shift) / 5) * 5),
    secondWeek: lastWeekShift !== null && Math.sign(lastWeekShift) === Math.sign(shift),
  };
}

function share(days: readonly PatternDay[], form: AnswerForm): number {
  return (days.filter((day) => day.forms.includes(form)).length / days.length) * 100;
}

function answerForm(week: readonly PatternDay[], base: readonly PatternDay[]) {
  const thisWeek = answered(week);
  const usual = answered(base);
  if (!enough(thisWeek, usual)) {
    return null;
  }
  let more: { form: AnswerForm; delta: number } | null = null;
  let fewer: { form: AnswerForm; delta: number } | null = null;
  for (const form of ANSWER_FORMS) {
    const delta = share(thisWeek, form) - share(usual, form);
    if (delta >= PATTERNS.formShiftPoints && (more === null || delta > more.delta)) {
      more = { form, delta };
    }
    if (delta <= -PATTERNS.formShiftPoints && (fewer === null || delta < fewer.delta)) {
      fewer = { form, delta };
    }
  }
  if (more === null && fewer === null) {
    return null;
  }
  return {
    kind: "answer_form" as const,
    more: more?.form ?? null,
    fewer: fewer?.form ?? null,
  };
}

function lengthDirection(
  week: readonly number[],
  base: readonly number[],
  minWeek: number,
  minBase: number,
  minUsual: number,
): "longer" | "shorter" | null {
  const usual = median(base);
  const now = median(week);
  if (week.length < minWeek || base.length < minBase || usual === null || now === null) {
    return null;
  }
  if (usual < minUsual) {
    return null;
  }
  const ratio = now / usual;
  if (ratio >= 1 + PATTERNS.lengthShiftRatio) {
    return "longer";
  }
  return ratio <= 1 - PATTERNS.lengthShiftRatio ? "shorter" : null;
}

function wordsOf(days: readonly PatternDay[]): number[] {
  return days.flatMap((day) => (day.words === null ? [] : [day.words]));
}

function voiceOf(days: readonly PatternDay[]): number[] {
  return days.flatMap((day) => (day.voiceSeconds === null ? [] : [day.voiceSeconds]));
}

function drewOut(week: readonly PatternDay[]): WeeklyNotePattern | null {
  const asked = answered(week).filter((day) => day.askType !== null && day.askType !== "hello");
  const byType = new Map<Exclude<ExchangeType, "hello">, number[]>();
  for (const day of asked) {
    const type = day.askType as Exclude<ExchangeType, "hello">;
    byType.set(type, [...(byType.get(type) ?? []), day.words ?? 0]);
  }
  if (byType.size < 2) {
    return null;
  }
  let best: { type: Exclude<ExchangeType, "hello">; fullness: number } | null = null;
  for (const [type, fullness] of byType) {
    const value = median(fullness) ?? 0;
    if (fullness.length >= PATTERNS.drewOutMinAsks && (best === null || value > best.fullness)) {
      best = { type, fullness: value };
    }
  }
  if (best === null || best.fullness < PATTERNS.minUsualWords) {
    return null;
  }
  const bestType = best.type;
  const others = median(
    asked.filter((day) => day.askType !== bestType).map((day) => day.words ?? 0),
  );
  if (others === null || best.fullness < PATTERNS.drewOutFactor * Math.max(others, 1)) {
    return null;
  }
  return { kind: "drew_out", askType: bestType };
}

function keyOf(mention: string): string {
  return mention.trim().toLowerCase();
}

function cameBackTo(input: WeeklyPatternInput, first: LocalDate): WeeklyNotePattern[] {
  const said = new Map<string, string>();
  const daysThisWeek = new Map<string, Set<LocalDate>>();
  for (const day of input.week) {
    for (const mention of day.mentions) {
      const key = keyOf(mention);
      if (key.length === 0) {
        continue;
      }
      if (!said.has(key)) {
        said.set(key, mention.trim().slice(0, 120));
      }
      daysThisWeek.set(key, (daysThisWeek.get(key) ?? new Set()).add(day.date));
    }
  }
  const weeksBack = Math.floor(PATTERNS.historyDays / 7);
  const earlierWeeks = Array.from({ length: weeksBack }, (_, index) => {
    const days = window(input.history, first, 7 * (index + 1), 7 * index);
    return new Set(days.flatMap((day) => day.mentions.map(keyOf)));
  });
  const found: { pattern: WeeklyNotePattern; order: number }[] = [];
  for (const [key, dates] of daysThisWeek) {
    let weeks = 1;
    while (weeks <= earlierWeeks.length && earlierWeeks[weeks - 1]?.has(key)) {
      weeks += 1;
    }
    const text = said.get(key) as string;
    if (weeks >= PATTERNS.comebackWeeks) {
      found.push({
        pattern: { kind: "came_back_to", text, span: "weeks", times: weeks },
        order: 10 + weeks,
      });
    } else if (dates.size >= PATTERNS.comebackDays) {
      found.push({
        pattern: { kind: "came_back_to", text, span: "days", times: dates.size },
        order: dates.size,
      });
    }
  }
  // The most telling first, ties in the order she first said them.
  return found
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.order - a.order || a.index - b.index)
    .slice(0, PATTERNS.maxComebacks)
    .map((entry) => entry.pattern);
}

function mentionsPerDay(days: readonly PatternDay[]): number {
  const total = days.reduce((sum, day) => sum + new Set(day.mentions.map(keyOf)).size, 0);
  return total / days.length;
}

function mentionsLevel(week: readonly PatternDay[], base: readonly PatternDay[]) {
  const thisWeek = answered(week);
  const usual = answered(base);
  if (!enough(thisWeek, usual)) {
    return null;
  }
  const usualRate = mentionsPerDay(usual);
  if (usualRate < PATTERNS.minUsualMentions) {
    return null;
  }
  const ratio = mentionsPerDay(thisWeek) / usualRate;
  if (ratio >= PATTERNS.mentionsFactor) {
    return { kind: "mentions_level" as const, direction: "more" as const };
  }
  return ratio <= 1 / PATTERNS.mentionsFactor
    ? { kind: "mentions_level" as const, direction: "fewer" as const }
    : null;
}

function noReply(week: readonly PatternDay[]): FamilyPattern | null {
  const thisWeek = answered(week);
  const unanswered = thisWeek.filter((day) => day.familyReplies === 0).length;
  return unanswered === 0 ? null : { kind: "no_reply", answers: unanswered, of: thisWeek.length };
}

function asksBy(week: readonly PatternDay[]): FamilyPattern | null {
  const counts = new Map<string, number>();
  for (const day of week) {
    if (day.askType !== null && day.askType !== "hello" && day.askerName !== null) {
      counts.set(day.askerName, (counts.get(day.askerName) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    return null;
  }
  const askers = [...counts]
    .map(([name, asks]) => ({ name, asks }))
    .sort((a, b) => b.asks - a.asks || a.name.localeCompare(b.name));
  return { kind: "asks_by", askers: askers.slice(0, 20) };
}

function afterSecond(week: readonly PatternDay[], base: readonly PatternDay[]) {
  const count = answered(week).filter((day) => day.afterSecond).length;
  if (count < PATTERNS.minAfterSecond) {
    return null;
  }
  const delivered = base.filter((day) => day.delivered);
  const usual =
    answered(base).length >= PATTERNS.minBaselineAnswers && delivered.length >= 7
      ? Math.round((base.filter((day) => day.afterSecond).length * 7) / delivered.length)
      : null;
  if (usual !== null && count <= usual) {
    return null;
  }
  return { kind: "after_second" as const, answers: count, usual };
}

function quietWeekdays(input: WeeklyPatternInput): FamilyPattern[] {
  const all = [...input.history, ...input.week];
  const out: FamilyPattern[] = [];
  for (const day of input.week) {
    const weekday = weekdayOf(day.date);
    const sameWeekday = all
      .filter((other) => weekdayOf(other.date) === weekday)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    let weeks = 0;
    for (const other of sameWeekday) {
      if (!other.delivered || other.away || other.answerMinute !== null) {
        break;
      }
      weeks += 1;
    }
    if (weeks >= PATTERNS.quietWeekdayWeeks) {
      out.push({ kind: "quiet_weekday", weekday, weeks });
    }
  }
  return out;
}

/**
 * The note patterns and the family patterns of one week. Notes come in the order the read uses them:
 * time, form, length, voice, what drew her out, what she came back to, then how much came up.
 */
export function detectWeeklyPatterns(input: WeeklyPatternInput): WeeklyPatterns {
  const first = input.week[0]?.date;
  if (first === undefined) {
    return { notes: [], family: [] };
  }
  const base = window(input.history, first, PATTERNS.baselineDays);
  const voiceWeek = voiceOf(answered(input.week));
  const voiceBase = voiceOf(answered(base));
  const notes: (WeeklyNotePattern | null)[] = [
    answerTime(input, first),
    answerForm(input.week, base),
    (() => {
      const direction = lengthDirection(
        wordsOf(answered(input.week)),
        wordsOf(answered(base)),
        PATTERNS.minWeekAnswers,
        PATTERNS.minBaselineAnswers,
        PATTERNS.minUsualWords,
      );
      return direction === null ? null : { kind: "answer_length" as const, direction };
    })(),
    (() => {
      const direction = lengthDirection(
        voiceWeek,
        voiceBase,
        PATTERNS.minWeekVoice,
        PATTERNS.minBaselineVoice,
        1,
      );
      return direction === null ? null : { kind: "voice_length" as const, direction };
    })(),
    drewOut(input.week),
    ...cameBackTo(input, first),
    mentionsLevel(input.week, base),
  ];
  const family: (FamilyPattern | null)[] = [
    noReply(input.week),
    asksBy(input.week),
    afterSecond(input.week, base),
    ...quietWeekdays(input),
  ];
  return {
    notes: notes.filter((pattern): pattern is WeeklyNotePattern => pattern !== null),
    family: family.filter((pattern): pattern is FamilyPattern => pattern !== null),
  };
}
