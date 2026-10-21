import { MEMORY_KEEP_EXPLANATION_EN, MEMORY_KEEP_VERSION } from "@vela/contracts";
import {
  answers,
  consents,
  exchanges,
  families,
  members,
  memoryCandidates,
  memoryKeeps,
  users,
  type VelaDatabase,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/hash.ts";
import { withdrawOwnMemoryConsent } from "../src/memory-consent.ts";
import { keepMemoryCandidate, removeKeptMemory } from "../src/memory-keeps.ts";
import { proposeMemoryCandidate, RICH_MEMORY_CONSENT_VERSION } from "../src/rich-memories.ts";
import { seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seed: RaceClient;
const identity = { authSubject: "synthetic|postgres-memory-owner", sessionId: "synthetic-session" };
const words = "I love yellow flowers.";
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seed = await pg.client("seed");
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});
const deps = (client: RaceClient) => {
  const job = pg.jobDeps(client);
  return { ...job, config: { ...job.config, richMemories: true } };
};
async function source(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  const [user] = await db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
    .returning();
  if (!user) throw new Error("Missing synthetic account");
  await db.update(members).set({ userId: user.id }).where(eq(members.id, family.member.id));
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
  const exchange = await seedExchange(db, family, { date: "2026-09-14" });
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
  if (!answer || !consent) throw new Error("Missing source");
  const id = await proposeMemoryCandidate(
    deps(seed),
    { source_answer_id: answer.id, kind: "preference", start: 0, end: words.length },
    { answerId: answer.id, ordinaryText: words },
  );
  if (!id) throw new Error("Missing candidate");
  const choice = {
    candidate_id: id,
    confirmation_version: MEMORY_KEEP_VERSION,
    confirmation_sha256: await sha256Hex(MEMORY_KEEP_EXPLANATION_EN),
  };
  return { family, answer, consent, choice };
}
type Source = Awaited<ReturnType<typeof source>>;
async function keep(client: RaceClient, row: Source, key: string) {
  try {
    const result = await keepMemoryCandidate(
      deps(client),
      identity,
      key,
      row.family.family.id,
      row.choice,
    );
    return { kind: "kept", body: result.response.body };
  } catch (error) {
    return {
      kind: "rejected",
      code: error instanceof Error && "code" in error ? error.code : "unknown",
    };
  }
}

describe("durable memory privacy on independent PostgreSQL connections", () => {
  it("clears proposals that finish while withdrawal waits for the author's exclusive member lock", async () => {
    const row = await source(seed.db);
    const [withdrawer, proposer, holder] = await pg.clientPool("withdraw-proposal", 3);
    if (!withdrawer || !proposer || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(members).where(eq(members.id, row.family.member.id)).for("share"),
    );
    const withdrawal = pg.track(
      withdrawOwnMemoryConsent(
        deps(withdrawer),
        identity,
        "synthetic:withdraw:proposal",
        row.family.family.id,
      ),
    );
    await pg.waitForRowLockWait(withdrawer, [holder], withdrawal);
    const proposal = pg.track(
      proposeMemoryCandidate(
        deps(proposer),
        { source_answer_id: row.answer.id, kind: "preference", start: 0, end: words.length },
        { answerId: row.answer.id, ordinaryText: words },
      ),
    );
    await pg.waitForRowLockWaitOrCompletion(proposer, [withdrawer, holder], proposal);
    await held.release();
    expect(await pg.settle("withdrawal", [withdrawal])).toMatchObject([{ status: "fulfilled" }]);
    // PostgreSQL may let a compatible SHARE lock finish before the waiting UPDATE lock.
    // Such a proposal is valid before withdrawal, but none may survive its commit.
    expect(await pg.settle("racing proposal", [proposal])).toMatchObject([{ status: "fulfilled" }]);
    expect(await seed.db.select().from(memoryCandidates)).toHaveLength(0);
    expect(await seed.db.select().from(memoryKeeps)).toHaveLength(0);
    expect(
      await proposeMemoryCandidate(
        deps(proposer),
        { source_answer_id: row.answer.id, kind: "preference", start: 0, end: words.length },
        { answerId: row.answer.id, ordinaryText: words },
      ),
    ).toBeNull();
  });
  it("cannot revive kept words through a retry queued behind purpose withdrawal", async () => {
    const row = await source(seed.db);
    await keep(seed, row, "synthetic:withdraw:initial");
    const [withdrawer, keeper, holder] = await pg.clientPool("withdraw-keep", 3);
    if (!withdrawer || !keeper || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(members).where(eq(members.id, row.family.member.id)).for("share"),
    );
    const withdrawal = pg.track(
      withdrawOwnMemoryConsent(
        deps(withdrawer),
        identity,
        "synthetic:withdraw:keep",
        row.family.family.id,
      ),
    );
    await pg.waitForRowLockWait(withdrawer, [holder], withdrawal);
    const retry = pg.track(keep(keeper, row, "synthetic:withdraw:initial"));
    await pg.waitForActorLockWait(keeper, [withdrawer], retry);
    await held.release();
    expect(await pg.settle("withdrawal", [withdrawal])).toMatchObject([{ status: "fulfilled" }]);
    expect(await pg.settle("retry after withdrawal", [retry])).toMatchObject([
      { status: "fulfilled", value: { kind: "rejected" } },
    ]);
    expect(await seed.db.select().from(memoryKeeps)).toHaveLength(0);
    expect(await seed.db.select().from(memoryCandidates)).toHaveLength(0);
  });
  it("serializes duplicate keeps with different request keys and creates one grant", async () => {
    const row = await source(seed.db);
    const [one, two, holder] = await pg.clientPool("duplicate-keep", 3);
    if (!one || !two || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(answers).where(eq(answers.id, row.answer.id)).for("update"),
    );
    const first = pg.track(keep(one, row, "synthetic:duplicate:one"));
    await pg.waitForRowLockWaitOrCompletion(one, [holder], first);
    const second = pg.track(keep(two, row, "synthetic:duplicate:two"));
    await pg.waitForActorLockWait(two, [one], second);
    await held.release();
    const results = await pg.settle("duplicate keeps", [first, second]);
    expect(results[0]).toMatchObject({ status: "fulfilled", value: { kind: "kept" } });
    expect(results[1]).toEqual(results[0]);
    expect(await seed.db.select().from(memoryKeeps)).toHaveLength(1);
    expect(
      await seed.db.select().from(consents).where(eq(consents.kind, "memory_keep")),
    ).toHaveLength(1);
  });
  it.each([
    "withdraw",
    "correct",
    "delete-source",
    "delete-family",
    "new-consent",
    "delete-exchange",
    "transfer-exchange",
  ] as const)("never keeps stale words when %s wins its lock", async (change) => {
    const row = await source(seed.db);
    const other =
      change === "transfer-exchange"
        ? await seedFamily(seed.db, {
            now: NOW,
            organiserExternalId: "40001",
            memberExternalId: "40002",
          })
        : null;
    const [writer, holder] = await pg.clientPool("privacy-wins", 2);
    if (!writer || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, async (tx) => {
      if (change === "withdraw")
        await tx.update(consents).set({ withdrawnAt: NOW }).where(eq(consents.id, row.consent.id));
      if (change === "correct")
        await tx
          .update(answers)
          .set({ payload: { text: "Corrected synthetic words." } })
          .where(eq(answers.id, row.answer.id));
      if (change === "delete-source") await tx.delete(answers).where(eq(answers.id, row.answer.id));
      if (change === "delete-exchange")
        await tx.delete(exchanges).where(eq(exchanges.id, row.answer.exchangeId));
      if (change === "transfer-exchange" && other !== null)
        await tx
          .update(exchanges)
          .set({ familyId: other.family.id })
          .where(eq(exchanges.id, row.answer.exchangeId));
      if (change === "delete-family")
        await tx
          .update(families)
          .set({ deletedAt: NOW })
          .where(eq(families.id, row.family.family.id));
      if (change === "new-consent")
        await tx.insert(consents).values({
          memberId: row.family.member.id,
          subjectRef: `member:${row.family.member.id}`,
          kind: "rich_memories",
          answer: "no",
          textVersion: RICH_MEMORY_CONSENT_VERSION,
          lang: "en",
          channel: "app",
          givenAt: NOW,
        });
    });
    const pending = pg.track(keep(writer, row, `synthetic:privacy:${change}`));
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], pending);
    await held.release();
    expect(await pg.settle("privacy wins over keeping", [pending])).toMatchObject([
      { status: "fulfilled", value: { kind: "rejected" } },
    ]);
    expect(await seed.db.select().from(memoryKeeps)).toHaveLength(0);
  });
  it("cannot recreate words when removal wins a simultaneous keep retry", async () => {
    const row = await source(seed.db);
    await keep(seed, row, "synthetic:initial:keep");
    const [saved] = await seed.db.select().from(memoryKeeps);
    if (!saved) throw new Error("Missing saved memory");
    const [remover, keeper, holder] = await pg.clientPool("remove-keep", 3);
    if (!remover || !keeper || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(answers).where(eq(answers.id, row.answer.id)).for("update"),
    );
    const removal = pg.track(
      removeKeptMemory(
        deps(remover),
        identity,
        "synthetic:remove:first",
        row.family.family.id,
        saved.id,
      ),
    );
    await pg.waitForRowLockWaitOrCompletion(remover, [holder], removal);
    const keeping = pg.track(keep(keeper, row, "synthetic:keep:too-late"));
    await pg.waitForActorLockWait(keeper, [remover], keeping);
    await held.release();
    expect(await pg.settle("removal", [removal])).toMatchObject([{ status: "fulfilled" }]);
    expect(await pg.settle("late keep", [keeping])).toMatchObject([
      { status: "fulfilled", value: { kind: "rejected" } },
    ]);
    expect((await seed.db.select().from(memoryKeeps))[0]).toMatchObject({
      quote: "",
      sourceDigest: "",
    });
  });
});
