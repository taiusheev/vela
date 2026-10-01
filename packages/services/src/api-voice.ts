/**
 * A voice for a reply from the app (spec §14.1 A8; API contract, "Voices for a reply"): the
 * recording is kept first (`POST /v1/families/:familyId/voice`), and the reply then names it by id
 * (`{voice}`), as a photo ask names its photos. It is kept exactly as a photo for an ask is
 * (`keepUpload`): its object under a key minted for the attempt, `replies/<familyId>/<token>.m4a`,
 * then its row through `runApiMutation`, so a retry under the same key is answered from the
 * receipt and an attempt's own object is deleted whenever no row names it. Her next morning reads
 * it back: an upload of the stored file on Telegram, a play button on her phone.
 */
import { type ApiMutationResponse, ApiUploadedVoice } from "@vela/contracts";
import { media, members, type VelaTransaction } from "@vela/db";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { FamilyAccess, SessionIdentity } from "./api-access.ts";
import {
  keepUpload,
  MediaRefusedError,
  sha256HexOfBytes,
  type UploadApiMediaDeps,
} from "./api-media.ts";
import { isM4a } from "./device-voice.ts";
import { VelaError } from "./errors.ts";

/** An account's voices in any 24 hours: a reply a day to each of several mornings, with retakes. */
export const MAX_VOICES_PER_ACCOUNT_DAY = 30;
/** About five minutes of a phone's AAC recording at 64 kbit/s, with room to spare. */
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;
const MAX_DURATION_MS = 10 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const M4A = "audio/mp4";
const Uuid = z.uuid();

/** The account's own voices, counted under its actor lock, which orders all of its uploads. */
async function checkVoiceLimit(
  tx: VelaTransaction,
  access: FamilyAccess,
  now: Date,
): Promise<void> {
  const [account] = await tx
    .select({ total: count() })
    .from(media)
    .innerJoin(members, eq(members.id, media.uploadedBy))
    .where(
      and(
        eq(members.userId, access.userId),
        eq(media.kind, "audio"),
        isNull(media.channel),
        gt(media.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  if (account === undefined || account.total >= MAX_VOICES_PER_ACCOUNT_DAY) {
    throw new MediaRefusedError("voice_limit");
  }
}

/**
 * Keep a voice for a reply (201 `ApiUploadedVoice`). `body` is the `.m4a` as it arrived, kept as it
 * is; the fingerprint is its SHA-256 with its size and length, so the same key with the same
 * recording answers the first upload's row again, and with another 409. Any member of the family
 * may upload; the limit is 429 `voice_limit`, anything but an MPEG-4 file 415 `m4a_only`.
 */
export async function uploadApiVoice(
  deps: UploadApiMediaDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  body: Uint8Array,
  durationMs: number | null,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (typeof familyId !== "string" || !Uuid.safeParse(familyId).success) {
    throw new VelaError("not_found", "Family not found");
  }
  if (!isM4a(body)) throw new MediaRefusedError("m4a_only");
  const bytes = body.slice();
  const duration =
    durationMs !== null && Number.isInteger(durationMs) && durationMs > 0
      ? Math.min(durationMs, MAX_DURATION_MS)
      : null;
  const sha256 = await sha256HexOfBytes(bytes);
  return keepUpload(deps, identity, key, familyId, {
    bytes,
    mime: M4A,
    storageKey: `replies/${familyId.toLowerCase()}/${deps.random.token(16)}.m4a`,
    operation: "voice.upload:v1",
    input: { sha256, bytes: bytes.length, duration_ms: duration },
    checkLimits: checkVoiceLimit,
    row: { kind: "audio", width: null, height: null, durationMs: duration },
    body: (row) =>
      ApiUploadedVoice.parse({
        id: row.id,
        kind: "audio",
        duration_ms: duration,
        bytes: bytes.length,
        expires_at: row.expiresAt.toISOString(),
      }),
  });
}
