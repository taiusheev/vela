/**
 * Everything a services test runs against (code design §8): one PGlite with the real migrations,
 * a clock that moves only when told, in-memory queues the test drains, a recording Telegram fake
 * with failure injection, the fake AI and speech-to-text, a scheduler that remembers wakes, an
 * in-memory media store, and a heartbeat that counts. One harness per test file; `reset` empties
 * the database and every recorder between tests.
 */
import {
  type Ai,
  createFakeAi,
  createFakeStt,
  type FakeAi,
  type Stt,
  type Transcription,
} from "@vela/ai";
import { LANGS, type Lang } from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";
import { createTestDatabase } from "@vela/db/testing";
import type { Config, Deps, MediaJob, OutboundJob, UnderstandJob } from "../deps.ts";
import { createFakeTelegram, type FakeTelegram } from "./fake-telegram.ts";
import {
  createFakeClock,
  createFakeHeartbeat,
  createFakeLogger,
  createFakeMediaStore,
  createFakeQueue,
  createFakeRandom,
  createFakeScheduler,
  type FakeClock,
  type FakeHeartbeat,
  type FakeLogger,
  type FakeMediaStore,
  type FakeQueue,
  type FakeRandom,
  type FakeScheduler,
  type QueuedJob,
} from "./fakes.ts";

export interface JobHandlers {
  outbound?: (job: OutboundJob) => Promise<unknown>;
  media?: (job: MediaJob) => Promise<unknown>;
  understand?: (job: UnderstandJob) => Promise<unknown>;
}

export interface FakeQueues {
  readonly outbound: FakeQueue<OutboundJob>;
  readonly media: FakeQueue<MediaJob>;
  readonly understand: FakeQueue<UnderstandJob>;
}

export interface HarnessOptions {
  /** The clock's start; 08:00 in Taipei on 14 September 2026 by default. */
  now?: Date | string;
  config?: Partial<Config>;
  /** Overrides for the fake AI, kept across resets. */
  ai?: Partial<Ai>;
  stt?: Partial<Omit<Transcription, "record">>;
}

export interface Harness {
  readonly deps: Deps;
  readonly db: VelaDatabase;
  readonly clock: FakeClock;
  readonly logger: FakeLogger;
  readonly random: FakeRandom;
  readonly telegram: FakeTelegram;
  /** The current fake AI; a new one after each `reset`, so its call list starts empty. */
  readonly ai: FakeAi;
  readonly stt: Stt;
  readonly queues: FakeQueues;
  readonly scheduler: FakeScheduler;
  readonly media: FakeMediaStore;
  readonly heartbeat: FakeHeartbeat;
  readonly config: Config;
  /**
   * Runs queued jobs through the handlers until none the handlers cover remain, moving the clock
   * forward to each delayed job's due time. Jobs of a queue without a handler stay queued. Returns
   * how many jobs ran.
   */
  run(handlers: JobHandlers): Promise<number>;
  /** Like `run`, but only jobs already due at the current time; the clock does not move. */
  runDue(handlers: JobHandlers): Promise<number>;
  /** Empties every table and recorder and puts the clock back to its start. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export const HARNESS_START = new Date("2026-09-14T00:00:00.000Z");

/** A flow that keeps enqueuing itself would otherwise run forever. */
const MAX_JOBS_PER_RUN = 10_000;

const DEFAULT_CONFIG: Config = {
  telegramBotUsername: "VelaLightBot",
  adminConversationId: "9001",
  environment: "development",
  regions: ["apac"],
  publicBaseUrl: "https://vela.test",
  privacyNoticeUrls: Object.fromEntries(
    LANGS.map((lang: Lang) => [
      lang,
      lang === "zh-TW" ? "https://vela.test/privacy/zh-TW" : "https://vela.test/privacy/en",
    ]),
  ) as Record<Lang, string>,
  privacyNoticeVersion: "privacy-notice.v1",
};

interface Candidate {
  readonly dueAt: Date;
  readonly sequence: number;
  readonly run: () => Promise<unknown>;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const start = options.now === undefined ? HARNESS_START : new Date(options.now);
  const testDatabase = await createTestDatabase();
  const clock = createFakeClock(start);
  const logger = createFakeLogger();
  const random = createFakeRandom();
  const telegram = createFakeTelegram(clock);
  const scheduler = createFakeScheduler();
  const media = createFakeMediaStore();
  const heartbeat = createFakeHeartbeat();
  const stt = createFakeStt(options.stt);
  const config: Config = { ...DEFAULT_CONFIG, ...options.config };
  let sequence = 0;
  const nextSequence = (): number => {
    sequence += 1;
    return sequence;
  };
  const queues: FakeQueues = {
    outbound: createFakeQueue<OutboundJob>(clock, nextSequence),
    media: createFakeQueue<MediaJob>(clock, nextSequence),
    understand: createFakeQueue<UnderstandJob>(clock, nextSequence),
  };
  let ai = createFakeAi(options.ai);

  const deps: Deps = {
    db: testDatabase.db,
    clock,
    logger,
    random,
    queues,
    scheduler,
    media,
    channels: {
      get: (channel) => {
        if (channel !== "telegram") {
          throw new Error(`the harness has no adapter for ${channel}`);
        }
        return telegram;
      },
    },
    ai,
    stt,
    heartbeat,
    config,
  };

  function candidates(handlers: JobHandlers): Candidate[] {
    const found: Candidate[] = [];
    const collect = <J>(
      queue: FakeQueue<J>,
      handler: ((job: J) => Promise<unknown>) | undefined,
    ) => {
      if (handler === undefined) {
        return;
      }
      for (const entry of queue.pending) {
        found.push({
          dueAt: entry.dueAt,
          sequence: entry.sequence,
          run: () => {
            queue.take(entry as QueuedJob<J>);
            return handler(entry.job);
          },
        });
      }
    };
    collect(queues.outbound, handlers.outbound);
    collect(queues.media, handlers.media);
    collect(queues.understand, handlers.understand);
    return found;
  }

  async function drain(handlers: JobHandlers, advance: boolean): Promise<number> {
    let processed = 0;
    while (processed < MAX_JOBS_PER_RUN) {
      const next = candidates(handlers).sort(
        (a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.sequence - b.sequence,
      )[0];
      if (next === undefined) {
        return processed;
      }
      if (next.dueAt.getTime() > clock.now().getTime()) {
        if (!advance) {
          return processed;
        }
        clock.set(next.dueAt);
      }
      await next.run();
      processed += 1;
    }
    throw new Error(
      `more than ${MAX_JOBS_PER_RUN} jobs ran in one drain: a flow re-enqueues itself`,
    );
  }

  return {
    deps,
    db: testDatabase.db,
    clock,
    logger,
    random,
    telegram,
    get ai() {
      return ai;
    },
    stt,
    queues,
    scheduler,
    media,
    heartbeat,
    config,
    run: (handlers) => drain(handlers, true),
    runDue: (handlers) => drain(handlers, false),
    reset: async () => {
      await testDatabase.reset();
      clock.set(start);
      logger.clear();
      random.reset();
      telegram.reset();
      scheduler.clear();
      media.clear();
      heartbeat.clear();
      queues.outbound.clear();
      queues.media.clear();
      queues.understand.clear();
      ai = createFakeAi(options.ai);
      deps.ai = ai;
    },
    close: () => testDatabase.close(),
  };
}
