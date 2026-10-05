import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const STAGING_ORIGIN = "https://vela.vela-light-staging.workers.dev";
export const STAGING_ISSUER = "https://ideal-vulture-9262.clerk.accounts.dev";
const CLERK_API = "https://api.clerk.com/v1";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PrivateLoadError extends Error {}
export function refuse(message) { throw new PrivateLoadError(message); }

/** Prompts have no echo or shell history. No clipboard or private file is read. */
export function readHidden(question, signal) {
  if (signal?.aborted) refuse("Check cancelled. No load run was completed.");
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    refuse("Open this check in your own macOS Terminal or iTerm2 window.");
  }
  process.stdout.write(`${question} (hidden): `);
  return new Promise((resolve, reject) => {
    let value = "";
    let finished = false;
    const wasRaw = process.stdin.isRaw;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      signal?.removeEventListener("abort", onAbort);
      try { process.stdin.setRawMode(wasRaw === true); } catch {}
      process.stdin.pause();
      process.stdout.write("\n");
      if (error === undefined) resolve(value.trim());
      else reject(error);
    };
    const onAbort = () => finish(new PrivateLoadError("Check cancelled. No load run was completed."));
    const onEnd = () => finish(new PrivateLoadError("The private Terminal closed. No load run was completed."));
    const onData = (chunk) => {
      const characters = [...chunk];
      for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u0003" || character === "\u0004") {
          finish(new PrivateLoadError("Check cancelled. No load run was completed."));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = [...value].slice(0, -1).join("");
        } else if (character === "\u001b") {
          if (characters[index + 1] === "[") {
            index += 2;
            while (index < characters.length && !/[@-~]/.test(characters[index] ?? "~")) index += 1;
          } else index += 1;
        } else if (character >= " " && value.length < 8192) value += character;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    signal?.addEventListener("abort", onAbort, { once: true });
    process.stdin.resume();
  });
}

export async function askHidden(question, valid, problem, signal) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const value = await readHidden(question, signal);
    if (valid(value)) return value;
    console.error(problem);
  }
  refuse("The private inputs could not be checked. Ask engineering to help with this step.");
}

async function boundedJson(response) {
  if (response.body === null) refuse("The private preflight returned no readable result.");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(65_536);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
      if (size + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        refuse("The private preflight result exceeded its size limit.");
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally { reader.releaseLock(); }
}

async function privateJsonRequest(url, options, failure) {
  try {
    const response = await fetch(url, {
      ...options, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) refuse(failure);
    return await boundedJson(response);
  } catch {
    // Provider errors, bodies and URLs never reach output.
    refuse(failure);
  }
}

export async function makeTokenSource(secretKey, sessionId, userId) {
  // Resolve the Worker's declared jose dependency without relying on transitive root hoisting.
  const workerRequire = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
  const { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } = await import(
    pathToFileURL(workerRequire.resolve("jose")).href
  );
  const keys = createRemoteJWKSet(new URL(`${STAGING_ISSUER}/.well-known/jwks.json`), {
    cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30_000, timeoutDuration: 5_000,
  });
  const headers = { Authorization: `Bearer ${secretKey}`, Accept: "application/json" };
  let current = null;
  let refreshCount = 0;
  let failure = null;
  return {
    async refresh() {
      if (failure !== null) throw failure;
      try {
        const session = await privateJsonRequest(
          `${CLERK_API}/sessions/${encodeURIComponent(sessionId)}`, { headers },
          "The test sign-in could not be checked. Sign in again, then retry this check.",
        );
        if (session?.object !== "session" || session.id !== sessionId ||
          session.user_id !== userId || session.status !== "active") {
          refuse("This is not an active sign-in for the dedicated test account. Sign in to that account again.");
        }
        const result = await privateJsonRequest(
          `${CLERK_API}/sessions/${encodeURIComponent(sessionId)}/tokens`,
          {
            method: "POST", headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ expires_in_seconds: 60 }),
          },
          "The test sign-in could not be refreshed. No load result can be accepted; ask engineering to check this step.",
        );
        const token = result?.jwt;
        if (typeof token !== "string" || token.length > 8192) {
          refuse("The identity provider returned no usable test-session token.");
        }
        const header = decodeProtectedHeader(token);
        if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.trim() === "") {
          refuse("The test-session token did not pass staging's signature checks.");
        }
        const { payload } = await jwtVerify(token, keys, {
          algorithms: ["RS256"], typ: "JWT", issuer: STAGING_ISSUER,
          requiredClaims: ["iss", "sub", "sid", "v", "exp", "nbf", "iat"],
          clockTolerance: 5, maxTokenAge: 120,
        });
        const { exp, iat, nbf, sid, sub, v, sts } = payload;
        if (sub !== userId || sid !== sessionId || v !== 2 ||
          (sts !== undefined && sts !== "active") || "azp" in payload ||
          !Number.isSafeInteger(exp) || !Number.isSafeInteger(iat) || !Number.isSafeInteger(nbf) ||
          exp <= iat || nbf >= exp || exp - iat > 120 || exp - Date.now() / 1000 < 40) {
          refuse("This session token is not compatible with staging's native app rules. No authentication rule was changed; ask engineering to check this step.");
        }
        // Minting's lifecycle behavior is not guaranteed by the public endpoint specification.
        // Check again before publishing, so an inactive session cannot be revived by this runner.
        const confirmed = await privateJsonRequest(
          `${CLERK_API}/sessions/${encodeURIComponent(sessionId)}`, { headers },
          "The refreshed test sign-in could not be confirmed as active. No load result can be accepted.",
        );
        if (confirmed?.object !== "session" || confirmed.id !== sessionId ||
          confirmed.user_id !== userId || confirmed.status !== "active") {
          refuse("The test sign-in is no longer active. Sign in again before retrying the load check.");
        }
        current = { token, exp, lifetimeSeconds: exp - iat };
        refreshCount += 1;
      } catch (error) {
        current = null;
        failure = error instanceof PrivateLoadError ? error
          : new PrivateLoadError("The refreshed test-session token could not be verified. No load result can be accepted.");
        throw failure;
      }
    },
    available() { return failure === null && current !== null && current.exp > Date.now() / 1000 + 10; },
    get current() { return current; },
    get refreshCount() { return refreshCount; },
    clear() { current = null; },
  };
}

export async function checkOrganiser(token, familyId) {
  const me = await privateJsonRequest(`${STAGING_ORIGIN}/v1/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }, "The test account could not read its staging membership. Ask engineering to check the synthetic family.");
  if (!UUID.test(me?.user?.id ?? "") || !Array.isArray(me.memberships) ||
    me.memberships.length !== 1 || me.memberships[0]?.family?.id !== familyId ||
    me.memberships[0]?.family?.name !== "ADR38 synthetic load fixture" ||
    me.memberships[0]?.role !== "organiser" || me.memberships[0]?.status !== "active") {
    refuse("This account does not actively organise only the isolated synthetic test family. Ask engineering to check the fixture.");
  }
}

/** This capability-gated endpoint is available only to the local child for the duration of k6. */
export function bridgeFor(source, capability) {
  const expected = Buffer.from(`Bearer ${capability}`);
  return createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Content-Type", "application/json");
    const received = Buffer.from(request.headers.authorization ?? "");
    if (request.method !== "GET" || request.url !== "/session-token" ||
      request.headers.origin !== undefined || received.length !== expected.length ||
      !timingSafeEqual(received, expected)) {
      response.writeHead(404);
      response.end('{"error":"not_found"}');
      return;
    }
    if (!source.available()) {
      response.writeHead(503);
      response.end('{"error":"unavailable"}');
      return;
    }
    response.writeHead(200);
    response.end(JSON.stringify({ jwt: source.current.token, expires_at: source.current.exp }));
  });
}
