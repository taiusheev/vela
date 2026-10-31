import { describe, expect, it } from "vitest";
import {
  ApiQuestionProfile,
  ForgetQuestionProfile,
  QUESTION_PROFILE_NOTICE_VERSION,
  QuestionProfileSettings,
  SaveQuestionProfile,
} from "./question-personalization.ts";

const settings = {
  language: "en",
  address_form: "dad",
  context: { connection: "unsure", talking_rhythm: "unsure", avoid_topics: [], never_say: [] },
  writing_examples: [],
};
describe("explicit saved choices", () => {
  it("accepts unknown and quiet without inventing a relationship label", () => {
    expect(QuestionProfileSettings.parse(settings)).toEqual(settings);
    expect(
      QuestionProfileSettings.safeParse({
        ...settings,
        context: { ...settings.context, connection: "quiet" },
      }).success,
    ).toBe(true);
  });
  it("requires current notice and a stated expected revision", () => {
    const input = {
      settings,
      expected_revision: null,
      notice_version: QUESTION_PROFILE_NOTICE_VERSION,
    };
    expect(SaveQuestionProfile.safeParse(input).success).toBe(true);
    expect(SaveQuestionProfile.safeParse({ ...input, notice_version: "old" }).success).toBe(false);
    expect(
      SaveQuestionProfile.safeParse({ settings, notice_version: QUESTION_PROFILE_NOTICE_VERSION })
        .success,
    ).toBe(false);
  });
  it("rejects inferred attributes, per-question intent and client-selected ownership", () => {
    expect(
      QuestionProfileSettings.safeParse({
        ...settings,
        context: { ...settings.context, intent: "How are the tomatoes?" },
      }).success,
    ).toBe(false);
    expect(QuestionProfileSettings.safeParse({ ...settings, closeness_score: 0.8 }).success).toBe(
      false,
    );
    expect(
      SaveQuestionProfile.safeParse({
        settings,
        expected_revision: null,
        notice_version: QUESTION_PROFILE_NOTICE_VERSION,
        author_id: "other",
      }).success,
    ).toBe(false);
    expect(ForgetQuestionProfile.safeParse({ author_id: "other" }).success).toBe(false);
  });
  it("bounds all reusable wording and refuses malformed strings", () => {
    expect(
      QuestionProfileSettings.safeParse({ ...settings, writing_examples: ["one", "two", "three"] })
        .success,
    ).toBe(false);
    expect(
      QuestionProfileSettings.safeParse({
        ...settings,
        context: { ...settings.context, avoid_topics: Array(6).fill("money") },
      }).success,
    ).toBe(false);
    expect(
      QuestionProfileSettings.safeParse({ ...settings, address_form: "dad\u0000" }).success,
    ).toBe(false);
    expect(
      QuestionProfileSettings.safeParse({ ...settings, writing_examples: ["\ud800"] }).success,
    ).toBe(false);
  });
  it("permits content-free tombstones while validating complete saved content", () => {
    expect(
      ApiQuestionProfile.parse({
        revision: "11111111-1111-7111-8111-111111111111",
        saving_available: false,
        profile: null,
      }).profile,
    ).toBeNull();
    expect(
      ApiQuestionProfile.safeParse({
        revision: null,
        saving_available: true,
        profile: { settings },
      }).success,
    ).toBe(false);
  });
});
