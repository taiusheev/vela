/**
 * The eval gate, run by `pnpm --filter @vela/ai eval` around Promptfoo:
 *
 *   node evals/gate.ts preflight   fails clearly without ANTHROPIC_API_KEY, clears the last results
 *   node evals/gate.ts check       reads Promptfoo's results and fails when flag recall drops below the baseline
 *
 * Flag recall is the gate because a missed fall or scam call is the expensive failure (ADR-15);
 * rubric and check failures are reported for review but do not block on their own. The Promptfoo
 * config sets `PROMPTFOO_FAILED_TEST_EXIT_CODE` to 0 so a failed assertion does not end the script
 * before this check decides the exit code.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type EvalCase, listCaseFiles, mustFlag, readCaseFile } from "./cases.ts";
import { requireApiKey } from "./env.ts";

/** Where Promptfoo writes its results, relative to this directory; the eval script passes the same path. */
export const RESULTS_FILE = "results/latest.json";
export const BASELINE_FILE = "baseline.json";

export const Baseline = z.strictObject({
  /** The lowest flag recall a run may show, from 0 to 1. */
  flagRecall: z.number().min(0).max(1),
  /** Why the baseline is what it is; required so a lowered baseline carries its reason. */
  note: z.string().min(1),
});
export type Baseline = z.infer<typeof Baseline>;

const ResultRow = z.looseObject({
  success: z.boolean(),
  error: z.string().nullish(),
  vars: z.looseObject({ caseId: z.string().optional() }).optional(),
  testCase: z
    .looseObject({ metadata: z.looseObject({ caseId: z.string().optional() }).optional() })
    .optional(),
  response: z.looseObject({ output: z.unknown(), error: z.string().nullish() }).nullish(),
});
type ResultRow = z.infer<typeof ResultRow>;

/** The part of Promptfoo's `--output` JSON file (results version 3) the gate reads. */
export const ResultsFile = z.looseObject({
  results: z.looseObject({ results: z.array(ResultRow) }),
});
export type ResultsFile = z.infer<typeof ResultsFile>;

export interface GateReport {
  /** Must-flag cases flagged without error, over every must-flag case in the golden set. */
  readonly flagRecall: number;
  readonly baselineRecall: number;
  readonly mustFlagCases: number;
  /** Must-flag cases not flagged, including ones that errored or were not run. */
  readonly missed: readonly string[];
  /** Must-not-flag cases that were flagged; reported for precision review, not gated. */
  readonly falseFlags: readonly string[];
  readonly errored: readonly string[];
  /** Cases with at least one failed assertion. */
  readonly failed: readonly string[];
  readonly notRun: readonly string[];
  readonly totalCases: number;
  readonly passed: boolean;
}

/** Recall is a ratio of small integers; the tolerance only absorbs floating-point representation. */
const RECALL_TOLERANCE = 1e-9;

export function evaluateGate(
  cases: readonly EvalCase[],
  results: ResultsFile,
  baseline: Baseline,
): GateReport {
  const rowsByCase = new Map<string, ResultRow[]>();
  for (const row of results.results.results) {
    const caseId = row.testCase?.metadata?.caseId ?? row.vars?.caseId;
    if (caseId !== undefined) {
      rowsByCase.set(caseId, [...(rowsByCase.get(caseId) ?? []), row]);
    }
  }

  const missed: string[] = [];
  const falseFlags: string[] = [];
  const errored: string[] = [];
  const failed: string[] = [];
  const notRun: string[] = [];
  let mustFlagCases = 0;

  for (const evalCase of cases) {
    const rows = rowsByCase.get(evalCase.id) ?? [];
    if (rows.length === 0) {
      notRun.push(evalCase.id);
    }
    if (rows.some(hasError)) {
      errored.push(evalCase.id);
    } else if (rows.some((row) => !row.success)) {
      failed.push(evalCase.id);
    }

    const expected = mustFlag(evalCase);
    if (expected === true) {
      mustFlagCases += 1;
      // A repeated run counts as flagged only if every repetition flagged.
      const flagged = rows.length > 0 && rows.every((row) => !hasError(row) && flagOf(row));
      if (!flagged) {
        missed.push(evalCase.id);
      }
    } else if (expected === false && rows.some((row) => !hasError(row) && flagOf(row))) {
      falseFlags.push(evalCase.id);
    }
  }

  const flagRecall = mustFlagCases === 0 ? 1 : (mustFlagCases - missed.length) / mustFlagCases;
  return {
    flagRecall,
    baselineRecall: baseline.flagRecall,
    mustFlagCases,
    missed,
    falseFlags,
    errored,
    failed,
    notRun,
    totalCases: cases.length,
    passed: flagRecall + RECALL_TOLERANCE >= baseline.flagRecall,
  };
}

export function formatGateReport(report: GateReport): string {
  const percent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
  const list = (label: string, ids: readonly string[]): string[] =>
    ids.length === 0 ? [] : [`${label} (${ids.length}): ${ids.join(", ")}`];
  const flagged = report.mustFlagCases - report.missed.length;
  return [
    `Flag recall ${percent(report.flagRecall)} (${flagged} of ${report.mustFlagCases}); baseline ${percent(report.baselineRecall)}.`,
    ...list("Missed flags", report.missed),
    ...list("False flags, for precision review", report.falseFlags),
    ...list("Errored", report.errored),
    ...list("Failed an assertion, for review", report.failed),
    ...list("Not run", report.notRun),
    `${report.totalCases} cases in the golden set.`,
    report.passed
      ? report.flagRecall > report.baselineRecall + RECALL_TOLERANCE
        ? "Gate passed. Recall is above the baseline: raise baseline.json in the same change."
        : "Gate passed."
      : "Gate FAILED: flag recall dropped below the baseline.",
  ].join("\n");
}

const EVALS_DIR = new URL("./", import.meta.url);

function main(args: readonly string[]): number {
  const [command] = args;
  if (command === "preflight") {
    try {
      requireApiKey(process.env);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
    // A results file left by an earlier run must never be read as this run's.
    const resultsUrl = new URL(RESULTS_FILE, EVALS_DIR);
    rmSync(resultsUrl, { force: true });
    mkdirSync(new URL("./", resultsUrl), { recursive: true });
    return 0;
  }
  if (command === "check") {
    const resultsUrl = new URL(RESULTS_FILE, EVALS_DIR);
    if (!existsSync(resultsUrl)) {
      console.error(`No results at ${fileURLToPath(resultsUrl)}. Run the eval before the gate.`);
      return 1;
    }
    const cases = listCaseFiles().flatMap(readCaseFile);
    const results = ResultsFile.parse(JSON.parse(readFileSync(resultsUrl, "utf8")));
    const baseline = Baseline.parse(
      JSON.parse(readFileSync(new URL(BASELINE_FILE, EVALS_DIR), "utf8")),
    );
    const report = evaluateGate(cases, results, baseline);
    console.log(formatGateReport(report));
    return report.passed ? 0 : 1;
  }
  console.error("Usage: node evals/gate.ts preflight | check");
  return 2;
}

function hasError(row: ResultRow): boolean {
  return Boolean(row.error) || Boolean(row.response?.error);
}

function flagOf(row: ResultRow): boolean {
  const output = row.response?.output;
  const value = typeof output === "string" ? parseJson(output) : output;
  return typeof value === "object" && value !== null && "flag" in value && value.flag === true;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isEntryPoint(moduleUrl: string): boolean {
  const script = process.argv[1];
  return script !== undefined && resolve(script) === fileURLToPath(moduleUrl);
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
