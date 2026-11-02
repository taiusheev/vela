/**
 * Adding to the family's photo box on independent PostgreSQL connections (ADR-58). The box holds
 * `PHOTO_BOX_LIMIT` photos; two members of the family are different actors, so their receipts do
 * not order them, and only the family's own photo lock (`vela-media:<family>`, which every upload
 * takes too) keeps the box's last place from going to both. PGlite, on one connection, never lets
 * two additions overlap. Here they do.
 */
import { PHOTO_BOX_LIMIT } from "@vela/contracts";
import { media, members, photoBox, users, type VelaDatabase } from "@vela/db";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { addToApiPhotoBox, PhotoBoxRefusedError } from "../src/photo-box.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import {
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
  scope = await seedBoxFamily(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

async function seedBoxFamily(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const brother = await seedGroupMember(db, family, { now: NOW, name: "Sam", externalId: "3001" });
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

/** An app photo `uploadedBy` uploaded an hour ago, waiting to be put in the box. */
async function uploaded(uploadedBy: string, name: string): Promise<string> {
  const [row] = await seeder.db
    .insert(media)
    .values({
      familyId: scope.familyId,
      uploadedBy,
      kind: "image",
      storageKey: `asks/${scope.familyId}/${name}.jpg`,
      mime: "image/jpeg",
      bytes: 100,
      width: 640,
      height: 480,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1_000),
      expiresAt: new Date(NOW.getTime() + 29 * DAY_MS),
    })
    .returning({ id: media.id });
  if (row === undefined) throw new Error(`photo ${name} not seeded`);
  return row.id;
}

/** The box filled to one place short of its limit. */
async function fillBox(total: number): Promise<void> {
  for (let index = 0; index < total; index += 1) {
    const id = await uploaded(scope.miaMemberId, `filler-${index}`);
    await seeder.db.update(media).set({ expiresAt: null }).where(eq(media.id, id));
    await seeder.db.insert(photoBox).values({ familyId: scope.familyId, mediaId: id, era: "new" });
  }
}

async function boxSize(): Promise<number> {
  const [row] = await seeder.db
    .select({ total: count() })
    .from(photoBox)
    .where(eq(photoBox.familyId, scope.familyId));
  return row?.total ?? 0;
}

/** Waits until `waiter` waits on any heavyweight lock, so a broken guard shows its outcome. */
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

describe("adding to the photo box on independent PostgreSQL connections", () => {
  it(`gives the box's last place of ${PHOTO_BOX_LIMIT} to one of two members adding at once`, async () => {
    await fillBox(PHOTO_BOX_LIMIT - 1);
    const miasPhoto = await uploaded(scope.miaMemberId, "mia-pick");
    const samsPhoto = await uploaded(scope.samMemberId, "sam-pick");
    const [holder, miaClient, samClient, observer] = await pg.clientPool("box", 4);
    if (
      holder === undefined ||
      miaClient === undefined ||
      samClient === undefined ||
      observer === undefined
    ) {
      throw new Error("expected four race connections");
    }
    // Mia and Sam are different actors: only the family's photo lock orders them. With that guard
    // missing neither waits on the holder, and both take the last place.
    const entered = pg.latch("the holder to take the family photo lock");
    const release = pg.latch("the holder to let the family photo lock go", HOLD_MS);
    const held = pg.track(
      holder.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`vela-media:${scope.familyId}`}, 0))`,
        );
        entered.release();
        await release.wait();
      }),
    );
    await entered.wait();
    const first = pg.track(
      addToApiPhotoBox(miaClient.deps, mia, "mia-add", scope.familyId, {
        media_id: miasPhoto,
        era: "new",
      }),
    );
    await pg.waitForLockWait(miaClient, [holder], first);
    const second = pg.track(
      addToApiPhotoBox(samClient.deps, sam, "sam-add", scope.familyId, {
        media_id: samsPhoto,
        era: "old",
      }),
    );
    await waitUntilBlocked(observer, samClient, second);

    release.release();
    await pg.finish("the holder", held);
    const [won, lost] = await pg.settle("both additions", [first, second]);
    if (won?.status !== "fulfilled" || lost?.status !== "rejected") {
      throw new Error(
        `expected Mia's addition and Sam's refusal, got ${JSON.stringify([won, lost].map((result) => result && settled(result)))}`,
      );
    }

    expect(lost.reason).toBeInstanceOf(PhotoBoxRefusedError);
    expect(lost.reason).toMatchObject({ reason: "box_full" });
    expect(await boxSize()).toBe(PHOTO_BOX_LIMIT);
    const [samsRow] = await seeder.db.select().from(media).where(eq(media.id, samsPhoto));
    // Sam's photo keeps its deletion date: it never went into the box.
    expect(samsRow?.expiresAt).not.toBeNull();
  });
});
