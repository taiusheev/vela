/** Real row contention after provider bytes are stored, before an original is adopted. */
import { families, media } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeInboundCopy } from "../src/inbound-media-copy.ts";
import { createFakeTelegram } from "../src/testing/fake-telegram.ts";
import {
  createFakeMediaStore,
  createFakeRandom,
  type FakeMediaStore,
  type FakeRandom,
} from "../src/testing/fakes.ts";
import { seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let store: FakeMediaStore;
let random: FakeRandom;
let familyId: string;
let mediaId: string;
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  const seeded = await seedFamily(seeder.db, { now: NOW });
  familyId = seeded.family.id;
  const [source] = await seeder.db
    .insert(media)
    .values({
      familyId,
      kind: "audio",
      channel: "telegram",
      providerFileId: "source-file",
      mime: "audio/ogg",
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    })
    .returning();
  if (source === undefined) throw new Error("Expected source media");
  mediaId = source.id;
  store = createFakeMediaStore();
  random = createFakeRandom();
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function copy(client: RaceClient) {
  const deps = pg.jobDeps(client);
  const telegram = createFakeTelegram(deps.clock);
  telegram.mediaFiles.set("source-file", { body: new ArrayBuffer(200), mime: "audio/ogg" });
  return storeInboundCopy(
    { ...deps, media: store, random, channels: { get: () => telegram } },
    mediaId,
  );
}

describe("original source copying on independent PostgreSQL connections", () => {
  it("waits for a family deletion and discards the attempt's object", async () => {
    const holder = await pg.client("family-deletion");
    const writer = await pg.client("copy");
    const held = await pg.holdRows(holder, async (tx) => {
      await tx.update(families).set({ deletedAt: NOW }).where(eq(families.id, familyId));
    });
    const operation = pg.track(copy(writer));
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], operation);
    expect(store.objects.size).toBe(1);
    await held.release();
    expect(await pg.finish("source copy", operation)).toBeNull();
    expect(store.objects.size).toBe(0);
    const [row] = await seeder.db.select().from(media).where(eq(media.id, mediaId));
    expect(row?.storageKey).toBeNull();
  });

  it("waits for retention deleting the row and discards the attempt's object", async () => {
    const holder = await pg.client("retention");
    const writer = await pg.client("copy");
    const held = await pg.holdRows(holder, async (tx) => {
      await tx.delete(media).where(eq(media.id, mediaId));
    });
    const operation = pg.track(copy(writer));
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], operation);
    expect(store.objects.size).toBe(1);
    await held.release();
    expect(await pg.finish("source copy", operation)).toBeNull();
    expect(store.objects.size).toBe(0);
    expect(await seeder.db.select().from(media).where(eq(media.id, mediaId))).toEqual([]);
  });

  it("adopts one original across simultaneous deliveries and deletes only the losing object", async () => {
    const holder = await pg.client("media-holder");
    const first = await pg.client("copy-first");
    const second = await pg.client("copy-second");
    const held = await pg.holdRows(holder, async (tx) => {
      await tx.select().from(media).where(eq(media.id, mediaId)).for("update");
    });
    const one = pg.track(copy(first));
    await pg.waitForRowLockWaitOrCompletion(first, [holder], one);
    const two = pg.track(copy(second));
    await pg.waitForRowLockWaitOrCompletion(second, [first], two);
    expect(store.objects.size).toBe(2);
    await held.release();
    const results = await pg.finish("both copies", Promise.all([one, two]));
    expect(results[0]?.storageKey).toBeTruthy();
    expect(results[1]?.storageKey).toBe(results[0]?.storageKey);
    expect([...store.objects.keys()]).toEqual([results[0]?.storageKey]);
    const [row] = await seeder.db.select().from(media).where(eq(media.id, mediaId));
    expect(row?.storageKey).toBe(results[0]?.storageKey);
  });
});
