/** Read-only verification of the fixed synthetic cohort. No tail session and no HTTP retries. */
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const account = "bc94bcf058bcf6b9c4930d9138feda86";
const name = "vela-swarm-20261018";
const origin = `https://${name}.vela-light-staging.workers.dev`;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token || process.env.CLOUDFLARE_ACCOUNT_ID !== account)
  throw new Error("staging_account_required");
const secret = createHmac("sha256", token).update("vela-hosted-swarm/control").digest("base64url");
const rounds = Number(process.env.VELA_SWARM_HTTP_ROUNDS ?? 3);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error("invalid_rounds");

async function control(path) {
  const r = await fetch(`${origin}/control/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`control_${path}_${r.status}`);
  return r.json();
}
const settingsResponse = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}/settings`,
  { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
);
if (!settingsResponse.ok) throw new Error(`worker_settings_${settingsResponse.status}`);
const { result: settings } = await settingsResponse.json();
if (settings?.limits?.cpu_ms !== 100)
  throw new Error("isolated_cpu_budget_100ms_required_before_verification");
const { families } = await control("manifest");
if (families.length !== 100 || families.some((f, index) => f.index !== index))
  throw new Error("expected_recorded_100_family_cohort");
const before = await control("stats");
const report = {
  kind: "hosted-read-only-http-bursts",
  source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty:
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
  startedAt: new Date().toISOString(),
  concurrency: 20,
  retries: 0,
  configuredCpuMs: settings?.limits?.cpu_ms ?? null,
  before,
  rounds: [],
  limitations: [
    "Existing synthetic cohort only; real sessions and messenger delivery remain outside this test.",
    "No live tail session: inspect persisted observability after testing to retain normal execution conditions.",
  ],
};
for (let round = 0; round < rounds; round++) {
  let cursor = 0;
  const elapsed = [],
    statuses = {},
    failures = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= families.length) return;
        const family = families[index];
        const began = performance.now();
        try {
          const r = await fetch(`${origin}/v1/families/${family.familyId}/today`, {
            headers: { authorization: `Bearer ${family.token}` },
            signal: AbortSignal.timeout(30_000),
          });
          statuses[r.status] = (statuses[r.status] ?? 0) + 1;
          if (r.ok) {
            const body = await r.json();
            if (body.exchanges.length !== 1 || body.exchanges[0].recipient_id !== family.memberId)
              failures.push({ index, status: r.status, reason: "unexpected_family_data" });
          } else {
            const body = await r.json().catch(() => null);
            const code = body?.error?.code;
            failures.push({
              index,
              status: r.status,
              code: /^[a-z_]{1,50}$/.test(code ?? "") ? code : "non_api_response",
            });
          }
        } catch (error) {
          failures.push({
            index,
            reason: error?.name === "TimeoutError" ? "timeout" : "network_or_body",
          });
        }
        elapsed.push(performance.now() - began);
      }
    }),
  );
  elapsed.sort((a, b) => a - b);
  const row = {
    round,
    requests: elapsed.length,
    statuses,
    failures,
    elapsedMs: performance.now() - started,
    p50Ms: elapsed[Math.ceil(elapsed.length * 0.5) - 1],
    p95Ms: elapsed[Math.ceil(elapsed.length * 0.95) - 1],
  };
  report.rounds.push(row);
  console.log(JSON.stringify({ round, statuses, errors: failures.length }));
}
report.after = await control("stats");
report.unchanged = Object.entries(before).every(([key, value]) => report.after[key] === value);
report.passed =
  report.unchanged && report.rounds.every((r) => r.requests === 100 && r.failures.length === 0);
report.finishedAt = new Date().toISOString();
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const receipt = `${root}infra/load-tests/hosted-swarm-cpu-http-bursts.json`;
await writeFile(receipt, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, receipt }));
if (!report.passed) process.exitCode = 1;
