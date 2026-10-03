/**
 * Keeping a story in the family book on independent PostgreSQL connections (ADR-39). Her first
 * answer to a story makes the book's entry; two answers to the same story at once (a voice note and
 * the words after it, or a redelivery) both try to make it. The unique key on the exchange and
 * `on conflict do nothing` make the second read the first's entry, so one story is one entry.
 * Without the guard the second insert fails on the key.
 */

import { answers, bookEntries, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { keepInBook } from "../src/book.ts";
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

async function seedStory(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  const story = await seedExchange(db, family, {
    date: "2026-09-14",
    type: "story",
    text: "Tell me how you met Dad.",
    state: "answered",
    deliveredAt: NOW,
  });
  const said = await db
    .insert(answers)
    .values([
      {
        exchangeId: story.id,
        memberId: family.member.id,
        kind: "text",
        channel: "telegram",
        externalId: "chat:1",
        payload: { text: "At the station." },
        receivedAt: NOW,
      },
      {
        exchangeId: story.id,
        memberId: family.member.id,
        kind: "text",
        channel: "telegram",
        externalId: "chat:2",
        payload: { text: "It was raining." },
        receivedAt: NOW,
      },
    ])
    .returning();
  return { story, said };
}

describe("keeping a story on independent PostgreSQL connections", () => {
  it("makes one entry when two answers to the same story keep it at once", async () => {
    const { story, said } = await seedStory(seeder.db);
    const [first, second, holder] = await pg.clientPool("book", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const [one, two] = said;
    if (one === undefined || two === undefined) throw new Error("expected two answers");

    // The holder is a first keep, its entry inserted and not yet committed; both answers wait on it.
    const held = await pg.holdRows(holder, (tx) =>
      tx.insert(bookEntries).values({
        familyId: story.familyId,
        memberId: story.recipientId,
        exchangeId: story.id,
        keptAt: NOW,
      }),
    );
    const keepOne = pg.track(keepInBook(pg.jobDeps(first), story, one));
    await pg.waitForRowLockWaitOrCompletion(first, [holder], keepOne);
    const keepTwo = pg.track(keepInBook(pg.jobDeps(second), story, two));
    await pg.waitForRowLockWaitOrCompletion(second, [holder], keepTwo);
    await held.release();
    const results = await pg.settle("both keeps", [keepOne, keepTwo]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const entries = await seeder.db
      .select()
      .from(bookEntries)
      .where(eq(bookEntries.exchangeId, story.id));
    expect(entries).toHaveLength(1);
  });
});
