import type { SessionIdentity } from "@vela/services";
import { createRemoteJWKSet, customFetch, decodeProtectedHeader, errors, jwtVerify } from "jose";

export type SessionVerifier = (request: Request) => Promise<SessionIdentity | null>;
export type SessionActivityChecker = (identity: SessionIdentity) => Promise<boolean>;

export interface ClerkSessionActivityOptions {
  readonly secretKey: string;
  readonly fetch?: typeof fetch;
}

export interface ClerkSessionOptions {
  readonly issuer: string;
  readonly authorizedParties: readonly string[];
  readonly allowMissingAuthorizedParty?: boolean;
  readonly allowLocalHttpParties?: boolean;
  readonly audience?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export class SessionVerificationUnavailable extends Error {
  override readonly name = "SessionVerificationUnavailable";

  constructor() {
    super("Session verification unavailable");
  }
}

const CLOCK_SKEW_SECONDS = 5;
const MAX_SESSION_AGE_SECONDS = 120;
const MAX_TOKEN_LENGTH = 8192;

function validOrigin(value: string, allowLocalHttp = false): boolean {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      url.origin === value &&
      (url.protocol === "https:" || (allowLocalHttp && local && url.protocol === "http:"))
    );
  } catch {
    return false;
  }
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidToken(error: unknown): boolean {
  return (
    error instanceof errors.JWTExpired ||
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JOSENotSupported ||
    error instanceof errors.JWKSNoMatchingKey
  );
}

async function readActivityBody(response: Response): Promise<unknown> {
  const limit = 65_536;
  const length = response.headers.get("content-length");
  if (
    (length !== null && /^\d+$/.test(length) && Number(length) > limit) ||
    response.body === null
  ) {
    throw new SessionVerificationUnavailable();
  }
  const reader = response.body.getReader();
  try {
    const bytes = new Uint8Array(limit);
    let size = 0;
    for (let reads = 0; reads <= limit; reads++) {
      const { done, value } = await reader.read();
      if (done) {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
            bytes.subarray(0, size),
          ),
        );
      }
      if (reads === limit || value.byteLength > limit - size)
        throw new SessionVerificationUnavailable();
      bytes.set(value, size);
      size += value.byteLength;
    }
    throw new SessionVerificationUnavailable();
  } finally {
    reader.releaseLock();
  }
}

export function createClerkSessionActivityChecker(
  options: ClerkSessionActivityOptions,
): SessionActivityChecker {
  const { secretKey } = options;
  if (!nonblank(secretKey) || secretKey.length > 4096 || /[^!-~]/.test(secretKey)) {
    throw new Error("Invalid session activity configuration");
  }
  const fetchImpl: typeof fetch = options.fetch ?? ((resource, init) => fetch(resource, init));
  return async (identity) => {
    if (
      !nonblank(identity.authSubject) ||
      typeof identity.sessionId !== "string" ||
      !/^sess_[A-Za-z0-9_-]{1,200}$/.test(identity.sessionId)
    ) {
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetchImpl(
        `https://api.clerk.com/v1/sessions/${encodeURIComponent(identity.sessionId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (response.status === 404) return false;
      if (response.status !== 200) throw new SessionVerificationUnavailable();
      const value = await readActivityBody(response);
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !("object" in value) ||
        value.object !== "session" ||
        !("id" in value) ||
        !nonblank(value.id) ||
        !("user_id" in value) ||
        !nonblank(value.user_id) ||
        !("status" in value) ||
        !nonblank(value.status)
      ) {
        throw new SessionVerificationUnavailable();
      }
      return (
        value.id === identity.sessionId &&
        value.user_id === identity.authSubject &&
        value.status === "active"
      );
    } catch {
      throw new SessionVerificationUnavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

export function createClerkSessionVerifier(options: ClerkSessionOptions): SessionVerifier {
  const { issuer, audience } = options;
  const parties = new Set(options.authorizedParties);
  const allowMissingParty = options.allowMissingAuthorizedParty === true;
  if (
    !validOrigin(issuer) ||
    [...parties].some((party) => !validOrigin(party, options.allowLocalHttpParties === true)) ||
    (parties.size === 0 && !allowMissingParty) ||
    (audience !== undefined && !nonblank(audience))
  ) {
    throw new Error("Invalid session verifier configuration");
  }
  const now = options.now ?? (() => new Date());
  const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
    [customFetch]: options.fetch ?? ((resource, init) => fetch(resource, init)),
  });

  return async (request) => {
    const authorization = request.headers.get("Authorization");
    if (authorization === null || authorization.length > MAX_TOKEN_LENGTH + 16) {
      return null;
    }
    const token = /^Bearer[ \t]+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
      authorization,
    )?.[1];
    if (token === undefined || token.length > MAX_TOKEN_LENGTH) {
      return null;
    }
    const origin = request.headers.get("Origin");
    if (origin !== null && !parties.has(origin)) {
      return null;
    }
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== "RS256" || !nonblank(header.kid)) {
        return null;
      }
    } catch {
      return null;
    }
    try {
      const currentDate = now();
      if (!Number.isFinite(currentDate.getTime())) {
        throw new SessionVerificationUnavailable();
      }
      const { payload } = await jwtVerify(token, keys, {
        algorithms: ["RS256"],
        typ: "JWT",
        issuer,
        ...(audience === undefined ? {} : { audience }),
        requiredClaims: ["iss", "sub", "sid", "v", "exp", "nbf", "iat"],
        clockTolerance: CLOCK_SKEW_SECONDS,
        maxTokenAge: MAX_SESSION_AGE_SECONDS,
        currentDate,
      });
      const { sub, sid, v, sts, azp, exp, iat, nbf } = payload;
      if (
        !nonblank(sub) ||
        !nonblank(sid) ||
        v !== 2 ||
        (sts !== undefined && sts !== "active") ||
        typeof exp !== "number" ||
        typeof iat !== "number" ||
        typeof nbf !== "number" ||
        !Number.isSafeInteger(exp) ||
        !Number.isSafeInteger(iat) ||
        !Number.isSafeInteger(nbf) ||
        exp <= iat ||
        nbf >= exp ||
        exp - iat > MAX_SESSION_AGE_SECONDS
      ) {
        return null;
      }
      if (
        azp === undefined
          ? !allowMissingParty || origin !== null
          : typeof azp !== "string" || !parties.has(azp) || (origin !== null && azp !== origin)
      ) {
        return null;
      }
      return { authSubject: sub, sessionId: sid };
    } catch (error) {
      if (invalidToken(error)) {
        return null;
      }
      throw new SessionVerificationUnavailable();
    }
  };
}
