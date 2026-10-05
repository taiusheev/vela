import { media } from "@vela/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sweepInboundMediaOrphans } from "./media-orphans.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

describe("inbound media orphan cleanup", () => {
  it("removes old unowned attempts while retaining referenced, recent and book objects", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const prefix = `families/${seed.family.id}/media/`;
    const kept = `${prefix}11111111-1111-1111-1111-111111111111-kept.ogg`;
    const orphan = `${prefix}22222222-2222-2222-2222-222222222222-orphan.jpg`;
    const recent = `${prefix}33333333-3333-3333-3333-333333333333-recent.jpg`;
    const book = `book/${seed.family.id}/old.ogg`;
    const old = new Date(h.clock.now().getTime() - 25 * 60 * 60 * 1_000);
    for (const key of [kept, orphan, recent, book])
      await h.media.put(key, new ArrayBuffer(3), "audio/ogg");
    await h.db
      .insert(media)
      .values({ familyId: seed.family.id, kind: "audio", storageKey: kept, kept: true });
    const store = {
      ...h.media,
      list: async () => ({
        cursor: null,
        objects: [kept, orphan, recent, book].map((key) => ({
          key,
          uploadedAt: key === recent ? h.clock.now() : old,
        })),
      }),
    };
    expect(await sweepInboundMediaOrphans({ ...h.deps, media: store })).toBe(1);
    expect(h.media.objects.has(orphan)).toBe(false);
    for (const key of [kept, recent, book]) expect(h.media.objects.has(key)).toBe(true);
  });

  it("continues from the saved private cursor and restarts after the final page", async () => {
    const cursors: (string | undefined)[] = [];
    const prefixes: string[] = [];
    const store = {
      ...h.media,
      list: async (input: { cursor?: string; prefix: string }) => {
        cursors.push(input.cursor);
        prefixes.push(input.prefix);
        return { objects: [], cursor: input.cursor === undefined ? "page-two" : null };
      },
    };
    await sweepInboundMediaOrphans({ ...h.deps, media: store });
    await sweepInboundMediaOrphans({ ...h.deps, media: store });
    await sweepInboundMediaOrphans({ ...h.deps, media: store });
    expect(cursors).toEqual([undefined, "page-two", undefined]);
    expect(prefixes).toEqual(["families/", "families/", "book/"]);
  });

  it("removes old unowned book attempts but retains legacy and referenced kept files", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const root = `book/${seed.family.id}/22222222-2222-2222-2222-222222222222`;
    const orphan = `${root}-aaaaaaaaaaaaaaaa.ogg`;
    const kept = `${root}-bbbbbbbbbbbbbbbb.ogg`;
    const legacy = `${root}.ogg`;
    for (const key of [orphan, kept, legacy])
      await h.media.put(key, new ArrayBuffer(3), "audio/ogg");
    await h.db
      .insert(media)
      .values({ familyId: seed.family.id, kind: "audio", storageKey: kept, kept: true });
    const store = {
      ...h.media,
      list: async () => ({
        cursor: null,
        objects: [orphan, kept, legacy].map((key) => ({
          key,
          uploadedAt: new Date(h.clock.now().getTime() - 25 * 60 * 60 * 1000),
        })),
      }),
    };
    expect(await sweepInboundMediaOrphans({ ...h.deps, media: store })).toBe(1);
    expect(h.media.objects.has(orphan)).toBe(false);
    expect(h.media.objects.has(kept)).toBe(true);
    expect(h.media.objects.has(legacy)).toBe(true);
  });

  it("keeps the cursor for retry if deletion fails", async () => {
    const store = {
      ...h.media,
      list: async () => ({
        cursor: "next",
        objects: [
          {
            key: "families/11111111-1111-1111-1111-111111111111/media/22222222-2222-2222-2222-222222222222-attempt.jpg",
            uploadedAt: new Date(h.clock.now().getTime() - 25 * 60 * 60 * 1_000),
          },
        ],
      }),
      delete: async () => {
        throw new Error("bucket unavailable");
      },
    };
    await expect(sweepInboundMediaOrphans({ ...h.deps, media: store })).rejects.toThrow(
      "bucket unavailable",
    );
    expect(h.media.objects.has("operations/inbound-media-sweep.json")).toBe(false);
    expect(h.logger.entries.some((entry) => entry.event === "media_orphan_cleanup_failed")).toBe(
      true,
    );
  });
});
