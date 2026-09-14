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
 * 他 and 她 are the gendered third-person pronouns, except in 其他 ("other"); 監控, 監看, 監視, and
 * 追蹤 mean monitor, watch over, surveil, and track, and 盯著 and 看著您 (keeping an eye on you) are
 * the other surveillance phrases the zh-TW consent script forbids
 * (plan/materials/pilot/consent-script.zh-TW.md).
 */
const FORBIDDEN_ZH_TW = /(?<!其)他|她|監控|監看|監視|追蹤|盯|看著您/;

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

/**
 * A nearby contact's number is stored unconsented and reaches a quiet note only after the founder
 * records the contact's yes. Vela never contacts anyone on its own (the privacy notice says so): the
 * organiser sends the consent message from their own phone (nearby-contact-consent.en.md), so the
 * setup step tells the organiser to ask, and that the number appears only after a yes.
 */
const ORGANISER_ASKS_CONTACT: Record<(typeof MVP_LANGS)[number], RegExp> = {
  en: /\bask them yourself\b.*\bonly after they say yes\b/,
  "zh-TW": /請您先親自問過對方.*同意之後，電話號碼才會出現/,
};

/**
 * Wording in which Vela ("we", "I", or the name) asks or contacts the nearby contact, which it never
 * does: an organiser who believes it would never ask, and the contact would never appear in a note.
 */
const VELA_ASKS_CONTACT: Record<(typeof MVP_LANGS)[number], RegExp> = {
  en: /\b(we|I|Vela)( will|'ll)? (ask|contact|message|text)\b/i,
  "zh-TW": /(我們|我|Vela ?)(會|將)?(先)?(問|詢問|聯絡|傳訊息)/,
};

/** The wording the review found, which had Vela ask the contact. */
const VELA_ASKS_CONTACT_SAMPLE: Record<(typeof MVP_LANGS)[number], string> = {
  en: "We ask them first, before their number appears in any note.",
  "zh-TW": "我們會先問過對方，電話號碼才會出現在任何通知裡。",
};

/**
 * The name each language's privacy notice gives the weekly read (privacy-notice.en.md and
 * privacy-notice.zh-TW.md). The notice promises her the most recent weekly read when she asks what
 * the family sees, so the label she receives must use the same name.
 */
const WEEKLY_READ_NAME: Record<(typeof MVP_LANGS)[number], RegExp> = {
  en: /\bweekly read\b/i,
  "zh-TW": /每週小記/,
};

/** Other names a writer might give the weekly read. */
const OTHER_WEEKLY_READ_NAME: Record<(typeof MVP_LANGS)[number], RegExp> = {
  en: /\bweekly (note|summary|digest|report|update|letter|recap)\b/i,
  "zh-TW": /[週周](記|報|摘要|筆記|紀錄|回顧)/,
};

/** Labels that give the weekly read another name; the English one is the wording the review found. */
const OTHER_WEEKLY_READ_NAME_SAMPLE: Record<(typeof MVP_LANGS)[number], string> = {
  en: "The family's weekly note:",
  "zh-TW": "家人收到的週記：",
};

/** The keys that name the weekly read. */
const WEEKLY_READ_KEYS: readonly MessageKey[] = [
  "parent.family_sees_weekly_read",
  "admin.weekly_read_draft",
];

/** "What the family sees" returns her last seven answered days, which can span more than a week. */
const WEEK: Record<(typeof MVP_LANGS)[number], RegExp> = {
  en: /\bweek/i,
  "zh-TW": /星期|週|周|禮拜/,
};

/**
 * The parameters services pass for keys whose parameters the Sprint 1 contract fixed. A catalog
 * edit that adds or drops one breaks those call sites at run time, so the sets are pinned here.
 */
const PINNED_PARAMETERS: readonly (readonly [MessageKey, readonly string[]])[] = [
  ["group.linked", ["name", "notice"]],
  ["onboarding.ask_nearby", []],
  ["parent.family_sees_heading", []],
  ["parent.family_sees_empty", []],
  ["parent.family_sees_weekly_read", []],
  ["admin.flag", ["family", "link"]],
  ["admin.weekly_read_draft", ["family", "link"]],
  ["admin.understand_failed", ["family", "link"]],
  ["admin.member_left_group", ["family", "name"]],
];

/**
 * The admin conversation on Telegram is outside `admin_access_log` and retention, so an admin
 * message may name the family and a member and link to the admin page, and nothing else.
 */
const ADMIN_PARAMETERS: ReadonlySet<string> = new Set(["family", "link", "name"]);

/** Placeholders that render as URLs. */
const URL_PLACEHOLDERS = /(.?)\{(?:link|notice)\}(.?)/gsu;

/** The characters directly around each URL placeholder that are not whitespace. */
function crowdedUrlNeighbours(text: string): string[] {
  return [...text.matchAll(URL_PLACEHOLDERS)]
    .flatMap((match) => [match[1] ?? "", match[2] ?? ""])
    .filter((neighbour) => neighbour !== "" && !/\s/.test(neighbour));
}

/** Placeholders the zh-TW header says always render as Latin text or digits. */
const LATIN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "time",
  "sent",
  "usual",
  "n",
  "channel",
  "link",
  "notice",
]);

/**
 * A zh-TW template with Latin placeholders rendered as a digit and every other placeholder as a
 * Chinese character, so spacing can be read off the result.
 */
function withSampleValues(template: string): string {
  return template.replace(PLACEHOLDER, (_placeholder: string, name: string) =>
    LATIN_PLACEHOLDERS.has(name) ? "0" : "名",
  );
}

const LATIN_TOUCHING_HAN = /\p{Script=Han}[A-Za-z0-9]|[A-Za-z0-9]\p{Script=Han}/u;

/** Name placeholders set apart from a neighbouring Chinese character by a space. */
const SPACED_NAME =
  /\p{Script=Han}\s\{(?:name|names|asker|holder|organiser|child|address|family)\}|\{(?:name|names|asker|holder|organiser|child|address|family)\}\s\p{Script=Han}/u;

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

  it.each(MVP_LANGS)("%s takes exactly the parameters services pass for pinned keys", (lang) => {
    for (const [key, parameters] of PINNED_PARAMETERS) {
      expect(placeholdersOf(catalogs[lang][key]), `${lang} ${key}`).toEqual([...parameters].sort());
    }
  });

  it.each(MVP_LANGS)("%s admin messages carry names and links, never family words", (lang) => {
    const adminKeys = englishKeys.filter((key) => key.startsWith("admin."));
    expect(adminKeys.length).toBeGreaterThan(0);
    for (const key of adminKeys) {
      const extra = placeholdersOf(catalogs[lang][key]).filter(
        (name) => !ADMIN_PARAMETERS.has(name),
      );
      expect(extra, `${lang} ${key}`).toEqual([]);
    }
  });

  it.each(MVP_LANGS)("%s sets every link apart with whitespace", (lang) => {
    for (const key of englishKeys) {
      expect(crowdedUrlNeighbours(catalogs[lang][key]), `${lang} ${key}`).toEqual([]);
    }
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

  it.each(MVP_LANGS)("%s nearby guards recognise wording in which Vela asks", (lang) => {
    expect(VELA_ASKS_CONTACT_SAMPLE[lang]).toMatch(VELA_ASKS_CONTACT[lang]);
    expect(VELA_ASKS_CONTACT_SAMPLE[lang]).not.toMatch(ORGANISER_ASKS_CONTACT[lang]);
  });

  it.each(MVP_LANGS)("%s nearby step tells the organiser to ask the contact first", (lang) => {
    expect(catalogs[lang]["onboarding.ask_nearby"]).toMatch(ORGANISER_ASKS_CONTACT[lang]);
    expect(catalogs[lang]["onboarding.ask_nearby"]).not.toMatch(VELA_ASKS_CONTACT[lang]);
  });

  it.each(MVP_LANGS)("%s weekly read guard recognises another name for it", (lang) => {
    expect(OTHER_WEEKLY_READ_NAME_SAMPLE[lang]).toMatch(OTHER_WEEKLY_READ_NAME[lang]);
    expect(OTHER_WEEKLY_READ_NAME_SAMPLE[lang]).not.toMatch(WEEKLY_READ_NAME[lang]);
  });

  it.each(MVP_LANGS)("%s calls the weekly read by the name its privacy notice uses", (lang) => {
    for (const key of WEEKLY_READ_KEYS) {
      expect(catalogs[lang][key], `${lang} ${key}`).toMatch(WEEKLY_READ_NAME[lang]);
    }
    for (const key of englishKeys) {
      expect(catalogs[lang][key], `${lang} ${key}`).not.toMatch(OTHER_WEEKLY_READ_NAME[lang]);
    }
  });

  it.each(MVP_LANGS)("%s what-the-family-sees replies do not claim a week", (lang) => {
    for (const key of ["parent.family_sees_heading", "parent.family_sees_empty"] as const) {
      expect(catalogs[lang][key], `${lang} ${key}`).not.toMatch(WEEK[lang]);
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

  it("the guards recognise the words they forbid", () => {
    expect("她回覆了").toMatch(FORBIDDEN_ZH_TW);
    expect("他們都好").toMatch(FORBIDDEN_ZH_TW);
    expect("其他").not.toMatch(FORBIDDEN_ZH_TW);
    expect("有人在監看").toMatch(FORBIDDEN_ZH_TW);
    expect("家人會盯著").toMatch(FORBIDDEN_ZH_TW);
    expect("我們會看著您").toMatch(FORBIDDEN_ZH_TW);
    expect("過去看看您").not.toMatch(FORBIDDEN_ZH_TW);
    expect("您今天早上好嗎？").toMatch(MAINLAND_TERMS);
  });

  it("the spacing guards recognise the spacing they forbid", () => {
    expect(withSampleValues("明天{time}送到")).toMatch(LATIN_TOUCHING_HAN);
    expect(withSampleValues("我是Vela")).toMatch(LATIN_TOUCHING_HAN);
    expect(withSampleValues("明天 {time} 送到，問{name}")).not.toMatch(LATIN_TOUCHING_HAN);
    expect("問 {name}一件事").toMatch(SPACED_NAME);
    expect("{family} 的草稿").toMatch(SPACED_NAME);
    expect("☀️ {name}回覆了{asker} · {time}").not.toMatch(SPACED_NAME);
    expect(crowdedUrlNeighbours("查看：{link}")).toEqual(["："]);
    expect(crowdedUrlNeighbours("查看： {link}")).toEqual([]);
  });

  it("never uses 他 or 她, or words for monitoring, tracking, or watching over anyone", () => {
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

  it("separates Latin text, digits, and Latin placeholders from Chinese characters with a space", () => {
    for (const key of englishKeys) {
      expect(withSampleValues(zhTW[key]), key).not.toMatch(LATIN_TOUCHING_HAN);
    }
  });

  it("writes name placeholders against the Chinese characters around them", () => {
    for (const key of englishKeys) {
      expect(zhTW[key], key).not.toMatch(SPACED_NAME);
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
