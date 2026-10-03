/**
 * Writing her recipe card on independent PostgreSQL connections (spec §10, ADR-41). Two answers to
 * the same recipe ask can be understood at once, and each writes the card. The exchange's row lock
 * makes the second wait for the first and rewrite its card, so one ask is one card. The holder is a
 * first write, the exchange locked and its card inserted, not yet committed. Without the lock the
 * second reads no card and makes another.
 */
import { exchanges, recipes, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { offerRecipe } from "../src/recipes.ts";
import { seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

async function seedRecipeAsk(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  const ask = await seedExchange(db, family, {
    date: "2026-09-14",
    type: "recipe",
    text: "How do you make your braised pork?",
    state: "answered",
    deliveredAt: NOW,
  });
  return { family, ask };
}

const CARD = {
  title: "Braised pork",
  ingredients: ["pork belly", "soy sauce"],
  steps: ["Brown the pork.", "Cook it low for an hour."],
  remarks: [],
};

describe("writing her recipe card on independent PostgreSQL connections", () => {
  it("makes one card when two answers to the same ask write it at once", async () => {
    const { family, ask } = await seedRecipeAsk(seeder.db);
    const [writer, holder] = await pg.clientPool("recipe", 2);
    if (writer === undefined || holder === undefined) throw new Error("expected two connections");

    const held = await pg.holdRows(holder, async (tx) => {
      await tx.select().from(exchanges).where(eq(exchanges.id, ask.id)).for("update");
      await tx.insert(recipes).values({
        familyId: family.family.id,
        memberId: family.member.id,
        title: "Braised pork",
        exchangeIds: [ask.id],
        status: "draft",
      });
    });
    const write = pg.track(
      offerRecipe(
        pg.jobDeps(writer),
        { exchange: ask, member: family.member, answerChannel: "telegram" },
        CARD,
      ),
    );
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], write);
    await held.release();
    const [result] = await pg.settle("the second write", [write]);

    expect(result?.status).toBe("fulfilled");
    const cards = await seeder.db.select().from(recipes);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.card).toEqual({
      ingredients: CARD.ingredients,
      steps: CARD.steps,
      remarks: CARD.remarks,
    });
  });
});
