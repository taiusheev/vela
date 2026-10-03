/**
 * Away from the app on independent PostgreSQL connections (spec §8). Two members of her family can
 * set the same away at once from their phones. Her member row's lock makes the second wait for the
 * first and find its period, so one away is stored once. The holder is the first write: her row
 * locked and the period inserted, not yet committed. Without the lock the second reads no period
 * and stores another.
 */
import { localDateOf } from "@vela/core";
import { awayPeriods, members, users, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { setApiAway } from "../src/api-away.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
const sam: SessionIdentity = { authSubject: "pg-race|sam", sessionId: "session-sam" };

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

async function seedAwayFamily(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  const brother = await seedGroupMember(db, family, { now: NOW, name: "Sam", externalId: "3001" });
  const [account] = await db
    .insert(users)
    .values({ authSubject: sam.authSubject, displayName: "Sam" })
    .returning();
  if (account === undefined) throw new Error("expected Sam's account");
  await db.update(members).set({ userId: account.id }).where(eq(members.id, brother.member.id));
  return family;
}

describe("away from the app on independent PostgreSQL connections", () => {
  it("stores one away when two members set the same one at once", async () => {
    const family = await seedAwayFamily(seeder.db);
    const today = localDateOf(NOW, family.member.tz);
    const [writer, holder] = await pg.clientPool("away", 2);
    if (writer === undefined || holder === undefined) throw new Error("expected two connections");

    const held = await pg.holdRows(holder, async (tx) => {
      await tx.select().from(members).where(eq(members.id, family.member.id)).for("update");
      await tx.insert(awayPeriods).values({
        memberId: family.member.id,
        fromDate: today,
        toDate: null,
        source: "organiser",
        setBy: family.organiser.id,
        createdAt: NOW,
      });
    });
    const set = pg.track(
      setApiAway(pg.jobDeps(writer), sam, "away-sam", family.family.id, family.member.id, {
        from: today,
        until: null,
      }),
    );
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], set);
    await held.release();
    const [result] = await pg.settle("Sam's away", [set]);

    expect(result?.status).toBe("fulfilled");
    expect(await seeder.db.select().from(awayPeriods)).toHaveLength(1);
  });
});
