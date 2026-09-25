/**
 * What Ask needs (spec §14.1 A7). The suggestion comes from her own words, and the API route that
 * will serve it, GET /v1/families/:id/suggestions, does not exist yet (API contract §4). Labels are
 * message descriptors, so a screen shows them in the app's language (build plan 3.1).
 */

import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import type { ComposableExchangeType } from "@vela/contracts";

export type AskType = "question" | "two_photos" | "voice_note" | "word" | "old_photo" | "vote";

export interface AskTypeOption {
  kind: AskType;
  label: MessageDescriptor;
  /**
   * Available means this screen can compose it today. The route also takes a vote, but a vote
   * needs its options, and this screen has no field for them yet.
   */
  available: boolean;
}

export const askTypes: AskTypeOption[] = [
  { kind: "question", label: msg`A question`, available: true },
  { kind: "word", label: msg`A word to teach`, available: true },
  { kind: "vote", label: msg`A vote`, available: false },
  { kind: "two_photos", label: msg`Two photos`, available: false },
  { kind: "voice_note", label: msg`A voice note`, available: false },
  { kind: "old_photo", label: msg`An old photo`, available: false },
];

/** The name the contract gives each kind the screen can send. */
export const composableType: Partial<Record<AskType, ComposableExchangeType>> = {
  question: "question",
  word: "word",
};

export interface AskSuggestion {
  id: string;
  text: string;
}

/** The example day's suggestion, in the app's language like the rest of the example family. */
export function suggestionFixture(): AskSuggestion {
  return { id: "s1", text: t`Ask her about the seeds she saved from last year` };
}

export const recipientLanguage: MessageDescriptor = msg({
  comment: "the name of a language",
  message: "Russian",
});

/**
 * The live preview the composer shows in her language. The real screen calls the translation
 * endpoint; until that exists this stands in so the layout and the rule ("she reads her own
 * language") are real.
 */
export function previewTranslation(text: string): string {
  const words = text.trim();
  if (words.length === 0) return "";
  const language = i18n._(recipientLanguage);
  return t`${words} · shown to her in ${language}`;
}
