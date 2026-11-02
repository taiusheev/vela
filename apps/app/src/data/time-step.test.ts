import { describe, expect, it } from "vitest";
import { stepTime } from "./time-step.ts";

describe("stepTime", () => {
  it("moves by a quarter hour", () => {
    expect(stepTime("08:00", 1)).toBe("08:15");
    expect(stepTime("08:00", -1)).toBe("07:45");
  });

  it("moves an odd time to the nearest quarter in that direction", () => {
    expect(stepTime("08:10", 1)).toBe("08:15");
    expect(stepTime("08:10", -1)).toBe("08:00");
  });

  it("wraps around midnight", () => {
    expect(stepTime("23:45", 1)).toBe("00:00");
    expect(stepTime("00:00", -1)).toBe("23:45");
  });

  it("starts from 08:00 when the time cannot be read", () => {
    expect(stepTime("soon", 1)).toBe("08:15");
  });
});
