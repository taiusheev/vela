/**
 * What both Workers check before they run anything: the environment, the secrets, and the vars a
 * deployed environment cannot run with. The pilot Worker reads services' `Config` here; the admin
 * Worker only needs its environment and its own origin checked.
 *
 * Every refusal is a `ConfigError` naming the variable (or the notice file) to fix, never its value.
 */
import { type Lang, REGIONS, type Region } from "@vela/contracts";
import type { Config } from "@vela/services";
import type { AdminEnv, PilotEnv } from "./env.ts";
import {
  NOTICE_FILES,
  NOTICE_LANGS,
  type PrivacyNotices,
  unfilledPlaceholders,
} from "./notices.ts";

const ENVIRONMENTS = ["development", "staging", "production"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * A configuration a Worker cannot run with. The variable to fix is the error's `code`, because
 * failures are logged through `errorLabel`, which keeps a code and never a message: the log line
 * then reads `ConfigError:PUBLIC_BASE_URL` rather than a bare `Error`.
 */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
  readonly code: string;

  constructor(variable: string, message: string) {
    super(message);
    this.code = variable;
  }
}

/** The secrets in `.dev.vars.example`; each is read through `secret()`, which names a missing one. */
type SecretName =
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_WEBHOOK_SECRET"
  | "ANTHROPIC_API_KEY"
  | "DEEPGRAM_API_KEY"
  | "ADMIN_CONVERSATION_ID"
  | "ACCESS_TEAM_DOMAIN"
  | "ACCESS_AUD";

/**
 * A secret, or a clear failure naming it. Deployment is the only place it can be fixed, so the
 * message says where to put it rather than leaving a stack trace about an empty string.
 */
export function secret<N extends SecretName>(env: { readonly [K in N]?: string }, name: N): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(
      name,
      `${name} is not set: add it to .dev.vars locally, or as a secret of this Worker with "wrangler secret put ${name} --env <environment>" (add -c wrangler.admin.jsonc for the admin Worker)`,
    );
  }
  return value;
}

export function requireVar(
  env: { readonly [K in "PUBLIC_BASE_URL" | "TELEGRAM_BOT_USERNAME"]?: string },
  name: "PUBLIC_BASE_URL" | "TELEGRAM_BOT_USERNAME",
  configFile = "wrangler.jsonc",
): string {
  const value = env[name]?.trim() ?? "";
  if (value === "") {
    throw new ConfigError(
      name,
      `${name} is not set: add it to the environment's vars in ${configFile}`,
    );
  }
  return value;
}

export function readEnvironment(env: { readonly ENVIRONMENT: string }): Environment {
  const found = ENVIRONMENTS.find((candidate) => candidate === env.ENVIRONMENT);
  if (found === undefined) {
    throw new ConfigError("ENVIRONMENT", `ENVIRONMENT must be one of ${ENVIRONMENTS.join(", ")}`);
  }
  return found;
}

/** Where a Worker's AI calls go (decision X, 2026-09-18): Anthropic, or nowhere while AI is off. */
export const AI_PROVIDERS = ["anthropic", "off"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * The var `AI_PROVIDER`. With "off" no AI provider is called and every AI step takes its safe
 * default, which staging and development may run with. Production refuses it: there real families
 * answer, and with AI off nothing they say is checked for a flag.
 */
export function readAiProvider(
  env: { readonly AI_PROVIDER?: string },
  environment: Environment,
  configFile: string,
): AiProvider {
  const value = env.AI_PROVIDER?.trim() ?? "";
  const provider = AI_PROVIDERS.find((candidate) => candidate === value);
  if (provider === undefined) {
    throw new ConfigError(
      "AI_PROVIDER",
      `AI_PROVIDER must be one of ${AI_PROVIDERS.join(", ")}: set it in the environment's vars in ${configFile}`,
    );
  }
  if (provider === "off" && environment === "production") {
    throw new ConfigError(
      "AI_PROVIDER",
      `AI_PROVIDER is off in production, where families' answers need the flag check: set it to anthropic in ${configFile}`,
    );
  }
  return provider;
}

/** How a wrangler config writes a value nobody has chosen yet: whole, or as a URL's host. */
const PLACEHOLDER = "PLACEHOLDER_";

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Refuses to run a deployed environment on a value nobody chose. Filled with a guess, a
 * placeholder can send families' privacy notice links, or the founder's admin links, to a host
 * Vela does not own; a link that is not https opens the admin page or the notice in the clear.
 * Every string the platform hands over is checked, vars and secrets alike, so a var added later
 * is covered without being listed here; the error names the variable and never its value.
 * Development runs on localhost with the placeholders the wrangler configs ship, so it is not
 * checked.
 */
function checkDeployedEnv(
  env: object,
  environment: Environment,
  urlVars: readonly string[],
  configFile: string,
): void {
  if (environment === "development") {
    return;
  }
  const entries: [string, unknown][] = Object.entries(env);
  for (const [name, value] of entries) {
    if (typeof value === "string" && value.includes(PLACEHOLDER)) {
      throw new ConfigError(
        name,
        `${name} still holds a placeholder: set the value chosen for ${environment} in ${configFile}, or as a secret of this Worker for a secret`,
      );
    }
  }
  const values = new Map(entries);
  for (const name of urlVars) {
    if (!isHttpsUrl(values.get(name))) {
      throw new ConfigError(
        name,
        `${name} must be an https URL in ${environment}: set it in the environment's vars in ${configFile}`,
      );
    }
  }
}

/**
 * Refuses a notice that still holds a blank, such as `[FOUNDER FULL NAME]`, outside development:
 * no family may ever read an unfilled notice, and the pilot Worker links and serves them. The
 * error's code is the notice's file name, which is what the founder fills in.
 */
export function refuseUnfilledNotices(environment: Environment, notices: PrivacyNotices): void {
  if (environment === "development") {
    return;
  }
  for (const lang of NOTICE_LANGS) {
    const file = NOTICE_FILES[lang];
    if (unfilledPlaceholders(notices[lang].html).length > 0) {
      throw new ConfigError(
        file,
        `${file} still holds a bracketed placeholder: fill it in, run "pnpm --filter @vela/worker notices", and deploy again`,
      );
    }
  }
}

function readRegions(env: PilotEnv): readonly Region[] {
  const names = env.REGIONS.split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const regions = names.map((name) => {
    const region = REGIONS.find((candidate) => candidate === name);
    if (region === undefined) {
      throw new ConfigError(
        "REGIONS",
        `REGIONS lists "${name}", which is not one of ${REGIONS.join(", ")}`,
      );
    }
    return region;
  });
  if (regions.length === 0) {
    throw new ConfigError(
      "REGIONS",
      "REGIONS is empty: list the regions whose database exists, such as apac",
    );
  }
  return regions;
}

/**
 * The founder's personal chat with the bot (H5), a secret. A laptop may leave it out and sends no
 * admin messages; a deployed pilot Worker refuses to run without it, because the founder would
 * then never hear of a flag, a weekly read to check, or an answer nobody could read.
 */
function readAdminConversationId(env: PilotEnv, environment: Environment): string | null {
  if (environment !== "development") {
    return secret(env, "ADMIN_CONVERSATION_ID").trim();
  }
  const value = env.ADMIN_CONVERSATION_ID?.trim() ?? "";
  return value === "" ? null : value;
}

/** The vars that become links: the admin origin in admin messages, and the privacy notices. */
const PILOT_URL_VARS = ["PUBLIC_BASE_URL", "PRIVACY_NOTICE_URL_EN", "PRIVACY_NOTICE_URL_ZH_TW"];

/**
 * The pilot Worker's vars and secrets as services' `Config` (code design §8), or a `ConfigError`
 * naming the first variable, or notice, a deployed environment cannot start with.
 */
export function readConfig(env: PilotEnv, notices: PrivacyNotices): Config {
  const environment = readEnvironment(env);
  checkDeployedEnv(env, environment, PILOT_URL_VARS, "wrangler.jsonc");
  refuseUnfilledNotices(environment, notices);
  const english = env.PRIVACY_NOTICE_URL_EN;
  // A language without its own notice takes the English one, so the link is never empty.
  const privacyNoticeUrls: Record<Lang, string> = {
    en: english,
    "zh-TW": env.PRIVACY_NOTICE_URL_ZH_TW,
    ja: english,
    de: english,
    hi: english,
    ru: english,
  };
  return {
    telegramBotUsername: requireVar(env, "TELEGRAM_BOT_USERNAME"),
    adminConversationId: readAdminConversationId(env, environment),
    environment,
    regions: readRegions(env),
    publicBaseUrl: requireVar(env, "PUBLIC_BASE_URL"),
    privacyNoticeUrls,
    // The generator refuses notices whose versions differ, so the English one names both.
    privacyNoticeVersion: notices.en.version,
  };
}

/**
 * The admin Worker's environment, checked as the pilot's is: no placeholder anywhere, its own
 * origin, the one a form may be posted from, is https outside development, and the bot the link a
 * new invite carries opens is named, in every environment. Returns the environment it checked.
 */
export function checkAdminConfig(env: AdminEnv): Environment {
  const environment = readEnvironment(env);
  checkDeployedEnv(env, environment, ["PUBLIC_BASE_URL"], "wrangler.admin.jsonc");
  requireVar(env, "TELEGRAM_BOT_USERNAME", "wrangler.admin.jsonc");
  return environment;
}
