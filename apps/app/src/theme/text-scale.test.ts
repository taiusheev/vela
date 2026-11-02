import { describe, expect, it } from "vitest";
import { maxTextScale } from "./text-scale.ts";

describe("maxTextScale", () => {
  it("lets body text double", () => {
    expect(maxTextScale(17)).toBe(2);
    expect(maxTextScale(12)).toBe(2);
    expect(maxTextScale(undefined)).toBe(2);
  });

  it("stops large text near 48 points", () => {
    expect(34 * maxTextScale(34)).toBeCloseTo(48);
    expect(28 * maxTextScale(28)).toBeCloseTo(48);
  });

  it("never shrinks text below its own size", () => {
    expect(maxTextScale(60)).toBe(1);
  });
});
