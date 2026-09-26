/**
 * Photos from the app through the API (ADR-33): the upload, `POST /v1/families/:familyId/media`,
 * and the read, `GET /v1/families/:familyId/media/:mediaId`, on a fake runtime. What the services
 * decide (cleaning, the row, replays, the limits, who may read) is `@vela/services`' own tests';
 * these hold the routes to their order of refusals, their statuses and bodies, and what they hand
 * the services.
 */
import type { ApiComposedAsk, ApiErrorBody, ApiMe, ApiUploadedMedia } from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";
import {
  ApiIdempotencyError,
  AskPhotoMissingError,
  MediaRefusedError,
  nothingAfterCommit,
  type SessionIdentity,
  VelaError,
} from "@vela/services";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApiReadServices, type ApiRuntime, createApiApp } from "./api-app.ts";
import { apiMediaFor, apiRuntimeFor } from "./api-runtime.ts";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_READ_MS, readUploadBody } from "./api-upload.ts";
import type { ApiConfig } from "./config.ts";
import { createMediaPort } from "./deps.ts";
import type { PilotEnv } from "./env.ts";
import {
  type FakeR2Object,
  fakeR2Bucket,
  type LogLine,
  recordingLogger,
  testEnv,
} from "./testing/fakes.ts";

const USER_ID = "11111111-1111-7111-8111-111111111111";
const MEMBER_ID = "22222222-2222-7222-8222-222222222222";
const FAMILY_ID = "33333333-3333-7333-8333-333333333333";
const OTHER_FAMILY_ID = "44444444-4444-7444-8444-444444444444";
const MEDIA_ID = "55555555-5555-7555-8555-555555555555";
const IDENTITY: SessionIdentity = { authSubject: "verified-user", sessionId: "verified-session" };
const UPLOAD_PATH = `/v1/families/${FAMILY_ID}/media`;
const READ_PATH = `/v1/families/${FAMILY_ID}/media/${MEDIA_ID}`;

/** The first bytes of a JPEG and of a PNG: the route never looks, but the services receive them. */
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9);
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const UPLOADED: ApiUploadedMedia = {
  id: MEDIA_ID,
  kind: "image",
  width: 1600,
  height: 1200,
  bytes: 412_345,
  expires_at: "2026-10-22T00:00:00.000Z",
};

const INVALID = { error: { code: "invalid", message: "Invalid request." } };
const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };
const FAMILY_NOT_FOUND = { error: { code: "not_found", message: "Family not found." } };
const UNAUTHENTICATED = { error: { code: "unauthenticated", message: "Sign in required." } };
const CONFLICT = {
  error: { code: "conflict", message: "Request conflicts with an earlier operation." },
};
const RATE_LIMITED = { error: { code: "rate_limited", message: "Too many requests." } };
const INTERNAL = { error: { code: "internal", message: "Internal server error." } };

function photosOff(reason: string): ApiErrorBody {
  return {
    error: {
      code: "unavailable",
      message: "Photos are not switched on here.",
      details: { reason },
    },
  };
}

function unused(name: string) {
  return () => Promise.reject(new Error(`${name} is not part of these tests`));
}

interface FixtureOptions {
  /** A store, none (storage off), or a store that could not be built. */
  readonly media?: "on" | "off" | "unavailable";
  readonly writes?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const db = {} as VelaDatabase;
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const verifySession = vi.fn<ApiRuntime["verifySession"]>().mockResolvedValue(IDENTITY);
  const openDatabase = vi.fn<ApiRuntime["openDatabase"]>().mockResolvedValue({ db, close });
  const objects = new Map<string, FakeR2Object>();
  const store = createMediaPort(
    { MEDIA_STORAGE: "r2", MEDIA_BUCKET: fakeR2Bucket(objects) },
    "staging",
    "wrangler.jsonc",
    recordingLogger([]),
    { said: true },
  );
  if (store === null) throw new Error("expected a media store");
  const random = { token: vi.fn(() => "minted-token") };
  const services = {
    loadApiMe: vi.fn<ApiReadServices["loadApiMe"]>().mockResolvedValue({
      user: { id: USER_ID, display_name: "Mia", language: "en", tz: "Asia/Taipei" },
      memberships: [],
    }),
    loadApiFamilyPlan: vi.fn<ApiReadServices["loadApiFamilyPlan"]>(unused("the plan")),
    loadApiLights: vi.fn<ApiReadServices["loadApiLights"]>(unused("the lights")),
    loadApiToday: vi.fn<ApiReadServices["loadApiToday"]>(unused("Today")),
    loadApiFamily: vi.fn<ApiReadServices["loadApiFamily"]>(unused("the family")),
    loadApiExchanges: vi.fn<ApiReadServices["loadApiExchanges"]>(unused("Exchanges")),
    loadApiQuiet: vi.fn<ApiReadServices["loadApiQuiet"]>(unused("the quiet notice")),
    authorizeFamilyAccess: vi.fn<ApiReadServices["authorizeFamilyAccess"]>().mockResolvedValue({
      kind: "granted",
      access: { userId: USER_ID, memberId: MEMBER_ID, familyId: FAMILY_ID, role: "member" },
    }),
    readApiMedia: vi
      .fn<ApiReadServices["readApiMedia"]>()
      .mockResolvedValue({ body: JPEG.slice().buffer, mime: "image/jpeg" }),
  };
  type Writes = NonNullable<ApiRuntime["writes"]>;
  const clock = { now: () => new Date("2026-09-22T00:00:00.000Z") };
  const writes = {
    verifyActiveSession: vi.fn<Writes["verifyActiveSession"]>().mockResolvedValue(true),
    clock,
    services: {
      provisionApiAccount: vi.fn<Writes["services"]["provisionApiAccount"]>(unused("provision")),
      updateApiAccount: vi.fn<Writes["services"]["updateApiAccount"]>(unused("update")),
      composeApiAsk: vi.fn<Writes["services"]["composeApiAsk"]>(unused("compose")),
      replyToApiExchange: vi.fn<Writes["services"]["replyToApiExchange"]>(unused("reply")),
      createApiFamily: vi.fn<Writes["services"]["createApiFamily"]>(unused("create")),
      resolveApiQuiet: vi.fn<Writes["services"]["resolveApiQuiet"]>(unused("quiet")),
      pauseApiMember: vi.fn<Writes["services"]["pauseApiMember"]>(unused("pause")),
      leaveApiFamily: vi.fn<Writes["services"]["leaveApiFamily"]>(unused("leave")),
      startApiTrial: vi.fn<Writes["services"]["startApiTrial"]>(unused("trial")),
      uploadApiMedia: vi
        .fn<Writes["services"]["uploadApiMedia"]>()
        .mockResolvedValue({ response: { status: 201, body: UPLOADED }, replayed: false }),
    },
  };
  const logger = { error: vi.fn<ApiRuntime["logger"]["error"]>() };
  const media = options.media ?? "on";
  const runtime: ApiRuntime = {
    verifySession,
    now: clock.now,
    openDatabase,
    services,
    logger,
    ...(options.writes === false ? {} : { writes }),
    ...(media === "on"
      ? { media: { store, random } }
      : media === "unavailable"
        ? { mediaOff: "media_storage_unavailable" as const }
        : {}),
  };
  return {
    app: createApiApp(runtime),
    db,
    close,
    verifySession,
    openDatabase,
    services,
    writes,
    logger,
    store,
    random,
    objects,
  };
}

type Fixture = ReturnType<typeof fixture>;

/** Headers to send: a null value leaves that header out. */
type Headers_ = Record<string, string | null>;

function uploadRequest(
  body: BodyInit | null = JPEG,
  headers: Headers_ = {},
  path = UPLOAD_PATH,
): Request {
  const sent: Headers_ = {
    authorization: "Bearer good",
    "content-type": "image/jpeg",
    "idempotency-key": "media:first-pick",
    ...headers,
  };
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: Object.fromEntries(
      Object.entries(sent).flatMap(([name, value]) => (value === null ? [] : [[name, value]])),
    ),
    body,
  });
}

/** An upload whose body records whether anyone started reading it. */
function watchedUpload(headers: Headers_ = {}, path = UPLOAD_PATH) {
  const request = uploadRequest(JPEG, headers, path);
  const read = vi.spyOn(request.body as ReadableStream, "getReader");
  return { request, read };
}

async function expectJson(response: Response, status: number, body: unknown): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual(body);
}

/** Nothing past the headers happened: no write counted, no connection, no service. */
function expectNothingDone(f: Fixture): void {
  expect(f.writes.verifyActiveSession).not.toHaveBeenCalled();
  expect(f.openDatabase).not.toHaveBeenCalled();
  expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
  expect(f.writes.services.uploadApiMedia).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("uploading a photo", () => {
  it("hands the service the bytes, the verified caller, the key and the family, and answers 201", async () => {
    const f = fixture();
    const response = await f.app.request(uploadRequest(JPEG));

    await expectJson(response, 201, UPLOADED);
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(f.writes.services.uploadApiMedia).toHaveBeenCalledExactlyOnceWith(
      {
        db: f.db,
        clock: f.writes.clock,
        random: f.random,
        store: f.store,
        logger: f.logger,
      },
      IDENTITY,
      "media:first-pick",
      FAMILY_ID,
      JPEG,
    );
    expect(f.services.authorizeFamilyAccess).toHaveBeenCalledExactlyOnceWith(
      f.db,
      IDENTITY,
      FAMILY_ID,
      undefined,
    );
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it("answers a replay with the first upload's row and says it was one", async () => {
    const f = fixture();
    f.writes.services.uploadApiMedia
      .mockResolvedValueOnce({ response: { status: 201, body: UPLOADED }, replayed: false })
      .mockResolvedValueOnce({ response: { status: 201, body: UPLOADED }, replayed: true });

    const first = await f.app.request(uploadRequest());
    const again = await f.app.request(uploadRequest());

    await expectJson(first, 201, UPLOADED);
    await expectJson(again, 201, UPLOADED);
    expect(first.headers.get("idempotency-replayed")).toBe("false");
    expect(again.headers.get("idempotency-replayed")).toBe("true");
  });

  it("answers only the uploaded row's own fields", async () => {
    const f = fixture();
    f.writes.services.uploadApiMedia.mockResolvedValue({
      response: {
        status: 201,
        body: { ...UPLOADED, storage_key: `asks/${FAMILY_ID}/private.jpg`, uploaded_by: MEMBER_ID },
      },
      replayed: false,
    });
    await expectJson(await f.app.request(uploadRequest()), 201, UPLOADED);
  });

  it("lets a member who does not organise the family upload: no role is asked for, so no 403", async () => {
    const f = fixture();
    await expectJson(await f.app.request(uploadRequest()), 201, UPLOADED);
    expect(f.services.authorizeFamilyAccess.mock.calls[0]?.[3]).toBeUndefined();
  });

  it("accepts image/jpeg in any case and with parameters, and an identity encoding", async () => {
    const accepted: Headers_[] = [
      { "content-type": "Image/JPEG" },
      { "content-type": "image/jpeg; name=photo.jpg" },
      { "content-type": 'image/jpeg;q="0.8"' },
      { "content-encoding": "identity" },
    ];
    for (const headers of accepted) {
      const f = fixture();
      await expectJson(await f.app.request(uploadRequest(JPEG, headers)), 201, UPLOADED);
    }
  });

  it("answers 401 without a token, before anything else", async () => {
    const f = fixture({ media: "off" });
    f.verifySession.mockResolvedValue(null);
    const { request, read } = watchedUpload();

    await expectJson(await f.app.request(request), 401, UNAUTHENTICATED);
    expect(read).not.toHaveBeenCalled();
    expectNothingDone(f);
  });

  it.each([
    ["off", "media_storage_off"],
    ["unavailable", "media_storage_unavailable"],
  ] as const)(
    "answers 503 when storage is %s, saying why, without reading the body or counting the write",
    async (media, reason) => {
      const f = fixture({ media });
      const { request, read } = watchedUpload();

      await expectJson(await f.app.request(request), 503, photosOff(reason));
      expect(read).not.toHaveBeenCalled();
      expectNothingDone(f);
      expect(f.logger.error).not.toHaveBeenCalled();
    },
  );

  it("says photos are off before judging the headers, so the app hears the one thing that matters", async () => {
    const refused: Headers_[] = [
      { "idempotency-key": null },
      { "content-type": "image/png" },
      { "content-length": String(MAX_UPLOAD_BYTES + 1) },
    ];
    for (const headers of refused) {
      const f = fixture({ media: "off" });
      await expectJson(
        await f.app.request(uploadRequest(JPEG, headers)),
        503,
        photosOff("media_storage_off"),
      );
      expectNothingDone(f);
    }
  });

  it.each([
    ["no Idempotency-Key", { "idempotency-key": null }, 400],
    ["a key with a space", { "idempotency-key": "media key" }, 400],
    ["a PNG's type", { "content-type": "image/png" }, 415],
    ["JSON's type", { "content-type": "application/json" }, 415],
    ["no type", { "content-type": null }, 415],
    ["two types", { "content-type": "image/jpeg, image/png" }, 415],
    ["a type that only starts like JPEG's", { "content-type": "image/jpegx" }, 415],
    ["a gzip encoding", { "content-encoding": "gzip" }, 415],
    ["a declared length over 1 MiB", { "content-length": String(MAX_UPLOAD_BYTES + 1) }, 413],
  ] as const)(
    "refuses %s from the headers, before the body, the write limit or the database",
    async (_, headers, status) => {
      const f = fixture();
      const { request, read } = watchedUpload(headers);

      await expectJson(await f.app.request(request), status, INVALID);
      expect(read).not.toHaveBeenCalled();
      expectNothingDone(f);
    },
  );

  it("answers 429 when the account is over its write limit, before the database and the body", async () => {
    const f = fixture();
    f.writes.verifyActiveSession.mockRejectedValue(new ApiIdempotencyError("rate_limited"));
    const { request, read } = watchedUpload();

    await expectJson(await f.app.request(request), 429, RATE_LIMITED);
    expect(read).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.writes.services.uploadApiMedia).not.toHaveBeenCalled();
  });

  it("answers 401 when the session is no longer live, before the database and the body", async () => {
    const f = fixture();
    f.writes.verifyActiveSession.mockResolvedValue(false);
    const { request, read } = watchedUpload();

    await expectJson(await f.app.request(request), 401, UNAUTHENTICATED);
    expect(read).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it("answers 404 for a family that is not the caller's, before reading the body", async () => {
    const f = fixture();
    f.services.authorizeFamilyAccess.mockResolvedValue({ kind: "not_found" });
    const { request, read } = watchedUpload({}, `/v1/families/${OTHER_FAMILY_ID}/media`);

    await expectJson(await f.app.request(request), 404, FAMILY_NOT_FOUND);
    expect(read).not.toHaveBeenCalled();
    expect(f.writes.services.uploadApiMedia).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("answers 404 when the service finds the family gone inside its transaction", async () => {
    const f = fixture();
    f.writes.services.uploadApiMedia.mockRejectedValue(
      new VelaError("not_found", "Family not found"),
    );
    await expectJson(await f.app.request(uploadRequest()), 404, NOT_FOUND);
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it("answers 409 when the key was used for another photo", async () => {
    const f = fixture();
    f.writes.services.uploadApiMedia.mockRejectedValue(new ApiIdempotencyError("conflict"));
    await expectJson(await f.app.request(uploadRequest()), 409, CONFLICT);
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ["jpeg_only", 415, "invalid", "Only JPEG photos can be kept."],
    ["malformed", 400, "invalid", "That photo could not be read."],
    ["dimensions", 400, "invalid", "That photo is too large or too narrow."],
    ["photo_limit", 429, "rate_limited", "Too many photos for now."],
  ] as const)(
    "answers a refused photo (%s) with %i and the reason",
    async (reason, status, code, message) => {
      const f = fixture();
      f.writes.services.uploadApiMedia.mockRejectedValue(new MediaRefusedError(reason));
      const response = await f.app.request(uploadRequest(reason === "jpeg_only" ? PNG : JPEG));

      await expectJson(response, status, { error: { code, message, details: { reason } } });
      expect(f.logger.error).not.toHaveBeenCalled();
      if (reason === "jpeg_only") {
        expect(f.writes.services.uploadApiMedia.mock.calls[0]?.[4]).toEqual(PNG);
      }
    },
  );

  it("answers 500 to a service that answers anything but a 201, logging only the label", async () => {
    const f = fixture();
    f.writes.services.uploadApiMedia.mockResolvedValue({
      response: { status: 200, body: UPLOADED },
      replayed: false,
    });
    await expectJson(await f.app.request(uploadRequest()), 500, INTERNAL);
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
      error: "Error",
    });
  });

  it("reads exactly 1 MiB, streamed in pieces with no declared length", async () => {
    const f = fixture();
    const piece = new Uint8Array(64 * 1024).fill(7);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === MAX_UPLOAD_BYTES) {
          controller.close();
          return;
        }
        controller.enqueue(piece);
        sent += piece.length;
      },
    });

    await expectJson(await f.app.request(uploadRequest(body)), 201, UPLOADED);
    const received = f.writes.services.uploadApiMedia.mock.calls[0]?.[4];
    expect(received?.length).toBe(MAX_UPLOAD_BYTES);
  });

  it("answers 413 once a streamed body passes 1 MiB, cancelling it, with no declared length", async () => {
    const f = fixture();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1));
      },
      cancel,
    });

    await expectJson(await f.app.request(uploadRequest(body)), 413, INVALID);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(f.writes.services.uploadApiMedia).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("answers 413 to a body longer than the length it declared under the cap", async () => {
    const f = fixture();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES + 1));
        controller.close();
      },
    });
    await expectJson(
      await f.app.request(uploadRequest(body, { "content-length": "100" })),
      413,
      INVALID,
    );
    expect(f.writes.services.uploadApiMedia).not.toHaveBeenCalled();
  });

  it("answers 400 to an empty body", async () => {
    const f = fixture();
    await expectJson(await f.app.request(uploadRequest(new Uint8Array(0))), 400, INVALID);
    expect(f.writes.services.uploadApiMedia).not.toHaveBeenCalled();
  });

  it("answers 408 when the body has not arrived within 60 seconds, and cancels it", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const waiting = { resolve: () => {} };
    const reached = new Promise<void>((resolve) => {
      waiting.resolve = resolve;
    });
    let sent = false;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(JPEG);
        } else waiting.resolve();
      },
      cancel,
    });

    const response = Promise.resolve(f.app.request(uploadRequest(body)));
    await reached;
    await vi.advanceTimersByTimeAsync(MAX_UPLOAD_READ_MS - 1);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    await expectJson(await response, 408, INVALID);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(f.writes.services.uploadApiMedia).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("is not served without writes: 404, as every write is", async () => {
    const f = fixture({ writes: false });
    await expectJson(await f.app.request(uploadRequest()), 404, NOT_FOUND);
    expect(f.verifySession).not.toHaveBeenCalled();
  });
});

describe("composing a photo ask", () => {
  const PHOTO_ONE = "66666666-6666-7666-8666-666666666661";
  const PHOTO_TWO = "66666666-6666-7666-8666-666666666662";
  const CHOICE = {
    recipient_id: MEMBER_ID,
    type: "photo_choice",
    text: "Which one do you like more?",
    when: "tomorrow",
    media_ids: [PHOTO_ONE, PHOTO_TWO],
  };
  const COMPOSED: ApiComposedAsk = {
    id: "77777777-7777-7777-8777-777777777777",
    family_id: FAMILY_ID,
    recipient_id: MEMBER_ID,
    recipient_name: "Mom",
    asker_name: "Mia",
    on_behalf_of: null,
    type: "photo_choice",
    ask: "Which one do you like more?",
    when_rule: "tomorrow",
    scheduled_for: "2026-09-23",
    state: "composed",
  };

  function composeRequest(body: unknown): Request {
    return new Request(`https://api.test/v1/families/${FAMILY_ID}/exchanges`, {
      method: "POST",
      headers: {
        authorization: "Bearer good",
        "content-type": "application/json",
        "idempotency-key": "ask:photos",
      },
      body: JSON.stringify(body),
    });
  }

  it("hands compose the photos in her order and answers 201", async () => {
    const f = fixture();
    f.writes.services.composeApiAsk.mockResolvedValue({
      response: { status: 201, body: COMPOSED },
      replayed: false,
      after: nothingAfterCommit(),
    });

    const response = await f.app.request(composeRequest(CHOICE));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(COMPOSED);
    expect(f.writes.services.composeApiAsk).toHaveBeenCalledWith(
      { db: f.db, clock: f.writes.clock },
      IDENTITY,
      "ask:photos",
      FAMILY_ID,
      CHOICE,
    );
  });

  it("answers 404 photo_missing when a photo cannot be shown to her, so the app offers to choose again", async () => {
    const f = fixture();
    f.writes.services.composeApiAsk.mockRejectedValue(new AskPhotoMissingError());

    const response = await f.app.request(composeRequest(CHOICE));

    await expectJson(response, 404, {
      error: {
        code: "not_found",
        message: "That photo is no longer here.",
        details: { reason: "photo_missing" },
      },
    });
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it("refuses a whenever photo ask and a wrong count of photos before any database is opened", async () => {
    for (const body of [
      { ...CHOICE, when: "whenever" },
      { ...CHOICE, media_ids: [PHOTO_ONE] },
      { ...CHOICE, media_ids: [PHOTO_ONE, PHOTO_ONE] },
      { ...CHOICE, type: "memory_photo" },
      { ...CHOICE, type: "question" },
      { ...CHOICE, media_ids: undefined },
    ]) {
      const f = fixture();
      const response = await f.app.request(composeRequest(body));
      await expectJson(response, 400, INVALID);
      expect(f.openDatabase).not.toHaveBeenCalled();
      expect(f.writes.services.composeApiAsk).not.toHaveBeenCalled();
    }
  });
});

describe("reading a photo", () => {
  function readRequest(path = READ_PATH, headers: Record<string, string> = {}) {
    return new Request(`https://api.test${path}`, {
      headers: { authorization: "Bearer good", ...headers },
    });
  }

  it("answers the bytes as a JPEG the browser may not sniff or cache", async () => {
    const f = fixture();
    const response = await f.app.request(readRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(f.services.readApiMedia).toHaveBeenCalledExactlyOnceWith(
      f.db,
      IDENTITY,
      FAMILY_ID,
      MEDIA_ID,
      f.store,
    );
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("reads without writes on: a read is not a write", async () => {
    const f = fixture({ writes: false });
    expect((await f.app.request(readRequest())).status).toBe(200);
  });

  it("answers 404 for anything the service does not serve: another family's photo, an unknown id, a row Telegram alone holds", async () => {
    const f = fixture();
    f.services.readApiMedia.mockResolvedValue(null);
    await expectJson(await f.app.request(readRequest()), 404, NOT_FOUND);
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("answers 404 for a family that is not the caller's, without asking for the photo", async () => {
    const f = fixture();
    f.services.authorizeFamilyAccess.mockResolvedValue({ kind: "not_found" });
    await expectJson(
      await f.app.request(readRequest(`/v1/families/${OTHER_FAMILY_ID}/media/${MEDIA_ID}`)),
      404,
      FAMILY_NOT_FOUND,
    );
    expect(f.services.readApiMedia).not.toHaveBeenCalled();
  });

  it.each(["not-a-uuid", `${MEDIA_ID}0`, "..%2Fother.jpg", "55555555555575558555555555555555"])(
    "answers 404 for the media id %s before opening the database",
    async (id) => {
      const f = fixture();
      await expectJson(
        await f.app.request(readRequest(`/v1/families/${FAMILY_ID}/media/${id}`)),
        404,
        NOT_FOUND,
      );
      expect(f.openDatabase).not.toHaveBeenCalled();
      expect(f.services.readApiMedia).not.toHaveBeenCalled();
    },
  );

  it.each(["off", "unavailable"] as const)(
    "answers 404 when storage is %s, before opening the database",
    async (media) => {
      const f = fixture({ media });
      await expectJson(await f.app.request(readRequest()), 404, NOT_FOUND);
      expect(f.openDatabase).not.toHaveBeenCalled();
      expect(f.services.readApiMedia).not.toHaveBeenCalled();
    },
  );

  it("answers 401 without a token, before anything else", async () => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    await expectJson(await f.app.request(readRequest()), 401, UNAUTHENTICATED);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it("answers 500 when storage fails, logging only the label", async () => {
    const f = fixture();
    f.services.readApiMedia.mockRejectedValue(new Error("R2 unavailable for asks/private.jpg"));
    await expectJson(await f.app.request(readRequest()), 500, INTERNAL);
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
      error: "Error",
    });
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("answers HEAD 404, as every route does", async () => {
    const f = fixture();
    const response = await f.app.request(readRequest(), { method: "HEAD" });
    expect(response.status).toBe(404);
    expect(f.verifySession).not.toHaveBeenCalled();
  });
});

describe("whether the API keeps photos", () => {
  it.each([
    ["on", true],
    ["off", false],
    ["unavailable", false],
  ] as const)("says so on /v1/me when storage is %s", async (media, photos) => {
    const f = fixture({ media });
    const response = await f.app.request(
      new Request("https://api.test/v1/me", { headers: { authorization: "Bearer good" } }),
    );
    const body = (await response.json()) as ApiMe;
    expect(response.status).toBe(200);
    expect(body.photos).toBe(photos);
  });
});

describe("the media port the API runs on", () => {
  const STAGING: ApiConfig = {
    environment: "staging",
    issuer: "https://ideal-vulture-9262.clerk.accounts.dev",
    secretKey: null,
    telegramBotUsername: "VelaStagingBot",
    regions: ["apac"],
  };

  function env(overrides: Partial<PilotEnv>): PilotEnv {
    return { ...testEnv, ENVIRONMENT: "staging", ...overrides };
  }

  it("keeps photos in the bucket MEDIA_STORAGE r2 binds, with the Worker's own token source", async () => {
    const objects = new Map<string, FakeR2Object>();
    const logs: LogLine[] = [];
    const photos = apiMediaFor(
      env({ MEDIA_STORAGE: "r2", MEDIA_BUCKET: fakeR2Bucket(objects) }),
      STAGING,
      recordingLogger(logs),
    );
    if (photos.media === undefined) throw new Error("expected a store");

    await photos.media.store.put("asks/f/a.jpg", JPEG.slice().buffer, "image/jpeg");
    expect(objects.get("asks/f/a.jpg")?.mime).toBe("image/jpeg");
    expect(photos.media.random.token(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(photos.mediaOff).toBeUndefined();
    expect(logs).toEqual([]);
  });

  it("keeps none with MEDIA_STORAGE off, and says it is off", () => {
    const photos = apiMediaFor(env({ MEDIA_STORAGE: "off" }), STAGING, recordingLogger([]));
    expect(photos).toEqual({ mediaOff: "media_storage_off" });
  });

  it.each([
    ["r2 with no bucket bound", { MEDIA_STORAGE: "r2", MEDIA_BUCKET: undefined }],
    ["a value that is neither", { MEDIA_STORAGE: "s3" }],
  ] as const)(
    "keeps none with %s, logs the refusal by its label, and leaves the rest of the API built",
    (_, overrides) => {
      const logs: LogLine[] = [];
      const logger = recordingLogger(logs);
      const photos = apiMediaFor(env(overrides), STAGING, logger);

      expect(photos).toEqual({ mediaOff: "media_storage_unavailable" });
      expect(logs).toEqual([
        {
          level: "error",
          event: "api_config_refused",
          fields: {
            error: `ConfigError:${overrides.MEDIA_STORAGE === "r2" ? "MEDIA_BUCKET" : "MEDIA_STORAGE"}`,
          },
        },
      ]);

      const runtime = apiRuntimeFor(env(overrides), STAGING);
      expect(runtime.media).toBeUndefined();
      expect(runtime.mediaOff).toBe("media_storage_unavailable");
      expect(runtime.services.loadApiMe).toBeTypeOf("function");
    },
  );
});

describe("readUploadBody", () => {
  const quiet = { error: () => {} };

  it("joins the pieces of a body in order", async () => {
    const pieces = [Uint8Array.of(1, 2), Uint8Array.of(), Uint8Array.of(3)];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const piece = pieces[index++];
        if (piece === undefined) controller.close();
        else controller.enqueue(piece);
      },
    });
    const request = new Request("https://api.test/", { method: "POST", body });

    expect(await readUploadBody(request, quiet, 3, 1_000)).toEqual({
      ok: true,
      bytes: Uint8Array.of(1, 2, 3),
    });
  });

  it("bounds a stream of empty pieces and cancels it", async () => {
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) =>
      controller.enqueue(new Uint8Array()),
    );
    const body = new ReadableStream<Uint8Array>({ pull, cancel });
    const request = new Request("https://api.test/", { method: "POST", body });

    expect(await readUploadBody(request, quiet, 8, 1_000)).toEqual({ ok: false, status: 400 });
    expect(pull.mock.calls.length).toBeLessThanOrEqual(10);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("answers 400 to a stream that fails, and to no body at all", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("private stream error"));
      },
    });
    const failing = new Request("https://api.test/", { method: "POST", body });
    expect(await readUploadBody(failing, quiet, 8, 1_000)).toEqual({ ok: false, status: 400 });
    expect(
      await readUploadBody(new Request("https://api.test/", { method: "POST" }), quiet, 8, 1_000),
    ).toEqual({ ok: false, status: 400 });
  });

  it("logs a cancellation that fails by its label", async () => {
    const logger = { error: vi.fn() };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(9));
      },
      cancel() {
        throw new Error("private cancellation detail");
      },
    });
    const request = new Request("https://api.test/", { method: "POST", body });

    expect(await readUploadBody(request, logger, 8, 1_000)).toEqual({ ok: false, status: 413 });
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledExactlyOnceWith("api_body_cancel_failed", {
        error: "Error",
      }),
    );
  });
});
