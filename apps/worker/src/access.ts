/**
 * Cloudflare Access in front of the admin Worker (code design §9, H2). The Access application,
 * turned on for the whole Worker, already refuses a request without an identity; the Worker
 * verifies the token again so an application switched off or misconfigured cannot open the page.
 *
 * The `Cf-Access-Jwt-Assertion` header carries an RS256 JWT. It is accepted only when its
 * signature matches a key from the team's JWKS, its `aud` holds the application's audience tag,
 * its `iss` is the team domain, and it is neither expired nor used before it is valid. The `email`
 * claim is the admin identity every `admin_access_log` row records.
 */
import { secret } from "./config.ts";
import type { AdminEnv } from "./env.ts";

export interface AccessIdentity {
  /** The `email` claim of the verified token; `admin_access_log.admin`. */
  readonly email: string;
}

export type AccessVerifier = (request: Request, env: AdminEnv) => Promise<AccessIdentity | null>;

export const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

/** A clock skew a signed-in browser can genuinely show; anything larger is a stale token. */
const CLOCK_SKEW_SECONDS = 60;
/** Keys are cached for an hour; a `kid` that is not in the cache refetches at once (rotation). */
const JWKS_TTL_MS = 60 * 60 * 1000;

interface JwtHeader {
  alg: string;
  kid: string;
}

interface JwtClaims {
  aud: readonly string[];
  iss: string;
  exp: number;
  nbf: number | null;
  email: string;
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseHeader(value: unknown): JwtHeader | null {
  if (!isRecord(value) || typeof value.alg !== "string" || typeof value.kid !== "string") {
    return null;
  }
  return { alg: value.alg, kid: value.kid };
}

function parseClaims(value: unknown): JwtClaims | null {
  if (!isRecord(value)) {
    return null;
  }
  const audience =
    typeof value.aud === "string"
      ? [value.aud]
      : Array.isArray(value.aud) && value.aud.every((entry) => typeof entry === "string")
        ? value.aud
        : null;
  if (
    audience === null ||
    typeof value.iss !== "string" ||
    typeof value.exp !== "number" ||
    typeof value.email !== "string" ||
    value.email.trim() === ""
  ) {
    return null;
  }
  return {
    aud: audience,
    iss: value.iss,
    exp: value.exp,
    nbf: typeof value.nbf === "number" ? value.nbf : null,
    email: value.email.trim(),
  };
}

interface SigningKey {
  readonly kid: string;
  readonly jwk: JsonWebKey;
}

function parseKeys(value: unknown): SigningKey[] {
  if (!isRecord(value) || !Array.isArray(value.keys)) {
    return [];
  }
  const keys: SigningKey[] = [];
  for (const entry of value.keys) {
    if (isRecord(entry) && typeof entry.kty === "string" && typeof entry.kid === "string") {
      const { kty, kid, alg, use, n, e } = entry;
      keys.push({
        kid,
        jwk: {
          kty,
          alg: typeof alg === "string" ? alg : undefined,
          use: typeof use === "string" ? use : undefined,
          n: typeof n === "string" ? n : undefined,
          e: typeof e === "string" ? e : undefined,
        },
      });
    }
  }
  return keys;
}

export interface AccessVerifierOptions {
  /** Injected by tests; production uses the global. */
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * A verifier with its own key cache. One per Worker isolate: the cache then lives as long as the
 * isolate and costs the team's JWKS one request an hour.
 */
export function createAccessVerifier(options: AccessVerifierOptions = {}): AccessVerifier {
  const fetchImpl: typeof fetch = options.fetch ?? ((resource, init) => fetch(resource, init));
  const now = options.now ?? (() => new Date());
  let cache: { keys: SigningKey[]; fetchedAt: number } | null = null;

  async function keyFor(teamDomain: string, kid: string): Promise<JsonWebKey | null> {
    const at = now().getTime();
    const cached = cache;
    if (cached !== null && at - cached.fetchedAt < JWKS_TTL_MS) {
      const hit = cached.keys.find((key) => key.kid === kid);
      if (hit !== undefined) {
        return hit.jwk;
      }
    }
    const response = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) {
      return null;
    }
    const keys = parseKeys(await response.json());
    cache = { keys, fetchedAt: at };
    return keys.find((key) => key.kid === kid)?.jwk ?? null;
  }

  return async (request, env) => {
    const token = request.headers.get(ACCESS_HEADER);
    if (token === null || token === "") {
      // Only on a laptop: there is no Access application in front of `wrangler dev`.
      return env.ENVIRONMENT === "development" ? { email: "development" } : null;
    }
    const parts = token.split(".");
    const [rawHeader, rawClaims, rawSignature] = parts;
    if (
      parts.length !== 3 ||
      rawHeader === undefined ||
      rawClaims === undefined ||
      rawSignature === undefined
    ) {
      return null;
    }
    const teamDomain = secret(env, "ACCESS_TEAM_DOMAIN");
    const audience = secret(env, "ACCESS_AUD");
    let header: JwtHeader | null;
    let claims: JwtClaims | null;
    try {
      header = parseHeader(decodeJson(rawHeader));
      claims = parseClaims(decodeJson(rawClaims));
    } catch {
      return null;
    }
    if (header === null || claims === null || header.alg !== "RS256") {
      return null;
    }
    if (!claims.aud.includes(audience) || claims.iss !== `https://${teamDomain}`) {
      return null;
    }
    const seconds = Math.floor(now().getTime() / 1000);
    if (claims.exp + CLOCK_SKEW_SECONDS < seconds) {
      return null;
    }
    if (claims.nbf !== null && claims.nbf - CLOCK_SKEW_SECONDS > seconds) {
      return null;
    }
    const jwk = await keyFor(teamDomain, header.kid);
    if (jwk === null) {
      return null;
    }
    // A signature that is not base64url, or a key the platform will not import, is one more way of
    // being an invalid token: the verifier's answer is an identity or null, never a throw, so a
    // mangled token reads as "not signed in" rather than as a failure of the Worker. A JWKS that
    // could not be fetched at all is the exception, and threw before this point.
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signed = new TextEncoder().encode(`${rawHeader}.${rawClaims}`);
      const verified = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        decodeBase64Url(rawSignature),
        signed,
      );
      return verified ? { email: claims.email } : null;
    } catch {
      return null;
    }
  };
}
