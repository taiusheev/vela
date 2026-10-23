import {
  PUBLIC_ELIGIBILITY_TERMS_VERSION,
  PUBLIC_ELIGIBILITY_VERSION,
  type PublicEligibilityRecord,
} from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";
import { ApiIdempotencyError, type SessionIdentity, VelaError } from "@vela/services";
import { describe, expect, it, vi } from "vitest";
import { type ApiRuntime, createApiApp } from "./api-app.ts";
import { API_READ_SERVICES, API_WRITE_SERVICES } from "./api-runtime.ts";

const VIEW = "/v1/me/eligibility";
const CLEAR = `${VIEW}/clear`;
const IDENTITY: SessionIdentity = { authSubject: "synthetic-user", sessionId: "synthetic-session" };
const RECORD: PublicEligibilityRecord = {
  version: PUBLIC_ELIGIBILITY_VERSION,
  terms_version: PUBLIC_ELIGIBILITY_TERMS_VERSION,
  language: "en" as const,
  adult_self_declared: true as const,
  residence_self_declared: "TW" as const,
  notice_read: true as const,
  review_terms_acknowledged: true as const,
  source: "app_account" as const,
  actor_sha256: "a".repeat(64),
  recorded_at: "2026-10-23T00:00:00.000Z",
  notice_sha256: "b".repeat(64),
  terms_sha256: "c".repeat(64),
  status: "review_only" as const,
};
function fixture(enabled = true, writable = true) {
  type Rights = NonNullable<ApiRuntime["eligibilityRights"]>;
  const rights = {
    load: vi.fn<Rights["load"]>().mockResolvedValue(RECORD),
    clear: vi.fn<Rights["clear"]>().mockResolvedValue({
      response: { status: 200, body: { cleared: true } },
      replayed: false,
    }),
  };
  const db = {} as VelaDatabase;
  const close = vi.fn(async () => {});
  const openDatabase = vi.fn(async () => ({ db, close }));
  const verifySession = vi.fn<ApiRuntime["verifySession"]>().mockResolvedValue(IDENTITY);
  const verifyActiveSession = vi
    .fn<NonNullable<ApiRuntime["writes"]>["verifyActiveSession"]>()
    .mockResolvedValue(true);
  const logger = { error: vi.fn() };
  const clock = { now: () => new Date("2026-10-23T00:00:00Z") };
  const runtime: ApiRuntime = {
    verifySession,
    openDatabase,
    logger,
    now: clock.now,
    services: API_READ_SERVICES,
    ...(enabled ? { eligibilityRights: rights } : {}),
    ...(writable ? { writes: { clock, verifyActiveSession, services: API_WRITE_SERVICES } } : {}),
  };
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    createApiApp(runtime).request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer synthetic",
        ...(body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "idempotency-key": "synthetic-clear-request",
            }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    runtime,
    rights,
    db,
    close,
    openDatabase,
    verifySession,
    verifyActiveSession,
    logger,
    clock,
    request,
  };
}

describe("own eligibility rights HTTP, never public admission", () => {
  it.each([
    [VIEW, undefined],
    [CLEAR, {}],
  ] as const)("is absent without rights: %s", async (path, body) => {
    const f = fixture(false);
    const r = await f.request(path, body);
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
  it.each([
    [VIEW, undefined],
    [CLEAR, {}],
  ] as const)("authenticates before opening the database: %s", async (path, body) => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    const r = await f.request(path, body);
    expect(r.status).toBe(401);
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("reads only from the verified app actor, ignoring query identities", async () => {
    const f = fixture();
    const r = await f.request(`${VIEW}?user_id=other&member_id=other`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ record: RECORD });
    expect(f.rights.load).toHaveBeenCalledExactlyOnceWith(
      { db: f.db },
      { kind: "app", identity: IDENTITY },
    );
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("returns null for no current record, without declaring eligibility", async () => {
    const f = fixture();
    f.rights.load.mockResolvedValue(null);
    const r = await f.request(VIEW);
    expect(await r.json()).toEqual({ record: null });
  });
  it("clears with the server identity, clock and validated retry key", async () => {
    const f = fixture();
    const r = await f.request(CLEAR, {});
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ cleared: true });
    expect(f.rights.clear).toHaveBeenCalledExactlyOnceWith(
      { db: f.db, clock: f.clock },
      { kind: "app", identity: IDENTITY },
      "synthetic-clear-request",
    );
    expect(r.headers.get("idempotency-replayed")).toBe("false");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("reports safe idempotent replay", async () => {
    const f = fixture();
    f.rights.clear.mockResolvedValue({
      response: { status: 200, body: { cleared: true } },
      replayed: true,
    });
    const r = await f.request(CLEAR, {});
    expect(r.headers.get("idempotency-replayed")).toBe("true");
  });
  it.each([
    { user_id: "other" },
    { member_id: "other" },
    { adult_self_declared: true },
    { clear: true },
  ])("rejects extra clear input %j before database access", async (body) => {
    const f = fixture();
    const r = await f.request(CLEAR, body);
    expect(r.status).toBe(400);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
  it("requires a valid retry key and JSON content type", async () => {
    const f = fixture();
    expect((await f.request(CLEAR, {}, { "idempotency-key": "" })).status).toBe(400);
    expect((await f.request(CLEAR, {}, { "content-type": "text/plain" })).status).toBe(415);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
  it("rejects inactive sessions before clearing", async () => {
    const f = fixture();
    f.verifyActiveSession.mockResolvedValue(false);
    expect((await f.request(CLEAR, {})).status).toBe(401);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
  it("keeps read available without a write runtime", async () => {
    const f = fixture(true, false);
    expect((await f.request(VIEW)).status).toBe(200);
    expect((await f.request(CLEAR, {})).status).toBe(404);
    expect(f.rights.clear).not.toHaveBeenCalled();
  });
  it.each([
    [VIEW, undefined],
    [CLEAR, {}],
  ] as const)("does not consult the admission roster for rights: %s", async (path, body) => {
    const f = fixture();
    const permitsAccount = vi.fn().mockResolvedValue(false);
    const withRoster = vi.fn().mockRejectedValue(new Error("roster unavailable"));
    f.runtime.admission = { config: { telegramUserIds: [] }, permitsAccount, withRoster };
    expect((await f.request(path, body)).status).toBe(200);
    expect(permitsAccount).not.toHaveBeenCalled();
    expect(withRoster).not.toHaveBeenCalled();
  });
  it("does not extend the rights exemption to account or family access", async () => {
    const f = fixture();
    const permitsAccount = vi.fn().mockResolvedValue(false);
    f.runtime.admission = { config: { telegramUserIds: [] }, permitsAccount };
    expect((await f.request("/v1/me")).status).toBe(404);
    expect(permitsAccount).toHaveBeenCalledOnce();
  });
  it.each([
    [VIEW, undefined],
    [CLEAR, {}],
  ] as const)(
    "maps missing or deleted accounts without disclosing details: %s",
    async (path, body) => {
      const f = fixture();
      const error = new VelaError("not_found", "private synthetic detail");
      f.rights.load.mockRejectedValue(error);
      f.rights.clear.mockRejectedValue(error);
      const r = await f.request(path, body);
      expect(r.status).toBe(404);
      expect(JSON.stringify(await r.json())).not.toContain("private");
      expect(f.logger.error).not.toHaveBeenCalled();
      expect(f.close).toHaveBeenCalledOnce();
    },
  );
  it("maps clear key conflicts safely", async () => {
    const f = fixture();
    f.rights.clear.mockRejectedValue(new ApiIdempotencyError("conflict"));
    expect((await f.request(CLEAR, {})).status).toBe(409);
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("validates service responses and never logs declaration contents", async () => {
    const f = fixture();
    f.rights.load.mockResolvedValue({
      ...RECORD,
      language: "invalid-private-detail",
    } as unknown as typeof RECORD);
    const r = await f.request(VIEW);
    expect(r.status).toBe(500);
    expect(JSON.stringify([await r.json(), f.logger.error.mock.calls])).not.toContain(
      "invalid-private-detail",
    );
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("never registers a collection endpoint or another person's selector", async () => {
    const f = fixture();
    for (const path of [
      VIEW,
      `${VIEW}/record`,
      "/v1/users/other/eligibility",
      "/v1/members/other/eligibility",
    ]) {
      expect((await f.request(path, {})).status).toBe(404);
    }
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});
