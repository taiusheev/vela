import type { ApiErrorBody } from "@vela/contracts";
import type { FamilyAccess, FamilyAccessResult, SessionIdentity } from "@vela/services";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import type { SessionVerifier } from "./session.ts";

export interface ApiSecurityEnv {
  Variables: {
    session: SessionIdentity;
    familyAccess: FamilyAccess;
  };
}

export type FamilyAuthorizer = (
  identity: SessionIdentity,
  familyId: string,
  requiredRole?: "organiser",
) => Promise<FamilyAccessResult>;

const UNAUTHENTICATED: ApiErrorBody = {
  error: { code: "unauthenticated", message: "Sign in required." },
};
const NOT_FOUND: ApiErrorBody = {
  error: { code: "not_found", message: "Family not found." },
};
const FORBIDDEN: ApiErrorBody = {
  error: { code: "forbidden", message: "Access denied." },
};

export function withApiErrorNoStore<E extends ApiSecurityEnv = ApiSecurityEnv>(
  handler: ErrorHandler<E>,
): ErrorHandler<E> {
  return async (error, c) => {
    const response = await handler(error, c);
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export function createApiAuthentication<E extends ApiSecurityEnv = ApiSecurityEnv>(
  verify: SessionVerifier,
): MiddlewareHandler<E> {
  return async (c, next) => {
    c.header("cache-control", "no-store");
    const session = await verify(c.req.raw);
    if (session === null) {
      return c.json(UNAUTHENTICATED, 401);
    }
    c.set("session", session);
    await next();
    c.header("cache-control", "no-store");
    return c.res;
  };
}

export function createFamilyAuthorization<E extends ApiSecurityEnv = ApiSecurityEnv>(
  authorize: FamilyAuthorizer,
  requiredRole?: "organiser",
): MiddlewareHandler<E> {
  return async (c, next) => {
    c.header("cache-control", "no-store");
    const session = c.get("session");
    if (!session) {
      return c.json(UNAUTHENTICATED, 401);
    }
    const familyId = c.req.param("familyId");
    if (!familyId) {
      return c.json(NOT_FOUND, 404);
    }
    const result = await authorize(session, familyId, requiredRole);
    if (result.kind === "not_found") {
      return c.json(NOT_FOUND, 404);
    }
    if (result.kind === "forbidden") {
      return c.json(FORBIDDEN, 403);
    }
    c.set("familyAccess", result.access);
    await next();
    c.header("cache-control", "no-store");
    return c.res;
  };
}
