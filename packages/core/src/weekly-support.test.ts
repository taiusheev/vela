import { describe, expect, it } from "vitest";
import {
  buildWeeklySupportDraft,
  WEEKLY_SUPPORT_REVIEW_VERSION,
  type WeeklySupportContext,
  type WeeklySupportSelection,
  type WeeklySupportSource,
} from "./weekly-support.ts";

const context = (): WeeklySupportContext => ({
  enabled: true,
  familyId: "family",
  memberId: "parent",
  viewerId: "child",
  activeMemberIds: ["child", "parent", "sibling"],
  organiserIds: ["child"],
  permission: {
    version: WEEKLY_SUPPORT_REVIEW_VERSION,
    givenAt: new Date("2026-10-19T00:00Z"),
    withdrawnAt: null,
  },
  now: new Date("2026-10-25T10:00Z"),
  weekFrom: new Date("2026-10-19T00:00Z"),
  weekUntil: new Date("2026-10-26T00:00Z"),
});
const source = (id = "answer"): WeeklySupportSource => ({
  id,
  familyId: "family",
  memberId: "parent",
  revision: 1,
  text: "Could someone help me sort the old photos?",
  occurredAt: new Date("2026-10-20T08:00Z"),
  expiresAt: new Date("2026-11-19T08:00Z"),
  deleted: false,
  sensitivity: "ordinary",
  readerIds: ["child", "parent"],
});
const selection = (id = "answer"): WeeklySupportSelection => ({
  sourceId: id,
  sourceRevision: 1,
  start: 0,
  end: source().text.length,
  kind: "practical_help",
  reviewerId: "child",
  reviewedAt: new Date("2026-10-21T08:00Z"),
  validUntil: new Date("2026-10-30T00:00Z"),
});
const draft = (ctx = context(), src = source(), review = selection()) =>
  buildWeeklySupportDraft(ctx, [src], [review]);

describe("source-bound weekly support review", () => {
  it("keeps the parent's exact request beside a fixed draft template, without inventing advice", () => {
    const [item] = draft();
    expect(item).toMatchObject({
      kind: "practical_help",
      status: "review_draft",
      source: { id: "answer", revision: 1, quote: source().text },
    });
    expect(item?.id).not.toContain(source().text);
    expect(item).not.toHaveProperty("diagnosis");
  });
  it("lets the parent see the same shared support draft", () => {
    expect(draft({ ...context(), viewerId: "parent" })).toEqual(draft());
  });
  it.each([
    { enabled: false },
    { permission: null },
    {
      permission: {
        version: "health_words@2",
        givenAt: new Date("2026-10-19T00:00Z"),
        withdrawnAt: null,
      },
    },
    {
      permission: {
        ...{
          version: WEEKLY_SUPPORT_REVIEW_VERSION,
          givenAt: new Date("2026-10-19T00:00Z"),
          withdrawnAt: null,
        },
        withdrawnAt: new Date("2026-10-24T00:00Z"),
      },
    },
    {
      permission: {
        ...{
          version: WEEKLY_SUPPORT_REVIEW_VERSION,
          givenAt: new Date("2026-10-19T00:00Z"),
          withdrawnAt: null,
        },
        givenAt: new Date("2026-10-21T00:00Z"),
      },
    },
    { viewerId: "stranger" },
    { viewerId: "sibling" },
    { activeMemberIds: ["child"] },
    { now: new Date("invalid") },
    { weekUntil: new Date("2026-12-01") },
    { now: new Date("2026-11-26") },
  ] satisfies Partial<WeeklySupportContext>[])(
    "omits the report when permission or current access fails: %j",
    (change) => {
      expect(draft({ ...context(), ...change })).toEqual([]);
    },
  );
  it.each([
    { deleted: true },
    { sensitivity: "health" },
    { sensitivity: "unknown" },
    { familyId: "other" },
    { memberId: "other" },
    { readerIds: ["parent"] },
    { revision: 2 },
    { expiresAt: new Date("2026-10-25T09:59Z") },
    { occurredAt: new Date("2026-10-18T10:00Z") },
    { occurredAt: new Date("2026-10-26T08:00Z") },
  ] satisfies Partial<WeeklySupportSource>[])(
    "removes a draft immediately when its source changes: %j",
    (change) => {
      expect(draft(context(), { ...source(), ...change })).toEqual([]);
    },
  );
  it.each([
    { validUntil: new Date("2026-10-24") },
    { validUntil: new Date("invalid") },
    { reviewerId: "sibling" },
    { reviewedAt: new Date("2026-10-19T00:00Z") },
    { reviewedAt: new Date("2026-10-26T00:00Z") },
    { sourceRevision: 0 },
    { start: -1 },
    { end: 10000 },
    { start: 3, end: 3 },
    { kind: "diagnose" as never },
  ])("requires current human review of the exact source selection: %j", (change) => {
    expect(draft(context(), source(), { ...selection(), ...change })).toEqual([]);
  });
  it("does not fill sparse weeks with generic fallback advice", () => {
    expect(buildWeeklySupportDraft(context(), [], [])).toEqual([]);
    expect(buildWeeklySupportDraft(context(), [source()], [])).toEqual([]);
    expect(buildWeeklySupportDraft(context(), [source()], [selection(), selection()])).toHaveLength(
      1,
    );
  });
  it("rejects ambiguous source revisions and caps the report at 3 distinct sources", () => {
    expect(
      buildWeeklySupportDraft(context(), [source(), { ...source(), revision: 2 }], [selection()]),
    ).toEqual([]);
    const ids = ["1", "2", "3", "4"];
    expect(buildWeeklySupportDraft(context(), ids.map(source), ids.map(selection))).toHaveLength(3);
  });
  it("rechecks access rather than reusing a historical rendered quotation", () => {
    expect(draft()).toHaveLength(1);
    expect(draft(context(), { ...source(), readerIds: [] })).toEqual([]);
    expect(draft({ ...context(), organiserIds: [] })).toEqual([]);
    expect(draft(context(), { ...source(), text: "Corrected words", revision: 2 })).toEqual([]);
  });
});
