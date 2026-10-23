import { describe, expect, it } from "vitest";
import { questionDates } from "./question-schedule.ts";
import { tomorrowIn } from "./story.ts";

describe("question schedule", () => {
  it("offers exactly the server's next fourteen recipient-local dates across a year", () => {
    const dates = questionDates("2026-12-30");
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe("2026-12-30");
    expect(dates[13]).toBe("2027-01-12");
    expect(new Set(dates).size).toBe(14);
  });
  it("starts with tomorrow where the parent lives, across daylight saving", () => {
    const tomorrow = tomorrowIn(new Date("2026-11-01T03:00:00Z"), "America/New_York");
    expect(tomorrow).toBe("2026-11-01");
    expect(questionDates(tomorrow)[1]).toBe("2026-11-02");
  });
});
