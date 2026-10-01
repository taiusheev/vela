import type { ApiDeviceMessage, DeviceInput, InboundEvent } from "@vela/contracts";
import { channelLinks, type Member, media, outbound } from "@vela/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { sharedWith } from "./api-media.ts";
import type { MediaStore } from "./deps.ts";
import { VelaError } from "./errors.ts";
import type { Queryable } from "./repo.ts";

/** How many of her latest messages her phone is given: her morning, its read-back, a notice. */
const DEVICE_MESSAGES = 10;

const Uuid = z.uuid();

interface StoredButton {
  id: string;
  label: string;
}

/**
 * What Vela sent her phone (ADR-35, phase 3), newest first: each `device` row the gateway sent to
 * her, with the text and buttons it was sent with. Her phone shows the newest and reads it aloud;
 * a tap on one of its buttons comes back with the button's id and this message's id, as a tap in a
 * Telegram chat does. A row whose payload retention has cleared has no text left and is skipped.
 */
export async function loadDeviceMessages(db: Queryable, her: Member): Promise<ApiDeviceMessage[]> {
  const rows = await db
    .select()
    .from(outbound)
    .where(
      and(
        eq(outbound.memberId, her.id),
        eq(outbound.channel, "device"),
        eq(outbound.status, "sent"),
      ),
    )
    .orderBy(desc(outbound.sentAt), desc(outbound.id))
    .limit(DEVICE_MESSAGES);
  const keys = rows.flatMap((row) => [
    ...storageKeysOf(row.payload, "image"),
    ...storageKeysOf(row.payload, "audio"),
  ]);
  const fileIds = new Map(
    keys.length === 0
      ? []
      : (
          await db
            .select({ id: media.id, storageKey: media.storageKey })
            .from(media)
            .where(and(eq(media.familyId, her.familyId), inArray(media.storageKey, keys)))
        ).map((photo) => [photo.storageKey, photo.id]),
  );
  const idsOf = (stored: string[]) =>
    stored.flatMap((key) => {
      const id = fileIds.get(key);
      return id === undefined ? [] : [id];
    });
  return rows.flatMap((row) => {
    const message = (row.payload as { message?: { text?: unknown; buttons?: unknown } }).message;
    const text = typeof message?.text === "string" ? message.text : "";
    if (text.length === 0 || row.externalId === null || row.sentAt === null) return [];
    const buttons = Array.isArray(message?.buttons)
      ? (message.buttons as StoredButton[][]).map((line) =>
          line.map((button) => ({ id: button.id, label: button.label })),
        )
      : [];
    return [
      {
        message_id: row.externalId,
        kind: row.kind,
        exchange_id: row.exchangeId,
        text,
        buttons,
        photos: idsOf(storageKeysOf(row.payload, "image")),
        voices: idsOf(storageKeysOf(row.payload, "audio")),
        sent_at: row.sentAt.toISOString(),
      },
    ];
  });
}

/**
 * The storage keys of the photos, or the voice notes, a stored message carries, in order. Her phone is sent each stored
 * image by its key (`readsStoredMedia`); a photo retention has since deleted has no row left, so it
 * drops out of her message by itself.
 */
function storageKeysOf(payload: unknown, kind: "image" | "audio"): string[] {
  const files = (payload as { message?: { media?: unknown } }).message?.media;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file: { kind?: unknown; storageKey?: unknown }) =>
    file.kind === kind && typeof file.storageKey === "string" ? [file.storageKey] : [],
  );
}

/**
 * Her tap, her words or her voice from her phone, as the inbound event a Telegram chat would make
 * of them, for `handleInbound` (ADR-35): she is the sender and the conversation is her phone, both
 * named by her `device` link's id, so the router finds her as it finds a Telegram user. A tap
 * carries the button's id and the id of the message it was under, which her consent and her
 * answers read. A voice names a recording she uploaded; any other id is `VelaError("not_found")`.
 */
export async function deviceInboundEvent(
  db: Queryable,
  her: Member,
  input: DeviceInput,
  ids: { eventId: string; messageId: string },
  at: Date,
): Promise<InboundEvent | null> {
  const [link] = await db
    .select({ externalId: channelLinks.externalId })
    .from(channelLinks)
    .where(and(eq(channelLinks.memberId, her.id), eq(channelLinks.channel, "device")))
    .limit(1);
  if (link === undefined) return null;
  const common = {
    channel: "device" as const,
    eventId: `device:${ids.eventId}`,
    at: at.toISOString(),
    sender: { externalUserId: link.externalId },
    conversation: { externalId: link.externalId, kind: "private" as const },
  };
  if ("button" in input) {
    return {
      ...common,
      kind: "button",
      messageId: input.message_id,
      buttonData: input.button,
      callbackId: ids.eventId,
    };
  }
  if ("text" in input) {
    return { ...common, kind: "text", messageId: ids.messageId, text: input.text };
  }
  // Her voice is named by its recording, so sending it again is the same message, never a second
  // answer: the router's duplicate check reads the message id.
  const [file] = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.id, input.voice),
        eq(media.familyId, her.familyId),
        eq(media.uploadedBy, her.id),
        eq(media.channel, "device"),
        eq(media.kind, "audio"),
        isNotNull(media.storageKey),
      ),
    )
    .limit(1);
  if (file === undefined || file.providerFileId === null || file.providerUniqueId === null) {
    throw new VelaError("not_found", "Her recording is not there");
  }
  return {
    ...common,
    eventId: `device:voice:${file.id}`,
    kind: "voice",
    messageId: `voice:${file.id}`,
    media: {
      kind: "audio",
      providerFileId: file.providerFileId,
      providerUniqueId: file.providerUniqueId,
      ...(file.mime === null ? {} : { mime: file.mime }),
      ...(file.durationMs === null ? {} : { durationMs: file.durationMs }),
      ...(file.bytes === null ? {} : { bytes: file.bytes }),
    },
  };
}

/** What her phone is served, by the type the file was stored with; anything else is not served. */
const SERVED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
]);

/**
 * A photo or voice note her phone may open (`GET /v1/device/media/:mediaId`): its bytes and type,
 * or null, which the API answers 404. She opens what any member of her family may see
 * (`sharedWith`): the family's stored files that one of its exchanges, answers or replies carries,
 * so the photos of her morning and the voices of what the family sent back, and nothing uploaded
 * that nobody has asked with yet. A file stored with a type her phone is not served is null.
 */
export async function readDeviceMedia(
  db: Queryable,
  her: Member,
  mediaId: string,
  store: MediaStore,
): Promise<{ body: ArrayBuffer; mime: string } | null> {
  if (!Uuid.safeParse(mediaId).success) return null;
  const [row] = await db
    .select({ storageKey: media.storageKey, kind: media.kind, mime: media.mime })
    .from(media)
    .where(
      and(
        eq(media.id, mediaId),
        eq(media.familyId, her.familyId),
        isNotNull(media.storageKey),
        sharedWith(db, her.familyId, her.id),
      ),
    )
    .limit(1);
  if (row === undefined || row.storageKey === null) return null;
  // A photo stored before its type was known is the JPEG Telegram makes of every photo.
  const mime = (row.mime ?? (row.kind === "image" ? "image/jpeg" : "")).split(";")[0]?.trim();
  if (mime === undefined || !SERVED_TYPES.has(mime)) return null;
  const object = await store.get(row.storageKey);
  return object === null ? null : { body: object.body, mime };
}
