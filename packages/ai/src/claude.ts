import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { costUsd, priceFor, totalInputTokens, usageFromApi } from "./cost.ts";
import { SAFE_DEFAULTS } from "./defaults.ts";
import {
  CAPABILITIES,
  EFFORT_FOR,
  MAX_RETRIES,
  MAX_TOKENS_FOR,
  MODEL_FOR,
  SERVER_FALLBACK_BETA,
  TIMEOUT_MS_FOR,
} from "./models.ts";
import { PROMPTS, renderUserTurn } from "./prompts/index.ts";
import {
  type Ai,
  type AiCallName,
  type AiCallRecord,
  type AiCallTypes,
  type AiOutcome,
  AWAY_HORIZON_DAYS,
  type FlagInput,
  type FlagResult,
  INPUT_SCHEMAS,
  OUTPUT_SCHEMAS,
  type UnderstandInput,
  type Understanding,
} from "./types.ts";

export interface ClaudeAiOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

/** The API host every request goes to; the SDK would otherwise take it from `ANTHROPIC_BASE_URL`. */
const API_BASE_URL = "https://api.anthropic.com";

interface CallSpec<K extends AiCallName> {
  readonly call: K;
  /** Tightens a schema-valid output against its input where a schema cannot express the rule. */
  readonly normalise?: (
    output: AiCallTypes[K]["output"],
    input: AiCallTypes[K]["input"],
  ) => AiCallTypes[K]["output"];
}

/**
 * Claude behind the `Ai` port: one Messages API request per call, with the call's routed model, its
 * versioned system prompt cached, structured output against the call's Zod schema, and adaptive
 * thinking and effort where the model takes them.
 */
export function createClaudeAi(options: ClaudeAiOptions): Ai {
  // Every option the SDK would otherwise read from the environment is pinned where the constructor
  // allows it: the host the key is sent to, no second credential, and no debug logging of request
  // bodies, which carry family words. `ANTHROPIC_CUSTOM_HEADERS` has no switch; it can only add
  // headers to requests for the pinned host.
  const client = new Anthropic({
    apiKey: options.apiKey,
    authToken: null,
    baseURL: API_BASE_URL,
    logLevel: "warn",
    maxRetries: MAX_RETRIES,
    fetch: options.fetch,
  });
  return {
    understand: (input) =>
      invoke(client, { call: "understand", normalise: normaliseUnderstanding }, input),
    flag: (input) => invoke(client, { call: "flag", normalise: normaliseFlag }, input),
    chips: (input) => invoke(client, { call: "chips" }, input),
    suggest: (input) => invoke(client, { call: "suggest" }, input),
    translate: (input) => invoke(client, { call: "translate" }, input),
    readback: (input) => invoke(client, { call: "readback" }, input),
    hello: (input) => invoke(client, { call: "hello" }, input),
    weeklyRead: (input) => invoke(client, { call: "weekly_read" }, input),
  };
}

async function invoke<K extends AiCallName>(
  client: Anthropic,
  spec: CallSpec<K>,
  rawInput: AiCallTypes[K]["input"],
): Promise<AiOutcome<AiCallTypes[K]["output"]>> {
  // Invalid input is a bug in the caller, not a provider failure, so it throws before any request.
  const input = INPUT_SCHEMAS[spec.call].parse(rawInput);
  const outputSchema: z.ZodType<AiCallTypes[K]["output"]> = OUTPUT_SCHEMAS[spec.call];
  const model = MODEL_FOR[spec.call];
  const prompt = PROMPTS[spec.call];
  const capabilities = CAPABILITIES[model];
  const effort = EFFORT_FOR[spec.call];
  const format = betaZodOutputFormat(outputSchema);

  const params: MessageCreateParamsNonStreaming = {
    model,
    max_tokens: MAX_TOKENS_FOR[spec.call],
    system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: renderUserTurn(input) }],
    output_config: {
      format: { type: format.type, schema: format.schema },
      ...(capabilities.effort && effort !== null ? { effort } : {}),
    },
    ...(capabilities.adaptiveThinking ? { thinking: { type: "adaptive" } } : {}),
    ...(capabilities.serverFallbacks
      ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" }
      : {}),
  };

  const failure = (error: string, record: AiCallRecord): AiOutcome<AiCallTypes[K]["output"]> => ({
    ok: false,
    value: SAFE_DEFAULTS[spec.call](input),
    record: { ...record, ok: false, error },
    error,
  });

  const started = performance.now();
  let message: BetaMessage;
  try {
    message = await client.beta.messages.create(params, { timeout: TIMEOUT_MS_FOR[spec.call] });
  } catch (error) {
    const code = providerFailureCode(error);
    if (code === null) {
      throw error;
    }
    return failure(code, {
      call: spec.call,
      promptVersion: prompt.version,
      model,
      ok: false,
      tokensIn: 0,
      tokensOut: 0,
      tokensCached: 0,
      latencyMs: elapsedSince(started),
      costUsd: 0,
    });
  }

  const usage = usageFromApi(message.usage);
  const record: AiCallRecord = {
    call: spec.call,
    promptVersion: prompt.version,
    model: message.model,
    ok: true,
    tokensIn: totalInputTokens(usage),
    tokensOut: usage.outputTokens,
    tokensCached: usage.cacheReadTokens,
    latencyMs: elapsedSince(started),
    costUsd: costUsd(priceFor(message.model, model), usage),
  };

  // A refusal or a truncation can leave partial text that is not the answer, so the stop reason is
  // settled before any content is read.
  if (message.stop_reason === "refusal") {
    return failure("refusal", record);
  }
  if (message.stop_reason === "max_tokens") {
    return failure("truncated", record);
  }
  if (message.stop_reason !== "end_turn") {
    return failure(`stop_${message.stop_reason ?? "unknown"}`, record);
  }

  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  if (text.trim() === "") {
    return failure("empty_output", record);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return failure("schema_invalid", record);
  }
  const parsed = outputSchema.safeParse(json);
  if (!parsed.success) {
    return failure("schema_invalid", record);
  }

  const value = spec.normalise ? spec.normalise(parsed.data, input) : parsed.data;
  return { ok: true, value, record };
}

/**
 * An away switches off repeats and quiet notices, the family's safety net, so its dates are held to
 * her answer's date: a start already past becomes today, and an away that has ended, ends before it
 * starts, or starts or ends beyond the horizon is dropped rather than trusted.
 */
function normaliseUnderstanding(output: Understanding, input: UnderstandInput): Understanding {
  const { away } = output;
  if (away === null) {
    return output;
  }
  const from = away.from < input.today ? input.today : away.from;
  const horizon = addDays(input.today, AWAY_HORIZON_DAYS);
  const valid =
    from <= horizon && (away.until === null || (away.until >= from && away.until <= horizon));
  return { ...output, away: valid ? { from, until: away.until } : null };
}

/** `YYYY-MM-DD` dates compare as strings; adding days goes through UTC midnight, which has no DST. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The organiser notice quotes her words verbatim, so a quote that is not an exact excerpt of her
 * answer is dropped rather than shown as something she said; the flag itself stands, because a
 * missed signal is the expensive failure. A cleared flag carries no category, severity, or quote.
 */
function normaliseFlag(output: FlagResult, input: FlagInput): FlagResult {
  if (!output.flag) {
    return { flag: false, category: null, severity: null, evidenceQuote: null };
  }
  const quote = output.evidenceQuote;
  const verbatim = quote !== null && input.answer.text.includes(quote);
  return { ...output, evidenceQuote: verbatim ? quote : null };
}

/**
 * Maps a thrown SDK error to a failure code, or null when the error is not the provider's. Every
 * HTTP status counts as a provider failure: the SDK has already retried what is retryable, and the
 * light never waits on AI, so even a 400 or 401 resolves to the safe default and a logged record.
 */
function providerFailureCode(error: unknown): string | null {
  if (error instanceof APIConnectionTimeoutError) {
    return "timeout";
  }
  if (error instanceof APIConnectionError) {
    return "network";
  }
  if (error instanceof APIError) {
    return error.status === undefined ? "api_error" : `http_${error.status}`;
  }
  return null;
}

function elapsedSince(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
