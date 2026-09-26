import type { ApiUploadedMedia } from "@vela/contracts";
import { ApiError, apiBaseUrl, apiConfigured } from "./client.ts";

/**
 * Photos travel as their own bytes, never as JSON (ADR-33): up for an ask, as the JPEG the phone
 * re-encoded, and down again to be shown, from the Worker that keeps them. Neither goes through
 * `call`, which speaks JSON only.
 */

/** The API's error body, `{ error: { code, details } }`, as an `ApiError`. */
function failureOf(status: number, text: string): ApiError {
  let failure: unknown;
  try {
    failure = JSON.parse(text);
  } catch {
    failure = undefined;
  }
  const error =
    typeof failure === "object" && failure !== null && "error" in failure
      ? (failure as { error: { code?: unknown; details?: unknown } }).error
      : undefined;
  return new ApiError(status, String(error?.code ?? "unknown"), error?.details);
}

let minted = 0;

/**
 * A new photo's upload key, in the contract's alphabet (`ApiIdempotencyKey`): minted once when the
 * photo is chosen, and sent again with every retry of that photo.
 */
export function photoKey(): string {
  minted += 1;
  return `media:${Date.now().toString(36)}:${minted}:${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Upload one photo for an ask: `POST /v1/families/:familyId/media` with the JPEG as the body.
 * XMLHttpRequest rather than fetch, because only it tells how much has gone up, on a phone and in a
 * browser alike. The key is the photo's own, minted when it was chosen, so trying again after a lost
 * answer is answered from the upload's receipt rather than keeping the photo twice. The caller
 * passes a token fetched for this attempt: a retry minutes later needs a fresh one.
 */
export async function uploadMedia(
  familyId: string,
  key: string,
  uri: string,
  token: string | null,
  onProgress: (fraction: number) => void,
): Promise<ApiUploadedMedia> {
  if (!apiConfigured() || apiBaseUrl === undefined) {
    throw new Error("The API is not configured");
  }
  // The re-encoded file on the phone (or a blob: URL in a browser), read as it is sent.
  const body = await (await fetch(uri)).blob();
  const url = `${apiBaseUrl}/v1/families/${familyId}/media`;
  return new Promise<ApiUploadedMedia>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("accept", "application/json");
    request.setRequestHeader("content-type", "image/jpeg");
    request.setRequestHeader("idempotency-key", key);
    if (token !== null) request.setRequestHeader("authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(failureOf(request.status, request.responseText));
        return;
      }
      try {
        resolve(JSON.parse(request.responseText) as ApiUploadedMedia);
      } catch {
        reject(failureOf(request.status, ""));
      }
    };
    // No answer at all: the network, not the API. Status 0 says so, and the photo can be sent again.
    request.onerror = () => reject(new ApiError(0, "network"));
    request.ontimeout = () => reject(new ApiError(0, "network"));
    request.send(body);
  });
}

/**
 * What a failed upload or compose means for the photos on Ask, from the status and the reason the
 * API gives (ADR-33, API contract §1):
 * - `off`: nowhere to keep photos here (503 `media_storage_off` or `media_storage_unavailable`).
 * - `unusable`: this photo will never be taken (415, 413, 400 `malformed` or `dimensions`).
 * - `limit`: the account's or the family's photos for now (429 `photo_limit`).
 * - `missing`: a photo the ask named is no longer there (the compose route's 404 `photo_missing`).
 * Anything else is worth trying again, and gives null.
 */
export type PhotoRefusal = "off" | "unusable" | "limit" | "missing";

export function photoRefusal(error: unknown): PhotoRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  const reason =
    typeof details === "object" && details !== null && "reason" in details ? details.reason : null;
  if (
    error.status === 503 &&
    (reason === "media_storage_off" || reason === "media_storage_unavailable")
  ) {
    return "off";
  }
  if (error.status === 413 || error.status === 415) return "unusable";
  if (error.status === 400 && (reason === "malformed" || reason === "dimensions"))
    return "unusable";
  if (error.status === 429 && reason === "photo_limit") return "limit";
  if (error.status === 404 && reason === "photo_missing") return "missing";
  return null;
}

/** A blob as a `data:` URI, which an Image shows without any file on disk. */
function dataUriOf(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("The photo could not be read"));
        return;
      }
      // The API serves JPEG only; a phone that loses the blob's type still draws it as one.
      resolve(result.replace(/^data:[^;,]*/, "data:image/jpeg"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The photo could not be read"));
    reader.readAsDataURL(blob);
  });
}

/**
 * One photo the family may see, `GET /v1/families/:familyId/media/:mediaId`, as a `data:` URI held
 * in memory only (ADR-33): nothing is written to disk, so nothing outlives the photo's deletion
 * after its 30 days. A refusal is an `ApiError`, a 401 among them, which the caller retries once
 * with a fresh token.
 */
export async function fetchPhoto(
  familyId: string,
  mediaId: string,
  token: string | null,
): Promise<string> {
  if (!apiConfigured() || apiBaseUrl === undefined) {
    throw new Error("The API is not configured");
  }
  const response = await fetch(`${apiBaseUrl}/v1/families/${familyId}/media/${mediaId}`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw failureOf(response.status, await response.text().catch(() => ""));
  }
  return dataUriOf(await response.blob());
}
