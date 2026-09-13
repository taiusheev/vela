import type { ExchangeState } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { type AskCandidate, type SelectAskInput, selectAsk } from "./ask.ts";

const DATE = "2026-09-16";
const OTHER_DATE = "2026-09-18";

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 8, 10, 12, minutes));
}

function scheduledAsk(id: string, overrides: Partial<AskCandidate> = {}): AskCandidate {
  return {
    id,
    whenRule: "tomorrow",
    scheduledFor: DATE,
    createdAt: at(0),
    state: "composed",
    ...overrides,
  };
}

function wheneverAsk(id: string, overrides: Partial<AskCandidate> = {}): AskCandidate {
  return {
    id,
    whenRule: "whenever",
    scheduledFor: null,
    createdAt: at(0),
    state: "composed",
    ...overrides,
  };
}

function select(candidates: AskCandidate[], overrides: Partial<SelectAskInput> = {}) {
  return selectAsk({
    date: DATE,
    candidates,
    isStoryDay: false,
    storyQuestionAvailable: false,
    ...overrides,
  });
}

describe("selectAsk", () => {
  it("takes the ask scheduled for that date over an older whenever ask", () => {
    const result = select([
      wheneverAsk("w1", { createdAt: at(0) }),
      scheduledAsk("s1", { createdAt: at(30) }),
    ]);
    expect(result).toEqual({ source: "scheduled", exchangeId: "s1" });
  });

  it("takes a scheduled ask in either the composed or the scheduled state, whatever its when rule", () => {
    expect(select([scheduledAsk("s1", { state: "scheduled" })])).toEqual({
      source: "scheduled",
      exchangeId: "s1",
    });
    expect(select([scheduledAsk("s2", { whenRule: "date" })])).toEqual({
      source: "scheduled",
      exchangeId: "s2",
    });
    expect(select([wheneverAsk("w1", { scheduledFor: DATE, state: "scheduled" })])).toEqual({
      source: "scheduled",
      exchangeId: "w1",
    });
  });

  it("ignores asks scheduled for another date", () => {
    expect(select([scheduledAsk("s1", { scheduledFor: OTHER_DATE })])).toEqual({ source: "hello" });
  });

  it("ignores a withdrawn scheduled ask and falls through to the oldest whenever ask", () => {
    const result = select([scheduledAsk("s1", { state: "withdrawn" }), wheneverAsk("w1")]);
    expect(result).toEqual({ source: "whenever", exchangeId: "w1" });
  });

  it.each<ExchangeState>(["delivered", "seen", "answered", "replied", "read_back", "archived"])(
    "ignores a scheduled ask already %s",
    (state) => {
      expect(select([scheduledAsk("s1", { state })])).toEqual({ source: "hello" });
    },
  );

  it("breaks a tie between two asks scheduled for the same date by creation time, then by id", () => {
    expect(
      select([
        scheduledAsk("s-late", { createdAt: at(10) }),
        scheduledAsk("s-early", { createdAt: at(5) }),
      ]),
    ).toEqual({ source: "scheduled", exchangeId: "s-early" });
    expect(select([scheduledAsk("b"), scheduledAsk("a")])).toEqual({
      source: "scheduled",
      exchangeId: "a",
    });
  });

  it("takes the oldest whenever ask regardless of input order", () => {
    const asks = [
      wheneverAsk("w2", { createdAt: at(20) }),
      wheneverAsk("w1", { createdAt: at(10) }),
      wheneverAsk("w3", { createdAt: at(30) }),
    ];
    expect(select(asks)).toEqual({ source: "whenever", exchangeId: "w1" });
    expect(select([...asks].reverse())).toEqual({ source: "whenever", exchangeId: "w1" });
  });

  it("only takes whenever asks that are still composed and not claimed for another morning", () => {
    const result = select([
      wheneverAsk("claimed", { createdAt: at(1), scheduledFor: OTHER_DATE }),
      wheneverAsk("withdrawn", { createdAt: at(2), state: "withdrawn" }),
      wheneverAsk("delivered", { createdAt: at(3), state: "delivered" }),
      wheneverAsk("scheduled", { createdAt: at(4), state: "scheduled" }),
      wheneverAsk("open", { createdAt: at(5) }),
    ]);
    expect(result).toEqual({ source: "whenever", exchangeId: "open" });
  });

  it("does not treat a dated ask without a date as a whenever ask", () => {
    expect(select([scheduledAsk("s1", { whenRule: "date", scheduledFor: null })])).toEqual({
      source: "hello",
    });
  });

  it("takes the story question on story day when nothing was asked", () => {
    expect(select([], { isStoryDay: true, storyQuestionAvailable: true })).toEqual({
      source: "story",
    });
  });

  it("prefers a whenever ask to the story question", () => {
    expect(select([wheneverAsk("w1")], { isStoryDay: true, storyQuestionAvailable: true })).toEqual(
      {
        source: "whenever",
        exchangeId: "w1",
      },
    );
  });

  it("falls back to the hello when it is not story day or no story question is left", () => {
    expect(select([], { isStoryDay: false, storyQuestionAvailable: true })).toEqual({
      source: "hello",
    });
    expect(select([], { isStoryDay: true, storyQuestionAvailable: false })).toEqual({
      source: "hello",
    });
  });
});
