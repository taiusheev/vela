/**
 * Photo asks from the app (ADR-33), after the upload: composing one with the photos it names,
 * delivering it to Telegram as an upload of the stored bytes, showing it on Today and Exchanges,
 * and deleting the photos after their 30 days. The upload itself is `api-media.test.ts`'s.
 */
import {
  ApiComposedAsk,
  ApiUploadedMedia,
  ChannelSendError,
  type InboundEvent,
  type LocalDate,
} from "@vela/contracts";
import { addDays, decodeButton, encodeButton, zonedInstant } from "@vela/core";
import {
  answers,
  deletions,
  type Exchange,
  events,
  exchanges,
  media,
  members,
  outbound,
  quietEvents,
  replies,
  users,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AnswerButtonAction, handleAnswerButton } from "./answers.ts";
import type { SessionIdentity } from "./api-access.ts";
import { AskPhotoMissingError, composeApiAsk } from "./api-asks.ts";
import { setUpApiDevice } from "./api-device.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { uploadApiMedia } from "./api-media.ts";
import { exchangeRow } from "./api-today.ts";
import { deliverArrival, loadAsk, prepareDay } from "./arrivals.ts";
import type { Deps, MediaStore, OutboundJob } from "./deps.ts";
import { loadDeviceMessages, readDeviceMedia } from "./device-messages.ts";
import { deliverOutbound } from "./gateway.ts";
import { applyRetention } from "./jobs.ts";
import { openQuiet } from "./quiet.ts";
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

async function mediaIdsLeft(): Promise<string[]> {
  return (await h.db.select({ id: media.id }).from(media)).map((row) => row.id).sort();
}

/** Her tap on a button of the message Telegram holds as `messageId`, in her own chat. */
async function tapOn(messageId: string, action: AnswerButtonAction): Promise<void> {
  keys += 1;
  const event: InboundEvent = {
    channel: "telegram",
    eventId: `tg:tap-${keys}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: seed.memberLink.externalId },
    conversation: { externalId: seed.memberLink.externalId, kind: "private" },
    messageId,
    kind: "button",
    buttonData: encodeButton(action),
    callbackId: `cb-${keys}`,
  };
  await handleAnswerButton(h.deps, seed.member, event, action);
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

  // Her pick is read until the day after her morning is over (flows §3.9), so a photo retention
  // deletes by then is gone already: her "1" and "2" are never drawn over a photo that can vanish
  // before she taps. The day ends in her zone, and a photo that lasts past it is sent.
  it("sends a choice whose photo is deleted before the day after her morning is over as a question with the photo that lasts", async () => {
    const ask = await composedChoice();
    const [going, lasting] = ask.photos;
    const lastingKey = ask.keys[1];
    if (going === undefined || lasting === undefined) throw new Error("expected two photos");
    const end = zonedInstant(addDays(TOMORROW, 2), "00:00", TZ);
    await h.db.update(media).set({ expiresAt: end }).where(eq(media.id, going));
    await h.db
      .update(media)
      .set({ expiresAt: new Date(end.getTime() + 1) })
      .where(eq(media.id, lasting));
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);

    const message = await arrivalMessage();
    expect(message.media).toEqual([expect.objectContaining({ storageKey: lastingKey })]);
    expect(message.text).toContain("Mia asks:\nWhich one do you like more?");
    expect(message.text).not.toContain("Tap 1 or 2");
    expect(message.buttons.flat().map((button) => decodeButton(button.id)?.type)).not.toContain(
      "pick",
    );
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "ask_media_expiring",
      fields: { familyId: seed.family.id, exchangeId: ask.id, count: 1 },
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

  it("leaves stored photos out for a channel that cannot upload them, such as LINE, so the choice goes as words", async () => {
    const ask = await composedChoice();
    const [exchange] = await herExchanges();
    if (exchange === undefined) throw new Error("expected her photo ask");

    const morning = { date: TOMORROW, timeZone: TZ };
    const onLine = await loadAsk(h.deps, seed.family, exchange, "line", morning);

    expect(onLine.ask).toMatchObject({ type: "question", imageCount: 0 });
    expect(onLine.media).toEqual([]);
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "media_not_sendable_on_channel",
      fields: { familyId: seed.family.id, channel: "line", count: 2 },
    });
    expect(h.logger.entries.map((entry) => entry.event)).not.toContain("media_not_sendable");
    // The same ask on Telegram still carries both photos, to be uploaded.
    const onTelegram = await loadAsk(h.deps, seed.family, exchange, "telegram", morning);
    expect(onTelegram.ask).toMatchObject({ type: "photo_choice", imageCount: 2 });
    expect(onTelegram.media.map((ref) => ref.storageKey)).toEqual(ask.keys);
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

/**
 * An ask whose morning passed unsent is carried to her next morning (flows §3.6), which can come
 * after its photos' 30 days: compose checks them only against the morning it was asked for. By
 * then retention has deleted them, or a photo's object has gone while its row stands, or they are
 * deleted before her pick on the new morning could be read, and the choice must go as a question
 * with what is left, once.
 */
describe("a photo ask on her phone (ADR-35)", () => {
  async function herRow() {
    const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    if (row === undefined) throw new Error("expected her");
    return row;
  }

  it("shows both stored photos by id under her 1 and 2, and loads no bytes to send them", async () => {
    const first = await photo(1);
    const second = await photo(2);
    const { id } = ApiComposedAsk.parse(
      (await compose({ media_ids: [first, second] })).response.body,
    );
    await setUpApiDevice(h.deps, mia, seed.family.id, seed.member.id);
    h.clock.set(at(TOMORROW, "08:00"));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    // Her phone reads each photo itself, so a store that cannot be read does not stop her morning.
    const unreadable: MediaStore = {
      ...h.media,
      get: async () => {
        throw new Error("R2 unavailable");
      },
    };
    await h.run(handlers({ ...h.deps, media: unreadable }));

    const [morning] = await loadDeviceMessages(h.db, await herRow());
    expect(morning).toMatchObject({ kind: "arrival", exchange_id: id, photos: [first, second] });
    expect(morning?.text).toContain("Which one? Tap 1 or 2.");
    expect(morning?.buttons[0]?.map((button) => decodeButton(button.id))).toEqual([
      { type: "pick", exchangeId: id, index: 0 },
      { type: "pick", exchangeId: id, index: 1 },
    ]);
    expect(h.telegram.sent).toEqual([]);
    const shown = await readDeviceMedia(h.db, await herRow(), first, h.media);
    expect(new Uint8Array(shown?.body ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(h.media.objects.get(await storageKeyOf(first))?.body ?? new ArrayBuffer(1)),
    );
  });

  it("copies a photo Telegram alone holds into the store first, so both photos reach her phone", async () => {
    const telegram = await telegramPhoto();
    const fileId = (await photoRow(telegram)).providerFileId ?? "";
    const jpeg = testJpeg({ scan: [9, 9, 9] });
    h.telegram.mediaFiles.set(fileId, { body: jpeg.slice().buffer, mime: "image/jpeg" });
    const stored = await photo(1);
    await compose({ media_ids: [telegram, stored] });
    const [exchange] = await herExchanges();
    if (exchange === undefined) throw new Error("expected her photo ask");

    const onPhone = await loadAsk(h.deps, seed.family, exchange, "device", {
      date: TOMORROW,
      timeZone: TZ,
    });

    expect(onPhone.ask).toMatchObject({ type: "photo_choice", imageCount: 2 });
    const copy = await photoRow(telegram);
    expect(copy).toMatchObject({ mime: "image/jpeg", bytes: jpeg.byteLength });
    expect(copy.storageKey).toBe(`families/${seed.family.id}/media/${telegram}.jpg`);
    expect(onPhone.media.map((ref) => ref.storageKey)).toEqual([
      copy.storageKey,
      await storageKeyOf(stored),
    ]);
    // Asked again, it is not fetched again.
    await loadAsk(h.deps, seed.family, exchange, "device", { date: TOMORROW, timeZone: TZ });
    expect(h.telegram.fetched.filter((id) => id === fileId)).toHaveLength(1);
  });

  it("leaves out a photo Telegram can no longer give, so a choice short of it goes as a question", async () => {
    const telegram = await telegramPhoto();
    const stored = await photo(1);
    await compose({ media_ids: [telegram, stored] });
    const [exchange] = await herExchanges();
    if (exchange === undefined) throw new Error("expected her photo ask");
    const gone: Deps = {
      ...h.deps,
      channels: {
        get: () => ({
          ...h.telegram,
          fetchMedia: async () => {
            throw new ChannelSendError("not_found", "file is gone");
          },
        }),
      },
    };

    const onPhone = await loadAsk(gone, seed.family, exchange, "device", {
      date: TOMORROW,
      timeZone: TZ,
    });

    expect(onPhone.ask).toMatchObject({ type: "question", imageCount: 1 });
    expect(onPhone.media.map((ref) => ref.storageKey)).toEqual([await storageKeyOf(stored)]);
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "media_copy_fetch_failed",
      fields: { mediaId: telegram, code: "not_found" },
    });
    expect((await photoRow(telegram)).storageKey).toBeNull();
  });

  it("names a Telegram photo by its stored copy once it has one", async () => {
    const telegram = await telegramPhoto();
    await h.db.update(media).set({ storageKey: "copied/one.jpg" }).where(eq(media.id, telegram));
    await h.media.put("copied/one.jpg", new Uint8Array([0xff, 0xd8]).buffer, "image/jpeg");
    const stored = await photo(1);
    await compose({ media_ids: [telegram, stored] });
    const [exchange] = await herExchanges();
    if (exchange === undefined) throw new Error("expected her photo ask");

    const onPhone = await loadAsk(h.deps, seed.family, exchange, "device", {
      date: TOMORROW,
      timeZone: TZ,
    });

    expect(onPhone.ask).toMatchObject({ type: "photo_choice", imageCount: 2 });
    expect(onPhone.media.map((ref) => ref.storageKey)).toEqual([
      "copied/one.jpg",
      await storageKeyOf(stored),
    ]);
    expect(onPhone.media.every((ref) => ref.providerFileId === undefined)).toBe(true);
  });

  it("shows her phone only what her family shares: not an upload nobody asked with, nor a stranger's id", async () => {
    const unasked = await photo(3);
    const her = await herRow();

    expect(await readDeviceMedia(h.db, her, unasked, h.media)).toBeNull();
    expect(await readDeviceMedia(h.db, her, UNKNOWN_ID, h.media)).toBeNull();
    expect(await readDeviceMedia(h.db, her, "not-a-uuid", h.media)).toBeNull();

    await compose({ media_ids: [unasked, await photo(4)] });
    expect(await readDeviceMedia(h.db, her, unasked, h.media)).not.toBeNull();
  });
});

describe("a photo ask carried past its photos' deletion", () => {
  const SKIPPED = TOMORROW;
  const CARRIED_TO = addDays(TOMORROW, 3);

  /**
   * A choice of two photos for tomorrow, the ones named in `expiring` deleted at `expiresAt`: by
   * default uploaded 29 days ago, so their 30 days end just after the day her pick would still be
   * read. Her morning is queued at 08:00 and dropped unsent, since she said stop just before it
   * went; she says start two days later and retention runs, and at 22:00 her next morning carries
   * the ask, which names both photos in their places whatever retention deleted.
   */
  async function carriedPastRetention(
    expiring: readonly (0 | 1)[],
    expiresAt = new Date(zonedInstant(addDays(SKIPPED, 2), "00:00", TZ).getTime() + 60_000),
  ): Promise<{ id: string; photos: string[] }> {
    const photos = [await photo(1), await photo(2)];
    for (const index of expiring) {
      await h.db
        .update(media)
        .set({ expiresAt })
        .where(eq(media.id, photos[index] ?? ""));
    }
    const { id } = ApiComposedAsk.parse((await compose({ media_ids: photos })).response.body);

    h.clock.set(at(SKIPPED, "08:00"));
    await deliverArrival(h.deps, seed.member.id, SKIPPED, false);
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));
    await h.run(handlers());
    expect((await arrivalRows()).map((row) => [row.localDay, row.status, row.error])).toEqual([
      [SKIPPED, "dropped", "member_paused"],
    ]);

    h.clock.set(at(addDays(SKIPPED, 2), "12:00"));
    await h.db.update(members).set({ status: "active" }).where(eq(members.id, seed.member.id));
    await applyRetention(h.deps);
    h.clock.set(at(addDays(CARRIED_TO, -1), "22:00"));
    expect(await prepareDay(h.deps, seed.member.id, CARRIED_TO)).toBe(id);

    const [ask] = await herExchanges();
    expect(ask).toMatchObject({ id, scheduledFor: CARRIED_TO, mediaIds: photos });
    return { id, photos };
  }

  /** Her carried morning at 08:00, queued by two ticks, and then delivered. */
  async function deliverTheCarriedMorning(): Promise<void> {
    h.clock.set(at(CARRIED_TO, "08:00"));
    await deliverArrival(h.deps, seed.member.id, CARRIED_TO, false);
    await deliverArrival(h.deps, seed.member.id, CARRIED_TO, false);
    await h.run(handlers());
  }

  /** The one arrival that reached her, on the morning the ask was carried to. */
  async function theOneArrival() {
    expect((await arrivalRows()).map((row) => [row.localDay, row.status])).toEqual([
      [SKIPPED, "dropped"],
      [CARRIED_TO, "sent"],
    ]);
    const sent = h.telegram.sent.filter((entry) => entry.message.kind === "arrival");
    expect(sent).toHaveLength(1);
    const [only] = sent;
    if (only === undefined) throw new Error("expected her carried morning");
    return only;
  }

  it("sends a choice that lost one photo once, on the morning it was carried to, as a question with the photo left", async () => {
    const ask = await carriedPastRetention([0]);
    const [, left] = ask.photos;
    if (left === undefined) throw new Error("expected one photo left");
    expect(await mediaIdsLeft()).toEqual([left]);
    const leftKey = await storageKeyOf(left);

    await deliverTheCarriedMorning();

    const sent = await theOneArrival();
    expect(sent.message.media).toEqual([expect.objectContaining({ storageKey: leftKey })]);
    expect(sent.uploads.map((upload) => upload.storageKey)).toEqual([leftKey]);
    expect(sent.message.text).toContain("Which one do you like more?");
    expect(sent.message.text).not.toContain("Tap 1 or 2");
    expect(
      (sent.message.buttons ?? []).flat().map((button) => decodeButton(button.id)?.type),
    ).not.toContain("pick");
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "photo_choice_without_two_images",
      fields: { exchangeId: ask.id, images: 1 },
    });
    expect((await herExchanges())[0]).toMatchObject({
      state: "delivered",
      deliveredAt: at(CARRIED_TO, "08:00"),
    });
  });

  it("sends a choice that lost both photos once, on the morning it was carried to, as a plain question", async () => {
    const ask = await carriedPastRetention([0, 1]);
    expect(await mediaIdsLeft()).toEqual([]);

    await deliverTheCarriedMorning();

    const sent = await theOneArrival();
    expect(sent.message.media).toBeUndefined();
    expect(sent.uploads).toEqual([]);
    expect(sent.message.text).toContain("Mia asks:\nWhich one do you like more?");
    expect(sent.message.text).not.toContain("Tap 1 or 2");
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "photo_choice_without_two_images",
      fields: { exchangeId: ask.id, images: 0 },
    });
    expect((await herExchanges())[0]).toMatchObject({ state: "delivered", mediaIds: ask.photos });
  });

  it("sends a choice whose photos are deleted the day it was carried to as a plain question, never under a 1 and 2 retention could take away", async () => {
    // Compose checked them against the morning it was asked for, three days earlier. They are
    // still here when this morning goes out at 08:00, and retention deletes them at 11:20.
    const ask = await carriedPastRetention([0, 1], at(CARRIED_TO, "09:00"));
    expect(await mediaIdsLeft()).toEqual([...ask.photos].sort());

    await deliverTheCarriedMorning();

    const sent = await theOneArrival();
    expect(sent.message.media).toBeUndefined();
    expect(sent.uploads).toEqual([]);
    expect(sent.message.text).toContain("Mia asks:\nWhich one do you like more?");
    expect(sent.message.text).not.toContain("Tap 1 or 2");
    expect(
      (sent.message.buttons ?? []).flat().map((button) => decodeButton(button.id)?.type),
    ).not.toContain("pick");
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      event: "ask_media_expiring",
      fields: { familyId: seed.family.id, exchangeId: ask.id, count: 2 },
    });
  });

  it("sends a choice whose photo's object expired under its row once, on the morning it was carried to, as a question with the photo left", async () => {
    // The row outlived its object: retention deleted the object and failed before the row, or the
    // bucket's own expiry of `asks/` came first. The ask still names both photos.
    const ask = await carriedPastRetention([]);
    const [gone, left] = ask.photos;
    if (gone === undefined || left === undefined) throw new Error("expected both photos named");
    await h.media.delete(await storageKeyOf(gone));
    const leftKey = await storageKeyOf(left);

    await deliverTheCarriedMorning();

    const sent = await theOneArrival();
    expect(sent.message.media).toEqual([expect.objectContaining({ storageKey: leftKey })]);
    expect(sent.uploads.map((upload) => upload.storageKey)).toEqual([leftKey]);
    expect(sent.message.text).not.toContain("Tap 1 or 2");
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
    expect((await herExchanges())[0]).toMatchObject({ state: "delivered", mediaIds: ask.photos });
  });
});

/**
 * Her pick is read by its place in `media_ids`, and an arrival's "1" and "2" answer it whenever she
 * taps them (flows §3.9): yesterday's buttons still answer yesterday's exchange today, and an older
 * arrival's too. So a photo can be deleted after the choice went out, once the day after her
 * morning is over. Retention keeps a photo choice's places, so her tap still names the photo she
 * was shown there, and lights the day it arrives on.
 */
describe("her pick on a choice whose photo was deleted after it went out", () => {
  const LATER = addDays(TOMORROW, 2);

  /**
   * A choice for tomorrow whose `expiring` photos are deleted a minute after the day after her
   * morning, sent at 08:00 with its 1 and 2. Her morning two days on is delivered at 08:00, so a tap
   * then counts for it, and retention runs at noon. Returns the ask, its photos, and the message
   * that carries its buttons.
   */
  async function sentThenDeleted(
    expiring: readonly (0 | 1)[],
  ): Promise<{ id: string; photos: string[]; messageId: string }> {
    const photos = [await photo(1), await photo(2)];
    const until = zonedInstant(addDays(TOMORROW, 2), "00:00", TZ);
    for (const index of expiring) {
      await h.db
        .update(media)
        .set({ expiresAt: new Date(until.getTime() + 60_000) })
        .where(eq(media.id, photos[index] ?? ""));
    }
    const { id } = ApiComposedAsk.parse((await compose({ media_ids: photos })).response.body);
    h.clock.set(at(TOMORROW, "08:00"));
    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    await h.run(handlers());
    const [sent] = h.telegram.sent;
    if (sent === undefined) throw new Error("expected her morning");
    expect(sent.message.buttons?.[0]?.map((button) => decodeButton(button.id))).toEqual([
      { type: "pick", exchangeId: id, index: 0 },
      { type: "pick", exchangeId: id, index: 1 },
    ]);
    await seedExchange(h.db, seed, {
      date: LATER,
      type: "hello",
      state: "delivered",
      deliveredAt: at(LATER, "08:00"),
    });
    h.clock.set(at(LATER, "12:00"));
    await applyRetention(h.deps);
    expect(await mediaIdsLeft()).toEqual(
      photos.filter((_, index) => !expiring.includes(index as 0 | 1)).sort(),
    );
    return { id, photos, messageId: sent.result.primaryMessageId };
  }

  async function theChoice(id: string): Promise<Exchange> {
    const row = (await herExchanges()).find((exchange) => exchange.id === id);
    if (row === undefined) throw new Error("expected the choice");
    return row;
  }

  it("records her 2 as the photo shown second and lights her day when both photos are gone", async () => {
    const ask = await sentThenDeleted([0, 1]);
    h.clock.set(at(LATER, "12:30"));

    await tapOn(ask.messageId, { type: "pick", exchangeId: ask.id, index: 1 });

    expect(await h.db.select().from(answers)).toEqual([
      expect.objectContaining({
        exchangeId: ask.id,
        kind: "photo_pick",
        payload: { index: 1, media_id: ask.photos[1] },
        receivedAt: at(LATER, "12:30"),
      }),
    ]);
    expect(await theChoice(ask.id)).toMatchObject({ state: "answered", mediaIds: ask.photos });
    expect(h.telegram.closed.map((call) => call.replacementText)).toEqual(["2"]);
    expect(h.logger.entries.map((entry) => entry.event)).not.toContain(
      "answer_button_option_ignored",
    );
    // Her answer for the day it came on: that day's silence opens nothing.
    h.clock.set(at(LATER, "14:30"));
    await openQuiet(h.deps, seed.member.id, LATER, true);
    expect(await h.db.select().from(quietEvents)).toEqual([]);
    // The family sees her pick as photo 2, with no photo left to show.
    const shown = await exchangeRow(h.db, await theChoice(ask.id), {
      id: seed.member.id,
      displayName: "Mom",
    });
    expect(shown.photos).toEqual([]);
    expect(shown.answer).toMatchObject({
      kind: "photo_pick",
      picked_media_id: ask.photos[1],
      picked_number: 2,
    });
  });

  it("records her 1 as the photo shown first, never the one left, when only the first is gone", async () => {
    const ask = await sentThenDeleted([0]);
    const [first, second] = ask.photos;
    h.clock.set(at(LATER, "12:30"));

    await tapOn(ask.messageId, { type: "pick", exchangeId: ask.id, index: 0 });

    const [answer] = await h.db.select().from(answers);
    expect(answer).toMatchObject({ kind: "photo_pick", payload: { index: 0, media_id: first } });
    expect(h.telegram.closed.map((call) => call.replacementText)).toEqual(["1"]);
    // The family sees her pick as photo 1 without its image, beside the photo that is left.
    const shown = await exchangeRow(h.db, await theChoice(ask.id), {
      id: seed.member.id,
      displayName: "Mom",
    });
    expect(shown.photos.map((shownPhoto) => shownPhoto.id)).toEqual([second]);
    expect(shown.answer).toMatchObject({
      kind: "photo_pick",
      picked_media_id: first,
      picked_number: 1,
    });
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
  // A choice keeps each id in its place, naming nothing now, so a later pick still reads the photo
  // she was shown there; any other ask loses the id.
  it("deletes the objects and the rows with a proof for each, keeping the choice's places", async () => {
    const first = await photo(1);
    const second = await photo(2);
    const old = await photo(3);
    await compose({ media_ids: [first, second] });
    await compose({
      type: "memory_photo",
      text: "Do you remember this?",
      when: "date",
      date: addDays(TODAY, 2),
      media_ids: [old],
    });
    h.clock.set(new Date(h.clock.now().getTime() + 30 * DAY_MS + 60_000));

    await applyRetention(h.deps);

    expect(await h.db.select().from(media)).toEqual([]);
    expect(h.media.objects.size).toBe(0);
    const proofs = await h.db.select().from(deletions);
    expect(proofs.filter((proof) => proof.objectType === "media")).toHaveLength(3);
    expect((await herExchanges()).map((row) => [row.type, row.mediaIds])).toEqual([
      ["photo_choice", [first, second]],
      ["memory_photo", []],
    ]);
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
    expect((await herExchanges()).map((row) => row.mediaIds)).toEqual([[first, second]]);
  });
});
