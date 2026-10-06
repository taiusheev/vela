/**
 * The environment of an eval run, checked before anything is downloaded or called so a missing key
 * fails in the first second with an instruction rather than as a provider error on every case.
 *
 * `EVAL_PROVIDER` picks the `Ai` the golden set runs through: `anthropic` (the default,
 * `createClaudeAi`, judged by Claude) or `openai` (`createOpenAiAi`, judged by GPT-5; founder
 * decision of 6 October 2026), each with its own key.
 */
export type EvalProvider = "anthropic" | "openai";

const KEY_FOR: Readonly<Record<EvalProvider, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function evalProviderOf(env: Readonly<Record<string, string | undefined>>): EvalProvider {
  const value = env.EVAL_PROVIDER?.trim() ?? "";
  if (value === "" || value === "anthropic") {
    return "anthropic";
  }
  if (value === "openai") {
    return "openai";
  }
  throw new Error(`EVAL_PROVIDER must be anthropic or openai, not ${JSON.stringify(value)}.`);
}

export function requireApiKey(env: Readonly<Record<string, string | undefined>>): string {
  const provider = evalProviderOf(env);
  const name = KEY_FOR[provider];
  const key = env[name]?.trim() ?? "";
  if (key === "") {
    const script = provider === "openai" ? "eval:openai" : "eval";
    throw new Error(
      [
        `${name} is not set.`,
        `The AI evals call ${provider === "openai" ? "OpenAI" : "Claude"} for every golden-set case and for the judge, so they cannot run without it.`,
        `Set it in your shell and run \`pnpm --filter @vela/ai ${script}\` again.`,
        "The golden-set shape test (`pnpm --filter @vela/ai test`) needs no key.",
      ].join("\n"),
    );
  }
  return key;
}
