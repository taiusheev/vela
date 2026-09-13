/**
 * The one environment requirement of an eval run, checked before anything is downloaded or called so
 * a missing key fails in the first second with an instruction rather than as a provider error on
 * every case.
 */
export function requireApiKey(env: Readonly<Record<string, string | undefined>>): string {
  const key = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (key === "") {
    throw new Error(
      [
        "ANTHROPIC_API_KEY is not set.",
        "The AI evals call Claude for every golden-set case and for the judge, so they cannot run without it.",
        "Set it in your shell and run `pnpm --filter @vela/ai eval` again.",
        "The golden-set shape test (`pnpm --filter @vela/ai test`) needs no key.",
      ].join("\n"),
    );
  }
  return key;
}
