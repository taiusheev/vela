/**
 * What Ask needs (spec §14.1 A7). The suggestion comes from her own words, and the API route that
 * will serve it, GET /v1/families/:id/suggestions, does not exist yet (API contract §4).
 */

export type AskType = "question" | "two_photos" | "voice_note" | "word" | "old_photo" | "vote";

export interface AskTypeOption {
  kind: AskType;
  label: string;
  /** Phase 0 carries questions, photos and voice; the rest arrive with their sprints. */
  available: boolean;
}

export const askTypes: AskTypeOption[] = [
  { kind: "question", label: "A question", available: true },
  { kind: "two_photos", label: "Two photos", available: true },
  { kind: "voice_note", label: "A voice note", available: true },
  { kind: "word", label: "A word to teach", available: false },
  { kind: "old_photo", label: "An old photo", available: false },
  { kind: "vote", label: "A vote", available: false },
];

export interface AskSuggestion {
  id: string;
  text: string;
}

export const suggestionFixture: AskSuggestion = {
  id: "s1",
  text: "Ask her about the seeds she saved from last year",
};

/** Who already has tomorrow, if anyone: the screen offers the day after or whenever (A7). */
export const tomorrowTakenBy: string | undefined = undefined;

export const recipientLanguage = "Russian";

/**
 * The live preview the composer shows in her language. The real screen calls the translation
 * endpoint; until that exists this stands in so the layout and the rule ("she reads her own
 * language") are real.
 */
export function previewTranslation(text: string): string {
  return text.trim().length === 0 ? "" : `${text.trim()} · shown to her in ${recipientLanguage}`;
}
