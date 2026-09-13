import { ChannelSendError, type FetchedMedia } from "@vela/contracts";
import type { TelegramClient } from "./client.ts";

/** The cloud Bot API serves downloads of at most 20 MB. */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["oga", "audio/ogg"],
  ["ogg", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["wav", "audio/wav"],
]);

const GENERIC_MIME = "application/octet-stream";

/** `getFile`, then the download; files over the limit are refused before any bytes are fetched. */
export async function fetchTelegramMedia(
  client: TelegramClient,
  providerFileId: string,
): Promise<FetchedMedia> {
  const file = await client.getFile({ file_id: providerFileId });
  if (file.file_size !== undefined && file.file_size > TELEGRAM_MAX_DOWNLOAD_BYTES) {
    throw new ChannelSendError(
      "invalid_request",
      `telegram file is ${file.file_size} bytes; the download limit is ${TELEGRAM_MAX_DOWNLOAD_BYTES}`,
    );
  }
  if (file.file_path === undefined) {
    throw new ChannelSendError(
      "invalid_request",
      "telegram returned no download path for the file",
    );
  }
  const download = await client.downloadFile(file.file_path, TELEGRAM_MAX_DOWNLOAD_BYTES);
  return { body: download.body, mime: mimeFor(file.file_path, download.contentType) };
}

/**
 * `getFile` does not promise the original MIME type and the file server's content type is often
 * generic, so the extension Telegram gives the stored file is preferred.
 */
export function mimeFor(filePath: string, contentType: string | null): string {
  const extension = /\.([a-z0-9]+)$/i.exec(filePath)?.[1]?.toLowerCase();
  const byExtension = extension === undefined ? undefined : MIME_BY_EXTENSION.get(extension);
  if (byExtension !== undefined) return byExtension;
  const declared = contentType?.split(";")[0]?.trim().toLowerCase();
  return declared === undefined || declared === "" ? GENERIC_MIME : declared;
}
