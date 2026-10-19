import { INTEREST_TOPICS } from "@vela/contracts";
import { ASK_BANK } from "@vela/copy";
import { describe, expect, it, vi } from "vitest";
import {
  firstQuestionChoices,
  firstWeek,
  interestTopics,
  nextMorningAt,
  questionsFor,
  zoneOffsetMinutes,
} from "./onboarding.ts";

vi.mock("@lingui/core/macro", () => ({
  msg: (message: TemplateStringsArray | { message: string }) => ({
    message: Array.isArray(message) ? message.join("") : (message as { message: string }).message,
  }),
}));

const topicOf = (text: string) =>
  ASK_BANK.find((item) => item.child.en === text || item.child["zh-TW"] === text)?.topic;

describe("the interests onboarding offers", () => {
  it("are exactly the API's topics, each drawing on at least three asks of the bank", () => {
    expect(interestTopics.map((choice) => choice.value)).toEqual([...INTEREST_TOPICS]);
    for (const choice of interestTopics) {
      const known = choice.bankTopics.filter((topic) =>
        ASK_BANK.some((item) => item.topic === topic),
      );
      expect(known, choice.value).toEqual([...choice.bankTopics]);
      expect(questionsFor([choice.value], 99).length, choice.value).toBeGreaterThanOrEqual(3);
    }
  });

  it("leave no ask of the bank out of every interest", () => {
    const covered = new Set(interestTopics.flatMap((choice) => choice.bankTopics));
    expect(ASK_BANK.filter((item) => !covered.has(item.topic)).map((item) => item.id)).toEqual([]);
  });
});

describe("questionsFor", () => {
  it("takes the chosen interests in turn, never two asks of one group", () => {
    const asks = questionsFor(["garden", "music"], 4);
    expect(asks).toHaveLength(4);
    expect(asks.map((item) => item.topic).slice(0, 2)).toEqual(["garden", "music"]);
    expect(new Set(asks.map((item) => item.group)).size).toBe(4);
  });

  it("draws on a few everyday interests when none is chosen", () => {
    expect(questionsFor([], 3)).toHaveLength(3);
  });
});

describe("firstQuestionChoices", () => {
  it("offers three of her interests' asks in the family's wording and her language", () => {
    const english = firstQuestionChoices(["cooking"], "en");
    const chinese = firstQuestionChoices(["cooking"], "zh-TW");
    expect(english).toHaveLength(3);
    expect(chinese).toHaveLength(3);
    const first = ASK_BANK.find((item) => item.child.en === english[0]);
    expect(first?.child["zh-TW"]).toBe(chinese[0]);
    expect(chinese.join("")).toMatch(/[一-鿿]/);
  });
});

describe("firstWeek", () => {
  it("starts with her first question and adds six more, never one bank topic two days running", () => {
    const [first] = firstQuestionChoices(["garden", "old_days"], "en");
    expect(first).toBeDefined();
    const week = firstWeek(["garden", "old_days"], first ?? "", "en");
    expect(week).toHaveLength(7);
    expect(week[0]).toBe(first);
    expect(new Set(week).size).toBe(7);
    const topics = week.map(topicOf);
    for (let day = 1; day < topics.length; day += 1) {
      expect(topics[day], week[day]).not.toBe(topics[day - 1]);
    }
  });

  it("keeps a question the organiser wrote themselves as the first morning", () => {
    const week = firstWeek(["films_books"], "Did you watch the match last night?", "en");
    expect(week[0]).toBe("Did you watch the match last night?");
    expect(week).toHaveLength(7);
  });

  it("writes the week in Traditional Chinese for her when she reads it", () => {
    const [first] = firstQuestionChoices(["music"], "zh-TW");
    const week = firstWeek(["music"], first ?? "", "zh-TW");
    expect(week).toHaveLength(7);
    for (const ask of week) expect(ask).toMatch(/[一-鿿]/);
  });
});

describe("her next morning", () => {
  it("reads a zone's offset, summer time included", () => {
    expect(zoneOffsetMinutes("Asia/Ho_Chi_Minh", new Date("2026-10-19T02:00:00Z"))).toBe(420);
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-10-19T02:00:00Z"))).toBe(-240);
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-12-19T02:00:00Z"))).toBe(-300);
    expect(zoneOffsetMinutes("Not/AZone", new Date("2026-10-19T02:00:00Z"))).toBe(0);
  });

  it("is tomorrow at her time in her zone", () => {
    const now = new Date("2026-10-19T02:00:00Z");
    expect(nextMorningAt("08:00", "Asia/Ho_Chi_Minh", now)).toBe("2026-10-20T01:00:00.000Z");
    expect(nextMorningAt("08:00", "America/New_York", now)).toBe("2026-10-19T12:00:00.000Z");
  });
});
