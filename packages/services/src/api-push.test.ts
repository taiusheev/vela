import { ApiMe, ApiPushDevice, ApiPushDeviceRemoved, ApiUser } from "@vela/contracts";
import { outboundKey } from "@vela/core";
import { channelLinks, members, outbound, pushDevices, users } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { disableApiAccount, updateApiAccount } from "./api-account-writes.ts";
import { loadApiMe } from "./api-accounts.ts";
import { ApiIdempotencyError } from "./api-idempotency.ts";
import { leaveApiFamily } from "./api-members.ts";
import { type ApiPushDeps, registerApiPushDevice, removeApiPushDevice } from "./api-push.ts";
import { VelaError } from "./errors.ts";
import type { DeviceAlerts } from "./push-devices.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedGroupMember } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
let miaId: string;
let annaId: string;

const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const anna: SessionIdentity = { authSubject: "auth|Anna", sessionId: "session-2" };
const nobody: SessionIdentity = { authSubject: "auth|nobody", sessionId: "session-3" };

const X = "0198f6aa-0000-7000-8000-0000000000a1";
const Y = "0198f6aa-0000-7000-8000-0000000000b2";

/** A push token made at run time: a literal shaped like one looks like a credential to scanning. */
function token(label: string): string {
  return `${["Exponent", "PushToken"].join("")}[api-push-${label}]`;
}

const ALERTS: DeviceAlerts = {
  adminConversationId: "9001",
  publicBaseUrl: "https://vela.test",
  pushSending: true,
};

async function account(identity: SessionIdentity, memberId?: string): Promise<string> {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: identity.authSubject })
    .returning();
  if (user === undefined) throw new Error("expected an account");
  if (memberId !== undefined) {
    await h.db.update(members).set({ userId: user.id }).where(eq(members.id, memberId));
  }
  return user.id;
}

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  miaId = await account(mia, seed.organiser.id);
  annaId = await account(anna);
});
afterAll(async () => {
  await h.close();
});

let keys = 0;
function nextKey(): string {
  keys += 1;
  return `key-${keys}`;
}

function device(overrides: Record<string, unknown> = {}) {
  return {
    installation_id: X,
    token: token("one"),
    platform: "android",
    permission: "granted",
    quiet_channel_blocked: false,
    ...overrides,
  };
}

function register(
  who: SessionIdentity,
  input: unknown = device(),
  key = nextKey(),
  deps: ApiPushDeps = h.deps,
) {
  return registerApiPushDevice(deps, who, key, input);
}

function remove(
  who: SessionIdentity,
  installationId = X,
  key = nextKey(),
  deps: ApiPushDeps = h.deps,
) {
  return removeApiPushDevice(deps, who, key, installationId, {});
}

async function devices() {
  return h.db.select().from(pushDevices).orderBy(asc(pushDevices.installationId));
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (error instanceof VelaError) return error.code;
  if (error instanceof ApiIdempotencyError) return error.code;
  return error;
}

describe("registerApiPushDevice", () => {
  it("registers this installation for the account and answers it without its token", async () => {
    const registered = await register(mia);

    expect(registered.replayed).toBe(false);
    expect(registered.after).toEqual({ outboundIds: [], wakeMemberIds: [] });
    expect(registered.response).toEqual({
      status: 200,
      body: {
        installation_id: X,
        platform: "android",
        permission: "granted",
        quiet_channel_blocked: false,
        registered_at: h.clock.now().toISOString(),
      },
    });
    expect(ApiPushDevice.parse(registered.response.body)).toEqual(registered.response.body);
    expect(JSON.stringify(registered.response.body)).not.toContain("PushToken");
    expect(await devices()).toMatchObject([
      {
        userId: miaId,
        installationId: X,
        token: token("one"),
        platform: "android",
        permission: "granted",
        quietChannelBlocked: false,
        registeredAt: h.clock.now(),
      },
    ]);
  });

  it("takes an installation id in capitals as the same installation", async () => {
    await register(mia);
    await register(mia, device({ installation_id: X.toUpperCase() }));

    expect((await devices()).map((row) => row.installationId)).toEqual([X]);
  });

  it("refreshes the same installation under the same device: its token, what it allows, and when", async () => {
    await register(mia);
    const [first] = await devices();
    h.clock.advanceMinutes(60);

    await register(
      mia,
      device({ token: token("two"), permission: "denied", quiet_channel_blocked: true }),
    );

    expect(await devices()).toEqual([
      {
        ...first,
        token: token("two"),
        permission: "denied",
        quietChannelBlocked: true,
        registeredAt: h.clock.now(),
      },
    ]);
  });

  it("replays a repeated key without writing, and refuses the key with another body", async () => {
    const first = await register(mia, device(), "same");
    h.clock.advanceMinutes(5);

    const replay = await register(mia, device(), "same");
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await devices())[0]?.registeredAt).toEqual(
      new Date(ApiPushDevice.parse(first.response.body).registered_at),
    );

    expect(await failure(register(mia, device({ permission: "denied" }), "same"))).toBe("conflict");
  });

  it("moves an installation another account registered to this one: the phone changed hands", async () => {
    await register(anna);

    await register(mia, device({ token: token("mia") }));

    expect(await devices()).toMatchObject([
      { installationId: X, userId: miaId, token: token("mia") },
    ]);
  });

  it("takes a token from the installation it was registered under", async () => {
    await register(anna, device({ installation_id: Y }));

    await register(mia);

    expect(await devices()).toMatchObject([
      { installationId: X, userId: miaId, token: token("one") },
    ]);
  });

  it("settles both keys at once: the installation's row moves and the token's other row goes", async () => {
    await register(anna, device({ token: token("x") }));
    await register(mia, device({ installation_id: Y, token: token("y") }));

    await register(mia, device({ token: token("y") }));

    expect(await devices()).toMatchObject([
      { installationId: X, userId: miaId, token: token("y") },
    ]);
  });

  it("answers not_found for an account that does not exist, or was deleted", async () => {
    expect(await failure(register(nobody))).toBe("not_found");
    await disableApiAccount(h.deps, anna.authSubject);
    expect(await failure(register(anna))).toBe("not_found");
    expect(await devices()).toEqual([]);
  });

  it("refuses what is not the contract's before a transaction", async () => {
    const transaction = vi.spyOn(h.db, "transaction");
    try {
      for (const input of [
        null,
        {},
        device({ token: "not-a-token" }),
        device({ platform: "web" }),
        device({ permission: "maybe" }),
        device({ installation_id: "not-an-id" }),
        device({ user_id: annaId }),
        (({ permission: _, ...rest }) => rest)(device()),
      ]) {
        expect(await failure(register(mia, input)), JSON.stringify(input)).toBe("invalid");
      }
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });
});

describe("removeApiPushDevice", () => {
  it("removes the caller's own installation", async () => {
    await register(mia);

    const removed = await remove(mia);

    expect(ApiPushDeviceRemoved.parse(removed.response.body)).toEqual({
      installation_id: X,
      removed: true,
    });
    expect(await devices()).toEqual([]);
  });

  it("leaves another account's installation where it is, answering removed: false, never 403", async () => {
    await register(anna);

    const removed = await remove(mia);

    expect(removed.response).toEqual({
      status: 200,
      body: { installation_id: X, removed: false },
    });
    expect(await devices()).toMatchObject([{ installationId: X, userId: annaId }]);
  });

  it("answers removed: false for an installation nobody has, and replays", async () => {
    const first = await remove(mia, Y.toUpperCase(), "gone");
    const replay = await remove(mia, Y, "gone");

    expect(first.response.body).toEqual({ installation_id: Y, removed: false });
    expect(replay).toEqual({ ...first, replayed: true });
  });

  it("answers not_found for a path that is no installation, or an account that is not there", async () => {
    expect(await failure(remove(mia, "not-an-id"))).toBe("not_found");
    expect(await failure(remove(nobody))).toBe("not_found");
    expect(await failure(removeApiPushDevice(h.deps, mia, nextKey(), X, { why: 1 }))).toBe(
      "invalid",
    );
  });
});

describe("the founder, told when a device leaves a family with nobody to tell", () => {
  const withAlerts: () => ApiPushDeps = () => ({ ...h.deps, alerts: ALERTS });

  /** Mia organises alone, and her Telegram link is blocked: her phone is all that tells her. */
  beforeEach(async () => {
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.organiserLink.id));
    await register(mia);
  });

  function alertKey(occasion: string): string {
    return outboundKey("system", {
      conversationId: "9001",
      suffix: `organisers_unreachable:${occasion}`,
    });
  }

  async function alertRows() {
    return h.db
      .select()
      .from(outbound)
      .where(eq(outbound.kind, "system"))
      .orderBy(asc(outbound.queuedAt));
  }

  it("writes the alert with the removal, and hands it over after the commit, once", async () => {
    const [before] = await devices();

    const removed = await remove(mia, X, "sign-out", withAlerts());

    const rows = await alertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memberId: seed.organiser.id,
      channel: "telegram",
      conversationId: "9001",
      status: "queued",
      idempotencyKey: alertKey(`push_device_removed:${before?.id}`),
    });
    expect(removed.after).toEqual({ outboundIds: [rows[0]?.id], wakeMemberIds: [] });
    expect(h.queues.outbound.pending).toEqual([]);

    const replay = await remove(mia, X, "sign-out", withAlerts());
    expect(replay.after).toEqual({ outboundIds: [], wakeMemberIds: [] });
    expect(await alertRows()).toHaveLength(1);
  });

  it("writes nothing while push is off, or with no alerts given", async () => {
    await remove(mia, X, nextKey(), { ...h.deps, alerts: { ...ALERTS, pushSending: false } });
    await register(mia);
    await remove(mia, X, nextKey(), h.deps);
    await register(mia);
    await remove(mia, X, nextKey(), {
      ...h.deps,
      alerts: { ...ALERTS, adminConversationId: null },
    });

    expect(await alertRows()).toEqual([]);
  });

  it("writes nothing while her organiser still has an unblocked Telegram link", async () => {
    await h.db
      .update(channelLinks)
      .set({ blockedAt: null })
      .where(eq(channelLinks.id, seed.organiserLink.id));

    await remove(mia, X, nextKey(), withAlerts());

    expect(await alertRows()).toEqual([]);
  });

  it("writes nothing while another of the account's phones can be told", async () => {
    await register(mia, device({ installation_id: Y, token: token("second") }));

    await remove(mia, X, nextKey(), withAlerts());

    expect(await alertRows()).toEqual([]);
  });

  it("writes nothing while another organiser has a phone that can be told", async () => {
    const other = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      externalId: "4001",
      role: "organiser",
    });
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, other.link.id));
    await h.db.update(members).set({ userId: annaId }).where(eq(members.id, other.member.id));
    await register(anna, device({ installation_id: Y, token: token("anna") }));

    await remove(mia, X, nextKey(), withAlerts());

    expect(await alertRows()).toEqual([]);
  });

  it("writes nothing for a phone that could not be told anyway", async () => {
    await register(mia, device({ permission: "denied" }));
    expect(await alertRows()).toEqual([]);

    await remove(mia, X, nextKey(), withAlerts());

    expect(await alertRows()).toEqual([]);
  });

  it("writes the alert when the phone is registered again without permission", async () => {
    const [before] = await devices();
    h.clock.advanceMinutes(1);

    const registered = await register(
      mia,
      device({ permission: "denied" }),
      nextKey(),
      withAlerts(),
    );

    const rows = await alertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toBe(
      alertKey(`push_device_changed:${before?.id}:${h.clock.now().getTime()}`),
    );
    expect(registered.after.outboundIds).toEqual([rows[0]?.id]);
  });

  it("writes the alert when the phone moves to another account", async () => {
    const moved = await register(anna, device({ token: token("anna") }), nextKey(), withAlerts());

    const rows = await alertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.memberId).toBe(seed.organiser.id);
    expect(moved.after.outboundIds).toEqual([rows[0]?.id]);
  });

  it("writes nothing when the same account's phone is refreshed and can still be told", async () => {
    await register(mia, device({ token: token("fresh") }), nextKey(), withAlerts());

    expect(await alertRows()).toEqual([]);
  });
});

describe("One moment a day", () => {
  it("is switched off and on through PATCH /v1/me, and GET /v1/me says so", async () => {
    const off = await updateApiAccount(h.deps, mia, nextKey(), { one_moment_a_day: false });

    expect(ApiUser.parse(off.response.body).id).toBe(miaId);
    const me = await loadApiMe(h.db, mia);
    expect(me?.one_moment_a_day).toBe(false);
    expect(ApiMe.parse({ ...me, photos: false, push: false }).one_moment_a_day).toBe(false);

    await updateApiAccount(h.deps, mia, nextKey(), { one_moment_a_day: true, tz: "UTC" });
    expect(await loadApiMe(h.db, mia)).toMatchObject({
      user: { tz: "UTC" },
      one_moment_a_day: true,
    });
  });
});

describe("devices, which belong to the account", () => {
  it("stay while the account keeps another family, and go with its last Leave", async () => {
    const sam: SessionIdentity = { authSubject: "auth|Sam", sessionId: "session-4" };
    const first = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "4002",
    });
    const secondFamily = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const second = await seedGroupMember(h.db, secondFamily, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "4003",
    });
    const samId = await account(sam, first.member.id);
    await h.db.update(members).set({ userId: samId }).where(eq(members.id, second.member.id));
    await register(sam, device({ installation_id: Y, token: token("sam") }));
    await register(mia);

    await leaveApiFamily(h.deps, sam, nextKey(), seed.family.id, first.member.id, {});
    expect((await devices()).map((row) => row.userId)).toEqual([miaId, samId]);

    await leaveApiFamily(h.deps, sam, nextKey(), secondFamily.family.id, second.member.id, {});
    expect((await devices()).map((row) => row.userId)).toEqual([miaId]);
  });

  it("go when the account is deleted, and nobody else's do", async () => {
    await register(mia);
    await register(anna, device({ installation_id: Y, token: token("anna") }));

    await disableApiAccount(h.deps, mia.authSubject);

    expect((await devices()).map((row) => row.userId)).toEqual([annaId]);
  });
});
