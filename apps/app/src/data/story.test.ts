import { describe, expect, it } from "vitest";
import { nextPrompt, nextSunday, STORY_PROMPTS } from "./story.ts";

describe("story day", () => {
  it("goes to the coming Sunday, never today", () => {
    expect(nextSunday(new Date(2026, 9, 3))).toBe("2026-10-04"); // a Saturday
    expect(nextSunday(new Date(2026, 9, 4))).toBe("2026-10-11"); // a Sunday
    expect(nextSunday(new Date(2026, 9, 5))).toBe("2026-10-11"); // a Monday
  });

  it("offers the bank's stories in order, skipping the ones already asked", () => {
    const [first, second] = STORY_PROMPTS;
    if (first === undefined || second === undefined) throw new Error("expected story prompts");
    expect(nextPrompt(new Set(), 0, "en")?.id).toBe(first.id);
    expect(nextPrompt(new Set([first.text.en]), 0, "en")?.id).toBe(second.id);
    expect(nextPrompt(new Set(), 1, "en")?.id).toBe(second.id);
    expect(STORY_PROMPTS.length).toBeGreaterThanOrEqual(10);
  });
});
