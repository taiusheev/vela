/**
 * The patterns the weekly read reports (ADR-46, spec §13): facts that `detectWeeklyPatterns` in
 * @vela/core finds by comparing her week with her own earlier weeks, never with other people.
 *
 * Note patterns are worded by the AI into the lines of the read, which she can read too (spec §9), so
 * none of them points to a day without an answer. Family patterns are rendered from copy for
 * organisers only, beside the counts, and never reach her or the model. Neither kind carries a health
 * word, a mood label, a cause, or advice.
 */
import { z } from "zod";
import { ExchangeType } from "./domain.ts";

/** How she answered: spoken, written, a tap on a button, or a photo of her own. */
export const ANSWER_FORMS = ["voice", "words", "taps", "photos"] as const;
export const AnswerForm = z.enum(ANSWER_FORMS);
export type AnswerForm = z.infer<typeof AnswerForm>;

const Direction = <A extends string, B extends string>(a: A, b: B) => z.enum([a, b]);

/** Something she said, as she said it: a person, a place, a plan or a date, never a health word. */
const MentionText = z.string().min(1).max(120);

export const WeeklyNotePattern = z.discriminatedUnion("kind", [
  /** Her usual answer time moved by more than the threshold against her earlier weeks. */
  z.strictObject({
    kind: z.literal("answer_time"),
    direction: Direction("later", "earlier"),
    /** Rounded to five minutes. */
    minutes: z.number().int().positive(),
    /** True when the week before moved the same way too. */
    secondWeek: z.boolean(),
  }),
  /** A form of answer she used on many more (or fewer) of her answered days than she usually does. */
  z.strictObject({
    kind: z.literal("answer_form"),
    more: AnswerForm.nullable(),
    fewer: AnswerForm.nullable(),
  }),
  /** Her written and spoken words per answer, against her usual. */
  z.strictObject({ kind: z.literal("answer_length"), direction: Direction("longer", "shorter") }),
  /** Her voice messages' length, against her usual. */
  z.strictObject({ kind: z.literal("voice_length"), direction: Direction("longer", "shorter") }),
  /** The kind of ask that drew her fullest answers this week. */
  z.strictObject({ kind: z.literal("drew_out"), askType: ExchangeType.exclude(["hello"]) }),
  /** Something she came back to on several days this week, or in several weeks in a row. */
  z.strictObject({
    kind: z.literal("came_back_to"),
    text: MentionText,
    span: Direction("days", "weeks"),
    /** Days this week, or weeks in a row including this one. */
    times: z.number().int().min(2).max(7),
  }),
  /** How many people, places and plans came up in her answers, against her usual. */
  z.strictObject({ kind: z.literal("mentions_level"), direction: Direction("more", "fewer") }),
]);
export type WeeklyNotePattern = z.infer<typeof WeeklyNotePattern>;

export const FamilyPattern = z.discriminatedUnion("kind", [
  /** Her answered days whose answer got no reply and no reaction from the family. */
  z.strictObject({
    kind: z.literal("no_reply"),
    answers: z.number().int().min(1).max(7),
    of: z.number().int().min(1).max(7),
  }),
  /** The family's asks this week, by who asked, most first. */
  z.strictObject({
    kind: z.literal("asks_by"),
    askers: z
      .array(z.strictObject({ name: z.string().min(1).max(80), asks: z.number().int().min(1) }))
      .min(1)
      .max(20),
  }),
  /** Answers that came only after the second message, with her usual weekly number when known. */
  z.strictObject({
    kind: z.literal("after_second"),
    answers: z.number().int().min(1).max(7),
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
