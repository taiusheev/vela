import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ConfigError } from "./deps.ts";
import { createWorker, NIGHTLY_CRON, RECONCILE_CRON } from "./index.ts";
import type { WorkerRuntime } from "./runtime.ts";
import {
  argsOf,
  consoleLinesDuring,
  createFakeRuntime,
  FAILED_QUERY_LABEL,
  FAILED_QUERY_WORDS,
  failedQueryFixture,
  namesOf,
  testEnv,
} from "./testing/fakes.ts";

interface BatchOutcome {
  readonly batch: MessageBatch<unknown>;
  readonly acked: string[];
  readonly retried: string[];
}

/** One batch of queue messages, with what the handler did to each one recorded. */
function batchOf(queue: string, bodies: readonly unknown[]): BatchOutcome {
  const acked: string[] = [];
  const retried: string[] = [];
  const messages = bodies.map((body, index) => {
    const id = `message-${index}`;
    return {
      id,
      timestamp: new Date("2026-09-14T00:00:00.000Z"),
      body,
      attempts: 1,
      ack: () => {
        acked.push(id);
      },
      retry: () => {
        retried.push(id);
      },
    };
  });
  return {
    batch: {
      queue,
      messages,
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      ackAll: () => {
        for (const message of messages) {
          acked.push(message.id);
        }
      },
      retryAll: () => {
        for (const message of messages) {
          retried.push(message.id);
        }
      },
    },
    acked,
    retried,
  };
}

async function runQueue(
  worker: ReturnType<typeof createWorker>,
  outcome: BatchOutcome,
): Promise<void> {
  const ctx = createExecutionContext();
  await worker.queue(outcome.batch, testEnv, ctx);
  await waitOnExecutionContext(ctx);
}

async function runCron(worker: ReturnType<typeof createWorker>, cron: string): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
}

/** Runs a cron that must fail, and returns what it threw once its context has settled. */
async function cronFailure(
  worker: ReturnType<typeof createWorker>,
  cron: string,
): Promise<unknown> {
  const ctx = createExecutionContext();
  try {
    await worker.scheduled(createScheduledController({ cron }), testEnv, ctx);
  } catch (error) {
    return error;
  } finally {
    await waitOnExecutionContext(ctx);
  }
  throw new Error("the cron run did not fail");
}

describe("the queue consumer", () => {
  it("sends each job to its service and acks it", async () => {
    const fake = createFakeRuntime();
    const outcome = batchOf("vela-outbound", [
      { type: "deliver", outboundId: "outbound-1" },
      { type: "ingest_answer_media", answerId: "answer-1" },
      { type: "understand_answer", answerId: "answer-2" },
    ]);

    await runQueue(createWorker(fake.runtime), outcome);

    expect(namesOf(fake.calls)).toEqual([
      "deliverOutbound",
      "ingestAnswerMedia",
      "understandAnswer",
    ]);
    expect(argsOf(fake.calls, "deliverOutbound")).toEqual([["outbound-1"]]);
    expect(outcome.acked).toEqual(["message-0", "message-1", "message-2"]);
    expect(outcome.retried).toEqual([]);
  });

  it("retries only the message whose job threw", async () => {
    const fake = createFakeRuntime({
      services: {
        understandAnswer: async () => {
          throw new Error("the model is away");
        },
      },
    });
    const outcome = batchOf("vela-understand", [
      { type: "understand_answer", answerId: "answer-1" },
      { type: "deliver", outboundId: "outbound-1" },
    ]);

    await runQueue(createWorker(fake.runtime), outcome);

    expect(outcome.retried).toEqual(["message-0"]);
    expect(outcome.acked).toEqual(["message-1"]);
  });

  it("logs a failed job by its error label, never by the message that carries the family's words", async () => {
    const fake = createFakeRuntime({
      services: {
        understandAnswer: async () => {
          throw failedQueryFixture();
        },
      },
    });
    const outcome = batchOf("vela-understand", [
      { type: "understand_answer", answerId: "answer-1" },
    ]);

    await runQueue(createWorker(fake.runtime), outcome);

    expect(fake.logs).toEqual([
      {
        level: "error",
        event: "queue_job_failed",
        fields: {
          queue: "vela-understand",
          messageId: "message-0",
          type: "understand_answer",
          attempts: 1,
          error: FAILED_QUERY_LABEL,
        },
      },
    ]);
    expect(JSON.stringify(fake.logs)).not.toContain(FAILED_QUERY_WORDS);
  });

  it("acks a message it cannot read, which no retry could fix", async () => {
    const fake = createFakeRuntime();
    const outcome = batchOf("vela-outbound", [{ type: "deliver" }, "not a job"]);

    await runQueue(createWorker(fake.runtime), outcome);

    expect(namesOf(fake.calls)).toEqual([]);
    expect(outcome.acked).toEqual(["message-0", "message-1"]);
    expect(outcome.retried).toEqual([]);
  });

  it("closes its deps once for the whole batch", async () => {
    const fake = createFakeRuntime();
    const outcome = batchOf("vela-outbound", [
      { type: "deliver", outboundId: "a" },
      { type: "deliver", outboundId: "b" },
    ]);

    await runQueue(createWorker(fake.runtime), outcome);

    expect(fake.built()).toBe(1);
    expect(fake.closed()).toBe(1);
  });
});

describe("cron", () => {
  it("reconciles every five minutes", async () => {
    const fake = createFakeRuntime();

    await runCron(createWorker(fake.runtime), RECONCILE_CRON);

    expect(namesOf(fake.calls)).toEqual(["reconcile"]);
    expect(fake.closed()).toBe(1);
  });

  it("rolls up yesterday and applies retention nightly, in that order", async () => {
    const fake = createFakeRuntime();

    await runCron(createWorker(fake.runtime), NIGHTLY_CRON);

    expect(namesOf(fake.calls)).toEqual(["rollupMetrics", "applyRetention"]);
  });

  it("logs a failed run by its error label, and fails it with nothing but the label", async () => {
    const fake = createFakeRuntime({
      services: {
        reconcile: async () => {
          throw failedQueryFixture();
        },
      },
    });

    const { result: failure, lines } = await consoleLinesDuring(() =>
      cronFailure(createWorker(fake.runtime), RECONCILE_CRON),
    );

    expect(lines).toEqual([
      {
        level: "error",
        event: "cron_failed",
        environment: testEnv.ENVIRONMENT,
        cron: RECONCILE_CRON,
        error: FAILED_QUERY_LABEL,
      },
    ]);
    // What the runtime records for the failed run: the label, and no cause to reach the words by.
    expect(failure).toEqual(new Error(FAILED_QUERY_LABEL));
    expect(JSON.stringify(lines)).not.toContain(FAILED_QUERY_WORDS);
    expect(fake.closed()).toBe(1);
  });

  it("logs a run whose deps could not be built by the variable to fix", async () => {
    const fake = createFakeRuntime();
    const runtime: WorkerRuntime = {
      ...fake.runtime,
      createDeps: async () => {
        throw new ConfigError("PUBLIC_BASE_URL", "PUBLIC_BASE_URL still holds a placeholder");
      },
    };

    const { result: failure, lines } = await consoleLinesDuring(() =>
      cronFailure(createWorker(runtime), NIGHTLY_CRON),
    );

    expect(lines).toEqual([
      {
        level: "error",
        event: "cron_failed",
        environment: testEnv.ENVIRONMENT,
        cron: NIGHTLY_CRON,
        error: "ConfigError:PUBLIC_BASE_URL",
      },
    ]);
    expect(failure).toEqual(new Error("ConfigError:PUBLIC_BASE_URL"));
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("runs nothing for a cron it does not know", async () => {
    const fake = createFakeRuntime();

    await runCron(createWorker(fake.runtime), "0 0 1 1 *");

    expect(namesOf(fake.calls)).toEqual([]);
  });
});
