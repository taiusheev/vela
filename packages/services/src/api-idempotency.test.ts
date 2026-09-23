import type { ApiMutationResponse } from "@vela/contracts";
import { apiRequestReceipts, consents, families, members, users } from "@vela/db";
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import {
  ApiIdempotencyError,
  type ApiMutationAction,
  type ApiMutationRequest,
  MAX_API_RECEIPTS_PER_ACTOR,
  runApiMutation,
} from "./api-idempotency.ts";
import { sha256Hex } from "./hash.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

let h: Harness;
const identity: SessionIdentity = { authSubject: "private-auth-subject", sessionId: "session-one" };
const request: ApiMutationRequest = {
  key: "private-key",
  operation: "account.provision:v1",
  input: { value: "private-input" },
};
const response: ApiMutationResponse = { status: 201, body: { saved: true } };
const day = 24 * 60 * 60 * 1_000;
const missingId = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

function action(result: ApiMutationResponse = response): ApiMutationAction {
  return {
    authorize: vi.fn(async () => {}),
    mutate: vi.fn(async () => result),
  };
}

function run(change: Partial<ApiMutationRequest> = {}, callback = action(), actor = identity) {
  return runApiMutation(h.deps, actor, { ...request, ...change }, callback);
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function receipts() {
  return h.db.select().from(apiRequestReceipts);
}

async function seedActorReceipts(
  total = 1_000,
  actor = identity,
  expiresAt = new Date(h.clock.now().getTime() + day),
) {
  const actorHash = await sha256Hex(actor.authSubject);
  const requestHash = await sha256Hex(
    '{"familyId":null,"input":{"value":"private-input"},"memberId":null,"operation":"account.provision:v1"}',
  );
  const rows = await Promise.all(
    Array.from({ length: total }, async (_, index) => ({
      actorHash,
      keyHash: await sha256Hex(index === 0 ? request.key : `seed-${index}`),
      requestHash,
      result: response,
      createdAt: new Date(expiresAt.getTime() - day),
      expiresAt,
    })),
  );
  return h.db.insert(apiRequestReceipts).values(rows).returning();
}

async function seedScope() {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  await h.db.delete(consents).where(eq(consents.memberId, seed.member.id));
  return seed;
}

async function expectInvalid(change: Partial<ApiMutationRequest>, actor = identity) {
  const transaction = vi.spyOn(h.db, "transaction");
  try {
    await expect(run(change, action(), actor)).rejects.toMatchObject({
      name: "ApiIdempotencyError",
      code: "invalid",
      message: "Invalid API mutation request",
    });
    expect(transaction).not.toHaveBeenCalled();
  } finally {
    transaction.mockRestore();
  }
}

describe("runApiMutation", () => {
  it("takes a parameterized actor transaction lock before reserving or authorizing", async () => {
    const transaction = h.db.transaction.bind(h.db);
    const actorHash = await sha256Hex(identity.authSubject);
    const wrapper = vi.spyOn(h.db, "transaction").mockImplementation((callback, config) =>
      transaction(async (tx) => {
        const execute = vi.spyOn(tx, "execute");
        const insert = vi.spyOn(tx, "insert");
        const result = await callback(tx);
        const query = execute.mock.calls[0]?.[0];
        if (query === undefined || typeof query === "string") throw new Error("expected SQL lock");
        expect(new PgDialect().sqlToQuery(query.getSQL())).toMatchObject({
          sql: "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          params: [actorHash],
        });
        expect(execute.mock.invocationCallOrder[0]).toBeLessThan(
          insert.mock.invocationCallOrder[0] ?? 0,
        );
        return result;
      }, config),
    );
    try {
      await run();
      await run();
      await run({ key: "different-key" });
      expect(wrapper).toHaveBeenCalledTimes(3);
    } finally {
      wrapper.mockRestore();
    }
  });

  it("propagates actor lock failure without reserving or authorizing", async () => {
    const failure = new Error("actor lock failed");
    const transaction = h.db.transaction.bind(h.db);
    const wrapper = vi.spyOn(h.db, "transaction").mockImplementation((callback, config) =>
      transaction(async (tx) => {
        vi.spyOn(tx, "execute").mockRejectedValueOnce(failure);
        const insert = vi.spyOn(tx, "insert");
        try {
          return await callback(tx);
        } finally {
          expect(insert).not.toHaveBeenCalled();
        }
      }, config),
    );
    const callback = action();
    try {
      await expect(run({}, callback)).rejects.toBe(failure);
      expect(callback.authorize).not.toHaveBeenCalled();
      expect(callback.mutate).not.toHaveBeenCalled();
      expect(await receipts()).toEqual([]);
    } finally {
      wrapper.mockRestore();
    }
  });

  it("replays the original cloned result across refreshed sessions without extending expiry", async () => {
    const original: ApiMutationResponse = { status: 201, body: { saved: [1, 2] } };
    const first = await run({}, action(original));
    const before = await receipts();
    expect(first).toEqual({ response: original, replayed: false });
    expect(first.response).not.toBe(original);
    original.body = null;
    h.clock.advance(1_000);
    const callback = action({ status: 200, body: "replacement" });
    expect(await run({}, callback, { ...identity, sessionId: "refreshed" })).toEqual({
      response: { status: 201, body: { saved: [1, 2] } },
      replayed: true,
    });
    expect(callback.authorize).toHaveBeenCalledOnce();
    expect(callback.mutate).not.toHaveBeenCalled();
    expect(await receipts()).toEqual(before);
  });

  it("canonicalizes nested object order and preserves prototype-looking keys as data", async () => {
    const input = JSON.parse('{"z":1,"constructor":{"b":2,"a":1},"__proto__":{"x":3}}');
    const reordered = JSON.parse('{"__proto__":{"x":3},"constructor":{"a":1,"b":2},"z":1}');
    const saved: ApiMutationResponse = { status: 200, body: input };
    await run({ input }, action(saved));
    expect(await run({ input: reordered })).toEqual({ response: saved, replayed: true });
    expect(Object.hasOwn((await run({ input })).response.body as object, "__proto__")).toBe(true);
    await expect(run({ input: { z: 1, constructor: { a: 1, b: 2 } } })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it.each([
    { input: { value: "changed" } },
    { operation: "account.update:v1" },
    { familyId: missingId },
  ])("rejects changed request %j after authorizing", async (change) => {
    await run();
    const callback = action();
    await expect(run(change, callback)).rejects.toMatchObject({
      name: "ApiIdempotencyError",
      code: "conflict",
    });
    expect(callback.authorize).toHaveBeenCalledOnce();
    expect(callback.mutate).not.toHaveBeenCalled();
  });

  it("preserves array order and scopes keys only by actor", async () => {
    await run({ input: [1, 2] });
    await expect(run({ input: [2, 1] })).rejects.toMatchObject({ code: "conflict" });
    expect(await run({ input: [2, 1] }, action(), { ...identity, authSubject: "other" })).toEqual({
      response,
      replayed: false,
    });
    expect(await receipts()).toHaveLength(2);
  });

  it("stores hashes, not raw keys, request inputs, subjects or sessions", async () => {
    await run();
    expect(await receipts()).toEqual([
      expect.objectContaining({
        actorHash: await sha256Hex(identity.authSubject),
        keyHash: await sha256Hex(request.key),
        requestHash: await sha256Hex(
          '{"familyId":null,"input":{"value":"private-input"},"memberId":null,"operation":"account.provision:v1"}',
        ),
        familyId: null,
        memberId: null,
        result: response,
      }),
    ]);
    const stored = JSON.stringify(await receipts());
    for (const secret of [identity.authSubject, identity.sessionId, request.key, "private-input"]) {
      expect(stored).not.toContain(secret);
    }
    expect(h.logger.entries).toEqual([]);
    expect(h.queues.outbound.pending).toEqual([]);
  });

  it.each([false, true])(
    "rolls back authorization denial with existing receipt=%s",
    async (existing) => {
      if (existing) await run();
      const before = await receipts();
      const denial = new Error("denied");
      const callback = action();
      callback.authorize = async (tx) => {
        await tx.insert(users).values({ displayName: "rolled back" });
        throw denial;
      };
      await expect(run({ input: "conflicting" }, callback)).rejects.toBe(denial);
      expect(callback.mutate).not.toHaveBeenCalled();
      expect(await receipts()).toEqual(before);
      expect(await h.db.select().from(users)).toEqual([]);
    },
  );

  it("serializes simultaneous attempts into one mutation", async () => {
    const callback = action();
    const results = await Promise.all(Array.from({ length: 6 }, () => run({}, callback)));
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    for (const result of results) expect(result.response).toEqual(response);
    expect(callback.authorize).toHaveBeenCalledTimes(6);
    expect(callback.mutate).toHaveBeenCalledOnce();
    expect(await receipts()).toHaveLength(1);
  });

  it("fails unavailable without mutating if the reservation and subsequent lookup find no row", async () => {
    await run();
    const before = await receipts();
    await h.db.execute(sql`create function pg_temp.disappear_api_receipt() returns trigger language plpgsql as $$
      begin
        delete from api_request_receipts where actor_hash = new.actor_hash and key_hash = new.key_hash;
        return null;
      end;
    $$`);
    await h.db.execute(sql`create trigger disappear_api_receipt before insert on api_request_receipts
      for each row execute function pg_temp.disappear_api_receipt()`);
    try {
      const callback = action();
      await expect(run({}, callback)).rejects.toMatchObject({
        name: "ApiIdempotencyError",
        code: "unavailable",
      });
      expect(callback.authorize).not.toHaveBeenCalled();
      expect(callback.mutate).not.toHaveBeenCalled();
      expect(await receipts()).toEqual(before);
    } finally {
      await h.db.execute(sql`drop trigger disappear_api_receipt on api_request_receipts`);
      await h.db.execute(sql`drop function pg_temp.disappear_api_receipt()`);
    }
  });

  it.each([request.key, "different-key"])(
    "authorizes key %s only after waiting for the actor and observes revocation",
    async (key) => {
      const entered = deferred();
      const release = deferred();
      let allowed = true;
      const first = run(
        {},
        {
          authorize: async () => {},
          mutate: async () => {
            entered.resolve();
            await release.promise;
            allowed = false;
            return response;
          },
        },
      );
      await entered.promise;
      const denial = new Error("denied");
      const callback = action();
      callback.authorize = vi.fn(async () => {
        if (!allowed) throw denial;
      });
      const second = run({ key }, callback);
      const rejected = expect(second).rejects.toBe(denial);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(callback.authorize).not.toHaveBeenCalled();
      release.resolve();
      await first;
      await rejected;
      expect(callback.authorize).toHaveBeenCalledOnce();
      expect(callback.mutate).not.toHaveBeenCalled();
      expect(await receipts()).toHaveLength(1);
    },
  );

  it("propagates mutation failure and rolls back its writes and reservation", async () => {
    const failure = new Error("mutation failure");
    await expect(
      run(
        {},
        {
          authorize: async () => {},
          mutate: async (tx) => {
            await tx.insert(users).values({ displayName: "rolled back" });
            throw failure;
          },
        },
      ),
    ).rejects.toBe(failure);
    expect(await receipts()).toEqual([]);
    expect(await h.db.select().from(users)).toEqual([]);
    expect((await run()).replayed).toBe(false);
  });

  it.each([
    { status: 400, body: null },
    { status: 204, body: {} },
    { status: 200, body: undefined },
    { status: 200, body: new Date() },
    { status: 200, body: Number.NaN },
    { status: 200, body: "x".repeat(16_384) },
    { status: 200, body: "界".repeat(6_000) },
  ])(
    "rolls back invalid or oversized callback response %# as a server failure",
    async (invalid) => {
      const error = await run(
        {},
        {
          authorize: async () => {},
          mutate: async (tx) => {
            await tx.insert(users).values({ displayName: "rolled back" });
            return invalid as ApiMutationResponse;
          },
        },
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ApiIdempotencyError);
      expect(await receipts()).toEqual([]);
      expect(await h.db.select().from(users)).toEqual([]);
    },
  );

  it("accepts exactly 16 KiB of encoded envelope and response, but rejects one byte more", async () => {
    const overhead = JSON.stringify({
      operation: request.operation,
      input: "",
      familyId: null,
      memberId: null,
    }).length;
    const input = "x".repeat(16_384 - overhead);
    const saved: ApiMutationResponse = {
      status: 200,
      body: "x".repeat(16_384 - JSON.stringify({ status: 200, body: "" }).length),
    };
    expect((await run({ input }, action(saved))).response).toEqual(saved);
    expect((await run({ input })).response).toEqual(saved);
    await expectInvalid({ input: `${input}x` });
    await expect(
      run({ key: "oversize-result" }, action({ status: 200, body: `${saved.body}x` })),
    ).rejects.toThrow("Invalid API mutation response");
    expect(await receipts()).toHaveLength(1);
  });

  it("rolls back mutation writes when the completion clock is invalid", async () => {
    await expect(
      run(
        {},
        {
          authorize: async () => {},
          mutate: async (tx) => {
            await tx.insert(users).values({ displayName: "rolled back" });
            h.clock.set(new Date(Number.NaN));
            return response;
          },
        },
      ),
    ).rejects.toThrow("Invalid API mutation clock");
    expect(await receipts()).toEqual([]);
    expect(await h.db.select().from(users)).toEqual([]);
  });

  it("supports 204 only with a null body", async () => {
    const saved: ApiMutationResponse = { status: 204, body: null };
    expect(await run({}, action(saved))).toEqual({ response: saved, replayed: false });
    expect(await run()).toEqual({ response: saved, replayed: true });
  });

  it("starts the 24-hour window at completion and overwrites the same row at exact expiry", async () => {
    const start = h.clock.now().getTime();
    await run(
      {},
      {
        authorize: async () => {},
        mutate: async () => {
          h.clock.advance(5_000);
          return response;
        },
      },
    );
    const [first] = await receipts();
    expect(first).toMatchObject({
      createdAt: new Date(start + 5_000),
      expiresAt: new Date(start + 5_000 + day),
    });
    h.clock.advance(day - 1);
    expect((await run()).replayed).toBe(true);
    h.clock.advance(1);
    const replacement: ApiMutationResponse = { status: 202, body: "new" };
    expect(await run({ operation: "account.update:v2", input: [3] }, action(replacement))).toEqual({
      response: replacement,
      replayed: false,
    });
    expect(await receipts()).toEqual([
      expect.objectContaining({
        id: first?.id,
        result: replacement,
        createdAt: new Date(start + 5_000 + day),
        expiresAt: new Date(start + 5_000 + 2 * day),
      }),
    ]);
    await expect(run()).rejects.toMatchObject({ code: "conflict" });
    expect((await run({ operation: "account.update:v2", input: [3] })).replayed).toBe(true);
  });

  it.each([null, { status: 500, body: null }, { status: 204, body: "bad" }])(
    "never mutates an unexpired incomplete or invalid receipt %#",
    async (result) => {
      await run();
      await h.db.update(apiRequestReceipts).set({ result });
      const callback = action();
      const error = await run({}, callback).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ApiIdempotencyError);
      expect(callback.authorize).toHaveBeenCalledOnce();
      expect(callback.mutate).not.toHaveBeenCalled();
    },
  );

  it.each(["member", "family"])(
    "assigns canonical scope FKs and cascades on %s deletion",
    async (target) => {
      const seed = await seedScope();
      const scope = { familyId: seed.family.id, memberId: seed.member.id };
      await run({ familyId: scope.familyId.toUpperCase(), memberId: scope.memberId.toUpperCase() });
      expect(await receipts()).toEqual([expect.objectContaining(scope)]);
      expect((await run(scope)).replayed).toBe(true);
      await expect(run({ ...scope, memberId: seed.organiser.id })).rejects.toMatchObject({
        code: "conflict",
      });
      if (target === "member") {
        await h.db.delete(members).where(eq(members.id, scope.memberId));
      } else {
        await h.db.delete(families).where(eq(families.id, scope.familyId));
      }
      expect(await receipts()).toEqual([]);
    },
  );

  it("reserves with null FKs before creating a scoped family inside the mutation", async () => {
    await run(
      { familyId: missingId },
      {
        authorize: async (tx) => {
          expect(await tx.select().from(apiRequestReceipts)).toEqual([
            expect.objectContaining({ familyId: null, memberId: null, result: null }),
          ]);
        },
        mutate: async (tx) => {
          await tx
            .insert(families)
            .values({ id: missingId, name: "Created", region: "apac", country: "TW" });
          return response;
        },
      },
    );
    expect(await receipts()).toEqual([
      expect.objectContaining({ familyId: missingId, result: response }),
    ]);
  });

  it("checks member/family association only after authorization", async () => {
    const seed = await seedScope();
    const callback = action();
    const error = await run({ familyId: missingId, memberId: seed.member.id }, callback).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiIdempotencyError);
    expect(callback.authorize).toHaveBeenCalledOnce();
    expect(callback.mutate).not.toHaveBeenCalled();
    expect(await receipts()).toEqual([]);
    const denial = new Error("denied");
    callback.authorize = async (tx) => {
      expect(await tx.select().from(apiRequestReceipts)).toEqual([
        expect.objectContaining({ familyId: null, memberId: null }),
      ]);
      throw denial;
    };
    await expect(run({ familyId: missingId, memberId: seed.member.id }, callback)).rejects.toBe(
      denial,
    );
    expect(await receipts()).toEqual([]);
  });

  it("rolls back when an expired receipt disappears through its old scope cascade", async () => {
    const seed = await seedScope();
    await run({ familyId: seed.family.id });
    const before = await receipts();
    h.clock.advance(day);
    const error = await run(
      {},
      {
        authorize: async () => {},
        mutate: async (tx) => {
          await tx.delete(families).where(eq(families.id, seed.family.id));
          return response;
        },
      },
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: "API mutation receipt update failed" });
    expect(await receipts()).toEqual(before);
    expect(await h.db.select().from(families)).toHaveLength(1);
  });

  it("rolls back scope deletion during a new mutation instead of committing a missing target", async () => {
    const seed = await seedScope();
    await expect(
      run(
        { familyId: seed.family.id, memberId: seed.member.id },
        {
          authorize: async () => {},
          mutate: async (tx) => {
            await tx.delete(members).where(eq(members.id, seed.member.id));
            return response;
          },
        },
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(await receipts()).toEqual([]);
    expect(await h.db.select().from(members).where(eq(members.id, seed.member.id))).toHaveLength(1);
  });
});

describe("actor receipt storage bound", () => {
  it("rejects a fresh key at 1000 receipts without mutation or committed reservation", async () => {
    expect(MAX_API_RECEIPTS_PER_ACTOR).toBe(1_000);
    await seedActorReceipts();
    const before = await receipts();
    const callback = action();
    callback.authorize = vi.fn(async (tx) => {
      await tx.insert(users).values({ displayName: "rolled back authorization" });
    });
    await expect(run({ key: "over-capacity" }, callback)).rejects.toMatchObject({
      name: "ApiIdempotencyError",
      code: "rate_limited",
      message: "API mutation receipt limit reached",
    });
    expect(callback.authorize).toHaveBeenCalledOnce();
    expect(callback.mutate).not.toHaveBeenCalled();
    expect(await receipts()).toEqual(before);
    expect(await h.db.select().from(users)).toEqual([]);
  });

  it("allows matching replay at capacity, reauthorizes it, and preserves conflicts", async () => {
    await seedActorReceipts();
    const callback = action();
    expect(await run({}, callback)).toEqual({ response, replayed: true });
    expect(callback.authorize).toHaveBeenCalledOnce();
    expect(callback.mutate).not.toHaveBeenCalled();
    await expect(run({ input: "changed" })).rejects.toMatchObject({ code: "conflict" });
    const denial = new Error("denied");
    callback.authorize = vi.fn(async () => {
      throw denial;
    });
    await expect(run({}, callback)).rejects.toBe(denial);
    expect(callback.mutate).not.toHaveBeenCalled();
    expect(await receipts()).toHaveLength(1_000);
  });

  it("reclaims expired other rows at exact expiry to permit a fresh key", async () => {
    await seedActorReceipts(1_000, identity, h.clock.now());
    const callback = action();
    expect(await run({ key: "after-expiry" }, callback)).toEqual({ response, replayed: false });
    expect(callback.mutate).toHaveBeenCalledOnce();
    expect(await receipts()).toEqual([
      expect.objectContaining({ keyHash: await sha256Hex("after-expiry"), result: response }),
    ]);
  });

  it("preserves the current expired row ID while reclaiming other expired rows", async () => {
    const seeded = await seedActorReceipts(1_000, identity, h.clock.now());
    const current = seeded[0];
    if (current === undefined) throw new Error("expected seeded receipt");
    const replacement: ApiMutationResponse = { status: 200, body: "replacement" };
    expect(await run({}, action(replacement))).toEqual({ response: replacement, replayed: false });
    expect(await receipts()).toEqual([
      expect.objectContaining({
        id: current?.id,
        result: replacement,
        expiresAt: new Date(h.clock.now().getTime() + day),
      }),
    ]);
  });

  it("reuses the current expired row at capacity without counting it twice", async () => {
    const seeded = await seedActorReceipts();
    const current = seeded[0];
    if (current === undefined) throw new Error("expected seeded receipt");
    await h.db
      .update(apiRequestReceipts)
      .set({ createdAt: new Date(h.clock.now().getTime() - day), expiresAt: h.clock.now() })
      .where(eq(apiRequestReceipts.id, current.id));
    const callback = action();
    expect(await run({}, callback)).toEqual({ response, replayed: false });
    expect(callback.mutate).toHaveBeenCalledOnce();
    expect(await receipts()).toHaveLength(1_000);
    expect(
      await h.db.select().from(apiRequestReceipts).where(eq(apiRequestReceipts.id, current.id)),
    ).toEqual([
      expect.objectContaining({
        id: current.id,
        expiresAt: new Date(h.clock.now().getTime() + day),
      }),
    ]);
  });

  it.each([false, true])(
    "keeps another actor's full receipt set independent with expired=%s",
    async (expired) => {
      const other = { ...identity, authSubject: "other-actor" };
      await seedActorReceipts(
        1_000,
        identity,
        new Date(h.clock.now().getTime() + (expired ? 0 : day)),
      );
      const before = await receipts();
      expect(await run({}, action(), other)).toEqual({ response, replayed: false });
      const actorHash = await sha256Hex(identity.authSubject);
      expect((await receipts()).filter((row) => row.actorHash === actorHash)).toEqual(before);
      expect(await receipts()).toHaveLength(1_001);
    },
  );

  it("reclaims expired rows on an authorized matching replay", async () => {
    const seeded = await seedActorReceipts(1_000, identity, h.clock.now());
    const current = seeded[0];
    if (current === undefined) throw new Error("expected seeded receipt");
    await h.db
      .update(apiRequestReceipts)
      .set({ createdAt: h.clock.now(), expiresAt: new Date(h.clock.now().getTime() + day) })
      .where(eq(apiRequestReceipts.id, current.id));
    expect(await run()).toEqual({ response, replayed: true });
    expect(await receipts()).toEqual([expect.objectContaining({ id: current.id })]);
  });

  it("rolls back cleanup when mutation fails", async () => {
    await seedActorReceipts(1_000, identity, h.clock.now());
    const before = await receipts();
    const failure = new Error("mutation failed");
    const callback = action();
    callback.mutate = vi.fn(async () => {
      throw failure;
    });
    await expect(run({ key: "failed" }, callback)).rejects.toBe(failure);
    expect(await receipts()).toEqual(before);
  });

  it("serializes fresh keys racing for the last available receipt slot", async () => {
    await seedActorReceipts(999);
    const callback = action();
    const results = await Promise.allSettled([
      run({ key: "last-slot-one" }, callback),
      run({ key: "last-slot-two" }, callback),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "rate_limited" }) }),
    ]);
    expect(callback.authorize).toHaveBeenCalledTimes(2);
    expect(callback.mutate).toHaveBeenCalledOnce();
    expect(await receipts()).toHaveLength(1_000);
  });
});

describe("validation before opening a transaction", () => {
  it.each(["", " ", "a/b", "a?b", "é", "x".repeat(201), "valid\n"])(
    "rejects key %j",
    async (key) => {
      await expectInvalid({ key });
    },
  );

  it.each(["", "Account:v1", "/account", "a b", "x".repeat(101), "valid\n"])(
    "rejects operation %j",
    async (operation) => {
      await expectInvalid({ operation });
    },
  );

  it.each([
    { familyId: "bad" },
    { memberId: missingId },
    { familyId: missingId, memberId: "bad" },
    { familyId: null },
  ])("rejects scope %#", async (scope) => {
    await expectInvalid(scope as Partial<ApiMutationRequest>);
  });

  it.each([
    { ...identity, authSubject: "" },
    { ...identity, authSubject: " \t" },
    { ...identity, sessionId: "" },
    { ...identity, sessionId: "\n" },
    { ...identity, authSubject: null },
    null,
  ])("rejects identity %#", async (actor) => {
    await expectInvalid({}, actor as SessionIdentity);
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(),
    new Map(),
    1n,
    { value: undefined },
    [undefined],
    new Array(2),
    Object.assign([1], { extra: 2 }),
    Object.assign([1], { "01": 2 }),
    "x".repeat(16_384),
    "界".repeat(6_000),
    new Array(20_000).fill(null),
    Object.fromEntries(Array.from({ length: 5_000 }, (_, index) => [index, null])),
    Array.from({ length: 34 }).reduce<unknown>((nested) => ({ nested }), null),
  ])("rejects non-JSON, deep or oversized input %#", async (input) => {
    await expectInvalid({ input });
  });

  it("rejects cycles, classes and accessors without invoking them", async () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expectInvalid({ input: cyclic });
    class NotJson {
      value = 1;
    }
    await expectInvalid({ input: new NotJson() });
    const getter = vi.fn(() => "secret");
    await expectInvalid({
      input: Object.defineProperty({}, "value", { enumerable: true, get: getter }),
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects invalid clocks before opening a transaction", async () => {
    h.clock.set(new Date(Number.NaN));
    const transaction = vi.spyOn(h.db, "transaction");
    try {
      await expect(run()).rejects.toBeInstanceOf(Error);
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });
});
