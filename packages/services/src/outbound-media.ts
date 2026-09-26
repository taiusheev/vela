/**
 * The bytes of the files an outbound message names only by a storage key (ADR-33): the photos the
 * app uploaded for an ask, which Telegram is sent as an upload. They are loaded for each delivery
 * attempt and handed to `ChannelAdapter.send`, so a retry reads them again, and nothing but the key
 * is ever kept in `outbound.payload`: no URL to a family's photo is made at all.
 */
import { ChannelSendError, type FetchedMedia, type OutboundMessage } from "@vela/contracts";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";

/**
 * Loads every stored-only file of `message`, keyed by storage key, or returns undefined when it has
 * none. A file that cannot be loaded (storage is off, the object is gone, or the store fails) is
 * `ChannelSendError("unavailable")`, which the gateway retries as any passing failure and fails at
 * the end of its retries: the text and buttons were drawn for every file the message names, so it
 * is never sent short of one. The log carries the row and a count, never a key.
 */
export async function loadOutboundFiles(
  deps: Pick<Deps, "media" | "logger">,
  outboundId: string,
  message: OutboundMessage,
): Promise<ReadonlyMap<string, FetchedMedia> | undefined> {
  const keys = new Set(
    (message.media ?? []).flatMap((ref) =>
      ref.storageKey !== undefined && ref.providerFileId === undefined && ref.url === undefined
        ? [ref.storageKey]
        : [],
    ),
  );
  if (keys.size === 0) {
    return undefined;
  }
  const store = deps.media;
  if (store === null) {
    deps.logger.error("outbound_media_missing", { outboundId, count: keys.size, storage: "off" });
    throw new ChannelSendError("unavailable", "stored media cannot be read: storage is off");
  }
  const files = new Map<string, FetchedMedia>();
  let missing = 0;
  for (const key of keys) {
    let object: FetchedMedia | null;
    try {
      object = await store.get(key);
    } catch (error) {
      deps.logger.warn("outbound_media_unreadable", { outboundId, error: errorLabel(error) });
      throw new ChannelSendError("unavailable", "stored media could not be read", { cause: error });
    }
    if (object === null) {
      missing += 1;
    } else {
      files.set(key, object);
    }
  }
  if (missing > 0) {
    deps.logger.warn("outbound_media_missing", { outboundId, count: missing });
    throw new ChannelSendError("unavailable", "stored media is missing");
  }
  return files;
}
