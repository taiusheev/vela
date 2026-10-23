/** Her chat's Keep and "memories off" at once: nothing she cleared may survive. */
import { answers, consents, members, memoryKeeps } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { keepMemoryFromChat } from "../src/memory-keeps.ts";
import { handleParentCommand } from "../src/parent-commands.ts";
import { proposeMemoryCandidate, RICH_MEMORY_CONSENT_VERSION } from "../src/rich-memories.ts";
import { type SeededFamily, seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let seed: SeededFamily;
let candidateId: string;
const WORDS = "We took the night train to the sea.";
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  seed = await seedFamily(seeder.db, { now: NOW });
  await seeder.db.insert(consents).values({
    memberId: seed.member.id,
    subjectRef: `member:${seed.member.id}`,
    kind: "rich_memories",
    answer: "yes",
    textVersion: RICH_MEMORY_CONSENT_VERSION,
    lang: "en",
    channel: "telegram",
    givenAt: new Date(NOW.getTime() - 60_000),
  });
  const exchange = await seedExchange(seeder.db, seed, { date: "2026-09-14" });
  const [answer] = await seeder.db
    .insert(answers)
    .values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text: WORDS },
      receivedAt: NOW,
    })
    .returning();
  if (!answer) throw new Error("Missing answer");
  const id = await proposeMemoryCandidate(
    deps(seeder),
    { source_answer_id: answer.id, kind: "story", start: 0, end: WORDS.length },
    { answerId: answer.id, ordinaryText: WORDS },
  );
  if (!id) throw new Error("Missing candidate");
  candidateId = id;
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});
function deps(client: RaceClient) {
  const job = pg.jobDeps(client);
  return { ...job, config: { ...job.config, richMemories: true, memoryDiscovery: true } };
}

describe("memories in her chat on independent PostgreSQL connections", () => {
  it("leaves nothing kept when Keep and “memories off” race", async () => {
    const [keeper, clearer, holder] = await pg.clientPool("chat-memories", 3);
    if (!keeper || !clearer || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(members).where(eq(members.id, seed.member.id)).for("share"),
    );
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
    await pg.waitForRowLockWait(clearer, [holder], off);
    const keep = pg.track(
      keepMemoryFromChat(deps(keeper), seed.member.id, candidateId, {
        channel: "telegram",
        evidence: { chat_id: seed.memberLink.externalId, text_sha256: "a".repeat(64) },
      }),
    );
    await pg.waitForRowLockWaitOrCompletion(keeper, [clearer, holder], keep);
    await held.release();
    expect(await pg.settle("memories off", [off])).toMatchObject([{ status: "fulfilled" }]);
    await pg.settle("keep", [keep]);
    expect(await seeder.db.select().from(memoryKeeps)).toEqual([]);
    const [consent] = await seeder.db
      .select()
      .from(consents)
      .where(and(eq(consents.memberId, seed.member.id), eq(consents.kind, "rich_memories")));
    expect(consent?.withdrawnAt).not.toBeNull();
  });
});
