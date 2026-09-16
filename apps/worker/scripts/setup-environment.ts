/**
 * Sets up one deployed environment, staging or production, from the founder's own terminal, so
 * that every key goes from the founder's clipboard straight into Cloudflare or Telegram (`run` is
 * needed: `pnpm --filter … setup` would start pnpm's own `setup` command):
 *
 *   pnpm --filter @vela/worker run setup -- --env <staging|production> [--from <step>]
 *
 * Every secret is typed or pasted at a prompt that does not echo, confirmed only by its length,
 * and then sent to Cloudflare or Telegram over HTTPS, or to a child process on its standard input
 * or in its environment. An identifier the founder pastes is read without echo too, and shown only
 * once it passes its check: pasted before it was copied, it would be the key the clipboard still
 * holds. A secret is never printed (every printed line is also redacted against every
 * secret the run has seen), never put in a command-line argument, and never written to disk, with
 * one exception: for staging, the "Vela staging" API token and account id go to apps/worker/.env,
 * which git ignores (checked with `git check-ignore` before writing), so wrangler on this laptop
 * reaches the staging account afterwards (infra/README.md, section 1). Production saves nothing.
 *
 * The steps run in the order of infra/README.md section 11. Each skips what already exists, so a
 * run can be repeated, and `--from <step>` resumes after a failure. Everything that reaches the
 * outside world (the terminal, HTTP, child processes, the three files it may write) comes through
 * `SetupIo`, so the tests run a whole setup against fakes; `nodeIo`, at the end, is the real one.
 */
import { getMe, setMyCommands, setWebhook } from "@vela/adapters";
import { errorLabel } from "@vela/services";
import { SetupError, setUpTelegram, type TelegramSetupApi } from "./telegram-webhook.ts";

export const ENVIRONMENTS = ["staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const STEPS = [
  "account",
  "resources",
  "database",
  "telegram",
  "secrets",
  "deploy",
  "access",
  "webhook",
  "check",
] as const;
export type Step = (typeof STEPS)[number];

const STEP_DESCRIPTIONS: Readonly<Record<Step, string>> = {
  account: "check the Cloudflare API token and account id (staging saves them to apps/worker/.env)",
  resources: "create the queues, the dead-letter queue and the R2 media bucket",
  database: "apply the migrations to Neon, create the Hyperdrive configuration, write its id",
  telegram:
    "check the bot token, write the bot's username, read your chat id, generate the webhook secret",
  secrets: "put each secret on the Worker that reads it",
  deploy: "deploy the pilot Worker, then the admin Worker",
  access: "turn on Cloudflare Access for the admin Worker and put its two secrets",
  webhook: "register the Telegram webhook and command menu",
  check: "check /healthz, the privacy notice pages, and that /admin is closed without Access",
};

/** The files this script reads and the only ones it writes, relative to apps/worker. */
export type WorkerFile = "wrangler.jsonc" | "wrangler.admin.jsonc" | ".env";
const PILOT_FILE = "wrangler.jsonc";
const ADMIN_FILE = "wrangler.admin.jsonc";
const DOT_ENV = ".env";

/** A program the script starts: wrangler and the migrations run under this Node, git from PATH. */
export interface Command {
  readonly tool: "wrangler" | "migrate" | "git";
  readonly args: readonly string[];
  /** Added to the child's environment. Secrets travel here or on stdin, never in `args`. */
  readonly env: Readonly<Record<string, string>>;
  readonly stdin: string;
}

/** Every side effect of a setup, so the tests can run one against fakes. */
export interface SetupIo {
  /** False when standard input is not a terminal, which cannot hide what is typed. */
  readonly interactive: boolean;
  readonly print: (line: string) => void;
  /**
   * A line shown as it is typed: only Enter, yes or no, and an environment's name. Never a value
   * the founder pastes, since a paste may bring a key the clipboard still holds.
   */
  readonly ask: (question: string) => Promise<string>;
  /** A line typed or pasted and never shown: every key, and every identifier the founder pastes. */
  readonly askHidden: (question: string) => Promise<string>;
  readonly fetch: typeof fetch;
  /** Runs a command, handing over each line it prints, and resolves with its exit code. */
  readonly run: (command: Command, onLine: (line: string) => void) => Promise<number>;
  /** A file's text, or null when it does not exist. */
  readonly readFile: (file: WorkerFile) => Promise<string | null>;
  readonly writeFile: (file: WorkerFile, text: string) => Promise<void>;
  readonly randomBytes: (length: number) => Uint8Array;
}

/** What differs between the two accounts, named as infra/README.md names it. */
interface EnvironmentFacts {
  readonly accountName: string;
  readonly neonBranch: string;
  readonly hyperdriveName: string;
  readonly botName: string;
  readonly anthropicWorkspace: string;
  readonly deepgramKey: string;
  readonly healthcheck: string;
}

const FACTS: Readonly<Record<Environment, EnvironmentFacts>> = {
  staging: {
    accountName: "Vela staging",
    neonBranch: "staging",
    hyperdriveName: "vela-apac-staging",
    botName: "Vela Light staging",
    anthropicWorkspace: "vela-staging",
    deepgramKey: "vela-staging",
    healthcheck: "vela-staging-reconcile",
  },
  production: {
    accountName: "Vela",
    neonBranch: "main",
    hyperdriveName: "vela-apac",
    botName: "Vela Light",
    anthropicWorkspace: "vela-production",
    deepgramKey: "vela-production",
    healthcheck: "vela-production-reconcile",
  },
};

const PLACEHOLDER = "PLACEHOLDER_";

/** The exact placeholder tokens the wrangler files ship for an environment. */
export function placeholdersOf(environment: Environment): {
  readonly hyperdriveId: string;
  readonly botUsername: string;
} {
  const name = environment.toUpperCase();
  return {
    hyperdriveId: `${PLACEHOLDER}HYPERDRIVE_ID_${name}`,
    botUsername: `${PLACEHOLDER}${name}_BOT_USERNAME`,
  };
}

// ---------------------------------------------------------------------------------------------
// Arguments and the step plan

export type SetupCommand =
  | { readonly kind: "help" }
  | { readonly kind: "run"; readonly environment: Environment; readonly from: Step };

function isEnvironment(value: string): value is Environment {
  return ENVIRONMENTS.some((environment) => environment === value);
}

function isStep(value: string): value is Step {
  return STEPS.some((step) => step === value);
}

/**
 * `--env` and `--from`, and nothing else. A refused argument is named by its position, never
 * quoted: a secret pasted onto the command line by mistake must not be printed back as well.
 */
export function parseArguments(argv: readonly string[]): SetupCommand {
  let environment: Environment | null = null;
  let from: Step | null = null;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    // pnpm hands the `--` that separates its own arguments to the script as well.
    if (argument === "--") {
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--env" || argument === "--from") {
      const value = argv[index + 1];
      index += 1;
      if (argument === "--env") {
        if (environment !== null || value === undefined || !isEnvironment(value)) {
          throw new SetupError(`--env takes one of ${ENVIRONMENTS.join(" or ")}, once`);
        }
        environment = value;
      } else {
        if (from !== null || value === undefined || !isStep(value)) {
          throw new SetupError(`--from takes one step, once: ${STEPS.join(", ")}`);
        }
        from = value;
      }
      continue;
    }
    throw new SetupError(
      `Argument ${index + 1} is not one this script takes (not shown, in case it is a secret): run with --help`,
    );
  }
  if (help) {
    return { kind: "help" };
  }
  if (environment === null) {
    throw new SetupError(`Say which environment: --env ${ENVIRONMENTS.join(" or --env ")}`);
  }
  return { kind: "run", environment, from: from ?? "account" };
}

/** The steps a run performs: all of them, or from the one named by `--from`. */
export function stepsFrom(from: Step): readonly Step[] {
  return STEPS.slice(STEPS.indexOf(from));
}

export function usage(): readonly string[] {
  return [
    "Sets up one environment's Cloudflare resources, database, bot, secrets, Workers and webhook.",
    "",
    "  pnpm --filter @vela/worker run setup -- --env <staging|production> [--from <step>]",
    "",
    "Steps, in order (each skips what already exists; --from starts at one after a failure):",
    ...STEPS.map((step) => `  ${step.padEnd(10)}${STEP_DESCRIPTIONS[step]}`),
    "",
    "Run it in a terminal that can hide what you type (Windows Terminal or PowerShell). Every",
    "secret is read at a hidden prompt; infra/README.md, section 11, lists each prompt in order.",
  ];
}

// ---------------------------------------------------------------------------------------------
// The wrangler files

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON with comments as wrangler reads it: `//` and block comments go, strings stay whole. */
export function stripJsonComments(text: string, file: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (inString) {
      output += char;
      if (char === "\\") {
        output += next;
        index += 2;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      index += 1;
    } else if (char === '"') {
      inString = true;
      output += char;
      index += 1;
    } else if (char === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) {
        throw new SetupError(`${file} has a comment that is never closed`);
      }
      output += " ";
      index = end + 2;
    } else {
      output += char;
      index += 1;
    }
  }
  return output;
}

function field(value: unknown, key: string, where: string): unknown {
  if (!isRecord(value)) {
    throw new SetupError(`${where} is not an object`);
  }
  return value[key];
}

function textAt(value: unknown, key: string, where: string): string {
  const found = field(value, key, where);
  if (typeof found !== "string" || found === "") {
    throw new SetupError(`${where}.${key} is not a string`);
  }
  return found;
}

function listAt(value: unknown, key: string, where: string): readonly unknown[] {
  const found = field(value, key, where);
  if (found === undefined) {
    return [];
  }
  if (!Array.isArray(found)) {
    throw new SetupError(`${where}.${key} is not a list`);
  }
  return found;
}

function environmentBlock(text: string, file: string, environment: Environment): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(text, file));
  } catch (error) {
    if (error instanceof SetupError) {
      throw error;
    }
    throw new SetupError(`${file} is not JSON with comments that this script can read`);
  }
  const block = field(field(parsed, "env", file), environment, `${file} env`);
  if (!isRecord(block)) {
    throw new SetupError(`${file} has no env.${environment}`);
  }
  return block;
}

function onlyHyperdriveId(block: unknown, where: string): string {
  const bindings = listAt(block, "hyperdrive", where);
  const [binding] = bindings;
  if (bindings.length !== 1) {
    throw new SetupError(`${where} must bind exactly one Hyperdrive configuration`);
  }
  return textAt(binding, "id", `${where}.hyperdrive[0]`);
}

function queuesOf(block: unknown, where: string): string[] {
  const queues = field(block, "queues", where) ?? {};
  const names: string[] = [];
  for (const producer of listAt(queues, "producers", `${where}.queues`)) {
    names.push(textAt(producer, "queue", `${where}.queues.producers`));
  }
  for (const consumer of listAt(queues, "consumers", `${where}.queues`)) {
    names.push(textAt(consumer, "queue", `${where}.queues.consumers`));
    if (field(consumer, "dead_letter_queue", where) !== undefined) {
      names.push(textAt(consumer, "dead_letter_queue", `${where}.queues.consumers`));
    }
  }
  return names;
}

/** One environment of both Workers, as far as the setup needs it. */
export interface EnvironmentConfig {
  readonly pilotWorker: string;
  readonly adminWorker: string;
  /** Every queue either Worker binds, the dead-letter queue included, each once. */
  readonly queues: readonly string[];
  readonly buckets: readonly string[];
  readonly pilotHyperdriveId: string;
  readonly adminHyperdriveId: string;
  readonly botUsername: string;
  /** The pilot Worker's workers.dev origin, taken from its English notice URL. */
  readonly pilotOrigin: string;
  /** The admin Worker's origin, its `PUBLIC_BASE_URL`. */
  readonly adminOrigin: string;
  readonly noticeUrls: readonly string[];
  readonly workersDevSubdomain: string;
}

function originOf(url: string, where: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new SetupError(`${where} is not a URL`);
  }
}

/** The names and hosts both wrangler files give an environment, read from the files' text. */
export function readEnvironmentConfig(
  texts: { readonly pilot: string; readonly admin: string },
  environment: Environment,
): EnvironmentConfig {
  const pilotWhere = `${PILOT_FILE} env.${environment}`;
  const adminWhere = `${ADMIN_FILE} env.${environment}`;
  const pilot = environmentBlock(texts.pilot, PILOT_FILE, environment);
  const admin = environmentBlock(texts.admin, ADMIN_FILE, environment);
  const pilotVars = field(pilot, "vars", pilotWhere);
  const adminVars = field(admin, "vars", adminWhere);
  const pilotWorker = textAt(pilot, "name", pilotWhere);
  const adminWorker = textAt(admin, "name", adminWhere);
  const noticeUrls = [
    textAt(pilotVars, "PRIVACY_NOTICE_URL_EN", `${pilotWhere}.vars`),
    textAt(pilotVars, "PRIVACY_NOTICE_URL_ZH_TW", `${pilotWhere}.vars`),
  ];
  const pilotUrl = originOf(noticeUrls[0] ?? "", `${pilotWhere}.vars.PRIVACY_NOTICE_URL_EN`);
  const adminUrl = originOf(
    textAt(adminVars, "PUBLIC_BASE_URL", `${adminWhere}.vars`),
    `${adminWhere}.vars.PUBLIC_BASE_URL`,
  );
  const subdomain = pilotUrl.hostname.slice(pilotWorker.length + 1, -".workers.dev".length);
  if (
    pilotUrl.hostname !== `${pilotWorker}.${subdomain}.workers.dev` ||
    adminUrl.hostname !== `${adminWorker}.${subdomain}.workers.dev` ||
    subdomain === ""
  ) {
    throw new SetupError(
      `The hosts in ${PILOT_FILE} and ${ADMIN_FILE} for ${environment} are not both <Worker name>.<one subdomain>.workers.dev`,
    );
  }
  const buckets = listAt(pilot, "r2_buckets", pilotWhere).map((bucket) =>
    textAt(bucket, "bucket_name", `${pilotWhere}.r2_buckets`),
  );
  return {
    pilotWorker,
    adminWorker,
    queues: [...new Set([...queuesOf(pilot, pilotWhere), ...queuesOf(admin, adminWhere)])],
    buckets,
    pilotHyperdriveId: onlyHyperdriveId(pilot, pilotWhere),
    adminHyperdriveId: onlyHyperdriveId(admin, adminWhere),
    botUsername: textAt(pilotVars, "TELEGRAM_BOT_USERNAME", `${pilotWhere}.vars`),
    pilotOrigin: pilotUrl.origin,
    adminOrigin: adminUrl.origin,
    noticeUrls,
    workersDevSubdomain: subdomain,
  };
}

export interface PlaceholderFill {
  readonly file: string;
  readonly text: string;
  readonly environment: Environment;
  /** What the file holds for this environment now, as `readEnvironmentConfig` read it. */
  readonly current: string;
  readonly placeholder: string;
  readonly value: string;
  /** How the refusal names the value: "Hyperdrive id", "bot username". */
  readonly what: string;
}

/**
 * Writes a created value over that environment's placeholder, touching only the quoted token, so
 * every comment and every other line stays as it was. Refuses rather than overwrite a different
 * value the file already holds, and refuses a value another environment already uses, which is
 * what pasting the other environment's bot token or database would produce.
 */
export function fillPlaceholder(fill: PlaceholderFill): {
  readonly text: string;
  readonly changed: boolean;
} {
  if (fill.current === fill.value) {
    return { text: fill.text, changed: false };
  }
  if (fill.current !== fill.placeholder) {
    throw new SetupError(
      `${fill.file} already holds a different ${fill.what} for ${fill.environment}, not ${fill.placeholder}: find out which one is right before changing it by hand`,
    );
  }
  const quoted = `"${fill.placeholder}"`;
  if (fill.text.split(quoted).length !== 2) {
    throw new SetupError(`${fill.file} must hold ${quoted} exactly once`);
  }
  if (fill.text.includes(`"${fill.value}"`)) {
    throw new SetupError(
      `${fill.file} already uses this ${fill.what} for another environment: check that the value is ${fill.environment}'s`,
    );
  }
  return { text: fill.text.replace(quoted, `"${fill.value}"`), changed: true };
}

// ---------------------------------------------------------------------------------------------
// Secrets on screen

/** The only thing ever shown about a secret. */
export function received(value: string): string {
  return `received, ${[...value].length} characters`;
}

/** Replaces every secret the run has seen, as typed and as a URL would carry it. */
export function redact(text: string, secrets: Iterable<string>): string {
  const forms = [...secrets]
    .filter((secret) => secret !== "")
    .flatMap((secret) => [secret, encodeURIComponent(secret)])
    .sort((a, b) => b.length - a.length);
  let result = text;
  for (const form of forms) {
    result = result.replaceAll(form, "[hidden]");
  }
  return result;
}

/** A line being typed at a prompt, key by key: raw mode hands the script every key. */
export interface TypedLine {
  readonly value: string;
  readonly state: "typing" | "entered" | "cancelled";
}

export const EMPTY_LINE: TypedLine = { value: "", state: "typing" };

const ESCAPE = "";

/**
 * Applies what the terminal sent (keys, or a whole paste at once) to the line: Enter ends it,
 * Ctrl+C cancels, Backspace deletes, and escape sequences (arrows, bracketed paste markers) and
 * other control characters are dropped rather than becoming part of a key.
 */
export function typeInto(line: TypedLine, chunk: string): TypedLine {
  if (line.state !== "typing") {
    return line;
  }
  let value = line.value;
  const chars = [...chunk];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (char === "\r" || char === "\n") {
      return { value, state: "entered" };
    }
    if (char === "") {
      return { value: "", state: "cancelled" };
    }
    if (char === "" || char === "\b") {
      value = [...value].slice(0, -1).join("");
    } else if (char === ESCAPE) {
      // CSI sequences end at their first byte from @ to ~; other escapes are one more character.
      if (chars[index + 1] === "[") {
        index += 2;
        while (index < chars.length && !/[@-~]/.test(chars[index] ?? "~")) {
          index += 1;
        }
      } else {
        index += 1;
      }
    } else if (char >= " ") {
      value += char;
    }
  }
  return { value, state: "typing" };
}

const WEBHOOK_SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const WEBHOOK_SECRET_LENGTH = 48;

/**
 * Letters and digits only, inside Telegram's `secret_token` alphabet. A byte is used only below
 * 248, the largest multiple of 62 that fits, so every character is equally likely.
 */
export function generateWebhookSecret(randomBytes: (length: number) => Uint8Array): string {
  let secret = "";
  while (secret.length < WEBHOOK_SECRET_LENGTH) {
    for (const byte of randomBytes(WEBHOOK_SECRET_LENGTH)) {
      if (byte < 248 && secret.length < WEBHOOK_SECRET_LENGTH) {
        secret += WEBHOOK_SECRET_ALPHABET.charAt(byte % WEBHOOK_SECRET_ALPHABET.length);
      }
    }
  }
  return secret;
}

// ---------------------------------------------------------------------------------------------
// Values the founder pastes

export interface DatabaseOrigin {
  readonly scheme: "postgres" | "postgresql";
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/**
 * The parts Hyperdrive takes from a Neon connection string. Only the direct string is accepted:
 * Neon's pooled one (host ending `-pooler`) runs in transaction mode, which schema migrations may
 * not support, and Hyperdrive pools connections itself. A refusal never repeats the string.
 */
export function parseConnectionString(value: string): DatabaseOrigin {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SetupError("That is not a connection string: it starts with postgresql://");
  }
  const scheme = url.protocol.slice(0, -1);
  if (scheme !== "postgres" && scheme !== "postgresql") {
    throw new SetupError("That is not a Postgres connection string: it starts with postgresql://");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (url.hostname === "" || url.username === "" || url.password === "" || database === "") {
    throw new SetupError(
      "The connection string needs a role, its password, a host and the database name: copy the whole string from Connect",
    );
  }
  if (url.hostname.split(".")[0]?.endsWith("-pooler")) {
    throw new SetupError(
      "That is the pooled connection string (its host has -pooler): turn Connection pooling off in Connect and copy it again",
    );
  }
  return {
    scheme,
    host: url.hostname,
    port: url.port === "" ? 5432 : Number(url.port),
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/** The refusal a check throws, as the text a prompt shows before asking again, or null. */
function problemOf(check: () => unknown): string | null {
  try {
    check();
    return null;
  } catch (error) {
    if (error instanceof SetupError) {
      return error.message;
    }
    throw error;
  }
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const HYPERDRIVE_ID = /^[0-9a-f]{32}$/;
const BOT_TOKEN = /^\d+:[A-Za-z0-9_-]+$/;
const BOT_USERNAME = /^[A-Za-z0-9_]{5,32}$/;
const ACCESS_AUD = /^[0-9a-f]{64}$/;
const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const WHITESPACE = /\s/;

/** `<team name>.cloudflareaccess.com`, accepting the https:// and slash a copied link brings. */
export function normalizeTeamDomain(value: string): string {
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, "")
    .replace(/\/+$/, "");
  if (!TEAM_DOMAIN.test(domain)) {
    throw new SetupError(
      "The team domain is <team name>.cloudflareaccess.com (Zero Trust > Settings shows the team name)",
    );
  }
  return domain;
}

/** KEY=value lines, as wrangler's dotenv reads them. */
export function readDotEnv(text: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return values;
}

/** Sets the given keys in a .env text, keeping every other line as it was. */
export function mergeDotEnv(
  existing: string | null,
  values: Readonly<Record<string, string>>,
): string {
  const lines =
    existing === null || existing === ""
      ? [
          '# Written by `pnpm --filter @vela/worker run setup -- --env staging`: the "Vela staging" account\'s',
          "# API token and id, which wrangler reads from this folder. Git-ignored: never commit or share it.",
        ]
      : existing.replace(/\r?\n$/, "").split(/\r?\n/);
  const pending = new Map(Object.entries(values));
  const merged = lines.map((line) => {
    const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    const value = key === undefined ? undefined : pending.get(key);
    if (key === undefined || value === undefined) {
      return line;
    }
    pending.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of pending) {
    merged.push(`${key}=${value}`);
  }
  return `${merged.join("\n")}\n`;
}

/** A private chat that sent /start, as getUpdates returned it. */
export interface StartChat {
  readonly chatId: string;
  readonly firstName: string;
}

/** The private chats that sent /start, newest first and each once, and the last update's id. */
export function startChats(updates: unknown): {
  readonly chats: readonly StartChat[];
  readonly lastUpdateId: number | null;
} {
  const chats = new Map<string, StartChat>();
  let lastUpdateId: number | null = null;
  const list = Array.isArray(updates) ? updates : [];
  for (const update of [...list].reverse()) {
    if (!isRecord(update) || !Number.isSafeInteger(update.update_id)) {
      continue;
    }
    const updateId = Number(update.update_id);
    lastUpdateId = lastUpdateId === null ? updateId : Math.max(lastUpdateId, updateId);
    const message = update.message;
    const chat = isRecord(message) ? message.chat : undefined;
    if (
      !isRecord(message) ||
      !isRecord(chat) ||
      chat.type !== "private" ||
      !Number.isSafeInteger(chat.id) ||
      typeof message.text !== "string" ||
      !message.text.startsWith("/start")
    ) {
      continue;
    }
    const chatId = String(chat.id);
    if (!chats.has(chatId)) {
      const firstName = typeof chat.first_name === "string" ? chat.first_name : "(no first name)";
      chats.set(chatId, { chatId, firstName });
    }
  }
  return { chats: [...chats.values()], lastUpdateId };
}

// ---------------------------------------------------------------------------------------------
// Worker secrets

export const WORKER_SECRETS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "ADMIN_CONVERSATION_ID",
  "ANTHROPIC_API_KEY",
  "DEEPGRAM_API_KEY",
  "HEALTHCHECKS_PING_URL",
] as const;
export type WorkerSecret = (typeof WORKER_SECRETS)[number];
export type WorkerRole = "pilot" | "admin";

/** Which Worker reads each secret: src/env.ts and src/config.ts. */
const SECRET_HOMES: Readonly<Record<WorkerSecret, readonly WorkerRole[]>> = {
  TELEGRAM_BOT_TOKEN: ["pilot"],
  TELEGRAM_WEBHOOK_SECRET: ["pilot"],
  ADMIN_CONVERSATION_ID: ["pilot"],
  ANTHROPIC_API_KEY: ["pilot", "admin"],
  DEEPGRAM_API_KEY: ["pilot"],
  HEALTHCHECKS_PING_URL: ["pilot"],
};

/**
 * The three the telegram step produces. Nobody types them at the secrets step: the chat id needs
 * the /start exchange and the webhook secret is generated, so without that step there is no value.
 */
const TELEGRAM_STEP_SECRETS: readonly WorkerSecret[] = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "ADMIN_CONVERSATION_ID",
];

export interface SecretPlan {
  readonly name: WorkerSecret;
  readonly workers: readonly WorkerRole[];
  /**
   * `run`: this run holds the value; `prompt`: ask for it; `kept`: every Worker has it;
   * `missing`: a Worker lacks one of the telegram step's values and this run has none.
   */
  readonly source: "run" | "prompt" | "kept" | "missing";
}

/**
 * What the secrets step does with each secret. A value this run produced is always put, because
 * the webhook step registers that same webhook secret. Anything else a Worker already holds is
 * kept. A prompted key goes on every Worker that reads it, so both Workers of an environment hold
 * the same Anthropic key.
 */
export function planSecrets(
  existing: Readonly<Record<WorkerRole, ReadonlySet<string>>>,
  fromRun: ReadonlyMap<WorkerSecret, string>,
): readonly SecretPlan[] {
  return WORKER_SECRETS.map((name) => {
    const homes = SECRET_HOMES[name];
    if (fromRun.has(name)) {
      return { name, workers: homes, source: "run" };
    }
    const lacking = homes.filter((role) => !existing[role].has(name));
    if (lacking.length === 0) {
      return { name, workers: [], source: "kept" };
    }
    return TELEGRAM_STEP_SECRETS.includes(name)
      ? { name, workers: lacking, source: "missing" }
      : { name, workers: homes, source: "prompt" };
  });
}

// ---------------------------------------------------------------------------------------------
// Requests

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const TELEGRAM_API = "https://api.telegram.org";

export interface ApiRequest {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly body?: unknown;
}

export interface HttpRequest {
  readonly url: string;
  readonly init: RequestInit;
}

/** The token travels in the Authorization header, never in the URL. */
export function cloudflareRequest(token: string, request: ApiRequest): HttpRequest {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (request.body === undefined) {
    return { url: `${CLOUDFLARE_API}${request.path}`, init: { method: request.method, headers } };
  }
  headers["content-type"] = "application/json";
  return {
    url: `${CLOUDFLARE_API}${request.path}`,
    init: { method: request.method, headers, body: JSON.stringify(request.body) },
  };
}

/**
 * The Cloudflare API calls, each checked against developers.cloudflare.com/api (September 2026).
 * Every account id has been checked as 32 hex characters before it reaches a path.
 */
export const cloudflareApi = {
  verifyToken: (): ApiRequest => ({ method: "GET", path: "/user/tokens/verify" }),
  account: (accountId: string): ApiRequest => ({ method: "GET", path: `/accounts/${accountId}` }),
  subdomain: (accountId: string): ApiRequest => ({
    method: "GET",
    path: `/accounts/${accountId}/workers/subdomain`,
  }),
  queues: (accountId: string, page: number): ApiRequest => ({
    method: "GET",
    path: `/accounts/${accountId}/queues?page=${page}&per_page=100`,
  }),
  createQueue: (accountId: string, name: string): ApiRequest => ({
    method: "POST",
    path: `/accounts/${accountId}/queues`,
    body: { queue_name: name },
  }),
  bucket: (accountId: string, name: string): ApiRequest => ({
    method: "GET",
    path: `/accounts/${accountId}/r2/buckets/${encodeURIComponent(name)}`,
  }),
  /** Asia-Pacific, near the families and the database in Singapore (infra/README.md). */
  createBucket: (accountId: string, name: string): ApiRequest => ({
    method: "POST",
    path: `/accounts/${accountId}/r2/buckets`,
    body: { name, locationHint: "apac" },
  }),
  hyperdriveConfigs: (accountId: string, page: number): ApiRequest => ({
    method: "GET",
    path: `/accounts/${accountId}/hyperdrive/configs?page=${page}&per_page=100`,
  }),
  /** Caching off: Hyperdrive caches reads for 60 seconds by default; the scheduler needs fresh. */
  createHyperdrive: (accountId: string, name: string, origin: DatabaseOrigin): ApiRequest => ({
    method: "POST",
    path: `/accounts/${accountId}/hyperdrive/configs`,
    body: {
      name,
      origin: {
        scheme: origin.scheme,
        host: origin.host,
        port: origin.port,
        database: origin.database,
        user: origin.user,
        password: origin.password,
      },
      caching: { disabled: true },
    },
  }),
  disableCaching: (accountId: string, id: string): ApiRequest => ({
    method: "PATCH",
    path: `/accounts/${accountId}/hyperdrive/configs/${id}`,
    body: { caching: { disabled: true } },
  }),
  /** Names and types only: the API never returns a secret's value. */
  workerSecrets: (accountId: string, worker: string): ApiRequest => ({
    method: "GET",
    path: `/accounts/${accountId}/workers/scripts/${encodeURIComponent(worker)}/secrets`,
  }),
} as const;

/** A Bot API call. The token is part of the URL by Telegram's design, so no URL is ever printed. */
export function telegramRequest(token: string, method: string, params: object): HttpRequest {
  return {
    url: `${TELEGRAM_API}/bot${token}/${method}`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return undefined;
  }
}

function describeCloudflareErrors(body: unknown): string {
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  return errors
    .filter(isRecord)
    .map((error) => `${String(error.code)} ${String(error.message)}`)
    .join("; ");
}

// ---------------------------------------------------------------------------------------------
// The setup

interface Account {
  readonly token: string;
  readonly accountId: string;
  readonly name: string;
}

interface Bot {
  readonly token: string;
  readonly username: string;
}

interface SecretPrompt {
  readonly label: string;
  readonly where: readonly string[];
  readonly check: (value: string) => string | null;
}

function tokenTemplate(environment: Environment): readonly string[] {
  const { accountName } = FACTS[environment];
  return [
    `Create an API token for the "${accountName}" account, signed in to Cloudflare as its user:`,
    "My Profile > API Tokens > Create Token > Create Custom Token > Get started.",
    `  Token name: vela-setup-${environment}`,
    "  Permissions, each a row of Account, then the permission, then the level:",
    "    Account | Workers Scripts | Edit",
    "    Account | Workers R2 Storage | Edit",
    "    Account | Queues | Edit",
    "    Account | Hyperdrive | Edit",
    "    Account | Account Settings | Read",
    `  Account Resources: Include | ${accountName}`,
    environment === "production"
      ? "  TTL: end date tomorrow, and delete the token once this setup is done (CI has its own)."
      : "  Client IP Address Filtering and TTL: leave empty (this laptop keeps using the token).",
    "Continue to summary > Create Token, and copy the token (Cloudflare shows it once).",
  ];
}

/** The keys the founder pastes at the secrets step, and where each is created. */
function secretPrompts(environment: Environment): Partial<Record<WorkerSecret, SecretPrompt>> {
  const facts = FACTS[environment];
  const noSpaces = (value: string): string | null =>
    WHITESPACE.test(value) ? "A key has no spaces: copy it again" : null;
  return {
    ANTHROPIC_API_KEY: {
      label: "Anthropic API key",
      where: [
        `Anthropic Console (platform.claude.com), workspace ${facts.anthropicWorkspace}: create an API key named ${facts.anthropicWorkspace} in that workspace (infra/README.md, section 3). It goes on both Workers.`,
      ],
      check: (value) =>
        value.startsWith("sk-ant-") ? noSpaces(value) : "An Anthropic API key starts with sk-ant-",
    },
    DEEPGRAM_API_KEY: {
      label: "Deepgram API key",
      where: [
        `Deepgram console (console.deepgram.com), project vela, API Keys: create ${facts.deepgramKey} with the Member role and copy the key (section 4).`,
      ],
      check: noSpaces,
    },
    HEALTHCHECKS_PING_URL: {
      label: "Healthchecks ping URL",
      where: [
        `Healthchecks.io, project Vela: the check ${facts.healthcheck}, period 5 minutes, grace 5 minutes, so a silence of 10 minutes alerts (section 6). Copy its ping URL.`,
      ],
      check: (value) => {
        try {
          return new URL(value).protocol === "https:" ? null : "The ping URL starts with https://";
        } catch {
          return "The ping URL starts with https://";
        }
      },
    },
  };
}

class Setup {
  readonly #environment: Environment;
  readonly #facts: EnvironmentFacts;
  readonly #io: SetupIo;
  readonly #secrets: Set<string>;
  /** Values this run produced for the Worker secrets, kept in memory only. */
  readonly #fromRun = new Map<WorkerSecret, string>();
  #account: Account | null = null;
  #bot: Bot | null = null;
  #step: Step = "account";
  #headed = false;

  constructor(environment: Environment, io: SetupIo, secrets: Set<string>) {
    this.#environment = environment;
    this.#facts = FACTS[environment];
    this.#io = io;
    this.#secrets = secrets;
  }

  async run(step: Step): Promise<void> {
    this.#step = step;
    this.#headed = false;
    const summary = await this.#perform(step);
    this.#io.print(redact(`${step}: ${summary}`, this.#secrets));
  }

  #perform(step: Step): Promise<string> {
    switch (step) {
      case "account":
        return this.#accountStep();
      case "resources":
        return this.#resourcesStep();
      case "database":
        return this.#databaseStep();
      case "telegram":
        return this.#telegramStep();
      case "secrets":
        return this.#secretsStep();
      case "deploy":
        return this.#deployStep();
      case "access":
        return this.#accessStep();
      case "webhook":
        return this.#webhookStep();
      case "check":
        return this.#checkStep();
    }
  }

  /** An indented line under the current step's name, which is printed once before the first. */
  #say(line: string): void {
    if (!this.#headed) {
      this.#io.print(`${this.#step}:`);
      this.#headed = true;
    }
    this.#io.print(redact(`  ${line}`, this.#secrets));
  }

  async #askSecret(prompt: SecretPrompt): Promise<string> {
    for (const line of prompt.where) {
      this.#say(line);
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const value = (await this.#io.askHidden(`  ${prompt.label} (hidden): `)).trim();
      if (value === "") {
        this.#say("Nothing was received: paste it again.");
        continue;
      }
      // Registered before anything else happens, so no later line or error can show it.
      this.#secrets.add(value);
      this.#say(received(value));
      const problem = prompt.check(value);
      if (problem === null) {
        return value;
      }
      this.#say(problem);
    }
    throw new SetupError(`No usable ${prompt.label} after three tries`);
  }

  /**
   * An identifier the founder pastes, read without echo all the same: pasted before it was copied,
   * it would be the key the clipboard still holds, such as the token Cloudflare shows once. `read`
   * checks it and answers the value to keep, or throws the refusal, which never repeats the paste.
   * Only a value that passed is shown, through `#say`, which still hides any key this run has seen.
   */
  async #askIdentifier(label: string, read: (pasted: string) => string): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pasted = (await this.#io.askHidden(`  ${label} (hidden until checked): `)).trim();
      let value: string;
      try {
        value = read(pasted);
      } catch (error) {
        if (!(error instanceof SetupError)) {
          throw error;
        }
        this.#say(error.message);
        continue;
      }
      this.#say(`${label}: ${value}`);
      return value;
    }
    throw new SetupError(`No usable ${label} after three tries`);
  }

  async #texts(): Promise<{ readonly pilot: string; readonly admin: string }> {
    const [pilot, admin] = await Promise.all([
      this.#io.readFile(PILOT_FILE),
      this.#io.readFile(ADMIN_FILE),
    ]);
    if (pilot === null || admin === null) {
      throw new SetupError(`apps/worker/${pilot === null ? PILOT_FILE : ADMIN_FILE} is missing`);
    }
    return { pilot, admin };
  }

  async #config(): Promise<EnvironmentConfig> {
    return readEnvironmentConfig(await this.#texts(), this.#environment);
  }

  async #call(token: string, request: ApiRequest): Promise<{ status: number; body: unknown }> {
    const http = cloudflareRequest(token, request);
    let response: Response;
    try {
      response = await this.#io.fetch(http.url, http.init);
    } catch (error) {
      throw new SetupError(
        `Could not reach Cloudflare (${request.method} ${request.path}): check the connection`,
        { cause: error },
      );
    }
    return { status: response.status, body: await readJson(response) };
  }

  /** A Cloudflare call that must succeed; `missing` allows a 404 and answers null for it. */
  async #cloudflare(
    request: ApiRequest,
    options: { readonly token?: string; readonly missing?: boolean } = {},
  ): Promise<{ readonly result: unknown; readonly resultInfo: unknown } | null> {
    const token = options.token ?? (await this.#ensureAccount()).token;
    const { status, body } = await this.#call(token, request);
    if (status === 404 && options.missing === true) {
      return null;
    }
    if (!isRecord(body) || body.success !== true) {
      const hint =
        status === 401 || status === 403
          ? `: check the token is active and has the permissions the account step lists, for the "${this.#facts.accountName}" account`
          : "";
      throw new SetupError(
        `Cloudflare refused ${request.method} ${request.path} (HTTP ${status} ${describeCloudflareErrors(body)})${hint}`,
      );
    }
    return { result: body.result, resultInfo: body.result_info };
  }

  async #required(request: ApiRequest, token?: string): Promise<unknown> {
    const answer = await this.#cloudflare(request, token === undefined ? {} : { token });
    return answer?.result;
  }

  /** Every page of a paginated list. */
  async #all(request: (page: number) => ApiRequest): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let page = 1; ; page += 1) {
      const answer = await this.#cloudflare(request(page));
      const result = Array.isArray(answer?.result) ? answer.result : [];
      items.push(...result);
      const totalPages = field(answer?.resultInfo ?? {}, "total_pages", "result_info");
      if (result.length === 0 || typeof totalPages !== "number" || page >= totalPages) {
        return items;
      }
    }
  }

  async #telegram(token: string, method: string, params: object): Promise<unknown> {
    const http = telegramRequest(token, method, params);
    let response: Response;
    try {
      response = await this.#io.fetch(http.url, http.init);
    } catch (error) {
      throw new SetupError(`Could not reach Telegram (${method}): check the connection`, {
        cause: error,
      });
    }
    const body = await readJson(response);
    if (isRecord(body) && body.ok === true) {
      return body.result;
    }
    const description =
      isRecord(body) && typeof body.description === "string"
        ? body.description
        : `HTTP ${response.status}`;
    throw new SetupError(`Telegram ${method} failed: ${description}`);
  }

  // --- account

  async #accountStep(): Promise<string> {
    const account = await this.#ensureAccount();
    return `the "${account.name}" account, workers.dev subdomain ${(await this.#config()).workersDevSubdomain}`;
  }

  /** The credentials every Cloudflare step needs, obtained once, whichever step runs first. */
  async #ensureAccount(): Promise<Account> {
    if (this.#account !== null) {
      return this.#account;
    }
    const dotEnv = await this.#io.readFile(DOT_ENV);
    const saved = dotEnv === null ? {} : readDotEnv(dotEnv);
    let account: Account | null = null;
    if (this.#environment === "staging") {
      account = await this.#savedAccount(saved);
    }
    if (account === null) {
      account = await this.#promptAccount();
      if (this.#environment === "staging") {
        await this.#saveStagingAccount(dotEnv, account);
      } else if (
        saved.CLOUDFLARE_ACCOUNT_ID === account.accountId ||
        saved.CLOUDFLARE_API_TOKEN === account.token
      ) {
        throw new SetupError(
          "apps/worker/.env holds this production account's credentials, which must never be on this machine: delete that file, then delete the token in Cloudflare (infra/runbooks/secrets-rotation.md)",
        );
      } else {
        this.#say(
          "Production: nothing is saved on this machine. After this first setup, production deploys go through the GitHub deploy workflow on a v* tag you approve (infra/runbooks/release.md).",
        );
      }
    }
    this.#account = account;
    return account;
  }

  async #savedAccount(saved: Readonly<Record<string, string>>): Promise<Account | null> {
    const token = saved.CLOUDFLARE_API_TOKEN;
    const accountId = saved.CLOUDFLARE_ACCOUNT_ID;
    if (token === undefined || accountId === undefined || !ACCOUNT_ID.test(accountId)) {
      return null;
    }
    this.#secrets.add(token);
    const { status, body } = await this.#call(token, cloudflareApi.verifyToken());
    const result = isRecord(body) ? body.result : undefined;
    if (status !== 200 || !isRecord(result) || result.status !== "active") {
      this.#say("The token saved in apps/worker/.env no longer works: create a new one.");
      return null;
    }
    this.#say("Using the staging token saved in apps/worker/.env.");
    return this.#checkAccount(token, accountId);
  }

  async #promptAccount(): Promise<Account> {
    for (const line of tokenTemplate(this.#environment)) {
      this.#say(line);
    }
    const token = await this.#askSecret({
      label: "Cloudflare API token",
      where: [],
      check: (value) => (WHITESPACE.test(value) ? "A token has no spaces: copy it again" : null),
    });
    const verified = await this.#required(cloudflareApi.verifyToken(), token);
    if (field(verified, "status", "token") !== "active") {
      throw new SetupError("Cloudflare says this token is not active: create a new one");
    }
    this.#say(
      `Account ID: in the "${this.#facts.accountName}" account, Workers & Pages overview, right-hand column (32 characters, not secret).`,
    );
    const accountId = await this.#askIdentifier("Account ID", (pasted) => {
      if (!ACCOUNT_ID.test(pasted)) {
        throw new SetupError("An account ID is 32 characters of 0-9 and a-f");
      }
      return pasted;
    });
    return this.#checkAccount(token, accountId);
  }

  /** The account is the one this environment names and has the subdomain the hosts are built on. */
  async #checkAccount(token: string, accountId: string): Promise<Account> {
    const name = textAt(
      await this.#required(cloudflareApi.account(accountId), token),
      "name",
      "account",
    );
    if (name !== this.#facts.accountName) {
      const answer = await this.#io.ask(
        `  This account is named "${name}", not "${this.#facts.accountName}". To set up ${this.#environment} in it anyway, type ${this.#environment}: `,
      );
      if (answer.trim() !== this.#environment) {
        throw new SetupError(`Stopped: "${name}" is not the ${this.#environment} account`);
      }
    }
    const subdomain = field(
      await this.#required(cloudflareApi.subdomain(accountId), token),
      "subdomain",
      "subdomain",
    );
    const expected = (await this.#config()).workersDevSubdomain;
    if (subdomain !== expected) {
      throw new SetupError(
        `The account's workers.dev subdomain is ${typeof subdomain === "string" ? subdomain : "not set"}, but the wrangler files are built on ${expected}: set it first (infra/README.md, section 1, step 10)`,
      );
    }
    return { token, accountId, name };
  }

  async #saveStagingAccount(dotEnv: string | null, account: Account): Promise<void> {
    const ignored = await this.#io.run(
      { tool: "git", args: ["check-ignore", "--quiet", DOT_ENV], env: {}, stdin: "" },
      () => {},
    );
    if (ignored !== 0) {
      throw new SetupError(
        "git does not ignore apps/worker/.env, so the staging token was not saved there: restore the .env line in .gitignore and run again",
      );
    }
    await this.#io.writeFile(
      DOT_ENV,
      mergeDotEnv(dotEnv, {
        CLOUDFLARE_API_TOKEN: account.token,
        CLOUDFLARE_ACCOUNT_ID: account.accountId,
      }),
    );
    this.#say("Saved the staging token and account id to apps/worker/.env (git-ignored).");
  }

  #cloudflareEnv(account: Account): Readonly<Record<string, string>> {
    return { CLOUDFLARE_API_TOKEN: account.token, CLOUDFLARE_ACCOUNT_ID: account.accountId };
  }

  // --- resources

  async #resourcesStep(): Promise<string> {
    const config = await this.#config();
    const { accountId } = await this.#ensureAccount();
    const existing = new Set(
      (await this.#all((page) => cloudflareApi.queues(accountId, page))).map((queue) =>
        field(queue, "queue_name", "queue"),
      ),
    );
    const created: string[] = [];
    const kept: string[] = [];
    for (const queue of config.queues) {
      if (existing.has(queue)) {
        kept.push(queue);
      } else {
        await this.#required(cloudflareApi.createQueue(accountId, queue));
        created.push(queue);
      }
    }
    for (const bucket of config.buckets) {
      if (
        (await this.#cloudflare(cloudflareApi.bucket(accountId, bucket), { missing: true })) !==
        null
      ) {
        kept.push(`bucket ${bucket}`);
      } else {
        await this.#required(cloudflareApi.createBucket(accountId, bucket));
        created.push(`bucket ${bucket}`);
      }
    }
    return changes(created, kept);
  }

  // --- database

  async #databaseStep(): Promise<string> {
    const { neonBranch, hyperdriveName } = this.#facts;
    const account = await this.#ensureAccount();
    const connectionString = await this.#askSecret({
      label: "Neon connection string",
      where: [
        "Neon console (console.neon.tech), project vela-apac: select Connect.",
        `Choose branch ${neonBranch}, database vela and the role that owns it, turn Connection pooling off, and copy the connection string.`,
        "The direct string, not the pooled one: the migrations need a session, and Hyperdrive pools connections itself.",
      ],
      check: (value) => problemOf(() => parseConnectionString(value)),
    });
    const origin = parseConnectionString(connectionString);
    this.#secrets.add(origin.password);

    this.#say(`Applying the migrations to the Neon ${neonBranch} branch.`);
    const exitCode = await this.#io.run(
      { tool: "migrate", args: [], env: { DATABASE_URL: connectionString }, stdin: "" },
      (line) => this.#say(`  ${line}`),
    );
    if (exitCode !== 0) {
      throw new SetupError(`The migrations failed (exit ${exitCode}): read the lines above`);
    }

    const configs = await this.#all((page) =>
      cloudflareApi.hyperdriveConfigs(account.accountId, page),
    );
    const found = configs.find((config) => field(config, "name", "hyperdrive") === hyperdriveName);
    let id: string;
    let hyperdrive: string;
    if (found === undefined) {
      const result = await this.#required(
        cloudflareApi.createHyperdrive(account.accountId, hyperdriveName, origin),
      );
      id = textAt(result, "id", "hyperdrive");
      hyperdrive = `Hyperdrive ${hyperdriveName} created with caching off`;
    } else {
      id = textAt(found, "id", "hyperdrive");
      const existing = field(found, "origin", "hyperdrive");
      if (
        field(existing, "host", "origin") !== origin.host ||
        field(existing, "database", "origin") !== origin.database ||
        field(existing, "user", "origin") !== origin.user
      ) {
        throw new SetupError(
          `Hyperdrive ${hyperdriveName} already exists for another host, database or role than this connection string: check it in Storage & Databases > Hyperdrive before going on`,
        );
      }
      if (field(field(found, "caching", "hyperdrive") ?? {}, "disabled", "caching") !== true) {
        await this.#required(cloudflareApi.disableCaching(account.accountId, id));
        hyperdrive = `Hyperdrive ${hyperdriveName} already there, caching turned off`;
      } else {
        hyperdrive = `Hyperdrive ${hyperdriveName} already there, caching off`;
      }
    }
    if (!HYPERDRIVE_ID.test(id)) {
      throw new SetupError(
        "Hyperdrive answered with an id that is not 32 characters of 0-9 and a-f, which src/wrangler-config.test.ts would refuse: nothing was written",
      );
    }
    const written: string[] = [];
    const config = await this.#config();
    const placeholder = placeholdersOf(this.#environment).hyperdriveId;
    for (const [file, current] of [
      [PILOT_FILE, config.pilotHyperdriveId],
      [ADMIN_FILE, config.adminHyperdriveId],
    ] as const) {
      if (await this.#fill(file, { placeholder, current, value: id, what: "Hyperdrive id" })) {
        written.push(file);
      }
    }
    const files =
      written.length === 0
        ? "id already in both wrangler files"
        : `id written to ${written.join(" and ")}`;
    return `migrations applied; ${hyperdrive}; ${files}`;
  }

  async #fill(
    file: typeof PILOT_FILE | typeof ADMIN_FILE,
    fill: Pick<PlaceholderFill, "placeholder" | "current" | "value" | "what">,
  ): Promise<boolean> {
    const texts = await this.#texts();
    const result = fillPlaceholder({
      ...fill,
      file,
      text: file === PILOT_FILE ? texts.pilot : texts.admin,
      environment: this.#environment,
    });
    if (result.changed) {
      await this.#io.writeFile(file, result.text);
    }
    return result.changed;
  }

  // --- telegram

  async #workerSecrets(worker: string): Promise<ReadonlySet<string>> {
    const { accountId } = await this.#ensureAccount();
    const answer = await this.#cloudflare(cloudflareApi.workerSecrets(accountId, worker), {
      missing: true,
    });
    const list = Array.isArray(answer?.result) ? answer.result : [];
    return new Set(list.map((secret) => String(field(secret, "name", "secret"))));
  }

  /** The bot's token, asked once and checked with getMe, which also names the bot. */
  async #ensureBot(): Promise<Bot> {
    if (this.#bot !== null) {
      return this.#bot;
    }
    const token = await this.#askSecret({
      label: "Telegram bot token",
      where: [
        `In Telegram, open @BotFather, send /mybots, choose the ${this.#facts.botName} bot, and select API Token.`,
      ],
      check: (value) =>
        BOT_TOKEN.test(value)
          ? null
          : "A bot token is the bot's number, a colon, then letters, digits, _ and -",
    });
    let username: string;
    try {
      username = (await getMe({ botToken: token, fetch: this.#io.fetch })).username;
    } catch (error) {
      throw new SetupError(
        "Telegram did not accept this bot token (getMe failed): copy it again from @BotFather",
        { cause: error },
      );
    }
    if (!BOT_USERNAME.test(username)) {
      throw new SetupError("Telegram answered with a bot username this script cannot write");
    }
    const configured = (await this.#config()).botUsername;
    if (!configured.startsWith(PLACEHOLDER) && configured !== username) {
      throw new SetupError(
        `This token belongs to @${username}, but ${PILOT_FILE} names @${configured} for ${this.#environment}: use that bot's token`,
      );
    }
    this.#bot = { token, username };
    return this.#bot;
  }

  async #telegramStep(): Promise<string> {
    const config = await this.#config();
    const pilotSecrets = await this.#workerSecrets(config.pilotWorker);
    if (
      !config.botUsername.startsWith(PLACEHOLDER) &&
      TELEGRAM_STEP_SECRETS.every((name) => pilotSecrets.has(name))
    ) {
      return `@${config.botUsername} is in ${PILOT_FILE}, and ${config.pilotWorker} already holds its token, webhook secret and your chat id: nothing to do`;
    }
    const bot = await this.#ensureBot();
    const written = await this.#fill(PILOT_FILE, {
      placeholder: placeholdersOf(this.#environment).botUsername,
      current: config.botUsername,
      value: bot.username,
      what: "bot username",
    });
    this.#fromRun.set("TELEGRAM_BOT_TOKEN", bot.token);

    let chat: string;
    if (pilotSecrets.has("ADMIN_CONVERSATION_ID")) {
      chat = `your chat id is already on ${config.pilotWorker}`;
    } else {
      const found = await this.#readStartChat(bot);
      this.#secrets.add(found.chatId);
      this.#fromRun.set("ADMIN_CONVERSATION_ID", found.chatId);
      chat = `your chat (${found.firstName}) read for ADMIN_CONVERSATION_ID`;
    }

    this.#fromRun.set("TELEGRAM_WEBHOOK_SECRET", this.#newWebhookSecret());
    return `@${bot.username} ${written ? "written to" : "already in"} ${PILOT_FILE}; ${chat}; webhook secret generated`;
  }

  #newWebhookSecret(): string {
    const secret = generateWebhookSecret(this.#io.randomBytes);
    this.#secrets.add(secret);
    return secret;
  }

  /**
   * The founder's own private chat with the bot. Telegram answers getUpdates only while the bot
   * has no webhook, and confirming updates would discard any a family had sent, so a bot that
   * already has a webhook is refused rather than switched over.
   */
  async #readStartChat(bot: Bot): Promise<StartChat> {
    const webhook = await this.#telegram(bot.token, "getWebhookInfo", {});
    if (field(webhook, "url", "webhook") !== "") {
      throw new SetupError(
        `@${bot.username} already has a webhook, and Telegram reads your chat only for a bot without one. This script will not remove it from a bot that may already carry families' messages: see infra/README.md, section 7, step 5`,
      );
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.#io.ask(
        `  From your own Telegram account, open @${bot.username}, send /start, then press Enter here: `,
      );
      const { chats, lastUpdateId } = startChats(
        await this.#telegram(bot.token, "getUpdates", { timeout: 0 }),
      );
      for (const chat of chats) {
        const answer = await this.#io.ask(`  Is "${chat.firstName}" you? Type yes or no: `);
        if (answer.trim().toLowerCase() === "yes" && lastUpdateId !== null) {
          // Confirms every update read so far, so this /start never reaches the Worker and begins
          // an organiser setup once the webhook exists.
          await this.#telegram(bot.token, "getUpdates", {
            offset: lastUpdateId + 1,
            limit: 1,
            timeout: 0,
          });
          return chat;
        }
      }
      this.#say(
        chats.length === 0
          ? "No /start has reached the bot yet."
          : "None of those chats is yours: send /start again from your own account.",
      );
    }
    throw new SetupError("Your /start did not arrive after five tries");
  }

  // --- secrets

  async #wrangler(args: readonly string[], stdin: string, echo: boolean): Promise<void> {
    const account = await this.#ensureAccount();
    const lines: string[] = [];
    const exitCode = await this.#io.run(
      { tool: "wrangler", args, env: this.#cloudflareEnv(account), stdin },
      (line) => (echo ? this.#say(`  ${line}`) : lines.push(line)),
    );
    if (exitCode !== 0) {
      for (const line of lines) {
        this.#say(`  ${line}`);
      }
      throw new SetupError(
        `wrangler ${args.slice(0, 2).join(" ")} failed (exit ${exitCode}): read the lines above`,
      );
    }
  }

  /** `wrangler secret put` with the value on stdin, which wrangler reads when not a terminal. */
  async #putSecret(role: WorkerRole, name: string, value: string): Promise<void> {
    const config = role === "admin" ? ["-c", ADMIN_FILE] : [];
    await this.#wrangler(
      ["secret", "put", name, ...config, "--env", this.#environment],
      value,
      false,
    );
  }

  async #secretsStep(): Promise<string> {
    const config = await this.#config();
    const worker = (role: WorkerRole): string =>
      role === "pilot" ? config.pilotWorker : config.adminWorker;
    const plan = planSecrets(
      {
        pilot: await this.#workerSecrets(config.pilotWorker),
        admin: await this.#workerSecrets(config.adminWorker),
      },
      this.#fromRun,
    );
    const missing = plan.filter((entry) => entry.source === "missing").map((entry) => entry.name);
    if (missing.length > 0) {
      throw new SetupError(
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not on ${config.pilotWorker}, and only the telegram step reads ${missing.length === 1 ? "it" : "them"}: run again with --from telegram`,
      );
    }
    const prompts = secretPrompts(this.#environment);
    const put: string[] = [];
    const kept: string[] = [];
    for (const entry of plan) {
      if (entry.source === "kept") {
        kept.push(entry.name);
        continue;
      }
      const prompt = prompts[entry.name];
      const value =
        this.#fromRun.get(entry.name) ??
        (prompt === undefined ? undefined : await this.#askSecret(prompt));
      if (value === undefined) {
        throw new SetupError(
          `${entry.name} has no value in this run: run again with --from telegram`,
        );
      }
      for (const role of entry.workers) {
        await this.#putSecret(role, entry.name, value);
      }
      put.push(`${entry.name} on ${entry.workers.map(worker).join(" and ")}`);
    }
    return changes(put, kept, "put", "already there");
  }

  // --- deploy

  async #deployStep(): Promise<string> {
    const config = await this.#config();
    const left = [config.pilotHyperdriveId, config.adminHyperdriveId, config.botUsername].filter(
      (value) => value.startsWith(PLACEHOLDER),
    );
    if (left.length > 0) {
      throw new SetupError(
        `The wrangler files still hold ${[...new Set(left)].join(", ")} for ${this.#environment}: run the database and telegram steps first`,
      );
    }
    if (this.#environment === "production") {
      this.#say(
        "This deploys production from this laptop, once, to set it up. From now on production deploys go through the GitHub deploy workflow (infra/runbooks/release.md).",
      );
    }
    this.#say(
      `Deploying ${config.pilotWorker}, which exports the scheduler the admin Worker binds.`,
    );
    await this.#wrangler(["deploy", "--env", this.#environment], "", true);
    this.#say(`Deploying ${config.adminWorker}.`);
    await this.#wrangler(["deploy", "-c", ADMIN_FILE, "--env", this.#environment], "", true);
    return `${config.pilotWorker} and ${config.adminWorker} deployed to ${this.#environment}`;
  }

  // --- access

  async #accessStep(): Promise<string> {
    const config = await this.#config();
    const adminSecrets = await this.#workerSecrets(config.adminWorker);
    if (adminSecrets.has("ACCESS_TEAM_DOMAIN") && adminSecrets.has("ACCESS_AUD")) {
      return `${config.adminWorker} already holds ACCESS_TEAM_DOMAIN and ACCESS_AUD: nothing to do`;
    }
    for (const line of [
      `In the "${this.#facts.accountName}" dashboard (infra/README.md, section 12):`,
      "1. First time only: select Zero Trust, choose a team name, then the Free plan.",
      "   The team domain is <team name>.cloudflareaccess.com; Zero Trust > Settings shows the team name.",
      `2. Workers & Pages > ${config.adminWorker} > Access > Protect this Worker behind Access > All traffic.`,
      "   Authentication policy: Cloudflare account. Then Apply Access.",
      `   Never protect ${config.pilotWorker}, and never use Protect all Workers: Telegram and the notice pages must stay open.`,
      "3. Zero Trust > Access controls > Applications > Configure (the application for",
      `   ${config.adminWorker}) > Additional settings: the Application Audience (AUD) Tag.`,
    ]) {
      this.#say(line);
    }
    await this.#io.ask("  When Access is applied, press Enter: ");
    const teamDomain = await this.#askIdentifier("Team domain", normalizeTeamDomain);
    const audience = await this.#askSecret({
      label: "Application Audience (AUD) tag",
      where: [],
      check: (value) =>
        ACCESS_AUD.test(value) ? null : "The AUD tag is 64 characters of 0-9 and a-f",
    });
    await this.#putSecret("admin", "ACCESS_TEAM_DOMAIN", teamDomain);
    await this.#putSecret("admin", "ACCESS_AUD", audience);
    return `ACCESS_TEAM_DOMAIN and ACCESS_AUD put on ${config.adminWorker}`;
  }

  // --- webhook

  async #webhookStep(): Promise<string> {
    const config = await this.#config();
    const bot = await this.#ensureBot();
    let secret = this.#fromRun.get("TELEGRAM_WEBHOOK_SECRET");
    let note = "";
    if (secret === undefined) {
      // The Worker's secret cannot be read back, so a resumed run makes a new one on both sides.
      secret = this.#newWebhookSecret();
      await this.#putSecret("pilot", "TELEGRAM_WEBHOOK_SECRET", secret);
      note = `; a new webhook secret is on ${config.pilotWorker}`;
    }
    const fetchImpl = this.#io.fetch;
    const api: TelegramSetupApi = {
      getMe: (options) => getMe({ ...options, fetch: fetchImpl }),
      setWebhook: (options) => setWebhook({ ...options, fetch: fetchImpl }),
      setMyCommands: (options) => setMyCommands({ ...options, fetch: fetchImpl }),
    };
    await setUpTelegram({
      env: {
        TELEGRAM_BOT_TOKEN: bot.token,
        TELEGRAM_WEBHOOK_SECRET: secret,
        WORKER_URL: config.pilotOrigin,
      },
      // Not telegram:setup's arguments: this script's own command line refuses the drop flag.
      argv: null,
      api,
      print: (line) => this.#say(line),
    });
    return `@${bot.username} delivers to ${config.pilotOrigin}/webhooks/telegram, pending updates kept${note}`;
  }

  // --- check

  async #checkStep(): Promise<string> {
    const config = await this.#config();
    const checks = [
      { url: `${config.pilotOrigin}/healthz`, open: true },
      ...config.noticeUrls.map((url) => ({ url, open: true })),
      { url: `${config.adminOrigin}/admin`, open: false },
    ];
    let failed = 0;
    for (const check of checks) {
      let status: number | null = null;
      let location = "";
      try {
        const response = await this.#io.fetch(check.url, { redirect: "manual" });
        status = response.status;
        location = response.headers.get("location") ?? "";
      } catch {
        status = null;
      }
      const ok = check.open ? status === 200 : status !== null && status !== 200;
      failed += ok ? 0 : 1;
      let note = "";
      if (!check.open && ok) {
        note = location.includes(".cloudflareaccess.com")
          ? ", Cloudflare Access asks for a sign-in"
          : ", closed by the Worker itself, but Access did not ask for a sign-in: check the access step";
      }
      this.#say(
        `${ok ? "ok    " : "FAILED"} GET ${check.url}: ${status === null ? "no answer" : `HTTP ${status}`}${check.open ? ", expected 200" : ", expected anything but 200"}${note}`,
      );
    }
    if (failed > 0) {
      throw new SetupError(`${failed} of ${checks.length} checks failed (above)`);
    }
    for (const line of [
      "Next:",
      `1. From your own Telegram account, open @${config.botUsername} and send /start: onboarding begins, with your own family first.`,
      `2. Open ${config.adminOrigin}/admin: Cloudflare Access asks you to sign in, then the overview opens.`,
      `3. Within 10 minutes, Healthchecks shows ${this.#facts.healthcheck} up.`,
      "4. The wrangler files now hold this environment's Hyperdrive id and bot username (identifiers, not secrets): commit them.",
    ]) {
      this.#say(line);
    }
    return "every check passed";
  }
}

function changes(
  done: readonly string[],
  kept: readonly string[],
  doneVerb = "created",
  keptVerb = "already there",
): string {
  const parts = [
    ...(done.length > 0 ? [`${doneVerb} ${done.join(", ")}`] : []),
    ...(kept.length > 0 ? [`${keptVerb}: ${kept.join(", ")}`] : []),
  ];
  return parts.length === 0 ? "nothing to do" : parts.join("; ");
}

/** What a failure prints: this script's own refusal, or only the class and code of anything else */
export function describeFailure(error: unknown, secrets: Iterable<string>): string {
  if (error instanceof SetupError) {
    return redact(error.message, secrets);
  }
  return `Setup failed: ${errorLabel(error)}`;
}

/** Runs the command line against `io` and answers the process's exit code. */
export async function runSetup(argv: readonly string[], io: SetupIo): Promise<number> {
  const secrets = new Set<string>();
  let resume: string | null = null;
  try {
    const command = parseArguments(argv);
    if (command.kind === "help") {
      for (const line of usage()) {
        io.print(line);
      }
      return 0;
    }
    if (!io.interactive) {
      throw new SetupError(
        "This terminal cannot hide what you type (standard input is not a terminal): run the setup from Windows Terminal or PowerShell",
      );
    }
    const setup = new Setup(command.environment, io, secrets);
    io.print(
      `Setting up ${command.environment} in the "${FACTS[command.environment].accountName}" Cloudflare account. Secrets are read at hidden prompts and never shown.`,
    );
    for (const step of stepsFrom(command.from)) {
      resume = `pnpm --filter @vela/worker run setup -- --env ${command.environment} --from ${step}`;
      await setup.run(step);
    }
    return 0;
  } catch (error) {
    io.print(describeFailure(error, secrets));
    io.print(
      resume === null
        ? "Run with --help for the arguments."
        : `When it is fixed, resume: ${resume}`,
    );
    return 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Node

/**
 * The real side effects. Node's modules are imported here, when the script runs, because the
 * tests load this file inside workerd, where a terminal, child processes and files do not exist.
 */
async function nodeIo(): Promise<SetupIo> {
  const [{ spawn }, { readFile, writeFile }, { fileURLToPath }, { default: process }] =
    await Promise.all([
      import("node:child_process"),
      import("node:fs/promises"),
      import("node:url"),
      import("node:process"),
    ]);
  const workerDirectory = new URL("../", import.meta.url);
  const pathOf = (relative: string): string => fileURLToPath(new URL(relative, workerDirectory));
  const tools: Readonly<
    Record<Command["tool"], { program: string; prefix: string[]; cwd: string }>
  > = {
    wrangler: {
      program: process.execPath,
      prefix: [pathOf("node_modules/wrangler/bin/wrangler.js")],
      cwd: pathOf("."),
    },
    migrate: {
      program: process.execPath,
      prefix: [pathOf("../../packages/db/src/migrate.ts")],
      cwd: pathOf("../../packages/db"),
    },
    git: { program: "git", prefix: [], cwd: pathOf(".") },
  };
  // Credentials the founder's shell may already hold never reach a child: only the ones this run
  // was given do, so a stray variable cannot point wrangler at another account or database.
  const withheld = new Set([
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
    "DATABASE_URL",
  ]);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !withheld.has(name.toUpperCase())),
  );

  const readLine = (question: string, echo: boolean): Promise<string> => {
    const { stdin, stdout } = process;
    stdout.write(question);
    return new Promise((resolve, reject) => {
      let line = EMPTY_LINE;
      const onData = (chunk: string): void => {
        const before = [...line.value];
        line = typeInto(line, chunk);
        if (echo) {
          const after = [...line.value];
          let same = 0;
          while (same < before.length && same < after.length && before[same] === after[same]) {
            same += 1;
          }
          stdout.write("\b \b".repeat(before.length - same) + after.slice(same).join(""));
        }
        if (line.state === "typing") {
          return;
        }
        stdin.off("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write("\n");
        if (line.state === "entered") {
          resolve(line.value);
        } else {
          reject(new SetupError("Cancelled with Ctrl+C. Steps already finished stay done."));
        }
      };
      // Raw mode hands every key to the script, so nothing reaches the screen unless echoed.
      stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      stdin.on("data", onData);
      stdin.resume();
    });
  };

  return {
    interactive: process.stdin.isTTY === true,
    print: (line) => console.log(line),
    ask: (question) => readLine(question, true),
    askHidden: (question) => readLine(question, false),
    fetch: (input, init) => fetch(input, init),
    run: (command, onLine) =>
      new Promise((resolve, reject) => {
        const tool = tools[command.tool];
        const child = spawn(tool.program, [...tool.prefix, ...command.args], {
          cwd: tool.cwd,
          env: { ...inherited, ...command.env },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        const pending = { stdout: "", stderr: "" };
        const collect =
          (stream: "stdout" | "stderr") =>
          (chunk: string): void => {
            const lines = (pending[stream] + chunk).split(/\r?\n/);
            pending[stream] = lines.pop() ?? "";
            for (const line of lines) {
              onLine(line);
            }
          };
        child.stdout.setEncoding("utf8").on("data", collect("stdout"));
        child.stderr.setEncoding("utf8").on("data", collect("stderr"));
        child.on("error", (error) =>
          reject(new SetupError(`Could not start ${command.tool}`, { cause: error })),
        );
        child.on("close", (code) => {
          for (const rest of [pending.stdout, pending.stderr]) {
            if (rest !== "") {
              onLine(rest);
            }
          }
          resolve(code ?? 1);
        });
        // A command that does not read its input (git) may exit first; that is not a failure.
        child.stdin.on("error", () => {});
        child.stdin.end(command.stdin);
      }),
    readFile: async (file) => {
      try {
        return await readFile(pathOf(file), "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    },
    writeFile: (file, text) =>
      writeFile(pathOf(file), text, file === DOT_ENV ? { encoding: "utf8", mode: 0o600 } : "utf8"),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  };
}

// Only when Node runs this file, never when a test imports it.
if (Reflect.get(import.meta, "main") === true) {
  const { default: process } = await import("node:process");
  process.exitCode = await runSetup(process.argv.slice(2), await nodeIo());
}
