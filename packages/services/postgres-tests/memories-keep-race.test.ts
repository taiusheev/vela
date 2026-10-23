/**
 * An organiser's "Keep" and her "memories off" at once (ADR-50): whichever commits first, nothing of
 * hers may stay kept. Keep takes her member row before anything else, so it cannot read "memories
 * on", wait, and then keep after her "memories off" has already cleared the book.
 */
import { answers, bookEntries, exchanges, members, users } from "@vela/db";
import { eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { keepApiAnswer } from "../src/memories.ts";
import { handleParentCommand } from "../src/parent-commands.ts";
import { type SeededFamily, seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let seed: SeededFamily;
let exchangeId: string;
const mia = { authSubject: "auth|race-mia", sessionId: "session-race-mia" };

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  seed = await seedFamily(seeder.db, { now: NOW });
  const [user] = await seeder.db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (!user) throw new Error("Missing account");
  await seeder.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
  const exchange = await seedExchange(seeder.db, seed, { date: "2026-09-14" });
  exchangeId = exchange.id;
  await seeder.db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: seed.member.id,
    kind: "text",
    channel: "telegram",
    payload: { text: "We took the night train to the sea." },
    receivedAt: NOW,
  });
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function deps(client: RaceClient) {
  const job = pg.jobDeps(client);
  return { ...job, config: { ...job.config, book: true } };
}

describe("keeping her answer on independent PostgreSQL connections", () => {
  it("leaves nothing kept when Keep and “memories off” race", async () => {
    const [keeper, clearer, holder] = await pg.clientPool("family-memories", 3);
    if (!keeper || !clearer || !holder) throw new Error("Missing clients");
    // Keep stalls on the answered morning, after it has read her row.
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(exchanges).where(eq(exchanges.id, exchangeId)).for("update"),
    );
    const keep = pg.track(keepApiAnswer(deps(keeper), mia, "race-keep", exchangeId));
    await pg.waitForRowLockWait(keeper, [holder], keep);
    const [her] = await seeder.db.select().from(members).where(eq(members.id, seed.member.id));
    if (!her) throw new Error("Missing her");
    const off = pg.track(
      handleParentCommand(deps(clearer), her, "memories_off", {
        channel: "telegram",
        eventId: "tg:race:off",
        at: NOW.toISOString(),
        kind: "text",
        text: "memories off",
        sender: { externalUserId: seed.memberLink.externalId },
        conversation: { externalId: seed.memberLink.externalId, kind: "private" },
        messageId: "9",
      }),
    );
    await pg.waitForRowLockWaitOrCompletion(clearer, [keeper], off);
    await held.release();
    await pg.settle("keep", [keep]);
    expect(await pg.settle("memories off", [off])).toMatchObject([{ status: "fulfilled" }]);
    expect(await seeder.db.select().from(bookEntries).where(isNull(bookEntries.removedAt))).toEqual(
      [],
    );
    const [after] = await seeder.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(after?.memoriesOffAt).not.toBeNull();
  });
});
