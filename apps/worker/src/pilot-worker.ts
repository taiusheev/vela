/**
 * The pilot Worker's handlers (code design §9, H1): HTTP, where the API under /v1 goes to
 * `PilotRuntime.api` (ADR-29) and everything else to the Hono app (the webhooks, the media LINE
 * fetches, the privacy notices, the health check), the four queues, and cron. Everything they drive
 * arrives through `PilotRuntime`, so the same handlers run in a test against fakes. The entry module
 * that wrangler deploys is `index.ts`.
 */
import { InboundEvent } from "@vela/contracts";
import type { DeadLetterJobType } from "@vela/services";
import {
  type Deps,
  errorLabel,
  type MediaJob,
  type OutboundJob,
  type UnderstandJob,
} from "@vela/services";
import { createApp } from "./app.ts";
import { readApiSwitch, readLineSwitch } from "./config.ts";
import { createLogger, type DepsHandle } from "./deps.ts";
import type { InboundJob, PilotEnv } from "./env.ts";
import type { PilotRuntime, PilotServices } from "./runtime.ts";
import { publicHostAnswer } from "./site-host.ts";

/**
 * Reconciliation: pending send effects, stranded sends, late ticks, the understanding re-run and the
 * founder's note, then the heartbeat (flows §3.15), then LINE's quota where LINE is on (05 §5.10).
 * Every 15 minutes, not 5 (W3). Neon's free plan allows 100 compute hours a project a month and
 * suspends the database when they are spent; it scales to zero after 5 idle minutes
 * (neon.com/pricing, checked 2026-09-17). A run every 5 minutes would keep it awake all month: about
 * 180 compute hours at 0.25 CU. A run every 15 minutes keeps it awake about 5 minutes in 15, about
 * 60 compute hours a month, before the members' own alarms, webhooks, and jobs, each of which wakes
 * it for 5 minutes more, so the founder watches Neon's usage and moves to a paid plan before
 * families beyond the dogfooding week if it nears the limit. The Durable Object alarms still send
 * each arrival at its minute.
 */
export const RECONCILE_CRON = "*/15 * * * *";
/**
 * Nightly: yesterday's metrics per kept-light member, the retention rules, then the suggestions for
 * each kept-light member's next three days, so every zone's tomorrow has one long before its day.
 */
export const NIGHTLY_CRON = "20 3 * * *";

type WorkerJob = OutboundJob | MediaJob | UnderstandJob | InboundJob;

/**
 * The seconds an inbound job waits after its `attempts`-th failed attempt: 30, doubling up to 10
 * minutes (05 §5.10). LINE was answered 200 when the job was queued and redelivers nothing, and no
 * row holds the events yet, so reconcile cannot drive them again as it does a send: the job is the
 * only copy of them, her answer among them. `vela-inbound`'s `max_retries` keeps it trying for at
 * least T_quiet's cap, the latest quiet deadline after a delivery (wrangler-config.test.ts pins
 * the two together), so an outage that ends before her deadline cannot turn her answer into a
 * false quiet notice. The first retry comes while the reply token may still be fresh; the cap
 * bounds how long her answer waits once the outage ends.
 */
export function inboundRetryDelaySeconds(attempts: number): number {
  const first = 30;
  const cap = 600;
  return Math.min(cap, first * 2 ** Math.max(0, attempts - 1));
}

/**
 * A retry for a message whose job did not finish. Every other job keeps its queue's `retry_delay`:
 * a row in the database stands behind it, which reconcile drives again once its job is lost.
 */
function retryLater(message: Message<unknown>, job: WorkerJob | null): void {
  if (job?.type === "handle_inbound") {
    message.retry({ delaySeconds: inboundRetryDelaySeconds(message.attempts) });
    return;
  }
  message.retry();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * A queue message is only trusted as far as its shape: an unreadable body is never a job. An
 * inbound job is read only when every event in it is one the contract accepts, since services
 * route on the events alone.
 */
function parseJob(body: unknown): WorkerJob | null {
  const record = asRecord(body);
  if (record === null) {
    return null;
  }
  const { type, outboundId, answerId, mediaId, events } = record;
  if (type === "handle_inbound") {
    const parsed = InboundEvent.array().safeParse(events);
    return parsed.success ? { type, events: parsed.data } : null;
  }
  if (type === "deliver" && typeof outboundId === "string") {
    return { type, outboundId };
  }
  if (type === "ingest_answer_media" && typeof answerId === "string") {
    return { type, answerId };
  }
  if (type === "understand_answer" && typeof answerId === "string") {
    return { type, answerId };
  }
  if (type === "ingest_exchange_media" && typeof mediaId === "string") {
    return { type, mediaId };
  }
  return null;
}

/** The environment's dead-letter queue: `vela-dead-letter`, `-staging` or `-production`. */
export function isDeadLetterQueue(name: string): boolean {
  return name === "vela-dead-letter" || name.startsWith("vela-dead-letter-");
}

/** Where a dead job goes when the founder asks for it again: the queue it came from. */
function queueForJob(env: PilotEnv, type: DeadLetterJobType): Queue<unknown> | undefined {
  switch (type) {
    case "deliver":
      return env.OUTBOUND_QUEUE as Queue<unknown>;
    case "ingest_answer_media":
    case "ingest_exchange_media":
      return env.MEDIA_QUEUE as Queue<unknown>;
    case "understand_answer":
      return env.UNDERSTAND_QUEUE as Queue<unknown>;
    case "handle_inbound":
      return env.INBOUND_QUEUE as Queue<unknown> | undefined;
  }
}

/**
 * Technical plan 2.7: the dead jobs the founder asked for are sent again once, each to the queue
 * it came from. A job whose queue is not bound here, or whose send fails, is given back so the
 * next reconcile tries it again; neither failure fails the reconcile.
 */
async function replayDeadLetters(
  services: PilotServices,
  deps: Deps,
  env: PilotEnv,
): Promise<void> {
  for (const row of await services.claimDeadLetterReplays(deps)) {
    const queue = queueForJob(env, row.jobType);
    try {
      if (queue === undefined) throw new Error("queue_not_bound");
      await queue.send(row.job);
      deps.logger.info("dead_letter_replayed", { id: row.id, type: row.jobType });
    } catch (error) {
      deps.logger.error("dead_letter_replay_failed", {
        id: row.id,
        type: row.jobType,
        error: errorLabel(error),
      });
      await services.releaseDeadLetterReplay(deps, row.id);
    }
  }
}

/**
 * The nightly jobs after the metrics, each run whatever the one before it did, since neither needs
 * the other: retention, then tomorrow's suggestions, only where the API that shows them is served
 * (ADR-29). Production's API is off and its database has none of the API's tables, so it writes no
 * suggestion and never asks the model to draft one. A job that throws is logged by its label, and
 * the first failure fails the run once every job has had its turn.
 */
async function runNightlyJobs(services: PilotServices, deps: Deps, env: PilotEnv): Promise<void> {
  const jobs: [job: string, run: () => Promise<unknown>][] = [
    ["applyRetention", () => services.applyRetention(deps)],
    ["opsDigest", () => services.opsDigest(deps)],
    [
      "writeSuggestions",
      async () => {
        if (readApiSwitch(env) === "on") {
          await services.writeSuggestions(deps);
        }
      },
    ],
  ];
  const failures: unknown[] = [];
  for (const [job, run] of jobs) {
    try {
      await run();
    } catch (error) {
      deps.logger.error("nightly_job_failed", { job, error: errorLabel(error) });
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
}

/**
 * LINE's quota, read after reconcile where LINE is on and kept for the admin overview and the
 * founder's alerts (05 §5.10 and §6). In its own try: reconcile's work is done by then, so a LINE
 * outage, or a reading services refuse, is logged by its label and never fails the run.
 */
async function recordLineQuota(services: PilotServices, deps: Deps, env: PilotEnv): Promise<void> {
  if (readLineSwitch(env, "wrangler.jsonc") === "off") {
    return;
  }
  try {
    const line = deps.channels.get("line");
    if (line.quota === undefined) {
      throw new Error("the LINE adapter reads no quota");
    }
    await services.recordChannelQuota(deps, "line", await line.quota());
  } catch (error) {
    deps.logger.error("line_quota_failed", { error: errorLabel(error) });
  }
}

async function runJob(services: PilotServices, deps: Deps, job: WorkerJob): Promise<void> {
  switch (job.type) {
    case "deliver":
      await services.deliverOutbound(deps, job.outboundId);
      return;
    case "ingest_answer_media":
      await services.ingestAnswerMedia(deps, job.answerId);
      return;
    case "understand_answer":
      await services.understandAnswer(deps, job.answerId);
      return;
    case "handle_inbound":
      // One webhook's events in the order LINE sent them. A retry handles them all again, which
      // changes nothing twice: every handler behind handleInbound is idempotent (04 §5).
      await services.handleInbound(deps, job.events);
      return;
    case "ingest_exchange_media":
      await services.ingestExchangeMedia(deps, job.mediaId);
      return;
  }
}

/**
 * The handlers, with none of them optional: `ExportedHandler` makes every one of them so, and a
 * test that called a handler which happened to be missing would pass without running anything.
 */
export interface VelaWorker extends ExportedHandler<PilotEnv> {
  fetch(request: Request, env: PilotEnv, ctx: ExecutionContext): Promise<Response>;
  queue(batch: MessageBatch<unknown>, env: PilotEnv, ctx: ExecutionContext): Promise<void>;
  scheduled(controller: ScheduledController, env: PilotEnv, ctx: ExecutionContext): Promise<void>;
}

/**
 * The API's paths (ADR-29): /v1 and everything under it, and nothing that merely starts with "v1".
 */
export function isApiPath(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

/**
 * A batch from the dead-letter queue (technical plan 2.7): each job that failed every retry is
 * kept, sealed, for the founder to see and send again, and acked once kept. A job that cannot be
 * kept yet (the database is down) is retried in five minutes; the consumer's own `max_retries`
 * outlasts a long outage. An unreadable body is logged and acked, as on every queue.
 */
async function keepDeadJobs(
  services: PilotServices,
  deps: Deps,
  batch: MessageBatch<unknown>,
): Promise<void> {
  for (const message of batch.messages) {
    const job = parseJob(message.body);
    if (job === null) {
      deps.logger.error("queue_message_unreadable", { queue: batch.queue, messageId: message.id });
      message.ack();
      continue;
    }
    try {
      await services.keepDeadLetter(deps, {
        messageId: message.id,
        jobType: job.type,
        job: message.body as Record<string, unknown>,
      });
      message.ack();
    } catch (error) {
      deps.logger.error("dead_letter_keep_failed", {
        messageId: message.id,
        type: job.type,
        error: errorLabel(error),
      });
      message.retry({ delaySeconds: 300 });
    }
  }
}

export function createWorker(runtime: PilotRuntime): VelaWorker {
  const app = createApp(runtime);
  return {
    /**
     * The API is handed its paths before the Hono app sees them, with its own configuration check
     * and its own JSON errors, so neither app's refusal or failure reaches the other's routes.
     */
    async fetch(request, env, ctx) {
      // The public website's own address answers only the website (`site-host.ts`).
      const publicAnswer = publicHostAnswer(request, env);
      if (publicAnswer !== null) return publicAnswer;
      if (isApiPath(new URL(request.url).pathname)) {
        return runtime.api(request, env);
      }
      return app.fetch(request, env, ctx);
    },

    /**
     * One batch, one set of deps. A message is acked when its job returns and retried when it
     * throws, so one failing job never replays the ones beside it; the queue's `max_retries` then
     * parks it in the dead-letter queue. Deps that cannot be built ran nothing, so every message is
     * retried, each on its job's schedule. Throwing instead would retry them all at the queue's
     * `retry_delay` and have the runtime log the error's message, which for a failed query lists
     * the family's words; the line here carries the label alone, through a logger built from `env`
     * because the deps are what failed, as in `scheduled`.
     */
    async queue(batch, env, ctx) {
      let handle: DepsHandle;
      try {
        handle = await runtime.createDeps(env);
      } catch (error) {
        createLogger(env).error("queue_deps_failed", {
          queue: batch.queue,
          error: errorLabel(error),
        });
        for (const message of batch.messages) {
          retryLater(message, parseJob(message.body));
        }
        return;
      }
      try {
        if (isDeadLetterQueue(batch.queue)) {
          await keepDeadJobs(runtime.services, handle.deps, batch);
          return;
        }
        for (const message of batch.messages) {
          const job = parseJob(message.body);
          if (job === null) {
            handle.deps.logger.error("queue_message_unreadable", {
              queue: batch.queue,
              messageId: message.id,
            });
            message.ack();
            continue;
          }
          try {
            await runJob(runtime.services, handle.deps, job);
            message.ack();
          } catch (error) {
            // The label, never the message: a failed send's error can repeat what was sent, and a
            // failed query's lists the family's words among its parameters.
            handle.deps.logger.error("queue_job_failed", {
              queue: batch.queue,
              messageId: message.id,
              type: job.type,
              attempts: message.attempts,
              error: errorLabel(error),
            });
            retryLater(message, job);
          }
        }
      } finally {
        ctx.waitUntil(handle.close());
      }
    },

    /**
     * A run that throws is logged by its label and fails with an error that carries only the label:
     * the runtime logs an uncaught error with its message, and a failed query's message lists the
     * family's words among its parameters. Deps are built inside, so a misconfigured Worker's run
     * reads `ConfigError:<variable>` too; the line goes through a logger built from `env`, because
     * the deps may be what failed.
     */
    async scheduled(controller, env, ctx) {
      let handle: DepsHandle | null = null;
      try {
        handle = await runtime.createDeps(env);
        if (controller.cron === RECONCILE_CRON) {
          await runtime.services.reconcile(handle.deps);
          await recordLineQuota(runtime.services, handle.deps, env);
          // An alert that cannot be sent must never fail the reconcile that keeps mornings going.
          try {
            await runtime.services.opsAlerts(handle.deps);
          } catch (error) {
            handle.deps.logger.error("ops_alerts_failed", { error: errorLabel(error) });
          }
          try {
            await replayDeadLetters(runtime.services, handle.deps, env);
          } catch (error) {
            handle.deps.logger.error("dead_letter_replays_failed", { error: errorLabel(error) });
          }
        } else if (controller.cron === NIGHTLY_CRON) {
          await runtime.services.rollupMetrics(handle.deps);
          await runNightlyJobs(runtime.services, handle.deps, env);
        } else {
          handle.deps.logger.error("cron_unknown", { cron: controller.cron });
        }
      } catch (error) {
        const label = errorLabel(error);
        createLogger(env).error("cron_failed", { cron: controller.cron, error: label });
        throw new Error(label);
      } finally {
        if (handle !== null) {
          ctx.waitUntil(handle.close());
        }
      }
    },
  };
}
