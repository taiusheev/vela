import { apiRequestReceipts, families } from "@vela/db";
import { eq, lte } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import {
  type ApiMutationAction,
  type ApiMutationRequest,
  runApiMutation,
} from "../src/api-idempotency.ts";
import { sha256Hex } from "../src/hash.ts";
import { applyRetention } from "../src/jobs.ts";
import {
  type Calls,
  calls,
  databaseErrorCode,
  HOLD_MS,
  NOW,
  type Outcome,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
  writer,
  written,
} from "./testing.ts";

let pg: PostgresHarness;
const actor: SessionIdentity = { authSubject: "pg-race|cleanup", sessionId: "session-one" };
const otherActor: SessionIdentity = { authSubject: "pg-race|elsewhere", sessionId: "session-two" };
const request: ApiMutationRequest = {
  key: "race-key",
  operation: "race.write:v1",
  input: { value: "first" },
};
const hour = 60 * 60 * 1_000;
const unavailable = { name: "ApiIdempotencyError", code: "unavailable" };

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function mutate(
  client: RaceClient,
  action: ApiMutationAction,
  change: Partial<ApiMutationRequest> = {},
): Promise<Outcome> {
  return pg.track(runApiMutation(client.deps, actor, { ...request, ...change }, action));
}

async function holdMutation(
  label: string,
  record: Calls,
  change: Partial<ApiMutationRequest> = {},
) {
  const holder = await pg.client(label);
  const entered = pg.latch(`${label} entered mutate`);
  const hold = pg.latch(`${label} may finish`, HOLD_MS);
  const result = mutate(holder, writer(label, record, { entered, hold }), change);
  await pg.reach(`${label} to enter mutate`, entered, result);
  return { holder, hold, result };
}

async function seedExpired(authSubject: string) {
  return pg.seedReceipt(authSubject, request.key, {
    requestHash: await sha256Hex(
      '{"familyId":null,"input":{"value":"first"},"memberId":null,"operation":"race.write:v1"}',
    ),
    result: written("expired"),
    createdAt: new Date(NOW.getTime() - 25 * hour),
    expiresAt: new Date(NOW.getTime() - hour),
  });
}

describe("receipt cleanup on independent PostgreSQL connections", () => {
  it("reports unavailable without authorizing or mutating when another connection deletes the receipt it waits to lock", async () => {
    const seeded = await seedExpired(actor.authSubject);
    const cleaner = await pg.client("cleaner");
    const requester = await pg.client("requester");
    const locked = pg.latch("the cleaner locked the receipt");
    const release = pg.latch("the cleaner may delete", HOLD_MS);
    const cleaning = pg.track(
      cleaner.db.transaction(async (tx) => {
        await tx
          .select({ id: apiRequestReceipts.id })
          .from(apiRequestReceipts)
          .where(eq(apiRequestReceipts.id, seeded.id))
          .for("update");
        locked.release();
        await release.wait();
        await tx.delete(apiRequestReceipts).where(lte(apiRequestReceipts.expiresAt, NOW));
      }),
    );
    await pg.reach("the cleaner to lock the receipt", locked, cleaning);
    const record = calls();
    const attempt = mutate(requester, writer("requester", record));
    await pg.waitForRowLockWait(requester, [cleaner], attempt);
    expect(record).toEqual({ authorized: [], mutated: [] });

    release.release();
    await pg.finish("the cleaner", cleaning);
    await expect(pg.finish("the waiting request", attempt)).rejects.toMatchObject(unavailable);

    expect(record).toEqual({ authorized: [], mutated: [] });
    expect(await pg.receipts(actor.authSubject)).toEqual([]);
    expect(await pg.accounts()).toEqual([]);
    expect(
      await pg.finish("a retry after the cleanup", mutate(requester, writer("retry", record))),
    ).toEqual({ response: written("retry"), replayed: false });
  });

  it("keeps a receipt reused at expiry when the nightly retention job waits behind the reusing request", async () => {
    const seeded = await seedExpired(actor.authSubject);
    await seedExpired(otherActor.authSubject);
    const retentionClient = await pg.client("retention");
    const record = calls();
    const { holder, hold, result } = await holdMutation("reuse", record);
    const retention = pg.track(applyRetention(pg.jobDeps(retentionClient)));
    await pg.waitForRowLockWaitOrCompletion(retentionClient, [holder], retention);

    hold.release();
    expect(await pg.finish("the reusing request", result)).toEqual({
      response: written("reuse"),
      replayed: false,
    });
    const counts = await pg.finish("the retention job", retention);

    expect(counts.api_request_receipts_deleted).toBe(1);
    expect(await pg.receipts(actor.authSubject)).toEqual([
      expect.objectContaining({
        id: seeded.id,
        result: written("reuse"),
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 24 * hour),
      }),
    ]);
    expect(await pg.receipts(otherActor.authSubject)).toEqual([]);
    expect(record.mutated).toEqual(["reuse"]);
  });

  it("finishes both a request reusing an expired receipt and the nightly retention job when both delete the actor's older expired receipt", async () => {
    await pg.seedReceipt(actor.authSubject, "older-key", {
      requestHash: await sha256Hex("older request"),
      result: written("older"),
      createdAt: new Date(NOW.getTime() - 26 * hour),
      expiresAt: new Date(NOW.getTime() - 2 * hour),
    });
    const seeded = await seedExpired(actor.authSubject);
    const holder = await pg.client("reuse");
    const retentionClient = await pg.client("retention");
    const record = calls();
    const authorizing = pg.latch("reuse is authorizing");
    const proceed = pg.latch("reuse may continue", HOLD_MS);
    const inner = writer("reuse", record);
    const result = mutate(holder, {
      authorize: async (tx) => {
        await inner.authorize(tx);
        authorizing.release();
        await proceed.wait();
      },
      mutate: inner.mutate,
    });
    await pg.reach("reuse to authorize while holding its receipt", authorizing, result);
    const retention = pg.track(applyRetention(pg.jobDeps(retentionClient)));
    await pg.waitForRowLockWaitOrCompletion(retentionClient, [holder], retention);

    proceed.release();
    const [request, job] = await pg.finish(
      "the request and the retention job",
      Promise.allSettled([result, retention]),
    );

    expect(settled(request)).toEqual({
      status: "fulfilled",
      value: { response: written("reuse"), replayed: false },
    });
    expect(settled(job)).toEqual({
      status: "fulfilled",
      value: expect.objectContaining({ api_request_receipts_deleted: 1 }),
    });
    expect(await pg.receipts(actor.authSubject)).toEqual([
      expect.objectContaining({ id: seeded.id, result: written("reuse") }),
    ]);
  });

  it("rolls back a scoped mutation whose family another connection deletes while it is pending", async () => {
    const scope = await pg.seedScope();
    const deleter = await pg.client("deleter");
    const record = calls();
    const { hold, result } = await holdMutation("scoped", record, scope);

    await pg.finish(
      "deleting the family while the scoped mutation is pending",
      deleter.db.delete(families).where(eq(families.id, scope.familyId)).execute(),
    );
    hold.release();
    const error = await pg.finish("the scoped mutation", result).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(databaseErrorCode(error)).toBe("23503");
    expect(record.mutated).toEqual(["scoped"]);
    expect(await pg.receipts(actor.authSubject)).toEqual([]);
    expect((await pg.accounts()).map((account) => account.displayName)).not.toContain("scoped");
    expect(await deleter.db.select().from(families)).toEqual([]);
  });
});
