import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { unstable_readConfig } from "wrangler";

const WRANGLER_CONFIG = fileURLToPath(new URL("./wrangler.jsonc", import.meta.url));

/** The environments `.github/workflows/deploy.yml` deploys. */
const DEPLOYED_ENVIRONMENTS = ["staging", "production"] as const;

/** What one deployed environment serves HTTP on, as `wrangler deploy --env <environment>` reads it. */
interface DeployedHttp {
  readonly environment: string;
  readonly publicBaseUrl: unknown;
  readonly routes: unknown;
}

declare module "vitest" {
  export interface ProvidedContext {
    deployedHttp: readonly DeployedHttp[];
  }
}

/**
 * Read here, with wrangler's own reader and its environment inheritance, because the tests run
 * inside workerd, which cannot read the file. wrangler's config type lives in a package it bundles
 * without its types, so the fields arrive as unknown and the test checks their shape.
 */
function deployedHttp(environment: string): DeployedHttp {
  const config: { readonly vars?: Readonly<Record<string, unknown>>; readonly routes?: unknown } =
    unstable_readConfig({ config: WRANGLER_CONFIG, env: environment }, { hideWarnings: true });
  return { environment, publicBaseUrl: config.vars?.PUBLIC_BASE_URL, routes: config.routes };
}

/**
 * The Worker's tests run inside workerd, against the bindings in wrangler.jsonc, so the Durable
 * Object, the queues, and the R2 bucket behave as they will in production. The secrets below are
 * fakes and `.dev.vars` is not read: every test injects fake services through `WorkerRuntime`, so
 * none of them reaches a database, Telegram, Anthropic, or the network.
 */
export default defineConfig({
  resolve: {
    // node-postgres reaches `pg-protocol` with a CommonJS `require`, which this runtime resolves
    // to that package's ESM wrapper and then cannot evaluate. Naming its CommonJS build here
    // affects the test runtime only; wrangler's bundler resolves the package by itself.
    alias: { "pg-protocol": "pg-protocol/dist/index.js" },
  },
  test: {
    include: ["src/**/*.test.ts"],
    provide: { deployedHttp: DEPLOYED_ENVIRONMENTS.map(deployedHttp) },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: WRANGLER_CONFIG },
      miniflare: {
        bindings: {
          TELEGRAM_BOT_TOKEN: "12345:test-token",
          TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
          ANTHROPIC_API_KEY: "test-anthropic-key",
          DEEPGRAM_API_KEY: "test-deepgram-key",
          HEALTHCHECKS_PING_URL: "https://hc.example/ping",
          ACCESS_TEAM_DOMAIN: "vela-test.cloudflareaccess.com",
          ACCESS_AUD: "test-audience",
        },
      },
    }),
  ],
});
