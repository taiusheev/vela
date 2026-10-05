import { media } from "@vela/db";
import { eq } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";

const CURSOR_KEY = "operations/inbound-media-sweep.json";
const GRACE_MS = 24 * 60 * 60 * 1_000;
const UUID_KEY = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SOURCE_KEY = new RegExp(
  `^families/${UUID_KEY}/media/${UUID_KEY}-[A-Za-z0-9_-]+\\.[a-z0-9]+$`,
);
const BOOK_ATTEMPT_KEY = new RegExp(`^book/${UUID_KEY}/${UUID_KEY}-[A-Za-z0-9_-]+\\.[a-z0-9]+$`);
const PREFIXES = ["families/", "book/"] as const;

/** One bounded metadata page per retention run, with a private cursor so later pages progress. */
export async function sweepInboundMediaOrphans(deps: Deps): Promise<number> {
  const store = deps.media;
  if (store?.list === undefined) return 0;
  let cursor: string | undefined;
  let prefix = 0;
  const saved = await store.get(CURSOR_KEY);
  if (saved !== null) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(saved.body));
      if (typeof parsed === "string" && parsed.length < 4_096) cursor = parsed;
      else if (
        typeof parsed === "object" &&
        parsed !== null &&
        "prefix" in parsed &&
        (parsed.prefix === 0 || parsed.prefix === 1)
      ) {
        prefix = parsed.prefix;
        if ("cursor" in parsed && typeof parsed.cursor === "string" && parsed.cursor.length < 4_096)
          cursor = parsed.cursor;
      }
    } catch {
      deps.logger.warn("media_orphan_cursor_invalid", {});
    }
  }
  const page = await store.list({ prefix: PREFIXES[prefix] ?? PREFIXES[0], cursor, limit: 500 });
  let removed = 0;
  const cutoff = deps.clock.now().getTime() - GRACE_MS;
  for (const object of page.objects) {
    if (
      (!SOURCE_KEY.test(object.key) && !BOOK_ATTEMPT_KEY.test(object.key)) ||
      object.uploadedAt.getTime() > cutoff
    )
      continue;
    const [owner] = await deps.db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.storageKey, object.key))
      .limit(1);
    if (owner !== undefined) continue;
    try {
      await store.delete(object.key);
      removed += 1;
    } catch (error) {
      // Keep the page for retry. Never log the storage key or object content.
      deps.logger.error("media_orphan_cleanup_failed", { error: errorLabel(error) });
      throw error;
    }
  }
  const encoded = new TextEncoder().encode(
    JSON.stringify({
      prefix: page.cursor === null ? (prefix + 1) % PREFIXES.length : prefix,
      cursor: page.cursor,
    }),
  );
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  await store.put(CURSOR_KEY, buffer, "application/json");
  return removed;
}
