/**
 * The patterns the weekly read reports (ADR-46, spec §13): facts that `detectWeeklyPatterns` in
 * @vela/core finds by comparing her week with her own earlier weeks, never with other people. Each
 * carries the specifics behind it (the days, the times, the people and places, the asks), so the
 * read can say exactly what changed rather than that something did.
 *
 * Note patterns are worded by the AI into the lines of the read, which she can read too (spec §9), so
 * every date in one is a day she answered and none points to a day without an answer. Family patterns
 * are rendered from copy for organisers only, beside the counts, and never reach her or the model.
 * Neither kind carries a health word, a mood label, a cause, or advice.
 */
import { z } from "zod";
import { ExchangeType, LocalDate, LocalTime } from "./domain.ts";

/** How she answered: spoken, written, a tap on a button, or a photo of her own. */
export const ANSWER_FORMS = ["voice", "words", "taps", "photos"] as const;
export const AnswerForm = z.enum(ANSWER_FORMS);
export type AnswerForm = z.infer<typeof AnswerForm>;

/**
 * How long her written or spoken answers ran, as a reader would put it: a word or two, a few words,
 * a sentence or two, a few sentences, long messages.
 */
export const ANSWER_LENGTHS = ["word", "few_words", "sentence", "few_sentences", "long"] as const;
export const AnswerLength = z.enum(ANSWER_LENGTHS);
export type AnswerLength = z.infer<typeof AnswerLength>;

const Direction = <A extends string, B extends string>(a: A, b: B) => z.enum([a, b]);

/** Something she said, as she said it: a person, a place or a plan, never a health word. */
const MentionText = z.string().min(1).max(120);

/** Days she answered this week that a pattern is about, oldest first. */
const AnsweredDates = z.array(LocalDate).min(1).max(7);

export const WeeklyNotePattern = z.discriminatedUnion("kind", [
  /** Her usual answer time moved by more than the threshold against her earlier weeks. */
  z.strictObject({
    kind: z.literal("answer_time"),
    direction: Direction("later", "earlier"),
    /** Her usual time in the weeks before, and this week's. */
    usual: LocalTime,
    thisWeek: LocalTime,
    /** True when the week before moved the same way too. */
    secondWeek: z.boolean(),
    /** The day furthest that way, when it stood out from the rest of the week. */
    standout: z.strictObject({ date: LocalDate, time: LocalTime }).nullable(),
  }),
  /** A form of answer she used on many more (or fewer) of her answered days than she usually does. */
  z.strictObject({
    kind: z.literal("answer_form"),
    more: AnswerForm.nullable(),
    fewer: AnswerForm.nullable(),
    /** The days she answered with `more`; empty when only `fewer` moved. */
    moreDates: z.array(LocalDate).max(7),
  }),
  /** How long her written and spoken answers ran, against her usual; reported only when it reads differently. */
  z.strictObject({
    kind: z.literal("answer_length"),
    direction: Direction("longer", "shorter"),
    usual: AnswerLength,
    thisWeek: AnswerLength,
  }),
  /** Her voice messages' length against her usual, in seconds rounded to five. */
  z.strictObject({
    kind: z.literal("voice_length"),
    direction: Direction("longer", "shorter"),
    usualSeconds: z.number().int().positive(),
    thisWeekSeconds: z.number().int().positive(),
  }),
  /** The kind of ask that drew her fullest answers this week, and the days of those asks. */
  z.strictObject({
    kind: z.literal("drew_out"),
    askType: ExchangeType.exclude(["hello"]),
    dates: AnsweredDates,
  }),
  /** Something she came back to on several days this week, or in several weeks in a row. */
  z.strictObject({
    kind: z.literal("came_back_to"),
    text: MentionText,
    span: Direction("days", "weeks"),
    /** Days this week, or weeks in a row including this one. */
    times: z.number().int().min(2).max(7),
    /** The days this week it came up. */
    dates: AnsweredDates,
  }),
  /** People, places or plans that were part of her usual weeks and did not come up this week. */
  z.strictObject({
    kind: z.literal("usual_absent"),
    items: z.array(MentionText).min(1).max(3),
  }),
  /** People, places or plans that came up this week and never in the weeks before. */
  z.strictObject({
    kind: z.literal("new_mentions"),
    items: z.array(MentionText).min(1).max(3),
  }),
]);
export type WeeklyNotePattern = z.infer<typeof WeeklyNotePattern>;

/** Days of the week a family pattern names, oldest first. */
const WeekDates = z.array(LocalDate).min(1).max(7);

export const FamilyPattern = z.discriminatedUnion("kind", [
  /** Her answers that got no reply and no reaction from the family, by day. */
  z.strictObject({
    kind: z.literal("no_reply"),
    dates: WeekDates,
    /** The days she answered, so a long list can be read as a part of them. */
    of: z.number().int().min(1).max(7),
  }),
  /** The family's asks this week, by who asked, most first, and who took turns but asked nothing. */
  z.strictObject({
    kind: z.literal("asks_by"),
    askers: z
      .array(z.strictObject({ name: z.string().min(1).max(80), asks: z.number().int().min(1) }))
      .min(1)
      .max(20),
    none: z.array(z.string().min(1).max(80)).max(20),
  }),
  /** The days she answered only after the second message, with her usual weekly number when known. */
  z.strictObject({
    kind: z.literal("after_second"),
    dates: WeekDates,
    usual: z.number().int().min(0).max(7).nullable(),
  }),
  /** A weekday whose morning stayed quiet several weeks in a row, away days aside. */
  z.strictObject({
    kind: z.literal("quiet_weekday"),
    /** 0 is Sunday, as `weekdayOf` numbers the days. */
    weekday: z.number().int().min(0).max(6),
    weeks: z.number().int().min(2).max(8),
  }),
]);
export type FamilyPattern = z.infer<typeof FamilyPattern>;
