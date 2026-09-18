import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAi, fakeRecord } from "./fake.ts";
import { createOffAi } from "./off.ts";
import {
  type Ai,
  type AiOutcome,
  type ChipsInput,
  type FlagInput,
  type HelloInput,
  isAiOff,
  type ReadbackInput,
  type SuggestInput,
  type TranslateInput,
  type UnderstandInput,
  type WeeklyReadInput,
} from "./types.ts";

const understandInput: UnderstandInput = {
  lang: "zh-TW",
  summaryLang: "en",
  addressForm: "阿嬤",
  today: "2026-09-13",
  todayWeekday: "Sunday",
  ask: null,
  answer: { kind: "text", text: "我明天去妹妹家住到星期三，膝蓋有點痛" },
  recentSummaries: [],
  healthWordsConsent: true,
};

const flagInput: FlagInput = {
  lang: "en",
  addressForm: "Mom",
  ask: null,
  answer: { kind: "text", text: "I fell in the kitchen and my hip hurts a lot." },
  recentSummaries: [],
};

const chipsInput: ChipsInput = {
  lang: "zh-TW",
  askerName: "Mia",
  question: "今天煮什麼？",
  pastAnswers: [],
};

const suggestInput: SuggestInput = {
  lang: "en",
  holderName: "Sam",
  recipientAddress: "Mom",
  forDate: "2026-09-14",
  rotationType: "voice_note",
  recentMentions: [],
  familyDates: [],
  holderLastAsk: null,
};

const translateInput: TranslateInput = {
  text: "Grandma, your soup looks so good",
  from: "en",
  to: "zh-TW",
  speaker: { name: "Mia", ageBand: "teen", addressForm: null },
  listener: { name: "Lin Mei", ageBand: "elder", addressForm: "阿嬤" },
  relationship: "granddaughter to her grandmother",
};

const readbackInput: ReadbackInput = {
  lang: "en",
  addressForm: "Mom",
  answerGist: null,
  replies: [{ name: "Mia", kind: "text", text: "Love it" }],
  listenedBy: [],
};

const helloInput: HelloInput = { lang: "en", addressForm: "Mom", replies: [], listenedBy: [] };

const weeklyReadInput: WeeklyReadInput = {
  lang: "en",
  elderName: "Mom",
  weekEnd: "2026-09-20",
  days: [
    {
      date: "2026-09-15",
      answeredAt: "08:40",
      askerName: "Mia",
      askType: "question",
      summary: "Mom made soup.",
      voiceSeconds: null,
    },
  ],
  usualAnswerTime: "08:40",
  answerTimeDriftMinutes: null,
  voiceLengthDriftPercent: null,
  repeatedMentions: [],
};

/**
 * Each call and the value it resolves with while AI is off: the safe default a failed call gives,
 * written out so a changed default fails here rather than being mirrored.
 */
const CALLS: readonly (readonly [string, (ai: Ai) => Promise<AiOutcome<unknown>>, unknown])[] = [
  [
    "understand",
    (ai) => ai.understand(understandInput),
    {
      summary: "answered",
      moodWords: [],
      mentions: { people: [], places: [], plans: [], health: [], dates: [] },
      away: null,
      language: "zh-TW",
    },
  ],
  [
    "flag",
    (ai) => ai.flag(flagInput),
    { flag: false, category: null, severity: null, evidenceQuote: null },
  ],
  ["chips", (ai) => ai.chips(chipsInput), { chips: ["很好", "還沒", "晚點說"] }],
  [
    "suggest",
    (ai) => ai.suggest(suggestInput),
    { type: "voice_note", text: "", source: "rotation" },
  ],
  ["translate", (ai) => ai.translate(translateInput), { text: translateInput.text }],
  ["readback", (ai) => ai.readback(readbackInput), { lines: [] }],
  ["hello", (ai) => ai.hello(helloInput), { lines: [] }],
  [
    "weekly_read",
    (ai) => ai.weeklyRead(weeklyReadInput),
    { lines: [], suggestion: "Mom, what was the best part of your week?" },
  ],
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createOffAi", () => {
  it.each(CALLS)(
    "answers %s with its safe default and no record, and sends nothing to a provider",
    async (_call, run, value) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const outcome = await run(createOffAi());

      expect(outcome).toEqual({ ok: false, value, record: null });
      expect(isAiOff(outcome)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("rejects an input the real client would reject", async () => {
    const ai = createOffAi();

    await expect(
      ai.understand({ ...understandInput, answer: { kind: "voice", text: "" } }),
    ).rejects.toThrow();
    await expect(
      ai.flag({ ...flagInput, recentSummaries: ["one", "two", "three", "four"] }),
    ).rejects.toThrow();
  });
});

describe("isAiOff", () => {
  // Services log a call from its record and count a failure from `ok`; only an outcome without a
  // record is AI being off.
  it("tells AI being off from a call that failed and from one that succeeded", async () => {
    const failed = await createFakeAi({
      flag: async () => ({
        ok: false,
        value: { flag: false, category: null, severity: null, evidenceQuote: null },
        record: fakeRecord("flag", "http_529"),
        error: "http_529",
      }),
    }).flag(flagInput);
    const succeeded = await createFakeAi().flag(flagInput);
    const off = await createOffAi().flag(flagInput);

    expect([isAiOff(failed), isAiOff(succeeded), isAiOff(off)]).toEqual([false, false, true]);
  });
});
