import { describe, expect, it } from "vitest";
import {
  familyMemoryKey,
  type MemorySelection,
  type MemorySource,
  materializeFamilyMemory,
} from "./family-memories.ts";

// Synthetic words only. No runtime/database fixtures or real family content.
const now = new Date("2026-10-21T09:00:00Z");
const consentedAt = new Date("2026-10-01T09:00:00Z");
const source: MemorySource = {
  id: "answer-a",
  familyId: "family-a",
  memberId: "member-a",
  revision: 1,
  text: "I love yellow flowers. My cat stole my chair again!",
  occurredAt: new Date("2026-10-20T09:00:00Z"),
  expiresAt: new Date("2026-11-19T09:00:00Z"),
  deleted: false,
  sensitivity: "ordinary",
};
const selection: MemorySelection = {
  familyId: source.familyId,
  memberId: source.memberId,
  kind: "preference",
  sourceId: source.id,
  sourceRevision: 1,
  start: 0,
  end: 22,
};
const input = { source, selection, now, enabled: true, consentedAt };

describe("source-bound family memories", () => {
  it("keeps the person's exact words and source expiry", () => {
    const memory = materializeFamilyMemory(input);
    expect(memory?.quote).toBe("I love yellow flowers.");
    expect(memory?.expiresAt).toEqual(source.expiresAt);
    expect(memory?.sourceId).toBe(source.id);
  });

  it("does not turn a joke into a paraphrase or a personality judgement", () => {
    expect(
      materializeFamilyMemory({
        ...input,
        selection: { ...selection, kind: "humour", start: 23, end: source.text.length },
      })?.quote,
    ).toBe("My cat stole my chair again!");
  });

  it.each([
    { familyId: "another-family" },
    { memberId: "another-member" },
    { id: "another-answer" },
    { revision: 2 },
    { revision: Number.NaN },
    { deleted: true },
    { sensitivity: "health" as const },
    { sensitivity: "unknown" as const },
    { expiresAt: now },
    { expiresAt: new Date("invalid") },
    { occurredAt: new Date("2026-09-01T09:00:00Z") },
    { occurredAt: new Date("2027-01-01T09:00:00Z") },
  ])("drops stale, foreign or ineligible source: %j", (patch) => {
    expect(materializeFamilyMemory({ ...input, source: { ...source, ...patch } })).toBeNull();
  });

  it("fails closed when the feature or consent is absent or withdrawn", () => {
    expect(materializeFamilyMemory({ ...input, enabled: false })).toBeNull();
    expect(materializeFamilyMemory({ ...input, consentedAt: null })).toBeNull();
    expect(materializeFamilyMemory({ ...input, consentedAt: new Date("invalid") })).toBeNull();
    expect(materializeFamilyMemory({ ...input, source: null })).toBeNull();
  });

  it.each([
    { start: -1 },
    { start: 1.5 },
    { end: 0 },
    { end: 1000 },
    { end: Number.POSITIVE_INFINITY },
  ])("rejects invalid quote offsets: %j", (patch) => {
    expect(materializeFamilyMemory({ ...input, selection: { ...selection, ...patch } })).toBeNull();
  });

  it("deduplicates the same quote across proposed categories without putting words in the key", () => {
    const memory = materializeFamilyMemory(input);
    if (memory === null) throw new Error("Synthetic memory missing");
    expect(familyMemoryKey(memory)).toBe(familyMemoryKey({ ...memory, kind: "moment" }));
    expect(familyMemoryKey(memory)).not.toContain("flowers");
    expect(familyMemoryKey(memory)).not.toBe(familyMemoryKey({ ...memory, sourceRevision: 2 }));
  });
});
