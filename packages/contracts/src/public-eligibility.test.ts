import { describe, expect, it } from "vitest";
import {
  PUBLIC_ELIGIBILITY_TERMS_VERSION,
  PUBLIC_ELIGIBILITY_VERSION,
  PublicEligibilityChoice,
} from "./public-eligibility.ts";

const choice = {
  version: PUBLIC_ELIGIBILITY_VERSION,
  terms_version: PUBLIC_ELIGIBILITY_TERMS_VERSION,
  language: "en",
  adult_self_declared: true,
  residence_self_declared: "TW",
  notice_read: true,
  review_terms_acknowledged: true,
};
describe("own Taiwan eligibility review", () => {
  it("accepts only an adult's own Taiwan declaration with separate notice and terms acknowledgements", () => {
    expect(PublicEligibilityChoice.parse(choice)).toEqual(choice);
  });
  it.each([
    "user_id",
    "member_id",
    "parent_adult",
    "date_of_birth",
    "citizenship",
    "recorded_at",
    "ai_processing",
    "marketing",
  ])("refuses unrequested or client-controlled %s", (field) => {
    expect(PublicEligibilityChoice.safeParse({ ...choice, [field]: "untrusted" }).success).toBe(
      false,
    );
  });
  it.each([
    { adult_self_declared: false },
    { residence_self_declared: "US" },
    { notice_read: false },
    { review_terms_acknowledged: false },
    { version: "old" },
    { terms_version: "old" },
    { language: "ja" },
  ])("refuses incomplete or unsupported answers %j", (patch) => {
    expect(PublicEligibilityChoice.safeParse({ ...choice, ...patch }).success).toBe(false);
  });
});
