import { describe, expect, it } from "vitest";
import { ASK_BANK } from "./ask-bank.ts";
import { bankItemAvoided, NOTHING_TO_AVOID, touchesAvoided } from "./avoid-topics.ts";

describe("what the organiser asked Vela never to bring up", () => {
  it("leaves out questions on a chosen topic, in English and in Chinese", () => {
    const money = { topics: ["money"] as const, words: [] };
    expect(touchesAvoided("How much did rice cost when you were young?", money)).toBe(true);
    expect(touchesAvoided("您小時候一碗麵多少錢？", money)).toBe(true);
    expect(touchesAvoided("What did you cook for breakfast?", money)).toBe(false);
  });

  it("matches English as whole words, so a topic word inside another word does not count", () => {
    const work = { topics: ["work"] as const, words: [] };
    expect(touchesAvoided("Tell me about your first job.", work)).toBe(true);
    expect(touchesAvoided("Which homework did you hate most?", work)).toBe(false);
  });

  it("matches the organiser's own words, ignoring case", () => {
    const own = { topics: [], words: ["Grandpa Lin", "膝蓋"] };
    expect(touchesAvoided("Do you still talk about grandpa lin?", own)).toBe(true);
    expect(touchesAvoided("您的膝蓋還好嗎？", own)).toBe(true);
    expect(touchesAvoided("What song do you like?", own)).toBe(false);
  });

  it("keeps the whole bank when there is nothing to avoid, and drops some when there is", () => {
    expect(ASK_BANK.filter((item) => bankItemAvoided(item, NOTHING_TO_AVOID))).toHaveLength(0);
    const all = { topics: ["money", "health", "work", "partner"] as const, words: [] };
    const left = ASK_BANK.filter((item) => !bankItemAvoided(item, all));
    expect(left.length).toBeGreaterThan(0);
    expect(left.length).toBeLessThan(ASK_BANK.length);
    for (const item of left) expect(touchesAvoided(item.child.en, all)).toBe(false);
  });
});
