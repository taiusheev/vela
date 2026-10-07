import { describe, expect, it } from "vitest";
import { connectionCode } from "./connection-code.ts";

describe("pasting a Telegram connection code", () => {
  it("removes copied spacing without changing the case-sensitive characters", () => {
    expect(connectionCode(" \nAbC_def-123\u00a0GhiJKL456789\n")).toBe("AbC_def-123GhiJKL456789");
  });
  it("does not truncate an invalid longer code into a valid-looking one", () => {
    const long = "a".repeat(30);
    expect(connectionCode(long)).toBe(long);
  });
});
