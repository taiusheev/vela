/**
 * Stories woven from her memories on independent PostgreSQL connections (ADR-51). Two weavings at
 * once never tell the same memory twice: a memory is in one story at most, and a story that loses
 * one of its memories to the other is not told. And a weaving never outlives her "memories off":
 * it takes her member row, shared, and reads "memories off" again under it.
 */
import { answers, keepSuggestions, members, memoryStories, memoryStoryMoments } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleParentCommand } from "../src/parent-commands.ts";
import { weaveStories } from "../src/stories.ts";
import { type SeededFamily, seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let seed: SeededFamily;

const TOMATOES = [
  "I saved the seeds from last summer's tomatoes in an envelope by the radio.",
  "The little tomato plants are as tall as my hand now.",
  "The tomatoes finally turned, and I picked three before breakfast.",
];

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  seed = await seedFamily(seeder.db, { now: NOW });
  for (const [index, text] of TOMATOES.entries()) {
    const exchange = await seedExchange(seeder.db, seed, { date: `2026-09-1${index + 1}` });
    const [answer] = await seeder.db
      .insert(answers)
      .values({
        exchangeId: exchange.id,
        memberId: seed.member.id,
        kind: "text",
        channel: "telegram",
        payload: { text },
        receivedAt: new Date(NOW.getTime() + index * 60_000),
      })
      .returning();
    if (!answer) throw new Error("Missing answer");
    await seeder.db.insert(keepSuggestions).values({
      familyId: seed.family.id,
      memberId: seed.member.id,
      exchangeId: exchange.id,
      answerId: answer.id,
      start: 0,
      end: text.length,
      kind: "moment",
      expiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
    });
  }
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function deps(client: RaceClient) {
  const job = pg.jobDeps(client);
  return {
    ...job,
    config: { ...job.config, book: true, memoryDiscovery: true, memoryStories: true },
  };
}

async function her() {
  const [row] = await seeder.db.select().from(members).where(eq(members.id, seed.member.id));
  if (!row) throw new Error("Missing her");
  return row;
}

const onHerRow = (tx: Parameters<Parameters<PostgresHarness["holdRows"]>[1]>[0]) =>
  tx.select().from(members).where(eq(members.id, seed.member.id)).for("update");

describe("weaving stories on independent PostgreSQL connections", () => {
  it("tells each memory in one story only when two weavings race", async () => {
    const [first, second, holder] = await pg.clientPool("story-weave", 3);
    if (!first || !second || !holder) throw new Error("Missing clients");
    const member = await her();
    // Both have read her memories and stop at her row, then go on together.
    const held = await pg.holdRows(holder, onHerRow);
    const one = pg.track(weaveStories(deps(first), member));
    await pg.waitForRowLockWait(first, [holder], one);
    const two = pg.track(weaveStories(deps(second), member));
    await pg.waitForRowLockWait(second, [holder], two);
    await held.release();
    const made = await pg.settle("weavings", [one, two]);
    expect(
      made.map((result) => (result.status === "fulfilled" ? result.value : -1)).sort(),
    ).toEqual([0, 1]);
    expect(await seeder.db.select().from(memoryStories)).toHaveLength(1);
    expect(await seeder.db.select().from(memoryStoryMoments)).toHaveLength(3);
  });

  it("weaves nothing once her “memories off” has committed first", async () => {
    const [weaver, clearer, holder] = await pg.clientPool("story-off", 3);
    if (!weaver || !clearer || !holder) throw new Error("Missing clients");
    const member = await her();
    const [off, weave] = await pg.queueBehindRowLock<unknown>(holder, onHerRow, [
      {
        client: clearer,
        start: () =>
          handleParentCommand(deps(clearer), member, "memories_off", {
            channel: "telegram",
            eventId: "tg:story-race:off",
            at: NOW.toISOString(),
            kind: "text",
            text: "memories off",
            sender: { externalUserId: seed.memberLink.externalId },
            conversation: { externalId: seed.memberLink.externalId, kind: "private" },
            messageId: "9",
          }),
      },
      { client: weaver, start: () => weaveStories(deps(weaver), member) },
    ]);
    if (!off || !weave) throw new Error("Missing contenders");
    expect(await pg.settle("memories off and weaving", [off, weave])).toMatchObject([
      { status: "fulfilled" },
      { status: "fulfilled", value: 0 },
    ]);
    expect(await seeder.db.select().from(memoryStories)).toEqual([]);
  });
});
