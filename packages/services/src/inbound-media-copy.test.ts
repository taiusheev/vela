import { families, media } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestExchangeMedia, storeInboundCopy } from "./inbound-media-copy.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
beforeAll(async () => {
  h = await createHarness();
}, 60000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
});
afterAll(async () => {
  await h.close();
});
async function source() {
  const [row] = await h.db
    .insert(media)
    .values({
      familyId: seed.family.id,
      kind: "audio",
      channel: "telegram",
      providerFileId: "telegram-source",
      mime: "audio/ogg",
      createdAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 86400000),
    })
    .returning();
  if (row === undefined) throw new Error("missing source");
  h.telegram.mediaFiles.set("telegram-source", { body: new ArrayBuffer(200), mime: "audio/ogg" });
  return row;
}
describe("source media copying", () => {
  it("keeps one original, reuses it on queue redelivery and never requires AI", async () => {
    const row = await source();
    const copied = await storeInboundCopy(h.deps, row.id);
    expect(copied).toMatchObject({ id: row.id, bytes: 200, mime: "audio/ogg" });
    expect(copied?.storageKey).toMatch(/families\/.+\/media\/.+\.ogg$/);
    await ingestExchangeMedia(h.deps, row.id);
    expect(h.media.objects.size).toBe(1);
    expect(h.telegram.fetched).toEqual(["telegram-source"]);
  });
  it("discards an attempt's object if retention deleted the row during the upload", async () => {
    const row = await source();
    const store = {
      ...h.media,
      put: async (key: string, bytes: ArrayBuffer, mime: string) => {
        await h.media.put(key, bytes, mime);
        await h.db.delete(media).where(eq(media.id, row.id));
      },
    };
    expect(await storeInboundCopy({ ...h.deps, media: store }, row.id)).toBeNull();
    expect(h.media.objects.size).toBe(0);
  });
  it("discards an attempt if the family ended while provider bytes were being stored", async () => {
    const row = await source();
    const store = {
      ...h.media,
      put: async (key: string, bytes: ArrayBuffer, mime: string) => {
        await h.media.put(key, bytes, mime);
        await h.db
          .update(families)
          .set({ deletedAt: h.clock.now() })
          .where(eq(families.id, seed.family.id));
      },
    };
    expect(await storeInboundCopy({ ...h.deps, media: store }, row.id)).toBeNull();
    expect(h.media.objects.size).toBe(0);
  });
  it("retries a transient store failure, but acknowledges expired and storage-off sources", async () => {
    const row = await source();
    const broken = {
      ...h.media,
      put: async () => {
        throw new Error("provider secret should not leak");
      },
    };
    await expect(ingestExchangeMedia({ ...h.deps, media: broken }, row.id)).rejects.toThrow(
      "Source media is not ready",
    );
    expect(JSON.stringify(h.logger.entries)).not.toContain("provider secret");
    await expect(ingestExchangeMedia({ ...h.deps, media: null }, row.id)).resolves.toBeUndefined();
    h.clock.advance(86400000);
    await expect(ingestExchangeMedia(h.deps, row.id)).resolves.toBeUndefined();
    expect(h.media.objects.size).toBe(0);
  });
  it("acknowledges a stale source without fetching, and discards a copy that misses the window", async () => {
    const row = await source();
    await h.db
      .update(media)
      .set({ expiresAt: new Date(h.clock.now().getTime() + 30 * 86400000) })
      .where(eq(media.id, row.id));
    const begun = h.clock.now();
    h.clock.advance(86400000);
    await expect(ingestExchangeMedia(h.deps, row.id)).resolves.toBeUndefined();
    expect(h.telegram.fetched).toEqual([]);
    h.clock.set(begun);
    const late = {
      ...h.media,
      put: async (key: string, bytes: ArrayBuffer, mime: string) => {
        await h.media.put(key, bytes, mime);
        h.clock.advance(86400000);
      },
    };
    expect(await storeInboundCopy({ ...h.deps, media: late }, row.id)).toBeNull();
    expect(h.media.objects.size).toBe(0);
  });
});
