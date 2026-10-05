import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { ChannelSendError } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import type { PilotEnv } from "./env.ts";
import { createMediaUrl, MEDIA_PATH_PREFIX } from "./media-route.ts";
import { createWorker } from "./pilot-worker.ts";
import {
  consoleLinesDuring,
  createFakePilotRuntime,
  lineOnEnv,
  namesOf,
  TEST_LINE,
  testEnv,
  testMediaBucket,
} from "./testing/fakes.ts";

/** Her voice note as ingestion stores it: ids only in the key, the type LINE gave in the object. */
const VOICE_KEY =
  "families/11111111-1111-7111-8111-111111111111/answers/33333333-3333-7333-8333-333333333333.m4a";
const VOICE = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

const mediaUrl = createMediaUrl({
  pilotOrigin: TEST_LINE.pilotOrigin,
  mediaUrlSecret: TEST_LINE.mediaUrlSecret,
});

async function stored(key: string, bytes: Uint8Array, mime: string): Promise<void> {
  await testMediaBucket.put(key, bytes, { httpMetadata: { contentType: mime } });
}

async function fetchMedia(
  url: string,
  env: PilotEnv = lineOnEnv(),
  headers: HeadersInit = {},
): Promise<Response> {
  const fake = createFakePilotRuntime();
  const ctx = createExecutionContext();
  const response = await createWorker(fake.runtime).fetch(new Request(url, { headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(fake.built(), "the media route builds no deps").toBe(0);
  expect(namesOf(fake.calls)).toEqual([]);
  return response;
}

/** The Worker's one 404, as it answers any address that is not there. */
async function notFoundAnswer(): Promise<{ status: number; body: string }> {
  const response = await fetchMedia(`${TEST_LINE.pilotOrigin}/nowhere`);
  return { status: response.status, body: await response.text() };
}

/** A URL's path parts after `/media/`: the encoded key and the signed file name. */
function partsOf(url: string): { key: string; file: string } {
  const [key = "", file = ""] = new URL(url).pathname.slice(MEDIA_PATH_PREFIX.length).split("/");
  return { key, file };
}

function base64Url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The signature the media secret gives these bytes, as a URL's file name carries it. */
async function signedName(bytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_LINE.mediaUrlSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return base64Url(String.fromCharCode(...mac));
}

describe("the media URLs LINE is sent", () => {
  it("name the object's key and a signature on this Worker's origin, with the extension of its type", async () => {
    const url = await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" });

    expect(url).toBe(
      `${TEST_LINE.pilotOrigin}/media/${base64Url(VOICE_KEY)}/${await signedName(new TextEncoder().encode(VOICE_KEY))}.m4a`,
    );
    expect(partsOf(url).file).toMatch(/^[A-Za-z0-9_-]{43}\.m4a$/);
    expect(url).not.toContain(TEST_LINE.mediaUrlSecret);
  });

  // A retried push must send the very same body (05 §1 fact 8), so a URL carries no time.
  it("are the same every time for the same object", async () => {
    const first = await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" });

    expect(await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" })).toBe(first);
  });

  it.each([
    ["audio/mp4", "m4a"],
    ["audio/x-m4a", "m4a"],
    ["audio/m4a", "m4a"],
    ["Audio/MPEG", "mp3"],
    ["image/jpeg", "jpg"],
    ["image/png; charset=binary", "png"],
  ])("end %s in .%s", async (mime, extension) => {
    expect(await mediaUrl({ storageKey: VOICE_KEY, mime })).toMatch(new RegExp(`\\.${extension}$`));
  });

  // LINE plays none of these by URL (05 §5.5), and Telegram's voice notes never go to LINE (D9).
  it.each([["audio/ogg"], ["image/webp"], ["video/mp4"], [""]])(
    "are refused for %j as an invalid request, which no retry fixes",
    async (mime) => {
      const refusal = mediaUrl({ storageKey: VOICE_KEY, mime });

      await expect(refusal).rejects.toBeInstanceOf(ChannelSendError);
      await expect(refusal).rejects.toHaveProperty("code", "invalid_request");
    },
  );
});

describe("the media route", () => {
  it("streams the object a signed URL names, with its stored type, kept private", async () => {
    await stored(VOICE_KEY, VOICE, "audio/x-m4a");

    const response = await fetchMedia(
      await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/x-m4a");
    expect(response.headers.get("cache-control")).toBe("private");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(VOICE);
  });

  // A player seeking in her voice note asks for a part; R2 reads the header as it came.
  it.each([
    ["bytes=2-5", "bytes 2-5/10", [2, 3, 4, 5]],
    ["bytes=7-", "bytes 7-9/10", [7, 8, 9]],
    ["bytes=-3", "bytes 7-9/10", [7, 8, 9]],
  ])("answers Range %s with 206, %s, and those bytes alone", async (range, contentRange, bytes) => {
    await stored(VOICE_KEY, VOICE, "audio/x-m4a");

    const response = await fetchMedia(
      await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" }),
      lineOnEnv(),
      { range },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-type")).toBe("audio/x-m4a");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(bytes);
  });

  it("serves a photo LINE is sent with the type it was stored with", async () => {
    const key =
      "families/11111111-1111-7111-8111-111111111111/answers/44444444-4444-7444-8444-444444444444.jpg";
    await stored(key, new Uint8Array([255, 216, 255]), "image/jpeg");

    const response = await fetchMedia(await mediaUrl({ storageKey: key, mime: "image/jpeg" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  /** Every URL the route must refuse, each answered exactly as a path that is not there. */
  const refused: readonly (readonly [string, () => Promise<{ url: string; env?: PilotEnv }>])[] = [
    [
      "a signature changed by one character",
      async () => {
        const url = await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" });
        const { key, file } = partsOf(url);
        const changed = `${file[0] === "A" ? "B" : "A"}${file.slice(1)}`;
        return { url: `${TEST_LINE.pilotOrigin}/media/${key}/${changed}` };
      },
    ],
    [
      "a signature made with another secret",
      async () => ({
        url: await createMediaUrl({
          pilotOrigin: TEST_LINE.pilotOrigin,
          mediaUrlSecret: "aNoThErSeCrEt-0123456789abcdefghijklmnopqrstuvwxyz",
        })({ storageKey: VOICE_KEY, mime: "audio/x-m4a" }),
      }),
    ],
    [
      "another object's key under this one's signature",
      async () => {
        const { file } = partsOf(await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" }));
        return { url: `${TEST_LINE.pilotOrigin}/media/${base64Url("families/other.m4a")}/${file}` };
      },
    ],
    [
      "a key that is not base64url",
      async () => {
        const { file } = partsOf(await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" }));
        return { url: `${TEST_LINE.pilotOrigin}/media/fam+ilies=/${file}` };
      },
    ],
    [
      "a second spelling of a stored key, its last character carrying a stray bit",
      async () => {
        await stored("ab", VOICE, "audio/x-m4a");
        const { key, file } = partsOf(await mediaUrl({ storageKey: "ab", mime: "audio/x-m4a" }));
        // "ab" is YWI; YWJ decodes to the same two bytes, so only the spelling tells them apart.
        return { url: `${TEST_LINE.pilotOrigin}/media/${key.replace(/I$/, "J")}/${file}` };
      },
    ],
    [
      "a key that is not UTF-8, however well signed",
      async () => {
        const notUtf8 = new Uint8Array([0xff]);
        return { url: `${TEST_LINE.pilotOrigin}/media/_w/${await signedName(notUtf8)}.m4a` };
      },
    ],
    [
      "a file name with another extension",
      async () => {
        const url = await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" });
        return { url: url.replace(/\.m4a$/, ".ogg") };
      },
    ],
    [
      "a signed key whose object is gone",
      async () => ({
        url: await mediaUrl({ storageKey: `${VOICE_KEY}.deleted`, mime: "audio/x-m4a" }),
      }),
    ],
    [
      "a good URL while LINE is off",
      async () => ({
        url: await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" }),
        env: { ...lineOnEnv(), LINE_CHANNEL: "off" },
      }),
    ],
  ];

  it.each(refused)("answers %s with the Worker's one 404, and logs nothing", async (_, make) => {
    await stored(VOICE_KEY, VOICE, "audio/x-m4a");
    const { url, env } = await make();
    const expected = await notFoundAnswer();

    const { result, lines } = await consoleLinesDuring(async () => {
      const response = await fetchMedia(url, env);
      return { status: response.status, body: await response.text() };
    });

    expect(result).toEqual(expected);
    expect(expected.status).toBe(404);
    expect(lines).toEqual([]);
  });

  // Development and every deployed environment are off until the staging loop (05 §8).
  it("reads nothing of LINE where it is off, not even its secret", async () => {
    const url = await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" });

    const response = await fetchMedia(url, testEnv);

    expect(testEnv.LINE_CHANNEL).toBe("off");
    expect(response.status).toBe(404);
  });

  // `request_failed` would name the path, which is the storage key and the signature that opens it.
  it("answers 500 when the bucket fails, logging its label and never the path", async () => {
    const url = await mediaUrl({ storageKey: VOICE_KEY, mime: "audio/x-m4a" });
    const failing = {
      get: async () => {
        throw new Error(`R2 is away: ${VOICE_KEY}`);
      },
    } as unknown as R2Bucket;

    const { result: response, lines } = await consoleLinesDuring(() =>
      fetchMedia(url, lineOnEnv({ MEDIA_BUCKET: failing })),
    );

    expect(response.status).toBe(500);
    expect(lines).toEqual([
      {
        level: "error",
        event: "media_request_failed",
        environment: testEnv.ENVIRONMENT,
        error: "Error",
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(partsOf(url).key);
    expect(JSON.stringify(lines)).not.toContain("families/");
  });
});
