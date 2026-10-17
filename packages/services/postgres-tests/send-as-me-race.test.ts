/**
 * First test (16 Oct 2026): an organiser may have Vela's suggestion, drafted in their own style, sent
 * in their name on a morning nobody wrote for. Their choice lives on her member row and is read by
 * the 22:00 preparation under that row's `for update`, the lock the choice is changed under
 * (`setApiMorningPreferences`). So a choice turned off while the preparation waits is seen off, and
 * nothing goes to her in their name after they said no — which PGlite, on one connection, cannot
 * prove.
 */
import { addDays, localDateOf } from "@vela/core";
import { exchanges, members, suggestions, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepareDay } from "../src/arrivals.ts";
import type { Deps } from "../src/deps.ts";
import { type SeededFamily, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

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

/** Her family with Mia's choice on, and tomorrow's draft written in Mia's voice. */
async function seedSigned(db: VelaDatabase): Promise<{ family: SeededFamily; tomorrow: string }> {
  const family = await seedFamily(db, { now: NOW });
  const tomorrow = addDays(localDateOf(NOW, family.member.tz), 1);
  await db
    .update(members)
    .set({ suggestionsSignedBy: family.organiser.id })
    .where(eq(members.id, family.member.id));
  await db.insert(suggestions).values({
    familyId: family.family.id,
    forMemberId: family.organiser.id,
    aboutMemberId: family.member.id,
    localDay: tomorrow,
    bankId: "opinions.taste.season",
    type: "question",
    text: "Mom, which season do you love most?",
    lang: "en",
    promptVersion: "test",
  });
  return { family, tomorrow };
}

/** The 22:00 preparation's deps on its own connection, where the environment allows the choice. */
function preparerDeps(client: RaceClient): Deps {
  const deps = pg.jobDeps(client);
  return { ...deps, config: { ...deps.config, sendAsMe: true } };
}

describe("an organiser's choice to send as them, changed as the 22:00 preparation runs", () => {
  it("prepares Vela's own question when the choice is turned off while the preparation waits on her row", async () => {
    const { family, tomorrow } = await seedSigned(seeder.db);
    const [preparer, holder] = await pg.clientPool("send-as-me-off", 2);
    if (preparer === undefined || holder === undefined) throw new Error("expected two connections");

    // Mia turns it off: her save holds the parent's row, as `setApiMorningPreferences` does.
    const held = await pg.holdRows(holder, async (tx) => {
      await tx.select().from(members).where(eq(members.id, family.member.id)).for("update");
      await tx
        .update(members)
        .set({ suggestionsSignedBy: null })
        .where(eq(members.id, family.member.id));
    });
    const preparing = pg.track(prepareDay(preparerDeps(preparer), family.member.id, tomorrow));
    await pg.waitForRowLockWaitOrCompletion(preparer, [holder], preparing);
    await held.release();
    const [result] = await pg.settle("the preparation", [preparing]);
    expect(result?.status).toBe("fulfilled");

    const prepared = await seeder.db
      .select()
      .from(exchanges)
      .where(eq(exchanges.recipientId, family.member.id));
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({ type: "hello", askerId: null, draftedByVela: false });
  });

  it("sends the draft in Mia's name when a save that keeps her choice holds the row", async () => {
    const { family, tomorrow } = await seedSigned(seeder.db);
    const [preparer, holder] = await pg.clientPool("send-as-me-on", 2);
    if (preparer === undefined || holder === undefined) throw new Error("expected two connections");

    const held = await pg.holdRows(holder, async (tx) => {
      await tx.select().from(members).where(eq(members.id, family.member.id)).for("update");
      await tx
        .update(members)
        .set({ arrivalTime: "08:30" })
        .where(eq(members.id, family.member.id));
    });
    const preparing = pg.track(prepareDay(preparerDeps(preparer), family.member.id, tomorrow));
    await pg.waitForRowLockWaitOrCompletion(preparer, [holder], preparing);
    await held.release();
    const [result] = await pg.settle("the preparation", [preparing]);
    expect(result?.status).toBe("fulfilled");

    const prepared = await seeder.db
      .select()
      .from(exchanges)
      .where(eq(exchanges.recipientId, family.member.id));
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      type: "question",
      askerId: family.organiser.id,
      text: "Mom, which season do you love most?",
      draftedByVela: true,
    });
  });
});
