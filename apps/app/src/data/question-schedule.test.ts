import { describe, expect, it } from "vitest";
import { calendarWeeks, editablePlannedQuestion, questionDates } from "./question-schedule.ts";
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

describe("the calendar of mornings", () => {
  it("lays fourteen mornings from a Sunday out as three full weeks from Monday", () => {
    const weeks = calendarWeeks(questionDates("2026-10-25"));
    expect(weeks).toHaveLength(3);
    expect(weeks[0]?.[0]).toBe("2026-10-19");
    expect(weeks[0]?.[6]).toBe("2026-10-25");
    expect(weeks[2]?.[6]).toBe("2026-11-08");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });
  it("needs only two weeks when the first morning is a Monday", () => {
    const weeks = calendarWeeks(questionDates("2026-10-26"));
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.[0]).toBe("2026-10-26");
    expect(weeks[1]?.[6]).toBe("2026-11-08");
  });
  it("draws nothing without mornings", () => {
    expect(calendarWeeks([])).toEqual([]);
  });
});

describe("the parent named by an edit link", () => {
  const question = {
    id: "dad-question",
    recipient_id: "dad",
    recipient_name: "Dad",
    asker_name: "Mia",
    text: "What is growing?",
    date: "2026-10-25",
    editable: true,
    preparing: false,
  };
  it("loads an owned question only for the parent shown in the editor", () => {
    expect(editablePlannedQuestion([question], question.id, "dad")).toEqual(question);
  });
  it("never loads Dad's words into Mom's editor or an unknown recipient", () => {
    expect(editablePlannedQuestion([question], question.id, "mom")).toBeUndefined();
    expect(editablePlannedQuestion([question], question.id, undefined)).toBeUndefined();
  });
  it("rejects read-only questions, unknown IDs and missing edit links", () => {
    expect(
      editablePlannedQuestion([{ ...question, editable: false }], question.id, "dad"),
    ).toBeUndefined();
    expect(editablePlannedQuestion([question], "unknown", "dad")).toBeUndefined();
    expect(editablePlannedQuestion([question], undefined, "dad")).toBeUndefined();
  });
});
