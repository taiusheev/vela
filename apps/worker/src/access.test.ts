import { beforeAll, describe, expect, it } from "vitest";
import { ACCESS_HEADER, createAccessVerifier } from "./access.ts";
import type { AdminEnv } from "./env.ts";
import { adminTestEnv } from "./testing/fakes.ts";

const TEAM_DOMAIN = "vela-test.cloudflareaccess.com";
const AUDIENCE = "test-audience";
const NOW = new Date("2026-09-14T09:00:00.000Z");
const SECONDS = Math.floor(NOW.getTime() / 1000);

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

interface TestKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: JsonWebKey;
}

async function generateKey(kid: string): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in pair)) {
    throw new Error("an RSA generateKey returns a pair");
  }
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  if (!("kty" in jwk)) {
    throw new Error("a jwk export returns a JsonWebKey");
  }
  return { kid, privateKey: pair.privateKey, jwk };
}

interface ClaimOverrides {
  aud?: string;
  iss?: string;
  exp?: number;
  email?: string;
}

async function tokenFor(key: TestKey, overrides: ClaimOverrides = {}): Promise<string> {
  const header = encodeJson({ alg: "RS256", kid: key.kid, typ: "JWT" });
  const claims = encodeJson({
    aud: [overrides.aud ?? AUDIENCE],
    iss: overrides.iss ?? `https://${TEAM_DOMAIN}`,
    exp: overrides.exp ?? SECONDS + 3600,
    iat: SECONDS - 60,
    email: overrides.email ?? "founder@vela.test",
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key.privateKey,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

function requestWith(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) {
    headers.set(ACCESS_HEADER, token);
  }
  return new Request("https://worker.test/admin", { headers });
}

/** The team's JWKS, served without a network: the test counts how often it is asked. */
function jwksFetch(keys: readonly TestKey[]): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl: typeof fetch = async (resource) => {
    calls += 1;
    expect(String(resource)).toBe(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`);
    return Response.json({ keys: keys.map((key) => ({ ...key.jwk, kid: key.kid })) });
  };
  return { fetch: impl, calls: () => calls };
}

let key: TestKey;
let otherKey: TestKey;

beforeAll(async () => {
  key = await generateKey("key-1");
  otherKey = await generateKey("key-2");
});

describe("the Cloudflare Access token", () => {
  it("is accepted when it is signed by a team key, for this application, and unexpired", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });

    const identity = await verify(requestWith(await tokenFor(key)), adminTestEnv);

    expect(identity).toEqual({ email: "founder@vela.test" });
  });

  it("is refused when another key signed it", async () => {
    const jwks = jwksFetch([{ ...key, jwk: otherKey.jwk }]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });

    expect(await verify(requestWith(await tokenFor(key)), adminTestEnv)).toBeNull();
  });

  it("is refused when it was issued for another application", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });

    const token = await tokenFor(key, { aud: "another-application" });

    expect(await verify(requestWith(token), adminTestEnv)).toBeNull();
    expect(jwks.calls()).toBe(0);
  });

  it("is refused when it comes from another team", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });

    const token = await tokenFor(key, { iss: "https://elsewhere.cloudflareaccess.com" });

    expect(await verify(requestWith(token), adminTestEnv)).toBeNull();
  });

  it("is refused once it has expired", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });

    const token = await tokenFor(key, { exp: SECONDS - 3600 });

    expect(await verify(requestWith(token), adminTestEnv)).toBeNull();
  });

  it("is refused when it is not a token at all", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });

    expect(await verify(requestWith("not.a.token"), adminTestEnv)).toBeNull();
  });

  it("is refused, not thrown at, when its signature is not base64url", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });
    // Everything before the signature is genuine, so the claims pass and the key is fetched: this
    // is the token a proxy clipped or a paste mangled, not a token for another application.
    const token = await tokenFor(key);
    const mangled = `${token.slice(0, token.lastIndexOf("."))}.not base64!`;

    expect(await verify(requestWith(mangled), adminTestEnv)).toBeNull();
    expect(jwks.calls()).toBe(1);
  });

  it("is fetched once and then remembered", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });
    const token = await tokenFor(key);

    await verify(requestWith(token), adminTestEnv);
    await verify(requestWith(token), adminTestEnv);

    expect(jwks.calls()).toBe(1);
  });

  it("is fetched again for a key the team has just rotated in", async () => {
    const served = [key];
    const jwks = jwksFetch(served);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });

    await verify(requestWith(await tokenFor(key)), adminTestEnv);
    served.push(otherKey);
    const rotated = await verify(requestWith(await tokenFor(otherKey)), adminTestEnv);

    expect(rotated).toEqual({ email: "founder@vela.test" });
    expect(jwks.calls()).toBe(2);
  });
});

describe("a request with no Access token", () => {
  it("is refused in production", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });
    const production: AdminEnv = { ...adminTestEnv, ENVIRONMENT: "production" };

    expect(await verify(requestWith(null), production)).toBeNull();
  });

  it("is allowed on a laptop, where there is no Access application in front", async () => {
    const jwks = jwksFetch([key]);
    const verify = createAccessVerifier({ fetch: jwks.fetch, now: () => NOW });
    const development: AdminEnv = { ...adminTestEnv, ENVIRONMENT: "development" };

    expect(await verify(requestWith(null), development)).toEqual({ email: "development" });
  });
});
