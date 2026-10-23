import {
  WEEKLY_SUPPORT_REVIEW_VERSION,
  type WeeklySupportContext,
  type WeeklySupportSource,
} from "@vela/core/weekly-support";
import { describe, expect, it } from "vitest";
import { prepareWeeklySupportReview } from "./weekly-support.ts";

const context: WeeklySupportContext = {
  enabled: true,
  familyId: "f",
  memberId: "p",
  viewerId: "c",
  activeMemberIds: ["p", "c"],
  organiserIds: ["c"],
  permission: {
    version: WEEKLY_SUPPORT_REVIEW_VERSION,
    givenAt: new Date("2026-10-19"),
    withdrawnAt: null,
  },
  weekFrom: new Date("2026-10-19"),
  weekUntil: new Date("2026-10-26"),
  now: new Date("2026-10-25"),
};
function prepare(text: string, end = text.length) {
  const source: WeeklySupportSource = {
    id: "s",
    familyId: "f",
    memberId: "p",
    revision: 1,
    text,
    occurredAt: new Date("2026-10-20"),
    expiresAt: new Date("2026-11-01"),
    deleted: false,
    sensitivity: "ordinary",
    readerIds: ["c", "p"],
  };
  return prepareWeeklySupportReview(
    context,
    [source],
    [
      {
        sourceId: "s",
        sourceRevision: 1,
        start: 0,
        end,
        kind: "practical_help",
        reviewerId: "c",
        reviewedAt: new Date("2026-10-21"),
        validUntil: new Date("2026-10-30"),
      },
    ],
  );
}
describe("weekly support independent screening", () => {
  it("prepares an ordinary, reviewed request without a model call", () => {
    expect(prepare("Could someone help me sort the old photos?")).toHaveLength(1);
  });
  it.each([
    "My knee hurts.",
    "I feel lonely.",
    "My medicine changed.",
    "膝蓋痛。",
    "最近很孤單。",
    "I need help paying my debt.",
  ])("rejects sensitive words even if labelled ordinary: %s", (text) => {
    expect(prepare(text)).toEqual([]);
  });
  it("screens sensitive words outside a benign selected excerpt", () => {
    expect(prepare("The flowers opened. My knee hurts.", "The flowers opened.".length)).toEqual([]);
  });
  it("does not scan or present sources when the feature is absent", () => {
    expect(prepareWeeklySupportReview({ ...context, enabled: false }, [], [])).toEqual([]);
  });
});
