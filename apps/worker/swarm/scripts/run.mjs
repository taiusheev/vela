/** Staging-only orchestrator. Secrets are derived in memory and never written or printed. */

import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const workerDir = `${root}apps/worker`;
const account = "bc94bcf058bcf6b9c4930d9138feda86";
const name = "vela-swarm-20261018";
const origin = `https://${name}.vela-light-staging.workers.dev`;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token || process.env.CLOUDFLARE_ACCOUNT_ID !== account)
  throw new Error("staging_account_required");
const derive = (label) =>
  createHmac("sha256", token).update(`vela-hosted-swarm/${label}`).digest("base64url");
const secret = derive("control");
const contentKey = derive("sealing");
async function cf(path, method = "GET", body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success)
    throw new Error(`cloudflare_${response.status}_${result.errors?.[0]?.code ?? "unknown"}`);
  return result.result;
}
async function command(args) {
  const status = await new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, { cwd: workerDir, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (status !== 0) throw new Error("command_failed");
}
async function provision() {
  const listed = await cf("queues?per_page=100");
  const queues = {};
  for (const kind of ["outbound", "understand", "media", "inbound", "dead"]) {
    const queueName = kind === "dead" ? "vela-dead-letter-swarm-20261018" : `${name}-${kind}`;
    queues[kind] =
      listed.find((q) => q.queue_name === queueName) ??
      (await cf("queues", "POST", { queue_name: queueName }));
  }
  const bindings = {
    outbound: "OUTBOUND_QUEUE",
    understand: "UNDERSTAND_QUEUE",
    media: "MEDIA_QUEUE",
    inbound: "INBOUND_QUEUE",
  };
  const config = {
    name,
    main: "worker.ts",
    compatibility_date: "2026-08-22",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    preview_urls: false,
    observability: { enabled: true },
    alias: { "@vela/db": "./db.ts" },
    vars: { ENVIRONMENT: "staging", API_V1: "on", LINE_CHANNEL: "off" },
    hyperdrive: [{ binding: "HYPERDRIVE", id: "e9e9837d1eee47528304916a1ac2d1e9" }],
    durable_objects: {
      bindings: [
        { name: "MEMBER_SCHEDULER", class_name: "SwarmMemberScheduler" },
        { name: "SWARM_CONTROL", class_name: "SwarmControl" },
      ],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["SwarmMemberScheduler", "SwarmControl"] }],
    queues: {
      producers: Object.entries(bindings).map(([k, binding]) => ({
        binding,
        queue: queues[k].queue_name,
      })),
      consumers: Object.entries(queues).map(([kind, q]) => ({
        queue: q.queue_name,
        max_batch_size: 5,
        max_batch_timeout: 1,
        max_retries: 5,
        max_concurrency: 20,
        retry_delay: 10,
        ...(kind === "dead" ? {} : { dead_letter_queue: queues.dead.queue_name }),
      })),
    },
  };
  await writeFile(`${workerDir}/swarm/wrangler.generated.json`, JSON.stringify(config, null, 2));
  await command(["exec", "wrangler", "deploy", "--config", "swarm/wrangler.generated.json"]);
  for (const [key, value] of Object.entries({ SWARM_SECRET: secret, CONTENT_KEY_V1: contentKey })) {
    await cf(`workers/scripts/${name}/secrets`, "PUT", {
      name: key,
      text: value,
      type: "secret_text",
    });
  }
  console.log(
    "Isolated Worker, queues, scheduler and control secrets deployed; shared staging Worker unchanged.",
  );
}
async function control(path, body = {}) {
  const response = await fetch(`${origin}/control/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`control_${path}_${response.status}`);
  return response.json();
}
async function pool(items, operation, concurrency = 20) {
  let cursor = 0;
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await operation(items[i], i);
      }
    }),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}
const phases = [];
async function measured(phase, operation) {
  const start = performance.now();
  const result = await operation();
  const record = { phase, elapsedMs: performance.now() - start };
  phases.push(record);
  console.log(JSON.stringify(record));
  return result;
}
async function settle(label, check) {
  const deadline = Date.now() + 300000;
  for (;;) {
    const stats = await control("stats");
    if (stats.dead || stats.duplicates) throw new Error(`${label}_dead_or_duplicate`);
    if (check(stats)) return stats;
    if (Date.now() > deadline) throw new Error(`${label}_timeout`);
    await delay(1500);
  }
}
const count = Number(process.env.VELA_HOSTED_FAMILIES ?? 10);
const days = Number(process.env.VELA_HOSTED_DAYS ?? 2);
const mixed = process.env.VELA_HOSTED_MIXED === "1";
if (mixed && (count < 40 || days !== 3)) throw new Error("mixed_needs_40_families_and_3_days");
if (
  !Number.isInteger(count) ||
  count < 2 ||
  count > 100 ||
  !Number.isInteger(days) ||
  days < 1 ||
  days > 7
)
  throw new Error("invalid_cohort");
const evidence = {
  startedAt: new Date().toISOString(),
  kind: "hosted-cloudflare-neon-product-flow",
  families: count,
  days,
  mixed,
  queueMaxConcurrency: 20,
  clientConcurrency: 20,
  source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty:
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
  status: "in_progress",
  passed: false,
  phases,
  limitations: [
    "Isolated explicitly qualified PostgreSQL schema sharing staging's Neon compute and Hyperdrive.",
    "Real deployed HTTP routes, Cloudflare queues, Durable Object alarms, gateway, sealed PostgreSQL writes and app read services.",
    "Synthetic JWT sessions replace Clerk; recording Telegram and AI-off fallback. No real-provider, AI-quality or native-device evidence.",
    "Virtual dates are advanced between phases; this is not a wall-clock soak or production capacity measurement.",
  ],
};
const receipt = `${root}infra/load-tests/hosted-swarm-${count}-${days}.json`;
let seeded = false;
try {
  if (!process.argv.includes("--provision-only"))
    await writeFile(receipt, `${JSON.stringify(evidence, null, 2)}\n`);
  if (process.argv.includes("--deploy")) await provision();
  if (process.argv.includes("--provision-only")) process.exit(0);
  await control("time", { time: "2026-10-18T00:00:00.000Z" });
  if (process.argv.includes("--reset")) await control("reset");
  await measured("initialize-isolated-schema", () => control("init"));
  const cohort = [];
  await measured("seed", () =>
    pool(
      Array.from({ length: count }, (_, i) => i),
      async (index) => {
        cohort[index] = await control("seed", { index });
      },
    ),
  );
  seeded = true;
  const totals = { delivered: 0, answers: 0, replies: 0, readBack: 0, signed: 0 };
  async function post(family, path, body, key, status = 200) {
    const r = await fetch(`${origin}/v1/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${family.token}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    });
    if (r.status !== status) throw new Error(`scenario_write_${r.status}`);
    return r.json();
  }
  for (let day = 0; day < days; day++) {
    await control("time", {
      time: new Date(Date.parse("2026-10-18T00:00:00.000Z") + day * 86400000).toISOString(),
    });
    const active = cohort.flatMap((family, index) =>
      mixed && day === 1 && index < 20 ? [] : [{ family, index }],
    );
    totals.delivered += active.length;
    totals.answers += active.length + (mixed ? 10 : 0);
    totals.replies += active.length;
    totals.readBack += day === 0 ? 0 : active.length;
    totals.signed += active.filter(
      ({ index }) => index % 2 === 0 && !(mixed && day > 0 && index >= 20 && index < 30),
    ).length;
    await measured(`day-${day}:schedule-and-cloud-queue-delivery`, async () => {
      await pool(cohort, (_, index) => control("wake", { index, day }));
      return settle("morning", (s) => s.delivered === totals.delivered && s.pending === 0);
    });
    await measured(`day-${day}:inbound-cloud-queue`, async () => {
      await pool(active, ({ index }) => control("answer", { index, day }));
      if (mixed)
        await pool(
          active.filter(({ index }) => index >= 30 && index < 40),
          ({ index }) => control("answer", { index, day, part: 1 }),
        );
      return settle("answers", (s) => s.answers === totals.answers && s.pending === 0);
    });
    const reads = [];
    await measured(`day-${day}:http-reply-and-app-reads`, () =>
      pool(cohort, async (family, index) => {
        const headers = { authorization: `Bearer ${family.token}` };
        async function get(path, status = 200) {
          const r = await fetch(`${origin}/v1/${path}`, { headers });
          if (r.status !== status) throw new Error(`api_read_${r.status}`);
          return r.json();
        }
        const started = performance.now();
        const today = await get(`families/${family.familyId}/today`);
        const card = today.exchanges[0];
        if (mixed && day === 1 && index < 20) {
          const memories = await get(`families/${family.familyId}/exchanges`);
          if (today.lights[0]?.state !== "away" || memories.exchanges.length !== 1)
            throw new Error("away_mismatch");
          return;
        }
        if (
          card?.answers?.length !== (mixed && index >= 30 && index < 40 ? 2 : 1) ||
          card.answers[0].text !== `Synthetic answer ${index} day ${day}`
        )
          throw new Error(`answer_mismatch_${index}`);
        if (
          mixed &&
          index >= 30 &&
          index < 40 &&
          card.answers[1].text !== `Synthetic answer ${index} day ${day} follow-up`
        )
          throw new Error("followup_mismatch");
        if (
          card.drafted_by_vela !==
          (index % 2 === 0 && !(mixed && day > 0 && index >= 20 && index < 30))
        )
          throw new Error("signature_choice_mismatch");
        family.cardId = card.id;
        const replyBody = JSON.stringify({ text: `Synthetic reply ${index} day ${day}` });
        for (let repeat = 0; repeat < 2; repeat++) {
          const response = await fetch(`${origin}/v1/exchanges/${card.id}/replies`, {
            method: "POST",
            headers: {
              ...headers,
              "content-type": "application/json",
              "idempotency-key": `hosted-${day}`,
            },
            body: replyBody,
          });
          if (response.status !== 201) throw new Error(`api_reply_${response.status}`);
        }
        const memories = await get(`families/${family.familyId}/exchanges`);
        if (
          memories.exchanges.length !== day + 1 - (mixed && day > 0 && index < 20 ? 1 : 0) ||
          memories.exchanges.some((x) => x.recipient_id !== family.memberId)
        )
          throw new Error("memories_mismatch");
        await get(`families/${cohort[(index + 1) % count].familyId}/today`, 404);
        await get(`families/${cohort[(index + 1) % count].familyId}/exchanges`, 404);
        reads.push(performance.now() - started);
      }),
    );
    reads.sort((a, b) => a - b);
    phases.push({
      phase: `day-${day}:http-journey-p95`,
      p95Ms: reads[Math.ceil(reads.length * 0.95) - 1],
    });
    const stats = await control("stats");
    console.log(JSON.stringify({ day, ...stats }));
    if (
      stats.replies !== totals.replies ||
      stats.read_back !== totals.readBack ||
      stats.signed !== totals.signed ||
      stats.quiet !== 0
    )
      throw new Error("daily_reconciliation");
    if (mixed && day === 0) {
      await measured("away-and-signature-preferences", async () => {
        await pool(cohort.slice(0, 20), (family) =>
          post(
            family,
            `families/${family.familyId}/members/${family.memberId}/away`,
            { from: "2026-10-19", until: "2026-10-19" },
            "away-on",
            201,
          ),
        );
        await pool(cohort.slice(20, 30), (family, localIndex) =>
          post(
            family,
            `families/${family.familyId}/members/${family.memberId}/morning`,
            {
              arrival_time: localIndex % 2 === 0 ? "08:00" : "07:00",
              language: (localIndex + 20) % 3 === 0 ? "zh-TW" : "en",
              send_as_me: false,
            },
            "signature-off",
          ),
        );
        await pool(cohort.slice(40, 50), (family, index) =>
          post(
            family,
            `exchanges/${cohort[index].cardId}/replies`,
            { text: "Synthetic denied reply" },
            "foreign-reply",
            404,
          ),
        );
      });
    }
  }
  evidence.totals = await control("stats");
  evidence.passed = true;
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : "unknown";
  console.error(JSON.stringify({ failure: evidence.failure }));
  process.exitCode = 1;
} finally {
  if (seeded) {
    try {
      await control("stop");
      evidence.schedulerStopped = true;
    } catch {
      evidence.schedulerStopped = false;
    }
  }
  evidence.finishedAt = new Date().toISOString();
  evidence.status = evidence.passed ? "passed" : "failed";
  await writeFile(receipt, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ passed: evidence.passed, receipt }));
}
