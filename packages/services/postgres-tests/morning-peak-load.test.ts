/** Local service/database load evidence. This does not measure hosted queues or live providers. */
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { exchanges, outbound, quietEvents } from "@vela/db";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { Deps, OutboundJob } from "../src/deps.ts";
import { deliverOutbound } from "../src/gateway.ts";
import { createFakeTelegram } from "../src/testing/fake-telegram.ts";
import { createFakeQueue, createFakeRandom } from "../src/testing/fakes.ts";
import { seedFamily } from "../src/testing/seed.ts";
import { tickMember } from "../src/tick.ts";
import { NOW, openPostgresHarness, type PostgresHarness } from "./testing.ts";

const PILOT_PEAK = 10; // Ten kept-light members due in the same minute.
const MULTIPLIER = 10;
const MEMBERS = PILOT_PEAK * MULTIPLIER;
const WORKERS = 10;
const ROUNDS = 3;
const SEND_DELAY_MS = 25;
const BUDGET_MS = 5 * 60_000;
let pg: PostgresHarness;
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

it("drains three 100-parent morning bursts with duplicate wakes and queue deliveries", async () => {
  const rounds = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    if (round > 0) {
      await pg.cleanup();
      await pg.reset();
    }
    const seeder = await pg.client(`seed-${round}`);
    const pool = await pg.clientPool(`peak-${round}`, WORKERS);
    const memberIds: string[] = [];
    for (let index = 0; index < MEMBERS; index += 1) {
      const family = await seedFamily(seeder.db, {
        now: new Date(NOW.getTime() - 10 * 86_400_000),
        organiserExternalId: `load-organiser-${index}`,
        memberExternalId: `load-parent-${index}`,
      });
      memberIds.push(family.member.id);
    }
    // Model 08:00 at the burst start; time then advances with wall time, not a frozen test clock.
    const start = performance.now();
    const clock = { now: () => new Date(NOW.getTime() + performance.now() - start) };
    let sequence = 0;
    const queue = createFakeQueue<OutboundJob>(clock, () => ++sequence);
    const random = createFakeRandom();
    const telegram = createFakeTelegram(clock);
    const adapter = {
      ...telegram,
      send: async (...args: Parameters<typeof telegram.send>) => {
        await delay(SEND_DELAY_MS);
        return telegram.send(...args);
      },
    };
    const deps = pool.map((client): Deps => {
      const base = pg.jobDeps(client);
      return {
        ...base,
        clock,
        random,
        channels: { get: () => adapter },
        queues: { ...base.queues, outbound: queue },
      };
    });
    const failures: string[] = [];
    const tickMs: number[] = [];
    const completions = new Map<string, number>();
    async function consume<T>(items: T[], operation: (dep: Deps, item: T) => Promise<void>) {
      let cursor = 0;
      await Promise.all(
        deps.map(async (dep) => {
          for (;;) {
            const index = cursor++;
            if (index >= items.length) return;
            const item = items[index];
            if (item === undefined) throw new Error("missing load item");
            try {
              await operation(dep, item);
            } catch {
              failures.push("service_operation_failed");
            }
          }
        }),
      );
    }
    // Adjacent copies can overlap on separate database connections.
    await consume(
      memberIds.flatMap((id) => [id, id]),
      async (dep, id) => {
        const began = performance.now();
        await tickMember(dep, id);
        tickMs.push(performance.now() - began);
      },
    );
    const queued = [...queue.pending];
    const scheduled = queued.map((entry) => entry.job);
    for (const entry of queued) queue.take(entry);
    await consume(
      scheduled.flatMap((job) => [job, job]),
      async (dep, job) => {
        const result = await deliverOutbound(dep, job.outboundId);
        if (result === "sent" && !completions.has(job.outboundId)) {
          completions.set(job.outboundId, performance.now() - start);
        }
      },
    );
    const elapsedMs = performance.now() - start;
    const rows = await seeder.db.select().from(outbound);
    const mornings = rows.filter((row) => row.kind === "arrival");
    const exchangeRows = await seeder.db.select().from(exchanges);
    const quietRows = await seeder.db.select().from(quietEvents);
    const sent = telegram.sent.filter((entry) => entry.message.kind === "arrival");
    const uniqueSends = new Set(sent.map((entry) => entry.message.idempotencyKey)).size;
    const passed =
      failures.length === 0 &&
      completions.size === MEMBERS &&
      queue.pending.length === 0 &&
      scheduled.length === MEMBERS &&
      mornings.length === MEMBERS &&
      mornings.every((row) => row.status === "sent" && row.effectsAt !== null) &&
      exchangeRows.length === MEMBERS &&
      exchangeRows.every((row) => row.deliveredAt !== null) &&
      sent.length === MEMBERS &&
      uniqueSends === MEMBERS &&
      quietRows.length === 0 &&
      elapsedMs < BUDGET_MS;
    rounds.push({
      round: round + 1,
      passed,
      members: MEMBERS,
      schedulerAttempts: MEMBERS * 2,
      scheduledJobs: scheduled.length,
      deliveryAttempts: scheduled.length * 2,
      serviceErrors: failures.length,
      remainingJobs: queue.pending.length,
      errorRate: failures.length / (MEMBERS * 2 + scheduled.length * 2),
      sent: sent.length,
      uniqueSends,
      duplicateSends: sent.length - uniqueSends,
      deliveredExchanges: exchangeRows.filter((row) => row.deliveredAt !== null).length,
      quietEvents: quietRows.length,
      schedulerP95Ms: p95(tickMs),
      completionP95Ms: p95([...completions.values()]),
      elapsedMs,
    });
  }
  const report = {
    recordedAt: new Date().toISOString(),
    kind: "local-service-postgres-load",
    passed: rounds.every((round) => round.passed),
    postgres: pg.serverVersion,
    pilotPeakMembersPerMinute: PILOT_PEAK,
    multiplier: MULTIPLIER,
    workers: WORKERS,
    simulatedSendDelayMs: SEND_DELAY_MS,
    completionBudgetMs: BUDGET_MS,
    limitations: [
      "In-memory queue, scheduler and synthetic Telegram adapter; no Cloudflare, Neon or live provider measurement.",
      "Disposable test database; harness disables durability writes. Not production capacity or recovery evidence.",
      "No media, AI, read-back or quiet-notice load. Hosted staging run remains required for plan 2.6.",
    ],
    rounds,
  };
  console.log(JSON.stringify(report));
  if (process.env.VELA_PEAK_REPORT)
    await writeFile(process.env.VELA_PEAK_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  expect(report.passed, JSON.stringify(rounds)).toBe(true);
}, 180_000);
