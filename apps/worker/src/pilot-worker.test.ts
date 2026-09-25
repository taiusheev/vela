import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApiHandler } from "./api-runtime.ts";
import { ConfigError } from "./config.ts";
import type { PilotEnv } from "./env.ts";
import { createWorker, isApiPath, NIGHTLY_CRON, RECONCILE_CRON } from "./pilot-worker.ts";
import type { PilotRuntime } from "./runtime.ts";
import {
  argsOf,
  consoleLinesDuring,
  createFakePilotRuntime,
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
    const fake = createFakePilotRuntime();
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
    const fake = createFakePilotRuntime({
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
    const fake = createFakePilotRuntime({
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
    const fake = createFakePilotRuntime();
    const outcome = batchOf("vela-outbound", [{ type: "deliver" }, "not a job"]);

    await runQueue(createWorker(fake.runtime), outcome);

    expect(namesOf(fake.calls)).toEqual([]);
    expect(outcome.acked).toEqual(["message-0", "message-1"]);
    expect(outcome.retried).toEqual([]);
  });

  it("closes its deps once for the whole batch", async () => {
    const fake = createFakePilotRuntime();
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
  // Every run wakes Neon, whose free plan suspends a project that spends its monthly compute hours:
  // a run every 5 minutes would keep the database awake all month (W3).
  it("reconciles every 15 minutes", async () => {
    const fake = createFakePilotRuntime();

    expect(RECONCILE_CRON).toBe("*/15 * * * *");
    await runCron(createWorker(fake.runtime), RECONCILE_CRON);

    expect(namesOf(fake.calls)).toEqual(["reconcile"]);
    expect(fake.closed()).toBe(1);
  });

  it("rolls up yesterday and applies retention nightly, in that order", async () => {
    const fake = createFakePilotRuntime();

    await runCron(createWorker(fake.runtime), NIGHTLY_CRON);

    expect(namesOf(fake.calls)).toEqual(["rollupMetrics", "applyRetention"]);
  });

  it("logs a failed run by its error label, and fails it with nothing but the label", async () => {
    const fake = createFakePilotRuntime({
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
    const fake = createFakePilotRuntime();
    const runtime: PilotRuntime = {
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
    const fake = createFakePilotRuntime();

    await runCron(createWorker(fake.runtime), "0 0 1 1 *");

    expect(namesOf(fake.calls)).toEqual([]);
  });
});

async function fetchFrom(
  worker: ReturnType<typeof createWorker>,
  method: string,
  path: string,
  env: PilotEnv = testEnv,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://vela.worker.test${path}`, { method }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

// ADR-29: the API is dispatched on its path before the pilot's Hono app, so it never builds the
// pilot's deps and the pilot's routes never see it.
describe("the API under /v1", () => {
  it.each([
    ["GET", "/v1/me"],
    ["POST", "/v1/families"],
    ["GET", "/v1"],
    ["OPTIONS", "/v1/me"],
  ])("hands %s %s to the API, and builds none of the pilot's deps", async (method, path) => {
    const fake = createFakePilotRuntime();

    const response = await fetchFrom(createWorker(fake.runtime), method, path);

    expect(response.status).toBe(204);
    expect(fake.apiRequests).toEqual([`${method} ${path}`]);
    expect(fake.built()).toBe(0);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it.each([
    ["GET", "/v1x"],
    ["GET", "/v10/me"],
    ["GET", "/healthz"],
    ["GET", "/privacy"],
    ["POST", "/webhooks/telegram"],
    ["GET", "/admin"],
  ])("never hands %s %s to the API", async (method, path) => {
    const fake = createFakePilotRuntime();

    await fetchFrom(createWorker(fake.runtime), method, path);

    expect(fake.apiRequests).toEqual([]);
  });

  it("takes /v1 and what is under it, and nothing that merely starts with v1", () => {
    expect(["/v1", "/v1/", "/v1/me", "/v1/families/x/today"].map(isApiPath)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["/", "/v1x", "/v10/me", "/v2/me", "/api/v1/me", "/V1/me"].map(isApiPath)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("answers under /v1 while the pilot's own configuration is refused", async () => {
    const fake = createFakePilotRuntime();
    const refusing: PilotRuntime = {
      ...fake.runtime,
      createDeps: async () => {
        throw new ConfigError("PUBLIC_BASE_URL", "PUBLIC_BASE_URL still holds a placeholder");
      },
    };

    const response = await fetchFrom(createWorker(refusing), "GET", "/v1/me");

    expect(response.status).toBe(204);
    expect(fake.apiRequests).toEqual(["GET /v1/me"]);
  });

  it("serves the pilot's pages while the API's configuration is refused", async () => {
    const fake = createFakePilotRuntime({ api: createApiHandler() });
    const worker = createWorker(fake.runtime);
    const refused: PilotEnv = { ...testEnv, API_V1: "maybe" };

    const { result: api, lines } = await consoleLinesDuring(() =>
      fetchFrom(worker, "GET", "/v1/me", refused),
    );
    const notice = await fetchFrom(worker, "GET", "/privacy", refused);

    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({
      error: { code: "unavailable", message: "Service temporarily unavailable." },
    });
    expect(lines).toEqual([
      {
        level: "error",
        event: "api_config_refused",
        environment: testEnv.ENVIRONMENT,
        error: "ConfigError:API_V1",
      },
    ]);
    expect(notice.status).toBe(200);
  });
});
