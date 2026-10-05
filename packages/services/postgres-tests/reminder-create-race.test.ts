/**
 * "Remind me to ask" on independent PostgreSQL connections (spec §12, build plan 5.3). A member has
 * at most one reminder per fact (`reminders_one_per_fact`). The holder is a reminder for the same
 * member and fact, inserted and not yet committed, as another write of that member's would be; the
 * tap waits on the key and, with `on conflict do nothing`, answers with the holder's reminder once
 * it commits. Without the guard the tap fails on the key.
 */

import { localDateOf } from "@vela/core";
import { members, memoryFacts, reminders, users, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { createApiReminder } from "../src/reminders.ts";
import { seedFamily } from "../src/testing/seed.ts";
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

async function seedPlan(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  const [account] = await db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (account === undefined) throw new Error("expected Mia's account");
  await db.update(members).set({ userId: account.id }).where(eq(members.id, family.organiser.id));
  const today = localDateOf(NOW, family.member.tz);
  const on = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  const [fact] = await db
    .insert(memoryFacts)
    .values({
      familyId: family.family.id,
      memberId: family.member.id,
      kind: "date",
      text: "lunch with Auntie Lin",
      onDate: on,
      expiresAt: new Date(Date.parse(`${on}T00:00:00Z`) + 3 * 86_400_000),
    })
    .returning();
  if (fact === undefined) throw new Error("expected a fact");
  return { family, fact, on };
}

describe("Remind me to ask on independent PostgreSQL connections", () => {
  it("answers with the one reminder when another write of the member's makes it at the same time", async () => {
    const { family, fact, on } = await seedPlan(seeder.db);
    const [tap, holder] = await pg.clientPool("reminder", 2);
    if (tap === undefined || holder === undefined) throw new Error("expected two connections");

    const held = await pg.holdRows(holder, (tx) =>
      tx.insert(reminders).values({
        familyId: family.family.id,
        memberId: family.organiser.id,
        aboutMemberId: family.member.id,
        text: fact.text,
        dueDate: on,
        factId: fact.id,
      }),
    );
    const made = pg.track(
      createApiReminder(pg.jobDeps(tap), mia, "remind", family.family.id, { fact_id: fact.id }),
    );
    await pg.waitForRowLockWaitOrCompletion(tap, [holder], made);
    await held.release();
    const [result] = await pg.settle("the tap", [made]);

    expect(result?.status).toBe("fulfilled");
    expect(await seeder.db.select().from(reminders)).toHaveLength(1);
  });
});
