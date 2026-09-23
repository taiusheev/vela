import type { ApiErrorBody } from "@vela/contracts";
import type { FamilyAccess, SessionIdentity } from "@vela/services";
import { type Context, Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ApiSecurityEnv,
  createApiAuthentication,
  createFamilyAuthorization,
  type FamilyAuthorizer,
  withApiErrorNoStore,
} from "./api-security.ts";
import { SessionVerificationUnavailable, type SessionVerifier } from "./session.ts";

const IDENTITY: SessionIdentity = { authSubject: "verified-user", sessionId: "verified-session" };
const FAMILY_ID = "11111111-1111-7111-8111-111111111111";
const ACCESS: FamilyAccess = {
  userId: "user-from-service",
  memberId: "member-from-service",
  familyId: FAMILY_ID,
  role: "member",
};
const UNAUTHENTICATED: ApiErrorBody = {
  error: { code: "unauthenticated", message: "Sign in required." },
};
const NOT_FOUND: ApiErrorBody = {
  error: { code: "not_found", message: "Family not found." },
};
const FORBIDDEN: ApiErrorBody = {
  error: { code: "forbidden", message: "Access denied." },
};
const UNAVAILABLE = { error: { message: "Service unavailable." } };

function fixture(requiredRole?: "organiser", path = "/families/:familyId") {
  const verify = vi.fn<SessionVerifier>().mockResolvedValue(IDENTITY);
  const authorize = vi
    .fn<FamilyAuthorizer>()
    .mockResolvedValue({ kind: "granted", access: ACCESS });
  const handler = vi.fn((c: Context<ApiSecurityEnv>): Response | Promise<Response> =>
    c.json({ session: c.get("session"), familyAccess: c.get("familyAccess") }),
  );
  const boundary = vi.fn(
    (_error: Error, c: Context<ApiSecurityEnv>): Response => c.json(UNAVAILABLE, 503),
  );
  const app = new Hono<ApiSecurityEnv>();
  app.onError(withApiErrorNoStore(boundary));
  app.all(
    path,
    createApiAuthentication(verify),
    createFamilyAuthorization(authorize, requiredRole),
    handler,
  );
  return { app, verify, authorize, handler, boundary };
}

async function expectError(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual(body);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API authentication middleware", () => {
  it.each([undefined, "Bearer invalid.secret.token"])(
    "rejects an unverified request with authorization %s before membership or handler calls",
    async (authorization) => {
      const { app, verify, authorize, handler } = fixture();
      verify.mockResolvedValue(null);
      const response = await app.request(`/families/${FAMILY_ID}`, {
        headers: authorization === undefined ? {} : { authorization },
      });

      await expectError(response, 401, UNAUTHENTICATED);
      expect(verify).toHaveBeenCalledOnce();
      expect(authorize).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("passes only the actual Request to the verifier and stores its verified identity", async () => {
    const { app, verify, authorize, handler } = fixture();
    const request = new Request(`https://worker.test/families/${FAMILY_ID}`, {
      headers: { authorization: "Bearer signed.secret.token" },
    });

    const response = await app.request(request);

    expect(verify).toHaveBeenCalledExactlyOnceWith(request);
    expect(verify.mock.calls[0]?.[0]).toBe(request);
    expect(authorize).toHaveBeenCalledExactlyOnceWith(IDENTITY, FAMILY_ID, undefined);
    expect(authorize.mock.calls[0]?.[0]).toBe(IDENTITY);
    expect(handler).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ session: IDENTITY, familyAccess: ACCESS });
  });

  it("does not accept forged body variables, cookies, identity headers, or development hints", async () => {
    const { app, verify, authorize, handler } = fixture();
    verify.mockResolvedValue(null);

    const response = await app.request(`/families/${FAMILY_ID}?environment=development`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "session=forged-session",
        "x-auth-subject": "forged-user",
        "x-session-id": "forged-session",
        "x-environment": "development",
      },
      body: JSON.stringify({ session: IDENTITY, familyAccess: { ...ACCESS, role: "organiser" } }),
    });

    await expectError(response, 401, UNAUTHENTICATED);
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("overrides downstream cache headers even without the family guard", async () => {
    const app = new Hono<ApiSecurityEnv>();
    app.get(
      "/session",
      createApiAuthentication(async () => IDENTITY),
      (c) => {
        expect(c.get("session")).toBe(IDENTITY);
        return new Response("private", { headers: { "cache-control": "public, max-age=3600" } });
      },
    );

    const response = await app.request("/session");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("family authorization middleware", () => {
  it.each([undefined, "organiser"] as const)(
    "authorizes the path family and verified identity using only server-owned role %s",
    async (requiredRole) => {
      const { app, authorize } = fixture(requiredRole);
      const granted: FamilyAccess = { ...ACCESS, role: requiredRole ?? "member" };
      authorize.mockResolvedValue({ kind: "granted", access: granted });

      const response = await app.request(
        `/families/${FAMILY_ID}?familyId=query-family&role=organiser&requiredRole=member&authSubject=query-user`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-family-id": "header-family",
            "x-role": "organiser",
            "x-auth-subject": "header-user",
            "x-session-id": "header-session",
          },
          body: JSON.stringify({
            familyId: "body-family",
            role: "organiser",
            requiredRole: "member",
            authSubject: "body-user",
            session: { authSubject: "forged-user", sessionId: "forged-session" },
            familyAccess: { ...ACCESS, familyId: "forged-family", role: "organiser" },
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(authorize).toHaveBeenCalledExactlyOnceWith(IDENTITY, FAMILY_ID, requiredRole);
      expect(await response.json()).toEqual({ session: IDENTITY, familyAccess: granted });
    },
  );

  it("does not consume a request body to authorize a family", async () => {
    const { app, handler } = fixture();
    handler.mockImplementation(async (c) => c.json(await c.req.json()));
    const payload = { prose: "private family words" };

    const response = await app.request(`/families/${FAMILY_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it("refuses an absent path family rather than taking an id from the query, headers, or body", async () => {
    const { app, authorize, handler } = fixture(undefined, "/families");

    const response = await app.request(`/families?familyId=${FAMILY_ID}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-family-id": FAMILY_ID },
      body: JSON.stringify({ familyId: FAMILY_ID }),
    });

    await expectError(response, 404, NOT_FOUND);
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["nonexistent", "nonmembership"])(
    "hides %s behind the same not-found response",
    async (familyId) => {
      const { app, authorize, handler } = fixture();
      authorize.mockResolvedValue({ kind: "not_found" });

      const response = await app.request(`/families/${familyId}`);

      await expectError(response, 404, NOT_FOUND);
      expect(authorize).toHaveBeenCalledExactlyOnceWith(IDENTITY, familyId, undefined);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("refuses an ordinary member on a server-owned organiser route", async () => {
    const { app, authorize, handler } = fixture("organiser");
    authorize.mockResolvedValue({ kind: "forbidden" });

    const response = await app.request(`/families/${FAMILY_ID}?role=organiser`);

    await expectError(response, 403, FORBIDDEN);
    expect(authorize).toHaveBeenCalledExactlyOnceWith(IDENTITY, FAMILY_ID, "organiser");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["missing", "after family guard"])(
    "fails closed when authentication middleware is %s",
    async (order) => {
      const { verify, authorize, handler } = fixture();
      const app = new Hono<ApiSecurityEnv>();
      app.use("*", createFamilyAuthorization(authorize));
      if (order === "after family guard") {
        app.use("*", createApiAuthentication(verify));
      }
      app.post("/families/:familyId", handler);

      const response = await app.request(`/families/${FAMILY_ID}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: IDENTITY, familyAccess: ACCESS }),
      });

      await expectError(response, 401, UNAUTHENTICATED);
      expect(verify).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("overrides downstream caching without relying on the authentication guard", async () => {
    const { authorize } = fixture();
    const app = new Hono<ApiSecurityEnv>();
    app.use("*", async (c, next) => {
      c.set("session", IDENTITY);
      await next();
    });
    app.get("/families/:familyId", createFamilyAuthorization(authorize), (c) => {
      expect(c.get("familyAccess")).toBe(ACCESS);
      return new Response("private", { headers: { "cache-control": "public, max-age=3600" } });
    });

    const response = await app.request(`/families/${FAMILY_ID}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("operational failures belong to the future API error boundary", () => {
  it.each(["authentication", "authorization", "handler"])(
    "keeps raw error-boundary responses uncached after an error in %s",
    async (stage) => {
      const { app, verify, authorize, handler, boundary } = fixture();
      boundary.mockImplementation(
        () =>
          new Response("Service unavailable.", {
            status: 503,
            headers: { "cache-control": "public, max-age=3600" },
          }),
      );
      const error = new Error("private error detail");
      if (stage === "authentication") {
        verify.mockRejectedValue(error);
      } else if (stage === "authorization") {
        authorize.mockRejectedValue(error);
      } else {
        handler.mockImplementation(() => {
          throw error;
        });
      }
      const response = await app.request(`/families/${FAMILY_ID}`);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("Service unavailable.");
    },
  );

  it.each(["session outage", "unexpected verifier error", "authorization error"])(
    "does not turn %s into unauthenticated or execute the handler",
    async (failure) => {
      const logs = ["log", "info", "warn", "error", "debug"] as const;
      const spies = logs.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
      const { app, verify, authorize, handler, boundary } = fixture();
      const secret = "secret.token.and.private.family.words";
      const error =
        failure === "session outage" ? new SessionVerificationUnavailable() : new Error(secret);
      if (failure === "authorization error") {
        authorize.mockRejectedValue(error);
      } else {
        verify.mockRejectedValue(error);
      }

      const response = await app.request(`/families/${FAMILY_ID}`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      const body = await response.clone().text();

      await expectError(response, 503, UNAVAILABLE);
      expect(body).not.toContain(secret);
      expect(handler).not.toHaveBeenCalled();
      expect(boundary).toHaveBeenCalledOnce();
      expect(boundary.mock.calls[0]?.[0]).toBe(error);
      if (failure !== "authorization error") {
        expect(authorize).not.toHaveBeenCalled();
      }
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );
});
