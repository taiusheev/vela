import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { trial: false } } } }));

import { requiresEnglish, trialCapabilities } from "./trial.ts";

describe("English trial language", () => {
  it("keeps deferred and commercial features out of a fixed trial even on a broader staging backend", () => {
    const broader = {
      pilot: false,
      telegram_first: false,
      english_only: false,
      memory: true,
      book: true,
      parent_app: true,
      billing: true,
    };
    expect(trialCapabilities(broader, true)).toEqual({
      ...broader,
      memory: false,
      book: false,
      parent_app: false,
      billing: false,
    });
    expect(trialCapabilities(broader, false)).toBe(broader);
    expect(trialCapabilities(undefined, true)).toBeUndefined();
  });
  it("keeps live first paint, pending requests and failed requests in English", () => {
    expect(requiresEnglish(true, undefined, false)).toBe(true);
    expect(requiresEnglish(true, true, false)).toBe(true);
  });
  it("allows other languages only after an explicit non-trial server declaration", () => {
    expect(requiresEnglish(true, false, false)).toBe(false);
    expect(requiresEnglish(true, false, true)).toBe(true);
    expect(requiresEnglish(false, undefined, true)).toBe(true);
    expect(requiresEnglish(false, undefined, false)).toBe(false);
  });
});
