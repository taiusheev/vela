import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { VelaDatabase } from "@vela/db";
import { describe, expect, it, vi } from "vitest";
import {
  type ClerkWebhookRuntime,
  createClerkWebhookHandler,
  MAX_CLERK_WEBHOOK_BYTES,
  verifyClerkWebhook,
} from "./clerk-webhook.ts";
import { readClerkWebhookSigningSecret } from "./config.ts";
import type { PilotEnv } from "./env.ts";
import { createWorker } from "./pilot-worker.ts";
import { createFakePilotRuntime, testEnv } from "./testing/fakes.ts";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const SECRET = `whsec_${btoa("synthetic-signing-key-for-testing")}`;
const ENV: PilotEnv = { ...testEnv, CLERK_WEBHOOK_SIGNING_SECRET: SECRET };
const URL = "https://vela.worker.test/webhooks/clerk";
const DELETED = JSON.stringify({
  object: "event",
  type: "user.deleted",
  data: { object: "user", deleted: true, id: "user_trial" },
});

function fixture() {
  const db = {} as VelaDatabase;
  const close = vi.fn<() => Promise<void>>().mockResolvedValue();
  const openDatabase = vi
    .fn<ClerkWebhookRuntime["openDatabase"]>()
    .mockResolvedValue({ db, close });
  const disableAccount = vi.fn<ClerkWebhookRuntime["disableAccount"]>().mockResolvedValue();
  const error = vi.fn<ReturnType<ClerkWebhookRuntime["logger"]>["error"]>();
  const clock = { now: () => NOW };
  const ports: ClerkWebhookRuntime = {
    clock,
    openDatabase,
    disableAccount,
    logger: () => ({ error }),
  };
  return {
    db,
    close,
    clock,
    openDatabase,
    disableAccount,
    error,
    handle: createClerkWebhookHandler(ports),
  };
}

async function signedHeaders(
  body: string,
  timestamp = String(NOW.getTime() / 1000),
  secret = SECRET,
): Promise<Headers> {
  const id = "msg_trial_deletion";
  const key = await crypto.subtle.importKey(
    "raw",
    readClerkWebhookSigningSecret({ CLERK_WEBHOOK_SIGNING_SECRET: secret }),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  return new Headers({
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${btoa(String.fromCharCode(...signature))}`,
  });
}

async function request(body = DELETED, headers?: Headers): Promise<Request> {
  return new Request(URL, {
    method: "POST",
    body,
    headers: headers ?? (await signedHeaders(body)),
  });
}

describe("Clerk's Svix signature", () => {
  it("matches the official Svix known-answer vector", async () => {
    const headers = new Headers({
      "svix-id": "msg_loFOjxBNrRLzqYUf",
      "svix-timestamp": "1731705121",
      "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
    });
    const key = readClerkWebhookSigningSecret({
      CLERK_WEBHOOK_SIGNING_SECRET: "whsec_plJ3nmyCDGBKInavdOK15jsl",
    });
    expect(
      await verifyClerkWebhook(
        headers,
        new Uint8Array(new TextEncoder().encode('{"event_type":"ping","data":{"success":true}}')),
        key,
        new Date(1731705121 * 1000),
      ),
    ).toBe(true);
  });

  it.each(["first", "last"] as const)(
    "accepts any matching v1 signature during key rotation (%s)",
    async (position) => {
      const f = fixture();
      const headers = await signedHeaders(DELETED);
      const good = headers.get("svix-signature") ?? "";
      const other = `v1,${btoa("a".repeat(32))} v2,ignored v1,bad-base64`;
      headers.set("svix-signature", position === "first" ? `${good} ${other}` : `${other} ${good}`);
      expect((await f.handle(await request(DELETED, headers), ENV)).status).toBe(200);
      expect(f.disableAccount).toHaveBeenCalledOnce();
    },
  );

  it.each(["svix-id", "svix-timestamp", "svix-signature"])(
    "rejects missing %s without opening the database",
    async (name) => {
      const f = fixture();
      const headers = await signedHeaders(DELETED);
      headers.delete(name);
      expect((await f.handle(await request(DELETED, headers), ENV)).status).toBe(401);
      expect(f.openDatabase).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["svix-id", "msg.with.dot"],
    ["svix-timestamp", "not-seconds"],
    ["svix-timestamp", "1791201600.0"],
    ["svix-signature", "v1,bad-base64"],
    ["svix-signature", `v2,${btoa("a".repeat(32))}`],
    ["svix-signature", `v1,${btoa("a".repeat(32))}`],
    ["svix-signature", "x".repeat(4097)],
  ])("rejects malformed or nonmatching %s", async (name, value) => {
    const f = fixture();
    const headers = await signedHeaders(DELETED);
    headers.set(name, value);
    expect((await f.handle(await request(DELETED, headers), ENV)).status).toBe(401);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it.each([-301, 301])("rejects signed requests %s seconds from now", async (offset) => {
    const f = fixture();
    const headers = await signedHeaders(DELETED, String(NOW.getTime() / 1000 + offset));
    expect((await f.handle(await request(DELETED, headers), ENV)).status).toBe(401);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it.each([-300, 300])("accepts the %s second boundary", async (offset) => {
    const f = fixture();
    const headers = await signedHeaders(DELETED, String(NOW.getTime() / 1000 + offset));
    expect((await f.handle(await request(DELETED, headers), ENV)).status).toBe(200);
  });

  it("verifies unchanged raw whitespace and rejects reserialized or modified content", async () => {
    const f = fixture();
    const body = `  \n${DELETED}\n`;
    const headers = await signedHeaders(body);
    expect((await f.handle(await request(body, headers), ENV)).status).toBe(200);
    expect((await f.handle(await request(DELETED, headers), ENV)).status).toBe(401);
    expect(
      (await f.handle(await request(body.replace("user_trial", "user_other"), headers), ENV))
        .status,
    ).toBe(401);
    expect(f.disableAccount).toHaveBeenCalledOnce();
  });

  it("does not accept the Telegram secret as the Clerk signing key", async () => {
    const f = fixture();
    const headers = await signedHeaders(
      DELETED,
      undefined,
      `whsec_${btoa("a different synthetic signing key")}`,
    );
    headers.set("X-Telegram-Bot-Api-Secret-Token", testEnv.TELEGRAM_WEBHOOK_SECRET ?? "");
    expect((await f.handle(await request(DELETED, headers), ENV)).status).toBe(401);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});

describe("the verified Clerk account lifecycle endpoint", () => {
  it("disables the exact signed account and closes the database before acknowledging", async () => {
    const f = fixture();
    const response = await f.handle(await request(), ENV);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
    expect(f.disableAccount).toHaveBeenCalledExactlyOnceWith(
      { db: f.db, clock: f.clock },
      "user_trial",
    );
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.error).not.toHaveBeenCalled();
  });

  it("hands repeated verified deliveries to the idempotent tombstone service", async () => {
    const f = fixture();
    for (let attempt = 0; attempt < 2; attempt += 1)
      expect((await f.handle(await request(), ENV)).status).toBe(200);
    expect(f.disableAccount).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, "", "Telegram webhook secret", "whsec_!!!!"])(
    "fails closed before reading a body when the endpoint key is unavailable",
    async (key) => {
      const f = fixture();
      const input = new Request(URL, { method: "POST", body: DELETED });
      const response = await f.handle(input, { ...testEnv, CLERK_WEBHOOK_SIGNING_SECRET: key });
      expect(response.status).toBe(503);
      expect(input.bodyUsed).toBe(false);
      expect(f.openDatabase).not.toHaveBeenCalled();
      expect(f.error).toHaveBeenCalledExactlyOnceWith("clerk_webhook_config_refused", {
        error: "ConfigError:CLERK_WEBHOOK_SIGNING_SECRET",
      });
      if (key) expect(JSON.stringify(f.error.mock.calls)).not.toContain(key);
    },
  );

  it.each(["broken-json", "null", "[]", "{}", '{"object":"user","type":"user.deleted"}'])(
    "rejects signed invalid event envelopes (%s)",
    async (body) => {
      const f = fixture();
      expect((await f.handle(await request(body), ENV)).status).toBe(400);
      expect(f.openDatabase).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { object: "user", deleted: true, id: null },
    { object: "session", deleted: true, id: "user_trial" },
    { object: "user", deleted: false, id: "user_trial" },
    { object: "user", deleted: true, id: "unscoped-account" },
  ])("rejects signed malformed deletion data %j", async (data) => {
    const f = fixture();
    expect(
      (
        await f.handle(
          await request(JSON.stringify({ object: "event", type: "user.deleted", data })),
          ENV,
        )
      ).status,
    ).toBe(400);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it.each(["user.created", "user.updated", "session.ended"])(
    "acknowledges %s without creating or reviving an account",
    async (type) => {
      const f = fixture();
      const body = JSON.stringify({
        object: "event",
        type,
        data: { object: "user", id: "user_trial", banned: true, locked: true },
      });
      expect((await f.handle(await request(body), ENV)).status).toBe(200);
      expect(f.openDatabase).not.toHaveBeenCalled();
    },
  );

  it.each(["bad", String(MAX_CLERK_WEBHOOK_BYTES + 1)])(
    "rejects invalid or oversized declared content length before reading",
    async (length) => {
      const f = fixture();
      const headers = await signedHeaders(DELETED);
      headers.set("content-length", length);
      const input = await request(DELETED, headers);
      expect((await f.handle(input, ENV)).status).toBe(length === "bad" ? 400 : 413);
      expect(input.bodyUsed).toBe(false);
      expect(f.openDatabase).not.toHaveBeenCalled();
    },
  );

  it("bounds a chunked body even without content-length and cancels further reading", async () => {
    const f = fixture();
    const cancel = vi.fn();
    let chunk = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunk += 1;
          controller.enqueue(new Uint8Array(MAX_CLERK_WEBHOOK_BYTES / 2));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const input = new Request(URL, { method: "POST", body });
    expect((await f.handle(input, ENV)).status).toBe(413);
    expect(chunk).toBe(3);
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it("rejects a failed body stream without touching accounts", async () => {
    const f = fixture();
    const input = new Request(URL, {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error("private content"));
        },
      }),
    });
    expect((await f.handle(input, ENV)).status).toBe(400);
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.error).not.toHaveBeenCalled();
  });

  it("answers a retryable failure and logs only a safe error label when disabling fails", async () => {
    const f = fixture();
    f.disableAccount.mockRejectedValue(new Error(`${DELETED} ${SECRET}`));
    const input = await request();
    const response = await f.handle(input, ENV);
    expect(response.status).toBe(500);
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.error).toHaveBeenCalledExactlyOnceWith("clerk_webhook_failed", { error: "Error" });
    const logged = JSON.stringify(f.error.mock.calls);
    for (const privateValue of [
      DELETED,
      SECRET,
      "user_trial",
      input.headers.get("svix-signature") ?? "",
    ])
      expect(logged).not.toContain(privateValue);
  });

  it("answers a retryable failure when the database cannot open", async () => {
    const f = fixture();
    f.openDatabase.mockRejectedValue(new Error("private database detail"));
    expect((await f.handle(await request(), ENV)).status).toBe(500);
    expect(f.disableAccount).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledExactlyOnceWith("clerk_webhook_failed", { error: "Error" });
  });

  it("acknowledges committed deletion even when connection cleanup fails", async () => {
    const f = fixture();
    f.close.mockRejectedValue(new Error("private database detail"));
    expect((await f.handle(await request(), ENV)).status).toBe(200);
    expect(f.disableAccount).toHaveBeenCalledOnce();
    expect(f.error).toHaveBeenCalledExactlyOnceWith("clerk_webhook_close_failed", {
      error: "Error",
    });
  });

  it("routes Clerk separately from Telegram without building bot or AI dependencies", async () => {
    const f = fixture();
    const fake = createFakePilotRuntime();
    const worker = createWorker({ ...fake.runtime, clerk: f.handle });
    const context = createExecutionContext();
    const response = await worker.fetch(
      await request(),
      {
        ...ENV,
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_WEBHOOK_SECRET: "",
        ANTHROPIC_API_KEY: "",
        DEEPGRAM_API_KEY: "",
      },
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(200);
    expect(f.disableAccount).toHaveBeenCalledOnce();
    expect(fake.channelsBuilt()).toBe(0);
    expect(fake.built()).toBe(0);
    expect(fake.inbound).toEqual([]);
    expect(fake.apiRequests).toEqual([]);
  });

  it.each(["GET", "HEAD", "PUT"])("does not expose a %s lifecycle route", async (method) => {
    const f = fixture();
    const fake = createFakePilotRuntime();
    const context = createExecutionContext();
    const response = await createWorker({ ...fake.runtime, clerk: f.handle }).fetch(
      new Request(URL, { method }),
      ENV,
      context,
    );
    await waitOnExecutionContext(context);
    expect(response.status).toBe(404);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});
