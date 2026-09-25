import { afterEach, describe, expect, it } from "vitest";
import { installPluralRules, MinimalPluralRules } from "./plural-rules.ts";

const NATIVE = Intl.PluralRules;
const COUNTS = [0, 1, 2, 1.5, 21];

describe("MinimalPluralRules", () => {
  // Lingui passes the active locale with its fallbacks as a list; a string is checked as well.
  const inputs: (string | string[])[] = ["en", "en-GB", "zh-TW", "zh", ["zh-TW", "en"], ["en"]];

  it.each(inputs)("chooses the category the engine's own rules choose for %j", (locales) => {
    const ours = new MinimalPluralRules(locales);
    const native = new NATIVE(locales);
    for (const count of COUNTS) {
      expect(ours.select(count), `${JSON.stringify(locales)} ${count}`).toBe(native.select(count));
    }
  });

  it("names the same categories as the engine for each language", () => {
    for (const locales of inputs) {
      expect(new MinimalPluralRules(locales).resolvedOptions().pluralCategories.sort()).toEqual(
        [...new NATIVE(locales).resolvedOptions().pluralCategories].sort(),
      );
    }
  });

  it("reads English as one only for exactly one", () => {
    const rules = new MinimalPluralRules("en");
    expect(COUNTS.map((count) => rules.select(count))).toEqual([
      "other",
      "one",
      "other",
      "other",
      "other",
    ]);
  });

  it("reads Chinese as other for every count", () => {
    const rules = new MinimalPluralRules(["zh-TW", "en"]);
    expect(COUNTS.map((count) => rules.select(count))).toEqual(COUNTS.map(() => "other"));
  });

  it("falls back to English with no locale given", () => {
    expect(new MinimalPluralRules().select(1)).toBe("one");
    expect(new MinimalPluralRules([]).select(1)).toBe("one");
  });
});

describe("installPluralRules", () => {
  afterEach(() => {
    Object.defineProperty(Intl, "PluralRules", {
      value: NATIVE,
      configurable: true,
      writable: true,
    });
  });

  it("leaves an engine's own PluralRules in place", () => {
    installPluralRules();
    expect(Intl.PluralRules).toBe(NATIVE);
  });

  it("stands in where the engine has none, as on Hermes", () => {
    Object.defineProperty(Intl, "PluralRules", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    installPluralRules();
    expect(Intl.PluralRules).toBe(MinimalPluralRules);
    expect(new Intl.PluralRules(["zh-TW", "en"]).select(1)).toBe("other");
    expect(new Intl.PluralRules("en").select(1)).toBe("one");
  });
});
