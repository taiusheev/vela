import type { ApiFamilyPlan, ApiMe, MemberLight } from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";
import { ApiIdempotencyError, type SessionIdentity, VelaError } from "@vela/services";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApiReadServices, type ApiRuntime, createApiApp } from "./api-app.ts";
import { SessionVerificationUnavailable } from "./session.ts";

const USER_ID = "11111111-1111-7111-8111-111111111111";
const MEMBER_ID = "22222222-2222-7222-8222-222222222222";
const FAMILY_ID = "33333333-3333-7333-8333-333333333333";
const IDENTITY: SessionIdentity = { authSubject: "verified-user", sessionId: "verified-session" };
const PLAN_PATH = `/v1/families/${FAMILY_ID}/plan`;
const LIGHTS_PATH = `/v1/families/${FAMILY_ID}/lights`;
const ME: ApiMe = {
  user: { id: USER_ID, display_name: "Synthetic user", language: "en", tz: "Asia/Taipei" },
  memberships: [
    {
      member_id: MEMBER_ID,
      role: "member",
      status: "active",
      family: { id: FAMILY_ID, name: "Synthetic family", region: "apac", plan: "light" },
    },
  ],
};
const PLAN: ApiFamilyPlan = {
  family_id: FAMILY_ID,
  plan: "light",
  subscriptions: [
    {
      member_id: MEMBER_ID,
      status: "trial",
      trial_ends_at: "2026-09-14T00:00:00.000Z",
      current_period_end: null,
      grace_until: null,
    },
  ],
};
const LIGHTS: MemberLight[] = [
  {
    member_id: MEMBER_ID,
    display_name: "Synthetic member",
    state: "lit",
    answered_at: "2026-09-22T00:12:00.000Z",
    usual_time: "08:00",
    away_until: null,
    quiet_event_id: null,
  },
];
const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };
const FAMILY_NOT_FOUND = { error: { code: "not_found", message: "Family not found." } };
const INTERNAL = { error: { code: "internal", message: "Internal server error." } };
const UNAVAILABLE = {
  error: { code: "unavailable", message: "Service temporarily unavailable." },
};

function database(): VelaDatabase {
  return {} as VelaDatabase;
}

function fixture(enableWrites = false) {
  const db = database();
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const verifySession = vi.fn<ApiRuntime["verifySession"]>().mockResolvedValue(IDENTITY);
  const openDatabase = vi.fn<ApiRuntime["openDatabase"]>().mockResolvedValue({ db, close });
  const services = {
    loadApiMe: vi.fn<ApiReadServices["loadApiMe"]>().mockResolvedValue(ME),
    loadApiFamilyPlan: vi.fn<ApiReadServices["loadApiFamilyPlan"]>().mockResolvedValue(PLAN),
    loadApiLights: vi.fn<ApiReadServices["loadApiLights"]>().mockResolvedValue(LIGHTS),
    authorizeFamilyAccess: vi.fn<ApiReadServices["authorizeFamilyAccess"]>().mockResolvedValue({
      kind: "granted",
      access: { userId: USER_ID, memberId: MEMBER_ID, familyId: FAMILY_ID, role: "member" },
    }),
  };
  const logger = { error: vi.fn<ApiRuntime["logger"]["error"]>() };
  const writes = {
    verifyActiveSession: vi
      .fn<NonNullable<ApiRuntime["writes"]>["verifyActiveSession"]>()
      .mockResolvedValue(true),
    clock: { now: () => new Date("2026-09-22T00:00:00.000Z") },
    services: {
      provisionApiAccount: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["provisionApiAccount"]>()
        .mockResolvedValue({ response: { status: 200, body: ME.user }, replayed: false }),
      updateApiAccount: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["updateApiAccount"]>()
        .mockResolvedValue({ response: { status: 200, body: ME.user }, replayed: false }),
    },
  };
  const runtime: ApiRuntime = {
    verifySession,
    now: () => new Date("2026-09-22T00:00:00.000Z"),
    openDatabase,
    services,
    logger,
    ...(enableWrites ? { writes } : {}),
  };
  return {
    app: createApiApp(runtime),
    db,
    close,
    verifySession,
    openDatabase,
    services,
    logger,
    writes,
  };
}

async function expectResponse(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual(body);
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isolated API read routes", () => {
  it.each(["/v1/me", PLAN_PATH])("authenticates %s before opening a database", async (path) => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    const response = await f.app.request(path, {
      headers: { authorization: "Bearer invalid.secret.token", "x-user-id": USER_ID },
    });

    await expectResponse(response, 401, {
      error: { code: "unauthenticated", message: "Sign in required." },
    });
    expect(f.verifySession).toHaveBeenCalledOnce();
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
    expect(f.services.loadApiMe).not.toHaveBeenCalled();
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it.each(["/v1/me", PLAN_PATH])(
    "maps a session outage on %s before database creation",
    async (path) => {
      const f = fixture();
      f.verifySession.mockRejectedValue(new SessionVerificationUnavailable());

      await expectResponse(await f.app.request(path), 503, UNAVAILABLE);
      expect(f.openDatabase).not.toHaveBeenCalled();
      expect(f.close).not.toHaveBeenCalled();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
        error: "SessionVerificationUnavailable",
      });
    },
  );

  it("passes only the verified identity to the me service", async () => {
    const f = fixture();
    const request = new Request("https://api.test/v1/me?userId=forged&authSubject=forged", {
      headers: {
        authorization: "Bearer signed.token.value",
        "x-user-id": "forged",
        "x-role": "organiser",
      },
    });

    await expectResponse(await f.app.request(request), 200, ME);
    expect(f.verifySession).toHaveBeenCalledExactlyOnceWith(request);
    expect(f.openDatabase).toHaveBeenCalledExactlyOnceWith();
    expect(f.services.loadApiMe).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY);
    expect(f.services.loadApiMe.mock.calls[0]?.[1]).toBe(IDENTITY);
    expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledExactlyOnceWith();
  });

  it("authorizes and reads the path family with the signed identity, not forged request claims", async () => {
    const f = fixture();
    const response = await f.app.request(
      `${PLAN_PATH}?familyId=forged-family&userId=forged-user&authSubject=forged&role=organiser&requiredRole=organiser`,
      {
        headers: {
          "x-family-id": "forged-family",
          "x-user-id": "forged-user",
          "x-auth-subject": "forged-subject",
          "x-session-id": "forged-session",
          "x-role": "organiser",
        },
      },
    );

    await expectResponse(response, 200, PLAN);
    expect(f.services.authorizeFamilyAccess).toHaveBeenCalledExactlyOnceWith(
      f.db,
      IDENTITY,
      FAMILY_ID,
      undefined,
    );
    expect(f.services.loadApiFamilyPlan).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY, FAMILY_ID);
    expect(f.services.loadApiFamilyPlan.mock.calls[0]?.[1]).toBe(IDENTITY);
    expect(f.openDatabase).toHaveBeenCalledExactlyOnceWith();
    expect(f.close).toHaveBeenCalledExactlyOnceWith();
    expect(f.services.loadApiMe).not.toHaveBeenCalled();
  });

  it.each(["/v1/me", PLAN_PATH])("does not consult request JSON for GET %s", async (path) => {
    const f = fixture();
    const request = new Request(`https://api.test${path}`);
    const readJson = vi.spyOn(request, "json").mockResolvedValue({
      authSubject: "forged-user",
      session: { authSubject: "forged-user", sessionId: "forged-session" },
      userId: "forged-user-id",
      familyId: "forged-family",
      role: "organiser",
    });

    await expectResponse(await f.app.request(request), 200, path === "/v1/me" ? ME : PLAN);
    expect(readJson).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    if (path === "/v1/me") {
      expect(f.services.loadApiMe).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY);
    } else {
      expect(f.services.authorizeFamilyAccess).toHaveBeenCalledExactlyOnceWith(
        f.db,
        IDENTITY,
        FAMILY_ID,
        undefined,
      );
      expect(f.services.loadApiFamilyPlan).toHaveBeenCalledExactlyOnceWith(
        f.db,
        IDENTITY,
        FAMILY_ID,
      );
    }
    expect(f.close).toHaveBeenCalledOnce();
  });

  it.each(["not_found", "forbidden"] as const)(
    "a %s family guard skips the read and closes its handle",
    async (kind) => {
      const f = fixture();
      f.services.authorizeFamilyAccess.mockResolvedValue({ kind });

      await expectResponse(
        await f.app.request(PLAN_PATH),
        kind === "not_found" ? 404 : 403,
        kind === "not_found"
          ? FAMILY_NOT_FOUND
          : { error: { code: "forbidden", message: "Access denied." } },
      );
      expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
      expect(f.openDatabase).toHaveBeenCalledOnce();
      expect(f.close).toHaveBeenCalledOnce();
    },
  );

  it("returns the same not-found body when membership is revoked after the guard", async () => {
    const f = fixture();
    f.services.authorizeFamilyAccess.mockResolvedValueOnce({ kind: "not_found" });
    const denied = await f.app.request(PLAN_PATH);
    f.services.loadApiFamilyPlan.mockResolvedValue(null);
    const revoked = await f.app.request(PLAN_PATH);

    await expectResponse(denied, 404, FAMILY_NOT_FOUND);
    await expectResponse(revoked, 404, FAMILY_NOT_FOUND);
    expect(f.services.loadApiFamilyPlan).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY, FAMILY_ID);
    expect(f.openDatabase).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalledTimes(2);
  });

  it("lets the family service refuse malformed IDs without attempting a read", async () => {
    const f = fixture();
    f.services.authorizeFamilyAccess.mockResolvedValue({ kind: "not_found" });

    await expectResponse(
      await f.app.request("/v1/families/not-a-uuid/plan"),
      404,
      FAMILY_NOT_FOUND,
    );
    expect(f.services.authorizeFamilyAccess).toHaveBeenCalledExactlyOnceWith(
      f.db,
      IDENTITY,
      "not-a-uuid",
      undefined,
    );
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("returns not found for an unprovisioned user without provisioning on GET", async () => {
    const f = fixture();
    f.services.loadApiMe.mockResolvedValue(null);

    await expectResponse(await f.app.request("/v1/me"), 404, NOT_FOUND);
    expect(f.services.loadApiMe).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY);
    expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("projects me fields at every DTO level", async () => {
    const f = fixture();
    const membership = ME.memberships[0];
    if (!membership) throw new Error("Missing synthetic membership");
    const privateResult = {
      ...ME,
      authSubject: "private-subject",
      user: { ...ME.user, authSubject: "private-subject", phone: "+15550000000" },
      memberships: [
        { ...membership, billing: true, family: { ...membership.family, internal: "private" } },
      ],
    };
    f.services.loadApiMe.mockResolvedValue(privateResult);

    await expectResponse(await f.app.request("/v1/me"), 200, ME);
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("projects plan and subscription fields without billing identifiers", async () => {
    const f = fixture();
    const subscription = PLAN.subscriptions[0];
    if (!subscription) throw new Error("Missing synthetic subscription");
    const privateResult = {
      ...PLAN,
      billing_customer_id: "private-customer",
      subscriptions: [
        {
          ...subscription,
          billing_subscription_id: "private-subscription",
          phone: "+15550000000",
          internal: "private",
        },
      ],
    };
    f.services.loadApiFamilyPlan.mockResolvedValue(privateResult);

    await expectResponse(await f.app.request(PLAN_PATH), 200, PLAN);
    expect(f.close).toHaveBeenCalledOnce();
  });

  it.each(["/v1/me", PLAN_PATH])(
    "treats invalid service output on %s as a server error, not a client error",
    async (path) => {
      const f = fixture();
      f.services.loadApiMe.mockResolvedValue({ ...ME, user: { ...ME.user, id: "invalid" } });
      f.services.loadApiFamilyPlan.mockResolvedValue({ ...PLAN, family_id: "invalid" });

      await expectResponse(await f.app.request(path), 500, INTERNAL);
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
        error: "ZodError",
      });
    },
  );

  it.each(["verify", "open", "authorize", "me", "plan"] as const)(
    "sanitizes %s failures and closes exactly once if opened",
    async (stage) => {
      const f = fixture();
      const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );
      const secret = "secret.token.private-family-prose";
      const error = new Error(`Failed request ${PLAN_PATH} ${secret}`, {
        cause: new Error(secret),
      });
      const fail = {
        verify: f.verifySession,
        open: f.openDatabase,
        authorize: f.services.authorizeFamilyAccess,
        me: f.services.loadApiMe,
        plan: f.services.loadApiFamilyPlan,
      }[stage];
      fail.mockRejectedValue(error);
      const path = stage === "me" ? "/v1/me" : PLAN_PATH;

      await expectResponse(
        await f.app.request(`${path}?private=${secret}`, {
          headers: { authorization: `Bearer ${secret}`, "x-private": secret },
        }),
        500,
        INTERNAL,
      );
      expect(f.close).toHaveBeenCalledTimes(stage === "verify" || stage === "open" ? 0 : 1);
      expect(f.openDatabase).toHaveBeenCalledTimes(stage === "verify" ? 0 : 1);
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
        error: "Error <- Error",
      });
      const logs = JSON.stringify(f.logger.error.mock.calls);
      expect(logs).not.toContain(secret);
      expect(logs).not.toContain(path);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["success", 200, ME],
    ["not_found", 404, NOT_FOUND],
    ["denied", 404, FAMILY_NOT_FOUND],
    ["internal", 500, INTERNAL],
    ["unavailable", 503, UNAVAILABLE],
  ] as const)(
    "logs a cleanup failure without changing the original %s response",
    async (outcome, status, body) => {
      const f = fixture();
      f.close.mockRejectedValue(new Error("private cleanup detail"));
      if (outcome === "not_found") f.services.loadApiMe.mockResolvedValue(null);
      if (outcome === "denied")
        f.services.authorizeFamilyAccess.mockResolvedValue({ kind: "not_found" });
      if (outcome === "internal")
        f.services.loadApiMe.mockRejectedValue(new Error("private query detail"));
      if (outcome === "unavailable")
        f.services.loadApiMe.mockRejectedValue(new SessionVerificationUnavailable());
      const response = await f.app.request(outcome === "denied" ? PLAN_PATH : "/v1/me");
      await expectResponse(response, status, body);
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.logger.error).toHaveBeenCalledWith("api_database_close_failed", { error: "Error" });
      expect(f.logger.error).toHaveBeenCalledTimes(
        outcome === "internal" || outcome === "unavailable" ? 2 : 1,
      );
      expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain("private");
    },
  );

  it("awaits closing the handle before resolving the response", async () => {
    const f = fixture();
    const closing = deferred();
    const release = deferred();
    f.close.mockImplementation(async () => {
      closing.resolve();
      await release.promise;
    });
    let settled = false;
    const response = Promise.resolve(f.app.request("/v1/me")).then((value) => {
      settled = true;
      return value;
    });
    await closing.promise;
    expect(settled).toBe(false);
    release.resolve();

    await expectResponse(await response, 200, ME);
    expect(f.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["GET", "/"],
    ["GET", "/v1/unknown"],
    ["GET", "/v1/families"],
    ["GET", "/v1/families/id"],
    ["GET", "/v1/families/id/plan/extra"],
    ["POST", "/v1/me"],
    ["POST", "/v1/me/provision"],
    ["PATCH", "/v1/me"],
    ["PUT", "/v1/me"],
    ["PATCH", PLAN_PATH],
    ["DELETE", PLAN_PATH],
    ["OPTIONS", PLAN_PATH],
    ["POST", "/v1/users"],
    ["POST", "/v1/families"],
  ])("does not authenticate or open a database for unsupported %s %s", async (method, path) => {
    const f = fixture();
    const response = await f.app.request(path, {
      method,
      ...(method === "GET"
        ? {}
        : {
            headers: { "content-type": "application/json", "x-role": "organiser" },
            body: JSON.stringify({
              userId: USER_ID,
              authSubject: "forged",
              familyId: FAMILY_ID,
              role: "organiser",
            }),
          }),
    });

    await expectResponse(response, 404, NOT_FOUND);
    expect(f.verifySession).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.services.loadApiMe).not.toHaveBeenCalled();
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
  });

  it.each(["/v1/me", PLAN_PATH])(
    "rejects HEAD %s without Hono's implicit GET opening a database",
    async (path) => {
      const f = fixture();
      const response = await f.app.request(path, { method: "HEAD" });

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
      expect(f.verifySession).not.toHaveBeenCalled();
      expect(f.openDatabase).not.toHaveBeenCalled();
    },
  );

  it("keeps concurrent family requests on independent handles and verified identities", async () => {
    const f = fixture();
    const otherDb = database();
    const otherClose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const otherIdentity: SessionIdentity = {
      authSubject: "other-verified-user",
      sessionId: "other-session",
    };
    const otherFamily = "44444444-4444-7444-8444-444444444444";
    const firstAuthorized = deferred();
    const releaseFirst = deferred();
    f.verifySession.mockResolvedValueOnce(IDENTITY).mockResolvedValueOnce(otherIdentity);
    f.openDatabase
      .mockResolvedValueOnce({ db: f.db, close: f.close })
      .mockResolvedValueOnce({ db: otherDb, close: otherClose });
    f.services.authorizeFamilyAccess.mockImplementation(async (db, identity, familyId) => {
      if (identity === IDENTITY) {
        expect(db).toBe(f.db);
        firstAuthorized.resolve();
        await releaseFirst.promise;
      } else {
        expect(db).toBe(otherDb);
      }
      return {
        kind: "granted",
        access: { userId: USER_ID, memberId: MEMBER_ID, familyId, role: "member" },
      };
    });
    f.services.loadApiFamilyPlan.mockImplementation(async (db, identity, familyId) => {
      expect(db).toBe(identity === IDENTITY ? f.db : otherDb);
      return { ...PLAN, family_id: familyId };
    });
    const firstResponse = f.app.request(PLAN_PATH);
    await firstAuthorized.promise;
    await expectResponse(await f.app.request(`/v1/families/${otherFamily}/plan`), 200, {
      ...PLAN,
      family_id: otherFamily,
    });
    expect(otherClose).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    releaseFirst.resolve();
    await expectResponse(await firstResponse, 200, PLAN);

    expect(f.services.authorizeFamilyAccess).toHaveBeenNthCalledWith(
      1,
      f.db,
      IDENTITY,
      FAMILY_ID,
      undefined,
    );
    expect(f.services.authorizeFamilyAccess).toHaveBeenNthCalledWith(
      2,
      otherDb,
      otherIdentity,
      otherFamily,
      undefined,
    );
    expect(f.services.loadApiFamilyPlan).toHaveBeenNthCalledWith(
      1,
      otherDb,
      otherIdentity,
      otherFamily,
    );
    expect(f.services.loadApiFamilyPlan).toHaveBeenNthCalledWith(2, f.db, IDENTITY, FAMILY_ID);
    expect(f.openDatabase).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalledOnce();
    expect(otherClose).toHaveBeenCalledOnce();
  });
});

const PROFILE = { display_name: "Synthetic user", language: "en", tz: "Asia/Taipei" };
const INVALID = { error: { code: "invalid", message: "Invalid request." } };
const CONFLICT = {
  error: { code: "conflict", message: "Request conflicts with an earlier operation." },
};
const UNAUTHENTICATED = { error: { code: "unauthenticated", message: "Sign in required." } };
const WRITE_ROUTES = [
  ["POST", "/v1/me/provision", "provisionApiAccount"],
  ["PATCH", "/v1/me", "updateApiAccount"],
] as const;

function writeRequest(
  method = "POST",
  path = "/v1/me/provision",
  body: BodyInit | null = JSON.stringify(PROFILE),
  headers: Record<string, string> = {},
) {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": "request-1", ...headers },
    body,
  });
}

function expectNoWrite(f: ReturnType<typeof fixture>) {
  expect(f.writes.verifyActiveSession).not.toHaveBeenCalled();
  expect(f.openDatabase).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
  expect(f.writes.services.provisionApiAccount).not.toHaveBeenCalled();
  expect(f.writes.services.updateApiAccount).not.toHaveBeenCalled();
  expect(f.logger.error).not.toHaveBeenCalled();
}

function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });
  return { request: writeRequest("POST", "/v1/me/provision", body, headers), body, cancel };
}

describe("isolated API account writes", () => {
  it.each(WRITE_ROUTES)(
    "dispatches %s %s with only verified actor and parsed input",
    async (method, path, service) => {
      const f = fixture(true);
      const request = writeRequest(
        method,
        `${path}?authSubject=forged&userId=forged`,
        JSON.stringify({ ...PROFILE, display_name: "  Synthetic user  " }),
        {
          "x-user-id": "forged",
          "x-session-id": "forged",
          "x-role": "organiser",
          "content-type": 'Application/JSON; charset="UTF-8"',
          "content-encoding": "identity",
        },
      );
      const json = vi.spyOn(request, "json");
      const text = vi.spyOn(request, "text");
      const response = await f.app.request(request);
      await expectResponse(response, 200, ME.user);
      expect(response.headers.get("idempotency-replayed")).toBe("false");
      expect(f.verifySession).toHaveBeenCalledExactlyOnceWith(request);
      expect(f.writes.verifyActiveSession).toHaveBeenCalledExactlyOnceWith(IDENTITY);
      expect(f.writes.services[service]).toHaveBeenCalledExactlyOnceWith(
        { db: f.db, clock: f.writes.clock },
        IDENTITY,
        "request-1",
        PROFILE,
      );
      expect(f.writes.services[service].mock.calls[0]?.[1]).toBe(IDENTITY);
      expect(f.verifySession.mock.invocationCallOrder[0]).toBeLessThan(
        f.writes.verifyActiveSession.mock.invocationCallOrder[0] ?? 0,
      );
      expect(f.writes.verifyActiveSession.mock.invocationCallOrder[0]).toBeLessThan(
        f.openDatabase.mock.invocationCallOrder[0] ?? 0,
      );
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.services.loadApiMe).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
    },
  );

  it.each(WRITE_ROUTES)("authenticates before validating %s %s", async (method, path) => {
    const f = fixture(true);
    f.verifySession.mockResolvedValue(null);
    await expectResponse(
      await f.app.request(
        writeRequest(method, path, "private invalid json", {
          "idempotency-key": "",
          "content-type": "text/plain",
        }),
      ),
      401,
      UNAUTHENTICATED,
    );
    expectNoWrite(f);
  });

  it.each([
    "id",
    "user_id",
    "userId",
    "authSubject",
    "sessionId",
    "role",
    "member_id",
    "member",
    "family_id",
    "family",
    "email",
    "phone",
    "invite_token",
  ])("rejects unknown %s before liveness or database", async (field) => {
    for (const [method, path] of WRITE_ROUTES) {
      const f = fixture(true);
      await expectResponse(
        await f.app.request(
          writeRequest(method, path, JSON.stringify({ ...PROFILE, [field]: "private" })),
        ),
        400,
        INVALID,
      );
      expectNoWrite(f);
    }
  });

  it.each([
    null,
    "",
    "{",
    "null",
    "[]",
    "42",
    '"private"',
    "{}",
    '{"display_name":""}',
    '{"tz":"not-a-zone"}',
  ])("rejects malformed or invalid body %s", async (body) => {
    for (const [method, path] of WRITE_ROUTES) {
      const f = fixture(true);
      await expectResponse(await f.app.request(writeRequest(method, path, body)), 400, INVALID);
      expectNoWrite(f);
    }
  });

  it.each([undefined, "", "private/key", "two,keys", "has space", "x".repeat(201)])(
    "rejects missing or invalid key %s",
    async (key) => {
      const f = fixture(true);
      const request = writeRequest();
      if (key === undefined) request.headers.delete("idempotency-key");
      else request.headers.set("idempotency-key", key);
      await expectResponse(await f.app.request(request), 400, INVALID);
      expectNoWrite(f);
    },
  );

  it.each([
    undefined,
    "text/plain",
    "application/problem+json",
    "application/json; charset=iso-8859-1",
    "application/json; charset=utf-16",
    "application/json; charset=utf-8; charset=utf-16",
    "application/json; private=secret",
  ])("rejects unsupported media type %s", async (type) => {
    const f = fixture(true);
    const request = writeRequest();
    if (type === undefined) request.headers.delete("content-type");
    else request.headers.set("content-type", type);
    await expectResponse(await f.app.request(request), 415, INVALID);
    expectNoWrite(f);
  });

  it.each(["gzip", "br", "deflate", "identity, gzip", ""])(
    "rejects content encoding %s",
    async (encoding) => {
      const f = fixture(true);
      await expectResponse(
        await f.app.request(
          writeRequest("POST", "/v1/me/provision", JSON.stringify(PROFILE), {
            "content-encoding": encoding,
          }),
        ),
        415,
        INVALID,
      );
      expectNoWrite(f);
    },
  );

  it("rejects an oversized declared length without reading", async () => {
    const f = fixture(true);
    const request = writeRequest("POST", "/v1/me/provision", JSON.stringify(PROFILE), {
      "content-length": "4097",
    });
    const read = vi.spyOn(request.body as ReadableStream, "getReader");
    await expectResponse(await f.app.request(request), 413, INVALID);
    expect(read).not.toHaveBeenCalled();
    expectNoWrite(f);
  });

  it.each([{}, { "content-length": "1" }] as Record<string, string>[])(
    "enforces actual UTF-8 bytes for streamed bodies with headers %j",
    async (headers) => {
      const f = fixture(true);
      const encoder = new TextEncoder();
      const { request, body, cancel } = streamedRequest(
        [
          encoder.encode('{"display_name":"'),
          encoder.encode("界".repeat(1400)),
          encoder.encode('"}'),
        ],
        headers,
      );
      await expectResponse(await f.app.request(request), 413, INVALID);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expectNoWrite(f);
    },
  );

  it("accepts exactly 4096 streamed bytes including split multibyte characters", async () => {
    const f = fixture(true);
    const input = JSON.stringify({ ...PROFILE, display_name: "界" });
    const bytes = new TextEncoder().encode(input);
    const padded = new Uint8Array(4096).fill(32);
    padded.set(bytes);
    const { request, body } = streamedRequest(Array.from(padded, (byte) => new Uint8Array([byte])));
    await expectResponse(await f.app.request(request), 200, ME.user);
    expect(body.locked).toBe(false);
    expect(f.writes.services.provisionApiAccount.mock.calls[0]?.[3]).toEqual({
      ...PROFILE,
      display_name: "界",
    });
  });

  it.each([[0xc3, 0x28], [0xff], [0xe2, 0x82]])("rejects invalid UTF-8 %j", async (...bytes) => {
    const f = fixture(true);
    const { request, body } = streamedRequest([
      new TextEncoder().encode('{"display_name":"'),
      new Uint8Array(bytes),
      new TextEncoder().encode('","language":"en","tz":"Asia/Taipei"}'),
    ]);
    await expectResponse(await f.app.request(request), 400, INVALID);
    expect(body.locked).toBe(false);
    expectNoWrite(f);
  });

  it("does not wait for a stalled overflow cancellation", async () => {
    const f = fixture(true);
    const cancellation = deferred();
    const cancel = vi.fn(() => cancellation.promise);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel,
    });
    try {
      await expectResponse(
        await f.app.request(writeRequest("POST", "/v1/me/provision", body)),
        413,
        INVALID,
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expectNoWrite(f);
    } finally {
      cancellation.resolve();
    }
  });

  it("sanitizes stream read errors and releases the reader", async () => {
    const f = fixture(true);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("private stream error"));
      },
    });
    await expectResponse(
      await f.app.request(writeRequest("POST", "/v1/me/provision", body)),
      400,
      INVALID,
    );
    expect(body.locked).toBe(false);
    expectNoWrite(f);
  });

  it("bounds empty chunk reader work and cancels", async () => {
    const f = fixture(true);
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) =>
      controller.enqueue(new Uint8Array()),
    );
    const body = new ReadableStream<Uint8Array>({ pull, cancel });
    await expectResponse(
      await f.app.request(writeRequest("POST", "/v1/me/provision", body)),
      400,
      INVALID,
    );
    expect(pull.mock.calls.length).toBeLessThanOrEqual(4098);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expectNoWrite(f);
  });

  it("requires an explicit true from the activity checker", async () => {
    for (const value of [null, undefined, "active", "false", 1, {}]) {
      const f = fixture(true);
      f.writes.verifyActiveSession.mockResolvedValue(value as unknown as boolean);
      await expectResponse(await f.app.request(writeRequest()), 401, UNAUTHENTICATED);
      expect(f.openDatabase).not.toHaveBeenCalled();
      expect(f.writes.services.provisionApiAccount).not.toHaveBeenCalled();
    }
  });

  it("times out a stalled JSON body without checking activity or opening a database", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(true);
      const waiting = deferred();
      const cancel = vi.fn();
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new TextEncoder().encode(JSON.stringify(PROFILE)));
          } else waiting.resolve();
        },
        cancel,
      });
      const response = Promise.resolve(
        f.app.request(writeRequest("POST", "/v1/me/provision", body)),
      );
      await waiting.promise;
      await vi.advanceTimersByTimeAsync(10_001);
      await expectResponse(await response, 408, INVALID);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expectNoWrite(f);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs cancellation failures without exposing input or changing rejection", async () => {
    const f = fixture(true);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel() {
        throw new Error("private cancellation detail");
      },
    });
    await expectResponse(
      await f.app.request(writeRequest("POST", "/v1/me/provision", body)),
      413,
      INVALID,
    );
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_body_cancel_failed", {
      error: "Error",
    });
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.writes.verifyActiveSession).not.toHaveBeenCalled();
  });

  it.each(WRITE_ROUTES)(
    "checks activity before %s %s including replay",
    async (method, path, service) => {
      const f = fixture(true);
      f.writes.services[service].mockResolvedValue({
        response: { status: 200, body: ME.user },
        replayed: true,
      });
      const replay = await f.app.request(writeRequest(method, path));
      await expectResponse(replay, 200, ME.user);
      expect(replay.headers.get("idempotency-replayed")).toBe("true");
      f.writes.verifyActiveSession.mockResolvedValue(false);
      const denied = await f.app.request(writeRequest(method, path));
      await expectResponse(denied, 401, UNAUTHENTICATED);
      expect(denied.headers.has("idempotency-replayed")).toBe(false);
      expect(f.writes.verifyActiveSession).toHaveBeenCalledTimes(2);
      expect(f.openDatabase).toHaveBeenCalledOnce();
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.writes.services[service]).toHaveBeenCalledOnce();
    },
  );

  it.each(["verify", "open"] as const)(
    "sanitizes write %s failures without closing an unowned handle",
    async (stage) => {
      const f = fixture(true);
      const fail = stage === "verify" ? f.verifySession : f.openDatabase;
      fail.mockRejectedValue(new Error("private.token.key.body"));
      await expectResponse(await f.app.request(writeRequest()), 500, INTERNAL);
      expect(f.close).not.toHaveBeenCalled();
      expect(f.openDatabase).toHaveBeenCalledTimes(stage === "verify" ? 0 : 1);
      expect(f.writes.verifyActiveSession).toHaveBeenCalledTimes(stage === "verify" ? 0 : 1);
      expect(f.writes.services.provisionApiAccount).not.toHaveBeenCalled();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
        error: "Error",
      });
    },
  );

  it("maps online outage before database creation", async () => {
    const f = fixture(true);
    f.writes.verifyActiveSession.mockRejectedValue(new SessionVerificationUnavailable());
    await expectResponse(await f.app.request(writeRequest()), 503, UNAVAILABLE);
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
      error: "SessionVerificationUnavailable",
    });
  });

  it.each([
    [new ApiIdempotencyError("invalid"), 400, INVALID],
    [new ApiIdempotencyError("conflict"), 409, CONFLICT],
    [new ApiIdempotencyError("unavailable"), 503, UNAVAILABLE],
    [
      new ApiIdempotencyError("rate_limited"),
      429,
      { error: { code: "rate_limited", message: "Too many requests." } },
    ],
    [new VelaError("not_found", "private deleted account"), 404, NOT_FOUND],
    [new VelaError("invalid_payload", "private invalid profile"), 400, INVALID],
    [new Error("private database problem"), 500, INTERNAL],
  ] as const)("maps expected failures safely: %s", async (error, status, body) => {
    for (const [method, path, service] of WRITE_ROUTES) {
      const f = fixture(true);
      f.writes.services[service].mockRejectedValue(error);
      const response = await f.app.request(writeRequest(method, path));
      await expectResponse(response, status, body);
      expect(response.headers.has("idempotency-replayed")).toBe(false);
      expect(f.close).toHaveBeenCalledOnce();
      if (status < 500) expect(f.logger.error).not.toHaveBeenCalled();
      expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain("private");
    }
  });

  it.each([
    { response: { status: 201, body: ME.user }, replayed: false },
    { response: { status: 200, body: { ...ME.user, id: "bad" } }, replayed: false },
    { response: { status: 200, body: ME.user }, replayed: "true" },
    { response: { status: 200, body: ME.user } },
  ])("treats invalid service results as server failures: %j", async (result) => {
    const f = fixture(true);
    f.writes.services.provisionApiAccount.mockResolvedValue(
      result as Awaited<ReturnType<typeof f.writes.services.provisionApiAccount>>,
    );
    const response = await f.app.request(writeRequest());
    await expectResponse(response, 500, INTERNAL);
    expect(response.headers.has("idempotency-replayed")).toBe(false);
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.logger.error).toHaveBeenCalledOnce();
  });

  it("projects the user and preserves formatting on write results", async () => {
    const f = fixture(true);
    const user = {
      ...ME.user,
      display_name: "  User formatting  ",
      phone: "private",
      authSubject: "private",
    };
    f.writes.services.updateApiAccount.mockResolvedValue({
      response: { status: 200, body: user },
      replayed: false,
    });
    await expectResponse(
      await f.app.request(writeRequest("PATCH", "/v1/me", '{"language":"en"}')),
      200,
      { ...ME.user, display_name: "  User formatting  " },
    );
    expect(f.writes.services.updateApiAccount.mock.calls[0]?.[3]).toEqual({ language: "en" });
  });

  it.each([false, true])(
    "awaits cleanup without overriding write outcome (failure=%s)",
    async (failure) => {
      const f = fixture(true);
      const closing = deferred();
      const release = deferred();
      f.close.mockImplementation(async () => {
        closing.resolve();
        await release.promise;
        throw new Error("private cleanup");
      });
      if (failure)
        f.writes.services.provisionApiAccount.mockRejectedValue(
          new ApiIdempotencyError("conflict"),
        );
      let settled = false;
      const pending = Promise.resolve(f.app.request(writeRequest())).then((response) => {
        settled = true;
        return response;
      });
      await closing.promise;
      expect(settled).toBe(false);
      release.resolve();
      await expectResponse(await pending, failure ? 409 : 200, failure ? CONFLICT : ME.user);
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_database_close_failed", {
        error: "Error",
      });
    },
  );

  it.each([
    ["POST", "/v1/me"],
    ["DELETE", "/v1/me"],
    ["PUT", "/v1/me"],
    ["POST", "/v1/me/link"],
    ["POST", "/v1/link"],
    ["POST", "/v1/families"],
    ["PATCH", PLAN_PATH],
    ["GET", "/v1/me/provision"],
    ["PATCH", "/v1/me/provision"],
  ])("does not dispatch unsupported %s %s", async (method, path) => {
    const f = fixture(true);
    await expectResponse(await f.app.request(path, { method }), 404, NOT_FOUND);
    expect(f.verifySession).not.toHaveBeenCalled();
    expectNoWrite(f);
  });

  it.each(["/v1/me", "/v1/me/provision", PLAN_PATH])(
    "rejects HEAD %s with writes enabled",
    async (path) => {
      const f = fixture(true);
      const response = await f.app.request(path, { method: "HEAD" });
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
      expect(f.verifySession).not.toHaveBeenCalled();
      expectNoWrite(f);
    },
  );

  it("keeps existing GETs read-only when writes are configured", async () => {
    const f = fixture(true);
    await expectResponse(await f.app.request("/v1/me"), 200, ME);
    await expectResponse(await f.app.request(PLAN_PATH), 200, PLAN);
    expect(f.writes.verifyActiveSession).not.toHaveBeenCalled();
    expect(f.writes.services.provisionApiAccount).not.toHaveBeenCalled();
    expect(f.writes.services.updateApiAccount).not.toHaveBeenCalled();
  });

  it("isolates concurrent write bodies, keys, identities, and handles", async () => {
    const f = fixture(true);
    const otherDb = database();
    const otherClose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const otherIdentity = { authSubject: "other", sessionId: "other-session" };
    const started = deferred();
    const release = deferred();
    f.verifySession.mockResolvedValueOnce(IDENTITY).mockResolvedValueOnce(otherIdentity);
    f.openDatabase
      .mockResolvedValueOnce({ db: f.db, close: f.close })
      .mockResolvedValueOnce({ db: otherDb, close: otherClose });
    f.writes.services.updateApiAccount.mockImplementation(async () => {
      started.resolve();
      await release.promise;
      return { response: { status: 200, body: ME.user }, replayed: false };
    });
    const first = f.app.request(
      writeRequest("PATCH", "/v1/me", '{"display_name":"First"}', {
        "idempotency-key": "first-key",
      }),
    );
    await started.promise;
    await expectResponse(
      await f.app.request(
        writeRequest(
          "POST",
          "/v1/me/provision",
          JSON.stringify({ ...PROFILE, display_name: "Second" }),
          { "idempotency-key": "second-key" },
        ),
      ),
      200,
      ME.user,
    );
    expect(otherClose).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    release.resolve();
    await expectResponse(await first, 200, ME.user);
    expect(f.writes.services.updateApiAccount).toHaveBeenCalledExactlyOnceWith(
      { db: f.db, clock: f.writes.clock },
      IDENTITY,
      "first-key",
      { display_name: "First" },
    );
    expect(f.writes.services.provisionApiAccount).toHaveBeenCalledExactlyOnceWith(
      { db: otherDb, clock: f.writes.clock },
      otherIdentity,
      "second-key",
      { ...PROFILE, display_name: "Second" },
    );
    expect(f.writes.verifyActiveSession).toHaveBeenNthCalledWith(1, IDENTITY);
    expect(f.writes.verifyActiveSession).toHaveBeenNthCalledWith(2, otherIdentity);
    expect(f.close).toHaveBeenCalledOnce();
  });
});

describe("the lights of a family", () => {
  it("answers the kept lights to a member of that family", async () => {
    const { app, services } = fixture();
    const response = await app.request(LIGHTS_PATH, { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 200, LIGHTS);
    expect(services.loadApiLights).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      new Date("2026-09-22T00:00:00.000Z"),
    );
  });

  it("answers not found when the family is not the caller's", async () => {
    const { app, services } = fixture();
    services.loadApiLights.mockResolvedValue(null);
    const response = await app.request(LIGHTS_PATH, { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 404, FAMILY_NOT_FOUND);
  });

  it("refuses a request without a verified session before reading anything", async () => {
    const f = fixture();
    const { app, services, openDatabase } = f;
    f.verifySession.mockResolvedValue(null);
    const response = await app.request(LIGHTS_PATH, { headers: { authorization: "Bearer bad" } });
    expect(response.status).toBe(401);
    expect(services.loadApiLights).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });
});
