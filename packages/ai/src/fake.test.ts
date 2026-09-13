import { describe, expect, it } from "vitest";
import { createFakeAi, fakeRecord } from "./fake.ts";
import type { FlagInput, TranslateInput, UnderstandInput } from "./types.ts";

const understandInput: UnderstandInput = {
  lang: "zh-TW",
  summaryLang: "en",
  addressForm: "阿嬤",
  today: "2026-09-13",
  todayWeekday: "Sunday",
  ask: null,
  answer: { kind: "text", text: "  今天去市場買菜  " },
  recentSummaries: [],
};

const flagInput: FlagInput = {
  lang: "en",
  addressForm: "Mom",
  ask: null,
  answer: { kind: "text", text: "Someone from the bank called about my card" },
  recentSummaries: [],
};

const translateInput: TranslateInput = {
  text: "Good morning, Grandma",
  from: "en",
  to: "zh-TW",
  speaker: { name: "Mia", ageBand: "teen", addressForm: null },
  listener: { name: "Lin Mei", ageBand: "elder", addressForm: "阿嬤" },
  relationship: "granddaughter to her grandmother",
};

describe("createFakeAi", () => {
  it("answers the same input with the same successful outcome", async () => {
    const ai = createFakeAi();

    const first = await ai.understand(understandInput);
    const second = await ai.understand(understandInput);

    expect(first).toEqual(second);
    expect(first).toEqual({
      ok: true,
      value: {
        summary: "今天去市場買菜",
        moodWords: [],
        mentions: { people: [], places: [], plans: [], health: [], dates: [] },
        away: null,
        language: "zh-TW",
      },
      record: {
        call: "understand",
        promptVersion: "understand.v1",
        model: "claude-sonnet-5",
        ok: true,
        tokensIn: 0,
        tokensOut: 0,
        tokensCached: 0,
        latencyMs: 0,
        costUsd: 0,
      },
    });
  });

  it("derives defaults from the input so tests can see what flowed through", async () => {
    const ai = createFakeAi();

    expect((await ai.translate(translateInput)).value).toEqual({
      text: "[zh-TW] Good morning, Grandma",
    });
    expect((await ai.flag(flagInput)).value).toEqual({
      flag: false,
      category: null,
      severity: null,
      evidenceQuote: null,
    });
    expect(
      (await ai.chips({ lang: "zh-TW", askerName: "Mia", question: "?", pastAnswers: [] })).value,
    ).toEqual({ chips: ["很好", "還沒", "晚點說"] });
    expect(
      (
        await ai.readback({
          lang: "en",
          addressForm: "Mom",
          answerGist: null,
          replies: [
            { name: "Sam", kind: "heart", text: null },
            { name: "Mia", kind: "text", text: "Love it" },
          ],
          listenedBy: [],
        })
      ).value,
    ).toEqual({ lines: ["Sam: heart", "Mia: Love it"] });
  });

  it("uses an override in place of the default and keeps the other defaults", async () => {
    const ai = createFakeAi({
      flag: async (input) => ({
        ok: true,
        value: {
          flag: true,
          category: "scam_contact",
          severity: "urgent",
          evidenceQuote: input.answer.text,
        },
        record: fakeRecord("flag"),
      }),
      understand: async () => ({
        ok: false,
        value: {
          summary: "answered",
          moodWords: [],
          mentions: { people: [], places: [], plans: [], health: [], dates: [] },
          away: null,
          language: "zh-TW",
        },
        record: fakeRecord("understand", "http_529"),
        error: "http_529",
      }),
    });

    const flag = await ai.flag(flagInput);
    const understanding = await ai.understand(understandInput);
    const translation = await ai.translate(translateInput);

    expect(flag.value).toMatchObject({ flag: true, category: "scam_contact" });
    expect(understanding).toMatchObject({
      ok: false,
      error: "http_529",
      record: { ok: false, error: "http_529" },
    });
    expect(translation.ok).toBe(true);
  });

  it("lists every call it received in order, overridden ones included", async () => {
    const ai = createFakeAi({
      flag: async () => ({
        ok: true,
        value: { flag: false, category: null, severity: null, evidenceQuote: null },
        record: fakeRecord("flag"),
      }),
    });

    await ai.understand(understandInput);
    await ai.flag(flagInput);
    await ai.translate(translateInput);

    expect(ai.calls).toEqual([
      { call: "understand", input: understandInput },
      { call: "flag", input: flagInput },
      { call: "translate", input: translateInput },
    ]);
  });
});
