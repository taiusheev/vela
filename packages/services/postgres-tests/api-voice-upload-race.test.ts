/**
 * Keeping a voice for a reply on independent PostgreSQL connections (spec §14.1 A8). A voice is
 * kept by the same path as a photo for an ask (`keepUpload`): its object first, under a key minted
 * for the attempt, then its row through `runApiMutation`. So the same voice sent twice queues on the
 * account's actor lock and is one row and one object, and the account's 30 voices a day are
 * counted inside the transaction, under that lock, where its 30th and 31st cannot both be the 30th.
 */
import { media, members, users, type VelaDatabase } from "@vela/db";
import { and, count, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { MediaRefusedError, type UploadApiMediaDeps } from "../src/api-media.ts";
import { MAX_VOICES_PER_ACCOUNT_DAY, uploadApiVoice } from "../src/api-voice.ts";
import {
  createFakeLogger,
  createFakeMediaStore,
  createFakeRandom,
  type FakeMediaStore,
  type FakeRandom,
} from "../src/testing/fakes.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import {
  databaseErrorCode,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
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

/** A phone's `.m4a`: an `ftyp` box and a little more, different for each `n`. */
function m4a(n = 1): Uint8Array {
  return Uint8Array.of(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, n, n, n);
}

function upload(client: RaceClient, who: SessionIdentity, key: string, recording = m4a()) {
  return uploadApiVoice(depsFor(client), who, key, scope.familyId, recording, 4200);
}

/** Voices already kept, to bring the limit to its last free place without thirty uploads. */
async function insertVoices(total: number, uploadedBy: string): Promise<void> {
  await seeder.db.insert(media).values(
    Array.from({ length: total }, (_, index) => ({
      familyId: scope.familyId,
      uploadedBy,
      kind: "audio" as const,
      storageKey: `replies/${scope.familyId}/seeded-${index}.m4a`,
      mime: "audio/mp4",
      bytes: 100,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1_000),
      expiresAt: new Date(NOW.getTime() + 29 * DAY_MS),
    })),
  );
}

async function appVoices(): Promise<number> {
  const [row] = await seeder.db
    .select({ total: count() })
    .from(media)
    .where(and(eq(media.familyId, scope.familyId), isNull(media.channel), eq(media.kind, "audio")));
  return row?.total ?? 0;
}

/** The objects the uploads themselves stored, leaving out the rows seeded without one. */
function uploadedObjects(): string[] {
  return [...store.objects.keys()];
}

describe("keeping a voice on independent PostgreSQL connections", () => {
  it("keeps one row and one object when the same voice arrives twice, answering the second as a replay", async () => {
    const [holder, first, second] = await pg.clientPool("voice", 3);
    if (holder === undefined || first === undefined || second === undefined) {
      throw new Error("expected three race connections");
    }
    const lock = await pg.holdActorLock(holder, mia.authSubject);
    const one = pg.track(upload(first, mia, "same-voice"));
    await pg.waitForActorLockWait(first, [holder], one);
    const two = pg.track(upload(second, mia, "same-voice"));
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
    expect(uploadedObjects()).toEqual([rows[0]?.storageKey]);
  });

  it(`gives an account's last place of ${MAX_VOICES_PER_ACCOUNT_DAY} a day to one of two voices queued together`, async () => {
    await insertVoices(MAX_VOICES_PER_ACCOUNT_DAY - 1, scope.miaMemberId);
    const [holder, first, second] = await pg.clientPool("voice", 3);
    if (holder === undefined || first === undefined || second === undefined) {
      throw new Error("expected three race connections");
    }
    const lock = await pg.holdActorLock(holder, mia.authSubject);
    const one = pg.track(upload(first, mia, "voice-one"));
    await pg.waitForActorLockWait(first, [holder], one);
    const two = pg.track(upload(second, mia, "voice-two", m4a(2)));
    await pg.waitForActorLockWait(second, [holder], two);

    lock.release();
    await pg.finish("the holder", lock.done);
    const [won, lost] = await pg.settle("both uploads", [one, two]);
    if (won?.status !== "fulfilled" || lost?.status !== "rejected") {
      throw new Error(
        `expected one voice and one refusal, got ${JSON.stringify([won, lost].map((result) => result && settled(result)))}`,
      );
    }

    expect(lost.reason).toBeInstanceOf(MediaRefusedError);
    expect(lost.reason).toMatchObject({ reason: "voice_limit" });
    expect(databaseErrorCode(lost.reason)).toBeUndefined();
    // The guard: counted under the actor lock, inside the transaction, the second saw the first.
    expect(await appVoices()).toBe(MAX_VOICES_PER_ACCOUNT_DAY);
    expect(uploadedObjects()).toHaveLength(1);
  });
});
