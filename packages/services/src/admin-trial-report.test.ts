import type { LocalDate } from "@vela/contracts";
import {
  adminAccessLog,
  answers,
  exchanges,
  families,
  members,
  outbound,
  quietEvents,
  replies,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAdminTrialReport } from "./admin-trial-report.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const ctx = { admin: "founder@vela.test" };
const NOW = new Date("2026-10-05T16:30:00Z"); // Oct 6 Taiwan; still Oct 5 Vietnam.
const PRIVATE = "Private family words and health details";

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  h.clock.set(NOW);
  seed = await seedFamily(h.db, {
    now: new Date("2026-09-01T00:00:00Z"),
    timeZone: "Asia/Ho_Chi_Minh",
  });
});
afterAll(async () => {
  await h.close();
});

async function exchange(
  day: LocalDate,
  values: Parameters<typeof seedExchange>[2] = { date: day },
) {
  return seedExchange(h.db, seed, { ...values, date: day, text: PRIVATE });
}

async function send(
  exchangeId: string,
  day: LocalDate,
  values: Partial<typeof outbound.$inferInsert> = {},
) {
  await h.db.insert(outbound).values({
    memberId: seed.member.id,
    exchangeId,
    kind: "arrival",
    channel: "telegram",
    conversationId: "PRIVATE-CONVERSATION",
    localDay: day,
    idempotencyKey: `trial:${exchangeId}`,
    payload: { message: { text: PRIVATE } },
    status: "sent",
    attempts: 1,
    sentAt: NOW,
    ...values,
  });
}

async function report(days: 7 | 30 = 7) {
  const result = await loadAdminTrialReport(h.deps, ctx, seed.family.id, days);
  expect(result).not.toBeNull();
  return result;
}

describe("founder trial counts", () => {
  it("uses the parent's complete local dates across the Taiwan/Vietnam midnight boundary", async () => {
    await h.db.update(members).set({ tz: "Asia/Taipei" }).where(eq(members.id, seed.organiser.id));
    await exchange("2026-09-28", { date: "2026-09-28", state: "delivered" });
    await exchange("2026-10-04", { date: "2026-10-04", state: "delivered" });
    await exchange("2026-10-05", { date: "2026-10-05", state: "delivered" });
    const result = await report();
    expect(result?.recipients).toHaveLength(1);
    expect(result?.recipients[0]).toMatchObject({
      from: "2026-09-28",
      through: "2026-10-04",
      timezone: "Asia/Ho_Chi_Minh",
      unobservedDays: 5,
      summary: { recordedDays: 2 },
    });
    expect(result?.recipients[0]?.days.map((d) => d.day)).toEqual(["2026-09-28", "2026-10-04"]);
  });

  it("retains failed, dropped and pending sends without treating attempts as delivered days", async () => {
    const failed = await exchange("2026-10-01", { date: "2026-10-01", state: "scheduled" });
    await h.db.update(exchanges).set({ deliveryFailedAt: NOW }).where(eq(exchanges.id, failed.id));
    await send(failed.id, "2026-10-01", {
      status: "failed",
      attempts: 3,
      sentAt: null,
      error: PRIVATE,
    });
    const dropped = await exchange("2026-10-02", { date: "2026-10-02", state: "scheduled" });
    await send(dropped.id, "2026-10-02", { status: "dropped", attempts: 1, sentAt: null });
    const pending = await exchange("2026-10-03", { date: "2026-10-03", state: "scheduled" });
    await send(pending.id, "2026-10-03", { status: "queued", attempts: 2, sentAt: null });
    const delivered = await exchange("2026-10-04", {
      date: "2026-10-04",
      state: "delivered",
      deliveredAt: NOW,
    });
    await send(delivered.id, "2026-10-04", { attempts: 2 });
    const result = (await report())?.recipients[0];
    expect(result?.summary).toMatchObject({
      recordedDays: 4,
      deliveredDays: 1,
      failedDays: 1,
      answeredDays: 0,
    });
    expect(result?.days[0]).toMatchObject({
      arrivalAttempts: 3,
      arrivalFailed: 1,
      delivered: false,
      failed: true,
    });
    expect(result?.days[1]).toMatchObject({ arrivalDropped: 1, failed: false });
    expect(result?.days[2]).toMatchObject({ arrivalAttempts: 2, arrivalPending: 1 });
    expect(result?.days[3]).toMatchObject({
      arrivalAttempts: 2,
      arrivalUnsuccessfulAttempts: 1,
      arrivalSent: 1,
      delivered: true,
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-CONVERSATION");
  });

  it("counts answer records and human replies, separating pre-arrival latency and reactions", async () => {
    const first = await exchange("2026-10-01", {
      date: "2026-10-01",
      state: "answered",
      deliveredAt: new Date("2026-10-01T00:00Z"),
      answeredAt: new Date("2026-10-01T00:10Z"),
      askerId: null,
    });
    const second = await exchange("2026-10-02", {
      date: "2026-10-02",
      type: "hello",
      state: "answered",
      deliveredAt: new Date("2026-10-02T00:00Z"),
      answeredAt: new Date("2026-10-02T00:20Z"),
    });
    await exchange("2026-10-03", {
      date: "2026-10-03",
      state: "answered",
      deliveredAt: new Date("2026-10-03T00:00Z"),
      answeredAt: new Date("2026-10-02T23:50Z"),
    });
    await h.db.insert(answers).values([
      {
        exchangeId: first.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        payload: { text: PRIVATE },
      },
      {
        exchangeId: first.id,
        memberId: seed.member.id,
        kind: "voice",
        channel: "telegram",
        transcript: PRIVATE,
      },
      { exchangeId: second.id, memberId: seed.member.id, kind: "fine", channel: "telegram" },
    ]);
    await h.db.insert(replies).values([
      {
        exchangeId: first.id,
        memberId: seed.organiser.id,
        kind: "text",
        text: PRIVATE,
        channel: "app",
        readBackAt: NOW,
      },
      { exchangeId: first.id, memberId: seed.organiser.id, kind: "voice", channel: "telegram" },
      { exchangeId: first.id, memberId: seed.organiser.id, kind: "photo", channel: "telegram" },
      { exchangeId: first.id, memberId: seed.organiser.id, kind: "heart", channel: "telegram" },
      {
        exchangeId: first.id,
        memberId: seed.organiser.id,
        kind: "text",
        text: PRIVATE,
        channel: "telegram",
        toRecipient: false,
      },
    ]);
    const other = await seedFamily(h.db, {
      now: NOW,
      organiserExternalId: "other-organiser",
      memberExternalId: "other-parent",
    });
    await h.db
      .insert(replies)
      .values({ exchangeId: first.id, memberId: other.organiser.id, kind: "text", channel: "app" });
    const result = (await report())?.recipients[0];
    expect(result?.summary).toMatchObject({
      recordedDays: 3,
      answeredDays: 3,
      answerCount: 3,
      fallbackDays: 1,
      humanReplies: 3,
      repliesReadBack: 1,
      medianLatencyMin: 15,
      latencySamples: 2,
      preArrivalAnswers: 1,
    });
    expect(result?.days[0]?.fallback).toBe(false); // An erased asker is not a fallback.
  });

  it("attributes next-morning read-back failures to the earlier exchange and warns on expired metadata", async () => {
    const previous = await exchange("2026-10-03", { date: "2026-10-03", state: "replied" });
    const next = await exchange("2026-10-05", { date: "2026-10-05", state: "scheduled" });
    await send(next.id, "2026-10-05", {
      status: "failed",
      attempts: 3,
      sentAt: null,
      payload: { effect: { previousExchangeId: previous.id }, message: { text: PRIVATE } },
    });
    const cleared = await exchange("2026-10-02", { date: "2026-10-02", state: "delivered" });
    await send(cleared.id, "2026-10-02", { payload: {} });
    await h.db.insert(quietEvents).values({
      memberId: seed.member.id,
      exchangeId: previous.id,
      notifyCount: 2,
      outcome: "fine_known",
      resolvedAt: NOW,
    });
    const result = (await report())?.recipients[0];
    expect(result?.days.find((day) => day.day === "2026-10-03")).toMatchObject({
      readBackAttempts: 3,
      readBackFailed: 1,
      readBackSent: 0,
      quietNotices: 2,
      quietOutcome: "fine_known",
    });
    expect(result?.expiredArrivalMetadata).toBe(1);
  });

  it("excludes withdrawn, unsent composed, other-family and out-of-period records", async () => {
    await exchange("2026-10-01", { date: "2026-10-01", state: "withdrawn" });
    await exchange("2026-10-02", { date: "2026-10-02", state: "composed" });
    await exchange("2026-09-27", { date: "2026-09-27", state: "delivered" });
    const other = await seedFamily(h.db, {
      now: NOW,
      organiserExternalId: "other-organiser",
      memberExternalId: "other-parent",
    });
    await seedExchange(h.db, other, { date: "2026-10-01", state: "answered" });
    expect((await report())?.recipients).toEqual([]);
  });

  it("uses a 30-day window when requested", async () => {
    await exchange("2026-09-05", { date: "2026-09-05", state: "delivered" });
    await exchange("2026-09-04", { date: "2026-09-04", state: "delivered" });
    expect((await report(30))?.recipients[0]).toMatchObject({
      from: "2026-09-05",
      through: "2026-10-04",
      unobservedDays: 29,
    });
  });

  it("logs the protected report path once and never selects sealed content", async () => {
    const row = await exchange("2026-10-04", { date: "2026-10-04", state: "answered" });
    const [answer] = await h.db
      .insert(answers)
      .values({
        exchangeId: row.id,
        memberId: seed.member.id,
        kind: "voice",
        channel: "telegram",
        transcript: PRIVATE,
      })
      .returning({ id: answers.id });
    await h.db.execute(sql`update exchanges set text = 'v1.bad-ciphertext' where id = ${row.id}`);
    await h.db.execute(
      sql`update answers set transcript = 'v1.bad-ciphertext' where id = ${answer?.id}`,
    );
    await report();
    const logs = await h.db.select().from(adminAccessLog);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      admin: ctx.admin,
      familyId: seed.family.id,
      action: "view",
      what: `/admin/families/${seed.family.id}/trial?days=7`,
    });
    expect(JSON.stringify(logs)).not.toContain(PRIVATE);
  });

  it("returns unavailable for absent or deleting families without a view log", async () => {
    expect(
      await loadAdminTrialReport(h.deps, ctx, "11111111-1111-4111-8111-111111111111"),
    ).toBeNull();
    await h.db.update(families).set({ deletedAt: NOW }).where(eq(families.id, seed.family.id));
    expect(await loadAdminTrialReport(h.deps, ctx, seed.family.id)).toBeNull();
    expect(await h.db.select().from(adminAccessLog)).toEqual([]);
  });

  it("refuses invalid report scope, mismatched family context and empty admin identity", async () => {
    await expect(loadAdminTrialReport(h.deps, ctx, "bad-id")).rejects.toMatchObject({
      code: "invalid_payload",
    });
    await expect(
      loadAdminTrialReport(h.deps, { ...ctx, familyId: seed.organiser.id }, seed.family.id),
    ).rejects.toMatchObject({ code: "invalid_payload" });
    await expect(loadAdminTrialReport(h.deps, { admin: "" }, seed.family.id)).rejects.toMatchObject(
      { code: "invalid_payload" },
    );
  });
});
