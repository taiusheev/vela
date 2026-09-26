/**
 * Downloads what people send (05 §5.7). LINE keeps it for a period it does not publish, so the
 * media job fetches it as soon as the answer arrives, and never counts on it being there later.
 */
import { ChannelSendError, type FetchedMedia } from "@vela/contracts";
import type { LineClient, LineDownload } from "./client.ts";

/**
 * LINE documents no download limit. `FetchedMedia` holds the bytes in memory, so they are capped as
 * Telegram's are.
 */
export const LINE_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** While LINE prepares a large voice note it answers 202; it is asked three times, 2 s apart. */
const TRANSCODING_POLLS = 3;
export const LINE_TRANSCODING_POLL_INTERVAL_MS = 2_000;

const GENERIC_MIME = "application/octet-stream";

export type Wait = (milliseconds: number) => Promise<void>;

/**
 * The content of a message, waiting for LINE to finish preparing it. Still preparing after the
 * last poll is `unavailable`, so the media job tries again later; a preparation LINE reports failed
 * never succeeds and is `invalid_request`.
 */
export async function fetchLineMedia(
  client: LineClient,
  messageId: string,
  wait: Wait,
): Promise<FetchedMedia> {
  const first = await client.content(messageId, LINE_MAX_DOWNLOAD_BYTES);
  if (first.ready) return fetched(first);
  await awaitPreparation(client, messageId, wait);
  const second = await client.content(messageId, LINE_MAX_DOWNLOAD_BYTES);
  if (second.ready) return fetched(second);
  throw stillPreparing();
}

/** LINE's smaller copy of an image. */
export async function fetchLinePreview(
  client: LineClient,
  messageId: string,
): Promise<FetchedMedia> {
  const preview = await client.preview(messageId, LINE_MAX_DOWNLOAD_BYTES);
  if (preview.ready) return fetched(preview);
  throw stillPreparing();
}

/** A media type in lowercase without parameters, or undefined when none is given. */
export function mediaTypeOf(contentType: string | null | undefined): string | undefined {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return type === undefined || type === "" ? undefined : type;
}

async function awaitPreparation(client: LineClient, messageId: string, wait: Wait): Promise<void> {
  for (let poll = 1; ; poll += 1) {
    const status = await client.transcodingStatus(messageId);
    if (status === "succeeded") return;
    if (status === "failed") {
      throw new ChannelSendError("invalid_request", "line could not prepare the content");
    }
    if (poll === TRANSCODING_POLLS) throw stillPreparing();
    await wait(LINE_TRANSCODING_POLL_INTERVAL_MS);
  }
}

function fetched(download: Extract<LineDownload, { ready: true }>): FetchedMedia {
  return { body: download.body, mime: mediaTypeOf(download.contentType) ?? GENERIC_MIME };
}

function stillPreparing(): ChannelSendError {
  return new ChannelSendError("unavailable", "line is still preparing the content");
}
