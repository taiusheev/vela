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
  weekly_read: () => ({ lines: [], suggestion: "" }),
};
