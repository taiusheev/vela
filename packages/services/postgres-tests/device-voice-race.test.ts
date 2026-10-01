/**
 * Her recording from her phone kept on independent PostgreSQL connections (ADR-35, P4). Her phone
 * sends a recording again under the same key when it did not hear back, so a retry can reach the
 * Worker while the first is still writing its row: both found no row for the key, and both insert.
 * The unique index on the family's `device` files (and on the storage key) makes the second wait
 * for the first, and `on conflict do nothing` turns its insert into a read of the first's row, so
 * one recording is one row whichever arrives first. Without it the second fails on the index.
 */

import { media, members, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeDeviceVoice } from "../src/device-voice.ts";
import { seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let scope: { familyId: string; herId: string };

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seed(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

async function seed(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  return { familyId: family.family.id, herId: family.member.id };
}

const KEY = "recording-race";
const RECORDING = Uint8Array.of(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1);

async function her(client: RaceClient) {
  const [row] = await client.db.select().from(members).where(eq(members.id, scope.herId));
  if (row === undefined) throw new Error("expected her");
  return row;
}

describe("keeping her recording on independent PostgreSQL connections", () => {
  it("is one row when a retry arrives while the first is still writing it", async () => {
    const [first, second, holder] = await pg.clientPool("voice", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const mother = await her(seeder);
    const storageKey = `families/${scope.familyId}/device/${scope.herId}/${KEY}.m4a`;

    // The holder is the first send, its row written and not yet committed; both retries have
    // already looked for the key and found nothing, and each waits on the holder's insert.
    const held = await pg.holdRows(holder, (tx) =>
      tx.insert(media).values({
        familyId: scope.familyId,
        uploadedBy: scope.herId,
        kind: "audio",
        channel: "device",
        storageKey,
        providerFileId: `device:${KEY}`,
        providerUniqueId: `${scope.herId}:${KEY}`,
        mime: "audio/mp4",
        createdAt: NOW,
      }),
    );
    const queued: Promise<{ mediaId: string }>[] = [];
    for (const client of [first, second]) {
      const operation = pg.track(
        storeDeviceVoice(pg.jobDeps(client), mother, KEY, RECORDING, 1000),
      );
      queued.push(operation);
      await pg.waitForRowLockWait(client, [holder], operation);
    }
    await held.release();
    const results = await pg.settle("both retries", queued);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);

    const rows = await seeder.db.select().from(media).where(eq(media.uploadedBy, scope.herId));
    expect(rows).toHaveLength(1);
    for (const result of results) {
      expect(result.status === "fulfilled" ? result.value.mediaId : null).toBe(rows[0]?.id);
    }
  });
});
