import { describe, expect, it } from "vitest";
import { ApiError } from "./client.ts";
import { isFamilyWaiting } from "./family-waiting.ts";

describe("isFamilyWaiting", () => {
  it("knows the closed test's waiting answer and nothing else", () => {
    expect(isFamilyWaiting(new ApiError(403, "forbidden", { reason: "family_waiting" }))).toBe(
      true,
    );
    expect(isFamilyWaiting(new ApiError(403, "forbidden"))).toBe(false);
    expect(isFamilyWaiting(new ApiError(404, "not_found", { reason: "family_waiting" }))).toBe(
      false,
    );
    expect(isFamilyWaiting(new Error("network"))).toBe(false);
    expect(isFamilyWaiting(undefined)).toBe(false);
  });
});
