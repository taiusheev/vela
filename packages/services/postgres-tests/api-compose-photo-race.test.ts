/**
 * A photo ask composed while retention deletes its photo, on independent PostgreSQL connections
 * (ADR-33). `exchanges.media_ids` is a bare `uuid[]` no foreign key covers, so nothing but locks
 * keeps an ask from naming a photo retention has just deleted: compose takes the photo's row
 * `for share` inside its transaction, and retention (`deleteMedia`) takes it `for update` before
 * it removes the id from every exchange. PGlite, on one connection, never lets them overlap.
 *
 * - Compose first: retention waits for the ask to commit, then finds it and removes the id.
 *   Guard to break: the `for update` at the top of `deleteMedia`'s transaction. Without it
 *   retention clears the ids before the ask exists, and the ask is left naming a deleted photo.
 * - Retention first: compose waits for retention to commit and finds the photo gone, so it is
 *   refused. Guard to break: the `for share` on compose's photo select, the select kept inside the
 *   transaction. Without it compose reads the row retention is deleting and commits an ask naming
 *   it after retention cleared the ids.
 *
 * Each case uses an old photo (`memory_photo`), one photo, so retention has exactly one row to
 * take and the order the contenders reach it is the order the test gives.
 */
import { addDays, localDateOf } from "@vela/core";
import {
  deletions,
  type Exchange,
  exchanges,
  media,
  members,
  users,
  type VelaDatabase,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { AskPhotoMissingError, composeApiAsk } from "../src/api-asks.ts";
import type { Deps } from "../src/deps.ts";
import { applyRetention } from "../src/jobs.ts";
import { createFakeMediaStore, type FakeMediaStore } from "../src/testing/fakes.ts";
import { seedFamily } from "../src/testing/seed.ts";
import {
  HOLD_MS,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let store: FakeMediaStore;

const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const DAY_MS = 24 * 60 * 60 * 1_000;
/** A day after the photo's 30 days: retention's own clock. */
const RETENTION_NOW = new Date(NOW.getTime() + 31 * DAY_MS);

interface Scope {
  readonly familyId: string;
  readonly recipientId: string;
  readonly timeZone: string;
  readonly miaMemberId: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  scope = await seedPhotoFamily(seeder.db);
  store = createFakeMediaStore();
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

async function seedPhotoFamily(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const [account] = await db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (account === undefined) throw new Error("expected Mia's account");
  await db.update(members).set({ userId: account.id }).where(eq(members.id, family.organiser.id));
  return {
    familyId: family.family.id,
    recipientId: family.member.id,
    timeZone: family.member.tz,
    miaMemberId: family.organiser.id,
  };
}

/** Mia's upload, as `uploadApiMedia` writes it, with its object in the shared store. */
async function seedPhoto(): Promise<{ id: string; storageKey: string }> {
  const storageKey = `asks/${scope.familyId}/race-photo.jpg`;
  await store.put(storageKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer, "image/jpeg");
  const [row] = await seeder.db
    .insert(media)
    .values({
      familyId: scope.familyId,
      uploadedBy: scope.miaMemberId,
      kind: "image",
      storageKey,
      mime: "image/jpeg",
      bytes: 4,
      width: 640,
      height: 480,
      kept: false,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
    })
    .returning({ id: media.id });
  if (row === undefined) throw new Error("expected the photo");
  return { id: row.id, storageKey };
}

function tomorrow(): string {
  return addDays(localDateOf(NOW, scope.timeZone), 1);
}

function composeOldPhoto(client: RaceClient, photoId: string) {
  return composeApiAsk(client.deps, mia, `ask:${photoId}`, scope.familyId, {
    recipient_id: scope.recipientId,
    type: "memory_photo",
    text: "Do you remember this?",
    when: "tomorrow",
    media_ids: [photoId],
  });
}

function retentionDeps(client: RaceClient): Deps {
  return { ...pg.jobDeps(client), clock: { now: () => new Date(RETENTION_NOW) }, media: store };
}

async function herExchanges(): Promise<Exchange[]> {
  return seeder.db.select().from(exchanges).where(eq(exchanges.recipientId, scope.recipientId));
}

async function photoRows(photoId: string) {
  return seeder.db.select({ id: media.id }).from(media).where(eq(media.id, photoId));
}

async function mediaProofs() {
  return seeder.db.select().from(deletions).where(eq(deletions.objectType, "media"));
}

describe("a photo ask composed while retention deletes its photo", () => {
  it("lets retention, waiting on the ask, remove the photo from the ask that just named it", async () => {
    const [composer, retention, holder] = await pg.clientPool("photo", 3);
    if (composer === undefined || retention === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const photo = await seedPhoto();

    // Compose queues first on the photo's row, so its ask commits while retention waits.
    const queued = await pg.queueBehindRowLock<unknown>(
      holder,
      (tx) => tx.select().from(media).where(eq(media.id, photo.id)).for("update"),
      [
        { client: composer, start: () => composeOldPhoto(composer, photo.id) },
        { client: retention, start: () => applyRetention(retentionDeps(retention)) },
      ],
    );
    const [composed, retained] = await pg.settle("compose and retention", queued);

    expect(composed?.status).toBe("fulfilled");
    expect(retained?.status).toBe("fulfilled");
    const asked = await herExchanges();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.scheduledFor).toBe(tomorrow());
    // The id is gone from the ask: no exchange names a photo that no longer exists.
    expect(asked[0]?.mediaIds).toEqual([]);
    expect(await photoRows(photo.id)).toEqual([]);
    expect(store.objects.has(photo.storageKey)).toBe(false);
    expect(await mediaProofs()).toHaveLength(1);
  });

  it("refuses the ask that waited on retention, which finds its photo gone", async () => {
    const [retention, composer, holder] = await pg.clientPool("photo", 3);
    if (composer === undefined || retention === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const photo = await seedPhoto();
    // An earlier ask already names the photo. The holder keeps that ask's row, so retention, which
    // has taken the photo's row, stops at removing the id from it: mid-transaction, the photo's
    // row deleted by nobody yet, which is when a compose that did not wait could read it.
    const [earlier] = await seeder.db
      .insert(exchanges)
      .values({
        familyId: scope.familyId,
        recipientId: scope.recipientId,
        askerId: scope.miaMemberId,
        type: "memory_photo",
        state: "composed",
        text: "Do you remember this?",
        textLang: "en",
        whenRule: "date",
        scheduledFor: addDays(tomorrow(), 2),
        createdAt: NOW,
        mediaIds: [photo.id],
      })
      .returning();
    if (earlier === undefined) throw new Error("expected the earlier ask");

    const entered = pg.latch("holder to take the earlier ask");
    const release = pg.latch("holder to let the earlier ask go", HOLD_MS);
    const held = pg.track(
      holder.db.transaction(async (tx) => {
        await tx.select().from(exchanges).where(eq(exchanges.id, earlier.id)).for("update");
        entered.release();
        await release.wait();
      }),
    );
    await entered.wait();

    const retaining = pg.track(applyRetention(retentionDeps(retention)));
    await pg.waitForRowLockWait(retention, [holder], retaining);
    const composing = pg.track(composeOldPhoto(composer, photo.id));
    // With the guard, compose waits on retention's lock on the photo; without it, it runs through.
    await pg.waitForRowLockWaitOrCompletion(composer, [retention], composing);

    release.release();
    await pg.finish("holder to let the earlier ask go", held);
    const [retained, composed] = await pg.settle<unknown>("retention and compose", [
      retaining,
      composing,
    ]);

    expect(retained?.status).toBe("fulfilled");
    expect(composed?.status).toBe("rejected");
    expect(composed?.status === "rejected" ? composed.reason : undefined).toBeInstanceOf(
      AskPhotoMissingError,
    );
    const asked = await herExchanges();
    expect(asked.map((row) => row.id)).toEqual([earlier.id]);
    expect(asked.flatMap((row) => row.mediaIds)).toEqual([]);
    expect(await photoRows(photo.id)).toEqual([]);
  });
});
