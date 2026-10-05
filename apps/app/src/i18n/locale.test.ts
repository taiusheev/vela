import { LANGS } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { type DeviceLocale, fromDevice, fromLang, isAppLocale } from "./locale.ts";

function device(
  languageCode: string | null,
  languageScriptCode: string | null,
  regionCode: string | null,
  languageRegionCode: string | null = regionCode,
): DeviceLocale {
  return { languageCode, languageScriptCode, regionCode, languageRegionCode };
}

describe("fromLang", () => {
  it("shows Traditional Chinese for a zh-TW account and English for every other language", () => {
    expect(LANGS.map((lang) => [lang, fromLang(lang)])).toEqual([
      ["en", "en"],
      ["zh-TW", "zh-TW"],
      ["ja", "en"],
      ["de", "en"],
      ["hi", "en"],
      ["ru", "en"],
    ]);
  });
});

describe("isAppLocale", () => {
  it("accepts the two app languages and nothing else", () => {
    expect(["en", "zh-TW", "zh", "ja", "", null, undefined, 1].map(isAppLocale)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("fromDevice", () => {
  it("reads Traditional Chinese from the script", () => {
    expect(fromDevice([device("zh", "Hant", "TW")])).toBe("zh-TW");
    expect(fromDevice([device("zh", "Hant", "US")])).toBe("zh-TW");
  });

  it("reads Simplified Chinese as English, whatever the region", () => {
    expect(fromDevice([device("zh", "Hans", "CN")])).toBe("en");
    expect(fromDevice([device("zh", "Hans", "TW")])).toBe("en");
  });

  it("reads Chinese with no script from a region that writes Traditional characters", () => {
    expect(fromDevice([device("zh", null, "TW")])).toBe("zh-TW");
    expect(fromDevice([device("zh", null, "HK")])).toBe("zh-TW");
    expect(fromDevice([device("zh", null, "MO")])).toBe("zh-TW");
  });

  it("prefers the language's own region to the device's", () => {
    // A zh-TW language on a phone whose region is set to the United States.
    expect(fromDevice([device("zh", null, "US", "TW")])).toBe("zh-TW");
    expect(fromDevice([device("zh", null, "TW", "CN")])).toBe("en");
    // Web and older phones give no language region; the device's stands in.
    expect(fromDevice([{ languageCode: "zh", regionCode: "TW" }])).toBe("zh-TW");
  });

  it("reads bare Chinese, mainland China and Singapore as English", () => {
    expect(fromDevice([device("zh", null, null)])).toBe("en");
    expect(fromDevice([device("zh", null, "CN")])).toBe("en");
    expect(fromDevice([device("zh", null, "SG")])).toBe("en");
  });

  it("reads only the first preference", () => {
    expect(fromDevice([device("en", "Latn", "TW"), device("zh", "Hant", "TW")])).toBe("en");
    expect(fromDevice([device("zh", "Hant", "TW"), device("en", null, "US")])).toBe("zh-TW");
  });

  it("falls back to English with nothing to read", () => {
    expect(fromDevice([])).toBe("en");
    expect(fromDevice([device(null, null, null)])).toBe("en");
    expect(fromDevice([device("ja", "Jpan", "JP")])).toBe("en");
  });
});
