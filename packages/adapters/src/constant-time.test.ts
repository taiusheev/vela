import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "./constant-time.ts";

describe("constantTimeEqual", () => {
  it("is true only for identical strings", () => {
    expect(constantTimeEqual("abc-123_XYZ", "abc-123_XYZ")).toBe(true);
    expect(constantTimeEqual("abc-123_XYZ", "abc-123_XYz")).toBe(false);
    expect(constantTimeEqual("Abc-123_XYZ", "abc-123_XYZ")).toBe(false);
  });

  it("is false for different lengths in either direction", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("abcd", "abc")).toBe(false);
  });

  it("does not let trailing zero bytes stand in for missing ones", () => {
    expect(constantTimeEqual("abc", "abc\u0000")).toBe(false);
    expect(constantTimeEqual("abc\u0000", "abc")).toBe(false);
  });

  it("never matches an empty expected secret", () => {
    expect(constantTimeEqual("", "")).toBe(false);
  });
});
