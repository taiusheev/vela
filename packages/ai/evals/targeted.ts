/** Bounded live regression repeats; never replaces the full golden-set safety report. */
import { writeFileSync } from "node:fs";
import { createOpenAiAi } from "../src/openai.ts";
import { listCaseFiles, readCaseFile } from "./cases.ts";
import { createEvalProvider } from "./provider.ts";
import { runCase } from "./quick.ts";

const ids = process.argv.slice(2);
if (ids.length < 1 || ids.length > 10 || ids.some((id) => !/^[a-z0-9-]{1,100}$/.test(id)))
  throw new Error("Select one to ten case ids");
const cases = listCaseFiles()
  .flatMap(readCaseFile)
  .filter((item) => ids.includes(item.id));
if (cases.length !== new Set(ids).size) throw new Error("Unknown case id");
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("Missing private evaluation credential");
const provider = createEvalProvider(createOpenAiAi({ apiKey: key }));
const rows = [];
for (let repeat = 0; repeat < 3; repeat++) {
  const results = await Promise.allSettled(cases.map((item) => runCase(provider, item)));
  for (const result of results) {
    if (result.status !== "fulfilled") throw new Error("Targeted evaluation failed");
    rows.push(result.value);
  }
  console.log(`Regression round ${repeat + 1}/3 completed`);
}
const report = {
  recordedAt: new Date().toISOString(),
  kind: "targeted-live-regressions",
  cases: ids,
  repetitions: 3,
  attempts: rows.length,
  passed: rows.filter((row) => row.success).length,
  failures: rows
    .filter((row) => !row.success)
    .map((row) => ({ id: row.vars.caseId, checks: row.failedChecks })),
  costUsd: rows.reduce((sum, row) => sum + row.cost, 0),
  rubricJudged: false,
};
writeFileSync(
  new URL("../../../infra/load-tests/hosted-swarm-ai-targeted.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report));
if (report.failures.length) process.exitCode = 1;
