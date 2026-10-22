import {
  MEMORY_KEEP_VERSION,
  MEMORY_PERMISSION_NOTICE_VERSION,
  MEMORY_PERMISSION_TEXT_EN,
  MEMORY_PERMISSION_VERSION,
} from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";
import { type SessionIdentity, VelaError } from "@vela/services";
import { describe, expect, it, vi } from "vitest";
import { type ApiRuntime, createApiApp } from "./api-app.ts";
import { API_READ_SERVICES, API_WRITE_SERVICES } from "./api-runtime.ts";

const FAMILY = "abcdefab-0000-4000-8000-000000000001",
  MEMORY = "abcdefab-0000-4000-8000-000000000002",
  CANDIDATE = "abcdefab-0000-4000-8000-000000000003",
  PRESENTATION = "abcdefab-0000-4000-8000-000000000005";
const IDENTITY: SessionIdentity = { authSubject: "synthetic|memory-author", sessionId: "s" };
const BASE = `/v1/families/${FAMILY}`;
const SHA = "b".repeat(64);
const ANSWER = {
  presentation_id: PRESENTATION,
  answer: "yes",
  text_version: MEMORY_PERMISSION_VERSION,
  text_sha256: SHA,
};
const KEEP = {
  candidate_id: CANDIDATE,
  confirmation_version: MEMORY_KEEP_VERSION,
  confirmation_sha256: SHA,
};
const ok = (body: Record<string, string | boolean>) => ({
  response: { status: 200 as const, body },
  replayed: false,
});

function fixture(enabled = true) {
  type Services = NonNullable<ApiRuntime["memories"]>["services"];
  const services = {
    loadMemoryPermission: vi
      .fn<Services["loadMemoryPermission"]>()
      .mockResolvedValue({ state: "none", outdated: false }),
    loadMemoryPermissionPresentation: vi
      .fn<Services["loadMemoryPermissionPresentation"]>()
      .mockResolvedValue({
        presentation_id: PRESENTATION,
        text_version: MEMORY_PERMISSION_VERSION,
        notice_version: MEMORY_PERMISSION_NOTICE_VERSION,
        lang: "en",
        text: MEMORY_PERMISSION_TEXT_EN,
        text_sha256: SHA,
        expires_at: "2026-10-22T00:05:00.000Z",
      }),
    prepareMemoryPermission: vi
      .fn<Services["prepareMemoryPermission"]>()
      .mockResolvedValue(ok({ id: PRESENTATION })),
    answerMemoryPermission: vi
      .fn<Services["answerMemoryPermission"]>()
      .mockResolvedValue(ok({ answer: "yes" })),
    withdrawOwnMemoryConsent: vi
      .fn<Services["withdrawOwnMemoryConsent"]>()
      .mockResolvedValue(ok({ withdrawn: true })),
    loadMemoryCandidates: vi
      .fn<Services["loadMemoryCandidates"]>()
      .mockResolvedValue({ items: [], next_cursor: null }),
    dismissMemoryCandidate: vi
      .fn<Services["dismissMemoryCandidate"]>()
      .mockResolvedValue(ok({ dismissed: true })),
    keepMemoryCandidate: vi
      .fn<Services["keepMemoryCandidate"]>()
      .mockResolvedValue(ok({ kept: true, id: MEMORY })),
    loadKeptMemories: vi
      .fn<Services["loadKeptMemories"]>()
      .mockResolvedValue({ items: [], next_cursor: null }),
    removeKeptMemory: vi
      .fn<Services["removeKeptMemory"]>()
      .mockResolvedValue(ok({ removed: true })),
  };
  const config = { richMemories: true } as NonNullable<ApiRuntime["memories"]>["config"];
  const verifySession = vi.fn<ApiRuntime["verifySession"]>().mockResolvedValue(IDENTITY);
  const runtime: ApiRuntime = {
    verifySession,
    now: () => new Date("2026-10-22T00:00:00Z"),
    openDatabase: vi.fn(async () => ({ db: {} as VelaDatabase, close: async () => {} })),
    services: API_READ_SERVICES,
    logger: { error: vi.fn() },
    ...(enabled ? { memories: { config, services } } : {}),
    writes: {
      clock: { now: () => new Date("2026-10-22T00:00:00Z") },
      verifyActiveSession: vi.fn().mockResolvedValue(true),
      services: API_WRITE_SERVICES,
    },
  };
  const request = (path: string, body?: unknown) =>
    createApiApp(runtime).request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer synthetic",
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", "idempotency-key": "synthetic-request" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { services, config, request, verifySession };
}

const ROUTES = [
  [`${BASE}/memory-permission`, undefined],
  [`${BASE}/memory-permission-presentations/${PRESENTATION}`, undefined],
  [`${BASE}/memory-suggestions`, undefined],
  [`${BASE}/memories`, undefined],
  [`${BASE}/memory-permission/presentations`, { lang: "en" }],
  [`${BASE}/memory-permission/answer`, ANSWER],
  [`${BASE}/memory-permission/withdraw`, {}],
  [`${BASE}/memory-suggestions/${CANDIDATE}/dismiss`, {}],
  [`${BASE}/memories/keep`, KEEP],
  [`${BASE}/memories/${MEMORY}/remove`, {}],
] as const;

describe("optional author memory routes", () => {
  it("does not exist at all in a runtime without the memories group", async () => {
    const f = fixture(false);
    for (const [path, body] of ROUTES) expect((await f.request(path, body)).status).toBe(404);
  });

  it("requires a signed-in session on every route", async () => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    for (const [path, body] of ROUTES) expect((await f.request(path, body)).status).toBe(401);
  });

  it("serves every route to the signed-in author with canonical ids", async () => {
    const f = fixture();
    for (const [path, body] of ROUTES) expect((await f.request(path, body)).status).toBe(200);
    const upper = await f.request(
      `${BASE.toUpperCase().replace("/V1/FAMILIES", "/v1/families")}/memories/keep`,
      {
        ...KEEP,
        candidate_id: CANDIDATE.toUpperCase(),
      },
    );
    expect(upper.status).toBe(200);
    expect(f.services.keepMemoryCandidate.mock.calls.at(-1)?.slice(1)).toEqual([
      IDENTITY,
      "synthetic-request",
      FAMILY,
      KEEP,
    ]);
  });

  it("closes new processing when the switch is off but keeps removal and withdrawal", async () => {
    const f = fixture();
    f.config.richMemories = false;
    const open = new Set([
      `${BASE}/memory-permission/withdraw`,
      `${BASE}/memory-suggestions/${CANDIDATE}/dismiss`,
      `${BASE}/memories/${MEMORY}/remove`,
    ]);
    for (const [path, body] of ROUTES.filter(([, b]) => b !== undefined))
      expect((await f.request(path, body)).status).toBe(open.has(path) ? 200 : 404);
    expect(f.services.prepareMemoryPermission).not.toHaveBeenCalled();
    expect(f.services.answerMemoryPermission).not.toHaveBeenCalled();
    expect(f.services.keepMemoryCandidate).not.toHaveBeenCalled();
  });

  it("answers 404 when the service finds nothing and 409 for a stale choice", async () => {
    const f = fixture();
    f.services.loadMemoryPermission.mockResolvedValueOnce(null);
    expect((await f.request(`${BASE}/memory-permission`)).status).toBe(404);
    f.services.answerMemoryPermission.mockRejectedValueOnce(
      new VelaError("illegal_state", "synthetic private detail"),
    );
    const stale = await f.request(`${BASE}/memory-permission/answer`, ANSWER);
    expect(stale.status).toBe(409);
    expect(JSON.stringify(await stale.json())).not.toContain("synthetic private detail");
  });

  it("refuses malformed bodies and cursors before any database work", async () => {
    const f = fixture();
    expect(
      (await f.request(`${BASE}/memory-permission/answer`, { ...ANSWER, answer: "maybe" })).status,
    ).toBe(400);
    expect(
      (await f.request(`${BASE}/memory-permission/presentations`, { lang: "fr" })).status,
    ).toBe(400);
    expect((await f.request(`${BASE}/memories?cursor=not-an-id`)).status).toBe(400);
    expect((await f.request(`${BASE}/memories/not-an-id/remove`, {})).status).toBe(400);
    expect(f.services.answerMemoryPermission).not.toHaveBeenCalled();
    expect(f.services.loadKeptMemories).not.toHaveBeenCalled();
  });

  it("refuses a server reply that does not match the contract", async () => {
    const f = fixture();
    f.services.loadMemoryPermissionPresentation.mockResolvedValueOnce({
      presentation_id: PRESENTATION,
      text_version: MEMORY_PERMISSION_VERSION,
      notice_version: MEMORY_PERMISSION_NOTICE_VERSION,
      lang: "en",
      text: "Different words than the reviewed question",
      text_sha256: SHA,
      expires_at: "2026-10-22T00:05:00.000Z",
    } as never);
    expect(
      (await f.request(`${BASE}/memory-permission-presentations/${PRESENTATION}`)).status,
    ).toBe(500);
  });
});
