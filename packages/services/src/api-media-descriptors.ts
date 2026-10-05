import type { ApiExchangeAudio, ApiExchangePhoto } from "@vela/contracts";
import type { Media } from "@vela/db";

export function sourceAudio(row: Media | undefined, now?: Date): ApiExchangeAudio | null {
  if (row === undefined || row.kind !== "audio") return null;
  const mime = row.mime === "audio/opus" ? "audio/ogg" : row.mime;
  if (mime !== "audio/ogg" && mime !== "audio/mp4" && mime !== "audio/mpeg") return null;
  if (now !== undefined && !row.kept && row.expiresAt !== null && row.expiresAt <= now) return null;
  return {
    id: row.id,
    mime,
    duration_ms: row.durationMs !== null && row.durationMs > 0 ? row.durationMs : null,
    expires_at: row.kept ? null : (row.expiresAt?.toISOString() ?? null),
    state:
      row.storageKey !== null
        ? "ready"
        : now !== undefined && row.createdAt.getTime() + 24 * 60 * 60 * 1_000 <= now.getTime()
          ? "unavailable"
          : "pending",
    role: "original",
  };
}

export function sourcePhoto(row: Media | undefined, now?: Date): ApiExchangePhoto | null {
  if (row === undefined || row.kind !== "image") return null;
  if (now !== undefined && !row.kept && row.expiresAt !== null && row.expiresAt <= now) return null;
  return {
    id: row.id,
    width: row.width !== null && row.width > 0 ? row.width : null,
    height: row.height !== null && row.height > 0 ? row.height : null,
    stored: row.storageKey !== null && (row.mime === null || row.mime === "image/jpeg"),
    expires_at: row.kept ? null : (row.expiresAt?.toISOString() ?? null),
  };
}
