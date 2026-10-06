import { answers, exchanges, families, outbound, replies } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAdminTrialReport } from "../src/admin-trial-report.ts";
import { errorLabel } from "../src/errors.ts";
import { seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
const ctx = { admin: "founder@vela.test" };
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

describe("trial report on PostgreSQL", () => {
  it("counts cross-day read-back effects, answer records and human replies on the real driver", async () => {
    const family = await seedFamily(seeder.db, { now: NOW, timeZone: "Asia/Ho_Chi_Minh" });
    const previous = await seedExchange(seeder.db, family, {
      date: "2026-09-13",
      state: "replied",
      deliveredAt: new Date("2026-09-13T00:00Z"),
      answeredAt: new Date("2026-09-13T00:25Z"),
    });
    const next = await seedExchange(seeder.db, family, { date: "2026-09-14", state: "scheduled" });
    await seeder.db.insert(answers).values({
      exchangeId: previous.id,
      memberId: family.member.id,
      channel: "telegram",
      kind: "text",
      payload: { text: "Synthetic test answer" },
    });
    await seeder.db.insert(replies).values({
      exchangeId: previous.id,
      memberId: family.organiser.id,
      channel: "app",
      kind: "voice",
      readBackAt: NOW,
    });
    await seeder.db.insert(outbound).values({
      exchangeId: next.id,
      memberId: family.member.id,
      channel: "telegram",
      kind: "arrival",
      conversationId: "synthetic-chat",
      localDay: "2026-09-14",
      idempotencyKey: "synthetic-readback",
      status: "sent",
      attempts: 2,
      payload: {
        effect: { previousExchangeId: previous.id },
        message: { text: "Synthetic only" },
      },
      sentAt: NOW,
    });
    const report = await loadAdminTrialReport(pg.jobDeps(seeder), ctx, family.family.id, 7);
    expect(report?.recipients[0]?.summary).toMatchObject({
      recordedDays: 1,
      answeredDays: 1,
      answerCount: 1,
      humanReplies: 1,
      repliesReadBack: 1,
      medianLatencyMin: 25,
    });
    expect(report?.recipients[0]?.days[0]).toMatchObject({ readBackAttempts: 2, readBackSent: 1 });
  });

  it("returns unavailable if a concurrent deletion starts while the report is being audited", async () => {
    const family = await seedFamily(seeder.db, { now: NOW });
    await seedExchange(seeder.db, family, { date: "2026-09-13", state: "delivered" });
    const [reader, deleter] = await pg.clientPool("trial-report-delete", 2);
    if (reader === undefined || deleter === undefined) throw new Error("expected two clients");
    const held = await pg.holdRows(deleter, async (tx) => {
      await tx.select().from(families).where(eq(families.id, family.family.id)).for("update");
      await tx.update(families).set({ deletedAt: NOW }).where(eq(families.id, family.family.id));
      await tx
        .update(exchanges)
        .set({ state: "archived" })
        .where(eq(exchanges.familyId, family.family.id));
    });
    const reporting = pg.track(loadAdminTrialReport(pg.jobDeps(reader), ctx, family.family.id, 7));
    await pg.waitForRowLockWaitOrCompletion(reader, [deleter], reporting);
    await held.release();
    const [result] = await pg.settle("trial report during deletion", [reporting]);
    expect(result?.status, result?.status === "rejected" ? errorLabel(result.reason) : "").toBe(
      "fulfilled",
    );
    expect(result?.status === "fulfilled" ? result.value : "failed").toBeNull();
  });
});
