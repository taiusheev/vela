import type { LocalDate } from "@vela/contracts";
import {
  adminAccessLog,
  answers,
  awayPeriods,
  events,
  exchanges,
  families,
  members,
  outbound,
  quietEvents,
  replies,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadAdminTrialOverview,
  loadAdminTrialReport,
  type TrialRecipientReport,
  trialNumbers,
} from "./admin-trial-report.ts";
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

  describe("the four numbers", () => {
    const delivered = (day: LocalDate) => new Date(`${day}T01:00:00Z`);
    const answered = (day: LocalDate) => new Date(`${day}T02:00:00Z`);

    // Ten delivered mornings 25 Sep – 4 Oct (Vietnam). She is away 1–2 Oct and does not answer;
    // 3 Oct is a true concern the organiser found useful; 27 Sep was answered late after a notice
    // the organiser did not find useful. Two answered days had replies read back. She said stop once.
    async function seedFortnight() {
      const ids = new Map<LocalDate, string>();
      const days: LocalDate[] = [
        "2026-09-25",
        "2026-09-26",
        "2026-09-27",
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
      ];
      for (const day of days) {
        const silent = day === "2026-10-01" || day === "2026-10-02" || day === "2026-10-03";
        const row = await exchange(day, {
          date: day,
          type: day === "2026-09-29" ? "hello" : "question",
          state: silent ? "delivered" : "answered",
          deliveredAt: delivered(day),
          ...(silent ? {} : { answeredAt: answered(day) }),
        });
        ids.set(day, row.id);
      }
      await h.db.insert(awayPeriods).values({
        memberId: seed.member.id,
        fromDate: "2026-10-01",
        toDate: "2026-10-02",
        source: "organiser",
      });
      await h.db.insert(quietEvents).values([
        {
          memberId: seed.member.id,
          exchangeId: ids.get("2026-10-03") ?? "",
          notifyCount: 1,
          outcome: "true_concern",
          resolvedAt: NOW,
          useful: true,
        },
        {
          memberId: seed.member.id,
          exchangeId: ids.get("2026-09-27") ?? "",
          notifyCount: 1,
          outcome: "answered_late",
          resolvedAt: NOW,
          useful: false,
        },
      ]);
      await h.db.insert(replies).values(
        (["2026-09-25", "2026-09-26"] as const).map((day) => ({
          exchangeId: ids.get(day) ?? "",
          memberId: seed.organiser.id,
          kind: "text" as const,
          text: PRIVATE,
          channel: "app" as const,
          readBackAt: NOW,
        })),
      );
      await h.db.insert(events).values({
        name: "stop_said",
        familyId: seed.family.id,
        memberId: seed.member.id,
        at: new Date("2026-10-04T03:00:00Z"),
      });
    }

    it("keeps away days out of the answer rate and counts verdicts, concerns and stops", async () => {
      await seedFortnight();
      const result = (await report(30))?.recipients[0];
      expect(result?.lightOn).toBe(true);
      expect(result?.summary).toMatchObject({
        recordedDays: 10,
        deliveredDays: 10,
        answeredDays: 7,
        awayDays: 2,
        eligibleDays: 8,
        eligibleAnsweredDays: 7,
        fallbackDays: 1,
        repliesHeardDays: 2,
        quietNoticeDays: 2,
        usefulYes: 1,
        usefulNo: 1,
        trueConcern: 1,
        stopsSaid: 1,
      });
      expect(result?.days.filter((day) => day.away).map((day) => day.day)).toEqual([
        "2026-10-01",
        "2026-10-02",
      ]);
      const numbers = Object.fromEntries(
        trialNumbers(result?.summary as TrialRecipientReport["summary"]).map((n) => [n.key, n]),
      );
      expect(numbers.answer_rate).toMatchObject({ value: 7 / 8, status: "on_track" });
      // Two verdicts are not enough to judge usefulness.
      expect(numbers.useful_notices).toMatchObject({ value: 0.5, status: "too_early" });
      expect(numbers.notices_per_month).toMatchObject({ value: 6, status: "watch" });
      expect(numbers.missed_trouble).toMatchObject({ value: 1, status: "founder_check" });
      expect(numbers.stops).toMatchObject({ value: 1, status: "watch" });
      expect(numbers.fallback_share).toMatchObject({ value: 0.1, status: "on_track" });
      expect(numbers.replies_heard).toMatchObject({ value: 2 / 7, status: "watch" });
    });

    it("ends an open-ended away period on the day it was ended", async () => {
      await seedFortnight();
      await h.db.delete(awayPeriods);
      await h.db.insert(awayPeriods).values({
        memberId: seed.member.id,
        fromDate: "2026-10-01",
        source: "member",
        endedAt: new Date("2026-10-01T05:00:00Z"),
      });
      const result = (await report(30))?.recipients[0];
      expect(result?.days.filter((day) => day.away).map((day) => day.day)).toEqual(["2026-10-01"]);
    });

    it("judges each number against its target and says when it is too early", () => {
      const base = {
        recordedDays: 20,
        deliveredDays: 20,
        failedDays: 0,
        answeredDays: 9,
        fallbackDays: 8,
        answerCount: 9,
        humanReplies: 0,
        repliesReadBack: 0,
        medianLatencyMin: null,
        latencySamples: 9,
        preArrivalAnswers: 0,
        eligibleDays: 20,
        eligibleAnsweredDays: 9,
        awayDays: 0,
        repliesHeardDays: 6,
        quietNoticeDays: 2,
        usefulYes: 3,
        usefulNo: 0,
        trueConcern: 0,
        stopsSaid: 0,
      };
      const byKey = (summary: typeof base) =>
        Object.fromEntries(trialNumbers(summary).map((n) => [n.key, n.status]));
      expect(byKey(base)).toEqual({
        answer_rate: "kill",
        useful_notices: "on_track",
        notices_per_month: "on_track",
        missed_trouble: "founder_check",
        stops: "on_track",
        fallback_share: "kill",
        replies_heard: "on_track",
      });
      expect(byKey({ ...base, eligibleDays: 6, eligibleAnsweredDays: 1 }).answer_rate).toBe(
        "too_early",
      );
      expect(byKey({ ...base, eligibleAnsweredDays: 12 }).answer_rate).toBe("watch");
    });

    it("gathers every kept-light member across families into one overview", async () => {
      await seedFortnight();
      const other = await seedFamily(h.db, {
        now: new Date("2026-09-01T00:00:00Z"),
        organiserExternalId: "other-organiser",
        memberExternalId: "other-parent",
        timeZone: "Asia/Ho_Chi_Minh",
      });
      await seedExchange(h.db, other, {
        date: "2026-10-04",
        state: "answered",
        deliveredAt: delivered("2026-10-04"),
        answeredAt: answered("2026-10-04"),
        text: PRIVATE,
      });
      const overview = await loadAdminTrialOverview(h.deps, ctx, 30);
      expect(overview.parents.map((p) => p.familyId).sort()).toEqual(
        [seed.family.id, other.family.id].sort(),
      );
      expect(overview.totals).toMatchObject({
        recordedDays: 11,
        eligibleDays: 9,
        eligibleAnsweredDays: 8,
        stopsSaid: 1,
        medianLatencyMin: null,
      });
      expect(overview.parentsWhoStopped).toBe(1);
      const logged = await h.db.select().from(adminAccessLog);
      expect(logged).toHaveLength(2);
      expect(JSON.stringify(overview)).not.toContain(PRIVATE);
    });

    it("refuses a family-scoped overview", async () => {
      await expect(
        loadAdminTrialOverview(h.deps, { ...ctx, familyId: seed.family.id }, 30),
      ).rejects.toThrow(/scope/);
    });
  });
});
