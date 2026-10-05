import { apiRequestReceipts, users, type VelaTransaction } from "@vela/db";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import {
  type ApiMutationAction,
  type ApiMutationRequest,
  MAX_API_RECEIPTS_PER_ACTOR,
  runApiMutation,
} from "../src/api-idempotency.ts";
import { sha256Hex } from "../src/hash.ts";
import {
  calls,
  databaseErrorCode,
  HOLD_MS,
  type Latch,
  type Outcome,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  type WriterOptions,
  writer,
  written,
} from "./testing.ts";

let pg: PostgresHarness;
const actor: SessionIdentity = { authSubject: "pg-race|actor-one", sessionId: "session-one" };
const otherActor: SessionIdentity = { authSubject: "pg-race|actor-two", sessionId: "session-two" };
const request: ApiMutationRequest = {
  key: "race-key",
  operation: "race.write:v1",
  input: { value: "first" },
};
const conflict = { name: "ApiIdempotencyError", code: "conflict" };
const rateLimited = { name: "ApiIdempotencyError", code: "rate_limited" };

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
  identity: SessionIdentity = actor,
): Promise<Outcome> {
  return pg.track(runApiMutation(client.deps, identity, { ...request, ...change }, action));
}

async function holdMutation(
  label: string,
  action: (entered: Latch, hold: Latch) => ApiMutationAction,
  change: Partial<ApiMutationRequest> = {},
) {
  const holder = await pg.client(label);
  const entered = pg.latch(`${label} entered mutate`);
  const hold = pg.latch(`${label} may finish`, HOLD_MS);
  const result = mutate(holder, action(entered, hold), change);
  await pg.reach(`${label} to enter mutate`, entered, result);
  return { holder, hold, result };
}

async function queueOne(
  client: RaceClient,
  holder: RaceClient,
  start: (client: RaceClient) => Promise<Outcome>,
): Promise<{ operation: Promise<Outcome> }> {
  const operation = start(client);
  await pg.waitForActorLockWait(client, [holder], operation);
  return { operation };
}

async function queue(
  clients: readonly RaceClient[],
  holder: RaceClient,
  start: (client: RaceClient) => Promise<Outcome>,
): Promise<Promise<Outcome>[]> {
  const started: Promise<Outcome>[] = [];
  for (const client of clients) started.push((await queueOne(client, holder, start)).operation);
  return started;
}

async function names(): Promise<string[]> {
  return (await pg.accounts()).map((account) => account.displayName).toSorted();
}

function rejections<T>(results: readonly PromiseSettledResult<T>[]): unknown[] {
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}

function values<T>(results: readonly PromiseSettledResult<T>[]): T[] {
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

describe("runApiMutation on independent PostgreSQL connections", () => {
  it("replays the committed response to identical requests queued behind an in-flight mutation", async () => {
    const record = calls();
    const replayers = await pg.clientPool("replay", 3);
    const { holder, hold, result } = await holdMutation("holder", (entered, hold) =>
      writer("holder", record, { entered, hold }),
    );
    const queued = await queue(replayers, holder, (client) =>
      mutate(client, writer(client.name, record)),
    );
    expect(record.authorized).toEqual(["holder"]);
    expect(await pg.receipts(actor.authSubject)).toEqual([]);

    hold.release();
    const [first, ...replays] = await pg.finish(
      "the holder and its replays",
      Promise.all([result, ...queued]),
    );

    expect(first).toEqual({ response: written("holder"), replayed: false });
    expect(replays).toEqual(replayers.map(() => ({ response: written("holder"), replayed: true })));
    expect(record.mutated).toEqual(["holder"]);
    expect(record.authorized).toEqual(["holder", "replay-0", "replay-1", "replay-2"]);
    expect(await pg.receipts(actor.authSubject)).toEqual([
      expect.objectContaining({ result: written("holder") }),
    ]);
    expect(await pg.writtenTogether(actor.authSubject, "race-key", { displayName: "holder" })).toBe(
      true,
    );
    expect(await names()).toEqual(["holder"]);
  });

  it("commits exactly one mutation for unsynchronised identical requests from refreshed sessions", async () => {
    const clients = await pg.clientPool("identical", 6);
    for (let round = 0; round < 5; round += 1) {
      await pg.reset();
      const record = calls();
      const results = await pg.settle(
        `identical round ${round}`,
        clients.map((client) =>
          mutate(client, writer(client.name, record), {}, { ...actor, sessionId: client.name }),
        ),
      );

      expect(rejections(results)).toEqual([]);
      const settled = values(results);
      expect(settled.filter((result) => !result.replayed)).toHaveLength(1);
      expect(record.mutated).toHaveLength(1);
      const winner = record.mutated[0] ?? "";
      for (const result of settled) expect(result.response).toEqual(written(winner));
      expect(record.authorized).toHaveLength(clients.length);
      expect(await pg.receipts(actor.authSubject)).toHaveLength(1);
      expect(await pg.writtenTogether(actor.authSubject, "race-key", { displayName: winner })).toBe(
        true,
      );
      expect(await names()).toEqual([winner]);
    }
  });

  it("rejects a changed input queued behind the same key without a second mutation", async () => {
    const record = calls();
    const changer = await pg.client("changer");
    const { holder, hold, result } = await holdMutation("holder", (entered, hold) =>
      writer("holder", record, { entered, hold }),
    );
    const { operation: changed } = await queueOne(changer, holder, (client) =>
      mutate(client, writer(client.name, record), { input: { value: "second" } }),
    );

    hold.release();
    expect(await pg.finish("the holder", result)).toEqual({
      response: written("holder"),
      replayed: false,
    });
    await expect(pg.finish("the changed request", changed)).rejects.toMatchObject(conflict);

    expect(record.mutated).toEqual(["holder"]);
    expect(record.authorized).toEqual(["holder", "changer"]);
    expect(await pg.receipts(actor.authSubject)).toEqual([
      expect.objectContaining({
        requestHash: await sha256Hex(
          '{"familyId":null,"input":{"value":"first"},"memberId":null,"operation":"race.write:v1"}',
        ),
        result: written("holder"),
      }),
    ]);
    expect(await names()).toEqual(["holder"]);
    await expect(
      pg.finish(
        "a later changed request",
        mutate(changer, writer("later", record), { input: { value: "second" } }),
      ),
    ).rejects.toMatchObject(conflict);
    expect(
      await pg.finish("a later identical request", mutate(changer, writer("later", record))),
    ).toEqual({ response: written("holder"), replayed: true });
    expect(record.mutated).toEqual(["holder"]);
  });

  it("commits one mutation and conflicts or replays the rest for unsynchronised mixed inputs", async () => {
    const clients = await pg.clientPool("mixed", 6);
    for (let round = 0; round < 5; round += 1) {
      await pg.reset();
      const record = calls();
      const inputs = new Map<string, string>();
      const results = await pg.settle(
        `mixed round ${round}`,
        clients.map((client, index) => {
          const value = index % 2 === 0 ? "even" : "odd";
          inputs.set(client.name, value);
          return mutate(client, writer(client.name, record), { input: { value } });
        }),
      );

      expect(record.mutated).toHaveLength(1);
      const winner = record.mutated[0] ?? "";
      const winningInput = inputs.get(winner);
      const settled = values(results);
      expect(settled.filter((result) => !result.replayed)).toHaveLength(1);
      for (const result of settled) expect(result.response).toEqual(written(winner));
      expect(settled).toHaveLength(
        [...inputs.values()].filter((value) => value === winningInput).length,
      );
      const refused = rejections(results);
      expect(refused).toHaveLength(clients.length - settled.length);
      for (const reason of refused) expect(reason).toMatchObject(conflict);
      expect(await pg.receipts(actor.authSubject)).toHaveLength(1);
      expect(await names()).toEqual([winner]);
    }
  });

  it("hides a pending mutation's writes and rolls back its domain write and receipt before a queued retry", async () => {
    const record = calls();
    const failure = new Error("mutation failed after writing");
    const retry = await pg.client("retry");
    const { holder, hold, result } = await holdMutation("failing", (entered, hold) =>
      writer("failing", record, { entered, hold, failure }),
    );

    expect(await pg.holdsActorLock(holder)).toBe(true);
    expect(await pg.receipts(actor.authSubject)).toEqual([]);
    expect(await names()).toEqual([]);
    const { operation: retried } = await queueOne(retry, holder, (client) =>
      mutate(client, writer(client.name, record)),
    );

    hold.release();
    await expect(pg.finish("the failing mutation", result)).rejects.toBe(failure);
    expect(await pg.finish("the retry", retried)).toEqual({
      response: written("retry"),
      replayed: false,
    });
    expect(record.mutated).toEqual(["failing", "retry"]);
    expect(await pg.receipts(actor.authSubject)).toEqual([
      expect.objectContaining({ result: written("retry") }),
    ]);
    expect(await pg.writtenTogether(actor.authSubject, "race-key", { displayName: "retry" })).toBe(
      true,
    );
    expect(await names()).toEqual(["retry"]);
  });

  it("rolls back earlier writes and the reservation when the database rejects a mutation", async () => {
    const client = await pg.client("constraint");
    const error = await pg
      .finish(
        "a mutation that violates a unique constraint",
        mutate(client, {
          authorize: async () => {},
          mutate: async (tx) => {
            await tx.insert(users).values({ authSubject: "pg-race|duplicate", displayName: "one" });
            await tx.insert(users).values({ authSubject: "pg-race|duplicate", displayName: "two" });
            return written("constraint");
          },
        }),
      )
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );

    expect(databaseErrorCode(error)).toBe("23505");
    expect(await pg.receipts(actor.authSubject)).toEqual([]);
    expect(await pg.accounts()).toEqual([]);
    expect(
      await pg.finish("the same key after the failure", mutate(client, writer("after", calls()))),
    ).toEqual({ response: written("after"), replayed: false });
  });

  it("authorizes different keys for one actor only after each earlier holder commits, in lock order", async () => {
    const actorHash = await sha256Hex(actor.authSubject);
    const observed: { label: string; completed: number }[] = [];
    const record = calls();
    const observing = (label: string, options: WriterOptions = {}): ApiMutationAction => {
      const inner = writer(label, record, options);
      return {
        authorize: async (tx: VelaTransaction) => {
          const [row] = await tx
            .select({ completed: count() })
            .from(apiRequestReceipts)
            .where(
              and(
                eq(apiRequestReceipts.actorHash, actorHash),
                isNotNull(apiRequestReceipts.result),
              ),
            );
          observed.push({ label, completed: row?.completed ?? -1 });
          await inner.authorize(tx);
        },
        mutate: inner.mutate,
      };
    };
    const later = [await pg.client("key-b"), await pg.client("key-c")];
    const { holder, hold, result } = await holdMutation(
      "key-a",
      (entered, hold) => observing("key-a", { entered, hold }),
      { key: "key-a" },
    );
    const queued = await queue(later, holder, (client) =>
      mutate(client, observing(client.name), { key: client.name }),
    );
    expect(record.authorized).toEqual(["key-a"]);

    hold.release();
    const results = await pg.finish("three keys for one actor", Promise.all([result, ...queued]));

    expect(results.map((outcome) => outcome.replayed)).toEqual([false, false, false]);
    expect(observed).toEqual([
      { label: "key-a", completed: 0 },
      { label: "key-b", completed: 1 },
      { label: "key-c", completed: 2 },
    ]);
    expect(record.mutated).toEqual(["key-a", "key-b", "key-c"]);
    expect(await pg.receipts(actor.authSubject)).toHaveLength(3);
    for (const key of ["key-a", "key-b", "key-c"]) {
      expect(await pg.writtenTogether(actor.authSubject, key, { displayName: key })).toBe(true);
    }
  });

  it("completes another actor's request with the same key while the first actor holds its lock", async () => {
    const record = calls();
    const other = await pg.client("other-actor");
    const { holder, hold, result } = await holdMutation(
      "holder",
      (entered, hold) => writer("holder", record, { entered, hold }),
      { key: "shared-key" },
    );

    expect(
      await pg.finish(
        "the other actor while the first actor holds its lock",
        mutate(other, writer("other-actor", record), { key: "shared-key" }, otherActor),
      ),
    ).toEqual({ response: written("other-actor"), replayed: false });
    expect(await pg.holdsActorLock(holder)).toBe(true);
    expect(await pg.receipts(otherActor.authSubject)).toHaveLength(1);
    expect(await pg.receipts(actor.authSubject)).toEqual([]);

    hold.release();
    expect(await pg.finish("the holder", result)).toEqual({
      response: written("holder"),
      replayed: false,
    });
    const [mine] = await pg.receipts(actor.authSubject);
    const [theirs] = await pg.receipts(otherActor.authSubject);
    expect(mine?.keyHash).toBe(await sha256Hex("shared-key"));
    expect(theirs?.keyHash).toBe(mine?.keyHash);
    expect(theirs?.actorHash).not.toBe(mine?.actorHash);
    expect(await names()).toEqual(["holder", "other-actor"]);
  });

  it("still replays a matching key at the receipt cap while refusing a fresh one", async () => {
    const record = calls();
    const replayer = await pg.client("replayer");
    const fresh = await pg.client("fresh");
    const blocker = await pg.client("blocker");
    expect(
      await pg.finish("the first mutation", mutate(replayer, writer("first", record))),
    ).toEqual({ response: written("first"), replayed: false });
    await pg.seedReceipts(actor.authSubject, MAX_API_RECEIPTS_PER_ACTOR - 1);
    const lock = await pg.holdActorLock(blocker, actor.authSubject);
    const { operation: replay } = await queueOne(replayer, blocker, (client) =>
      mutate(client, writer("replay", record)),
    );
    const { operation: refused } = await queueOne(fresh, blocker, (client) =>
      mutate(client, writer(client.name, record), { key: "fresh-key" }),
    );

    lock.release();
    await pg.finish("the blocker", lock.done);
    expect(await pg.finish("the matching replay", replay)).toEqual({
      response: written("first"),
      replayed: true,
    });
    await expect(pg.finish("the fresh key", refused)).rejects.toMatchObject(rateLimited);

    expect(record.mutated).toEqual(["first"]);
    expect(record.authorized).toEqual(["first", "replay", "fresh"]);
    expect(await pg.receipts(actor.authSubject)).toHaveLength(MAX_API_RECEIPTS_PER_ACTOR);
  });

  it("rate limits fresh keys queued behind the request that takes the last receipt slot", async () => {
    await pg.seedReceipts(actor.authSubject, MAX_API_RECEIPTS_PER_ACTOR - 1);
    await pg.seedReceipts(otherActor.authSubject, 5);
    const record = calls();
    const fresh = await pg.clientPool("fresh", 3);
    const { holder, hold, result } = await holdMutation(
      "last-slot",
      (entered, hold) => writer("last-slot", record, { entered, hold }),
      { key: "last-slot" },
    );
    const queued = await queue(fresh, holder, (client) =>
      mutate(client, writer(client.name, record), { key: client.name }),
    );

    hold.release();
    expect(await pg.finish("the last slot", result)).toEqual({
      response: written("last-slot"),
      replayed: false,
    });
    const results = await pg.settle("the queued fresh keys", queued);
    expect(values(results)).toEqual([]);
    expect(rejections(results)).toEqual(queued.map(() => expect.objectContaining(rateLimited)));
    expect(record.mutated).toEqual(["last-slot"]);
    expect(await pg.receipts(actor.authSubject)).toHaveLength(MAX_API_RECEIPTS_PER_ACTOR);
    expect(await pg.receipts(otherActor.authSubject)).toHaveLength(5);
    expect(await names()).toEqual(["last-slot"]);
  });

  it.each([1, 3])(
    "never exceeds the receipt cap for unsynchronised fresh keys with %i free slots",
    async (free) => {
      const clients = await pg.clientPool("burst", 8);
      for (let round = 0; round < 3; round += 1) {
        await pg.reset();
        await pg.seedReceipts(actor.authSubject, MAX_API_RECEIPTS_PER_ACTOR - free);
        const record = calls();
        const results = await pg.settle(
          `burst round ${round}`,
          clients.map((client) =>
            mutate(client, writer(client.name, record), { key: `${client.name}-${round}` }),
          ),
        );

        expect(values(results)).toHaveLength(free);
        const refused = rejections(results);
        expect(refused).toHaveLength(clients.length - free);
        for (const reason of refused) expect(reason).toMatchObject(rateLimited);
        expect(record.mutated).toHaveLength(free);
        expect(await pg.receipts(actor.authSubject)).toHaveLength(MAX_API_RECEIPTS_PER_ACTOR);
        expect(await pg.accounts()).toHaveLength(free);
      }
    },
  );
});
