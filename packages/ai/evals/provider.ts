/**
 * The Promptfoo provider: runs one golden-set case through `createClaudeAi`, the same client services
 * use, so the eval measures the shipped prompts, routes, and output schemas rather than a copy.
 */
import { z } from "zod";
import { createClaudeAi } from "../src/claude.ts";
import { AI_CALL_NAMES, type Ai, AiCallName, type AiOutcome } from "../src/types.ts";
import { INPUT_SCHEMAS } from "./cases.ts";
import { requireApiKey } from "./env.ts";

/** Promptfoo's provider response, as far as this provider fills it in. */
export interface ProviderResponse {
  readonly output?: unknown;
  readonly error?: string;
  readonly cost?: number;
  readonly tokenUsage?: {
    readonly total: number;
    readonly prompt: number;
    readonly completion: number;
    readonly cached: number;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** What Promptfoo passes `callApi` besides the rendered prompt, as far as this provider reads it. */
export interface CallApiContext {
  readonly vars?: Readonly<Record<string, unknown>>;
}

export interface EvalProvider {
  id(): string;
  callApi(prompt: string, context?: CallApiContext): Promise<ProviderResponse>;
}

export const PROVIDER_ID = "vela-ai";

/**
 * Dispatches to the `Ai` method for `call`. The input is parsed with that call's schema, so an input
 * that does not match throws a ZodError before any request.
 */
function runCall(ai: Ai, call: AiCallName, input: unknown): Promise<AiOutcome<unknown>> {
  switch (call) {
    case "understand":
      return ai.understand(INPUT_SCHEMAS.understand.parse(input));
    case "flag":
      return ai.flag(INPUT_SCHEMAS.flag.parse(input));
    case "chips":
      return ai.chips(INPUT_SCHEMAS.chips.parse(input));
    case "suggest":
      return ai.suggest(INPUT_SCHEMAS.suggest.parse(input));
    case "translate":
      return ai.translate(INPUT_SCHEMAS.translate.parse(input));
    case "readback":
      return ai.readback(INPUT_SCHEMAS.readback.parse(input));
    case "hello":
      return ai.hello(INPUT_SCHEMAS.hello.parse(input));
    case "weekly_read":
      return ai.weeklyRead(INPUT_SCHEMAS.weekly_read.parse(input));
  }
}

/**
 * A failed call is an error for Promptfoo, never an output: the safe default it carries would pass
 * some checks (an unflagged answer, an untranslated text) and hide the failure.
 */
function toProviderResponse(outcome: AiOutcome<unknown>): ProviderResponse {
  const { record } = outcome;
  const accounting = {
    cost: record.costUsd,
    tokenUsage: {
      total: record.tokensIn + record.tokensOut,
      prompt: record.tokensIn,
      completion: record.tokensOut,
      cached: record.tokensCached,
    },
    metadata: {
      model: record.model,
      promptVersion: record.promptVersion,
      latencyMs: record.latencyMs,
    },
  };
  if (!outcome.ok) {
    return { error: `${record.call} failed: ${outcome.error}`, ...accounting };
  }
  return { output: outcome.value, ...accounting };
}

/** The provider logic over any `Ai`, so tests can drive it with the fake. */
export function createEvalProvider(ai: Ai): EvalProvider {
  return {
    id: () => PROVIDER_ID,
    callApi: async (_prompt, context) => {
      const call = AiCallName.safeParse(context?.vars?.call);
      if (!call.success) {
        return { error: `vars.call must be one of ${AI_CALL_NAMES.join(", ")}` };
      }
      try {
        return toProviderResponse(await runCall(ai, call.data, context?.vars?.input));
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issues = z.prettifyError(error);
          return { error: `vars.input does not match the ${call.data} input schema:\n${issues}` };
        }
        throw error;
      }
    },
  };
}

/**
 * Promptfoo instantiates a custom provider from the file's default export, which is why this module
 * breaks the named-exports rule. Construction fails without `ANTHROPIC_API_KEY`, so a run without a
 * key stops while loading providers instead of erroring on every case.
 */
export default class VelaAiProvider implements EvalProvider {
  readonly #provider: EvalProvider;

  constructor() {
    this.#provider = createEvalProvider(createClaudeAi({ apiKey: requireApiKey(process.env) }));
  }

  id(): string {
    return this.#provider.id();
  }

  callApi(prompt: string, context?: CallApiContext): Promise<ProviderResponse> {
    return this.#provider.callApi(prompt, context);
  }
}
