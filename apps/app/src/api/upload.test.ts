import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The API's address is read as the client module loads, so it is set before anything is imported.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.vela.test";
});

import { ApiError } from "./client.ts";
import { fetchPhoto, uploadMedia } from "./upload.ts";

const FAMILY = "3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e";
const MEDIA = "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

/** A stand-in for the platform's XMLHttpRequest: it records what was sent and answers on cue. */
class FakeRequest {
  static last: FakeRequest | undefined;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = "";
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

/** Node has no FileReader; this one reads a blob as the platform's does. */
class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload?.();
    });
  }
}

/** Resolves once the fake request has been sent, which happens after the file is read. */
async function sent(): Promise<FakeRequest> {
  await vi.waitFor(() => {
    if (FakeRequest.last?.body === undefined) throw new Error("not sent yet");
  });
  const request = FakeRequest.last;
  if (request === undefined) throw new Error("no request");
  return request;
}

beforeEach(() => {
  FakeRequest.last = undefined;
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  vi.stubGlobal("FileReader", FakeFileReader);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob([JPEG], { type: "image/jpeg" }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploading a photo", () => {
  it("sends the JPEG's own bytes with its key and the session", async () => {
    const progress: number[] = [];
    const upload = uploadMedia(FAMILY, "media:abc", "file:///photo.jpg", "token-1", (fraction) =>
      progress.push(fraction),
    );
    const request = await sent();
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`https://api.vela.test/v1/families/${FAMILY}/media`);
    expect(request.headers).toMatchObject({
      "content-type": "image/jpeg",
      "idempotency-key": "media:abc",
      authorization: "Bearer token-1",
    });
    expect(request.body).toBeInstanceOf(Blob);
    expect(new Uint8Array(await (request.body as Blob).arrayBuffer())).toEqual(JPEG);

    request.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 } as ProgressEvent);
    request.upload.onprogress?.({ lengthComputable: false, loaded: 3, total: 0 } as ProgressEvent);
    const uploaded = {
      id: MEDIA,
      kind: "image",
      width: 1600,
      height: 1200,
      bytes: 4,
      expires_at: "2026-11-12T07:00:00.000Z",
    };
    request.answer(201, uploaded);
    await expect(upload).resolves.toEqual(uploaded);
    expect(progress).toEqual([0.5]);
  });

  it("reads the file it is given every time, as a retry of the same photo does", async () => {
    const first = uploadMedia(FAMILY, "media:same", "file:///kept.jpg", null, () => {});
    (await sent()).answer(201, { id: MEDIA });
    await first;
    FakeRequest.last = undefined;
    const again = uploadMedia(FAMILY, "media:same", "file:///kept.jpg", "fresh", () => {});
    const request = await sent();
    expect(request.headers["idempotency-key"]).toBe("media:same");
    expect(request.headers.authorization).toBe("Bearer fresh");
    request.answer(201, { id: MEDIA });
    await again;
    expect(vi.mocked(fetch).mock.calls.map(([uri]) => uri)).toEqual([
      "file:///kept.jpg",
      "file:///kept.jpg",
    ]);
  });

  it("turns a refusal into an ApiError with its reason", async () => {
    const upload = uploadMedia(FAMILY, "media:png", "file:///photo.png", "t", () => {});
    (await sent()).answer(415, {
      error: {
        code: "invalid",
        message: "Only JPEG photos can be kept.",
        details: { reason: "jpeg_only" },
      },
    });
    await expect(upload).rejects.toMatchObject({
      status: 415,
      code: "invalid",
      details: { reason: "jpeg_only" },
    });
  });

  it("says a lost connection is the network, with status 0", async () => {
    const upload = uploadMedia(FAMILY, "media:lost", "file:///photo.jpg", "t", () => {});
    (await sent()).onerror?.();
    const failure = await upload.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 0, code: "network" });
  });
});

describe("showing a photo", () => {
  it("reads it from the family's media with the session, as a JPEG data URI", async () => {
    const uri = await fetchPhoto(FAMILY, MEDIA, "token-2");
    expect(uri).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.vela.test/v1/families/${FAMILY}/media/${MEDIA}`,
      { headers: { authorization: "Bearer token-2" } },
    );
  });

  it("draws a blob that lost its type as a JPEG all the same", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Blob([JPEG])));
    expect(await fetchPhoto(FAMILY, MEDIA, null)).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("gives the API's refusal, a 401 among them, to the caller", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: { code: "unauthenticated" } }, { status: 401 }),
    );
    await expect(fetchPhoto(FAMILY, MEDIA, "stale")).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
    });
  });
});
