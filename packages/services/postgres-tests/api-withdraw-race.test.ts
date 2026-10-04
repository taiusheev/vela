/**
 * Withdrawing an ask on independent PostgreSQL connections (spec §19). Her morning can be prepared
 * at the moment its asker withdraws it. Withdrawing takes her member row's lock, as `prepareDay`
 * does, so it waits, then finds the ask prepared and refuses: an ask is never both withdrawn and on
 * its way. The holder is the preparation, her row locked and the ask marked scheduled, not yet
 * committed. Without the lock the withdrawal overwrites the scheduled ask after the commit.
 */
import { exchanges, members, users, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { WithdrawTooLateError, withdrawApiAsk } from "../src/api-withdraw.ts";
import { seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };

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

async function seedAsk(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  const [account] = await db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (account === undefined) throw new Error("expected Mia's account");
  await db.update(members).set({ userId: account.id }).where(eq(members.id, family.organiser.id));
  const ask = await seedExchange(db, family, { date: "2026-09-15", state: "composed" });
  return { family, ask };
}

describe("withdrawing an ask on independent PostgreSQL connections", () => {
  it("refuses once her morning was prepared with it at the same time", async () => {
    const { family, ask } = await seedAsk(seeder.db);
    const [writer, holder] = await pg.clientPool("withdraw", 2);
    if (writer === undefined || holder === undefined) throw new Error("expected two connections");

    const held = await pg.holdRows(holder, async (tx) => {
      await tx.select().from(members).where(eq(members.id, family.member.id)).for("update");
      await tx.update(exchanges).set({ state: "scheduled" }).where(eq(exchanges.id, ask.id));
    });
    const withdrawing = pg.track(withdrawApiAsk(pg.jobDeps(writer), mia, "withdraw", ask.id));
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], withdrawing);
    await held.release();
    const [result] = await pg.settle("the withdrawal", [withdrawing]);

    expect(result?.status).toBe("rejected");
    expect(result?.status === "rejected" ? result.reason : null).toBeInstanceOf(
      WithdrawTooLateError,
    );
    const [row] = await seeder.db.select().from(exchanges).where(eq(exchanges.id, ask.id));
    expect(row?.state).toBe("scheduled");
  });
});
