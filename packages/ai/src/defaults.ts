/**
 * The values a call resolves with when the provider fails (code design §7). Each is safe to act on:
 * nothing is flagged, nothing is invented, and services fall back to deterministic copy wherever a
 * default is empty.
 */
import type { Lang } from "@vela/contracts";
import type { AiCallName, AiCallTypes } from "./types.ts";

type ChipLang = "en" | "zh-TW";

/**
 * Generic chips for a question when drafting fails. They live here rather than in `@vela/copy`
 * because `@vela/ai` must not depend on it. The Traditional Chinese awaits native review.
 */
export const GENERIC_CHIPS: Record<ChipLang, readonly [string, string, string]> = {
  en: ["Good", "Not yet", "Tell you later"],
  "zh-TW": ["很好", "還沒", "晚點說"],
};

export function genericChips(lang: Lang): string[] {
  return [...(lang === "zh-TW" ? GENERIC_CHIPS["zh-TW"] : GENERIC_CHIPS.en)];
}

/**
 * The suggestion of a weekly read whose draft failed, in the reader's language: an open ask about her
 * week that states nothing about it, so the fallback read still has the one suggestion the schema
 * requires. The Traditional Chinese awaits native review.
 */
export function genericWeeklySuggestion(lang: Lang, elderName: string): string {
  return lang === "zh-TW"
    ? `${elderName}，這個星期最開心的是什麼事？`
    : `${elderName}, what was the best part of your week?`;
}

export const SAFE_DEFAULTS: {
  [K in AiCallName]: (input: AiCallTypes[K]["input"]) => AiCallTypes[K]["output"];
} = {
  understand: (input) => ({
    summary: "answered",
    moodWords: [],
    mentions: { people: [], places: [], plans: [], health: [], dates: [] },
    away: null,
    language: input.lang,
  }),
  flag: () => ({ flag: false, category: null, severity: null, evidenceQuote: null }),
  chips: (input) => ({ chips: genericChips(input.lang) }),
  suggest: (input) => ({ type: input.rotationType, text: "", source: "rotation" }),
  translate: (input) => ({ text: input.text }),
  readback: () => ({ lines: [] }),
  hello: () => ({ lines: [] }),
  weekly_read: (input) => ({
    lines: [],
    suggestion: genericWeeklySuggestion(input.lang, input.elderName),
  }),
};
