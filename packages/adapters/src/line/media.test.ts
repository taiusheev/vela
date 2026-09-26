import { describe, expect, it } from "vitest";
import { createLineAdapter } from "./adapter.ts";
import { LINE_MAX_DOWNLOAD_BYTES, mediaTypeOf } from "./media.ts";
import {
  createRecordingFetch,
  lineApiFixture,
  type Responder,
  routeOf,
  TEST_CHANNEL_ACCESS_TOKEN,
  TEST_CHANNEL_SECRET,
} from "./testing.ts";

const VOICE_ID = "508667044176309088";
const CONTENT = `GET /v2/bot/message/${VOICE_ID}/content`;
const TRANSCODING = `${CONTENT}/transcoding`;
const PREVIEW = `${CONTENT}/preview`;
const m4a = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41]);

function setup(responder: Responder) {
  const recording = createRecordingFetch(responder);
  const waits: number[] = [];
  const adapter = createLineAdapter({
    channelSecret: TEST_CHANNEL_SECRET,
    channelAccessToken: TEST_CHANNEL_ACCESS_TOKEN,
    fetch: recording.fetch,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });
  return { adapter, requests: recording.requests, waits };
}

/** Answers each request in turn from `answers`, so a test lays out LINE's side of a conversation. */
function inTurn(...answers: (() => Response)[]): Responder {
  let next = 0;
  return () => {
    const answer = answers[next];
    next += 1;
    if (answer === undefined) throw new Error("LINE was asked once too often");
    return answer();
  };
}

const audio =
  (headers: Record<string, string> = { "content-type": "audio/x-m4a" }) =>
  (): Response =>
    new Response(m4a, { headers });

describe("adapter.fetchMedia", () => {
  it("downloads a message's content from api-data.line.me with the token", async () => {
    const { adapter, requests } = setup(audio({ "content-type": "Audio/X-M4A; charset=binary" }));

    const media = await adapter.fetchMedia(VOICE_ID);

    expect(new Uint8Array(media.body)).toStrictEqual(m4a);
    expect(media.mime).toBe("audio/x-m4a");
    expect(requests.map(routeOf)).toStrictEqual([CONTENT]);
    expect(requests[0]?.host).toBe("api-data.line.me");
    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${TEST_CHANNEL_ACCESS_TOKEN}`);
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("gives content LINE sent without a type the generic type", async () => {
    const { adapter } = setup(() => new Response(m4a));
    await expect(adapter.fetchMedia(VOICE_ID)).resolves.toMatchObject({
      mime: "application/octet-stream",
    });
  });

  it("waits while LINE prepares the content, polling 2 s apart, then downloads it", async () => {
    const { adapter, requests, waits } = setup(
      inTurn(
        () => lineApiFixture("api-content-202.json"),
        () => lineApiFixture("api-transcoding-processing.json"),
        () => lineApiFixture("api-transcoding-processing.json"),
        () => lineApiFixture("api-transcoding-succeeded.json"),
        audio(),
      ),
    );

    const media = await adapter.fetchMedia(VOICE_ID);

    expect(new Uint8Array(media.body)).toStrictEqual(m4a);
    expect(requests.map(routeOf)).toStrictEqual([
      CONTENT,
      TRANSCODING,
      TRANSCODING,
      TRANSCODING,
      CONTENT,
    ]);
    expect(waits).toStrictEqual([2_000, 2_000]);
  });

  it("downloads at once when the first poll finds the content ready", async () => {
    const { adapter, requests, waits } = setup(
      inTurn(
        () => lineApiFixture("api-content-202.json"),
        () => lineApiFixture("api-transcoding-succeeded.json"),
        audio(),
      ),
    );

    await adapter.fetchMedia(VOICE_ID);

    expect(requests.map(routeOf)).toStrictEqual([CONTENT, TRANSCODING, CONTENT]);
    expect(waits).toStrictEqual([]);
  });

  it("is unavailable, for the media job to try later, while LINE is still preparing after three polls", async () => {
    const { adapter, requests, waits } = setup((request) =>
      routeOf(request) === CONTENT
        ? lineApiFixture("api-content-202.json")
        : lineApiFixture("api-transcoding-processing.json"),
    );

    await expect(adapter.fetchMedia(VOICE_ID)).rejects.toMatchObject({
      code: "unavailable",
      retryable: true,
    });
    expect(requests.map(routeOf)).toStrictEqual([CONTENT, TRANSCODING, TRANSCODING, TRANSCODING]);
    expect(waits).toStrictEqual([2_000, 2_000]);
  });

  it("is unavailable when the content is still not ready after LINE said it was", async () => {
    const { adapter } = setup(
      inTurn(
        () => lineApiFixture("api-content-202.json"),
        () => lineApiFixture("api-transcoding-succeeded.json"),
        () => lineApiFixture("api-content-202.json"),
      ),
    );

    await expect(adapter.fetchMedia(VOICE_ID)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not retry content LINE failed to prepare, which can never be downloaded", async () => {
    const { adapter, requests } = setup(
      inTurn(
        () => lineApiFixture("api-content-202.json"),
        () => lineApiFixture("api-transcoding-failed.json"),
      ),
    );

    await expect(adapter.fetchMedia(VOICE_ID)).rejects.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
    expect(requests).toHaveLength(2);
  });

  const statuses: [fixture: string, code: string, retryable: boolean][] = [
    ["api-content-404.json", "not_found", false],
    ["api-content-410.json", "not_found", false],
    // Content answered 400 during LINE's outage of 3 February 2026.
    ["api-content-400.json", "unavailable", true],
    ["api-error-401.json", "unavailable", true],
    ["api-error-500.json", "unavailable", true],
  ];

  it.each(statuses)("maps content answered %s to %s", async (fixture, code, retryable) => {
    const { adapter } = setup(() => lineApiFixture(fixture));
    await expect(adapter.fetchMedia(VOICE_ID)).rejects.toMatchObject({ code, retryable });
  });

  it.each(statuses)(
    "maps a preparation status answered %s to %s",
    async (fixture, code, retryable) => {
      const { adapter } = setup(
        inTurn(
          () => lineApiFixture("api-content-202.json"),
          () => lineApiFixture(fixture),
        ),
      );
      await expect(adapter.fetchMedia(VOICE_ID)).rejects.toMatchObject({ code, retryable });
    },
  );

  it("refuses content declared over 20 MB before reading it", async () => {
    const { adapter } = setup(
      audio({
        "content-type": "audio/x-m4a",
        "content-length": String(LINE_MAX_DOWNLOAD_BYTES + 1),
      }),
    );
    await expect(adapter.fetchMedia(VOICE_ID)).rejects.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
  });

  it("refuses content over 20 MB that declared no length", async () => {
    const { adapter } = setup(() => new Response(new Uint8Array(LINE_MAX_DOWNLOAD_BYTES + 1)));
    await expect(adapter.fetchMedia(VOICE_ID)).rejects.toThrow(/download limit/);
  });

  it("maps a download that outlasts its timeout to unavailable", async () => {
    const { adapter } = setup(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    await expect(adapter.fetchMedia(VOICE_ID)).rejects.toMatchObject({
      code: "unavailable",
      message: "line content failed: no answer within 30 s",
    });
  });

  it("refuses an id that is not LINE's without asking LINE", async () => {
    const { adapter, requests } = setup(audio());
    await expect(adapter.fetchMedia("AwACAgUAAxkBAAIBP2bj8x1k")).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(requests).toHaveLength(0);
  });
});

describe("adapter.fetchPreview", () => {
  it("downloads LINE's smaller copy of an image", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const { adapter, requests } = setup(
      () => new Response(jpeg, { headers: { "content-type": "image/jpeg" } }),
    );

    const preview = await adapter.fetchPreview?.(VOICE_ID);

    expect(preview?.mime).toBe("image/jpeg");
    expect(new Uint8Array(preview?.body ?? new ArrayBuffer(0))).toStrictEqual(jpeg);
    expect(requests.map(routeOf)).toStrictEqual([PREVIEW]);
    expect(requests[0]?.host).toBe("api-data.line.me");
  });

  it("is unavailable while LINE is still preparing the preview", async () => {
    const { adapter } = setup(() => lineApiFixture("api-content-202.json"));
    await expect(adapter.fetchPreview?.(VOICE_ID)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("maps a preview that is gone to not_found", async () => {
    const { adapter } = setup(() => lineApiFixture("api-content-410.json"));
    await expect(adapter.fetchPreview?.(VOICE_ID)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("mediaTypeOf", () => {
  it("keeps the media type in lowercase without parameters", () => {
    expect(mediaTypeOf("Image/JPEG; charset=binary")).toBe("image/jpeg");
    expect(mediaTypeOf("audio/x-m4a")).toBe("audio/x-m4a");
  });

  it("gives nothing for a missing or empty type", () => {
    expect(mediaTypeOf(null)).toBeUndefined();
    expect(mediaTypeOf(undefined)).toBeUndefined();
    expect(mediaTypeOf(" ; charset=binary")).toBeUndefined();
  });
});
