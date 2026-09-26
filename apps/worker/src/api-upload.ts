/**
 * The one API route whose body is not JSON: a photo for an ask, `POST
 * /v1/families/:familyId/media`, sent as the JPEG's own bytes (ADR-33). Raw bytes, because there
 * is no parser to spend CPU on and base64 could never pass the JSON routes' 4 KiB. ADR-33 refines
 * ADR-29's body limits for this route alone: up to 1 MiB, read for up to 60 seconds, since a phone
 * on a slow network needs the time and waiting on the network spends no CPU.
 *
 * `uploadHeaders` refuses what the headers already show, before the write limit counts the request
 * or a database connection is opened; `readUploadBody` reads the bytes last, after every cheap
 * refusal, which the route's middleware order keeps (`api-app.ts`).
 */
import type { ApiErrorBody } from "@vela/contracts";
import { ApiIdempotencyKey } from "@vela/contracts";
import { errorLabel, type Logger } from "@vela/services";
import type { MiddlewareHandler } from "hono";

/** The largest photo the route reads. The phone sends at most 1600 px at quality 0.8, well under it. */
export const MAX_UPLOAD_BYTES = 1_048_576;
/** How long the route waits for the whole body. */
export const MAX_UPLOAD_READ_MS = 60_000;

/** `image/jpeg`, with any parameters a client adds (RFC 9110 tokens or quoted strings). */
const JPEG_CONTENT_TYPE =
  /^image\/jpeg\s*(?:;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+\s*=\s*(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"[^"\\]*")\s*)*$/i;

// The API app's own error body (`api-app.ts`), copied as `api-runtime.ts` copies its bodies: a
// refusal made here reads exactly like one of the app's.
const INVALID: ApiErrorBody = {
  error: { code: "invalid", message: "Invalid request." },
};

export type UploadBody = { ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 408 | 413 };

function cancelBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  logger: Pick<Logger, "error">,
): void {
  void reader.cancel().catch((error: unknown) => {
    logger.error("api_body_cancel_failed", { error: errorLabel(error) });
  });
}

/**
 * The request's body as bytes, at most `maxBytes` of them, within `deadlineMs`: 413 past the size
 * (a declared length over it is refused without reading), 408 past the deadline, 400 for no body,
 * an empty one, or a stream that fails. The reader is cancelled on every refusal that leaves bytes
 * unread and released on every path, as `readWriteBody` does for JSON.
 */
export async function readUploadBody(
  request: Request,
  logger: Pick<Logger, "error">,
  maxBytes: number,
  deadlineMs: number,
): Promise<UploadBody> {
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) {
    return { ok: false, status: 413 };
  }
  if (request.body === null) return { ok: false, status: 400 };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = request.body.getReader();
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    // One more read than there can be bytes: a stream of empty chunks cannot keep the loop going.
    for (let reads = 0; reads <= maxBytes; reads += 1) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk === null) {
        cancelBody(reader, logger);
        return { ok: false, status: 408 };
      }
      const { done, value } = chunk;
      if (done) {
        if (size === 0) return { ok: false, status: 400 };
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        return { ok: true, bytes };
      }
      if (value.byteLength > maxBytes - size) {
        cancelBody(reader, logger);
        return { ok: false, status: 413 };
      }
      if (reads === maxBytes) {
        cancelBody(reader, logger);
        return { ok: false, status: 400 };
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    reader?.releaseLock();
  }
  return { ok: false, status: 400 };
}

/**
 * What an upload's headers must say, checked before anything is counted or opened: an
 * `Idempotency-Key` (400), `Content-Type: image/jpeg` with any parameters and no encoding but
 * `identity` (415), and no declared length over `maxBytes` (413). The key is kept for the route.
 */
export function uploadHeaders<E extends { Variables: { writeKey: string } }>(
  maxBytes: number,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const key = ApiIdempotencyKey.safeParse(c.req.header("Idempotency-Key"));
    if (!key.success) return c.json(INVALID, 400);
    const encoding = c.req.header("Content-Encoding");
    if (
      !JPEG_CONTENT_TYPE.test(c.req.header("Content-Type") ?? "") ||
      (encoding !== undefined && encoding.trim().toLowerCase() !== "identity")
    ) {
      return c.json(INVALID, 415);
    }
    const length = c.req.header("Content-Length");
    if (length !== undefined && /^\d+$/.test(length) && Number(length) > maxBytes) {
      return c.json(INVALID, 413);
    }
    c.set("writeKey", key.data);
    await next();
    return c.res;
  };
}
