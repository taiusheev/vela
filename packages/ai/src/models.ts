/**
 * Model routing (ADR-15), per-call request settings, and the price table.
 *
 * A missed health or safety signal is the expensive failure, so `flag` runs on the strongest model
 * at low effort; judgment calls run on Sonnet; templated drafting runs on Haiku.
 */
import type { AiCallName } from "./types.ts";

export const CLAUDE_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

export const MODEL_FOR: Record<AiCallName, ClaudeModel> = {
  flag: "claude-opus-5",
  understand: "claude-sonnet-5",
  translate: "claude-sonnet-5",
  readback: "claude-sonnet-5",
  weekly_read: "claude-sonnet-5",
  chips: "claude-haiku-4-5",
  suggest: "claude-haiku-4-5",
  hello: "claude-haiku-4-5",
};

export type Effort = "low" | "medium" | "high";

/** Architecture §9.1. Null where the routed model takes no effort setting. */
export const EFFORT_FOR: Record<AiCallName, Effort | null> = {
  flag: "low",
  understand: "low",
  translate: "low",
  readback: "low",
  weekly_read: "medium",
  chips: null,
  suggest: null,
  hello: null,
};

/**
 * `max_tokens` caps thinking plus the answer, so calls that think get room well beyond their short
 * JSON; Haiku calls do not think.
 */
export const MAX_TOKENS_FOR: Record<AiCallName, number> = {
  flag: 8000,
  understand: 8000,
  translate: 8000,
  readback: 8000,
  weekly_read: 16000,
  chips: 2000,
  suggest: 2000,
  hello: 2000,
};

export interface ModelCapabilities {
  /** Accepts `thinking: {type: "adaptive"}`; Haiku 4.5 only has budgeted thinking. */
  readonly adaptiveThinking: boolean;
  /** Accepts `output_config.effort`; Haiku 4.5 rejects it. */
  readonly effort: boolean;
  /** Its safety classifiers can decline, so requests opt into server-side fallbacks. */
  readonly serverFallbacks: boolean;
}

export const CAPABILITIES: Record<ClaudeModel, ModelCapabilities> = {
  "claude-opus-5": { adaptiveThinking: true, effort: true, serverFallbacks: true },
  "claude-sonnet-5": { adaptiveThinking: true, effort: true, serverFallbacks: false },
  "claude-haiku-4-5": { adaptiveThinking: false, effort: false, serverFallbacks: false },
};

/** The beta that enables `fallbacks: "default"`; the array form uses a different header. */
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** US dollars per million tokens. */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  /** The five-minute cache write, which is what an ephemeral breakpoint without a TTL creates. */
  readonly cacheWrite: number;
}

function priced(input: number, output: number): ModelPrice {
  return { input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 };
}

/** Models a response can be served by: every route plus the fallback model Opus 5 can hand off to. */
export type PricedModel = ClaudeModel | "claude-opus-4-8";

export const PRICES: Readonly<Record<PricedModel, ModelPrice>> = {
  "claude-opus-5": priced(5, 25),
  "claude-sonnet-5": priced(2, 10),
  "claude-haiku-4-5": priced(1, 5),
  // `fallbacks: "default"` on Opus 5 may serve a declined request from Opus 4.8, billed at its rates.
  "claude-opus-4-8": priced(5, 25),
};
