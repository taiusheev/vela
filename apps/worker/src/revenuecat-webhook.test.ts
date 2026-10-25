import type { StoreEvent } from "@vela/services";
import { describe, expect, it, vi } from "vitest";
import type { PilotEnv } from "./env.ts";
import { createRevenueCatWebhookHandler, storeEventOf } from "./revenuecat-webhook.ts";

const AUTH = "Bearer synthetic-revenuecat-authorization-value-0001";

function env(auth: string | undefined = AUTH): PilotEnv {
  return { REVENUECAT_WEBHOOK_AUTH: auth } as unknown as PilotEnv;
}

const BODY = {
  api_version: "1.0",
  event: {
    id: "evt-synthetic-1",
    type: "INITIAL_PURCHASE",
    app_user_id: "user_synthetic",
    subscriber_attributes: { vela_member_id: { value: "0190a0b0-0000-7000-8000-000000000001" } },
    expiration_at_ms: 1824854400000,
    period_type: "NORMAL",
    product_id: "vela_light_yearly",
    price_in_purchased_currency: 2490,
    currency: "TWD",
    original_transaction_id: "2000000000000001",
  },
};

function handler(apply = vi.fn(async () => "applied" as const)) {
  const close = vi.fn(async () => {});
  const ports = {
    clock: { now: () => new Date("2026-10-25T00:00:00Z") },
    apply,
    openDatabase: vi.fn(async () => ({ db: {} as never, close })),
    logger: () => ({ error: vi.fn(), info: vi.fn() }),
  };
  return { handle: createRevenueCatWebhookHandler(ports), ports, close };
}

function post(body: unknown, authorization: string | null = AUTH): Request {
  return new Request("https://vela.test/webhooks/revenuecat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization === null ? {} : { authorization }),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /webhooks/revenuecat", () => {
  it("is off until the Authorization value is set", async () => {
    const { handle, ports } = handler();
    const response = await handle(post(BODY), env(""));
    expect(response.status).toBe(503);
    expect(ports.openDatabase).not.toHaveBeenCalled();
  });

  it("refuses a wrong or missing Authorization value before reading the body", async () => {
    const { handle, ports } = handler();
    expect((await handle(post(BODY, "Bearer wrong"), env())).status).toBe(401);
    expect((await handle(post(BODY, null), env())).status).toBe(401);
    expect(ports.openDatabase).not.toHaveBeenCalled();
  });

  it("applies a well-formed purchase and closes the database", async () => {
    const { handle, ports, close } = handler();
    const response = await handle(post(BODY), env());
    expect(response.status).toBe(200);
    const [, event] = ports.apply.mock.calls[0] as unknown as [unknown, StoreEvent];
    expect(event).toMatchObject({
      type: "INITIAL_PURCHASE",
      appUserId: "user_synthetic",
      memberId: "0190a0b0-0000-7000-8000-000000000001",
      productId: "vela_light_yearly",
      price: 2490,
      currency: "TWD",
    });
    expect(close).toHaveBeenCalled();
  });

  it("answers 400 to a body that is not an event", async () => {
    const { handle } = handler();
    expect((await handle(post({ nothing: true }), env())).status).toBe(400);
  });

  it("answers 500 when the database cannot be reached, so RevenueCat retries", async () => {
    const { handle } = handler(
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect((await handle(post(BODY), env())).status).toBe(500);
  });
});

describe("storeEventOf", () => {
  it("reads no parent when the app sent none", () => {
    const event = storeEventOf({ event: { ...BODY.event, subscriber_attributes: {} } });
    expect(event?.memberId).toBeNull();
  });

  it("refuses an event with no id or payer", () => {
    expect(storeEventOf({ event: { ...BODY.event, id: "" } })).toBeNull();
    expect(storeEventOf({ event: { ...BODY.event, app_user_id: undefined } })).toBeNull();
  });
});
