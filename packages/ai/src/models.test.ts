import { describe, expect, it } from "vitest";
import { CAPABILITIES, EFFORT_FOR, MAX_TOKENS_FOR, MODEL_FOR, PRICES } from "./models.ts";
import { AI_CALL_NAMES } from "./types.ts";

describe("MODEL_FOR", () => {
  it("routes every call as ADR-15 decides", () => {
    expect(MODEL_FOR).toEqual({
      flag: "claude-opus-5",
      understand: "claude-sonnet-5",
      translate: "claude-sonnet-5",
      readback: "claude-sonnet-5",
      weekly_read: "claude-sonnet-5",
      chips: "claude-haiku-4-5",
      suggest: "claude-haiku-4-5",
      hello: "claude-haiku-4-5",
    });
  });

  it("routes every call to a priced model with a token cap", () => {
    for (const call of AI_CALL_NAMES) {
      expect(PRICES[MODEL_FOR[call]], call).toBeDefined();
      expect(MAX_TOKENS_FOR[call], call).toBeGreaterThan(0);
    }
  });
});

describe("EFFORT_FOR", () => {
  it("sets effort as architecture §9.1 decides", () => {
    expect(EFFORT_FOR).toEqual({
      flag: "low",
      understand: "low",
      translate: "low",
      readback: "low",
      weekly_read: "medium",
      chips: null,
      suggest: null,
      hello: null,
    });
  });

  it("sets effort only where the routed model accepts it", () => {
    for (const call of AI_CALL_NAMES) {
      expect(EFFORT_FOR[call] !== null, call).toBe(CAPABILITIES[MODEL_FOR[call]].effort);
    }
  });
});

describe("CAPABILITIES", () => {
  it("uses adaptive thinking and effort on Opus 5 and Sonnet 5 but not on Haiku 4.5", () => {
    expect(CAPABILITIES["claude-opus-5"]).toMatchObject({ adaptiveThinking: true, effort: true });
    expect(CAPABILITIES["claude-sonnet-5"]).toMatchObject({ adaptiveThinking: true, effort: true });
    expect(CAPABILITIES["claude-haiku-4-5"]).toMatchObject({
      adaptiveThinking: false,
      effort: false,
    });
  });

  it("opts only Opus 5 into server-side fallbacks", () => {
    expect(CAPABILITIES["claude-opus-5"].serverFallbacks).toBe(true);
    expect(CAPABILITIES["claude-sonnet-5"].serverFallbacks).toBe(false);
    expect(CAPABILITIES["claude-haiku-4-5"].serverFallbacks).toBe(false);
  });
});
