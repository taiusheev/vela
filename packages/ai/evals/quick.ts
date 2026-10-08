/**
 * The golden set without Promptfoo: every case runs through the same `Ai` client and provider the
 * Promptfoo run uses (`EVAL_PROVIDER` picks Claude or OpenAI), its deterministic checks are applied
 * with `evaluateCheck`, and the results are written in the shape `gate.ts check` reads, so the same
 * gate (flag recall against `baseline.json`) decides. This is the run for when Promptfoo cannot be
 * fetched (it pulls several hundred megabytes) or a quick answer is enough. Run with
 * `pnpm --filter @vela/ai eval:quick`. With `EVAL_JUDGE=on` on OpenAI (`eval:openai:judged`), GPT-5
 * also judges every rubric criterion through `judge.ts`; a failed criterion is listed for review
 * like a failed check, and never moves flag recall.
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
import { createJudge, type Judge } from "./judge.ts";
import { createEvalProvider, type EvalProvider } from "./provider.ts";
import { CALL_CHECKS } from "./suite.ts";

/** One row in Promptfoo's results shape, as far as `evaluateGate` reads it. */
export interface QuickRow {
  readonly success: boolean;
  readonly failureReason?: number;
  readonly vars: { readonly caseId: string };
  readonly response: { readonly output?: unknown; readonly error?: string };
  readonly failedChecks: readonly string[];
  /** Rubric criteria the judge could not decide (its call failed); not counted as failures. */
  readonly judgeErrors?: readonly string[];
  /** Rubric criteria judged, when the judge ran. */
  readonly judged?: { readonly passed: number; readonly failed: number };
  readonly cost: number;
}

/** Promptfoo's code for an errored call (gate.ts reads it the same way). */
const ERRORED = 2;
const ASSERT_FAILED = 1;
const CONCURRENCY = 4;

/**
 * Runs one case and judges its deterministic checks, and its rubric criteria when a judge is given.
 * Never throws for a provider or judge failure.
 */
export async function runCase(
  provider: EvalProvider,
  evalCase: EvalCase,
  judge?: Judge,
): Promise<QuickRow> {
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
  const failedChecks = [...evalCase.checks, ...CALL_CHECKS[evalCase.call]]
    .map((check) => evaluateCheck(check, response.output, evalCase.input))
    .filter((result) => !result.pass)
    .map((result) => result.reason);
  const judged = judge === undefined ? null : await judge.judgeCase(evalCase, response.output);
  const judgements = judged?.judgements ?? [];
  for (const judgement of judgements) {
    if (judgement.kind === "fail") {
      failedChecks.push(`judge: ${judgement.criterion} (${judgement.reason})`);
    }
  }
  const judgeErrors = judgements.flatMap((judgement) =>
    judgement.kind === "error" ? [`${judgement.criterion} (${judgement.error})`] : [],
  );
  return {
    success: failedChecks.length === 0,
    ...(failedChecks.length === 0 ? {} : { failureReason: ASSERT_FAILED }),
    vars: { caseId: evalCase.id },
    response: { output: response.output },
    failedChecks,
    ...(judged === null
      ? {}
      : {
          judgeErrors,
          judged: {
            passed: judgements.filter((judgement) => judgement.kind === "pass").length,
            failed: judgements.filter((judgement) => judgement.kind === "fail").length,
          },
        }),
    cost: cost + (judged?.cost ?? 0),
  };
}

/** Runs every case, at most `concurrency` at a time, in the cases' order. */
export async function runAll(
  provider: EvalProvider,
  cases: readonly EvalCase[],
  concurrency = CONCURRENCY,
  onDone: (row: QuickRow, done: number) => void = () => {},
  judge?: Judge,
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
      const row = await runCase(provider, evalCase, judge);
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

/** `EVAL_JUDGE=on` asks for the rubric judge, which runs on OpenAI only. */
export function judgeFor(env: NodeJS.ProcessEnv): Judge | undefined {
  const wanted = env.EVAL_JUDGE?.trim() ?? "";
  if (wanted === "" || wanted === "off") return undefined;
  if (wanted !== "on")
    throw new Error(`EVAL_JUDGE must be on or off, not ${JSON.stringify(wanted)}.`);
  if (evalProviderOf(env) !== "openai") {
    throw new Error("EVAL_JUDGE=on judges with GPT-5: set EVAL_PROVIDER=openai, or use Promptfoo.");
  }
  return createJudge({ apiKey: requireApiKey(env) });
}

async function main(): Promise<number> {
  let ai: Ai;
  let judge: Judge | undefined;
  try {
    ai = aiFor(process.env);
    judge = judgeFor(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const resultsUrl = new URL(RESULTS_FILE, new URL("./", import.meta.url));
  rmSync(resultsUrl, { force: true });
  mkdirSync(new URL("./", resultsUrl), { recursive: true });

  const cases = listCaseFiles().flatMap(readCaseFile);
  const judging = judge === undefined ? "" : ", rubric judged by GPT-5";
  console.log(`Running ${cases.length} cases on ${evalProviderOf(process.env)}${judging}…`);
  const rows = await runAll(
    createEvalProvider(ai),
    cases,
    CONCURRENCY,
    (row, done) => {
      const mark = row.failureReason === ERRORED ? "error" : row.success ? "ok" : "check failed";
      console.log(`${String(done).padStart(3)}/${cases.length} ${row.vars.caseId}: ${mark}`);
    },
    judge,
  );

  writeFileSync(resultsUrl, `${JSON.stringify({ results: { results: rows } }, null, 2)}\n`);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  console.log("");
  for (const row of rows.filter((r) => !r.success)) {
    const why = row.response.error ?? row.failedChecks.join("; ");
    console.log(`- ${row.vars.caseId}: ${why}`);
  }
  if (judge !== undefined) {
    console.log("");
    console.log(formatJudgeSummary(rows));
  }
  console.log(`\nProvider cost of this run: US$${cost.toFixed(4)}`);
  const judgedNote =
    judge === undefined ? " (rubric criteria not judged; EVAL_JUDGE=on judges them)" : "";
  console.log(`Results written to ${fileURLToPath(resultsUrl)}${judgedNote}.`);
  return 0;
}

/** The judge's totals over a run, with every criterion it could not decide. */
export function formatJudgeSummary(rows: readonly QuickRow[]): string {
  const passed = rows.reduce((sum, row) => sum + (row.judged?.passed ?? 0), 0);
  const failed = rows.reduce((sum, row) => sum + (row.judged?.failed ?? 0), 0);
  const errors = rows.flatMap((row) =>
    (row.judgeErrors ?? []).map((error) => `- ${row.vars.caseId}: ${error}`),
  );
  const total = passed + failed + errors.length;
  return [
    `Rubric: ${passed} of ${total} criteria passed, ${failed} failed (listed above with "judge:"), ${errors.length} not judged.`,
    ...errors,
  ].join("\n");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  process.exitCode = await main();
}
