import {
  ApiAccountPatch,
  ApiAccountProfile,
  type ApiErrorBody,
  ApiFamilyPlan,
  ApiIdempotencyKey,
  ApiMe,
  ApiUser,
} from "@vela/contracts";
import type { VelaDatabase } from "@vela/db";
import {
  ApiIdempotencyError,
  type authorizeFamilyAccess,
  type Clock,
  errorLabel,
  type Logger,
  type loadApiFamilyPlan,
  type loadApiMe,
  type provisionApiAccount,
  type updateApiAccount,
  VelaError,
} from "@vela/services";
import { Hono, type MiddlewareHandler } from "hono";
import {
  type ApiSecurityEnv,
  createApiAuthentication,
  createFamilyAuthorization,
  withApiErrorNoStore,
} from "./api-security.ts";
import {
  type SessionActivityChecker,
  SessionVerificationUnavailable,
  type SessionVerifier,
} from "./session.ts";

export interface ApiReadServices {
  loadApiMe: typeof loadApiMe;
  loadApiFamilyPlan: typeof loadApiFamilyPlan;
  authorizeFamilyAccess: typeof authorizeFamilyAccess;
}

export interface ApiWriteServices {
  provisionApiAccount: typeof provisionApiAccount;
  updateApiAccount: typeof updateApiAccount;
}

export interface ApiRuntime {
  verifySession: SessionVerifier;
  openDatabase(): Promise<{ db: VelaDatabase; close(): Promise<void> }>;
  services: ApiReadServices;
  logger: Pick<Logger, "error">;
  writes?: {
    verifyActiveSession: SessionActivityChecker;
    clock: Clock;
    services: ApiWriteServices;
  };
}

interface RuntimeEnv {
  Variables: ApiSecurityEnv["Variables"] & {
    db: VelaDatabase;
    writeKey: string;
    writeInput: ApiAccountProfile | ApiAccountPatch;
  };
}

const NOT_FOUND: ApiErrorBody = {
  error: { code: "not_found", message: "Not found." },
};
const FAMILY_NOT_FOUND: ApiErrorBody = {
  error: { code: "not_found", message: "Family not found." },
};
const INTERNAL: ApiErrorBody = {
  error: { code: "internal", message: "Internal server error." },
};
const UNAVAILABLE: ApiErrorBody = {
  error: { code: "unavailable", message: "Service temporarily unavailable." },
};

const INVALID: ApiErrorBody = {
  error: { code: "invalid", message: "Invalid request." },
};
const CONFLICT: ApiErrorBody = {
  error: { code: "conflict", message: "Request conflicts with an earlier operation." },
};
const RATE_LIMITED: ApiErrorBody = {
  error: { code: "rate_limited", message: "Too many requests." },
};
const UNAUTHENTICATED: ApiErrorBody = {
  error: { code: "unauthenticated", message: "Sign in required." },
};
const MAX_BODY_BYTES = 4096;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i;

type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 408 | 413 };
const MAX_BODY_READ_MS = 10_000;

function cancelBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  logger: Pick<Logger, "error">,
): void {
  void reader.cancel().catch((error: unknown) => {
    logger.error("api_body_cancel_failed", { error: errorLabel(error) });
  });
}

async function readWriteBody(request: Request, logger: Pick<Logger, "error">): Promise<BodyResult> {
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) {
    return { ok: false, status: 413 };
  }
  if (request.body === null) return { ok: false, status: 400 };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = request.body.getReader();
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), MAX_BODY_READ_MS);
    });
    const bytes = new Uint8Array(MAX_BODY_BYTES);
    let size = 0;
    for (let reads = 0; reads <= MAX_BODY_BYTES; reads++) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk === null) {
        cancelBody(reader, logger);
        return { ok: false, status: 408 };
      }
      const { done, value } = chunk;
      if (done) {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
          bytes.subarray(0, size),
        );
        return { ok: true, value: JSON.parse(text) };
      }
      if (value.byteLength > MAX_BODY_BYTES - size) {
        cancelBody(reader, logger);
        return { ok: false, status: 413 };
      }
      if (reads === MAX_BODY_BYTES) {
        cancelBody(reader, logger);
        return { ok: false, status: 400 };
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    reader?.releaseLock();
  }
  return { ok: false, status: 400 };
}

function validateWrite(
  schema: typeof ApiAccountProfile | typeof ApiAccountPatch,
  logger: Pick<Logger, "error">,
): MiddlewareHandler<RuntimeEnv> {
  return async (c, next) => {
    const key = ApiIdempotencyKey.safeParse(c.req.header("Idempotency-Key"));
    if (!key.success) return c.json(INVALID, 400);
    const encoding = c.req.header("Content-Encoding");
    if (
      !JSON_CONTENT_TYPE.test(c.req.header("Content-Type") ?? "") ||
      (encoding !== undefined && encoding.toLowerCase() !== "identity")
    ) {
      return c.json(INVALID, 415);
    }
    const body = await readWriteBody(c.req.raw, logger);
    if (!body.ok) return c.json(INVALID, body.status);
    const input = schema.safeParse(body.value);
    if (!input.success) return c.json(INVALID, 400);
    c.set("writeKey", key.data);
    c.set("writeInput", input.data);
    await next();
    return c.res;
  };
}

export function createApiApp(runtime: ApiRuntime): Hono<RuntimeEnv> {
  const app = new Hono<RuntimeEnv>();
  const authenticate = createApiAuthentication<RuntimeEnv>(runtime.verifySession);
  const withDatabase: MiddlewareHandler<RuntimeEnv> = async (c, next) => {
    const handle = await runtime.openDatabase();
    try {
      c.set("db", handle.db);
      await next();
    } finally {
      try {
        await handle.close();
      } catch (error) {
        runtime.logger.error("api_database_close_failed", { error: errorLabel(error) });
      }
    }
  };

  app.onError(
    withApiErrorNoStore<RuntimeEnv>((error, c) => {
      if (error instanceof ApiIdempotencyError) {
        if (error.code === "invalid") return c.json(INVALID, 400);
        if (error.code === "conflict") return c.json(CONFLICT, 409);
        if (error.code === "rate_limited") return c.json(RATE_LIMITED, 429);
        if (error.code === "unavailable") {
          runtime.logger.error("api_request_failed", { error: errorLabel(error) });
          return c.json(UNAVAILABLE, 503);
        }
      }
      if (error instanceof VelaError) {
        if (error.code === "not_found") return c.json(NOT_FOUND, 404);
        if (error.code === "invalid_payload") return c.json(INVALID, 400);
      }
      runtime.logger.error("api_request_failed", { error: errorLabel(error) });
      return error instanceof SessionVerificationUnavailable
        ? c.json(UNAVAILABLE, 503)
        : c.json(INTERNAL, 500);
    }),
  );
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    if (
      c.req.raw.method === "HEAD" ||
      (c.req.raw.method !== "GET" &&
        (!runtime.writes || !["POST", "PATCH"].includes(c.req.raw.method)))
    ) {
      return c.json(NOT_FOUND, 404);
    }
    await next();
    return c.res;
  });

  app.get("/v1/me", authenticate, withDatabase, async (c) => {
    const me = await runtime.services.loadApiMe(c.get("db"), c.get("session"));
    return me === null ? c.json(NOT_FOUND, 404) : c.json(ApiMe.parse(me));
  });
  app.get(
    "/v1/families/:familyId/plan",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const plan = await runtime.services.loadApiFamilyPlan(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
      );
      return plan === null ? c.json(FAMILY_NOT_FOUND, 404) : c.json(ApiFamilyPlan.parse(plan));
    },
  );
  const writes = runtime.writes;
  if (writes) {
    const checkActivity: MiddlewareHandler<RuntimeEnv> = async (c, next) => {
      if ((await writes.verifyActiveSession(c.get("session"))) !== true) {
        return c.json(UNAUTHENTICATED, 401);
      }
      await next();
      return c.res;
    };
    const routes = [
      ["POST", "/v1/me/provision", ApiAccountProfile, writes.services.provisionApiAccount],
      ["PATCH", "/v1/me", ApiAccountPatch, writes.services.updateApiAccount],
    ] as const;
    for (const [method, path, schema, service] of routes) {
      app.on(
        method,
        path,
        authenticate,
        validateWrite(schema, runtime.logger),
        checkActivity,
        withDatabase,
        async (c) => {
          const result = await service(
            { db: c.get("db"), clock: writes.clock },
            c.get("session"),
            c.get("writeKey"),
            c.get("writeInput"),
          );
          if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
            throw new Error("Invalid API mutation response");
          }
          const user = ApiUser.parse(result.response.body);
          c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
          return c.json(user, 200);
        },
      );
    }
  }
  app.notFound((c) => c.json(NOT_FOUND, 404));

  return app;
}
