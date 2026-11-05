import type { VelaDatabase } from "@vela/db";
import { describe, expect, it, vi } from "vitest";
import { type ApiRuntime, createApiApp } from "./api-app.ts";

function fixture(admitted: boolean, waiting: boolean) {
  const deleteClerkUser = vi.fn().mockResolvedValue("deleted");
  const deleteAccount = vi.fn().mockResolvedValue({
    released: [],
    after: { outboundIds: [], wakeMemberIds: [] },
  });
  const registerApiPushDevice = vi.fn().mockResolvedValue({
    response: {
      status: 200,
      body: {
        installation_id: "11111111-1111-4111-8111-111111111111",
        platform: "ios",
        permission: "granted",
        quiet_channel_blocked: false,
        registered_at: "2026-11-05T00:00:00Z",
      },
    },
    replayed: false,
    after: { outboundIds: [], wakeMemberIds: [] },
  });
  const runtime = {
    verifySession: async () => ({ authSubject: "synthetic-user", sessionId: "synthetic-session" }),
    openDatabase: async () => ({ db: {} as VelaDatabase, close: async () => {} }),
    services: {},
    logger: { error: vi.fn() },
    admission: {
      config: { telegramUserIds: [] },
      permitsAccount: async () => admitted,
      awaitsFamily: async () => waiting,
      appSetup: true,
    },
    push: true,
    writes: {
      clock: { now: () => new Date("2026-11-05T00:00:00Z") },
      verifyActiveSession: async () => true,
      accounts: { deleteClerkUser, deleteAccount },
      services: { registerApiPushDevice },
      nudges: { deliver: async () => {}, wake: async () => {} },
    },
  } as unknown as ApiRuntime;
  return { app: createApiApp(runtime), deleteAccount, deleteClerkUser, registerApiPushDevice };
}
function request(path: string, body: unknown = {}) {
  return new Request(`https://synthetic.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "synthetic-delete" },
    body: JSON.stringify(body),
  });
}

describe("account deletion must remain available regardless of pilot approval", () => {
  it("control: an admitted account reaches the deletion service", async () => {
    const f = fixture(true, false);
    expect((await f.app.request(request("/v1/me/delete"))).status).toBe(200);
    expect(f.deleteAccount).toHaveBeenCalledOnce();
  });
  it("lets an account waiting for family approval delete itself", async () => {
    const f = fixture(false, true);
    expect((await f.app.request(request("/v1/me/delete"))).status).toBe(200);
    expect(f.deleteAccount).toHaveBeenCalledOnce();
  });
  it("lets an account whose family was removed from the pilot delete itself", async () => {
    const f = fixture(false, false);
    expect((await f.app.request(request("/v1/me/delete"))).status).toBe(200);
    expect(f.deleteAccount).toHaveBeenCalledOnce();
  });
});

const phone = {
  installation_id: "11111111-1111-4111-8111-111111111111",
  token: "ExpoPushToken[synthetic-device]",
  platform: "ios",
  permission: "granted",
  quiet_channel_blocked: false,
};
describe("new app-setup invitation screen's notification prerequisite", () => {
  it("control: an admitted account can register its phone", async () => {
    const f = fixture(true, false);
    expect((await f.app.request(request("/v1/me/devices", phone))).status).toBe(200);
    expect(f.registerApiPushDevice).toHaveBeenCalledOnce();
  });
  it("lets a waiting account register the phone the waiting screen requests", async () => {
    const f = fixture(false, true);
    expect((await f.app.request(request("/v1/me/devices", phone))).status).toBe(200);
    expect(f.registerApiPushDevice).toHaveBeenCalledOnce();
  });
});
