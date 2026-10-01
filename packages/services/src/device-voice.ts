import { addMinutes } from "@vela/core";
import { type Member, media } from "@vela/db";
import { and, count, eq, gt } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { MEDIA_RETENTION_DAYS } from "./repo.ts";

/**
 * Her voice answer from her phone (ADR-35, P4): the recording is uploaded first, kept in the media
 * store as a `device` file of hers, and then sent as a voice note (`DeviceInput` `{voice}`), which
 * the router answers with as it answers a Telegram voice note. The pipeline reads its stored copy
 * for the transcript, and the family's Telegram group is sent that copy as an upload.
 */

/** About five minutes of the phone's AAC recording at 64 kbit/s, with room to spare. */
export const MAX_DEVICE_VOICE_BYTES = 3 * 1024 * 1024;
/** Recordings a day from one phone: far past any morning's answers, short of filling the store. */
export const MAX_DEVICE_VOICES_PER_DAY = 30;
const M4A = "audio/mp4";
/** The key her phone mints for one recording and sends again with every retry of it. */
const RECORDING_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_DURATION_MS = 10 * 60 * 1_000;

export type DeviceVoiceRefusal = "invalid" | "too_large" | "limit" | "off";

export class DeviceVoiceRefusedError extends Error {
  override readonly name = "DeviceVoiceRefusedError";
  readonly reason: DeviceVoiceRefusal;
  constructor(reason: DeviceVoiceRefusal) {
    super(`Her recording was refused: ${reason}`);
    this.reason = reason;
  }
}

/** An MPEG-4 file (`.m4a`), as both phones record: its first box is `ftyp`. */
export function isM4a(body: Uint8Array): boolean {
  return (
    body.byteLength > 12 &&
    body[4] === 0x66 &&
    body[5] === 0x74 &&
    body[6] === 0x79 &&
    body[7] === 0x70
  );
}

/**
 * Keeps one recording of hers and answers its media id. The key names the recording: her phone
 * sends it again with every retry, so a repeat finds the row the first made and stores nothing
 * new, and two at once leave one row, by the unique index on the family's `device` files (the
 * loser of the insert reads the winner's). Both write the same object under the same key first.
 */
export async function storeDeviceVoice(
  deps: Pick<Deps, "db" | "clock" | "media" | "logger">,
  her: Member,
  key: string,
  body: Uint8Array,
  durationMs: number | null,
): Promise<{ mediaId: string }> {
  if (deps.media === null) throw new DeviceVoiceRefusedError("off");
  if (!RECORDING_KEY.test(key)) throw new DeviceVoiceRefusedError("invalid");
  if (body.byteLength > MAX_DEVICE_VOICE_BYTES) throw new DeviceVoiceRefusedError("too_large");
  if (!isM4a(body)) throw new DeviceVoiceRefusedError("invalid");
  const duration =
    durationMs !== null && Number.isInteger(durationMs) && durationMs > 0
      ? Math.min(durationMs, MAX_DURATION_MS)
      : null;
  const uniqueId = `${her.id}:${key}`;
  const existing = async () => {
    const [row] = await deps.db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.familyId, her.familyId),
          eq(media.channel, "device"),
          eq(media.providerUniqueId, uniqueId),
        ),
      )
      .limit(1);
    return row ?? null;
  };
  const found = await existing();
  if (found !== null) return { mediaId: found.id };

  const now = deps.clock.now();
  const [today] = await deps.db
    .select({ n: count() })
    .from(media)
    .where(
      and(
        eq(media.uploadedBy, her.id),
        eq(media.channel, "device"),
        gt(media.createdAt, addMinutes(now, -24 * 60)),
      ),
    );
  if ((today?.n ?? 0) >= MAX_DEVICE_VOICES_PER_DAY) throw new DeviceVoiceRefusedError("limit");

  const storageKey = `families/${her.familyId}/device/${her.id}/${key}.m4a`;
  try {
    await deps.media.put(storageKey, body.slice().buffer, M4A);
  } catch (error) {
    deps.logger.error("device_voice_store_failed", { memberId: her.id, error: errorLabel(error) });
    throw error;
  }
  const [inserted] = await deps.db
    .insert(media)
    .values({
      familyId: her.familyId,
      uploadedBy: her.id,
      kind: "audio",
      channel: "device",
      storageKey,
      providerFileId: `device:${key}`,
      providerUniqueId: uniqueId,
      mime: M4A,
      bytes: body.byteLength,
      durationMs: duration,
      createdAt: now,
      expiresAt: addMinutes(now, MEDIA_RETENTION_DAYS * 24 * 60),
    })
    .onConflictDoNothing()
    .returning({ id: media.id });
  const row = inserted ?? (await existing());
  if (row === null) throw new Error("her recording's row is neither new nor there");
  return { mediaId: row.id };
}
