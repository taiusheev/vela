/**
 * What Ask needs (spec §14.1 A7). The suggestion comes from her own words, and the API route that
 * will serve it, GET /v1/families/:id/suggestions, does not exist yet (API contract §4).
 */

import type { ComposableExchangeType } from "@vela/contracts";

export type AskType = "question" | "two_photos" | "voice_note" | "word" | "old_photo" | "vote";

export interface AskTypeOption {
  kind: AskType;
  label: string;
  /**
   * Available means this screen can compose it today. The route also takes a vote, but a vote
   * needs its options, and this screen has no field for them yet.
   */
  available: boolean;
}

export const askTypes: AskTypeOption[] = [
  { kind: "question", label: "A question", available: true },
  { kind: "word", label: "A word to teach", available: true },
  { kind: "vote", label: "A vote", available: false },
  { kind: "two_photos", label: "Two photos", available: false },
  { kind: "voice_note", label: "A voice note", available: false },
  { kind: "old_photo", label: "An old photo", available: false },
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

export const suggestionFixture: AskSuggestion = {
  id: "s1",
  text: "Ask her about the seeds she saved from last year",
};

export const recipientLanguage = "Russian";

/**
 * The live preview the composer shows in her language. The real screen calls the translation
 * endpoint; until that exists this stands in so the layout and the rule ("she reads her own
 * language") are real.
 */
export function previewTranslation(text: string): string {
  return text.trim().length === 0 ? "" : `${text.trim()} · shown to her in ${recipientLanguage}`;
}
