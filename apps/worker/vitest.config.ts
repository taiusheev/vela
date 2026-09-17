import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { unstable_readConfig } from "wrangler";
import { NOTICE_DIRECTORY, NOTICE_FILES, type NoticeLang } from "./src/notices.ts";

/** The pilot Worker's configuration, which the tests' runtime is built from. */
const PILOT_CONFIG = fileURLToPath(new URL("./wrangler.jsonc", import.meta.url));
/** The admin Worker's configuration, read here only for its own tests. */
const ADMIN_CONFIG = fileURLToPath(new URL("./wrangler.admin.jsonc", import.meta.url));

const WORKERS = { pilot: PILOT_CONFIG, admin: ADMIN_CONFIG } as const;

/** Development is each file's top level; the others are what deploy.yml deploys. */
const ENVIRONMENTS = ["development", "staging", "production"] as const;

/**
 * One Worker in one environment, as `wrangler deploy [-c <file>] --env <environment>` reads it: the
 * fields its tests hold, nothing else.
 */
interface WorkerConfig {
  readonly worker: keyof typeof WORKERS;
  readonly environment: (typeof ENVIRONMENTS)[number];
  readonly name: unknown;
  readonly main: unknown;
  readonly workersDev: unknown;
  readonly previewUrls: unknown;
  readonly routes: unknown;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly durableObjects: unknown;
  readonly migrations: unknown;
  readonly queues: unknown;
  readonly hyperdrive: unknown;
  readonly r2Buckets: unknown;
  readonly crons: unknown;
}

declare module "vitest" {
  export interface ProvidedContext {
    workerConfigs: readonly WorkerConfig[];
    noticeSources: Readonly<Record<NoticeLang, string>>;
    pilotMaterials: Readonly<Record<string, string>>;
  }
}

/**
 * Read here, with wrangler's own reader and its environment inheritance, because the tests run
 * inside workerd, which cannot read the files. wrangler's config type lives in a package it bundles
 * without its types, so the fields arrive as unknown and the tests check their shape.
 */
function workerConfig(
  worker: keyof typeof WORKERS,
  environment: (typeof ENVIRONMENTS)[number],
): WorkerConfig {
  const config: {
    readonly name?: unknown;
    readonly main?: unknown;
    readonly workers_dev?: unknown;
    readonly preview_urls?: unknown;
    readonly routes?: unknown;
    readonly vars?: Readonly<Record<string, unknown>>;
    readonly durable_objects?: unknown;
    readonly migrations?: unknown;
    readonly queues?: unknown;
    readonly hyperdrive?: unknown;
    readonly r2_buckets?: unknown;
    readonly triggers?: { readonly crons?: unknown };
  } = unstable_readConfig(
    {
      config: WORKERS[worker],
      env: environment === "development" ? undefined : environment,
    },
    { hideWarnings: true },
  );
  return {
    worker,
    environment,
    name: config.name,
    main: typeof config.main === "string" ? config.main.replace(/\\/g, "/") : config.main,
    workersDev: config.workers_dev,
    previewUrls: config.preview_urls,
    routes: config.routes,
    vars: config.vars ?? {},
    durableObjects: config.durable_objects,
    migrations: config.migrations,
    queues: config.queues,
    hyperdrive: config.hyperdrive,
    r2Buckets: config.r2_buckets,
    crons: config.triggers?.crons,
  };
}

/** The pilot pack, from the repository root. */
const MATERIALS = new URL(`../../${NOTICE_DIRECTORY}/`, import.meta.url);

/** The notices as the founder wrote them, for the test that holds the generated module to them. */
function noticeSource(lang: NoticeLang): string {
  return readFileSync(new URL(NOTICE_FILES[lang], MATERIALS), "utf8");
}

/**
 * Every Markdown file of the pilot pack by file name, for the test that holds the notice links
 * written into them (the ones families are sent) to the pilot Worker's notice URLs.
 */
function pilotMaterials(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(MATERIALS)
      .filter((name) => name.endsWith(".md"))
      .map((name) => [name, readFileSync(new URL(name, MATERIALS), "utf8")]),
  );
}

/**
 * The Worker's tests run inside workerd, against the bindings in wrangler.jsonc, so the Durable
 * Object, the queues, and the R2 bucket behave as they will in production. The secrets below are
 * fakes and `.dev.vars` is not read: every test injects fake services through its runtime, so
 * none of them reaches a database, Telegram, Anthropic, or the network. The admin Worker's tests
 * build its environment from these same bindings (`src/testing/fakes.ts`).
 */
export default defineConfig({
  resolve: {
    // node-postgres reaches `pg-protocol` with a CommonJS `require`, which this runtime resolves
    // to that package's ESM wrapper and then cannot evaluate. Naming its CommonJS build here
    // affects the test runtime only; wrangler's bundler resolves the package by itself.
    alias: { "pg-protocol": "pg-protocol/dist/index.js" },
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // The Durable Object tests call their objects across isolates, and on a busy laptop, with the
    // runtime still importing the other test files, one such call has taken more than Vitest's
    // default 5 seconds, failing tests that pass in milliseconds alone. A real hang still fails.
    testTimeout: 20_000,
    provide: {
      workerConfigs: (["pilot", "admin"] as const).flatMap((worker) =>
        ENVIRONMENTS.map((environment) => workerConfig(worker, environment)),
      ),
      noticeSources: { en: noticeSource("en"), "zh-TW": noticeSource("zh-TW") },
      pilotMaterials: pilotMaterials(),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: PILOT_CONFIG },
      miniflare: {
        bindings: {
          TELEGRAM_BOT_TOKEN: "12345:test-token",
          TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
          ANTHROPIC_API_KEY: "test-anthropic-key",
          DEEPGRAM_API_KEY: "test-deepgram-key",
        },
      },
    }),
  ],
});
