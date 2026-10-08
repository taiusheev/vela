/**
 * Release preflight (technical plan step 1.1): `pnpm --filter @vela/worker preflight -- --env
 * production` says PASS, or lists what is missing, before a release. Read-only. It reads the two
 * wrangler files, and from Cloudflare only which Workers, secret names, queues, Hyperdrive config
 * and bucket lifecycle rules exist; it never reads or prints a secret's value. Production's
 * credentials stay in the `production` GitHub environment (`.github/workflows/preflight.yml`).
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for the account checks; without them only
 * the file checks run, and the report says so.
 */
import { readFileSync } from "node:fs";
import {
  type CheckResult,
  configChecks,
  cronCheck,
  type DeployedEnvironment,
  existsCheck,
  formatReport,
  type LifecycleRule,
  lifecycleCheck,
  placeholderChecks,
  type WorkerBlock,
} from "./preflight-checks.ts";
import { stripJsonComments } from "./setup-environment.ts";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function blockOf(file: string, environment: DeployedEnvironment): WorkerBlock {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const top = record(JSON.parse(stripJsonComments(text, file)));
  const block = record(record(top.env)[environment]);
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    name: String(block.name ?? top.name ?? file),
    vars: Object.fromEntries(
      Object.entries(record(block.vars)).map(([key, value]) => [key, String(value)]),
    ),
    r2Buckets: list(block.r2_buckets).map((bucket) => ({
      binding: String(record(bucket).binding),
      bucket_name: String(record(bucket).bucket_name),
    })),
    hyperdriveIds: list(block.hyperdrive).map((hd) => String(record(hd).id)),
    queues: list(record(block.queues).producers).map((q) => String(record(q).queue)),
    crons: list(record(block.triggers).crons).map(String),
    bindings: [
      ...list(record(block.queues).producers).map((q) => String(record(q).binding)),
      ...list(record(block.durable_objects).bindings).map((d) => String(record(d).name)),
      ...list(block.ratelimits).map((r) => String(record(r).name)),
      ...list(block.r2_buckets).map((b) => String(record(b).binding)),
      ...list(block.hyperdrive).map((h) => String(record(h).binding)),
    ],
  };
}

interface Cloudflare {
  get(path: string): Promise<{ status: number; result: unknown }>;
}

function cloudflare(token: string, accountId: string): Cloudflare {
  return {
    async get(path) {
      const response = await fetch(`${CLOUDFLARE_API}/accounts/${accountId}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = record(await response.json().catch(() => ({})));
      return { status: response.status, result: body.result };
    },
  };
}

async function secretNames(cf: Cloudflare, worker: string): Promise<Set<string> | null> {
  const { status, result } = await cf.get(`/workers/scripts/${encodeURIComponent(worker)}/secrets`);
  if (status === 404) return null;
  if (status !== 200 || !Array.isArray(result)) {
    throw new Error(`Cloudflare answered ${status} for ${worker}'s secret names`);
  }
  return new Set(result.map((entry) => String(record(entry).name)));
}

async function lifecycleRules(cf: Cloudflare, bucket: string): Promise<LifecycleRule[] | null> {
  const { status, result } = await cf.get(`/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`Cloudflare answered ${status} for ${bucket}'s lifecycle`);
  const rules = Array.isArray(record(result).rules) ? (record(result).rules as unknown[]) : [];
  return rules.map((raw) => {
    const rule = record(raw);
    const condition = record(record(rule.deleteObjectsTransition).condition);
    const maxAge = typeof condition.maxAge === "number" ? condition.maxAge : null;
    return {
      prefix: String(record(rule.conditions).prefix ?? ""),
      enabled: rule.enabled === true,
      maxAgeDays: condition.type === "Age" && maxAge !== null ? maxAge / 86_400 : null,
    };
  });
}

async function accountChecks(
  cf: Cloudflare,
  environment: DeployedEnvironment,
  pilot: WorkerBlock,
  admin: WorkerBlock,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const pilotSecrets = await secretNames(cf, pilot.name);
  const adminSecrets = await secretNames(cf, admin.name);
  results.push(existsCheck(`Worker ${pilot.name}`, pilotSecrets !== null));
  results.push(existsCheck(`Worker ${admin.name}`, adminSecrets !== null));
  results.push(
    ...configChecks(
      environment,
      pilot,
      admin,
      pilotSecrets ?? new Set(),
      adminSecrets ?? new Set(),
    ),
  );

  const queues = await cf.get("/queues?per_page=100");
  const queueNames = new Set(
    (Array.isArray(queues.result) ? queues.result : []).map((q) => String(record(q).queue_name)),
  );
  for (const queue of new Set([...pilot.queues, ...admin.queues])) {
    results.push(existsCheck(`Queue ${queue}`, queueNames.has(queue)));
  }
  for (const id of new Set([...pilot.hyperdriveIds, ...admin.hyperdriveIds])) {
    if (id.includes("PLACEHOLDER_")) continue;
    const config = await cf.get(`/hyperdrive/configs/${encodeURIComponent(id)}`);
    results.push(existsCheck(`Hyperdrive config ${id}`, config.status === 200));
  }
  for (const bucket of pilot.r2Buckets) {
    results.push(lifecycleCheck(bucket.bucket_name, await lifecycleRules(cf, bucket.bucket_name)));
  }
  return results;
}

async function main(argv: readonly string[]): Promise<number> {
  const at = argv.indexOf("--env");
  const environment = argv[at + 1];
  if (at === -1 || (environment !== "staging" && environment !== "production")) {
    console.error("Usage: pnpm --filter @vela/worker preflight -- --env staging|production");
    return 2;
  }
  const pilot = blockOf("wrangler.jsonc", environment);
  const admin = blockOf("wrangler.admin.jsonc", environment);
  const results: CheckResult[] = [...placeholderChecks(pilot, admin), cronCheck(pilot)];

  const token = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  if (token === "" || accountId === "") {
    results.push({
      name: "Cloudflare account",
      ok: false,
      detail:
        "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set, so Workers, secrets, queues, Hyperdrive and buckets were not checked",
    });
  } else {
    results.push(...(await accountChecks(cloudflare(token, accountId), environment, pilot, admin)));
  }
  console.log(formatReport(environment, results));
  return results.every((result) => result.ok) ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
