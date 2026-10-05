import { describe, expect, it } from "vitest";
import {
  ASK_BANK,
  ASK_BANK_THEMES,
  ASK_BANK_TYPES,
  type AskBankType,
  askBankItem,
  askBankText,
} from "./ask-bank.ts";
import {
  FORBIDDEN_ZH_TW,
  GENDERED_PRONOUNS,
  HEALTH_CHECK,
  LATIN_TOUCHING_HAN,
  MAINLAND_TERMS,
  SIMPLIFIED_ONLY,
  SURVEILLANCE_WORDS,
} from "./rules.ts";

/**
 * The ids of the first version of the bank, in bank order. Rows in `suggestions` keep an id for ever
 * (retention clears only words), so an id may never be renamed or removed; new items are appended.
 */
const ASK_BANK_IDS_V1 = [
  "life.childhood.home",
  "life.childhood.games",
  "life.school.teacher",
  "life.work.first_job",
  "life.work.proud",
  "life.place.street",
  "life.friends.best",
  "life.seasons.festival",
  "life.music.song",
  "knowledge.garden.plant",
  "knowledge.home.fix",
  "knowledge.food.market",
  "knowledge.home.tidy",
  "opinions.advice.first_job",
  "opinions.change.better",
  "opinions.change.wish",
  "opinions.taste.film",
  "opinions.taste.season",
  "opinions.advice.dinner",
  "opinions.place.visit",
  "life.childhood.memory",
  "life.work.first_day",
  "life.friends.oldest",
  "life.family.wedding",
  "life.place.move",
  "life.childhood.mischief",
  "life.family.grandparents",
  "life.seasons.new_year",
  "life.work.teacher",
  "life.place.trip",
  "life.school.day",
  "life.home.neighbours",
  "life.change.television",
  "opinions.advice.choice",
  "knowledge.craft.skill",
  "life.family.name",
  "knowledge.food.signature",
  "knowledge.food.breakfast",
  "knowledge.food.soup",
  "knowledge.food.new_year",
  "knowledge.food.snack",
  "knowledge.food.preserve",
  "knowledge.food.secret",
  "knowledge.food.parents",
  "knowledge.language.saying",
  "knowledge.language.hometown",
  "knowledge.language.kitchen",
  "knowledge.language.blessing",
  "knowledge.language.weather",
  "knowledge.language.song",
  "knowledge.language.nickname",
  "opinions.language.favourite",
];

/** Asks too close to suggest within weeks of each other, which the writer excludes together. */
const NAMED_GROUPS: Record<string, readonly string[]> = {
  first_job: ["life.work.first_job", "life.work.first_day", "opinions.advice.first_job"],
  teacher: ["life.school.teacher", "life.work.teacher"],
  new_year: ["life.seasons.new_year", "knowledge.food.new_year", "knowledge.language.blessing"],
  neighbourhood: ["life.place.street", "life.home.neighbours"],
};

const MINIMUM_PER_TYPE: Record<AskBankType, number> = {
  question: 20,
  story: 16,
  recipe: 8,
  word: 8,
};

const MAX_ENGLISH_WORDS = 25;
const MAX_HAN_CHARACTERS = 40;

function hanCount(text: string): number {
  return [...text.matchAll(/\p{Script=Han}/gu)].length;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

describe("the question bank", () => {
  it("keeps every id of its first version, in order, so ids are only ever appended", () => {
    expect(ASK_BANK.slice(0, ASK_BANK_IDS_V1.length).map((entry) => entry.id)).toEqual(
      ASK_BANK_IDS_V1,
    );
  });

  it("holds at least 52 asks: 20 questions, 16 stories, 8 recipes and 8 words", () => {
    expect(ASK_BANK.length).toBeGreaterThanOrEqual(52);
    for (const type of ASK_BANK_TYPES) {
      const count = ASK_BANK.filter((entry) => entry.type === type).length;
      expect(count, type).toBeGreaterThanOrEqual(MINIMUM_PER_TYPE[type]);
    }
  });

  it("names each ask once, by its theme, an area and a slug", () => {
    const ids = ASK_BANK.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of ASK_BANK) {
      expect(entry.id).toMatch(/^(life|knowledge|opinions)\.[a-z_]+\.[a-z_]+$/);
      expect(entry.id.startsWith(`${entry.theme}.`), entry.id).toBe(true);
      expect(entry.topic, entry.id).toMatch(/^[a-z_]+$/);
    }
  });

  it("asks about her life, her knowledge and her opinions, each well represented", () => {
    const perTheme = Object.fromEntries(
      ASK_BANK_THEMES.map((theme) => [
        theme,
        ASK_BANK.filter((entry) => entry.theme === theme).length,
      ]),
    );
    expect(perTheme.life).toBeGreaterThanOrEqual(12);
    expect(perTheme.knowledge).toBeGreaterThanOrEqual(12);
    expect(perTheme.opinions).toBeGreaterThanOrEqual(8);
  });

  it("groups the near-duplicates together and leaves every other ask a group of its own", () => {
    for (const [group, ids] of Object.entries(NAMED_GROUPS)) {
      expect(
        ASK_BANK.filter((entry) => entry.group === group)
          .map((entry) => entry.id)
          .sort(),
        group,
      ).toEqual([...ids].sort());
    }
    const grouped = new Set(Object.values(NAMED_GROUPS).flat());
    for (const entry of ASK_BANK.filter((candidate) => !grouped.has(candidate.id))) {
      expect(entry.group).toBe(entry.id);
    }
  });

  // The writer never gives two neighbouring days the same topic, and falls back to another type
  // only when a type has nothing left; two excluded topics must leave every type something.
  it("keeps at least three asks of every type outside any two topics", () => {
    const topics = [...new Set(ASK_BANK.map((entry) => entry.topic))];
    for (const type of ASK_BANK_TYPES) {
      const ofType = ASK_BANK.filter((entry) => entry.type === type);
      for (const first of topics) {
        for (const second of topics) {
          const left = ofType.filter((entry) => entry.topic !== first && entry.topic !== second);
          expect(left.length, `${type} without ${first} and ${second}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("writes each ask in English as one short ask, without surveillance, gendered or health-check words", () => {
    for (const entry of ASK_BANK) {
      const text = entry.text.en;
      expect(text, entry.id).toMatch(/^[A-Z].*[?.]$/);
      expect(text.split("?").length - 1, entry.id).toBeLessThanOrEqual(1);
      expect(wordCount(text), entry.id).toBeLessThanOrEqual(MAX_ENGLISH_WORDS);
      expect(text, entry.id).not.toMatch(SURVEILLANCE_WORDS);
      expect(text, entry.id).not.toMatch(GENDERED_PRONOUNS);
      expect(text, entry.id).not.toMatch(HEALTH_CHECK.en);
    }
  });

  it("writes each ask in Traditional Chinese as Taiwan does, briefly, with full-width punctuation and no health-check words", () => {
    for (const entry of ASK_BANK) {
      const text = entry.text["zh-TW"];
      expect(text, entry.id).toMatch(/[？。]$/);
      expect(text, entry.id).not.toMatch(/[?,.!:;]/);
      expect(hanCount(text), entry.id).toBeGreaterThan(0);
      expect(hanCount(text), entry.id).toBeLessThanOrEqual(MAX_HAN_CHARACTERS);
      expect(text, entry.id).not.toMatch(FORBIDDEN_ZH_TW);
      expect(text, entry.id).not.toMatch(SIMPLIFIED_ONLY);
      expect(text, entry.id).not.toMatch(MAINLAND_TERMS);
      expect(text, entry.id).not.toMatch(LATIN_TOUCHING_HAN);
      expect(text, entry.id).not.toMatch(HEALTH_CHECK["zh-TW"]);
    }
  });

  it("uses guards that recognise what they forbid", () => {
    for (const check of [
      "Are you feeling OK today?",
      "How are you this morning?",
      "Did you sleep well?",
      "When is your next doctor's visit?",
      "Are you lonely at home?",
      "How has your mood been since the market?",
    ]) {
      expect(check).toMatch(HEALTH_CHECK.en);
    }
    for (const check of [
      "您身體還好嗎？",
      "昨天睡得好不好？",
      "藥吃了嗎？",
      "會不會覺得孤單？",
      "最近心情怎麼樣？",
    ]) {
      expect(check).toMatch(HEALTH_CHECK["zh-TW"]);
    }
    expect("What will you paint this week?").not.toMatch(HEALTH_CHECK.en);
    expect("We are checking on Mom").toMatch(SURVEILLANCE_WORDS);
    expect("What did she cook?").toMatch(GENDERED_PRONOUNS);
    expect("她今天好嗎？").toMatch(FORBIDDEN_ZH_TW);
    expect("您说呢？").toMatch(SIMPLIFIED_ONLY);
    expect("用戶").toMatch(MAINLAND_TERMS);
    expect("您的Line").toMatch(LATIN_TOUCHING_HAN);
  });

  it("finds an ask by its id, in English or Traditional Chinese, and English for other languages", () => {
    expect(askBankItem("life.family.name")?.type).toBe("story");
    expect(askBankItem("life.family.nickname")).toBeUndefined();
    expect(askBankText("knowledge.food.soup", "zh-TW")).toBe("天氣變冷的時候，您會煮什麼湯？");
    expect(askBankText("knowledge.food.soup", "en")).toBe(
      "What soup do you make when the weather turns cold?",
    );
    expect(askBankText("knowledge.food.soup", "ja")).toBe(askBankText("knowledge.food.soup", "en"));
    expect(askBankText("life.family.nickname", "en")).toBeUndefined();
  });
});
