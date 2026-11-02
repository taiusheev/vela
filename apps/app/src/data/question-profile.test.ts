import type { ApiQuestionProfile, DraftPersonalQuestion } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { currentQuestionProfile, profileLines, profileSettingsOf } from "./question-profile.ts";

const draft: DraftPersonalQuestion = {
  recipient_id: "22222222-2222-7222-8222-222222222222",
  language: "zh-TW",
  address_form: "爸",
  context: {
    intent: "番茄長得怎樣",
    connection: "practical",
    talking_rhythm: "rarely",
    avoid_topics: ["money"],
    never_say: ["darling"],
  },
  writing_examples: ["爸 吃了嗎"],
};
describe("saved choices for one parent", () => {
  it("omits one-time intent, recipient id and revisions, and copies private arrays", () => {
    const settings = profileSettingsOf(draft);
    expect(JSON.stringify(settings)).not.toMatch(/番茄|recipient_id|revision|intent/);
    expect(settings.context.avoid_topics).not.toBe(draft.context.avoid_topics);
    expect(settings.writing_examples).not.toBe(draft.writing_examples);
  });
  it("never loads expired words, including the exact expiry boundary", () => {
    const now = Date.parse("2026-10-31T00:00:00Z");
    const profile = {
      settings: profileSettingsOf(draft),
      saved_at: new Date(now - 86400000).toISOString(),
      expires_at: new Date(now).toISOString(),
      notice_version: "question-profile.1" as const,
    };
    const view: ApiQuestionProfile = { revision: null, saving_available: true, profile };
    expect(currentQuestionProfile(view, now)).toBeNull();
    expect(currentQuestionProfile(view, now - 1)).toBe(profile);
    expect(currentQuestionProfile(undefined, now)).toBeNull();
    expect(view.profile?.expires_at).toBe(new Date(now).toISOString());
  });
  it("keeps all separately entered boundaries, including Chinese phrases", () => {
    expect(profileLines(" money\n\n結婚\r\n darling ")).toEqual(["money", "結婚", "darling"]);
  });
});
