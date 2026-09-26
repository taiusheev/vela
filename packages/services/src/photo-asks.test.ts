/**
 * Photo asks from the app (ADR-33), after the upload: composing one with the photos it names,
 * delivering it to Telegram as an upload of the stored bytes, showing it on Today and Exchanges,
 * and deleting the photos after their 30 days. The upload itself is `api-media.test.ts`'s.
 */
import { ApiComposedAsk, ApiUploadedMedia, type LocalDate } from "@vela/contracts";
import { addDays, decodeButton, zonedInstant } from "@vela/core";
import {
  answers,
  deletions,
  type Exchange,
  events,
  exchanges,
  media,
  members,
  outbound,
  replies,
  users,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { AskPhotoMissingError, composeApiAsk } from "./api-asks.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { uploadApiMedia } from "./api-media.ts";
import { exchangeRow } from "./api-today.ts";
import { deliverArrival } from "./arrivals.ts";
import type { Deps, MediaStore, OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { applyRetention } from "./jobs.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { testJpeg } from "./testing/jpeg.ts";
import { type SeededFamily, seedExchange, seedFamily, seedGroupMember } from "./testing/seed.ts";

const TZ = "Asia/Taipei";
const TODAY: LocalDate = "2026-09-14";
const TOMORROW: LocalDate = "2026-09-15";
const DAY_MS = 24 * 60 * 60 * 1_000;
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000001";

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

function at(date: LocalDate, time: string): Date {
  return zonedInstant(date, time, TZ);
}

let keys = 0;

/** A photo uploaded from the app; each `scan` makes a different photo. */
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

async function compose(body: Record<string, unknown>, who: SessionIdentity = mia, key?: string) {
  keys += 1;
  return composeApiAsk(h.deps, who, key ?? `compose-${keys}`, seed.family.id, {
    recipient_id: seed.member.id,
    type: "photo_choice",
    text: "Which one do you like more?",
    when: "tomorrow",
    ...body,
  });
}

async function photoRow(id: string) {
  const [row] = await h.db.select().from(media).where(eq(media.id, id));
  if (row === undefined) throw new Error(`photo ${id} is gone`);
  return row;
}

async function storageKeyOf(id: string): Promise<string> {
  const key = (await photoRow(id)).storageKey;
  if (key === null) throw new Error(`photo ${id} has no storage key`);
  return key;
}

async function herExchanges(): Promise<Exchange[]> {
  return h.db
    .select()
    .from(exchanges)
    .where(eq(exchanges.recipientId, seed.member.id))
    .orderBy(asc(exchanges.createdAt), asc(exchanges.id));
}

/** A photo Telegram holds, as the group's photos and her answers are recorded. */
async function telegramPhoto(
  row: { familyId?: string; uploadedBy?: string; kind?: "image" | "audio" } = {},
): Promise<string> {
  keys += 1;
  const [inserted] = await h.db
    .insert(media)
    .values({
      familyId: row.familyId ?? seed.family.id,
      uploadedBy: row.uploadedBy ?? seed.organiser.id,
      kind: row.kind ?? "image",
      channel: "telegram",
      providerFileId: `file-${keys}`,
      providerUniqueId: `unique-${keys}`,
      width: 1280,
      height: 960,
      createdAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 30 * DAY_MS),
    })
    .returning({ id: media.id });
  if (inserted === undefined) throw new Error("photo not inserted");
  return inserted.id;
}

function handlers(deps: Deps = h.deps): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(deps, job.outboundId) };
}

async function arrivalRows() {
  return h.db.select().from(outbound).where(eq(outbound.kind, "arrival"));
}

interface StoredMessage {
  text: string;
  media?: Record<string, unknown>[];
  buttons: { id: string; label: string }[][];
}

async function arrivalMessage(): Promise<StoredMessage> {
  const [row] = await arrivalRows();
  if (row === undefined) throw new Error("no arrival was written");
  return (row.payload as { message: StoredMessage }).message;
}

describe("composing a photo ask", () => {
  it("names the photos in her order and answers 201", async () => {
    const first = await photo(1);
    const second = await photo(2);

    const result = await compose({ media_ids: [second, first] });

    expect(result.response.status).toBe(201);
    const body = ApiComposedAsk.parse(result.response.body);
    expect(body).toMatchObject({ type: "photo_choice", scheduled_for: TOMORROW });
    const [row] = await herExchanges();
    expect(row).toMatchObject({ id: body.id, type: "photo_choice", mediaIds: [second, first] });
    const [composed] = await h.db.select().from(events).where(eq(events.name, "ask_composed"));
    expect(composed?.props).toMatchObject({ type: "photo_choice", media: 2 });
  });

  it("composes an old photo with its one photo, and a date ask two weeks out", async () => {
    const old = await photo(3);
    const date = addDays(TODAY, 14);

    await compose({ type: "memory_photo", text: "Do you remember this?", media_ids: [old] });
    await compose({ when: "date", date, media_ids: [await photo(4), await photo(5)] });

    expect((await herExchanges()).map((row) => [row.type, row.scheduledFor])).toEqual([
      ["memory_photo", TOMORROW],
      ["photo_choice", date],
    ]);
  });

  it("replays the same ask under its key, and refuses the key for other photos", async () => {
    const first = await photo(1);
    const second = await photo(2);
    const third = await photo(3);
    const ask = await compose({ media_ids: [first, second] }, mia, "same-key");

    const again = await compose({ media_ids: [first, second] }, mia, "same-key");
    const other = compose({ media_ids: [first, third] }, mia, "same-key");

    expect(again).toMatchObject({ replayed: true, response: ask.response });
    await expect(other).rejects.toBeInstanceOf(ApiIdempotencyError);
    await expect(other).rejects.toMatchObject({ code: "conflict" });
    expect(await herExchanges()).toHaveLength(1);
  });

  describe("refuses a photo she cannot be shown, composing nothing", () => {
    const cases: [string, () => Promise<string>][] = [
      ["an id nothing has", async () => UNKNOWN_ID],
      [
        "another family's photo",
        async () => {
          const neighbours = await seedFamily(h.db, {
            now: h.clock.now(),
            familyName: "The Wangs",
            organiserExternalId: "1003",
            memberExternalId: "2003",
          });
          return telegramPhoto({
            familyId: neighbours.family.id,
            uploadedBy: neighbours.organiser.id,
          });
        },
      ],
      ["a voice note", async () => telegramPhoto({ kind: "audio" })],
      ["Sam's upload, which he has not asked with yet", async () => photo(7, sam)],
      [
        "a photo deleted the day after her morning, before a pick can be settled",
        async () => {
          const id = await photo(8);
          const until = zonedInstant(addDays(TOMORROW, 2), "00:00", TZ);
          await h.db.update(media).set({ expiresAt: until }).where(eq(media.id, id));
          return id;
        },
      ],
      [
        "a photo with no deletion date that the family has not kept",
        async () => {
          const id = await photo(9);
          await h.db.update(media).set({ expiresAt: null }).where(eq(media.id, id));
          return id;
        },
      ],
    ];

    it.each(cases)("%s", async (_name, make) => {
      const good = await photo(1);
      const bad = await make();

      await expect(compose({ media_ids: [good, bad] })).rejects.toBeInstanceOf(
        AskPhotoMissingError,
      );
      await expect(compose({ type: "memory_photo", media_ids: [bad] })).rejects.toBeInstanceOf(
        AskPhotoMissingError,
      );
      expect(await herExchanges()).toEqual([]);
    });
  });

  it("dates a photo's deadline from her real morning, in her zone", async () => {
    const date = addDays(TODAY, 10);
    const until = zonedInstant(addDays(date, 2), "00:00", TZ);
    const lasting = await photo(1);
    const other = await photo(2);
    await h.db
      .update(media)
      .set({ expiresAt: new Date(until.getTime() + 1) })
      .where(eq(media.id, lasting));

    await compose({ when: "date", date, media_ids: [lasting, other] });
    await expect(
      compose({ when: "date", date: addDays(date, 1), media_ids: [lasting, other] }),
    ).rejects.toBeInstanceOf(AskPhotoMissingError);

    expect((await herExchanges()).map((row) => row.scheduledFor)).toEqual([date]);
  });

  it("takes a photo the family keeps, whenever it would have been deleted", async () => {
    const kept = await photo(1);
    await h.db.update(media).set({ kept: true, expiresAt: null }).where(eq(media.id, kept));

    await compose({ type: "memory_photo", media_ids: [kept] });

    expect(await herExchanges()).toHaveLength(1);
  });

  it("lets anyone in the family ask with a photo the family already shares", async () => {
    const sams = await photo(1, sam);
    await compose({ type: "memory_photo", media_ids: [sams] }, sam);
    // Her own photo, carried by her answer, is the family's too.
    const answered = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "answered",
      deliveredAt: at(TODAY, "08:00"),
      answeredAt: at(TODAY, "09:00"),
    });
    const hers = await telegramPhoto({ uploadedBy: seed.member.id });
    await h.db.insert(answers).values({
      exchangeId: answered.id,
      memberId: seed.member.id,
      kind: "photo",
      channel: "telegram",
      externalId: "2001:9",
      mediaId: hers,
      receivedAt: at(TODAY, "09:00"),
    });

    await compose({ when: "date", date: addDays(TODAY, 2), media_ids: [sams, hers] });

    const asked = await herExchanges();
    expect(asked.find((row) => row.type === "memory_photo")?.mediaIds).toEqual([sams]);
    expect(asked.find((row) => row.type === "photo_choice")?.mediaIds).toEqual([sams, hers]);
  });

  it("refuses photos on a whenever ask, and the wrong number of photos, as invalid", async () => {
    const first = await photo(1);
    const second = await photo(2);
    for (const body of [
      { when: "whenever", media_ids: [first, second] },
      { media_ids: [first] },
      { type: "memory_photo", media_ids: [first, second] },
      { type: "question", media_ids: [first] },
      { media_ids: [first, first] },
    ]) {
      const refused = compose(body);
      await expect(refused, JSON.stringify(body)).rejects.toBeInstanceOf(ApiIdempotencyError);
      await expect(refused, JSON.stringify(body)).rejects.toMatchObject({ code: "invalid" });
    }
    expect(await herExchanges()).toEqual([]);
  });
});

describe("delivering a photo ask to Telegram", () => {
  async function composedChoice(): Promise<{ id: string; photos: string[]; keys: string[] }> {
    const first = await photo(1);
    const second = await photo(2);
    const result = await compose({ media_ids: [first, second] });
    const { id } = ApiComposedAsk.parse(result.response.body);
    return {
      id,
      photos: [first, second],
      keys: [await storageKeyOf(first), await storageKeyOf(second)],
    };
  }

  it("uploads both stored photos as one album before the 1 and 2 buttons, and keeps no URL", async () => {
    const ask = await composedChoice();
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);

    const message = await arrivalMessage();
    expect(message.media).toEqual(
      ask.keys.map((storageKey) => ({
        kind: "image",
        storageKey,
        mime: "image/jpeg",
        bytes: h.media.objects.get(storageKey)?.body.byteLength,
      })),
    );
    expect(JSON.stringify(message)).not.toMatch(/https?:/);
    expect(message.text).toContain(
      "Mia asks:\nWhich one do you like more?\nWhich one? Tap 1 or 2.",
    );
    expect(message.buttons[0]?.map((button) => decodeButton(button.id))).toEqual([
      { type: "pick", exchangeId: ask.id, index: 0 },
      { type: "pick", exchangeId: ask.id, index: 1 },
    ]);

    await h.run(handlers());

    const [sent] = h.telegram.sent;
    expect(sent?.uploads.map((upload) => upload.storageKey)).toEqual(ask.keys);
    expect(sent?.uploads.map((upload) => upload.file.body)).toEqual(
      ask.keys.map((key) => h.media.objects.get(key)?.body),
    );
    const [row] = await herExchanges();
    expect(row).toMatchObject({ state: "delivered" });
  });

  it("sends a Telegram photo by its file id beside an uploaded one", async () => {
    const telegram = await telegramPhoto();
    const stored = await photo(1);
    await compose({ media_ids: [telegram, stored] });
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    await h.run(handlers());

    const [sent] = h.telegram.sent;
    expect(sent?.message.media).toEqual([
      { kind: "image", providerFileId: (await photoRow(telegram)).providerFileId },
      expect.objectContaining({ storageKey: await storageKeyOf(stored) }),
    ]);
    expect(sent?.uploads.map((upload) => upload.storageKey)).toEqual([await storageKeyOf(stored)]);
  });

  it("turns a choice whose photo is gone from storage into a question with the photo left", async () => {
    const ask = await composedChoice();
    const [kept, lost] = ask.keys;
    if (kept === undefined || lost === undefined) throw new Error("expected two keys");
    await h.media.delete(lost);
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);

    const message = await arrivalMessage();
    expect(message.media).toEqual([expect.objectContaining({ storageKey: kept })]);
    expect(message.text).not.toContain("Tap 1 or 2");
    expect(message.buttons.flat().map((button) => decodeButton(button.id)?.type)).not.toContain(
      "pick",
    );
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "media_not_sendable",
      fields: { familyId: seed.family.id, count: 1 },
    });
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "photo_choice_without_two_images",
      fields: { exchangeId: ask.id, images: 1 },
    });
  });

  it("leaves stored photos out while storage is off, so the choice goes as words", async () => {
    await composedChoice();
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival({ ...h.deps, media: null }, seed.member.id, TOMORROW, false);

    const message = await arrivalMessage();
    expect(message.media).toBeUndefined();
    expect(message.text).not.toContain("Tap 1 or 2");
  });

  it("tries her morning again when storage cannot say whether a photo is there", async () => {
    await composedChoice();
    h.clock.set(at(TOMORROW, "08:00"));
    const failing: MediaStore = {
      ...h.media,
      head: async () => {
        throw new Error("R2 unavailable");
      },
    };

    await expect(
      deliverArrival({ ...h.deps, media: failing }, seed.member.id, TOMORROW, false),
    ).rejects.toThrow("R2 unavailable");

    expect(await arrivalRows()).toEqual([]);
  });

  it("holds a send whose photo vanished after the arrival was written, rather than send one photo under two buttons", async () => {
    const ask = await composedChoice();
    const lost = ask.keys[1];
    if (lost === undefined) throw new Error("expected two keys");
    h.clock.set(at(TOMORROW, "08:00"));
    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    const saved = h.media.objects.get(lost);
    if (saved === undefined) throw new Error("expected the stored photo");
    await h.media.delete(lost);

    await h.runDue(handlers());

    expect(h.telegram.sent).toEqual([]);
    const [row] = await arrivalRows();
    expect(row).toMatchObject({ status: "queued", attempts: 1 });
    expect(row?.error).toBe("unavailable: stored media is missing");
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "outbound_media_missing",
      fields: { outboundId: row?.id, count: 1 },
    });
    expect(JSON.stringify(h.logger.entries)).not.toContain(lost);

    // Back before the retry: the next attempt loads both again and sends the album.
    await h.media.put(lost, saved.body, saved.mime);
    await h.run(handlers());

    expect(h.telegram.sent.map((sent) => sent.uploads.length)).toEqual([2]);
  });

  it("retries a send whose photo the store fails to read", async () => {
    await composedChoice();
    h.clock.set(at(TOMORROW, "08:00"));
    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    const failing: MediaStore = {
      ...h.media,
      get: async () => {
        throw new Error("R2 unavailable");
      },
    };

    await h.runDue(handlers({ ...h.deps, media: failing }));

    expect(h.telegram.sent).toEqual([]);
    const [row] = await arrivalRows();
    expect(row).toMatchObject({ status: "queued", attempts: 1 });
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "outbound_media_unreadable",
      fields: { outboundId: row?.id, error: "Error" },
    });
  });

  it("keeps both photos of a choice whole when yesterday's voices would fill the message", async () => {
    const previous = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "answered",
      deliveredAt: at(TODAY, "08:00"),
      answeredAt: at(TODAY, "09:00"),
    });
    for (let index = 0; index < 9; index += 1) {
      const voice = await telegramPhoto({ kind: "audio" });
      await h.db.insert(replies).values({
        exchangeId: previous.id,
        memberId: seed.organiser.id,
        kind: "voice",
        mediaId: voice,
        channel: "telegram",
        externalId: `-100:${index}`,
        toRecipient: true,
        createdAt: at(TODAY, `1${index}:00`),
      });
    }
    const ask = await composedChoice();
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);

    const message = await arrivalMessage();
    expect(message.media?.map((ref) => ref.kind)).toEqual([
      ...Array(8).fill("audio"),
      "image",
      "image",
    ]);
    expect(message.media?.slice(8).map((ref) => ref.storageKey)).toEqual(ask.keys);
    expect(message.text).toContain("Tap 1 or 2");
  });
});

describe("the photos Today and Exchanges show", () => {
  it("lists the ask's own images in her order, sized, and whether the app can show them", async () => {
    const stored = await photo(1);
    const telegram = await telegramPhoto();
    const voice = await telegramPhoto({ kind: "audio" });
    const [row] = await h.db
      .insert(exchanges)
      .values({
        familyId: seed.family.id,
        recipientId: seed.member.id,
        askerId: seed.organiser.id,
        type: "photo_choice",
        state: "delivered",
        text: "Which one?",
        textLang: "en",
        whenRule: "tomorrow",
        scheduledFor: TODAY,
        mediaIds: [telegram, UNKNOWN_ID, voice, stored],
      })
      .returning();
    if (row === undefined) throw new Error("exchange not inserted");

    const shown = await exchangeRow(h.db, row, { id: seed.member.id, displayName: "Mom" });

    expect(shown.photos).toEqual([
      { id: telegram, width: 1280, height: 960, stored: false },
      { id: stored, width: 640, height: 480, stored: true },
    ]);
    expect(shown.answer).toBeNull();
  });

  it("shows the photo she picked, still after she went on to say something", async () => {
    const first = await photo(1);
    const second = await photo(2);
    const choice = await seedExchange(h.db, seed, {
      date: TODAY,
      type: "photo_choice",
      state: "answered",
      deliveredAt: at(TODAY, "08:00"),
      answeredAt: at(TODAY, "09:00"),
    });
    await h.db
      .update(exchanges)
      .set({ mediaIds: [first, second] })
      .where(eq(exchanges.id, choice.id));
    const updated = { ...choice, mediaIds: [first, second] };
    await h.db.insert(answers).values({
      exchangeId: choice.id,
      memberId: seed.member.id,
      kind: "photo_pick",
      channel: "telegram",
      externalId: "2001:10",
      payload: { index: 1, media_id: second },
      receivedAt: at(TODAY, "09:00"),
    });
    const recipient = { id: seed.member.id, displayName: "Mom" };

    expect((await exchangeRow(h.db, updated, recipient)).answer).toMatchObject({
      kind: "photo_pick",
      picked_media_id: second,
    });

    await h.db.insert(answers).values({
      exchangeId: choice.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2001:11",
      payload: { text: "The blue one, from Tainan." },
      receivedAt: at(TODAY, "09:05"),
    });
    expect((await exchangeRow(h.db, updated, recipient)).answer).toMatchObject({
      kind: "text",
      text: "The blue one, from Tainan.",
      picked_media_id: second,
    });
  });

  it("names no pick on any other exchange", async () => {
    const question = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "answered",
      deliveredAt: at(TODAY, "08:00"),
      answeredAt: at(TODAY, "09:00"),
    });
    await h.db.insert(answers).values({
      exchangeId: question.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2001:12",
      payload: { text: "Soup", media_id: UNKNOWN_ID },
      receivedAt: at(TODAY, "09:00"),
    });

    const shown = await exchangeRow(h.db, question, { id: seed.member.id, displayName: "Mom" });

    expect(shown.answer?.picked_media_id).toBeNull();
    expect(shown.photos).toEqual([]);
  });
});

describe("deleting a photo ask's photos after 30 days", () => {
  it("deletes the objects, the rows and the ids in the ask, with a proof for each", async () => {
    const first = await photo(1);
    const second = await photo(2);
    await compose({ media_ids: [first, second] });
    h.clock.set(new Date(h.clock.now().getTime() + 30 * DAY_MS + 60_000));

    await applyRetention(h.deps);

    expect(await h.db.select().from(media)).toEqual([]);
    expect(h.media.objects.size).toBe(0);
    const proofs = await h.db.select().from(deletions);
    expect(proofs.filter((proof) => proof.objectType === "media")).toHaveLength(2);
    expect((await herExchanges()).map((row) => row.mediaIds)).toEqual([[]]);
  });

  it("still deletes the rows with storage off, and says the objects are out of reach", async () => {
    const first = await photo(1);
    const second = await photo(2);
    await compose({ media_ids: [first, second] });
    h.clock.set(new Date(h.clock.now().getTime() + 30 * DAY_MS + 60_000));

    await applyRetention({ ...h.deps, media: null });

    expect(await h.db.select().from(media)).toEqual([]);
    expect(h.media.objects.size).toBe(2);
    expect(
      h.logger.entries.filter((entry) => entry.event === "media_object_unreachable"),
    ).toHaveLength(2);
    expect((await herExchanges()).map((row) => row.mediaIds)).toEqual([[]]);
  });
});
