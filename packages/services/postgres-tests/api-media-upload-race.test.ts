/**
 * Uploading a photo for an ask on independent PostgreSQL connections (ADR-33). An upload stores its
 * object before its row exists, under a key minted for that attempt, and then writes the row
 * through `runApiMutation`; PGlite, on one connection, never lets two of them overlap. Here they do:
 *
 * - The same upload sent twice (a phone retrying) queues on the account's actor lock after both
 *   objects are stored. One row may come of it, and one object: the replay deletes its own.
 * - The volume limits hold inside the transaction. An account's uploads are ordered by its actor
 *   lock, so its 20th and 21st photo cannot both be counted as the 20th; a family's members are
 *   different actors, ordered only by the family's own advisory lock, so its 60th and 61st cannot
 *   either.
 *
 * Every contender shares one fake store and one fake token source, as the Worker's isolates share
 * one bucket and never mint the same key: two fresh fakes would both mint `token-1`, and a broken
 * rule would show as a unique-key failure instead of as itself.
 */
import { media, members, users, type VelaDatabase } from "@vela/db";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import {
  MAX_LIVE_PHOTOS_PER_FAMILY,
  MAX_PHOTOS_PER_ACCOUNT_DAY,
  MediaRefusedError,
  type UploadApiMediaDeps,
  uploadApiMedia,
} from "../src/api-media.ts";
import {
  createFakeLogger,
  createFakeMediaStore,
  createFakeRandom,
  type FakeMediaStore,
  type FakeRandom,
} from "../src/testing/fakes.ts";
import { testJpeg } from "../src/testing/jpeg.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import {
  databaseErrorCode,
  HOLD_MS,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
  WAIT_MS,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let store: FakeMediaStore;
let random: FakeRandom;

/** Mia organises; Sam is her brother. Each signs in as her or his own account. */
const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "pg-race|sam", sessionId: "session-sam" };

const DAY_MS = 24 * 60 * 60 * 1_000;

interface Scope {
  readonly familyId: string;
  readonly miaMemberId: string;
  readonly samMemberId: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  scope = await seedUploadFamily(seeder.db);
  store = createFakeMediaStore();
  random = createFakeRandom();
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** Her family, with two people who can upload photos and an account each. */
async function seedUploadFamily(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const brother = await seedGroupMember(db, family, {
    now: NOW,
    name: "Sam",
    externalId: "3001",
  });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, sam, "Sam", brother.member.id);
  return {
    familyId: family.family.id,
    miaMemberId: family.organiser.id,
    samMemberId: brother.member.id,
  };
}

async function signIn(
  db: VelaDatabase,
  identity: SessionIdentity,
  displayName: string,
  memberId: string,
): Promise<void> {
  const [account] = await db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName })
    .returning();
  if (account === undefined) throw new Error(`expected an account for ${displayName}`);
  await db.update(members).set({ userId: account.id }).where(eq(members.id, memberId));
}

function depsFor(client: RaceClient): UploadApiMediaDeps {
  return {
    db: client.db,
    clock: client.deps.clock,
    random,
    store,
    logger: createFakeLogger(),
  };
}

function upload(
  client: RaceClient,
  who: SessionIdentity,
  key: string,
  photo: Uint8Array = testJpeg(),
) {
  return uploadApiMedia(depsFor(client), who, key, scope.familyId, photo);
}

/** App photos already kept, to bring a limit to its last free place without a hundred uploads. */
async function insertPhotos(total: number, uploadedBy: string | null): Promise<void> {
  await seeder.db.insert(media).values(
    Array.from({ length: total }, (_, index) => ({
      familyId: scope.familyId,
      uploadedBy,
      kind: "image" as const,
      storageKey: `asks/${scope.familyId}/seeded-${uploadedBy ?? "family"}-${index}.jpg`,
      mime: "image/jpeg",
      bytes: 100,
      width: 640,
      height: 480,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1_000),
      expiresAt: new Date(NOW.getTime() + 29 * DAY_MS),
    })),
  );
}

async function appPhotos(): Promise<number> {
  const [row] = await seeder.db
    .select({ total: count() })
    .from(media)
    .where(and(eq(media.familyId, scope.familyId), isNull(media.channel)));
  return row?.total ?? 0;
}

/** The objects the uploads themselves stored, leaving out the rows seeded without one. */
function uploadedObjects(): string[] {
  return [...store.objects.keys()];
}

/**
 * Waits until `waiter` is waiting on any heavyweight lock, whichever it is: the harness's own waits
 * name the lock, and a race whose guard was broken on purpose would wait on another one than the
 * test expects, and should then show its broken outcome, not a timeout.
 */
async function waitUntilBlocked(
  observer: RaceClient,
  waiter: RaceClient,
  operation: Promise<unknown>,
): Promise<void> {
  let outcome: string | undefined;
  void operation.then(
    () => {
      outcome = "it completed";
    },
    (reason: unknown) => {
      outcome = `it failed: ${String(reason)}`;
    },
  );
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const { rows } = await observer.db.execute<{ blocked: boolean }>(
      sql`select wait_event_type = 'Lock' as blocked from pg_stat_activity where pid = ${waiter.pid}`,
    );
    if (rows[0]?.blocked === true) return;
    if (outcome !== undefined) {
      throw new Error(`Stopped waiting for ${waiter.name} to block because ${outcome}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${WAIT_MS} ms waiting for ${waiter.name} to block`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("uploading a photo on independent PostgreSQL connections", () => {
  it("keeps one row and one object when the same upload arrives twice, answering the second as a replay", async () => {
    const [holder, first, second] = await pg.clientPool("upload", 3);
    if (holder === undefined || first === undefined || second === undefined) {
      throw new Error("expected three race connections");
    }
    const lock = await pg.holdActorLock(holder, mia.authSubject);
    // Each stores its object, then queues on Mia's actor lock: both objects exist while they wait.
    const one = pg.track(upload(first, mia, "same-pick"));
    await pg.waitForActorLockWait(first, [holder], one);
    const two = pg.track(upload(second, mia, "same-pick"));
    await pg.waitForActorLockWait(second, [holder], two);
    expect(uploadedObjects()).toHaveLength(2);

    lock.release();
    await pg.finish("the holder", lock.done);
    const [written, replayed] = await pg.finish("both uploads", Promise.all([one, two]));

    expect(written.replayed).toBe(false);
    expect(replayed.replayed).toBe(true);
    expect(replayed.response).toEqual(written.response);
    const rows = await seeder.db.select().from(media).where(eq(media.familyId, scope.familyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe((written.response.body as { id: string }).id);
    // The guard: the replay deletes the object it stored, which no row names.
    expect(uploadedObjects()).toEqual([rows[0]?.storageKey]);
    expect(await pg.receipts(mia.authSubject)).toHaveLength(1);
  });

  it("refuses another photo under the same key as a conflict and deletes that attempt's object", async () => {
    const [holder, first, second] = await pg.clientPool("upload", 3);
    if (holder === undefined || first === undefined || second === undefined) {
      throw new Error("expected three race connections");
    }
    const lock = await pg.holdActorLock(holder, mia.authSubject);
    const one = pg.track(upload(first, mia, "same-pick"));
    await pg.waitForActorLockWait(first, [holder], one);
    const two = pg.track(upload(second, mia, "same-pick", testJpeg({ scan: [1, 2, 3] })));
    await pg.waitForActorLockWait(second, [holder], two);

    lock.release();
    await pg.finish("the holder", lock.done);
    const [kept, refused] = await pg.settle("both uploads", [one, two]);

    expect(kept?.status).toBe("fulfilled");
    expect(refused?.status).toBe("rejected");
    if (refused?.status === "rejected") {
      expect(refused.reason).toMatchObject({ name: "ApiIdempotencyError", code: "conflict" });
    }
    const rows = await seeder.db.select().from(media).where(eq(media.familyId, scope.familyId));
    expect(rows).toHaveLength(1);
    expect(uploadedObjects()).toEqual([rows[0]?.storageKey]);
  });

  it(`gives an account's last place of ${MAX_PHOTOS_PER_ACCOUNT_DAY} a day to one of two uploads queued together`, async () => {
    await insertPhotos(MAX_PHOTOS_PER_ACCOUNT_DAY - 1, scope.miaMemberId);
    const [holder, first, second] = await pg.clientPool("upload", 3);
    if (holder === undefined || first === undefined || second === undefined) {
      throw new Error("expected three race connections");
    }
    const lock = await pg.holdActorLock(holder, mia.authSubject);
    const one = pg.track(upload(first, mia, "pick-one"));
    await pg.waitForActorLockWait(first, [holder], one);
    const two = pg.track(upload(second, mia, "pick-two", testJpeg({ scan: [4, 5, 6] })));
    await pg.waitForActorLockWait(second, [holder], two);

    lock.release();
    await pg.finish("the holder", lock.done);
    const [won, lost] = await pg.settle("both uploads", [one, two]);
    if (won?.status !== "fulfilled" || lost?.status !== "rejected") {
      throw new Error(
        `expected one upload and one refusal, got ${JSON.stringify([won, lost].map((result) => result && settled(result)))}`,
      );
    }

    expect(won.value.replayed).toBe(false);
    expect(lost.reason).toBeInstanceOf(MediaRefusedError);
    expect(lost.reason).toMatchObject({ reason: "photo_limit" });
    expect(databaseErrorCode(lost.reason)).toBeUndefined();
    // The guard: counted under the actor lock, inside the transaction, the second saw the first.
    expect(await appPhotos()).toBe(MAX_PHOTOS_PER_ACCOUNT_DAY);
    expect(uploadedObjects()).toHaveLength(1);
  });

  it(`gives a family's last place of ${MAX_LIVE_PHOTOS_PER_FAMILY} to one of two members uploading at once`, async () => {
    await insertPhotos(MAX_LIVE_PHOTOS_PER_FAMILY - 1, null);
    const [holder, miaClient, samClient, observer] = await pg.clientPool("upload", 4);
    if (
      holder === undefined ||
      miaClient === undefined ||
      samClient === undefined ||
      observer === undefined
    ) {
      throw new Error("expected four race connections");
    }
    // Mia and Sam are different actors, so no actor lock orders them. The holder keeps the family
    // row `for update`, which each upload's insert waits on for its foreign key, after it has
    // counted: without the family's advisory lock both would count 59 and both would insert.
    const entered = pg.latch("the holder to take the family row");
    const release = pg.latch("the holder to let the family row go", HOLD_MS);
    const held = pg.track(
      holder.db.transaction(async (tx) => {
        await tx.execute(sql`select id from families where id = ${scope.familyId} for update`);
        entered.release();
        await release.wait();
      }),
    );
    await entered.wait();
    const first = pg.track(upload(miaClient, mia, "mia-pick"));
    await pg.waitForRowLockWait(miaClient, [holder], first);
    // Sam waits on the family's advisory lock, which Mia holds; with that guard broken he would
    // count past it and wait on the row instead, and both would then insert.
    const second = pg.track(upload(samClient, sam, "sam-pick", testJpeg({ scan: [7, 8, 9] })));
    await waitUntilBlocked(observer, samClient, second);

    release.release();
    await pg.finish("the holder", held);
    const [won, lost] = await pg.settle("both uploads", [first, second]);
    if (won?.status !== "fulfilled" || lost?.status !== "rejected") {
      throw new Error(
        `expected Mia's upload and Sam's refusal, got ${JSON.stringify([won, lost].map((result) => result && settled(result)))}`,
      );
    }

    expect(lost.reason).toBeInstanceOf(MediaRefusedError);
    expect(lost.reason).toMatchObject({ reason: "photo_limit" });
    expect(await appPhotos()).toBe(MAX_LIVE_PHOTOS_PER_FAMILY);
    const rows = await seeder.db
      .select({ uploadedBy: media.uploadedBy })
      .from(media)
      .where(eq(media.uploadedBy, scope.samMemberId));
    expect(rows).toEqual([]);
    expect(uploadedObjects()).toHaveLength(1);
  });
});
