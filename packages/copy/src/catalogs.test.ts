import { MVP_LANGS, TimeZone } from "@vela/contracts";
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

/**
 * 他 and 她 are the gendered third-person pronouns, except in 其他 ("other"); 監控, 監視, and 追蹤
 * mean monitor, surveil, and track.
 */
const FORBIDDEN_ZH_TW = /(?<!其)他|她|監控|追蹤|監視/;

/** Simplified-only forms of characters used in everyday copy; Taiwan writes 們這時說發語… */
const SIMPLIFIED_ONLY =
  /[们这时说发语设问点为会过还没让张选号码间边个来对开关给请谢讯灯应电话联络统与图组暂续听见]/;

/**
 * Mainland vocabulary with a different Taiwanese word: 訊息, 使用者, 設定, 影片, 群組, 預設, 點選,
 * 簡訊, 早安.
 */
const MAINLAND_TERMS = /信息|用戶|設置|視頻|群聊|默認|點擊|短信|早上好/;

/** Every country button of organiser onboarding (flows §3.1); Other leads to a typed time zone. */
const COUNTRY_BUTTONS: MessageKey[] = [
  "onboarding.country_tw",
  "onboarding.country_us",
  "onboarding.country_gb",
  "onboarding.country_ca",
  "onboarding.country_au",
  "onboarding.country_sg",
  "onboarding.country_jp",
  "onboarding.country_de",
  "onboarding.country_in",
  "onboarding.country_other",
];

/** A `Region/City` name as written inside a sentence. */
const ZONE_NAME = /\b[A-Z][A-Za-z]+\/[A-Za-z_]+\b/g;

/**
 * Wording that dates the first send to moments ago. The repeat goes out 150 minutes after delivery
 * (flows §3.8), so its preface cannot say "just now".
 */
const JUST_NOW: Record<(typeof MVP_LANGS)[number], RegExp> = {
  en: /\b(just now|a moment ago|moments ago)\b/i,
  "zh-TW": /剛才|剛剛|方才/,
};

/**
 * Vela belongs in a new group without the kept-light member (spec Appendix A), not in the family
 * chat that already exists, which usually includes the elders.
 */
const SEPARATE_GROUP: Record<(typeof MVP_LANGS)[number], RegExp> = {
  en: /\bnew group\b.*\bwithout \{name\}/,
  "zh-TW": /另外建立.*群組.*不要加\{name\}/,
};

/**
 * Times of day and durations. The quiet threshold is learned per member and waits longer while Vela
 * learns, so the consent text cannot promise when the organiser hears of a quiet morning.
 */
const TIME_OF_DAY: Record<(typeof MVP_LANGS)[number], RegExp> = {
  en: /\b(evening|night|noon|afternoon|o'clock|hours?)\b/i,
  "zh-TW": /傍晚|晚上|中午|下午|小時|點前|點以前/,
};

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

  it.each(MVP_LANGS)("%s labels every onboarding country button differently", (lang) => {
    const labels = COUNTRY_BUTTONS.map((key) => catalogs[lang][key]);
    expect(new Set(labels).size).toBe(COUNTRY_BUTTONS.length);
  });
});

describe("wording with a fixed meaning in every language", () => {
  it.each(MVP_LANGS)("%s consent request promises no time for the quiet note", (lang) => {
    expect(catalogs[lang]["consent.request"]).not.toMatch(TIME_OF_DAY[lang]);
  });

  it.each(MVP_LANGS)("%s private-chat help names the literal /start command", (lang) => {
    // Telegram recognises only the Latin command, so a translated command would do nothing.
    expect(catalogs[lang]["help.private"]).toMatch(/(^|\s)\/start(?!\w)/);
  });

  it.each(MVP_LANGS)("%s typed time-zone prompts give only real IANA names as examples", (lang) => {
    for (const key of ["onboarding.ask_zone_other", "onboarding.invalid_zone"] as const) {
      const examples = [...catalogs[lang][key].matchAll(ZONE_NAME)].map((match) => match[0]);
      expect(examples.length, `${lang} ${key}`).toBeGreaterThan(0);
      for (const example of examples) {
        expect(TimeZone.safeParse(example).success, `${lang} ${key} ${example}`).toBe(true);
      }
    }
  });

  it.each(MVP_LANGS)("%s repeat preface does not say the message went out just now", (lang) => {
    expect(catalogs[lang]["arrival.repeat"]).not.toMatch(JUST_NOW[lang]);
  });

  it.each(MVP_LANGS)("%s setup asks for a new group without the kept-light member", (lang) => {
    expect(catalogs[lang]["onboarding.done"]).toMatch(SEPARATE_GROUP[lang]);
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

  it("the guards recognise the words they forbid", () => {
    expect("她回覆了").toMatch(FORBIDDEN_ZH_TW);
    expect("他們都好").toMatch(FORBIDDEN_ZH_TW);
    expect("其他").not.toMatch(FORBIDDEN_ZH_TW);
    expect("您今天早上好嗎？").toMatch(MAINLAND_TERMS);
  });

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
