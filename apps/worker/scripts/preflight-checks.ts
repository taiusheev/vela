/**
 * What `preflight.ts` decides, without the network: every check takes what was read from the
 * wrangler files and from Cloudflare (secret names only, never values) and says PASS or what is
 * missing. The configuration checks run the Workers' own readers (`src/config.ts`), so the
 * preflight refuses exactly what a deployed Worker would refuse, with stand-in values of the right
 * shape for the secrets that exist and nothing for the ones that do not.
 */
import {
  ConfigError,
  checkAdminConfig,
  type Environment,
  readAiProvider,
  readApiConfig,
  readApiSwitch,
  readClerkWebhookSigningSecret,
  readConfig,
  readMediaStorage,
} from "../src/config.ts";
import type { AdminEnv, PilotEnv } from "../src/env.ts";
import { PRIVACY_NOTICES } from "../src/notices.generated.ts";

export type DeployedEnvironment = Extract<Environment, "staging" | "production">;

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  /** What is missing or wrong, naming variables and resources, never a secret's value. */
  readonly detail: string;
}

/** One Worker's environment block as wrangler reads it, comments stripped. */
export interface WorkerBlock {
  readonly name: string;
  readonly vars: Readonly<Record<string, string>>;
  readonly r2Buckets: readonly { binding: string; bucket_name: string }[];
  readonly hyperdriveIds: readonly string[];
  readonly queues: readonly string[];
  readonly crons: readonly string[];
  /** Every binding name the block declares: queues, Durable Objects, rate limits, R2, Hyperdrive. */
  readonly bindings: readonly string[];
}

const PLACEHOLDER = "PLACEHOLDER_";

/**
 * Stand-ins of the right shape for each secret a Worker reads, used only for a secret Cloudflare
 * says the Worker has, so a reader that checks a value's shape passes and one that finds a secret
 * missing names it. A Clerk key takes the instance its environment requires.
 */
export function standInSecrets(environment: DeployedEnvironment): Readonly<Record<string, string>> {
  return {
    CONTENT_KEY_V1: "A".repeat(43),
    TELEGRAM_BOT_TOKEN: "123456789:preflight-stand-in-token",
    TELEGRAM_WEBHOOK_SECRET: "P".repeat(48),
    ADMIN_CONVERSATION_ID: "123456789",
    ANTHROPIC_API_KEY: "sk-ant-preflight",
    OPENAI_API_KEY: "sk-preflight",
    DEEPGRAM_API_KEY: "preflight",
    CLERK_SECRET_KEY: environment === "production" ? "sk_live_preflight" : "sk_test_preflight",
    CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${btoa("p".repeat(24))}`,
    LINE_CHANNEL_SECRET: "0".repeat(32),
    LINE_CHANNEL_ACCESS_TOKEN: "preflight-line-access-token",
    MEDIA_URL_SECRET: "M".repeat(43),
    EXPO_ACCESS_TOKEN: "preflight_expo_access_token_00000000000000",
    PILOT_TELEGRAM_ALLOWLIST: "123456789",
  };
}

/** The bindings a block declares, as objects the readers can see; their methods are never called. */
function bindingsOf(block: WorkerBlock): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (const name of block.bindings) bindings[name] = {};
  if (block.bindings.includes("HYPERDRIVE")) {
    bindings.HYPERDRIVE = { connectionString: "postgres://preflight@localhost/preflight" };
  }
  return bindings;
}

function envOf(
  environment: DeployedEnvironment,
  block: WorkerBlock,
  secretNames: ReadonlySet<string>,
): Record<string, unknown> {
  const standIns = standInSecrets(environment);
  const secrets: Record<string, string> = {};
  for (const name of secretNames) {
    const value = standIns[name];
    if (value !== undefined) secrets[name] = value;
  }
  return { ...block.vars, ...bindingsOf(block), ...secrets };
}

function attempt(name: string, run: () => unknown): CheckResult {
  try {
    run();
    return { name, ok: true, detail: "passes" };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { name, ok: false, detail: `${error.code}: ${error.message}` };
    }
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** No variable in either Worker's block still holds a setup placeholder. */
export function placeholderChecks(pilot: WorkerBlock, admin: WorkerBlock): CheckResult[] {
  return [pilot, admin].map((block) => {
    const left = [
      ...Object.entries(block.vars)
        .filter(([, value]) => value.includes(PLACEHOLDER))
        .map(([key]) => key),
      ...block.hyperdriveIds.filter((id) => id.includes(PLACEHOLDER)).map(() => "hyperdrive.id"),
    ];
    return {
      name: `${block.name}: no setup placeholders`,
      ok: left.length === 0,
      detail: left.length === 0 ? "passes" : `still a placeholder: ${left.join(", ")}`,
    };
  });
}

/**
 * The Workers' own configuration readers, each on its own so one run names every refusal: the
 * pilot's `readConfig` (variables, notices, LINE, push, the founder's chat), its AI provider and
 * key, its media storage and bucket, the API under /v1 and the Clerk webhook key where the API is
 * on, and the admin Worker's `checkAdminConfig`.
 */
export function configChecks(
  environment: DeployedEnvironment,
  pilot: WorkerBlock,
  admin: WorkerBlock,
  pilotSecrets: ReadonlySet<string>,
  adminSecrets: ReadonlySet<string>,
): CheckResult[] {
  const pilotEnv = envOf(environment, pilot, pilotSecrets) as unknown as PilotEnv;
  const adminEnv = envOf(environment, admin, adminSecrets) as unknown as AdminEnv;
  const results = [
    attempt(`${pilot.name}: configuration`, () => readConfig(pilotEnv, PRIVACY_NOTICES)),
    attempt(`${admin.name}: configuration`, () => checkAdminConfig(adminEnv)),
  ];
  for (const [block, secrets] of [
    [pilot, pilotSecrets],
    [admin, adminSecrets],
  ] as const) {
    results.push(
      attempt(`${block.name}: AI provider key`, () => {
        const provider = readAiProvider(block.vars, environment, "wrangler config");
        const key =
          provider === "openai"
            ? "OPENAI_API_KEY"
            : provider === "anthropic"
              ? "ANTHROPIC_API_KEY"
              : null;
        if (key !== null && !secrets.has(key)) {
          throw new ConfigError(
            key,
            `AI_PROVIDER is ${provider} but ${key} is not a secret of this Worker`,
          );
        }
      }),
    );
  }
  results.push(
    attempt(`${pilot.name}: media storage`, () => {
      const storage = readMediaStorage(pilot.vars, environment, "wrangler.jsonc");
      if (
        storage === "r2" &&
        !pilot.r2Buckets.some((bucket) => bucket.binding === "MEDIA_BUCKET")
      ) {
        throw new ConfigError("MEDIA_BUCKET", "MEDIA_STORAGE is r2 but no MEDIA_BUCKET is bound");
      }
    }),
  );
  if (readApiSwitch(pilot.vars) === "on") {
    results.push(
      attempt(`${pilot.name}: API under /v1`, () => readApiConfig(pilotEnv)),
      attempt(`${pilot.name}: Clerk webhook key`, () => readClerkWebhookSigningSecret(pilotEnv)),
    );
  }
  return results;
}

/** The three nightly-and-quarter-hourly crons the scheduler and retention rely on. */
export function cronCheck(pilot: WorkerBlock): CheckResult {
  const ok = pilot.crons.length > 0;
  return {
    name: `${pilot.name}: cron triggers`,
    ok,
    detail: ok
      ? pilot.crons.join(", ")
      : "no cron triggers: arrivals and retention would never run",
  };
}

/** Prefixes whose objects expire 32 days on, as on staging (infra/README.md). */
export const EXPIRING_PREFIXES = ["asks/", "replies/", "device/"] as const;

export interface LifecycleRule {
  readonly prefix: string;
  readonly enabled: boolean;
  readonly maxAgeDays: number | null;
}

export function lifecycleCheck(
  bucket: string,
  rules: readonly LifecycleRule[] | null,
): CheckResult {
  const name = `R2 ${bucket}: media expires`;
  if (rules === null) return { name, ok: false, detail: "the bucket does not exist" };
  const missing = EXPIRING_PREFIXES.filter(
    (prefix) =>
      !rules.some(
        (rule) =>
          rule.enabled &&
          rule.prefix === prefix &&
          rule.maxAgeDays !== null &&
          rule.maxAgeDays <= 32,
      ),
  );
  return {
    name,
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? "asks/, replies/ and device/ expire within 32 days"
        : `no enabled rule deleting within 32 days for: ${missing.join(", ")}`,
  };
}

export function existsCheck(what: string, present: boolean): CheckResult {
  return { name: what, ok: present, detail: present ? "exists" : "not found in the account" };
}

export function formatReport(environment: string, results: readonly CheckResult[]): string {
  const failed = results.filter((result) => !result.ok);
  return [
    `Preflight for ${environment}`,
    ...results.map((result) => `${result.ok ? "PASS" : "FAIL"}  ${result.name}: ${result.detail}`),
    "",
    failed.length === 0
      ? `PASS: all ${results.length} checks passed.`
      : `FAIL: ${failed.length} of ${results.length} checks need fixing before a release.`,
  ].join("\n");
}
