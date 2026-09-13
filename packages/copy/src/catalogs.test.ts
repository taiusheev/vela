import { MVP_LANGS } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { catalogs, type MessageKey } from "./index.ts";

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function placeholdersOf(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names].sort();
}

const englishKeys = Object.keys(catalogs.en) as MessageKey[];

const translations = MVP_LANGS.filter((lang) => lang !== "en");

/** Whole words, including inflections, that frame the product as surveillance (spec §9, §14.4). */
const SURVEILLANCE_WORDS =
  /\b(monitor(s|ed|ing)?|track(s|ed|ing)?|check(s|ed|ing)? on|keep(s|ing)? an eye)\b/i;

/** The product never assumes the kept-light member's gender (code design §4). */
const GENDERED_PRONOUNS = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

/** 他 and 她 are the gendered third-person pronouns; 監控, 監視, and 追蹤 mean monitor, surveil, and track. */
const FORBIDDEN_ZH_TW = /[他她]|監控|追蹤|監視/;

/** Simplified-only forms of characters used in everyday copy; Taiwan writes 們這時說發語… */
const SIMPLIFIED_ONLY =
  /[们这时说发语设问点为会过还没让张选号码间边个来对开关给请谢讯灯应电话联络统与图组暂续听见]/;

/** Mainland vocabulary with a different Taiwanese word: 訊息, 使用者, 設定, 影片, 群組, 預設, 點選, 簡訊. */
const MAINLAND_TERMS = /信息|用戶|設置|視頻|群聊|默認|點擊|短信/;

describe("catalogs", () => {
  it("cover exactly the MVP languages", () => {
    expect(Object.keys(catalogs).sort()).toEqual([...MVP_LANGS].sort());
  });

  it.each(translations)("%s has every English key and no other", (lang) => {
    expect(Object.keys(catalogs[lang]).sort()).toEqual([...englishKeys].sort());
  });

  it.each(MVP_LANGS)("%s has no empty strings", (lang) => {
    for (const key of englishKeys) {
      expect(catalogs[lang][key].trim(), `${lang} ${key}`).not.toBe("");
    }
  });

  it.each(translations)("%s uses exactly the English placeholders for every key", (lang) => {
    for (const key of englishKeys) {
      expect(placeholdersOf(catalogs[lang][key]), `${lang} ${key}`).toEqual(
        placeholdersOf(catalogs.en[key]),
      );
    }
  });

  it.each(MVP_LANGS)("%s uses braces only as well-formed placeholders", (lang) => {
    for (const key of englishKeys) {
      expect(catalogs[lang][key].replace(PLACEHOLDER, ""), `${lang} ${key}`).not.toMatch(/[{}]/);
    }
  });
});

describe("English wording", () => {
  it("the guards recognise the words they forbid", () => {
    expect("Anna keeps an eye on her").toMatch(SURVEILLANCE_WORDS);
    expect("We are checking on Mom").toMatch(SURVEILLANCE_WORDS);
    expect("She answered").toMatch(GENDERED_PRONOUNS);
    expect("The family will hear it; there, whenever").not.toMatch(GENDERED_PRONOUNS);
  });

  it("never frames the product as monitoring, tracking, or checking on anyone", () => {
    for (const key of englishKeys) {
      expect(catalogs.en[key], key).not.toMatch(SURVEILLANCE_WORDS);
    }
  });

  it("never uses a gendered pronoun", () => {
    for (const key of englishKeys) {
      expect(catalogs.en[key], key).not.toMatch(GENDERED_PRONOUNS);
    }
  });
});

describe("Traditional Chinese wording", () => {
  const zhTW = catalogs["zh-TW"];

  it("never uses 他 or 她, or words for monitoring and tracking", () => {
    for (const key of englishKeys) {
      expect(zhTW[key], key).not.toMatch(FORBIDDEN_ZH_TW);
    }
  });

  it("is written in Traditional characters with Taiwanese vocabulary", () => {
    for (const key of englishKeys) {
      expect(zhTW[key], key).not.toMatch(SIMPLIFIED_ONLY);
      expect(zhTW[key], key).not.toMatch(MAINLAND_TERMS);
    }
  });

  it("translates every string that has English words in it", () => {
    for (const key of englishKeys) {
      const englishWords = catalogs.en[key].replace(PLACEHOLDER, "");
      if (/[A-Za-z]/.test(englishWords)) {
        expect(zhTW[key].replace(PLACEHOLDER, ""), key).toMatch(/\p{Script=Han}/u);
      }
    }
  });
});
