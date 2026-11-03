import { describe, expect, it } from "vitest";
import { firstDaysSteps, showsFirstDays } from "./first-days.ts";

describe("the first days guide", () => {
  it("starts at her yes, with the question and her answer still to come", () => {
    expect(firstDaysSteps({ invited: true, askedForTomorrow: false, answered: false })).toEqual({
      yes: "now",
      ask: "later",
      answer: "later",
    });
  });

  it("moves to the first question once she said yes", () => {
    expect(firstDaysSteps({ invited: false, askedForTomorrow: false, answered: false })).toEqual({
      yes: "done",
      ask: "now",
      answer: "later",
    });
  });

  it("waits for her answer once the first question is ready", () => {
    expect(firstDaysSteps({ invited: false, askedForTomorrow: true, answered: false })).toEqual({
      yes: "done",
      ask: "done",
      answer: "now",
    });
  });

  it("goes once she has answered a first morning, and stays while she is only invited", () => {
    expect(showsFirstDays({ invited: false, answered: true })).toBe(false);
    expect(showsFirstDays({ invited: false, answered: false })).toBe(true);
    expect(showsFirstDays({ invited: true, answered: false })).toBe(true);
  });
});
