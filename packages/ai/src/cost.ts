import { type ClaudeModel, type ModelPrice, PRICES, type PricedModel } from "./models.ts";

/** Token counts as billed: uncached input, output, cache reads, and cache writes are disjoint. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** The subset of the Messages API `usage` object that billing depends on. */
export interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageFromApi(usage: ApiUsage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * The price of the model that served a response, falling back to the routed model: a server-side
 * fallback bills at the serving model's rates, and an unknown id is better priced at the route than
 * logged as free.
 */
export function priceFor(servedModel: string, routedModel: ClaudeModel): ModelPrice {
  return isPricedModel(servedModel) ? PRICES[servedModel] : PRICES[routedModel];
}

function isPricedModel(model: string): model is PricedModel {
  return Object.hasOwn(PRICES, model);
}

/** Rounded to the micro-dollar, the precision `ai_calls.cost_usd` stores. */
export function costUsd(price: ModelPrice, usage: TokenUsage): number {
  const perMillion =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite;
  return Math.round(perMillion) / 1_000_000;
}

/** Every input token the request consumed, cached or not. */
export function totalInputTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}
