/**
 * The Worker itself (code design §9): HTTP through the Hono app, the three queues, cron, and the
 * `MemberScheduler` Durable Object. Everything it drives arrives through `WorkerRuntime`, so the
 * same handlers run in a test against fakes.
 */
import {
  type Deps,
  errorLabel,
  type MediaJob,
  type OutboundJob,
  type UnderstandJob,
} from "@vela/services";
import { createApp } from "./app.ts";
import { createLogger, type DepsHandle } from "./deps.ts";
import type { Env } from "./env.ts";
import { productionRuntime, type WorkerRuntime, type WorkerServices } from "./runtime.ts";

export { MemberScheduler } from "./scheduler.ts";

/**
 * Reconciliation: pending send effects, stranded sends, late ticks, the understanding re-run and the
 * founder's note, then the heartbeat (flows §3.15).
 */
export const RECONCILE_CRON = "*/5 * * * *";
/** Nightly: yesterday's metrics per kept-light member, then the retention rules. */
export const NIGHTLY_CRON = "20 3 * * *";

type WorkerJob = OutboundJob | MediaJob | UnderstandJob;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** A queue message is only trusted as far as its shape: an unreadable body is never a job. */
function parseJob(body: unknown): WorkerJob | null {
  const record = asRecord(body);
  if (record === null) {
    return null;
  }
  const { type, outboundId, answerId, mediaId } = record;
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

async function runJob(services: WorkerServices, deps: Deps, job: WorkerJob): Promise<void> {
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
    case "ingest_exchange_media":
      // Reserved in the job union; no flow enqueues it and services expose no handler, so a retry
      // could never succeed. It is recorded and acked rather than filling the dead-letter queue.
      deps.logger.warn("queue_job_unhandled", { type: job.type });
      return;
  }
}

/**
 * The handlers, with none of them optional: `ExportedHandler` makes every one of them so, and a
 * test that called a handler which happened to be missing would pass without running anything.
 */
export interface VelaWorker extends ExportedHandler<Env> {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void>;
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
}

export function createWorker(runtime: WorkerRuntime): VelaWorker {
  const app = createApp(runtime);
  return {
    async fetch(request, env, ctx) {
      return app.fetch(request, env, ctx);
    },

    /**
     * One batch, one set of deps. A message is acked when its job returns and retried when it
     * throws, so one failing job never replays the ones beside it; the queue's `max_retries` then
     * parks it in the dead-letter queue.
     */
    async queue(batch, env, ctx) {
      const handle = await runtime.createDeps(env);
      try {
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
            message.retry();
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
        } else if (controller.cron === NIGHTLY_CRON) {
          await runtime.services.rollupMetrics(handle.deps);
          await runtime.services.applyRetention(handle.deps);
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

export default createWorker(productionRuntime);
