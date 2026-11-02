import { describe, expect, it } from "vitest";
import { inFirstWeek } from "./first-week.ts";

describe("inFirstWeek", () => {
  const opened = "2026-10-20T08:00:00.000Z";

  it("teaches on the first day and before anything was remembered", () => {
    expect(inFirstWeek(null, new Date("2026-10-20T09:00:00Z"))).toBe(true);
    expect(inFirstWeek(opened, new Date("2026-10-20T09:00:00Z"))).toBe(true);
  });

  it("still teaches on day seven and stops after", () => {
    expect(inFirstWeek(opened, new Date("2026-10-27T07:59:00Z"))).toBe(true);
    expect(inFirstWeek(opened, new Date("2026-10-27T08:00:00Z"))).toBe(false);
  });

  it("keeps teaching when the remembered date cannot be read", () => {
    expect(inFirstWeek("not a date", new Date("2027-01-01T00:00:00Z"))).toBe(true);
  });
});
