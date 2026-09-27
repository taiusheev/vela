import { ApiUploadedMedia } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import {
  answers,
  apiRequestReceipts,
  deletions,
  exchanges,
  families,
  media,
  members,
  type NewMedia,
  replies,
  users,
} from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import {
  MAX_LIVE_PHOTOS_PER_FAMILY,
  MAX_PHOTOS_PER_ACCOUNT_DAY,
  MediaRefusedError,
  readApiMedia,
  type UploadApiMediaDeps,
  uploadApiMedia,
} from "./api-media.ts";
import type { MediaStore } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { applyRetention } from "./jobs.ts";
import { cleanJpeg } from "./media-jpeg.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { testJpeg } from "./testing/jpeg.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let samMemberId: string;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };
const stranger: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-x" };
const unknownId = "00000000-0000-4000-8000-000000000001";
const DAY_MS = 24 * 60 * 60 * 1_000;

async function signIn(identity: SessionIdentity, name: string, memberId: string): Promise<void> {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: name })
    .returning();
  if (user === undefined) throw new Error(`expected an account for ${name}`);
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const brother = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "3001",
  });
  samMemberId = brother.member.id;
  await signIn(mia, "Mia", seed.organiser.id);
  await signIn(sam, "Sam", samMemberId);
});
afterAll(async () => {
  await h.close();
});

function deps(overrides: Partial<UploadApiMediaDeps> = {}): UploadApiMediaDeps {
  return {
    db: h.db,
    clock: h.clock,
    random: h.random,
    store: h.media,
    logger: h.logger,
    ...overrides,
  };
}

let keys = 0;
function upload(
  body: Uint8Array = testJpeg(),
  options: {
    key?: string;
    who?: SessionIdentity;
    familyId?: string;
    deps?: UploadApiMediaDeps;
  } = {},
) {
  keys += 1;
  return uploadApiMedia(
    options.deps ?? deps(),
    options.who ?? mia,
    options.key ?? `upload-${keys}`,
    options.familyId ?? seed.family.id,
    body,
  );
}

async function uploaded(body?: Uint8Array, options?: Parameters<typeof upload>[1]) {
  const result = await upload(body, options);
  return ApiUploadedMedia.parse(result.response.body);
}

async function mediaRows() {
  return h.db.select().from(media);
}

function objectKeys(): string[] {
  return [...h.media.objects.keys()];
}

function logged(): string {
  return JSON.stringify(h.logger.entries);
}

/** App photos inserted straight into the table, to fill a limit without a hundred uploads. */
async function insertPhotos(count: number, row: Partial<NewMedia> = {}): Promise<void> {
  const now = h.clock.now();
  await h.db.insert(media).values(
    Array.from({ length: count }, (_, index) => ({
      familyId: seed.family.id,
      uploadedBy: seed.organiser.id,
      kind: "image" as const,
      storageKey: `asks/${seed.family.id}/seeded-${index}-${Math.random()}.jpg`,
      mime: "image/jpeg",
      bytes: 100,
      width: 640,
      height: 480,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * DAY_MS),
      ...row,
    })),
  );
}

describe("uploadApiMedia", () => {
  it("keeps the cleaned photo under the family's asks/ prefix and answers 201 with its row", async () => {
    const photo = testJpeg({ width: 1600, height: 1200, comment: "shot on a SecretPhone" });
    const result = await upload(photo);
    const cleaned = cleanJpeg(photo);
    if (!cleaned.ok) throw new Error("the fixture must clean");

    expect(result.replayed).toBe(false);
    expect(result.response.status).toBe(201);
    const body = ApiUploadedMedia.parse(result.response.body);
    const expiresAt = new Date(h.clock.now().getTime() + 30 * DAY_MS);
    expect(body).toEqual({
      id: expect.any(String),
      kind: "image",
      width: 1600,
      height: 1200,
      bytes: cleaned.bytes.length,
      expires_at: expiresAt.toISOString(),
    });

    const [row] = await mediaRows();
    expect(row).toEqual({
      id: body.id,
      familyId: seed.family.id,
      uploadedBy: seed.organiser.id,
      kind: "image",
      storageKey: expect.stringMatching(
        new RegExp(`^asks/${seed.family.id}/[A-Za-z0-9_-]+\\.jpg$`),
      ),
      channel: null,
      providerFileId: null,
      providerUniqueId: null,
      mime: "image/jpeg",
      bytes: cleaned.bytes.length,
      durationMs: null,
      width: 1600,
      height: 1200,
      kept: false,
      createdAt: h.clock.now(),
      expiresAt,
    });
    const object = h.media.objects.get(row?.storageKey ?? "");
    expect(object?.mime).toBe("image/jpeg");
    expect(new Uint8Array(object?.body ?? new ArrayBuffer(0))).toEqual(cleaned.bytes);
    expect(objectKeys()).toHaveLength(1);
    expect(h.logger.entries).toEqual([]);
  });

  it("lets any member of the family upload, not only its organiser", async () => {
    const body = await uploaded(testJpeg(), { who: sam });
    const [row] = await mediaRows();
    expect(row).toMatchObject({ id: body.id, uploadedBy: samMemberId });
  });

  it("answers a repeat with the first row and keeps one object, even when the phone's bytes differ only in what cleaning drops", async () => {
    const first = await upload(testJpeg({ comment: "first" }), { key: "same-key" });
    const again = await upload(testJpeg({ comment: "second" }), { key: "same-key" });

    expect(again.replayed).toBe(true);
    expect(again.response).toEqual(first.response);
    expect(await mediaRows()).toHaveLength(1);
    expect(objectKeys()).toEqual([(await mediaRows())[0]?.storageKey]);
  });

  it("refuses another photo under a used key with a conflict, and deletes the object it stored", async () => {
    await upload(testJpeg(), { key: "same-key" });
    const [kept] = await mediaRows();

    await expect(
      upload(testJpeg({ scan: [0x01, 0x02, 0x03] }), { key: "same-key" }),
    ).rejects.toMatchObject({ name: "ApiIdempotencyError", code: "conflict" });
    expect(await mediaRows()).toHaveLength(1);
    expect(objectKeys()).toEqual([kept?.storageKey]);
  });

  it.each([
    ["a stranger", () => upload(testJpeg(), { who: stranger })],
    ["another family's id", async () => upload(testJpeg(), { familyId: (await otherFamily()).id })],
    [
      "a family that was deleted",
      async () => {
        await h.db
          .update(families)
          .set({ deletedAt: h.clock.now() })
          .where(eq(families.id, seed.family.id));
        return upload();
      },
    ],
    [
      "a family whose kept light has left",
      async () => {
        await h.db.update(members).set({ status: "left" }).where(eq(members.id, seed.member.id));
        return upload();
      },
    ],
  ])("answers not_found for %s, keeping no row and no object", async (_, attempt) => {
    await expect(attempt()).rejects.toBeInstanceOf(VelaError);
    expect(await mediaRows()).toEqual([]);
    expect(objectKeys()).toEqual([]);
  });

  it("refuses a family id that is not a uuid before storing anything", async () => {
    await expect(upload(testJpeg(), { familyId: "not-a-uuid" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(h.random.token()).toBe("token-1".padEnd(43, "x"));
    expect(objectKeys()).toEqual([]);
  });

  it.each([
    ["a PNG", Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "jpeg_only"],
    ["a cut JPEG", testJpeg().subarray(0, 40), "malformed"],
    ["a 5000-pixel JPEG", testJpeg({ width: 5000, height: 3000 }), "dimensions"],
  ] as const)(
    "refuses %s as %s before storing anything or taking a receipt",
    async (_, body, reason) => {
      const refusal = await upload(body).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(MediaRefusedError);
      expect(refusal).toMatchObject({ reason });
      expect(objectKeys()).toEqual([]);
      expect(await h.db.select().from(apiRequestReceipts)).toEqual([]);
    },
  );

  describe("the volume limits", () => {
    it(`lets an account keep ${MAX_PHOTOS_PER_ACCOUNT_DAY} photos in 24 hours, in any of its families, and refuses the next`, async () => {
      // Mia organises another family too, and uploaded there first: one account, one allowance.
      const other = await otherFamily();
      const [account] = await h.db
        .select()
        .from(users)
        .where(eq(users.authSubject, mia.authSubject));
      const [there] = await h.db
        .update(members)
        .set({ userId: account?.id ?? null })
        .where(and(eq(members.familyId, other.id), eq(members.role, "organiser")))
        .returning();
      await insertPhotos(MAX_PHOTOS_PER_ACCOUNT_DAY - 1, {
        familyId: other.id,
        uploadedBy: there?.id ?? null,
        createdAt: new Date(h.clock.now().getTime() - DAY_MS + 60_000),
      });
      await uploaded();

      const refusal = await upload().catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(MediaRefusedError);
      expect(refusal).toMatchObject({ reason: "photo_limit" });
      expect(await mediaRows()).toHaveLength(MAX_PHOTOS_PER_ACCOUNT_DAY);
      expect(objectKeys()).toHaveLength(1);

      // Sam's own allowance is his, in the same family.
      await uploaded(testJpeg(), { who: sam });
      // A minute later the oldest of Mia's slipped out of the 24 hours.
      h.clock.advance(60_000);
      await uploaded();
    });

    it("counts only the account's app photos: Telegram's and other accounts' are not its own", async () => {
      await insertPhotos(MAX_PHOTOS_PER_ACCOUNT_DAY, {
        channel: "telegram",
        providerFileId: "file",
        storageKey: null,
      });
      await insertPhotos(MAX_PHOTOS_PER_ACCOUNT_DAY, { uploadedBy: samMemberId });
      await uploaded();
    });

    it(`holds a family to ${MAX_LIVE_PHOTOS_PER_FAMILY} live app photos, whoever uploads, counting none kept or expired`, async () => {
      const long = new Date(h.clock.now().getTime() - 2 * DAY_MS);
      await insertPhotos(MAX_LIVE_PHOTOS_PER_FAMILY - 1, { createdAt: long, uploadedBy: null });
      await insertPhotos(5, { createdAt: long, uploadedBy: null, kept: true });
      await insertPhotos(5, {
        createdAt: long,
        uploadedBy: null,
        expiresAt: new Date(h.clock.now().getTime() - 1),
      });
      await insertPhotos(5, {
        createdAt: long,
        uploadedBy: null,
        channel: "telegram",
        providerFileId: "file",
      });
      await uploaded(testJpeg(), { who: sam });

      await expect(upload()).rejects.toMatchObject({ reason: "photo_limit" });
      await expect(upload(testJpeg(), { who: sam })).rejects.toMatchObject({
        reason: "photo_limit",
      });
      expect(objectKeys()).toHaveLength(1);

      // Another family is not held to this one's count.
      const other = await otherFamily();
      await uploaded(testJpeg(), { who: other.identity, familyId: other.id });
    });

    it("replays an upload made before the limit was reached", async () => {
      const first = await upload(testJpeg(), { key: "kept-key" });
      await insertPhotos(MAX_PHOTOS_PER_ACCOUNT_DAY);
      const again = await upload(testJpeg(), { key: "kept-key" });
      expect(again).toEqual({ ...first, replayed: true });
    });
  });

  describe("an object the row never came to name", () => {
    it("tries to delete an object whose put failed, and throws the put's error", async () => {
      const deleted: string[] = [];
      const store: MediaStore = {
        put: async () => {
          throw new Error("R2 unavailable");
        },
        get: async () => null,
        delete: async (key) => {
          deleted.push(key);
        },
        head: async () => null,
      };
      await expect(upload(testJpeg(), { deps: deps({ store }) })).rejects.toThrow("R2 unavailable");
      expect(deleted).toEqual([expect.stringMatching(/^asks\//)]);
      expect(await mediaRows()).toEqual([]);
      expect(await h.db.select().from(apiRequestReceipts)).toEqual([]);
    });

    it("deletes the object after an unknown failure once the row is seen to be absent", async () => {
      let calls = 0;
      // The clock throws when the mutation reads it: inside the transaction, which rolls back.
      const clock = {
        now: () => {
          calls += 1;
          if (calls === 3) throw new Error("clock stopped");
          return h.clock.now();
        },
      };
      await expect(upload(testJpeg(), { deps: deps({ clock }) })).rejects.toThrow("clock stopped");
      expect(await mediaRows()).toEqual([]);
      expect(objectKeys()).toEqual([]);
      expect(h.logger.entries).toEqual([]);
    });

    it("keeps the object when an unknown failure came after the commit, and says the commit was unknown", async () => {
      const db = new Proxy(h.db, {
        get(target, property) {
          if (property === "transaction") {
            return async (...args: Parameters<typeof target.transaction>) => {
              await target.transaction(...args);
              throw new Error("connection lost after COMMIT");
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await expect(upload(testJpeg(), { deps: deps({ db }) })).rejects.toThrow(
        "connection lost after COMMIT",
      );

      const rows = await mediaRows();
      expect(rows).toHaveLength(1);
      expect(objectKeys()).toEqual([rows[0]?.storageKey]);
      expect(h.logger.entries).toEqual([
        {
          level: "error",
          event: "media_upload_commit_unknown",
          fields: { familyId: seed.family.id },
        },
      ]);
    });

    it("keeps the object when the row cannot even be looked for", async () => {
      const db = new Proxy(h.db, {
        get(target, property) {
          if (property === "transaction") {
            return async () => {
              throw new Error("connection refused");
            };
          }
          if (property === "select") {
            return () => {
              throw new Error("connection refused");
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await expect(upload(testJpeg(), { deps: deps({ db }) })).rejects.toThrow(
        "connection refused",
      );
      expect(objectKeys()).toHaveLength(1);
      expect(h.logger.entries.map((entry) => entry.event)).toEqual(["media_upload_commit_unknown"]);
    });

    it("logs an object it could not delete by the family alone, never the key, and answers as it would have", async () => {
      const store: MediaStore = {
        put: (key, body, mime) => h.media.put(key, body, mime),
        get: (key) => h.media.get(key),
        delete: async () => {
          throw new Error("R2 unavailable");
        },
        head: (key) => h.media.head(key),
      };
      const first = await upload(testJpeg(), { key: "same-key", deps: deps({ store }) });
      const again = await upload(testJpeg(), { key: "same-key", deps: deps({ store }) });

      expect(again).toEqual({ ...first, replayed: true });
      expect(objectKeys()).toHaveLength(2);
      expect(h.logger.entries).toEqual([
        {
          level: "error",
          event: "media_orphan_delete_failed",
          fields: { familyId: seed.family.id, error: "Error" },
        },
      ]);
      expect(logged()).not.toContain("asks/");
    });
  });

  it("is deleted with its object after 30 days when no ask kept it", async () => {
    const body = await uploaded();
    const [row] = await mediaRows();

    h.clock.advance(30 * DAY_MS + 60_000);
    const counts = await applyRetention(h.deps);

    expect(counts.media_deleted).toBe(1);
    expect(await mediaRows()).toEqual([]);
    expect(objectKeys()).toEqual([]);
    expect(row?.storageKey).toMatch(/^asks\//);
    expect(
      (await h.db.select().from(deletions)).filter((deletion) => deletion.objectId === body.id),
    ).toEqual([expect.objectContaining({ objectType: "media", reason: "expired" })]);
  });
});

async function otherFamily(): Promise<{ id: string; identity: SessionIdentity }> {
  const other = await seedFamily(h.db, {
    now: h.clock.now(),
    familyName: "The Lins",
    organiserName: "Lin",
    organiserExternalId: "7001",
    memberExternalId: "7002",
  });
  const identity: SessionIdentity = { authSubject: "auth|Lin", sessionId: "session-lin" };
  await signIn(identity, "Lin", other.organiser.id);
  return { id: other.family.id, identity };
}

describe("readApiMedia", () => {
  async function read(mediaId: string, who: SessionIdentity = mia, familyId = seed.family.id) {
    return readApiMedia(h.db, who, familyId, mediaId, h.media);
  }

  async function exchangeNaming(mediaId: string) {
    const exchange = await seedExchange(h.db, seed, {
      date: addDays(localDateOf(h.clock.now(), seed.member.tz), 1),
      type: "memory_photo",
    });
    await h.db
      .update(exchanges)
      .set({ mediaIds: [mediaId] })
      .where(eq(exchanges.id, exchange.id));
    return exchange;
  }

  it("serves the uploader the photo as it was kept", async () => {
    const body = await uploaded();
    const [row] = await mediaRows();
    const photo = await read(body.id);

    expect(photo?.mime).toBe("image/jpeg");
    expect(new Uint8Array(photo?.body ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(h.media.objects.get(row?.storageKey ?? "")?.body ?? new ArrayBuffer(1)),
    );
  });

  it("keeps an upload nobody has asked with yet to its uploader", async () => {
    const body = await uploaded();
    expect(await read(body.id, sam)).toBeNull();
  });

  it("serves the family a photo one of its exchanges names", async () => {
    const body = await uploaded();
    await exchangeNaming(body.id);
    expect(await read(body.id, sam)).not.toBeNull();
  });

  it("serves the family a photo that came with an answer or a reply", async () => {
    const answered = await uploaded(testJpeg(), { who: mia });
    const replied = await uploaded(testJpeg({ scan: [1, 2, 3] }), { who: mia });
    const exchange = await seedExchange(h.db, seed, {
      date: localDateOf(h.clock.now(), seed.member.tz),
    });
    await h.db.insert(answers).values({
      exchangeId: exchange.id,
      memberId: seed.member.id,
      kind: "photo",
      channel: "telegram",
      externalId: "-100500:1",
      mediaId: answered.id,
    });
    await h.db.insert(replies).values({
      exchangeId: exchange.id,
      memberId: seed.organiser.id,
      kind: "photo",
      channel: "app",
      mediaId: replied.id,
    });

    expect(await read(answered.id, sam)).not.toBeNull();
    expect(await read(replied.id, sam)).not.toBeNull();
  });

  it("serves nothing through another family's path, even to its own uploader", async () => {
    const other = await otherFamily();
    const theirs = await uploaded(testJpeg(), { who: other.identity, familyId: other.id });
    const ours = await uploaded();

    expect(await read(theirs.id)).toBeNull();
    expect(await read(theirs.id, other.identity)).toBeNull();
    expect(await read(ours.id, other.identity, other.id)).toBeNull();
    expect(await read(theirs.id, other.identity, other.id)).not.toBeNull();
  });

  it("serves nothing to a stranger, for an unknown id, or for a photo whose object is gone", async () => {
    const body = await uploaded();
    expect(await read(body.id, stranger)).toBeNull();
    expect(await read(unknownId)).toBeNull();

    h.media.clear();
    expect(await read(body.id)).toBeNull();
  });

  it("serves no row Telegram alone holds, no voice note, and nothing that is not a JPEG", async () => {
    const [telegram, voice, png] = await h.db
      .insert(media)
      .values([
        {
          familyId: seed.family.id,
          uploadedBy: seed.organiser.id,
          kind: "image",
          channel: "telegram",
          providerFileId: "file-id",
        },
        {
          familyId: seed.family.id,
          uploadedBy: seed.organiser.id,
          kind: "audio",
          storageKey: `families/${seed.family.id}/voice.ogg`,
          mime: "audio/ogg",
        },
        {
          familyId: seed.family.id,
          uploadedBy: seed.organiser.id,
          kind: "image",
          storageKey: `families/${seed.family.id}/picture.svg`,
          mime: "image/svg+xml",
        },
      ])
      .returning();
    for (const row of [voice, png]) {
      await h.media.put(row?.storageKey ?? "", new ArrayBuffer(4), row?.mime ?? "");
    }
    for (const row of [telegram, voice, png]) {
      expect(await read(row?.id ?? unknownId)).toBeNull();
    }
  });

  it("answers a media id that is not a uuid without a query", async () => {
    const db = new Proxy(h.db, {
      get() {
        throw new Error("the read queried the database");
      },
    });
    for (const id of ["not-a-uuid", "", `${unknownId}x`, "../../other.jpg"]) {
      expect(await readApiMedia(db, mia, seed.family.id, id, h.media)).toBeNull();
    }
  });

  it("refuses without reading storage when the caller is not of the family", async () => {
    const body = await uploaded();
    const untouched: MediaStore = {
      put: async () => {
        throw new Error("put");
      },
      get: async () => {
        throw new Error("the read opened storage");
      },
      delete: async () => {
        throw new Error("delete");
      },
      head: async () => {
        throw new Error("head");
      },
    };
    expect(await readApiMedia(h.db, stranger, seed.family.id, body.id, untouched)).toBeNull();
    expect(await readApiMedia(h.db, sam, seed.family.id, body.id, untouched)).toBeNull();
  });
});

it("is not a VelaError or an idempotency error, so the API maps it on its own", () => {
  const error = new MediaRefusedError("photo_limit");
  expect(error).not.toBeInstanceOf(VelaError);
  expect(error).not.toBeInstanceOf(ApiIdempotencyError);
  expect(error.name).toBe("MediaRefusedError");
  expect(error.message).not.toContain("asks/");
});
