import { z } from "zod";
import { normaliseFlag, normaliseUnderstanding } from "./claude.ts";
import { SAFE_DEFAULTS } from "./defaults.ts";
import { MAX_RETRIES, MAX_TOKENS_FOR, TIMEOUT_MS_FOR } from "./models.ts";
import { PROMPTS, renderUserTurn } from "./prompts/index.ts";
import {
  type Ai,
  type AiCallName,
  type AiCallRecord,
  type AiCallTypes,
  type AiOutcome,
  INPUT_SCHEMAS,
  OUTPUT_SCHEMAS,
} from "./types.ts";

export interface OpenAiOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** The wait before retry n is `retryBaseMs * 2^n`; tests set it to zero. */
  retryBaseMs?: number;
}

/** The one host the key is ever sent to. */
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export const OPENAI_MODELS = ["gpt-5", "gpt-5-mini"] as const;
export type OpenAiModel = (typeof OPENAI_MODELS)[number];

/**
 * The same routing idea as `MODEL_FOR` (ADR-15): a missed health or safety signal is the expensive
 * failure, so `flag` and the judgment calls run on the stronger model; templated drafting runs on
 * the small one.
 */
export const OPENAI_MODEL_FOR: Record<AiCallName, OpenAiModel> = {
  flag: "gpt-5",
  understand: "gpt-5",
  translate: "gpt-5",
  readback: "gpt-5",
  weekly_read: "gpt-5",
  recipe: "gpt-5",
  chips: "gpt-5-mini",
  suggest: "gpt-5-mini",
  hello: "gpt-5-mini",
};

export type OpenAiReasoningEffort = "minimal" | "low" | "medium";

export const OPENAI_EFFORT_FOR: Record<AiCallName, OpenAiReasoningEffort> = {
  flag: "low",
  understand: "low",
  translate: "low",
  readback: "low",
  weekly_read: "medium",
  recipe: "low",
  chips: "minimal",
  suggest: "minimal",
  hello: "minimal",
};

/** US dollars per million tokens; cached input is billed at its own rate. */
export interface OpenAiPrice {
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
}

export const OPENAI_PRICES: Readonly<Record<OpenAiModel, OpenAiPrice>> = {
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
};

/**
 * A response names a dated snapshot (`gpt-5-2025-08-07`), so it is priced by its family; an unknown
 * id is priced at the routed model rather than logged as free.
 */
export function openAiPriceFor(servedModel: string, routedModel: OpenAiModel): OpenAiPrice {
  const family = [...OPENAI_MODELS]
    .sort((a, b) => b.length - a.length)
    .find((model) => servedModel === model || servedModel.startsWith(`${model}-2`));
  return OPENAI_PRICES[family ?? routedModel];
}

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: ChatUsage;
}

interface CallSpec<K extends AiCallName> {
  readonly call: K;
  readonly normalise?: (
    output: AiCallTypes[K]["output"],
    input: AiCallTypes[K]["input"],
  ) => AiCallTypes[K]["output"];
}

/**
 * OpenAI behind the same `Ai` port as Claude: one Chat Completions request per call, the call's
 * versioned system prompt, structured output against the call's Zod schema, and the same safe
 * default for every failure. `store: false` keeps the completion out of OpenAI's stored logs.
 * Plain `fetch`, so it runs in a Worker with no SDK and no environment variable can redirect it.
 */
export function createOpenAiAi(options: OpenAiOptions): Ai {
  const client: Client = {
    apiKey: options.apiKey,
    fetch: options.fetch ?? fetch,
    retryBaseMs: options.retryBaseMs ?? 500,
  };
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
    recipe: (input) => invoke(client, { call: "recipe" }, input),
  };
}

interface Client {
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly retryBaseMs: number;
}

/** The JSON Schema OpenAI is asked to answer in; the Zod schema still checks what comes back. */
export function responseSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...json } = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" });
  return json;
}

async function invoke<K extends AiCallName>(
  client: Client,
  spec: CallSpec<K>,
  rawInput: AiCallTypes[K]["input"],
): Promise<AiOutcome<AiCallTypes[K]["output"]>> {
  // Invalid input is a bug in the caller, not a provider failure, so it throws before any request.
  const input = INPUT_SCHEMAS[spec.call].parse(rawInput);
  const outputSchema: z.ZodType<AiCallTypes[K]["output"]> = OUTPUT_SCHEMAS[spec.call];
  const model = OPENAI_MODEL_FOR[spec.call];
  const prompt = PROMPTS[spec.call];

  const body = JSON.stringify({
    model,
    store: false,
    max_completion_tokens: MAX_TOKENS_FOR[spec.call],
    reasoning_effort: OPENAI_EFFORT_FOR[spec.call],
    messages: [
      { role: "developer", content: prompt.system },
      { role: "user", content: renderUserTurn(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: spec.call, strict: false, schema: responseSchema(outputSchema) },
    },
  });

  const failure = (error: string, record: AiCallRecord): AiOutcome<AiCallTypes[K]["output"]> => ({
    ok: false,
    value: SAFE_DEFAULTS[spec.call](input),
    record: { ...record, ok: false, error },
    error,
  });
  const started = performance.now();
  const unbilled = (): AiCallRecord => ({
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

  const sent = await send(client, body, TIMEOUT_MS_FOR[spec.call]);
  if (!sent.ok) {
    return failure(sent.error, unbilled());
  }
  const completion = sent.completion;

  const usage = completion.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? 0;
  const cached = Math.min(promptTokens, usage.prompt_tokens_details?.cached_tokens ?? 0);
  const outputTokens = usage.completion_tokens ?? 0;
  const servedModel = completion.model ?? model;
  const price = openAiPriceFor(servedModel, model);
  const record: AiCallRecord = {
    call: spec.call,
    promptVersion: prompt.version,
    model: servedModel,
    ok: true,
    tokensIn: promptTokens,
    tokensOut: outputTokens,
    tokensCached: cached,
    latencyMs: elapsedSince(started),
    costUsd:
      Math.round(
        (promptTokens - cached) * price.input +
          cached * price.cachedInput +
          outputTokens * price.output,
      ) / 1_000_000,
  };

  // A refusal or a truncation can leave partial text that is not the answer, so the finish reason
  // is settled before any content is read.
  const choice = completion.choices?.[0];
  if (choice?.message?.refusal) {
    return failure("refusal", record);
  }
  if (choice?.finish_reason === "length") {
    return failure("truncated", record);
  }
  if (choice?.finish_reason !== "stop") {
    return failure(`stop_${choice?.finish_reason ?? "unknown"}`, record);
  }
  const text = choice.message?.content ?? "";
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

type Sent = { ok: true; completion: ChatCompletion } | { ok: false; error: string };

/** Retries a timeout, a connection error, a 408, 409, 429 or 5xx, as the Anthropic SDK does. */
function retryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function send(client: Client, body: string, timeoutMs: number): Promise<Sent> {
  let last: Sent = { ok: false, error: "api_error" };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(client.retryBaseMs * 2 ** (attempt - 1));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    let response: Response;
    try {
      response = await client.fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${client.apiKey}`,
          "content-type": "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      last = { ok: false, error: controller.signal.aborted ? "timeout" : "network" };
      continue;
    }
    try {
      if (!response.ok) {
        await response.body?.cancel();
        last = { ok: false, error: `http_${response.status}` };
        if (retryable(response.status)) {
          continue;
        }
        return last;
      }
      const completion = (await response.json()) as ChatCompletion;
      return { ok: true, completion };
    } catch {
      last = { ok: false, error: controller.signal.aborted ? "timeout" : "api_error" };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsedSince(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
