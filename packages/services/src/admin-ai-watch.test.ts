import { AI_CALL_NAMES } from "@vela/ai";
import { aiCalls } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAdminAiWatch } from "./admin-ai-watch.ts";
import { createHarness, type Harness } from "./testing/harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  h.clock.set(new Date("2026-10-08T10:00:00Z"));
});
afterAll(async () => {
  await h.close();
});
async function add(
  at: string,
  ok: boolean,
  cost: number | null,
  latency: number | null,
  call = "understand",
) {
  await h.db.insert(aiCalls).values({
    at: new Date(at),
    ok,
    costUsd: cost,
    latencyMs: latency,
    call,
    model: "private-model-marker",
    promptVersion: "private-prompt-marker",
    inputRef: { private: "input-marker" },
    output: { private: "output-marker" },
  });
}
describe("content-free daily AI watch", () => {
  it("keeps every defined AI call kind and transcription distinct", async () => {
    for (const call of [...AI_CALL_NAMES, "transcribe"])
      await add("2026-10-08T09:00:00Z", true, 0.01, 100, call);
    const report = await loadAdminAiWatch(h.deps);
    expect(report.byCall.map((row) => row.call).sort()).toEqual(
      [...AI_CALL_NAMES, "transcribe"].sort(),
    );
  });
  it("returns seven UTC days, truthful empty states and no latency without observations", async () => {
    const report = await loadAdminAiWatch(h.deps);
    expect(report.days.map((r) => r.day)).toEqual([
      "2026-10-08",
      "2026-10-07",
      "2026-10-06",
      "2026-10-05",
      "2026-10-04",
      "2026-10-03",
      "2026-10-02",
    ]);
    expect(report.days[0]).toMatchObject({
      calls: 0,
      knownCostUsd: 0,
      costRecorded: 0,
      latencyRecorded: 0,
      averageLatencyMs: null,
      p95LatencyMs: null,
    });
    expect(report.byCall).toEqual([]);
  });
  it("includes midnight boundaries, excludes future and old calls, and separates today's kinds", async () => {
    await add("2026-10-01T23:59:59Z", true, 99, 9999);
    await add("2026-10-02T00:00:00Z", true, 0.02, 200);
    await add("2026-10-07T23:59:59Z", true, 0.03, 300);
    await add("2026-10-08T00:00:00Z", true, 0.01, 100);
    await add("2026-10-08T09:00:00Z", false, null, 900);
    await add("2026-10-08T10:00:00Z", true, 0, 0, "flag");
    await add("2026-10-08T10:00:01Z", true, 99, 9999);
    const report = await loadAdminAiWatch(h.deps);
    expect(report.days[0]).toMatchObject({
      calls: 3,
      failures: 1,
      knownCostUsd: 0.01,
      costRecorded: 2,
      latencyRecorded: 3,
      averageLatencyMs: 1000 / 3,
    });
    expect(report.days[0]?.p95LatencyMs).toBeCloseTo(820);
    expect(report.days[1]).toMatchObject({ calls: 1, knownCostUsd: 0.03 });
    expect(report.days[6]).toMatchObject({ calls: 1, knownCostUsd: 0.02 });
    expect(report.byCall).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          call: "understand",
          calls: 2,
          failures: 1,
          averageLatencyMs: 500,
          p95LatencyMs: 860,
        }),
        expect.objectContaining({ call: "flag", calls: 1 }),
      ]),
    );
  });
  it("never returns database content fields or unrecognised category text, and excludes invalid measurements", async () => {
    await add("2026-10-08T09:00:00Z", false, -10, -3, "private-call-marker");
    const report = await loadAdminAiWatch(h.deps);
    expect(report.byCall).toEqual([
      expect.objectContaining({
        call: "other",
        calls: 1,
        failures: 1,
        knownCostUsd: 0,
        costRecorded: 0,
        latencyRecorded: 0,
        averageLatencyMs: null,
        p95LatencyMs: null,
      }),
    ]);
    expect(JSON.stringify(report)).not.toMatch(
      /private|marker|inputRef|output|model|promptVersion|memberId|familyId/,
    );
  });
});
