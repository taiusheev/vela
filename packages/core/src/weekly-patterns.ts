/**
 * The patterns of her week (ADR-46, spec §13): what changed against her own earlier weeks, found by
 * code with fixed thresholds and minimum samples, so the weekly read reports a pattern only when the
 * data shows one. The AI words the note patterns; it never decides that something is a pattern.
 *
 * Every comparison is with her own usual, never with other people, and is reported as a plain fact
 * with its specifics (the days, the times, the people and places): no score, no cause, no advice,
 * no health word and no mood label. Note patterns are about the days
 * she answered only, because she can read the lines they become (spec §8, §9). Family patterns may
 * count days without an answer or the family's own part, and are shown to organisers only.
 *
 * The comparisons stay inside the 30 days her words are kept: a week and the three weeks before it.
 * Only answer times and deliveries, which are kept longer, look back four weeks.
 */
import type {
  AnswerForm,
  AnswerLength,
  ExchangeType,
  FamilyPattern,
  LocalDate,
  LocalTime,
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
  /** A day stands out when its answer time is this far beyond the week's middle. */
  standoutMinutes: 20,
  /** A mention counts as came back to on this many days, or in this many weeks in a row. */
  comebackDays: 2,
  comebackWeeks: 3,
  maxComebacks: 5,
  /** Part of her usual weeks: said on this many days, in this many of the three weeks before. */
  usualMentionDays: 3,
  usualMentionWeeks: 2,
  /** At most this many people, places or plans are named as absent, or as new. */
  maxNamed: 3,
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
  /** People, places and plans she mentioned that day, as she said them; never health words. */
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
  /** The family members who take turns asking her, by name; who of them asked nothing is named. */
  familyNames?: readonly string[];
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

function medianMinute(days: readonly PatternDay[]): number | null {
  return median(answered(days).map((day) => day.answerMinute as number));
}

/** The signed move of the median answer time, or null when it is within the threshold or unknown. */
function timeShift(week: readonly PatternDay[], base: readonly PatternDay[]): number | null {
  if (!enough(answered(week), answered(base))) {
    return null;
  }
  const shift = (medianMinute(week) ?? 0) - (medianMinute(base) ?? 0);
  return Math.abs(shift) > PATTERNS.timeShiftMinutes ? shift : null;
}

/** Minutes after midnight as a time of day; rounded to five minutes when `round`. */
function timeOf(minutes: number, round = false): LocalTime {
  const value = round ? Math.round(minutes / 5) * 5 : Math.round(minutes);
  const inDay = ((value % 1440) + 1440) % 1440;
  const hours = String(Math.floor(inDay / 60)).padStart(2, "0");
  return `${hours}:${String(inDay % 60).padStart(2, "0")}`;
}

function answerTime(input: WeeklyPatternInput, first: LocalDate): WeeklyNotePattern | null {
  const base = window(input.history, first, PATTERNS.baselineDays);
  const shift = timeShift(input.week, base);
  if (shift === null) {
    return null;
  }
  const lastWeek = window(input.history, first, 7);
  const lastWeekShift = timeShift(lastWeek, window(input.history, first, PATTERNS.historyDays, 7));
  const middle = medianMinute(input.week) as number;
  const later = shift > 0;
  const furthest = answered(input.week).reduce((best, day) =>
    later
      ? (day.answerMinute as number) > (best.answerMinute as number)
        ? day
        : best
      : (day.answerMinute as number) < (best.answerMinute as number)
        ? day
        : best,
  );
  const beyond = Math.abs((furthest.answerMinute as number) - middle);
  return {
    kind: "answer_time",
    direction: later ? "later" : "earlier",
    usual: timeOf(medianMinute(base) as number, true),
    thisWeek: timeOf(middle, true),
    secondWeek: lastWeekShift !== null && Math.sign(lastWeekShift) === Math.sign(shift),
    standout:
      beyond >= PATTERNS.standoutMinutes
        ? { date: furthest.date, time: timeOf(furthest.answerMinute as number) }
        : null,
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
  const moreForm = more?.form ?? null;
  return {
    kind: "answer_form" as const,
    more: moreForm,
    fewer: fewer?.form ?? null,
    moreDates:
      moreForm === null
        ? []
        : thisWeek.filter((day) => day.forms.includes(moreForm)).map((day) => day.date),
  };
}

/** Her words as a reader would put their length. */
export function answerLengthOf(words: number): AnswerLength {
  if (words <= 2) return "word";
  if (words <= 8) return "few_words";
  if (words <= 30) return "sentence";
  return words <= 80 ? "few_sentences" : "long";
}

interface LengthChange {
  direction: "longer" | "shorter";
  usual: number;
  now: number;
}

function lengthChange(
  week: readonly number[],
  base: readonly number[],
  minWeek: number,
  minBase: number,
  minUsual: number,
): LengthChange | null {
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
    return { direction: "longer", usual, now };
  }
  return ratio <= 1 - PATTERNS.lengthShiftRatio ? { direction: "shorter", usual, now } : null;
}

function answerLength(week: readonly PatternDay[], base: readonly PatternDay[]) {
  const change = lengthChange(
    wordsOf(answered(week)),
    wordsOf(answered(base)),
    PATTERNS.minWeekAnswers,
    PATTERNS.minBaselineAnswers,
    PATTERNS.minUsualWords,
  );
  if (change === null) {
    return null;
  }
  const usual = answerLengthOf(change.usual);
  const thisWeek = answerLengthOf(change.now);
  // A change a reader would not see in the words ("a sentence or two" both weeks) is not reported.
  return usual === thisWeek
    ? null
    : { kind: "answer_length" as const, direction: change.direction, usual, thisWeek };
}

function seconds(value: number): number {
  return Math.max(5, Math.round(value / 5) * 5);
}

function voiceLength(week: readonly PatternDay[], base: readonly PatternDay[]) {
  const change = lengthChange(
    voiceOf(answered(week)),
    voiceOf(answered(base)),
    PATTERNS.minWeekVoice,
    PATTERNS.minBaselineVoice,
    1,
  );
  return change === null
    ? null
    : {
        kind: "voice_length" as const,
        direction: change.direction,
        usualSeconds: seconds(change.usual),
        thisWeekSeconds: seconds(change.now),
      };
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
  return {
    kind: "drew_out",
    askType: bestType,
    dates: asked.filter((day) => day.askType === bestType).map((day) => day.date),
  };
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
    const thisWeek = [...dates].sort();
    if (weeks >= PATTERNS.comebackWeeks) {
      found.push({
        pattern: { kind: "came_back_to", text, span: "weeks", times: weeks, dates: thisWeek },
        order: 10 + weeks,
      });
    } else if (dates.size >= PATTERNS.comebackDays) {
      found.push({
        pattern: { kind: "came_back_to", text, span: "days", times: dates.size, dates: thisWeek },
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

/** Each thing said in `days`, by its key: how she first spelled it, and the dates it came up. */
function mentionDates(
  days: readonly PatternDay[],
): Map<string, { text: string; dates: Set<LocalDate> }> {
  const found = new Map<string, { text: string; dates: Set<LocalDate> }>();
  for (const day of days) {
    for (const mention of day.mentions) {
      const key = keyOf(mention);
      if (key.length === 0) {
        continue;
      }
      const entry = found.get(key) ?? { text: mention.trim().slice(0, 120), dates: new Set() };
      entry.dates.add(day.date);
      found.set(key, entry);
    }
  }
  return found;
}

/** The most often said first, ties in the order she first said them, at most `PATTERNS.maxNamed`. */
function mostSaid(entries: readonly { text: string; dates: Set<LocalDate> }[]): string[] {
  return entries
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.dates.size - a.dates.size || a.index - b.index)
    .slice(0, PATTERNS.maxNamed)
    .map((entry) => entry.text);
}

/**
 * People, places and plans that were part of her usual weeks (said on three days, in two of the three
 * weeks before) and did not come up in a week she answered enough to tell.
 */
function usualAbsent(input: WeeklyPatternInput, first: LocalDate): WeeklyNotePattern | null {
  if (answered(input.week).length < PATTERNS.minWeekAnswers) {
    return null;
  }
  const thisWeek = mentionDates(input.week);
  const usual = [...mentionDates(window(input.history, first, PATTERNS.baselineDays))].filter(
    ([key, entry]) => {
      const weeks = new Set(
        [...entry.dates].map((date) => Math.floor((Date.parse(first) - Date.parse(date)) / 6048e5)),
      );
      return (
        !thisWeek.has(key) &&
        entry.dates.size >= PATTERNS.usualMentionDays &&
        weeks.size >= PATTERNS.usualMentionWeeks
      );
    },
  );
  const items = mostSaid(usual.map(([, entry]) => entry));
  return items.length === 0 ? null : { kind: "usual_absent", items };
}

/** People, places and plans that came up this week and in none of the four weeks before. */
function newMentions(
  input: WeeklyPatternInput,
  cameBack: readonly WeeklyNotePattern[],
): WeeklyNotePattern | null {
  if (answered(input.history).length < PATTERNS.minBaselineAnswers) {
    return null;
  }
  const before = mentionDates(input.history);
  const reported = new Set(
    cameBack.flatMap((pattern) => (pattern.kind === "came_back_to" ? [keyOf(pattern.text)] : [])),
  );
  const fresh = [...mentionDates(input.week)].filter(
    ([key]) => !before.has(key) && !reported.has(key),
  );
  const items = mostSaid(fresh.map(([, entry]) => entry));
  return items.length === 0 ? null : { kind: "new_mentions", items };
}

function noReply(week: readonly PatternDay[]): FamilyPattern | null {
  const thisWeek = answered(week);
  const dates = thisWeek.filter((day) => day.familyReplies === 0).map((day) => day.date);
  return dates.length === 0 ? null : { kind: "no_reply", dates, of: thisWeek.length };
}

function asksBy(week: readonly PatternDay[], familyNames: readonly string[]): FamilyPattern | null {
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
  const none = [...new Set(familyNames)].filter((name) => !counts.has(name)).sort();
  return { kind: "asks_by", askers: askers.slice(0, 20), none: none.slice(0, 20) };
}

function afterSecond(week: readonly PatternDay[], base: readonly PatternDay[]) {
  const dates = answered(week)
    .filter((day) => day.afterSecond)
    .map((day) => day.date);
  const count = dates.length;
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
  return { kind: "after_second" as const, dates, usual };
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
 * time, form, length, voice, what drew her out, what she came back to, what was missing, what was new.
 */
export function detectWeeklyPatterns(input: WeeklyPatternInput): WeeklyPatterns {
  const first = input.week[0]?.date;
  if (first === undefined) {
    return { notes: [], family: [] };
  }
  const base = window(input.history, first, PATTERNS.baselineDays);
  const cameBack = cameBackTo(input, first);
  const notes: (WeeklyNotePattern | null)[] = [
    answerTime(input, first),
    answerForm(input.week, base),
    answerLength(input.week, base),
    voiceLength(input.week, base),
    drewOut(input.week),
    ...cameBack,
    usualAbsent(input, first),
    newMentions(input, cameBack),
  ];
  const family: (FamilyPattern | null)[] = [
    noReply(input.week),
    asksBy(input.week, input.familyNames ?? []),
    afterSecond(input.week, base),
    ...quietWeekdays(input),
  ];
  return {
    notes: notes.filter((pattern): pattern is WeeklyNotePattern => pattern !== null),
    family: family.filter((pattern): pattern is FamilyPattern => pattern !== null),
  };
}
