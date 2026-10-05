import { describe, expect, it } from "vitest";
import { costUsd, priceFor, totalInputTokens, usageFromApi } from "./cost.ts";
import { PRICES } from "./models.ts";

describe("PRICES", () => {
  it("prices each routed model per million tokens, cache reads at 0.1x and writes at 1.25x input", () => {
    expect(PRICES["claude-opus-5"]).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
    expect(PRICES["claude-sonnet-5"]).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
    });
    expect(PRICES["claude-haiku-4-5"]).toEqual({
      input: 1,
      output: 5,
      cacheRead: 0.1,
      cacheWrite: 1.25,
    });
  });
});

describe("costUsd", () => {
  it("adds uncached input, output, cache reads, and cache writes at their own rates", () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 10_000,
      cacheWriteTokens: 2_000,
    };
    // Opus 5: 5000 + 12500 + 5000 + 12500 micro-dollars.
    expect(costUsd(PRICES["claude-opus-5"], usage)).toBe(0.035);
    // Haiku 4.5: 1000 + 2500 + 1000 + 2500 micro-dollars.
    expect(costUsd(PRICES["claude-haiku-4-5"], usage)).toBe(0.007);
  });

  it("rounds to the micro-dollar", () => {
    const usage = { inputTokens: 1, outputTokens: 0, cacheReadTokens: 3, cacheWriteTokens: 0 };
    // Sonnet 5: 2 + 0.6 micro-dollars.
    expect(costUsd(PRICES["claude-sonnet-5"], usage)).toBe(0.000003);
  });

  it("costs nothing for an unbilled refusal", () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costUsd(PRICES["claude-opus-5"], usage)).toBe(0);
  });
});

describe("usageFromApi", () => {
  it("reads missing cache counts as zero and counts every input token in the total", () => {
    const usage = usageFromApi({
      input_tokens: 40,
      output_tokens: 7,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: 12,
    });
    expect(usage).toEqual({
      inputTokens: 40,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 12,
    });
    expect(totalInputTokens(usage)).toBe(52);
  });
});

describe("priceFor", () => {
  it("prices the model that served the response", () => {
    expect(priceFor("claude-haiku-4-5", "claude-opus-5")).toBe(PRICES["claude-haiku-4-5"]);
    expect(priceFor("claude-opus-4-8", "claude-opus-5")).toBe(PRICES["claude-opus-4-8"]);
  });

  it("falls back to the routed model for an unknown served model", () => {
    expect(priceFor("claude-unknown", "claude-sonnet-5")).toBe(PRICES["claude-sonnet-5"]);
    expect(priceFor("toString", "claude-sonnet-5")).toBe(PRICES["claude-sonnet-5"]);
  });
});
