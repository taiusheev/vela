/**
 * The Worker's half of the ports in code design §8: Cloudflare bindings and secrets on one side,
 * the `Deps` object services receive on the other. Services never see any of this.
 *
 * Deps are built per invocation, because a database connection belongs to one request: the caller
 * hands `close()` to `ctx.waitUntil`, and Hyperdrive keeps the pooled connection behind it warm.
 * A missing secret throws before anything is opened, naming the variable.
 */
import { createTelegramAdapter } from "@vela/adapters";
import { createClaudeAi, createDeepgramStt } from "@vela/ai";
import { type Channel, type Lang, REGIONS, type Region } from "@vela/contracts";
import { connectDatabase } from "@vela/db";
import type {
  ChannelRegistry,
  Config,
  Deps,
  Heartbeat,
  JobQueue,
  Logger,
  MediaStore,
  MemberScheduler as MemberSchedulerPort,
  Random,
} from "@vela/services";
import type { Env } from "./env.ts";

/** A built `Deps` and the connection it holds; `close()` belongs in `ctx.waitUntil`. */
export interface DepsHandle {
  readonly deps: Deps;
  close(): Promise<void>;
}

export interface DepsOptions {
  /**
   * Replaces the scheduler port. The Durable Object passes one that sets its own alarm directly:
   * calling itself over RPC from inside its own handler would wait on a lock it already holds.
   */
  readonly scheduler?: MemberSchedulerPort;
  /** Reuses the registry the webhook route already built to verify and parse the request. */
  readonly channels?: ChannelRegistry;
}

const ENVIRONMENTS = ["development", "staging", "production"] as const;

/** The secrets in `.dev.vars.example`; each is read through `secret()`, which names a missing one. */
type SecretName =
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_WEBHOOK_SECRET"
  | "ANTHROPIC_API_KEY"
  | "DEEPGRAM_API_KEY"
  | "HEALTHCHECKS_PING_URL"
  | "ACCESS_TEAM_DOMAIN"
  | "ACCESS_AUD";

/**
 * A secret, or a clear failure naming it. Deployment is the only place it can be fixed, so the
 * message says where to put it rather than leaving a stack trace about an empty string.
 */
export function secret(env: Env, name: SecretName): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is not set: add it to .dev.vars locally, or run "wrangler secret put ${name} --env <environment>"`,
    );
  }
  return value;
}

function requireVar(env: Env, name: "PUBLIC_BASE_URL" | "TELEGRAM_BOT_USERNAME"): string {
  const value = env[name];
  if (value.trim() === "") {
    throw new Error(`${name} is not set: add it to the environment's vars in wrangler.jsonc`);
  }
  return value.trim();
}

function readEnvironment(env: Env): Config["environment"] {
  const found = ENVIRONMENTS.find((candidate) => candidate === env.ENVIRONMENT);
  if (found === undefined) {
    throw new Error(`ENVIRONMENT must be one of ${ENVIRONMENTS.join(", ")}`);
  }
  return found;
}

function readRegions(env: Env): readonly Region[] {
  const names = env.REGIONS.split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const regions = names.map((name) => {
    const region = REGIONS.find((candidate) => candidate === name);
    if (region === undefined) {
      throw new Error(`REGIONS lists "${name}", which is not one of ${REGIONS.join(", ")}`);
    }
    return region;
  });
  if (regions.length === 0) {
    throw new Error("REGIONS is empty: list the regions whose database exists, such as apac");
  }
  return regions;
}

/** Vars and secrets as services' `Config` (code design §8). */
function readConfig(env: Env): Config {
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
  const adminConversationId = env.ADMIN_CONVERSATION_ID.trim();
  return {
    telegramBotUsername: requireVar(env, "TELEGRAM_BOT_USERNAME"),
    adminConversationId: adminConversationId === "" ? null : adminConversationId,
    environment: readEnvironment(env),
    regions: readRegions(env),
    publicBaseUrl: requireVar(env, "PUBLIC_BASE_URL"),
    privacyNoticeUrls,
  };
}

/**
 * One JSON line per event, which is what Workers Logs indexes. Only the flat, content-free fields
 * services pass: a value that cannot be serialised is dropped rather than risking a half-written
 * line, and nothing here ever formats a message body.
 */
export function createLogger(env: Env): Logger {
  const write = (level: string, event: string, fields?: Record<string, unknown>): void => {
    let line: string;
    try {
      line = JSON.stringify({ level, event, environment: env.ENVIRONMENT, ...fields });
    } catch {
      line = JSON.stringify({
        level,
        event,
        environment: env.ENVIRONMENT,
        fields: "unserialisable",
      });
    }
    console.log(line);
  };
  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

const BASE64URL_UNSAFE = /[+/=]/g;
const BASE64URL_REPLACEMENTS: Record<string, string> = { "+": "-", "/": "_", "=": "" };

/** Invite tokens: the platform's CSPRNG, base64url so the token survives a Telegram deep link. */
function createRandom(): Random {
  return {
    token(bytes = 32) {
      const buffer = new Uint8Array(bytes);
      crypto.getRandomValues(buffer);
      let binary = "";
      for (const byte of buffer) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary).replace(BASE64URL_UNSAFE, (char) => BASE64URL_REPLACEMENTS[char] ?? "");
    },
  };
}

function createMediaStore(bucket: R2Bucket): MediaStore {
  return {
    async put(key, body, mime) {
      await bucket.put(key, body, { httpMetadata: { contentType: mime } });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (object === null) {
        return null;
      }
      return {
        body: await object.arrayBuffer(),
        mime: object.httpMetadata?.contentType ?? "application/octet-stream",
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

function createJobQueue<J>(queue: Queue<J>): JobQueue<J> {
  return {
    async send(job, options) {
      await (options?.delaySeconds === undefined
        ? queue.send(job)
        : queue.send(job, { delaySeconds: options.delaySeconds }));
    },
  };
}

/** The scheduler as the rest of the Worker sees it: one Durable Object per member id. */
export function createSchedulerPort(env: Env): MemberSchedulerPort {
  return {
    async wakeAt(memberId, at) {
      const stub = env.MEMBER_SCHEDULER.get(env.MEMBER_SCHEDULER.idFromName(memberId));
      await stub.wakeAt(memberId, at);
    },
  };
}

export interface HeartbeatOptions {
  /** Injected by tests; production uses the global. */
  readonly fetch?: typeof fetch;
}

/**
 * The cron heartbeat. A missed ping must never fail the reconciliation that was otherwise fine, so
 * a failure is logged and swallowed; the monitor notices the silence by itself.
 *
 * The ping URL is a secret, and a capability: whoever holds it can silence or fake the monitor. A
 * failed fetch can carry the URL it was given inside its message, so the log line says what went
 * wrong and never the error itself, the way the Telegram client keeps its token out of one.
 */
export function createHeartbeat(
  url: string,
  logger: Logger,
  options: HeartbeatOptions = {},
): Heartbeat {
  const fetchImpl: typeof fetch = options.fetch ?? ((resource, init) => fetch(resource, init));
  return {
    async ping() {
      try {
        const response = await fetchImpl(url, { method: "POST" });
        if (!response.ok) {
          logger.warn("heartbeat_failed", { status: response.status });
        }
      } catch {
        logger.warn("heartbeat_failed", { reason: "network" });
      }
    },
  };
}

/** The channels this Worker speaks. Telegram is the pilot's only one; the rest are not wired yet. */
export function createChannels(env: Env): ChannelRegistry {
  const telegram = createTelegramAdapter({
    botToken: secret(env, "TELEGRAM_BOT_TOKEN"),
    webhookSecret: secret(env, "TELEGRAM_WEBHOOK_SECRET"),
    botUsername: requireVar(env, "TELEGRAM_BOT_USERNAME"),
  });
  return {
    get(channel: Channel) {
      if (channel !== "telegram") {
        throw new Error(`no adapter is wired for the ${channel} channel`);
      }
      return telegram;
    },
  };
}

/**
 * Deps for one invocation. Everything that can fail on configuration fails before the database
 * connection is opened, so a misconfigured Worker never leaks one.
 */
export async function buildDeps(env: Env, options: DepsOptions = {}): Promise<DepsHandle> {
  const config = readConfig(env);
  const logger = createLogger(env);
  const channels = options.channels ?? createChannels(env);
  const ai = createClaudeAi({ apiKey: secret(env, "ANTHROPIC_API_KEY") });
  const stt = createDeepgramStt({ apiKey: secret(env, "DEEPGRAM_API_KEY") });
  const heartbeat = createHeartbeat(secret(env, "HEALTHCHECKS_PING_URL"), logger);

  const connection = await connectDatabase(env.HYPERDRIVE.connectionString);
  return {
    deps: {
      db: connection.db,
      clock: { now: () => new Date() },
      logger,
      random: createRandom(),
      queues: {
        outbound: createJobQueue(env.OUTBOUND_QUEUE),
        media: createJobQueue(env.MEDIA_QUEUE),
        understand: createJobQueue(env.UNDERSTAND_QUEUE),
      },
      scheduler: options.scheduler ?? createSchedulerPort(env),
      media: createMediaStore(env.MEDIA_BUCKET),
      channels,
      ai,
      stt,
      heartbeat,
      config,
    },
    close: () => connection.close(),
  };
}
