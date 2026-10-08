/** An organiser waiting on a parent lock must use the time committed by the preceding writer. */
import { localDateOf } from "@vela/core";
import { members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setApiMorningPreferences } from "../src/api-morning-preferences.ts";
import { seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
const who = { authSubject: "pg-morning|Mia", sessionId: "morning-session" };
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
describe("morning preference lock overlap", () => {
  it("reads the newly effective time after waiting, preserving it for today", async () => {
    const family = await seedFamily(seeder.db, { now: NOW });
    const [user] = await seeder.db
      .insert(users)
      .values({ authSubject: who.authSubject, displayName: "Mia" })
      .returning();
    await seeder.db
      .update(members)
      .set({ userId: user?.id ?? null })
      .where(eq(members.id, family.organiser.id));
    const [writer, holder] = await pg.clientPool("morning", 2);
    if (!writer || !holder) throw new Error("expected two connections");
    const today = localDateOf(NOW, family.member.tz);
    const held = await pg.holdRows(holder, async (tx) => {
      await tx.select().from(members).where(eq(members.id, family.member.id)).for("update");
      await tx
        .update(members)
        .set({ pendingArrivalTime: "06:00", pendingArrivalDate: today })
        .where(eq(members.id, family.member.id));
    });
    const save = pg.track(
      setApiMorningPreferences(
        writer.deps,
        who,
        "morning-new",
        family.family.id,
        family.member.id,
        { arrival_time: "10:00", language: "en" },
      ),
    );
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], save);
    await held.release();
    const [result] = await pg.settle("morning edit", [save]);
    expect(result?.status).toBe("fulfilled");
    const [member] = await seeder.db.select().from(members).where(eq(members.id, family.member.id));
    expect(member).toMatchObject({
      arrivalTime: "06:00",
      pendingArrivalTime: "10:00",
      pendingArrivalDate: "2026-09-15",
    });
  });
});
