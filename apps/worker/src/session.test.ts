import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type ClerkSessionOptions,
  createClerkSessionActivityChecker,
  createClerkSessionVerifier,
  SessionVerificationUnavailable,
} from "./session.ts";

const ISSUER = "https://vela-test.clerk.accounts.dev";
const PARTY = "https://app.vela.test";
const NOW = new Date("2026-09-21T08:00:00Z");
const SECONDS = NOW.getTime() / 1000;
let key: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKey: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: Record<string, unknown>[] };

beforeAll(async () => {
  key = await generateKeyPair("RS256");
  otherKey = await generateKeyPair("RS256");
  jwks = {
    keys: [{ ...(await exportJWK(key.publicKey)), kid: "first", alg: "RS256", use: "sig" }],
  };
});

async function token(
  overrides: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({
    iss: ISSUER,
    sub: "user_test",
    sid: "sess_test",
    v: 2,
    iat: SECONDS,
    nbf: SECONDS - 5,
    exp: SECONDS + 60,
    azp: PARTY,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "first", typ: "JWT", ...header })
    .sign(key.privateKey);
}

function request(value: string | null, headers: Record<string, string> = {}): Request {
  return new Request("https://api.vela.test/v1/me", {
    headers: { ...(value === null ? {} : { Authorization: `Bearer ${value}` }), ...headers },
  });
}

function verifier(overrides: Partial<ClerkSessionOptions> = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async (resource, init) => {
    expect(String(resource)).toBe(`${ISSUER}/.well-known/jwks.json`);
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    return Response.json(jwks);
  });
  const verify = createClerkSessionVerifier({
    issuer: ISSUER,
    authorizedParties: [PARTY],
    now: () => NOW,
    fetch: fetchImpl,
    ...overrides,
  });
  return { verify, fetchImpl };
}

describe("online Clerk session activity", () => {
  const identity = { authSubject: "user_test", sessionId: "sess_test" };
  const secretKey = "sk_test_fake-private-key";
  const active = {
    object: "session",
    id: identity.sessionId,
    user_id: identity.authSubject,
    status: "active",
  };

  it("checks the pinned backend using only its configured credential and returns a boolean", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (resource, init) => {
      expect(String(resource)).toBe("https://api.clerk.com/v1/sessions/sess_test");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      expect(init?.cache).toBe("no-store");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${secretKey}`);
      return Response.json({ ...active, private_metadata: "not returned" });
    });
    const check = createClerkSessionActivityChecker({ secretKey, fetch: fetchImpl });
    expect(await check(identity)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not cache an active session or accept a session belonging to another subject", async () => {
    let served = active;
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(served));
    const check = createClerkSessionActivityChecker({ secretKey, fetch: fetchImpl });
    expect(await check(identity)).toBe(true);
    served = { ...active, status: "revoked" };
    expect(await check(identity)).toBe(false);
    served = { ...active, user_id: "user_other" };
    expect(await check(identity)).toBe(false);
    served = { ...active, id: "sess_other" };
    expect(await check(identity)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("refuses every non-active session status", async () => {
    for (const status of [
      "pending",
      "revoked",
      "ended",
      "expired",
      "removed",
      "abandoned",
      "replaced",
      "unknown",
    ]) {
      const check = createClerkSessionActivityChecker({
        secretKey,
        fetch: async () => Response.json({ ...active, status }),
      });
      expect(await check(identity), status).toBe(false);
    }
  });

  it("returns false for a removed session", async () => {
    const check = createClerkSessionActivityChecker({
      secretKey,
      fetch: async () => new Response(null, { status: 404 }),
    });
    expect(await check(identity)).toBe(false);
  });

  it("rejects malformed session identities without sending the credential anywhere", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const check = createClerkSessionActivityChecker({ secretKey, fetch: fetchImpl });
    for (const sessionId of [
      "",
      "..",
      "../users",
      "sess_a/b",
      "sess_x?next=other",
      "sess_x\n",
      `sess_${"x".repeat(201)}`,
    ]) {
      expect(await check({ ...identity, sessionId })).toBe(false);
    }
    expect(await check({ ...identity, authSubject: " " })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sanitizes backend, authentication, redirect and rate-limit failures", async () => {
    for (const status of [401, 403, 429, 500, 302]) {
      const check = createClerkSessionActivityChecker({
        secretKey,
        fetch: async () => new Response(secretKey, { status }),
      });
      await expect(check(identity)).rejects.toThrow(SessionVerificationUnavailable);
      await expect(check(identity)).rejects.toThrow("Session verification unavailable");
    }
    const check = createClerkSessionActivityChecker({
      secretKey,
      fetch: async () => {
        throw new Error(secretKey);
      },
    });
    await expect(check(identity)).rejects.toThrow("Session verification unavailable");
  });

  it("fails closed on malformed backend responses", async () => {
    for (const body of [
      null,
      [],
      {},
      { ...active, object: "user" },
      { ...active, user_id: null },
      { ...active, status: false },
    ]) {
      const check = createClerkSessionActivityChecker({
        secretKey,
        fetch: async () => Response.json(body),
      });
      await expect(check(identity)).rejects.toThrow(SessionVerificationUnavailable);
    }
    const check = createClerkSessionActivityChecker({
      secretKey,
      fetch: async () => new Response("not-json"),
    });
    await expect(check(identity)).rejects.toThrow(SessionVerificationUnavailable);
  });

  it("bounds both declared and streamed backend response size", async () => {
    for (const length of ["65537", "1", undefined]) {
      let signal: AbortSignal | null | undefined;
      const check = createClerkSessionActivityChecker({
        secretKey,
        fetch: async (_resource, init) => {
          signal = init?.signal;
          return new Response(JSON.stringify(active).padEnd(65537, " "), {
            headers: length === undefined ? {} : { "content-length": length },
          });
        },
      });
      await expect(check(identity)).rejects.toThrow(SessionVerificationUnavailable);
      expect(signal?.aborted).toBe(true);
    }
  });

  it("accepts a bounded streamed session response at the byte limit", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(active).padEnd(65536, " "));
    const check = createClerkSessionActivityChecker({
      secretKey,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 10));
              controller.enqueue(bytes.subarray(10));
              controller.close();
            },
          }),
        ),
    });
    expect(await check(identity)).toBe(true);
  });

  it("rejects invalid configuration without quoting credentials", () => {
    for (const value of ["", " ", "key\r\nprivate"]) {
      expect(() => createClerkSessionActivityChecker({ secretKey: value })).toThrow(
        "Invalid session activity configuration",
      );
    }
  });
});

describe("Clerk session verification", () => {
  it("returns only the signed account and session identifiers", async () => {
    const { verify } = verifier();
    const jwt = await token({
      role: "organiser",
      family_id: "untrusted",
      email: "private@vela.test",
    });
    expect(await verify(request(jwt))).toStrictEqual({
      authSubject: "user_test",
      sessionId: "sess_test",
    });
  });

  it("accepts a case-insensitive Bearer scheme but no other token source", async () => {
    const { verify, fetchImpl } = verifier();
    const jwt = await token();
    const alternatives: Record<string, string>[] = [
      {},
      { Cookie: `__session=${jwt}` },
      { "Cf-Access-Jwt-Assertion": jwt },
      { Authorization: `Basic ${jwt}` },
      { Authorization: `Bearer ${jwt}, Bearer ${jwt}` },
    ];
    for (const headers of alternatives) {
      expect(await verify(request(null, headers))).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await verify(request(null, { Authorization: `bEaReR ${jwt}` }))).not.toBeNull();
  });

  it("refuses malformed and oversized tokens before fetching keys", async () => {
    const { verify, fetchImpl } = verifier();
    for (const jwt of ["", "one.two", "one.two.three.four", "not.a.token", "x".repeat(8193)]) {
      expect(await verify(request(jwt))).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses unsigned, symmetric and unexpected algorithm tokens", async () => {
    const { verify, fetchImpl } = verifier();
    const encode = (value: unknown): string => btoa(JSON.stringify(value)).replace(/=+$/, "");
    for (const alg of ["none", "HS256", "ES256"]) {
      expect(
        await verify(
          request(`${encode({ alg, kid: "first" })}.${encode({ sub: "user_test" })}.AA`),
        ),
      ).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a different signature and a modified payload", async () => {
    const { verify } = verifier({
      fetch: async () =>
        Response.json({ keys: [{ ...(await exportJWK(otherKey.publicKey)), kid: "first" }] }),
    });
    expect(await verify(request(await token()))).toBeNull();
    const jwt = await token();
    const [header, , signature] = jwt.split(".");
    const payload = btoa(JSON.stringify({ sub: "user_someone_else" })).replace(/=+$/, "");
    expect(await verifier().verify(request(`${header}.${payload}.${signature}`))).toBeNull();
  });

  it("rejects wrong issuers, expired tokens, future tokens and long-lived tokens", async () => {
    const { verify } = verifier();
    for (const claims of [
      { iss: "https://other.clerk.accounts.dev" },
      { exp: SECONDS - 6 },
      { nbf: SECONDS + 6 },
      { iat: SECONDS + 6 },
      { iat: SECONDS - 126, nbf: SECONDS - 131, exp: SECONDS + 1 },
      { exp: SECONDS + 121 },
      { exp: SECONDS - 1, iat: SECONDS },
    ]) {
      expect(await verify(request(await token(claims))), JSON.stringify(claims)).toBeNull();
    }
  });

  it("requires v2 session claims and numeric timestamps", async () => {
    const { verify } = verifier();
    for (const claim of ["iss", "sub", "sid", "v", "exp", "nbf", "iat"]) {
      expect(await verify(request(await token({ [claim]: undefined }))), claim).toBeNull();
    }
    for (const claims of [
      { sub: "" },
      { sub: " " },
      { sub: 123 },
      { sid: "" },
      { sid: [] },
      { v: 1 },
      { v: "2" },
      { iat: "invalid" },
      { exp: null },
      { nbf: "invalid" },
    ]) {
      expect(await verify(request(await token(claims))), JSON.stringify(claims)).toBeNull();
    }
  });

  it("rejects pending, malformed and unknown session statuses", async () => {
    const { verify } = verifier();
    expect(await verify(request(await token({ sts: "active" })))).not.toBeNull();
    for (const sts of ["pending", "revoked", "", null, false]) {
      expect(await verify(request(await token({ sts })))).toBeNull();
    }
  });

  it("checks authorized party exactly and refuses untrusted browser origins", async () => {
    const { verify } = verifier();
    for (const azp of ["https://evil.test", `${PARTY}.evil.test`, null, "", [PARTY]]) {
      expect(await verify(request(await token({ azp })))).toBeNull();
    }
    const jwt = await token();
    expect(await verify(request(jwt, { Origin: PARTY }))).not.toBeNull();
    expect(await verify(request(jwt, { Origin: "https://evil.test" }))).toBeNull();
    expect(await verify(request(jwt, { Origin: "null" }))).toBeNull();
  });

  it("binds a browser origin to its token party even when both parties are allowed", async () => {
    const otherParty = "https://other-app.vela.test";
    const { verify } = verifier({ authorizedParties: [PARTY, otherParty] });
    expect(await verify(request(await token(), { Origin: otherParty }))).toBeNull();
    expect(
      await verify(request(await token({ azp: otherParty }), { Origin: otherParty })),
    ).not.toBeNull();
  });

  it("requires explicit opt-in for local HTTP application origins", () => {
    for (const party of ["http://localhost:8081", "http://127.0.0.1:3000", "http://[::1]:8081"]) {
      expect(() => verifier({ authorizedParties: [party] })).toThrow(
        "Invalid session verifier configuration",
      );
      expect(() =>
        verifier({ authorizedParties: [party], allowLocalHttpParties: true }),
      ).not.toThrow();
    }
    expect(() =>
      verifier({ authorizedParties: ["http://app.vela.test"], allowLocalHttpParties: true }),
    ).toThrow("Invalid session verifier configuration");
  });

  it("requires explicit native opt-in for absent azp and never accepts a browser origin then", async () => {
    const jwt = await token({ azp: undefined });
    expect(await verifier().verify(request(jwt))).toBeNull();
    const { verify } = verifier({ authorizedParties: [], allowMissingAuthorizedParty: true });
    expect(await verify(request(jwt))).not.toBeNull();
    expect(await verify(request(jwt, { Origin: PARTY }))).toBeNull();
    expect(await verify(request(await token({ azp: "https://evil.test" })))).toBeNull();
  });

  it("enforces an audience only when configured", async () => {
    const jwt = await token();
    expect(await verifier().verify(request(jwt))).not.toBeNull();
    const { verify } = verifier({ audience: "vela-api" });
    expect(await verify(request(jwt))).toBeNull();
    expect(await verify(request(await token({ aud: "other-api" })))).toBeNull();
    expect(await verify(request(await token({ aud: "vela-api" })))).not.toBeNull();
    expect(await verify(request(await token({ aud: ["other", "vela-api"] })))).not.toBeNull();
  });

  it("ignores token-provided key URLs and caches only the configured issuer's keys", async () => {
    const { verify, fetchImpl } = verifier();
    const jwt = await token({}, { jku: "https://evil.test/jwks", jwk: { kty: "RSA" } });
    expect(await verify(request(jwt))).not.toBeNull();
    expect(await verify(request(jwt))).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds unknown-key refreshes and accepts a rotated key after the cooldown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(NOW);
      let served = jwks;
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(served));
      const { verify } = verifier({ fetch: fetchImpl });
      expect(await verify(request(await token()))).not.toBeNull();
      const rotated = await token({}, { kid: "rotated" });
      served = { keys: [{ ...(await exportJWK(key.publicKey)), kid: "rotated" }] };
      expect(await verify(request(rotated))).toBeNull();
      expect(await verify(request(rotated))).toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date(NOW.getTime() + 30_001));
      expect(await verify(request(rotated))).not.toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes cached keys after ten minutes even for a known key id", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(NOW);
      const { verify, fetchImpl } = verifier();
      const jwt = await token();
      expect(await verify(request(jwt))).not.toBeNull();
      vi.setSystemTime(new Date(NOW.getTime() + 600_001));
      expect(await verify(request(jwt))).not.toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires a JWT type and a nonblank key id", async () => {
    const { verify } = verifier();
    for (const header of [{ typ: undefined }, { typ: "other" }, { kid: undefined }, { kid: " " }]) {
      expect(await verify(request(await token({}, header)))).toBeNull();
    }
  });

  it("allows only five seconds of clock skew", async () => {
    const { verify } = verifier();
    expect(
      await verify(request(await token({ iat: SECONDS + 4, nbf: SECONDS + 4 }))),
    ).not.toBeNull();
    expect(
      await verify(
        request(await token({ iat: SECONDS - 64, nbf: SECONDS - 69, exp: SECONDS - 4 })),
      ),
    ).not.toBeNull();
    expect(
      await verify(
        request(await token({ iat: SECONDS - 65, nbf: SECONDS - 70, exp: SECONDS - 5 })),
      ),
    ).toBeNull();
  });

  it("does not authorize when the verification clock is invalid", async () => {
    const { verify } = verifier({ now: () => new Date(Number.NaN) });
    await expect(verify(request(await token()))).rejects.toThrow(SessionVerificationUnavailable);
  });

  it("sanitizes a thrown clock error instead of exposing its details", async () => {
    const { verify } = verifier({
      now: () => {
        throw new Error("SENTINEL-clock-detail");
      },
    });
    await expect(verify(request(await token()))).rejects.toThrow(SessionVerificationUnavailable);
    await expect(verify(request(await token()))).rejects.toThrow(
      "Session verification unavailable",
    );
  });

  it("snapshots configured authorized parties rather than following later mutations", async () => {
    const authorizedParties = [PARTY];
    const { verify } = verifier({ authorizedParties });
    authorizedParties.push("https://evil.test");
    expect(await verify(request(await token({ azp: "https://evil.test" })))).toBeNull();
  });

  it("never shares cached keys between verifier instances", async () => {
    const first = verifier();
    expect(await first.verify(request(await token()))).not.toBeNull();
    const second = verifier({
      fetch: async () =>
        Response.json({ keys: [{ ...(await exportJWK(otherKey.publicKey)), kid: "first" }] }),
    });
    expect(await second.verify(request(await token()))).toBeNull();
  });

  it("reports key-service outages with no token or provider details", async () => {
    for (const fetchImpl of [
      async () => {
        throw new Error("SENTINEL-provider-detail");
      },
      async () => new Response("SENTINEL-provider-detail", { status: 503 }),
      async () => new Response("not-json"),
    ]) {
      const { verify } = verifier({ fetch: fetchImpl });
      await expect(verify(request(await token()))).rejects.toThrow(SessionVerificationUnavailable);
      await expect(verify(request(await token()))).rejects.toThrow(
        "Session verification unavailable",
      );
    }
  });

  it("rejects unsafe or incomplete verifier configuration", () => {
    for (const issuer of [
      "",
      "http://clerk.test",
      `${ISSUER}/path`,
      `${ISSUER}?x=1`,
      `https://user:pass@clerk.test`,
    ]) {
      expect(() => verifier({ issuer })).toThrow("Invalid session verifier configuration");
    }
    expect(() => verifier({ authorizedParties: [] })).toThrow(
      "Invalid session verifier configuration",
    );
    expect(() => verifier({ authorizedParties: ["https://app.vela.test/path"] })).toThrow(
      "Invalid session verifier configuration",
    );
    expect(() => verifier({ audience: "" })).toThrow("Invalid session verifier configuration");
  });
});
