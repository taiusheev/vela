/** Concurrent synthetic families on build 5's service code; never connects to live providers. */
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { InboundEvent } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import {
  answers,
  exchanges,
  members,
  outbound,
  quietEvents,
  replies,
  suggestions,
  users,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadApiExchanges } from "../src/api-exchanges.ts";
import { replyToApiExchange } from "../src/api-replies.ts";
import { loadApiToday } from "../src/api-today.ts";
import type { Deps, OutboundJob, UnderstandJob } from "../src/deps.ts";
import { deliverOutbound } from "../src/gateway.ts";
import { handleInbound } from "../src/inbound/router.ts";
import { understandAnswer } from "../src/pipeline.ts";
import { createFakeTelegram } from "../src/testing/fake-telegram.ts";
import { createFakeQueue, createFakeRandom } from "../src/testing/fakes.ts";
import { type SeededFamily, seedFamily } from "../src/testing/seed.ts";
import { tickMember } from "../src/tick.ts";
import { NOW, openPostgresHarness, type PostgresHarness } from "./testing.ts";

function setting(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
const COUNT = setting("VELA_SWARM_FAMILIES", 100, 1000);
const DAYS = setting("VELA_SWARM_DAYS", 7, 7);
const WORKERS = setting("VELA_SWARM_WORKERS", 20, 40);
let pg: PostgresHarness;
beforeAll(async () => {
  pg = await openPostgresHarness();
});
afterAll(async () => {
  await pg?.close();
});

it("keeps simultaneous families' daily answers, app replies and read-backs isolated", async () => {
  await pg.reset();
  const seeder = await pg.client("swarm-seed");
  const pool = await pg.clientPool("swarm", WORKERS);
  let now = new Date(NOW);
  const clock = { now: () => new Date(now) };
  let sequence = 0;
  const next = () => ++sequence;
  const queue = createFakeQueue<OutboundJob>(clock, next);
  const understand = createFakeQueue<UnderstandJob>(clock, next);
  const telegram = createFakeTelegram(clock);
  const random = createFakeRandom();
  const adapter = {
    ...telegram,
    send: async (...args: Parameters<typeof telegram.send>) => {
      await delay(25);
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
      queues: { ...base.queues, outbound: queue, understand },
      config: { ...base.config, sendAsMe: true },
    };
  });
  const cohort: SeededFamily[] = [];
  for (let index = 0; index < COUNT; index++) {
    const family = await seedFamily(seeder.db, {
      now: new Date(NOW.getTime() - 10 * 86400000),
      familyName: `Synthetic ${index}`,
      organiserName: `Child ${index}`,
      organiserExternalId: `swarm-child-${index}`,
      memberExternalId: `swarm-parent-${index}`,
      timeZone: index % 2 === 0 ? "Asia/Taipei" : "Asia/Ho_Chi_Minh",
      arrivalTime: index % 2 === 0 ? "08:00" : "07:00",
      language: index % 3 === 0 ? "zh-TW" : "en",
    });
    const [user] = await seeder.db
      .insert(users)
      .values({ authSubject: `swarm-${index}`, displayName: `Child ${index}` })
      .returning();
    if (!user) throw new Error("Missing synthetic user");
    await seeder.db
      .update(members)
      .set({ userId: user.id })
      .where(eq(members.id, family.organiser.id));
    if (index % 2 === 0)
      await seeder.db
        .update(members)
        .set({ suggestionsSignedBy: family.organiser.id })
        .where(eq(members.id, family.member.id));
    cohort.push(family);
  }
  const failures: { phase: string; item: number }[] = [];
  const phases: {
    phase: string;
    operations: number;
    errors: number;
    p95Ms: number;
    elapsedMs: number;
  }[] = [];
  async function batch<T>(
    phase: string,
    items: T[],
    operation: (dep: Deps, item: T) => Promise<unknown>,
  ) {
    let cursor = 0;
    const durations: number[] = [];
    const before = failures.length;
    const start = performance.now();
    await Promise.all(
      deps.map(async (dep) => {
        for (;;) {
          const index = cursor++;
          if (index >= items.length) return;
          const began = performance.now();
          try {
            await operation(dep, items[index] as T);
          } catch {
            failures.push({ phase, item: index });
          }
          durations.push(performance.now() - began);
        }
      }),
    );
    durations.sort((a, b) => a - b);
    const result = {
      phase,
      operations: items.length,
      errors: failures.length - before,
      p95Ms: durations[Math.ceil(durations.length * 0.95) - 1] ?? 0,
      elapsedMs: performance.now() - start,
    };
    phases.push(result);
    console.log(JSON.stringify(result));
  }
  async function drain(label: string) {
    for (let round = 0; round < 10; round++) {
      const jobs = queue.pending.filter((entry) => entry.dueAt <= now);
      const ai = understand.pending.filter((entry) => entry.dueAt <= now);
      if (!jobs.length && !ai.length) return;
      for (const job of jobs) queue.take(job);
      for (const job of ai) understand.take(job);
      await batch(
        `${label}:delivery-${round}`,
        jobs.flatMap((entry) => [entry.job, entry.job]),
        (dep, job) => deliverOutbound(dep, job.outboundId),
      );
      await batch(
        `${label}:understand-${round}`,
        ai.map((entry) => entry.job),
        (dep, job) => understandAnswer(dep, job.answerId),
      );
    }
    failures.push({ phase: `${label}:queue-did-not-settle`, item: 0 });
  }
  const started = performance.now();
  for (let day = 0; day < DAYS; day++) {
    now = new Date(NOW.getTime() + day * 86400000);
    for (const [index, family] of cohort.entries()) {
      if (index % 2 !== 0) continue;
      await seeder.db.insert(suggestions).values({
        familyId: family.family.id,
        forMemberId: family.organiser.id,
        aboutMemberId: family.member.id,
        localDay: localDateOf(now, family.member.tz),
        bankId: "opinions.taste.season",
        type: "question",
        text: `Synthetic question ${index} day ${day}`,
        lang: family.member.language,
        promptVersion: "swarm",
      });
    }
    await batch(
      `day-${day}:wake`,
      cohort.flatMap((family) => [family, family]),
      (dep, family) => tickMember(dep, family.member.id),
    );
    await drain(`day-${day}:morning`);
    const rows = await seeder.db.select().from(exchanges);
    const daily = cohort.map((family, index) => ({
      family,
      index,
      exchange: rows.find(
        (row) =>
          row.recipientId === family.member.id &&
          row.scheduledFor === localDateOf(now, family.member.tz),
      ),
    }));
    await batch(
      `day-${day}:parent-answer`,
      daily.flatMap((item) => [item, item]),
      async (dep, { family, index, exchange }) => {
        expect(exchange?.deliveredAt).not.toBeNull();
        expect(exchange).toBeDefined();
        const event: InboundEvent = {
          channel: "telegram",
          eventId: `swarm-${index}-${day}`,
          messageId: `answer-${day}`,
          at: now.toISOString(),
          kind: "text",
          sender: { externalUserId: family.memberLink.externalId },
          conversation: { externalId: family.memberLink.externalId, kind: "private" },
          text: `Synthetic answer ${index} day ${day}`,
        };
        await handleInbound(dep, [event]);
      },
    );
    await drain(`day-${day}:answers`);
    await batch(
      `day-${day}:child-reply`,
      daily.flatMap((item) => [item, item]),
      async (dep, { index, exchange }) => {
        if (!exchange) throw new Error("Missing exchange");
        const result = await replyToApiExchange(
          dep,
          { authSubject: `swarm-${index}`, sessionId: `session-${index}` },
          `reply-${day}`,
          exchange.id,
          { text: `Synthetic reply ${index} day ${day}` },
        );
        expect(result.response.status).toBe(201);
      },
    );
    await batch(`day-${day}:app-reads`, daily, async (dep, { family, index, exchange }) => {
      const identity = { authSubject: `swarm-${index}`, sessionId: `session-${index}` };
      const today = await loadApiToday(dep.db, identity, family.family.id, now);
      const card = today?.exchanges.find((row) => row.id === exchange?.id);
      expect(card?.answers?.map((answer) => answer.text)).toEqual([
        `Synthetic answer ${index} day ${day}`,
      ]);
      const memories = await loadApiExchanges(dep.db, identity, family.family.id, now);
      expect(memories?.exchanges).toHaveLength(day + 1);
      expect(memories?.exchanges.every((row) => row.recipient_id === family.member.id)).toBe(true);
      const other = cohort[(index + 1) % COUNT];
      if (other && COUNT > 1) {
        expect(await loadApiToday(dep.db, identity, other.family.id, now)).toBeNull();
        expect(await loadApiExchanges(dep.db, identity, other.family.id, now)).toBeNull();
      }
    });
  }
  const allExchanges = await seeder.db.select().from(exchanges);
  const allAnswers = await seeder.db.select().from(answers);
  const allReplies = await seeder.db.select().from(replies);
  const allOutbound = await seeder.db.select().from(outbound);
  const quiet = await seeder.db.select().from(quietEvents);
  const keys = telegram.sent.map((entry) => entry.message.idempotencyKey);
  const totals = {
    exchanges: allExchanges.length,
    answers: allAnswers.length,
    replies: allReplies.length,
    signedDrafts: allExchanges.filter((row) => row.draftedByVela).length,
    delivered: allExchanges.filter((row) => row.deliveredAt !== null).length,
    readBackReplies: allReplies.filter((row) => row.readBackAt !== null).length,
    duplicateSends: keys.length - new Set(keys).size,
    unfinishedOutbound: allOutbound.filter((row) => row.status !== "sent" || row.effectsAt === null)
      .length,
    pendingJobs: queue.pending.length + understand.pending.length,
    quietEvents: quiet.length,
  };
  const expected = COUNT * DAYS;
  const passed =
    failures.length === 0 &&
    totals.exchanges === expected &&
    totals.answers === expected &&
    totals.replies === expected &&
    totals.delivered === expected &&
    totals.signedDrafts === Math.ceil(COUNT / 2) * DAYS &&
    totals.readBackReplies === COUNT * (DAYS - 1) &&
    totals.duplicateSends === 0 &&
    totals.unfinishedOutbound === 0 &&
    totals.pendingJobs === 0 &&
    totals.quietEvents === 0;
  const report = {
    recordedAt: new Date().toISOString(),
    source: "f08b5a2f453fc1f0731625a008e79ff99b6f0145",
    build: 5,
    kind: "local-postgres-family-swarm",
    passed,
    families: COUNT,
    days: DAYS,
    workers: WORKERS,
    simulatedSendDelayMs: 25,
    postgres: pg.serverVersion,
    elapsedMs: performance.now() - started,
    totals,
    failures,
    phases,
    limitations: [
      "Local disposable PostgreSQL with durability disabled; synthetic queue, Telegram and AI.",
      "Seeded consenting families, text answers and replies only; onboarding, media, native UI, provider delivery and generated tone require separate evidence.",
      "No Cloudflare/Neon capacity, production capacity or real family behavior measured.",
    ],
  };
  if (process.env.VELA_SWARM_REPORT)
    await writeFile(process.env.VELA_SWARM_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed, totals, failures }));
  expect(passed, JSON.stringify({ totals, failures })).toBe(true);
}, 600000);
