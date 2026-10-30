/**
 * The family's photo box (ADR-58): adding a photo the caller uploaded, who sees and changes it,
 * taking it out, moving its object out of the prefix the bucket clears, and the free mornings Vela
 * makes from it, signed by Vela, about twice a week. The add's race at the box's limit is
 * `postgres-tests/photo-box-race.test.ts`'s.
 */
import {
  ApiPhotoBox,
  ApiPhotoBoxPhoto,
  ApiUploadedMedia,
  type LocalDate,
  PHOTO_BOX_LIMIT,
} from "@vela/contracts";
import { addDays, zonedInstant } from "@vela/core";
import { exchanges, media, members, outbound, photoBox, photoBoxUses, users } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { composeApiAsk } from "./api-asks.ts";
import { readApiMedia, uploadApiMedia } from "./api-media.ts";
import { deliverArrival, prepareDay } from "./arrivals.ts";
import type { Deps } from "./deps.ts";
import { applyRetention } from "./jobs.ts";
import {
  addToApiPhotoBox,
  changeApiPhotoBoxPhoto,
  keepBoxPhotoStored,
  loadApiPhotoBox,
  PhotoBoxRefusedError,
  removeFromApiPhotoBox,
} from "./photo-box.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { testJpeg } from "./testing/jpeg.ts";
import { type SeededFamily, seedFamily, seedGroupMember } from "./testing/seed.ts";

const TZ = "Asia/Taipei";
const TODAY: LocalDate = "2026-09-14";
const DAY_MS = 24 * 60 * 60 * 1_000;

let h: Harness;
let seed: SeededFamily;
let samMemberId: string;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-sam" };

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

async function signIn(identity: SessionIdentity, name: string, memberId: string): Promise<void> {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: name })
    .returning();
  if (user === undefined) throw new Error(`expected an account for ${name}`);
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
}

/** Deps with the photo box on, as development and staging have it. */
function boxOn(): Deps {
  return { ...h.deps, config: { ...h.deps.config, photoBox: true } };
}

let keys = 0;

async function photo(scan: number, who: SessionIdentity = mia): Promise<string> {
  keys += 1;
  const result = await uploadApiMedia(
    { db: h.db, clock: h.clock, random: h.random, store: h.media, logger: h.logger },
    who,
    `upload-${keys}`,
    seed.family.id,
    testJpeg({ scan: [scan, 0x34, 0x56] }),
  );
  return ApiUploadedMedia.parse(result.response.body).id;
}

async function add(
  mediaId: string,
  era: "new" | "old" = "new",
  caption?: string,
  who: SessionIdentity = mia,
): Promise<ApiPhotoBoxPhoto> {
  keys += 1;
  const result = await addToApiPhotoBox(h.deps, who, `box-${keys}`, seed.family.id, {
    media_id: mediaId,
    era,
    ...(caption === undefined ? {} : { caption }),
  });
  expect(result.response.status).toBe(201);
  return ApiPhotoBoxPhoto.parse(result.response.body);
}

async function boxed(scan: number, era: "new" | "old" = "new", caption?: string) {
  return add(await photo(scan), era, caption);
}

async function photoRow(id: string) {
  const [row] = await h.db.select().from(media).where(eq(media.id, id));
  return row ?? null;
}

async function herExchanges() {
  return h.db
    .select()
    .from(exchanges)
    .where(eq(exchanges.recipientId, seed.member.id))
    .orderBy(asc(exchanges.scheduledFor), asc(exchanges.id));
}

async function arrivalText(): Promise<{ text: string; media?: { storageKey?: string }[] }> {
  const rows = await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"));
  const row = rows.at(-1);
  if (row === undefined) throw new Error("no arrival was written");
  return (row.payload as { message: { text: string; media?: { storageKey?: string }[] } }).message;
}

describe("adding to the photo box", () => {
  it("keeps the photo with no deletion date, and every member of the family sees it", async () => {
    const id = await photo(1);

    const added = await add(id, "old", "  Grandpa's garden, 1978  ");

    expect(added).toMatchObject({ media_id: id, era: "old", caption: "Grandpa's garden, 1978" });
    expect((await photoRow(id))?.expiresAt).toBeNull();
    const seen = ApiPhotoBox.parse(await loadApiPhotoBox(h.db, sam, seed.family.id));
    expect(seen.limit).toBe(PHOTO_BOX_LIMIT);
    expect(seen.photos).toEqual([
      expect.objectContaining({
        id: added.id,
        added_by_name: "Mia",
        can_change: false,
        last_used_on: null,
      }),
    ]);
    // Sam never uploaded it, and no ask has shown it: the box alone shares it.
    expect(
      await readApiMedia(h.db, sam, seed.family.id, id, h.media, "original", h.clock.now()),
    ).not.toBeNull();
  });

  it("shows the box to nobody outside the family", async () => {
    await boxed(1);
    const stranger: SessionIdentity = { authSubject: "auth|Lee", sessionId: "session-lee" };

    expect(await loadApiPhotoBox(h.db, stranger, seed.family.id)).toBeNull();
  });

  it("refuses a photo the caller did not upload, one already in the box, and a full box", async () => {
    const samsPhoto = await photo(1, sam);
    const mine = await photo(2);
    await add(mine);

    await expect(add(samsPhoto)).rejects.toMatchObject({ reason: "photo_missing" });
    await expect(add(mine)).rejects.toMatchObject({ reason: "in_box" });

    // Fill the box to its limit with rows of the family's own stored photos.
    for (let index = 1; index < PHOTO_BOX_LIMIT; index += 1) {
      const [file] = await h.db
        .insert(media)
        .values({
          familyId: seed.family.id,
          uploadedBy: seed.organiser.id,
          kind: "image",
          storageKey: `book/${seed.family.id}/filler-${index}.jpg`,
          mime: "image/jpeg",
          width: 10,
          height: 10,
          // Added days ago, so they do not count against today's uploads.
          createdAt: new Date(h.clock.now().getTime() - 3 * DAY_MS),
          expiresAt: null,
        })
        .returning();
      if (file === undefined) throw new Error("filler not inserted");
      await h.db
        .insert(photoBox)
        .values({ familyId: seed.family.id, mediaId: file.id, era: "new" });
    }
    const another = await photo(3);
    const full = add(another);
    await expect(full).rejects.toBeInstanceOf(PhotoBoxRefusedError);
    await expect(full).rejects.toMatchObject({ reason: "box_full" });
    expect((await photoRow(another))?.expiresAt).not.toBeNull();
  });

  it("moves the photo out of the prefix the bucket clears, and deletes the old object", async () => {
    const id = await photo(1);
    await add(id);
    const before = (await photoRow(id))?.storageKey ?? "";
    expect(before.startsWith("asks/")).toBe(true);

    expect(await keepBoxPhotoStored(h.deps, id)).toBe(true);

    const after = (await photoRow(id))?.storageKey ?? "";
    expect(after).toMatch(new RegExp(`^book/${seed.family.id}/${id}-[A-Za-z0-9_-]+\\.jpg$`));
    expect(h.media.objects.has(before)).toBe(false);
    expect(h.media.objects.has(after)).toBe(true);
  });

  it("leaves retention to move the ones the route missed", async () => {
    const id = await photo(1);
    await add(id);

    const counts = await applyRetention(h.deps);

    expect(counts.photo_box_moved).toBe(1);
    expect((await photoRow(id))?.storageKey?.startsWith("book/")).toBe(true);
  });
});

describe("changing and removing", () => {
  it("changes the era and the line; an empty line clears it", async () => {
    const added = await boxed(1, "new", "At the beach");

    keys += 1;
    const result = await changeApiPhotoBoxPhoto(h.deps, mia, `change-${keys}`, added.id, {
      era: "old",
      caption: "",
    });

    expect(ApiPhotoBoxPhoto.parse(result.response.body)).toMatchObject({
      era: "old",
      caption: null,
    });
  });

  it("lets only whoever added it, or an organiser, change or remove it", async () => {
    const mine = await boxed(1);
    const samsId = await photo(2, sam);
    const his = await add(samsId, "new", undefined, sam);

    await expect(
      removeFromApiPhotoBox(h.deps, sam, "sam-remove", mine.id, {}),
    ).rejects.toMatchObject({ code: "not_found" });
    const removed = await removeFromApiPhotoBox(h.deps, mia, "mia-remove", his.id, {});

    expect(removed.response).toMatchObject({ status: 200, body: { id: his.id, removed: true } });
  });

  it("gives a removed photo its deletion date now, so retention deletes it", async () => {
    const added = await boxed(1);

    await removeFromApiPhotoBox(h.deps, mia, "remove-1", added.id, {});

    expect((await photoRow(added.media_id))?.expiresAt).toEqual(h.clock.now());
    h.clock.set(new Date(h.clock.now().getTime() + 60_000));
    await applyRetention(h.deps);
    expect(await photoRow(added.media_id)).toBeNull();
    expect(await h.db.select().from(photoBox)).toEqual([]);
  });

  it("takes out the photos of someone who left the family, and deletes them", async () => {
    const samsId = await photo(1, sam);
    await add(samsId, "new", undefined, sam);
    const mine = await boxed(2);
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now(), turnsIn: false })
      .where(eq(members.id, samMemberId));

    const counts = await applyRetention(h.deps);

    expect(counts.photo_box_released).toBe(1);
    expect(await photoRow(samsId)).toBeNull();
    expect((await h.db.select().from(photoBox)).map((row) => row.id)).toEqual([mine.id]);
  });
});

describe("her picture mornings", () => {
  function morning(day: number): LocalDate {
    return addDays(TODAY, day);
  }

  async function prepared(day: number, deps: Deps = boxOn()) {
    const date = morning(day);
    const id = await prepareDay(deps, seed.member.id, date);
    const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, id));
    if (row === undefined) throw new Error(`no exchange for ${date}`);
    return row;
  }

  it("shows her a new photo with the family's line, signed by Vela", async () => {
    const added = await boxed(1, "new", "Lily at the beach");

    const row = await prepared(1);

    expect(row).toMatchObject({
      type: "question",
      askerId: null,
      draftedByVela: true,
      mediaIds: [added.media_id],
      state: "scheduled",
    });
    expect(row.text).toContain("“Lily at the beach”");
    h.clock.set(zonedInstant(morning(1), "08:00", TZ));
    await deliverArrival(boxOn(), seed.member.id, morning(1), false);
    const message = await arrivalText();
    expect(message.text).toContain("Lily at the beach");
    expect(message.text).toContain("— Vela");
    expect(message.text).not.toContain("— Mia");
    expect(message.media?.map((file) => file.storageKey)).toEqual([
      (await photoRow(added.media_id))?.storageKey,
    ]);
    const box = ApiPhotoBox.parse(await loadApiPhotoBox(h.db, mia, seed.family.id));
    expect(box.photos[0]?.last_used_on).toBe(morning(1));
  });

  it("asks the question bank as before with the box off", async () => {
    await boxed(1);

    const row = await prepared(1, h.deps);

    expect(row).toMatchObject({ type: "hello", mediaIds: [] });
  });

  it("gives way to an ask the family wrote for that morning", async () => {
    await boxed(1);
    await composeApiAsk(h.deps, mia, "ask-1", seed.family.id, {
      recipient_id: seed.member.id,
      type: "question",
      text: "Did you sleep well?",
      when: "tomorrow",
    });

    const row = await prepared(1);

    expect(row).toMatchObject({ type: "question", askerId: seed.organiser.id });
    expect(await h.db.select().from(photoBoxUses)).toEqual([]);
  });

  it("comes at most twice in seven days, and never two days running", async () => {
    for (let scan = 1; scan <= 6; scan += 1) await boxed(scan);

    const types: string[] = [];
    for (let day = 1; day <= 8; day += 1) {
      types.push((await prepared(day)).type === "hello" ? "bank" : "picture");
    }

    // Day 1 and 3 are pictures; 4 follows one; 5 to 7 already have two in the six days before;
    // day 8 has only day 3 in its six days before.
    expect(types).toEqual([
      "picture",
      "bank",
      "picture",
      "bank",
      "bank",
      "bank",
      "bank",
      "picture",
    ]);
  });

  it("turns old photos into a story and two new ones into a choice, in turn", async () => {
    await boxed(1, "new");
    await boxed(2, "new");
    await boxed(3, "old", "Our first flat");

    const kinds = [(await prepared(1)).type, (await prepared(3)).type, (await prepared(8)).type];

    expect(kinds).toEqual(["question", "memory_photo", "photo_choice"]);
    const story = (await herExchanges()).find((row) => row.type === "memory_photo");
    expect(story?.text).toContain("“Our first flat”");
    const choice = (await herExchanges()).find((row) => row.type === "photo_choice");
    expect(choice?.mediaIds).toHaveLength(2);
  });

  it("shows the photo she has seen least recently first", async () => {
    const first = await boxed(1);
    const second = await boxed(2);
    // Only new photos with one of each kind: the rotation would ask for a story, which falls
    // through to the next kind the box can make.
    const shown = [(await prepared(1)).mediaIds, (await prepared(3)).mediaIds];

    expect(shown[0]).toEqual([second.media_id]);
    expect(shown[1]).toHaveLength(2);
    expect(new Set(shown[1])).toEqual(new Set([first.media_id, second.media_id]));
  });

  it("passes over a photo taken out of the box", async () => {
    const added = await boxed(1);
    await removeFromApiPhotoBox(h.deps, mia, "remove-1", added.id, {});

    const row = await prepared(1);

    expect(row.type).toBe("hello");
  });

  it("keeps the morning when its photo is later removed, and retention deletes the photo", async () => {
    const added = await boxed(1);
    const row = await prepared(1);
    await removeFromApiPhotoBox(h.deps, mia, "remove-1", added.id, {});

    h.clock.set(new Date(h.clock.now().getTime() + DAY_MS));
    await applyRetention(h.deps);

    expect(await photoRow(added.media_id)).toBeNull();
    const [after] = await h.db.select().from(exchanges).where(eq(exchanges.id, row.id));
    expect(after?.mediaIds).toEqual([]);
  });
});
