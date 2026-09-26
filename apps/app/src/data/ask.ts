/**
 * What Ask needs (spec §14.1 A7). Vela's suggestion for her morning is read from Today
 * (`tomorrow[].suggestion`, API contract §4), so the example day carries it too. Labels are message
 * descriptors, so a screen shows them in the app's language (build plan 3.1).
 */

import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import type { ComposableExchangeType, ExchangeType } from "@vela/contracts";

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

/**
 * The kind "Use this" selects: the suggestion's own where this screen can compose it, and a
 * question otherwise, which is how a story or a recipe ask reaches her for now.
 */
export function suggestedKind(type: ExchangeType): AskType {
  const kind = askTypes.find((option) => option.kind === type)?.kind;
  return kind !== undefined && composableType[kind] !== undefined ? kind : "question";
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
