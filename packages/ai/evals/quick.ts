/**
 * The golden set without Promptfoo: every case runs through the same `Ai` client and provider the
 * Promptfoo run uses (`EVAL_PROVIDER` picks Claude or OpenAI), its deterministic checks are applied
 * with `evaluateCheck`, and the results are written in the shape `gate.ts check` reads, so the same
 * gate (flag recall against `baseline.json`) decides. The rubric criteria need an LLM judge and are
 * not run here: this is the fast safety run, for when Promptfoo cannot be fetched (it pulls several
 * hundred megabytes) or a quick answer is enough. Run with `pnpm --filter @vela/ai eval:quick`.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClaudeAi } from "../src/claude.ts";
import { createOpenAiAi } from "../src/openai.ts";
import type { Ai } from "../src/types.ts";
import { type EvalCase, listCaseFiles, readCaseFile } from "./cases.ts";
import { evaluateCheck } from "./checks.ts";
import { evalProviderOf, requireApiKey } from "./env.ts";
import { RESULTS_FILE } from "./gate.ts";
import { createEvalProvider, type EvalProvider } from "./provider.ts";

/** One row in Promptfoo's results shape, as far as `evaluateGate` reads it. */
export interface QuickRow {
  readonly success: boolean;
  readonly failureReason?: number;
  readonly vars: { readonly caseId: string };
  readonly response: { readonly output?: unknown; readonly error?: string };
  readonly failedChecks: readonly string[];
  readonly cost: number;
}

/** Promptfoo's code for an errored call (gate.ts reads it the same way). */
const ERRORED = 2;
const ASSERT_FAILED = 1;
const CONCURRENCY = 4;

/** Runs one case and judges its deterministic checks. Never throws for a provider failure. */
export async function runCase(provider: EvalProvider, evalCase: EvalCase): Promise<QuickRow> {
  const response = await provider.callApi(`${evalCase.call} ${evalCase.id}`, {
    vars: { call: evalCase.call, input: evalCase.input, caseId: evalCase.id },
  });
  const cost = response.cost ?? 0;
  if (response.error !== undefined) {
    return {
      success: false,
      failureReason: ERRORED,
      vars: { caseId: evalCase.id },
      response: { error: response.error },
      failedChecks: [],
      cost,
    };
  }
  const failedChecks = evalCase.checks
    .map((check) => evaluateCheck(check, response.output, evalCase.input))
    .filter((result) => !result.pass)
    .map((result) => result.reason);
  return {
    success: failedChecks.length === 0,
    ...(failedChecks.length === 0 ? {} : { failureReason: ASSERT_FAILED }),
    vars: { caseId: evalCase.id },
    response: { output: response.output },
    failedChecks,
    cost,
  };
}

/** Runs every case, at most `concurrency` at a time, in the cases' order. */
export async function runAll(
  provider: EvalProvider,
  cases: readonly EvalCase[],
  concurrency = CONCURRENCY,
  onDone: (row: QuickRow, done: number) => void = () => {},
): Promise<QuickRow[]> {
  const rows: QuickRow[] = new Array(cases.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < cases.length) {
      const index = next;
      next += 1;
      const evalCase = cases.at(index);
      if (evalCase === undefined) return;
      const row = await runCase(provider, evalCase);
      rows.splice(index, 1, row);
      done += 1;
      onDone(row, done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  return rows;
}

function aiFor(env: NodeJS.ProcessEnv): Ai {
  const apiKey = requireApiKey(env);
  return evalProviderOf(env) === "openai" ? createOpenAiAi({ apiKey }) : createClaudeAi({ apiKey });
}

async function main(): Promise<number> {
  let ai: Ai;
  try {
    ai = aiFor(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const resultsUrl = new URL(RESULTS_FILE, new URL("./", import.meta.url));
  rmSync(resultsUrl, { force: true });
  mkdirSync(new URL("./", resultsUrl), { recursive: true });

  const cases = listCaseFiles().flatMap(readCaseFile);
  console.log(`Running ${cases.length} cases on ${evalProviderOf(process.env)}…`);
  const rows = await runAll(createEvalProvider(ai), cases, CONCURRENCY, (row, done) => {
    const mark = row.failureReason === ERRORED ? "error" : row.success ? "ok" : "check failed";
    console.log(`${String(done).padStart(3)}/${cases.length} ${row.vars.caseId}: ${mark}`);
  });

  writeFileSync(resultsUrl, `${JSON.stringify({ results: { results: rows } }, null, 2)}\n`);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  console.log("");
  for (const row of rows.filter((r) => !r.success)) {
    const why = row.response.error ?? row.failedChecks.join("; ");
    console.log(`- ${row.vars.caseId}: ${why}`);
  }
  console.log(`\nProvider cost of this run: US$${cost.toFixed(4)}`);
  console.log(`Results written to ${fileURLToPath(resultsUrl)} (rubric criteria not judged here).`);
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  process.exitCode = await main();
}
