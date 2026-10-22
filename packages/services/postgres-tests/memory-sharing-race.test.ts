import {
  MEMORY_KEEP_EXPLANATION_EN,
  MEMORY_KEEP_VERSION,
  MEMORY_SHARE_VERSION,
} from "@vela/contracts";
import {
  answers,
  consents,
  families,
  members,
  memoryKeeps,
  memoryShares,
  memorySharingPresentations,
  users,
  type VelaDatabase,
} from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/hash.ts";
import { withdrawOwnMemoryConsent } from "../src/memory-consent.ts";
import { keepMemoryCandidate, loadSharedKeptMemories } from "../src/memory-keeps.ts";
import {
  confirmMemorySharing,
  createMemorySharingPresentation,
  loadMemorySharingPresentation,
  loadMemorySharingView,
  stopSharingMemory,
} from "../src/memory-sharing.ts";
import { proposeMemoryCandidate, RICH_MEMORY_CONSENT_VERSION } from "../src/rich-memories.ts";
import { seedExchange, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seed: RaceClient;
const identity = { authSubject: "synthetic|postgres-sharing-owner", sessionId: "synthetic" };
const reader = { authSubject: "synthetic|postgres-sharing-reader", sessionId: "synthetic" };
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
async function setup() {
  const db = seed.db;
  const family = await seedFamily(db, { now: NOW });
  for (const [subject, member] of [
    [identity.authSubject, family.member],
    ["synthetic|postgres-sharing-reader", family.organiser],
  ] as const) {
    const [user] = await db
      .insert(users)
      .values({ authSubject: subject, displayName: "Synthetic" })
      .returning();
    if (!user) throw new Error("Missing synthetic account");
    await db.update(members).set({ userId: user.id }).where(eq(members.id, member.id));
  }
  await db.insert(consents).values({
    memberId: family.member.id,
    subjectRef: `member:${family.member.id}`,
    kind: "rich_memories",
    answer: "yes",
    textVersion: RICH_MEMORY_CONSENT_VERSION,
    lang: "en",
    channel: "app",
    givenAt: new Date(NOW.getTime() - 1000),
  });
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
  if (!answer) throw new Error("Missing synthetic answer");
  const candidateId = await proposeMemoryCandidate(
    deps(seed),
    { source_answer_id: answer.id, kind: "preference", start: 0, end: words.length },
    { answerId: answer.id, ordinaryText: words },
  );
  if (!candidateId) throw new Error("Missing synthetic candidate");
  await keepMemoryCandidate(deps(seed), identity, "synthetic-keep", family.family.id, {
    candidate_id: candidateId,
    confirmation_version: MEMORY_KEEP_VERSION,
    confirmation_sha256: await sha256Hex(MEMORY_KEEP_EXPLANATION_EN),
  });
  const [kept] = await db.select().from(memoryKeeps);
  if (!kept) throw new Error("Missing synthetic keep");
  const made = await createMemorySharingPresentation(
    deps(seed),
    identity,
    "synthetic-prepare",
    family.family.id,
    { memory_id: kept.id, recipient_ids: [family.organiser.id] },
  );
  const body = made.response.body;
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.id !== "string"
  )
    throw new Error("Missing synthetic presentation");
  const id = body.id;
  const preview = await loadMemorySharingPresentation(deps(seed), identity, family.family.id, id);
  if (!preview) throw new Error("Missing synthetic preview");
  return {
    family,
    answer,
    kept,
    choice: {
      presentation_id: id,
      presentation_sha256: preview.presentation_sha256,
      confirmation_version: MEMORY_SHARE_VERSION,
    },
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function confirm(client: RaceClient, row: Setup, key: string) {
  try {
    const result = await confirmMemorySharing(
      deps(client),
      identity,
      key,
      row.family.family.id,
      row.choice,
    );
    return { kind: "shared", replayed: result.replayed };
  } catch (error) {
    return {
      kind: "rejected",
      code: error instanceof Error && "code" in error ? error.code : "unknown",
    };
  }
}

describe("named-memory sharing on independent PostgreSQL connections", () => {
  it("reads one read-only snapshot across a concurrent stop, then refreshes to private", async () => {
    const row = await setup();
    expect(await confirm(seed, row, "synthetic-initial-share")).toMatchObject({ kind: "shared" });
    const [readerClient, writer] = await pg.clientPool("sharing-view-snapshot", 2);
    if (!readerClient || !writer) throw new Error("Missing clients");
    let mode: unknown;
    // Establish a real snapshot, commit a separate revocation, then run the service's reads.
    // No production hook or timing-based sleep is needed. The service supplies isolation/mode.
    const observedDb = new Proxy(readerClient.db, {
      get(target, property, receiver) {
        if (property !== "transaction") return Reflect.get(target, property, receiver);
        return (
          run: Parameters<VelaDatabase["transaction"]>[0],
          config: Parameters<VelaDatabase["transaction"]>[1],
        ) =>
          target.transaction(async (tx) => {
            const settings = await tx.execute(
              sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as mode`,
            );
            mode = settings.rows[0];
            await tx.select({ id: memoryKeeps.id }).from(memoryKeeps);
            await stopSharingMemory(
              deps(writer),
              identity,
              "synthetic-concurrent-stop",
              row.family.family.id,
              row.kept.id,
            );
            return run(tx);
          }, config);
      },
    });
    const snapshot = await loadMemorySharingView(
      { ...deps(readerClient), db: observedDb },
      identity,
      row.family.family.id,
      row.kept.id,
    );
    expect(snapshot?.recipients).toMatchObject([
      { member_id: row.family.organiser.id, shared: true },
    ]);
    expect(mode).toMatchObject({ isolation: "repeatable read", mode: "on" });
    expect(await seed.db.select().from(memoryShares)).toEqual([]);
    const fresh = await loadMemorySharingView(
      deps(seed),
      identity,
      row.family.family.id,
      row.kept.id,
    );
    expect(fresh?.recipients).toMatchObject([
      { member_id: row.family.organiser.id, shared: false },
    ]);
    expect(fresh?.revision).not.toBe(snapshot?.revision);
    expect((await loadSharedKeptMemories(deps(seed), reader, row.family.family.id))?.items).toEqual(
      [],
    );
  });
  it("cannot confirm an old choice queued behind stop-sharing", async () => {
    const row = await setup();
    const [stopper, confirmer, holder] = await pg.clientPool("stop-share", 3);
    if (!stopper || !confirmer || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(families).where(eq(families.id, row.family.family.id)).for("share"),
    );
    const stop = pg.track(
      stopSharingMemory(
        deps(stopper),
        identity,
        "synthetic-stop",
        row.family.family.id,
        row.kept.id,
      ),
    );
    await pg.waitForRowLockWait(stopper, [holder], stop);
    const retry = pg.track(confirm(confirmer, row, "synthetic-confirm"));
    await pg.waitForActorLockWait(confirmer, [stopper], retry);
    await held.release();
    expect(await pg.settle("stop", [stop])).toMatchObject([{ status: "fulfilled" }]);
    expect(await pg.settle("confirm after stop", [retry])).toMatchObject([
      { status: "fulfilled", value: { kind: "rejected" } },
    ]);
    expect(await seed.db.select().from(memoryShares)).toEqual([]);
    expect(await seed.db.select().from(memorySharingPresentations)).toEqual([]);
    expect(await seed.db.select().from(memoryKeeps)).toHaveLength(1);
    expect((await loadSharedKeptMemories(deps(seed), reader, row.family.family.id))?.items).toEqual(
      [],
    );
  });

  it("cannot confirm an old choice queued behind purpose withdrawal", async () => {
    const row = await setup();
    const [withdrawer, confirmer, holder] = await pg.clientPool("withdraw-share", 3);
    if (!withdrawer || !confirmer || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(members).where(eq(members.id, row.family.member.id)).for("share"),
    );
    const withdrawal = pg.track(
      withdrawOwnMemoryConsent(
        deps(withdrawer),
        identity,
        "synthetic-withdraw",
        row.family.family.id,
      ),
    );
    await pg.waitForRowLockWait(withdrawer, [holder], withdrawal);
    const retry = pg.track(confirm(confirmer, row, "synthetic-confirm"));
    await pg.waitForActorLockWait(confirmer, [withdrawer], retry);
    await held.release();
    expect(await pg.settle("withdraw", [withdrawal])).toMatchObject([{ status: "fulfilled" }]);
    expect(await pg.settle("confirm after withdrawal", [retry])).toMatchObject([
      { status: "fulfilled", value: { kind: "rejected" } },
    ]);
    expect(await seed.db.select().from(memoryShares)).toEqual([]);
    expect(await seed.db.select().from(memoryKeeps)).toEqual([]);
  });

  it("rejects a confirmation waiting behind a recipient's departure and rejoin", async () => {
    const row = await setup();
    const [changer, confirmer] = await pg.clientPool("leave-before-share", 2);
    if (!changer || !confirmer) throw new Error("Missing clients");
    const held = await pg.holdRows(changer, async (tx) => {
      await tx.update(members).set({ leftAt: NOW }).where(eq(members.id, row.family.organiser.id));
      await tx.update(members).set({ leftAt: null }).where(eq(members.id, row.family.organiser.id));
    });
    const retry = pg.track(confirm(confirmer, row, "synthetic-confirm"));
    await pg.waitForRowLockWaitOrCompletion(confirmer, [changer], retry);
    await held.release();
    expect(await pg.settle("confirm after rejoin", [retry])).toMatchObject([
      { status: "fulfilled", value: { kind: "rejected" } },
    ]);
    expect(await seed.db.select().from(memoryShares)).toEqual([]);
  });

  it("rejects a confirmation waiting behind source correction", async () => {
    const row = await setup();
    const [changer, confirmer] = await pg.clientPool("correct-before-share", 2);
    if (!changer || !confirmer) throw new Error("Missing clients");
    const held = await pg.holdRows(changer, (tx) =>
      tx
        .update(answers)
        .set({ payload: { text: "Different words." } })
        .where(eq(answers.id, row.answer.id)),
    );
    const retry = pg.track(confirm(confirmer, row, "synthetic-confirm"));
    await pg.waitForRowLockWaitOrCompletion(confirmer, [changer], retry);
    await held.release();
    expect(await pg.settle("confirm after correction", [retry])).toMatchObject([
      { status: "fulfilled", value: { kind: "rejected" } },
    ]);
    expect(await seed.db.select().from(memoryShares)).toEqual([]);
    expect(await seed.db.select().from(memoryKeeps)).toEqual([]);
  });

  it("clears a grant when departure waits behind an in-flight confirmation", async () => {
    const row = await setup();
    const [confirmer, leaver, holder] = await pg.clientPool("share-before-leave", 3);
    if (!confirmer || !leaver || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(answers).where(eq(answers.id, row.answer.id)).for("update"),
    );
    const sharing = pg.track(confirm(confirmer, row, "synthetic-confirm"));
    await pg.waitForRowLockWait(confirmer, [holder], sharing);
    const leave = pg.track(
      leaver.db
        .update(members)
        .set({ leftAt: NOW })
        .where(eq(members.id, row.family.organiser.id))
        .execute(),
    );
    await pg.waitForRowLockWaitOrCompletion(leaver, [confirmer], leave);
    await held.release();
    expect(await pg.settle("confirmation", [sharing])).toMatchObject([
      { status: "fulfilled", value: { kind: "shared" } },
    ]);
    expect(await pg.settle("departure", [leave])).toMatchObject([{ status: "fulfilled" }]);
    expect(await seed.db.select().from(memoryShares)).toEqual([]);
    expect(await seed.db.select().from(memorySharingPresentations)).toEqual([]);
  });

  it("consumes a presentation once under duplicate confirmations with different keys", async () => {
    const row = await setup();
    const [first, second, holder] = await pg.clientPool("duplicate-share", 3);
    if (!first || !second || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(families).where(eq(families.id, row.family.family.id)).for("share"),
    );
    const one = pg.track(confirm(first, row, "synthetic-confirm-one"));
    await pg.waitForRowLockWait(first, [holder], one);
    const two = pg.track(confirm(second, row, "synthetic-confirm-two"));
    await pg.waitForActorLockWait(second, [first], two);
    await held.release();
    expect(await pg.settle("duplicate confirmation", [one, two])).toMatchObject([
      { status: "fulfilled", value: { kind: "shared", replayed: false } },
      { status: "fulfilled", value: { kind: "rejected", code: "illegal_state" } },
    ]);
    expect(await seed.db.select().from(memoryShares)).toHaveLength(1);
    const page = await loadSharedKeptMemories(deps(seed), reader, row.family.family.id);
    expect(page?.items).toHaveLength(1);
    expect(page?.items[0]?.quote).toBe(words);
    expect(page?.items[0]).not.toHaveProperty("source_answer_id");
    expect(page?.items[0]).not.toHaveProperty("source_available");
    const [presentation] = await seed.db.select().from(memorySharingPresentations);
    expect(presentation?.consumedAt).not.toBeNull();
  });

  it("rejects a confirmation queued behind an account subject change", async () => {
    const row = await setup();
    const [changer, confirmer] = await pg.clientPool("account-before-share", 2);
    if (!changer || !confirmer) throw new Error("Missing clients");
    const held = await pg.holdRows(changer, (tx) =>
      tx
        .update(users)
        .set({ authSubject: "synthetic|replacement-reader" })
        .where(eq(users.authSubject, "synthetic|postgres-sharing-reader")),
    );
    const sharing = pg.track(confirm(confirmer, row, "synthetic-confirm"));
    await pg.waitForRowLockWaitOrCompletion(confirmer, [changer], sharing);
    await held.release();
    expect(await pg.settle("confirmation after account change", [sharing])).toMatchObject([
      { status: "fulfilled", value: { kind: "rejected" } },
    ]);
    expect(await seed.db.select().from(memoryShares)).toEqual([]);
    expect(await seed.db.select().from(memorySharingPresentations)).toEqual([]);
  });

  it("purges a grant when account subject change waits behind an in-flight confirmation", async () => {
    const row = await setup();
    const [confirmer, changer, holder] = await pg.clientPool("share-before-account", 3);
    if (!confirmer || !changer || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(answers).where(eq(answers.id, row.answer.id)).for("update"),
    );
    const sharing = pg.track(confirm(confirmer, row, "synthetic-confirm"));
    await pg.waitForRowLockWait(confirmer, [holder], sharing);
    const change = pg.track(
      changer.db
        .update(users)
        .set({ authSubject: "synthetic|replacement-reader" })
        .where(eq(users.authSubject, "synthetic|postgres-sharing-reader"))
        .execute(),
    );
    await pg.waitForRowLockWaitOrCompletion(changer, [confirmer], change);
    await held.release();
    expect(await pg.settle("confirmation", [sharing])).toMatchObject([
      { status: "fulfilled", value: { kind: "shared" } },
    ]);
    expect(await pg.settle("account change", [change])).toMatchObject([{ status: "fulfilled" }]);
    expect(await seed.db.select().from(memoryShares)).toEqual([]);
    expect(await seed.db.select().from(memorySharingPresentations)).toEqual([]);
  });
});
