import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { PilotEnv } from "./env.ts";
import {
  createHeartbeat,
  HEARTBEAT_FRESH_SECONDS,
  healthOf,
  type ReconcileHeartbeat,
} from "./heartbeat.ts";
import { type LogLine, recordingLogger, testEnv } from "./testing/fakes.ts";

/** The one heartbeat object, as the port and `/healthz` reach it. */
function heartbeatObject(): DurableObjectStub<ReconcileHeartbeat> {
  const namespace = testEnv.RECONCILE_HEARTBEAT;
  return namespace.get(namespace.idFromName("reconcile"));
}

describe("the health a last reconciliation means", () => {
  const now = Date.parse("2026-09-18T08:00:00.000Z");

  it("is no_reconcile_yet before the first run", () => {
    expect(healthOf(null, now)).toEqual({ status: "no_reconcile_yet" });
  });

  it("is ok, with the age in whole seconds, up to 35 minutes after the last run", () => {
    expect(healthOf(now - 61_500, now)).toEqual({ status: "ok", lastReconcileAgeSeconds: 61 });
    expect(healthOf(now - HEARTBEAT_FRESH_SECONDS * 1000, now)).toEqual({
      status: "ok",
      lastReconcileAgeSeconds: 35 * 60,
    });
  });

  // Two missed 15-minute runs and five minutes over: one failed run alerts nobody, a stopped Worker
  // does.
  it("is stale once the last run is more than 35 minutes old", () => {
    expect(healthOf(now - HEARTBEAT_FRESH_SECONDS * 1000 - 1000, now)).toEqual({ status: "stale" });
  });
});

describe("the heartbeat port", () => {
  it("records when a reconciliation finished in the heartbeat object, and logs nothing", async () => {
    const lines: LogLine[] = [];
    const before = Date.now();

    await createHeartbeat(testEnv, recordingLogger(lines)).ping();

    const recorded = await runInDurableObject(heartbeatObject(), (instance) =>
      instance.lastReconcileAt(),
    );
    expect(recorded).not.toBeNull();
    expect(recorded ?? 0).toBeGreaterThanOrEqual(before);
    expect(recorded ?? 0).toBeLessThanOrEqual(Date.now());
    expect(lines).toEqual([]);
  });

  // A reconciliation that did its work must not fail because the record did not land; the watchdog
  // then sees the silence it should.
  it("logs a failed record by its label and does not throw", async () => {
    const lines: LogLine[] = [];
    const broken = {
      idFromName: () => {
        throw new TypeError("the namespace is unavailable");
      },
    } as unknown as PilotEnv["RECONCILE_HEARTBEAT"];

    await createHeartbeat({ RECONCILE_HEARTBEAT: broken }, recordingLogger(lines)).ping();

    expect(lines).toEqual([
      { level: "warn", event: "heartbeat_failed", fields: { error: "TypeError" } },
    ]);
  });
});
