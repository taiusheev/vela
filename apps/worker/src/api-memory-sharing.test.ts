import { MEMORY_SHARE_EXPLANATION_EN, MEMORY_SHARE_VERSION } from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";
import { ApiIdempotencyError, type SessionIdentity, VelaError } from "@vela/services";
import { describe, expect, it, vi } from "vitest";
import { type ApiRuntime, createApiApp } from "./api-app.ts";
import { API_READ_SERVICES, API_WRITE_SERVICES } from "./api-runtime.ts";
import { SessionVerificationUnavailable } from "./session.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FAMILY = "abcdefab-0000-4000-8000-000000000001",
  MEMORY = "abcdefab-0000-4000-8000-000000000002",
  OWNER = id(3),
  READER = "abcdefab-0000-4000-8000-000000000004",
  PRESENTATION = "abcdefab-0000-4000-8000-000000000005";
const IDENTITY: SessionIdentity = {
  authSubject: "synthetic|sharing-author",
  sessionId: "synthetic-session",
};
const BASE = `/v1/families/${FAMILY}`;
const VIEW = `${BASE}/memories/${MEMORY}/sharing`;
const PREPARE = `${VIEW}/presentations`;
const PREVIEW = `${BASE}/memory-sharing-presentations/${PRESENTATION}`;
const CONFIRM = `${BASE}/memory-sharing/confirm`;
const STOP = `${VIEW}/stop`;
const SHARED = `${BASE}/shared-memories`;
const CHOICE = {
  presentation_id: PRESENTATION,
  presentation_sha256: "a".repeat(64),
  confirmation_version: MEMORY_SHARE_VERSION,
};
const WORDS = "The synthetic umbrella danced away.";
function fixture(enabled = true, writable = true) {
  type Services = NonNullable<ApiRuntime["memorySharing"]>["services"];
  const services = {
    loadMemorySharingView: vi.fn<Services["loadMemorySharingView"]>().mockResolvedValue({
      memory_id: MEMORY,
      author_id: OWNER,
      quote: WORDS,
      revision: id(6),
      audience_complete: true,
      recipients: [{ member_id: READER, display_name: "Alex", shared: true }],
    }),
    loadMemorySharingPresentation: vi
      .fn<Services["loadMemorySharingPresentation"]>()
      .mockResolvedValue({
        presentation_id: PRESENTATION,
        memory_id: MEMORY,
        quote: WORDS,
        lang: "en",
        recipients: [{ member_id: READER, display_name: "Alex" }],
        confirmation_version: MEMORY_SHARE_VERSION,
        explanation: MEMORY_SHARE_EXPLANATION_EN,
        presentation_sha256: "a".repeat(64),
        expires_at: "2026-10-22T00:05:00.000Z",
      }),
    loadSharedKeptMemories: vi
      .fn<Services["loadSharedKeptMemories"]>()
      .mockResolvedValue({ items: [], next_cursor: null }),
    createMemorySharingPresentation: vi
      .fn<Services["createMemorySharingPresentation"]>()
      .mockResolvedValue({
        response: { status: 200, body: { id: PRESENTATION } },
        replayed: false,
      }),
    confirmMemorySharing: vi.fn<Services["confirmMemorySharing"]>().mockResolvedValue({
      response: { status: 200, body: { shared: true, id: MEMORY } },
      replayed: false,
    }),
    stopSharingMemory: vi
      .fn<Services["stopSharingMemory"]>()
      .mockResolvedValue({ response: { status: 200, body: { stopped: true } }, replayed: false }),
  };
  const close = vi.fn(async () => {});
  const db = {} as VelaDatabase;
  const verifySession = vi.fn<ApiRuntime["verifySession"]>().mockResolvedValue(IDENTITY);
  const verifyActiveSession = vi
    .fn<NonNullable<ApiRuntime["writes"]>["verifyActiveSession"]>()
    .mockResolvedValue(true);
  const openDatabase = vi.fn(async () => ({ db, close }));
  const logger = { error: vi.fn() };
  const config: NonNullable<ApiRuntime["memorySharing"]>["config"] = {
    richMemories: true,
    telegramBotUsername: "SyntheticBot",
    lineBasicId: null,
    adminConversationId: null,
    environment: "development",
    regions: ["apac"],
    publicBaseUrl: "https://synthetic.example",
    privacyNoticeUrls: {
      en: "https://synthetic.example/privacy",
      "zh-TW": "https://synthetic.example/privacy",
      ja: "https://synthetic.example/privacy",
      de: "https://synthetic.example/privacy",
      hi: "https://synthetic.example/privacy",
      ru: "https://synthetic.example/privacy",
    },
    privacyNoticeVersion: "synthetic-review-only",
    memory: false,
    book: false,
  };
  const runtime: ApiRuntime = {
    verifySession,
    now: () => new Date("2026-10-22T00:00:00Z"),
    openDatabase,
    services: API_READ_SERVICES,
    logger,
    ...(enabled ? { memorySharing: { config, services } } : {}),
    ...(writable
      ? {
          writes: {
            clock: { now: () => new Date("2026-10-22T00:00:00Z") },
            verifyActiveSession,
            services: API_WRITE_SERVICES,
          },
        }
      : {}),
  };
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    createApiApp(runtime).request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer synthetic",
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", "idempotency-key": "synthetic-request" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    runtime,
    services,
    config,
    verifySession,
    verifyActiveSession,
    openDatabase,
    close,
    db,
    logger,
    request,
  };
}
const ROUTES = [
  [VIEW, undefined],
  [PREVIEW, undefined],
  [SHARED, undefined],
  [PREPARE, { recipient_ids: [READER] }],
  [CONFIRM, CHOICE],
  [STOP, {}],
] as const;
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe("optional memory-sharing HTTP boundary", () => {
  it("canonicalizes UUIDs before crossing the domain boundary", async () => {
    const f = fixture();
    expect(
      (
        await f.request(
          VIEW.replace(FAMILY, FAMILY.toUpperCase()).replace(MEMORY, MEMORY.toUpperCase()),
        )
      ).status,
    ).toBe(200);
    expect(f.services.loadMemorySharingView).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY,
      MEMORY,
    );
    expect((await f.request(PREPARE, { recipient_ids: [READER.toUpperCase()] })).status).toBe(200);
    expect(f.services.createMemorySharingPresentation.mock.calls[0]?.[4]).toEqual({
      memory_id: MEMORY,
      recipient_ids: [READER],
    });
    expect(
      (await f.request(CONFIRM, { ...CHOICE, presentation_id: PRESENTATION.toUpperCase() })).status,
    ).toBe(200);
    expect(f.services.confirmMemorySharing.mock.calls[0]?.[4]).toEqual(CHOICE);
    expect(
      (await f.request(PREPARE, { recipient_ids: [READER, READER.toUpperCase()] })).status,
    ).toBe(400);
  });
  it("never grants original-conversation fields to a recipient", async () => {
    const f = fixture();
    const item = {
      id: MEMORY,
      member_id: OWNER,
      kind: "story" as const,
      quote: WORDS,
      lang: "en",
      occurred_at: "2026-10-22T00:00:00.000Z",
      kept_at: "2026-10-22T00:00:00.000Z",
    };
    f.services.loadSharedKeptMemories.mockResolvedValueOnce({ items: [item], next_cursor: null });
    const valid = await f.request(SHARED);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ items: [item], next_cursor: null });
    f.services.loadSharedKeptMemories.mockResolvedValueOnce({
      items: [{ ...item, source_answer_id: id(99) }],
      next_cursor: null,
    } as never);
    expect((await f.request(SHARED)).status).toBe(500);
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain(WORDS);
  });
  it("returns rate limits and unavailable session verification without leaking errors", async () => {
    const f = fixture();
    f.services.stopSharingMemory.mockRejectedValueOnce(new ApiIdempotencyError("rate_limited"));
    const response = await f.request(STOP, {});
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    f.verifyActiveSession.mockRejectedValueOnce(new SessionVerificationUnavailable());
    expect((await f.request(STOP, {})).status).toBe(503);
    expect(f.openDatabase).toHaveBeenCalledTimes(1);
  });
  it.each(ROUTES)("is absent by default at %s", async (path, body) => {
    const f = fixture(false);
    const response = await f.request(path, body);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.verifySession).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("requires a verified session at %s", async (path, body) => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    expect((await f.request(path, body)).status).toBe(401);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
  it("loads the author's exact state using verified identity and route IDs", async () => {
    const f = fixture();
    const response = await f.request(VIEW);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      memory_id: MEMORY,
      author_id: OWNER,
      quote: WORDS,
      audience_complete: true,
    });
    expect(f.services.loadMemorySharingView).toHaveBeenCalledWith(
      expect.objectContaining({ db: f.db }),
      IDENTITY,
      FAMILY,
      MEMORY,
    );
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("loads the separately authenticated ephemeral preview, not a receipt-cached quote", async () => {
    const f = fixture();
    expect((await f.request(PREVIEW)).status).toBe(200);
    expect(f.services.loadMemorySharingPresentation).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY,
      PRESENTATION,
    );
  });
  it("uses bounded recipient pagination without trusting a request-supplied owner", async () => {
    const f = fixture();
    expect((await f.request(`${SHARED}?cursor=${id(10)}&owner=${OWNER}`)).status).toBe(200);
    expect(f.services.loadSharedKeptMemories).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY,
      id(10),
    );
    expect((await f.request(`${SHARED}?cursor=invalid`)).status).toBe(400);
    expect((await f.request(`${SHARED}?cursor=${id(10)}&cursor=${id(11)}`)).status).toBe(400);
    expect(f.services.loadSharedKeptMemories).toHaveBeenCalledTimes(1);
  });
  it.each(["view", "preview", "page"])(
    "hides missing or unauthorized %s with404, not an ownership403 oracle",
    async (kind) => {
      const f = fixture();
      f.services.loadMemorySharingView.mockResolvedValue(null);
      f.services.loadMemorySharingPresentation.mockResolvedValue(null);
      f.services.loadSharedKeptMemories.mockResolvedValue(null);
      const response = await f.request(
        kind === "view" ? VIEW : kind === "preview" ? PREVIEW : SHARED,
      );
      expect(response.status).toBe(404);
      expect(await code(response)).toBe("not_found");
      expect(f.close).toHaveBeenCalledTimes(1);
    },
  );
  it("prepares IDs only and returns content-free receipts with replay headers", async () => {
    const f = fixture();
    const response = await f.request(PREPARE, { recipient_ids: [READER] });
    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(await response.json()).toEqual({ id: PRESENTATION });
    expect(f.services.createMemorySharingPresentation).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      "synthetic-request",
      FAMILY,
      { memory_id: MEMORY, recipient_ids: [READER] },
    );
    expect(f.verifyActiveSession).toHaveBeenCalledTimes(1);
  });
  it("confirms only the exact proof and returns no quote in the write response", async () => {
    const f = fixture();
    f.services.confirmMemorySharing.mockResolvedValueOnce({
      response: { status: 200, body: { shared: true, id: MEMORY } },
      replayed: true,
    });
    const response = await f.request(CONFIRM, CHOICE);
    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    expect(await response.json()).toEqual({ shared: true, id: MEMORY });
    expect(f.services.confirmMemorySharing).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      "synthetic-request",
      FAMILY,
      CHOICE,
    );
  });
  it.each([false, undefined])(
    "keeps reads and stop available with processing %j but hides new sharing",
    async (enabled) => {
      const f = fixture();
      f.config.richMemories = enabled;
      expect((await f.request(VIEW)).status).toBe(200);
      expect((await f.request(PREVIEW)).status).toBe(200);
      expect((await f.request(SHARED)).status).toBe(200);
      expect((await f.request(STOP, {})).status).toBe(200);
      expect(f.services.stopSharingMemory).toHaveBeenCalledWith(
        expect.objectContaining({ config: f.config }),
        IDENTITY,
        "synthetic-request",
        FAMILY,
        MEMORY,
      );
      expect((await f.request(PREPARE, { recipient_ids: [READER] })).status).toBe(404);
      expect((await f.request(CONFIRM, CHOICE)).status).toBe(404);
      expect(f.services.createMemorySharingPresentation).not.toHaveBeenCalled();
      expect(f.services.confirmMemorySharing).not.toHaveBeenCalled();
    },
  );
  it("allows author revocation even when closed-trial admission is no longer granted", async () => {
    const f = fixture();
    const permitsAccount = vi.fn().mockResolvedValue(false);
    f.runtime.admission = { config: { telegramUserIds: ["synthetic"] }, permitsAccount };
    expect((await f.request(VIEW)).status).toBe(404);
    permitsAccount.mockClear();
    expect((await f.request(STOP, {})).status).toBe(200);
    expect(permitsAccount).not.toHaveBeenCalled();
    f.services.stopSharingMemory.mockRejectedValueOnce(new VelaError("not_found", WORDS));
    expect((await f.request(STOP, {})).status).toBe(404);
  });
  it.each([PREPARE, CONFIRM, STOP])(
    "rejects inactive sessions before database work at %s",
    async (path) => {
      const f = fixture();
      f.verifyActiveSession.mockResolvedValue(false);
      expect(
        (
          await f.request(
            path,
            path === PREPARE ? { recipient_ids: [READER] } : path === CONFIRM ? CHOICE : {},
          )
        ).status,
      ).toBe(401);
      expect(f.openDatabase).not.toHaveBeenCalled();
    },
  );
  it.each([
    [PREPARE, { recipient_ids: [READER, READER] }],
    [PREPARE, { recipient_ids: [] }],
    [PREPARE, { recipient_ids: [READER], author_id: OWNER }],
    [CONFIRM, { ...CHOICE, quote: WORDS }],
    [STOP, { author_id: OWNER }],
  ])("rejects untrusted bodies for %s", async (path, body) => {
    const f = fixture();
    expect((await f.request(path as string, body)).status).toBe(400);
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.verifyActiveSession).not.toHaveBeenCalled();
  });
  it("requires write keys and bounded JSON without content encoding", async () => {
    const f = fixture();
    expect((await f.request(STOP, {}, { "idempotency-key": "" })).status).toBe(400);
    expect((await f.request(STOP, {}, { "content-type": "text/plain" })).status).toBe(415);
    expect((await f.request(STOP, {}, { "content-encoding": "gzip" })).status).toBe(415);
    expect((await f.request(STOP, { padding: "x".repeat(20000) })).status).toBe(413);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
  it("maps stale state and idempotency conflicts to safe409 responses", async () => {
    const f = fixture();
    f.services.confirmMemorySharing.mockRejectedValueOnce(new VelaError("illegal_state", WORDS));
    const stale = await f.request(CONFIRM, CHOICE);
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe("conflict");
    f.services.stopSharingMemory.mockRejectedValueOnce(new ApiIdempotencyError("conflict"));
    expect((await f.request(STOP, {})).status).toBe(409);
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain(WORDS);
    expect(f.close).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed route IDs before database work", async () => {
    const f = fixture();
    expect((await f.request(VIEW.replace(MEMORY, "invalid"))).status).toBe(400);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
  it("does not emit unexpected outputs or log quote-bearing errors", async () => {
    const f = fixture();
    f.services.loadSharedKeptMemories.mockResolvedValueOnce({
      items: [],
      next_cursor: null,
      quote: WORDS,
    } as never);
    const bad = await f.request(SHARED);
    expect(bad.status).toBe(500);
    expect(await code(bad)).toBe("internal");
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain(WORDS);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("leaves reads available but writes absent without write-session verification", async () => {
    const f = fixture(true, false);
    expect((await f.request(VIEW)).status).toBe(200);
    expect((await f.request(STOP, {})).status).toBe(404);
  });
});
