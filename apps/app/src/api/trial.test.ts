import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: { trial: false } } } }));

import { requiresEnglish } from "./trial.ts";

describe("English trial language", () => {
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
