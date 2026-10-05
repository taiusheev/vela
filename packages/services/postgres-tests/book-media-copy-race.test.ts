/** A kept story's copy can be adopted only while the family, entry and file still exist. */
import {
  type Answer,
  answers,
  bookEntries,
  deletions,
  type Exchange,
  families,
  media,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { keepInBook } from "../src/book.ts";
import { deleteMedia } from "../src/jobs.ts";
import {
  createFakeMediaStore,
  createFakeRandom,
  type FakeMediaStore,
  type FakeRandom,
} from "../src/testing/fakes.ts";
import { seedExchange, seedFamily } from "../src/testing/seed.ts";
import {
  type Latch,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let store: FakeMediaStore;
let random: FakeRandom;
let story: Exchange;
let answer: Answer;
let mediaId: string;
let from: string;
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  const seeded = await seedFamily(seeder.db, { now: NOW });
  story = await seedExchange(seeder.db, seeded, {
    date: "2026-09-14",
    type: "story",
    state: "answered",
    deliveredAt: NOW,
  });
  from = `device/${seeded.family.id}/${seeded.member.id}/original.m4a`;
  const [file] = await seeder.db
    .insert(media)
    .values({
      familyId: seeded.family.id,
      uploadedBy: seeded.member.id,
      kind: "audio",
      mime: "audio/mp4",
      storageKey: from,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    })
    .returning();
  if (file === undefined) throw new Error("Expected a recording");
  mediaId = file.id;
  const [said] = await seeder.db
    .insert(answers)
    .values({
      exchangeId: story.id,
      memberId: seeded.member.id,
      kind: "voice",
      channel: "device",
      mediaId,
      receivedAt: NOW,
    })
    .returning();
  if (said === undefined) throw new Error("Expected a voice answer");
  answer = said;
  store = createFakeMediaStore();
  random = createFakeRandom();
  await store.put(from, new ArrayBuffer(200), "audio/mp4");
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function copy(client: RaceClient, written: Latch, proceed: Latch) {
  const deps = pg.jobDeps(client);
  return keepInBook(
    {
      ...deps,
      random,
      media: {
        ...store,
        async put(key: string, body: ArrayBuffer, mime: string) {
          await store.put(key, body, mime);
          written.release();
          await proceed.wait();
        },
      },
    },
    story,
    answer,
  );
}

describe("moving a kept book file on independent PostgreSQL connections", () => {
  it("preserves a file kept after an expiry sweep selected its old unkept state", async () => {
    await seeder.db.update(media).set({ expiresAt: NOW }).where(eq(media.id, mediaId));
    const [selected] = await seeder.db.select().from(media).where(eq(media.id, mediaId));
    if (selected === undefined) throw new Error("Expected the sweep's selected media");
    const keeper = await pg.client("book-keep");
    const retention = await pg.client("expiry-sweep");
    const held = await pg.holdRows(keeper, (tx) =>
      tx.update(media).set({ kept: true }).where(eq(media.id, mediaId)),
    );
    const operation = pg.track(
      deleteMedia({ ...pg.jobDeps(retention), media: store }, selected, "expired"),
    );
    await pg.waitForRowLockWaitOrCompletion(retention, [keeper], operation);
    await held.release();
    await pg.finish("expiry deletion", operation);
    const [row] = await seeder.db.select().from(media).where(eq(media.id, mediaId));
    expect(row).toMatchObject({ kept: true, storageKey: from });
    expect([...store.objects.keys()]).toEqual([from]);
    expect(await seeder.db.select().from(deletions).where(eq(deletions.objectId, mediaId))).toEqual(
      [],
    );
  });

  it("discards its own copy after a family deletion commits while adoption waits", async () => {
    const holder = await pg.client("family-deletion");
    const writer = await pg.client("book-copy");
    const written = pg.latch("book object written");
    const proceed = pg.latch("adoption may continue");
    const operation = pg.track(copy(writer, written, proceed));
    await pg.reach("book object stored", written, operation);
    const held = await pg.holdRows(holder, (tx) =>
      tx.update(families).set({ deletedAt: NOW }).where(eq(families.id, story.familyId)),
    );
    proceed.release();
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], operation);
    expect(store.objects.size).toBe(2);
    await held.release();
    await pg.finish("book copy", operation);
    expect([...store.objects.keys()]).toEqual([from]);
    const [row] = await seeder.db.select().from(media).where(eq(media.id, mediaId));
    expect(row?.storageKey).toBe(from);
  });

  it("discards the new object when retention deletes the original row", async () => {
    const holder = await pg.client("retention");
    const writer = await pg.client("book-copy");
    const written = pg.latch("book object written");
    const proceed = pg.latch("adoption may continue");
    const operation = pg.track(copy(writer, written, proceed));
    await pg.reach("book object stored", written, operation);
    const held = await pg.holdRows(holder, async (tx) => {
      await store.delete(from);
      await tx.delete(media).where(eq(media.id, mediaId));
    });
    proceed.release();
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], operation);
    expect(store.objects.size).toBe(1);
    await held.release();
    await pg.finish("book copy", operation);
    expect(store.objects.size).toBe(0);
    expect(await seeder.db.select().from(media).where(eq(media.id, mediaId))).toEqual([]);
  });

  it("cannot adopt a copy after Don't keep this one removes the entry and clears kept", async () => {
    const holder = await pg.client("book-drop");
    const writer = await pg.client("book-copy");
    const written = pg.latch("book object written");
    const proceed = pg.latch("adoption may continue");
    const operation = pg.track(copy(writer, written, proceed));
    await pg.reach("book object stored", written, operation);
    const held = await pg.holdRows(holder, async (tx) => {
      await tx
        .update(bookEntries)
        .set({ removedAt: NOW })
        .where(eq(bookEntries.exchangeId, story.id));
      await tx.update(media).set({ kept: false }).where(eq(media.id, mediaId));
    });
    proceed.release();
    await pg.waitForRowLockWaitOrCompletion(writer, [holder], operation);
    await held.release();
    await pg.finish("book copy", operation);
    expect([...store.objects.keys()]).toEqual([from]);
    const [row] = await seeder.db.select().from(media).where(eq(media.id, mediaId));
    expect(row).toMatchObject({ storageKey: from, kept: false });
    expect(
      await keepInBook({ ...pg.jobDeps(writer), media: store, random }, story, answer),
    ).toBeNull();
  });

  it("retains one winning book copy and removes only the competing attempt and old object", async () => {
    const holder = await pg.client("media-holder");
    const first = await pg.client("book-first");
    const second = await pg.client("book-second");
    const writtenOne = pg.latch("first book object written");
    const writtenTwo = pg.latch("second book object written");
    const proceedOne = pg.latch("first adoption may continue");
    const proceedTwo = pg.latch("second adoption may continue");
    const one = pg.track(copy(first, writtenOne, proceedOne));
    await pg.reach("first copy stored", writtenOne, one);
    const two = pg.track(copy(second, writtenTwo, proceedTwo));
    await pg.reach("second copy stored", writtenTwo, two);
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(media).where(eq(media.id, mediaId)).for("update"),
    );
    proceedOne.release();
    await pg.waitForRowLockWaitOrCompletion(first, [holder], one);
    proceedTwo.release();
    await pg.waitForRowLockWaitOrCompletion(second, [first], two);
    expect(store.objects.size).toBe(3);
    await held.release();
    await pg.finish("both book copies", Promise.all([one, two]));
    const [row] = await seeder.db.select().from(media).where(eq(media.id, mediaId));
    expect(row?.storageKey).toMatch(
      new RegExp(`^book/${story.familyId}/${mediaId}-[A-Za-z0-9_-]+\\.m4a$`),
    );
    expect([...store.objects.keys()]).toEqual([row?.storageKey]);
  });
});
