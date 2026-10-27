import { describe, expect, it } from "vitest";
import { lightOnKey, lightsToWelcome } from "./light-on.ts";
import type { TodayLight } from "./today.ts";

const now = new Date("2026-10-27T09:00:00Z");

function light(overrides: Partial<TodayLight>): TodayLight {
  return {
    memberId: "mom",
    displayName: "Mom",
    state: "lit",
    stateText: "answered 8:12",
    localDate: "2026-10-27",
    ...overrides,
  };
}

describe("lightsToWelcome", () => {
  it("welcomes a lit light the reader has not seen today", () => {
    expect(lightsToWelcome([light({})], "f1", new Set(), now).map((l) => l.memberId)).toEqual([
      "mom",
    ]);
  });

  it("does not play again once seen on her day", () => {
    const seen = new Set([lightOnKey("f1", light({}), now)]);
    expect(lightsToWelcome([light({})], "f1", seen, now)).toEqual([]);
  });

  it("plays again on her next day", () => {
    const seen = new Set([lightOnKey("f1", light({}), now)]);
    expect(lightsToWelcome([light({ localDate: "2026-10-28" })], "f1", seen, now)).toHaveLength(1);
  });

  it("keeps families apart", () => {
    const seen = new Set([lightOnKey("f1", light({}), now)]);
    expect(lightsToWelcome([light({})], "f2", seen, now)).toHaveLength(1);
  });

  it("never lights a window without an answer", () => {
    const lights = [
      light({ state: "resting" }),
      light({ memberId: "q", state: "quiet" }),
      light({ memberId: "a", state: "away" }),
    ];
    expect(lightsToWelcome(lights, "f1", new Set(), now)).toEqual([]);
  });

  it("counts an answer that arrived while she was away", () => {
    expect(
      lightsToWelcome([light({ state: "away", answerReceived: true })], "f1", new Set(), now),
    ).toHaveLength(1);
  });

  it("skips invited and paused parents", () => {
    const lights = [
      light({ invited: true }),
      light({ memberId: "p", state: "paused", answerReceived: true }),
    ];
    expect(lightsToWelcome(lights, "f1", new Set(), now)).toEqual([]);
  });

  it("falls back to the reader's day when hers is unknown", () => {
    const { localDate: _, ...withoutDay } = light({});
    expect(lightOnKey("f1", withoutDay, now)).toBe("light-on.f1.mom.2026-10-27");
  });
});
