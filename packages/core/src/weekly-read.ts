/**
 * The weekly read as each audience receives it (spec §8, §13).
 *
 * Organisers get the week's counts first, rendered from `weekly_reads.stats` through copy rather than
 * written by the model, so a number can never be misstated: how many of the counted days she
 * answered, then, when it applies, on how many mornings nobody in the family asked so Vela sent the
 * hello, or that nobody in the family asked anything this week. The lines the founder sent follow,
 * then the suggestion.
 *
 * She gets only the lines, when she asks what the family sees. She is never shown missed days (spec
 * §8), so the counts and the nobody-asked line never reach her, and neither does the suggestion: it
 * is an ask meant to reach her as a surprise. A read with no lines has nothing to show her.
 */
import type { FamilyPattern, Lang, LocalDate } from "@vela/contracts";
import { type MessageKey, t } from "@vela/copy";
import { lineCap, shorten, TEXT_MAX_LENGTH } from "./text.ts";
import { weekdayOf } from "./time.ts";
import type { WeeklyHealthMention } from "./weekly-patterns.ts";

export type WeeklyReadAudience = "organiser" | "kept_light_member";

/** The week's counts, as services keep them in `weekly_reads.stats`; never output of the model. */
export interface WeeklyReadStats {
  /** The days counted: seven, or in a first week only the days on or after `light_starts_on`. */
  countedDays: number;
  /** The counted days she answered. */
  answeredDays: number;
  /** The counted mornings nobody in the family asked, so Vela sent the fallback hello. */
  helloMornings: number;
  /** The asks the family composed this week. */
  familyAsks: number;
  /**
   * What `detectWeeklyPatterns` found about the family's part and her quiet days (ADR-46): rendered
   * from copy after the counts, for organisers only; absent on reads drafted before patterns.
   */
  familyPatterns?: readonly FamilyPattern[];
}

export interface RenderWeeklyReadInput {
  /** The reader's language: the family's for organisers, hers for her. */
  lang: Lang;
  /** Her name as the reader calls her, e.g. "Mom" or "阿嬤". */
  name: string;
  stats: WeeklyReadStats;
  /** The lines about her week as sent, in the reader's language; possibly none. */
  lines: readonly string[];
  /** The suggestion as sent; empty when there is none. */
  suggestion: string;
  /**
   * Her own health words that came up on several days, when she agreed to them for the weekly read
   * and the founder sent them (ADR-47): lines from copy after the lines, for both audiences.
   */
  health?: readonly WeeklyHealthMention[];
  audience: WeeklyReadAudience;
}

/** A week has seven days, so no count of days or mornings can exceed it. */
const DAYS_IN_WEEK = 7;

function isCount(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * Stats come from a JSON column, so a corrupt row must stop the send rather than tell organisers she
 * answered 9 of 7 days.
 */
function assertStats(stats: WeeklyReadStats): void {
  const { countedDays, answeredDays, helloMornings, familyAsks } = stats;
  const valid =
    isCount(countedDays, DAYS_IN_WEEK) &&
    countedDays >= 1 &&
    isCount(answeredDays, countedDays) &&
    isCount(helloMornings, countedDays) &&
    isCount(familyAsks, Number.MAX_SAFE_INTEGER);
  if (!valid) {
    throw new RangeError(`Weekly read stats are out of range: ${JSON.stringify(stats)}`);
  }
}

function weekdayKey(weekday: number): MessageKey {
  return `weekday.${weekday}` as MessageKey;
}

/** "A", "A and B", "A, B and C", in the reader's language. */
function listOf(lang: Lang, items: readonly string[]): string {
  const last = items.at(-1) ?? "";
  return items.length <= 1
    ? last
    : `${items.slice(0, -1).join(t(lang, "weekly_read.list_separator"))}${t(lang, "weekly_read.list_and")}${last}`;
}

/** The days of one week by their weekday names, which are unique within it. */
function daysOf(lang: Lang, dates: readonly LocalDate[]): string {
  return listOf(
    lang,
    dates.map((date) => t(lang, weekdayKey(weekdayOf(date)))),
  );
}

/** Up to this many days are named; more read as a count. */
const MAX_NAMED_DAYS = 3;

/** The organiser lines of one family pattern. */
function familyLine(lang: Lang, name: string, pattern: FamilyPattern): string[] {
  switch (pattern.kind) {
    case "no_reply":
      if (pattern.dates.length === 1) {
        return [
          t(lang, "weekly_read.no_reply_day", { name, weekday: daysOf(lang, pattern.dates) }),
        ];
      }
      return [
        pattern.dates.length <= MAX_NAMED_DAYS
          ? t(lang, "weekly_read.no_reply_days", {
              name,
              weekdays: daysOf(lang, pattern.dates),
            })
          : t(lang, "weekly_read.no_reply", {
              name,
              count: pattern.dates.length,
              answered: pattern.of,
            }),
      ];
    case "asks_by":
      return [
        t(lang, "weekly_read.asks_by", {
          askers: pattern.askers
            .map((asker) => t(lang, "weekly_read.asks_by_item", asker))
            .join(t(lang, "weekly_read.list_separator")),
        }),
        ...(pattern.none.length === 0
          ? []
          : [t(lang, "weekly_read.asks_none", { names: listOf(lang, pattern.none) })]),
      ];
    case "after_second": {
      const weekdays = daysOf(lang, pattern.dates);
      return [
        pattern.usual === null
          ? t(lang, "weekly_read.after_second", { name, weekdays })
          : t(lang, "weekly_read.after_second_usual", { name, weekdays, usual: pattern.usual }),
      ];
    }
    case "quiet_weekday":
      return [
        t(lang, "weekly_read.quiet_weekday", {
          weekday: t(lang, weekdayKey(pattern.weekday)),
          weeks: pattern.weeks,
        }),
      ];
  }
}

/** One line per health word she came back to, quoting her words, naming the days when three or fewer. */
export function weeklyHealthLines(
  lang: Lang,
  name: string,
  health: readonly WeeklyHealthMention[],
): string[] {
  return health.map((mention) =>
    mention.dates.length <= MAX_NAMED_DAYS
      ? t(lang, "weekly_read.health_days", {
          name,
          words: mention.words,
          weekdays: daysOf(lang, mention.dates),
        })
      : t(lang, "weekly_read.health_more", { name, words: mention.words }),
  );
}

/** The organiser lines of the family patterns, in the order they were found. */
export function familyLines(
  lang: Lang,
  name: string,
  patterns: readonly FamilyPattern[],
): string[] {
  return patterns.flatMap((pattern) => familyLine(lang, name, pattern));
}

function countLines(lang: Lang, name: string, stats: WeeklyReadStats): string[] {
  const { countedDays, answeredDays, helloMornings, familyAsks } = stats;
  const answeredKey = countedDays === 1 ? "weekly_read.answered_one" : "weekly_read.answered";
  const lines = [t(lang, answeredKey, { name, answered: answeredDays, days: countedDays })];
  // With no asks at all, every morning was the hello, and one plain line says so instead of a count.
  if (familyAsks === 0) {
    lines.push(t(lang, "weekly_read.nobody_asked", { name }));
  } else if (helloMornings > 0) {
    const helloKey =
      helloMornings === 1 ? "weekly_read.hello_mornings_one" : "weekly_read.hello_mornings";
    lines.push(t(lang, helloKey, { name, mornings: helloMornings }));
  }
  return [...lines, ...familyLines(lang, name, stats.familyPatterns ?? [])];
}

/** Paragraphs separated by a blank line: the counts, the lines, the suggestion, each when present. */
function compose(
  lang: Lang,
  counts: readonly string[],
  lines: readonly string[],
  suggestion: string,
): string {
  const paragraphs = [
    counts,
    lines,
    suggestion.length > 0 ? [t(lang, "weekly_read.suggestion", { suggestion })] : [],
  ];
  return paragraphs
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => paragraph.join("\n"))
    .join("\n\n");
}

/**
 * The read within `OutboundMessage`'s limit. An over-long read would make the platform refuse the
 * whole message, so the founder's lines and the suggestion share what room is left, the longest
 * shortened first; the counts and the copy around them are never shortened, and nothing is dropped.
 */
function fitText(
  lang: Lang,
  counts: readonly string[],
  lines: readonly string[],
  suggestion: string,
): string {
  const full = compose(lang, counts, lines, suggestion);
  if (full.length <= TEXT_MAX_LENGTH) {
    return full;
  }
  const shortenable = suggestion.length > 0 ? [...lines, suggestion] : lines;
  const shortenableLength = shortenable.reduce((sum, text) => sum + text.length, 0);
  const cap = lineCap(shortenable, TEXT_MAX_LENGTH - (full.length - shortenableLength));
  return compose(
    lang,
    counts,
    lines.map((line) => shorten(line, cap)),
    suggestion.length > 0 ? shorten(suggestion, cap) : "",
  );
}

/**
 * The read as plain text for one audience, or null when that audience has nothing to see, which is
 * only her copy of a read without lines. Lines that are blank are left out.
 */
export function renderWeeklyRead(input: RenderWeeklyReadInput): string | null {
  const lines = [
    ...input.lines,
    ...weeklyHealthLines(input.lang, input.name.trim(), input.health ?? []),
  ]
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (input.audience === "kept_light_member") {
    return lines.length === 0 ? null : fitText(input.lang, [], lines, "");
  }
  assertStats(input.stats);
  return fitText(
    input.lang,
    countLines(input.lang, input.name.trim(), input.stats),
    lines,
    input.suggestion.trim(),
  );
}
