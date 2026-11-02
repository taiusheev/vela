import { answers, consents, families, memoryCandidates, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { proposeMemoryCandidate, RICH_MEMORY_CONSENT_VERSION } from "../src/rich-memories.ts";
import { seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
const words = "I love yellow flowers.";
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

async function seedSource(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  const exchange = await seedExchange(db, family, { date: "2026-09-14" });
  const [consent] = await db
    .insert(consents)
    .values({
      memberId: family.member.id,
      subjectRef: `member:${family.member.id}`,
      kind: "rich_memories",
      answer: "yes",
      textVersion: RICH_MEMORY_CONSENT_VERSION,
      lang: "en",
      channel: "app",
      givenAt: new Date(NOW.getTime() - 1000),
    })
    .returning();
  const [answer] = await db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId: family.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text: words },
      receivedAt: NOW,
    })
    .returning();
  if (!consent || !answer) throw new Error("Missing synthetic source");
  return { family, consent, answer };
}

function propose(client: RaceClient, answerId: string) {
  const deps = pg.jobDeps(client);
  return proposeMemoryCandidate(
    { ...deps, config: { ...deps.config, richMemories: true } },
    { source_answer_id: answerId, kind: "preference", start: 0, end: words.length },
    { answerId, ordinaryText: words },
  );
}

describe("rich memories on independent PostgreSQL connections", () => {
  it("deduplicates simultaneous proposals behind the source-span key", async () => {
    const { answer } = await seedSource(seeder.db);
    const id = await propose(seeder, answer.id);
    if (id === null) throw new Error("Missing candidate");
    const [row] = await seeder.db
      .select()
      .from(memoryCandidates)
      .where(eq(memoryCandidates.id, id));
    if (!row) throw new Error("Missing candidate row");
    await seeder.db.delete(memoryCandidates).where(eq(memoryCandidates.id, id));
    const [one, two, holder] = await pg.clientPool("memory", 3);
    if (!one || !two || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) => tx.insert(memoryCandidates).values(row));
    const first = pg.track(propose(one, answer.id));
    await pg.waitForRowLockWaitOrCompletion(one, [holder], first);
    const second = pg.track(propose(two, answer.id));
    await pg.waitForRowLockWaitOrCompletion(two, [one], second);
    await held.release();
    const results = await pg.settle("both proposals", [first, second]);
    expect(results).toEqual([
      { status: "fulfilled", value: id },
      { status: "fulfilled", value: id },
    ]);
    expect(await seeder.db.select().from(memoryCandidates)).toHaveLength(1);
  });

  it.each(["withdraw", "correct", "delete-source", "delete-family"] as const)(
    "does not create a candidate when %s wins the source/consent lock",
    async (change) => {
      const { answer, consent, family } = await seedSource(seeder.db);
      const [worker, holder] = await pg.clientPool("eligibility", 2);
      if (!worker || !holder) throw new Error("Missing clients");
      const held = await pg.holdRows(holder, async (tx) => {
        if (change === "withdraw")
          await tx.update(consents).set({ withdrawnAt: NOW }).where(eq(consents.id, consent.id));
        if (change === "correct")
          await tx
            .update(answers)
            .set({ payload: { text: "Different words." } })
            .where(eq(answers.id, answer.id));
        if (change === "delete-source") await tx.delete(answers).where(eq(answers.id, answer.id));
        if (change === "delete-family")
          await tx
            .update(families)
            .set({ deletedAt: NOW })
            .where(eq(families.id, family.family.id));
      });
      const pending = pg.track(propose(worker, answer.id));
      await pg.waitForRowLockWaitOrCompletion(worker, [holder], pending);
      await held.release();
      expect(await pg.settle("proposal after invalidation", [pending])).toEqual([
        { status: "fulfilled", value: null },
      ]);
      expect(await seeder.db.select().from(memoryCandidates)).toHaveLength(0);
    },
  );
});
