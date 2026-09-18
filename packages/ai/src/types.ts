/**
 * Inputs and outputs of every AI call, as Zod schemas with inferred types, plus the `Ai` and `Stt`
 * ports services depend on. Output schemas double as the structured-output contract sent to
 * Claude, so they use nullable fields rather than optional ones: the model always states "none".
 *
 * No input carries a phone number, billing data, or a nearby contact (spec §17).
 */
import {
  AgeBand,
  AnswerKind,
  ExchangeType,
  Lang,
  LocalDate,
  LocalTime,
  ReplyKind,
} from "@vela/contracts";
import { z } from "zod";

export const AI_CALL_NAMES = [
  "understand",
  "flag",
  "chips",
  "suggest",
  "translate",
  "readback",
  "hello",
  "weekly_read",
] as const;
export const AiCallName = z.enum(AI_CALL_NAMES);
export type AiCallName = z.infer<typeof AiCallName>;

/** One logged provider call; it carries counts and codes, never content (spec §17). */
export interface AiCallRecord {
  call: AiCallName | "transcribe";
  promptVersion: string;
  /** The model that produced the result; differs from the route when a fallback model served it. */
  model: string;
  ok: boolean;
  /** Every input token: uncached, written to the cache, and read from the cache. */
  tokensIn: number;
  tokensOut: number;
  /** The share of `tokensIn` read from the prompt cache. */
  tokensCached: number;
  latencyMs: number;
  costUsd: number;
  /** A short failure code such as `refusal`, `http_529`, or `schema_invalid`; never content. */
  error?: string;
}

export type AiOutcome<T> =
  | { ok: true; value: T; record: AiCallRecord }
  | { ok: false; value: T; record: AiCallRecord; error: string }
  | AiOffOutcome<T>;

/**
 * What every call resolves with while AI is off (`createOffAi`; the Workers' `AI_PROVIDER` "off"):
 * the call's safe default, and no record, because no provider was called. It is not a failure, so
 * it carries no error: services take the path a failed call takes, without logging a call that
 * never happened.
 */
export interface AiOffOutcome<T> {
  ok: false;
  value: T;
  record: null;
}

/** Whether AI was off for this outcome, rather than a provider having been called. */
export function isAiOff<T>(outcome: AiOutcome<T>): outcome is AiOffOutcome<T> {
  return outcome.record === null;
}

/**
 * The longest text an input field keeps, in UTF-16 code units. Names and family text come from people
 * (a Telegram message holds 4096 characters, a transcript has no bound), so a longer value is shortened
 * to the limit before validation instead of rejecting the call as a programming error.
 */
export const INPUT_TEXT_LIMITS = { name: 80, familyText: 4000, shortText: 300 } as const;

function clampTo(limit: number): (text: string) => string {
  return (text) => {
    if (text.length <= limit) {
      return text;
    }
    const kept = text.slice(0, limit);
    const last = kept.charCodeAt(kept.length - 1);
    // A high surrogate at the cut would be half a character, such as half an emoji.
    return last >= 0xd800 && last <= 0xdbff ? kept.slice(0, -1) : kept;
  };
}

const Name = z.string().trim().overwrite(clampTo(INPUT_TEXT_LIMITS.name)).min(1);
const FamilyText = z.string().overwrite(clampTo(INPUT_TEXT_LIMITS.familyText));
const ShortText = z.string().overwrite(clampTo(INPUT_TEXT_LIMITS.shortText));

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export const Weekday = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof Weekday>;

/** The ask she is answering, as the family wrote it. */
export const AskContext = z.object({
  askerName: Name,
  type: ExchangeType,
  text: FamilyText.nullable(),
});
export type AskContext = z.infer<typeof AskContext>;

/** Her answer as text: typed text, a transcript, a chip label, a vote option, or "I'm fine". */
export const AnswerContent = z.object({
  kind: AnswerKind,
  text: FamilyText.min(1),
});
export type AnswerContent = z.infer<typeof AnswerContent>;

// understand ---------------------------------------------------------------------------------------

export const UnderstandInput = z.object({
  /** Her language. */
  lang: Lang,
  /** The language the summary line is written in: the family's language. */
  summaryLang: Lang,
  /** How the family addresses her, e.g. "Mom" or "阿嬤". */
  addressForm: Name,
  /** Her local date when she answered, so "until Sunday" resolves to a date. */
  today: LocalDate,
  todayWeekday: Weekday,
  ask: AskContext.nullable(),
  answer: AnswerContent,
  /** Her last three summary lines, oldest first. */
  recentSummaries: z.array(ShortText).max(3),
  /**
   * Whether she has agreed that Vela may carry her words about her health (consent kind
   * `health_words`, ADR-27), as the consent stood for this answer. Without it the understanding
   * keeps no health mention, no `unwell`, and no health in the summary.
   */
  healthWordsConsent: z.boolean(),
});
export type UnderstandInput = z.infer<typeof UnderstandInput>;

/**
 * The fixed mood vocabulary (spec §5.2). Only words she clearly expressed are returned. Awaiting
 * product review; changing it changes the prompt version.
 */
export const MOOD_WORDS = [
  "cheerful",
  "calm",
  "content",
  "proud",
  "grateful",
  "excited",
  "nostalgic",
  "busy",
  "tired",
  "bored",
  "worried",
  "sad",
  "lonely",
  "irritated",
  "unwell",
] as const;
export const MoodWord = z.enum(MOOD_WORDS);
export type MoodWord = z.infer<typeof MoodWord>;

const MentionList = z.array(z.string().min(1).max(120)).max(10);

export const Mentions = z.object({
  people: MentionList,
  places: MentionList,
  plans: MentionList,
  /**
   * The body words she used ("knee hurts", "fell", "doctor"), never the name of a diagnosis, a test
   * result, or a medicine; empty without her health-words consent (ADR-27).
   */
  health: MentionList,
  dates: MentionList,
});
export type Mentions = z.infer<typeof Mentions>;

/**
 * How far ahead of her answer a detected away may start or end. A misread or injected date must not
 * switch off repeats and quiet notices for months; a longer trip is set by the family.
 */
export const AWAY_HORIZON_DAYS = 90;

export const Understanding = z.object({
  /** One neutral line in `summaryLang`. */
  summary: z.string().min(1).max(200),
  moodWords: z.array(MoodWord).max(3),
  mentions: Mentions,
  /**
   * Set when she says she will be away (spec §8). `from` is the first date away, which can be weeks
   * after her answer, so an away never covers the days she is still at home; it is never before
   * `today`, and neither date is more than `AWAY_HORIZON_DAYS` after it. `until` is null for "until
   * I'm back", which ends on her first answer on or after `from`.
   */
  away: z.object({ from: LocalDate, until: LocalDate.nullable() }).nullable(),
  /** BCP-47 tag of the language she answered in. */
  language: z.string().min(2).max(35),
});
export type Understanding = z.infer<typeof Understanding>;

// flag ---------------------------------------------------------------------------------------------

export const FlagInput = z.object({
  lang: Lang,
  addressForm: Name,
  ask: AskContext.nullable(),
  answer: AnswerContent,
  recentSummaries: z.array(ShortText).max(3),
});
export type FlagInput = z.infer<typeof FlagInput>;

/** Spec §5.5. */
export const FLAG_CATEGORIES = [
  "health",
  "hopelessness",
  "stranger_at_door",
  "scam_contact",
  "money_request",
] as const;
export const FlagCategory = z.enum(FLAG_CATEGORIES);
export type FlagCategory = z.infer<typeof FlagCategory>;

export const FLAG_SEVERITIES = ["concern", "urgent"] as const;
export const FlagSeverity = z.enum(FLAG_SEVERITIES);
export type FlagSeverity = z.infer<typeof FlagSeverity>;

export const FlagResult = z.object({
  flag: z.boolean(),
  category: FlagCategory.nullable(),
  severity: FlagSeverity.nullable(),
  /** An exact excerpt of her answer; the organiser notice quotes it verbatim. */
  evidenceQuote: z.string().min(1).max(500).nullable(),
});
export type FlagResult = z.infer<typeof FlagResult>;

// chips --------------------------------------------------------------------------------------------

export const ChipsInput = z.object({
  /** Her language; chips are only ever shown to her. */
  lang: Lang,
  askerName: Name,
  question: FamilyText.min(1),
  /** Her most recent answers, newest first. Fewer than five means generic chips (spec §5.3). */
  pastAnswers: z.array(ShortText).max(20),
});
export type ChipsInput = z.infer<typeof ChipsInput>;

export const Chips = z.object({
  chips: z.array(z.string().trim().min(1).max(24)).length(3),
});
export type Chips = z.infer<typeof Chips>;

// suggest ------------------------------------------------------------------------------------------

/** Every exchange type a person can ask; the hello is Vela's own and never suggested. */
export const SUGGEST_TYPES = [
  "question",
  "photo_choice",
  "voice_note",
  "word",
  "story",
  "recipe",
  "memory_photo",
  "vote",
] as const satisfies readonly ExchangeType[];
export const SuggestType = z.enum(SUGGEST_TYPES);
export type SuggestType = z.infer<typeof SuggestType>;

export const SUGGESTION_SOURCES = ["mention", "date", "last_ask", "rotation"] as const;
export const SuggestionSource = z.enum(SUGGESTION_SOURCES);
export type SuggestionSource = z.infer<typeof SuggestionSource>;

export const SuggestInput = z.object({
  /** The turn holder's language. */
  lang: Lang,
  holderName: Name,
  /** How the holder addresses her, e.g. "Mom" or "外婆". */
  recipientAddress: Name,
  /** The local date the ask would arrive. */
  forDate: LocalDate,
  /** The type the weekly rotation proposes (spec §7). */
  rotationType: SuggestType,
  /** Things she mentioned recently, in her words. */
  recentMentions: z.array(z.string().max(120)).max(20),
  familyDates: z.array(z.object({ date: LocalDate, label: z.string().min(1).max(80) })).max(10),
  holderLastAsk: z.object({ type: ExchangeType, text: FamilyText.nullable() }).nullable(),
});
export type SuggestInput = z.infer<typeof SuggestInput>;

export const Suggestion = z.object({
  type: SuggestType,
  /** The ask itself in the holder's voice, ready to send with one tap. */
  text: z.string().min(1).max(200),
  source: SuggestionSource,
});
export type Suggestion = z.infer<typeof Suggestion>;

// translate ----------------------------------------------------------------------------------------

export const TranslationParty = z.object({
  name: Name,
  ageBand: AgeBand,
  /** How the other party addresses this person in the target language, e.g. "阿嬤"; null if unknown. */
  addressForm: Name.nullable(),
});
export type TranslationParty = z.infer<typeof TranslationParty>;

export const TranslateInput = z.object({
  text: FamilyText.min(1),
  from: Lang,
  to: Lang,
  speaker: TranslationParty,
  listener: TranslationParty,
  /** Who speaks to whom, e.g. "granddaughter to her grandmother". */
  relationship: z.string().min(1).max(100),
});
export type TranslateInput = z.infer<typeof TranslateInput>;

export const Translation = z.object({
  text: z.string().min(1).max(8000),
});
export type Translation = z.infer<typeof Translation>;

// readback and hello -------------------------------------------------------------------------------

/** A reply addressed to her; replies between other members never reach these calls (spec §6.1). */
export const ReplyItem = z.object({
  name: Name,
  kind: ReplyKind,
  text: FamilyText.nullable(),
});
export type ReplyItem = z.infer<typeof ReplyItem>;

export const ReadbackInput = z.object({
  /** Her language. */
  lang: Lang,
  addressForm: Name,
  /** What she answered yesterday, e.g. its summary line, so the lines can refer to it. */
  answerGist: ShortText.nullable(),
  replies: z.array(ReplyItem).min(1).max(30),
  /** Members who listened to her answer. Names only; never counts (spec §6.4). */
  listenedBy: z.array(Name).max(20),
});
export type ReadbackInput = z.infer<typeof ReadbackInput>;

export const ReadbackLines = z.object({
  lines: z.array(z.string().min(1).max(300)).min(1).max(4),
});
export type ReadbackLines = z.infer<typeof ReadbackLines>;

export const HelloInput = z.object({
  /** Her language. */
  lang: Lang,
  addressForm: Name,
  /** Yesterday's replies to her, possibly none. */
  replies: z.array(ReplyItem).max(30),
  listenedBy: z.array(Name).max(20),
});
export type HelloInput = z.infer<typeof HelloInput>;

/** One or two lines: the reply or morning line is optional, the closing line is not. */
export const HelloLines = z.object({
  lines: z.array(z.string().min(1).max(300)).min(1).max(2),
});
export type HelloLines = z.infer<typeof HelloLines>;

// weekly read --------------------------------------------------------------------------------------

/**
 * A day she answered. Days without an answer are not part of the input: the lines she can read never
 * point to one (spec §8), and a model that is not shown them cannot.
 */
export const WeeklyDay = z.object({
  date: LocalDate,
  answeredAt: LocalTime,
  /** Who asked; null when the morning was the fallback hello. */
  askerName: Name.nullable(),
  askType: ExchangeType.nullable(),
  summary: ShortText.nullable(),
  voiceSeconds: z.number().nonnegative().nullable(),
});
export type WeeklyDay = z.infer<typeof WeeklyDay>;

/**
 * Drifts and repeated mentions are computed by services; the model only words them. The week's
 * counts (days answered, mornings nobody asked, the family's asks) are not part of the input:
 * `renderWeeklyRead` in @vela/core writes them from `weekly_reads.stats` for organisers, so a model
 * can neither misstate them nor show them to her (spec §8, §13).
 */
export const WeeklyReadInput = z.object({
  /** The reader's language. */
  lang: Lang,
  /** How the reader refers to her, e.g. "Mom". */
  elderName: Name,
  weekEnd: LocalDate,
  /** The days she answered this week, oldest first; empty when she answered none. */
  days: z.array(WeeklyDay).max(7),
  usualAnswerTime: LocalTime.nullable(),
  /** Minutes later (positive) or earlier (negative) than last week's usual time. */
  answerTimeDriftMinutes: z.number().int().nullable(),
  /** Percent longer (positive) or shorter (negative) voice answers than last week. */
  voiceLengthDriftPercent: z.number().nullable(),
  /** Things mentioned on two or more days. */
  repeatedMentions: z.array(z.string().max(120)).max(10),
});
export type WeeklyReadInput = z.infer<typeof WeeklyReadInput>;

/**
 * Zero to four lines about her week and one suggestion. A week with nothing to say is no lines, not a
 * failure. The lines never state or imply how many days she answered, a morning nobody asked, or the
 * family's asks: organisers read those from numbers, and she reads the lines without them (spec §8,
 * §13). The suggestion goes to organisers only, since it is an ask meant to reach her as a surprise.
 */
export const WeeklyRead = z.object({
  lines: z.array(z.string().min(1).max(300)).max(4),
  suggestion: z.string().min(1).max(200),
});
export type WeeklyRead = z.infer<typeof WeeklyRead>;

// ports --------------------------------------------------------------------------------------------

/** The input and output types of each call, keyed by call name. */
export interface AiCallTypes {
  understand: { input: UnderstandInput; output: Understanding };
  flag: { input: FlagInput; output: FlagResult };
  chips: { input: ChipsInput; output: Chips };
  suggest: { input: SuggestInput; output: Suggestion };
  translate: { input: TranslateInput; output: Translation };
  readback: { input: ReadbackInput; output: ReadbackLines };
  hello: { input: HelloInput; output: HelloLines };
  weekly_read: { input: WeeklyReadInput; output: WeeklyRead };
}

/** Each call's input schema; every `Ai`, the fake included, parses its input with it. */
export const INPUT_SCHEMAS: { readonly [K in AiCallName]: z.ZodType<AiCallTypes[K]["input"]> } = {
  understand: UnderstandInput,
  flag: FlagInput,
  chips: ChipsInput,
  suggest: SuggestInput,
  translate: TranslateInput,
  readback: ReadbackInput,
  hello: HelloInput,
  weekly_read: WeeklyReadInput,
};

/** Each call's output schema, which is also the structured-output format sent to Claude. */
export const OUTPUT_SCHEMAS: { readonly [K in AiCallName]: z.ZodType<AiCallTypes[K]["output"]> } = {
  understand: Understanding,
  flag: FlagResult,
  chips: Chips,
  suggest: Suggestion,
  translate: Translation,
  readback: ReadbackLines,
  hello: HelloLines,
  weekly_read: WeeklyRead,
};

/**
 * Never rejects for provider failures: a failed call resolves `ok: false` with a safe default. While
 * AI is off, every call resolves `AiOffOutcome`: the same safe default, and no record.
 * Invalid input is a programming error and rejects; text beyond `INPUT_TEXT_LIMITS` is shortened
 * first, because it comes from people.
 */
export interface Ai {
  understand(input: UnderstandInput): Promise<AiOutcome<Understanding>>;
  flag(input: FlagInput): Promise<AiOutcome<FlagResult>>;
  chips(input: ChipsInput): Promise<AiOutcome<Chips>>;
  suggest(input: SuggestInput): Promise<AiOutcome<Suggestion>>;
  translate(input: TranslateInput): Promise<AiOutcome<Translation>>;
  readback(input: ReadbackInput): Promise<AiOutcome<ReadbackLines>>;
  hello(input: HelloInput): Promise<AiOutcome<HelloLines>>;
  weeklyRead(input: WeeklyReadInput): Promise<AiOutcome<WeeklyRead>>;
}

export interface TranscribeInput {
  audio: ArrayBuffer;
  mime: string;
  /** Her language; null asks the provider to detect it. */
  languageHint: Lang | null;
}

export interface Transcription {
  ok: boolean;
  text: string;
  /** BCP-47 tag of the transcript's language, or null when unknown. */
  language: string | null;
  confidence: number | null;
  record: AiCallRecord;
}

/** Never rejects for provider failures: a failed transcription resolves `ok: false` with empty text. */
export interface Stt {
  transcribe(input: TranscribeInput): Promise<Transcription>;
}
