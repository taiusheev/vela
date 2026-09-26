/**
 * The Workers' half of the ports in code design §8: Cloudflare bindings and secrets on one side,
 * the ports services receive on the other. Services never see any of this.
 *
 * Deps are built per invocation, because a database connection belongs to one request: the caller
 * hands `close()` to `ctx.waitUntil`, and Hyperdrive keeps the pooled connection behind it warm.
 * A missing secret, or a var a deployed environment cannot run with, throws before anything is
 * opened, naming the variable (`config.ts`).
 *
 * The pilot Worker builds every port. The admin Worker builds only the ports the admin actions and
 * reads use (`AdminDeps`), from its own, smaller set of bindings.
 */
import { createLineAdapter, createTelegramAdapter } from "@vela/adapters";
import { type Ai, createClaudeAi, createDeepgramStt, createOffAi } from "@vela/ai";
import type { Channel, ChannelAdapter } from "@vela/contracts";
import { connectDatabase, type VelaDatabase } from "@vela/db";
import type {
  ChannelRegistry,
  Clock,
  Deps,
  JobQueue,
  Logger,
  MediaStore,
  MemberScheduler as MemberSchedulerPort,
  OutboundJob,
  Random,
} from "@vela/services";
import {
  ConfigError,
  checkAdminConfig,
  type Environment,
  readAiProvider,
  readConfig,
  readLineConfig,
  readMediaStorage,
  requireVar,
  secret,
} from "./config.ts";
import type { AdminEnv, PilotEnv } from "./env.ts";
import { createHeartbeat } from "./heartbeat.ts";
import type { PrivacyNotices } from "./notices.ts";
import { createRandom } from "./random.ts";

/** Built ports and the connection they hold; `close()` belongs in `ctx.waitUntil`. */
export interface Handle<D> {
  readonly deps: D;
  close(): Promise<void>;
}

export type DepsHandle = Handle<Deps>;

/**
 * The ports `packages/services/src/admin.ts` reaches for, and no others: the database and the
 * clock; the logger; the outbound queue, through which a weekly read, and a new invite link, reach
 * organisers; the member scheduler, which setting or ending an away period, a departure, a death,
 * and a deletion wake or clear; the AI, which translates a sent weekly read for her; and, for
 * `create_invite`, invite tokens and the bot the link opens. Anything else (channels, media,
 * speech-to-text, the heartbeat, the other queues, the rest of services' `Config`) the admin Worker
 * has no binding or secret for, so it is not here to call.
 */
export interface AdminDeps {
  readonly db: VelaDatabase;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly queues: { readonly outbound: JobQueue<OutboundJob> };
  readonly scheduler: MemberSchedulerPort;
  readonly ai: Ai;
  readonly random: Random;
  /** The pilot Worker's bot in this environment, `Config.telegramBotUsername` for services. */
  readonly telegramBotUsername: string;
}

export type AdminDepsHandle = Handle<AdminDeps>;

export interface DepsOptions {
  /**
   * Replaces the scheduler port. The Durable Object passes one that sets its own alarm directly:
   * calling itself over RPC from inside its own handler would wait on a lock it already holds.
   */
  readonly scheduler?: MemberSchedulerPort;
  /** Reuses the registry the webhook route already built to verify and parse the request. */
  readonly channels?: ChannelRegistry;
}

/**
 * One JSON line per event, which is what Workers Logs indexes. Only the flat, content-free fields
 * services pass: a value that cannot be serialised is dropped rather than risking a half-written
 * line, and nothing here ever formats a message body.
 */
export function createLogger(env: { readonly ENVIRONMENT: string }): Logger {
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

const clock: Clock = { now: () => new Date() };

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

/**
 * The scheduler as the rest of both Workers sees it: one Durable Object per member id. In the admin
 * Worker the namespace is the pilot Worker's class, bound by `script_name`.
 */
export function createSchedulerPort(env: Pick<PilotEnv, "MEMBER_SCHEDULER">): MemberSchedulerPort {
  return {
    async wakeAt(memberId, at) {
      const stub = env.MEMBER_SCHEDULER.get(env.MEMBER_SCHEDULER.idFromName(memberId));
      await stub.wakeAt(memberId, at);
    },
  };
}

/**
 * The channels the pilot Worker speaks. Telegram always: the founder's admin conversation is there
 * (ADR-21). LINE only where `LINE_CHANNEL` is "on", built the first time it is asked for, so an
 * environment without LINE reads none of its secrets; asked for where it is off, it is refused by
 * the variable that turns it on. The rest are not wired.
 */
export function createChannels(env: PilotEnv): ChannelRegistry {
  const telegram = createTelegramAdapter({
    botToken: secret(env, "TELEGRAM_BOT_TOKEN"),
    webhookSecret: secret(env, "TELEGRAM_WEBHOOK_SECRET"),
    botUsername: requireVar(env, "TELEGRAM_BOT_USERNAME"),
  });
  let line: ChannelAdapter | null = null;
  return {
    get(channel: Channel) {
      if (channel === "telegram") {
        return telegram;
      }
      if (channel === "line") {
        line ??= createLineChannel(env);
        return line;
      }
      throw new Error(`no adapter is wired for the ${channel} channel`);
    },
  };
}

function createLineChannel(env: PilotEnv): ChannelAdapter {
  const config = readLineConfig(env);
  if (config === null) {
    throw new ConfigError(
      "LINE_CHANNEL",
      "LINE is off in this environment: LINE_CHANNEL is off in wrangler.jsonc",
    );
  }
  return createLineAdapter({
    channelSecret: config.channelSecret,
    channelAccessToken: config.channelAccessToken,
  });
}

/** Whether a Worker start has said yet that a switch is off. */
export interface OffNotice {
  said: boolean;
}

/**
 * This isolate's notices, one per switch. An isolate is one start of the Worker, and deps are
 * built for every invocation, so kept at module scope each line is written once per start, not
 * once per request.
 */
const thisStart: { readonly ai: OffNotice; readonly media: OffNotice } = {
  ai: { said: false },
  media: { said: false },
};

/**
 * What AI off leaves out, in the words of the `ai_off` line. The header of wrangler.jsonc, which is
 * where wrangler.admin.jsonc sends a reader for what "off" means, repeats it word for word, and
 * `src/wrangler-config.test.ts` holds the two together.
 */
export const AI_OFF_EFFECTS =
  "answers get no summary, flag check, or translation, questions no chips, weekly read drafts no lines, and a sent weekly read no translation for her";

/**
 * The AI port `AI_PROVIDER` names (decision X, 2026-09-18). "anthropic" is Claude, and only then is
 * `ANTHROPIC_API_KEY` read, and required. "off" calls no provider at all (`createOffAi`), and the
 * Worker says so once per start, since every AI step then quietly takes its safe default.
 */
export function createAiPort(
  env: { readonly AI_PROVIDER?: string; readonly ANTHROPIC_API_KEY?: string },
  environment: Environment,
  configFile: string,
  logger: Logger,
  notice: OffNotice = thisStart.ai,
): Ai {
  if (readAiProvider(env, environment, configFile) === "anthropic") {
    return createClaudeAi({ apiKey: secret(env, "ANTHROPIC_API_KEY") });
  }
  if (!notice.said) {
    notice.said = true;
    logger.warn("ai_off", {
      detail: `AI_PROVIDER is off: no AI provider is called, so ${AI_OFF_EFFECTS}`,
    });
  }
  return createOffAi();
}

/**
 * What media storage off leaves out, in the words of the `media_storage_off` line. The header of
 * wrangler.jsonc repeats it word for word, and `src/wrangler-config.test.ts` holds the two
 * together.
 */
export const MEDIA_OFF_EFFECTS =
  "nothing she sends is copied into Vela's own storage: the light, the family group, and the transcript of a voice answer are unchanged, because Telegram carries the file and the pipeline fetches it from there, but each media row keeps only what Telegram said about the file, its id, its type and its size, with no storage key and no copy of the file itself";

/**
 * The media port `MEDIA_STORAGE` names (decision M, 2026-09-20). "r2" stores media in the bucket
 * `MEDIA_BUCKET` binds, and refuses to start without that binding, since every stored object would
 * otherwise be lost silently. "off" binds no bucket and returns no port at all, and the Worker says
 * so once per start, since every media path then quietly keeps no copy.
 */
export function createMediaPort(
  env: { readonly MEDIA_STORAGE?: string; readonly MEDIA_BUCKET?: R2Bucket },
  environment: Environment,
  configFile: string,
  logger: Logger,
  notice: OffNotice = thisStart.media,
): MediaStore | null {
  if (readMediaStorage(env, environment, configFile) === "r2") {
    const bucket = env.MEDIA_BUCKET;
    if (bucket === undefined) {
      throw new ConfigError(
        "MEDIA_BUCKET",
        `MEDIA_STORAGE is r2 but no bucket is bound: add the environment's r2_buckets binding in ${configFile}`,
      );
    }
    return createMediaStore(bucket);
  }
  if (!notice.said) {
    notice.said = true;
    logger.warn("media_storage_off", {
      detail: `MEDIA_STORAGE is off: ${MEDIA_OFF_EFFECTS}`,
    });
  }
  return null;
}

/**
 * The pilot Worker's deps for one invocation. Everything that can fail on configuration, the
 * notices included, fails before the database connection is opened, so a misconfigured Worker
 * never leaks one.
 */
export async function buildDeps(
  env: PilotEnv,
  notices: PrivacyNotices,
  options: DepsOptions = {},
): Promise<DepsHandle> {
  const config = readConfig(env, notices);
  const logger = createLogger(env);
  const channels = options.channels ?? createChannels(env);
  const ai = createAiPort(env, config.environment, "wrangler.jsonc", logger);
  const stt = createDeepgramStt({ apiKey: secret(env, "DEEPGRAM_API_KEY") });
  const media = createMediaPort(env, config.environment, "wrangler.jsonc", logger);

  const connection = await connectDatabase(env.HYPERDRIVE.connectionString);
  return {
    deps: {
      db: connection.db,
      clock,
      logger,
      random: createRandom(),
      queues: {
        outbound: createJobQueue(env.OUTBOUND_QUEUE),
        media: createJobQueue(env.MEDIA_QUEUE),
        understand: createJobQueue(env.UNDERSTAND_QUEUE),
      },
      scheduler: options.scheduler ?? createSchedulerPort(env),
      media,
      channels,
      ai,
      stt,
      heartbeat: createHeartbeat(env, logger),
      config,
    },
    close: () => connection.close(),
  };
}

/** The admin Worker's ports for one request, checked the same way before a connection opens. */
export async function buildAdminDeps(env: AdminEnv): Promise<AdminDepsHandle> {
  const environment = checkAdminConfig(env);
  const logger = createLogger(env);
  const ai = createAiPort(env, environment, "wrangler.admin.jsonc", logger);
  const telegramBotUsername = requireVar(env, "TELEGRAM_BOT_USERNAME", "wrangler.admin.jsonc");

  const connection = await connectDatabase(env.HYPERDRIVE.connectionString);
  return {
    deps: {
      db: connection.db,
      clock,
      logger,
      queues: { outbound: createJobQueue(env.OUTBOUND_QUEUE) },
      scheduler: createSchedulerPort(env),
      ai,
      random: createRandom(),
      telegramBotUsername,
    },
    close: () => connection.close(),
  };
}
