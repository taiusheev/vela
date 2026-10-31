import { describe, expect, it } from "vitest";
import { readPersonalQuestionDrafts } from "./config.ts";

describe("reviewed draft activation", () => {
  it.each(["development", "staging", "production"] as const)(
    "is off by default in %s",
    (environment) => {
      expect(readPersonalQuestionDrafts({}, environment)).toBe(false);
      expect(readPersonalQuestionDrafts({ PERSONAL_QUESTION_DRAFTS: "off" }, environment)).toBe(
        false,
      );
    },
  );
  it("supports explicit synthetic test activation and refuses production", () => {
    expect(readPersonalQuestionDrafts({ PERSONAL_QUESTION_DRAFTS: "on" }, "development")).toBe(
      true,
    );
    expect(readPersonalQuestionDrafts({ PERSONAL_QUESTION_DRAFTS: "on" }, "staging")).toBe(true);
    expect(() =>
      readPersonalQuestionDrafts({ PERSONAL_QUESTION_DRAFTS: "on" }, "production"),
    ).toThrow("not approved for production");
    expect(() =>
      readPersonalQuestionDrafts({ PERSONAL_QUESTION_DRAFTS: "yes" }, "staging"),
    ).toThrow("Use on or off");
  });
});
