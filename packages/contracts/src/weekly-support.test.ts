import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  SUPPORT_PERMISSION_SHA256,
  SUPPORT_PERMISSION_TEXT,
  SupportReviewChoice,
} from "./weekly-support.ts";

it("pins the exact proposed report purpose shown before a parent agrees", () => {
  expect(createHash("sha256").update(SUPPORT_PERMISSION_TEXT).digest("hex")).toBe(
    SUPPORT_PERMISSION_SHA256,
  );
});
it("does not accept authored advice, health scores or unconfirmed ordinary-content review", () => {
  const base = {
    source_id: "00000000-0000-4000-8000-000000000001",
    source_digest: "a".repeat(64),
    kind: "company",
    ordinary_confirmed: true,
    valid_until: "2026-10-25T01:00:00.000Z",
  };
  expect(SupportReviewChoice.safeParse(base).success).toBe(true);
  expect(SupportReviewChoice.safeParse({ ...base, advice: "Take a supplement" }).success).toBe(
    false,
  );
  expect(SupportReviewChoice.safeParse({ ...base, ordinary_confirmed: false }).success).toBe(false);
});
