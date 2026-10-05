import { users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import {
  disableApiAccount,
  provisionApiAccount,
  updateApiAccount,
} from "../src/api-account-writes.ts";
import { provisionApiUser } from "../src/api-accounts.ts";
import {
  HOLD_MS,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
} from "./testing.ts";

let pg: PostgresHarness;
const identity: SessionIdentity = { authSubject: "pg-race|account", sessionId: "session-one" };
const bystander: SessionIdentity = { authSubject: "pg-race|bystander", sessionId: "session-two" };
const profile = { display_name: "Mia", language: "en", tz: "Asia/Taipei" };
const notFound = { name: "VelaError", code: "not_found" };
const conflict = { name: "ApiIdempotencyError", code: "conflict" };

type Write = "provision" | "update";

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

function provision(
  client: RaceClient,
  key = "provision-key",
  input: unknown = profile,
  actor = identity,
) {
  return pg.track(provisionApiAccount(client.deps, actor, key, input));
}

function update(
  client: RaceClient,
  key = "update-key",
  input: unknown = { display_name: "Updated" },
  actor = identity,
) {
  return pg.track(updateApiAccount(client.deps, actor, key, input));
}

function write(kind: Write, client: RaceClient, key: string, input?: unknown) {
  return kind === "provision" ? provision(client, key, input) : update(client, key, input);
}

function disable(client: RaceClient, actor = identity) {
  return pg.track(disableApiAccount(client.deps, actor.authSubject));
}

async function seedAccount(actor = identity): Promise<void> {
  const seeder = await pg.client(`seeder-${actor.sessionId}`);
  await pg.finish("seeding the account", provision(seeder, "seed-key", profile, actor));
}

async function queue<T>(
  client: RaceClient,
  blocker: RaceClient,
  start: () => Promise<T>,
): Promise<{ operation: Promise<T> }> {
  const operation = start();
  await pg.waitForActorLockWait(client, [blocker], operation);
  return { operation };
}

describe("first-run provisioning on independent PostgreSQL connections", () => {
  it.each([
    { outcome: "commits", displayName: "One" },
    { outcome: "rolls back", displayName: "Two" },
  ] as const)(
    "gives a racing provision the account that wins once a pending first insert $outcome",
    async ({ outcome, displayName }) => {
      const first = await pg.client("first");
      const second = await pg.client("second");
      const inserted = pg.latch("the first provision inserted the account");
      const settle = pg.latch("the first provision may finish", HOLD_MS);
      const rollback = new Error("the first provision rolled back");
      const firstRun = pg.track(
        first.db.transaction(async (tx) => {
          const user = await provisionApiUser(tx, identity, { ...profile, display_name: "One" });
          inserted.release();
          await settle.wait();
          if (outcome === "rolls back") throw rollback;
          return user;
        }),
      );
      await pg.reach("the first provision to insert", inserted, firstRun);
      const racing = pg.track(
        provisionApiUser(second.db, identity, { ...profile, display_name: "Two" }),
      );
      await pg.waitForRowLockWait(second, [first], racing);

      settle.release();
      if (outcome === "commits") {
        const created = await pg.finish("the first provision", firstRun);
        expect(await pg.finish("the racing provision", racing)).toEqual(created);
      } else {
        await expect(pg.finish("the first provision", firstRun)).rejects.toBe(rollback);
        expect(await pg.finish("the racing provision", racing)).toMatchObject({
          display_name: "Two",
        });
      }
      expect(await pg.accounts()).toEqual([
        { authSubject: identity.authSubject, displayName, deletedAt: null },
      ]);
    },
  );
});

describe("account writes on independent PostgreSQL connections", () => {
  it("creates one account and replays its response to identical provisions queued on the actor lock", async () => {
    const blocker = await pg.client("blocker");
    const clients = await pg.clientPool("provision", 4);
    const lock = await pg.holdActorLock(blocker, identity.authSubject);
    const queued: ReturnType<typeof provision>[] = [];
    for (const client of clients) {
      queued.push((await queue(client, blocker, () => provision(client))).operation);
    }

    lock.release();
    await pg.finish("the blocker", lock.done);
    const results = await pg.finish("the queued provisions", Promise.all(queued));

    expect(results.map((result) => result.replayed)).toEqual([false, true, true, true]);
    const [first] = results;
    expect(first?.response).toMatchObject({
      status: 200,
      body: { display_name: "Mia", language: "en", tz: "Asia/Taipei" },
    });
    for (const result of results) expect(result.response).toEqual(first?.response);
    expect(await pg.accounts()).toEqual([
      { authSubject: identity.authSubject, displayName: "Mia", deletedAt: null },
    ]);
    expect(await pg.receipts(identity.authSubject)).toHaveLength(1);
    expect(
      await pg.writtenTogether(identity.authSubject, "provision-key", {
        authSubject: identity.authSubject,
      }),
    ).toBe(true);
  });

  it.each([
    { kind: "provision", first: { ...profile, display_name: "One" }, expected: 1 },
    { kind: "update", first: { display_name: "One" }, expected: 2 },
  ] as const)(
    "rejects a changed $kind queued under the same key without writing it",
    async ({ kind, first, expected }) => {
      if (kind === "update") await seedAccount();
      const blocker = await pg.client("blocker");
      const original = await pg.client("original");
      const changer = await pg.client("changer");
      const lock = await pg.holdActorLock(blocker, identity.authSubject);
      const { operation: applied } = await queue(original, blocker, () =>
        write(kind, original, "same-key", first),
      );
      const { operation: changed } = await queue(changer, blocker, () =>
        write(kind, changer, "same-key", { ...first, display_name: "Two" }),
      );

      lock.release();
      await pg.finish("the blocker", lock.done);
      expect(await pg.finish(`the original ${kind}`, applied)).toMatchObject({
        response: { status: 200, body: { display_name: "One" } },
        replayed: false,
      });
      await expect(pg.finish(`the changed ${kind}`, changed)).rejects.toMatchObject(conflict);

      expect(await pg.accounts()).toEqual([
        { authSubject: identity.authSubject, displayName: "One", deletedAt: null },
      ]);
      expect(await pg.receipts(identity.authSubject)).toHaveLength(expected);
      expect(
        await pg.writtenTogether(identity.authSubject, "same-key", {
          authSubject: identity.authSubject,
        }),
      ).toBe(true);
    },
  );

  it.each([
    { kind: "provision", order: "behind", displayName: "Mia" },
    { kind: "provision", order: "ahead of", displayName: "" },
    { kind: "update", order: "behind", displayName: "Updated" },
    { kind: "update", order: "ahead of", displayName: "Mia" },
  ] as const)(
    "leaves a tombstone and no actor receipts when a disable is queued $order a pending $kind",
    async ({ kind, order, displayName }) => {
      if (kind === "update") await seedAccount();
      const blocker = await pg.client("blocker");
      const writer = await pg.client(kind);
      const disabler = await pg.client("disable");
      const later = await pg.client("later");
      const lock = await pg.holdActorLock(blocker, identity.authSubject);
      let written: ReturnType<typeof write>;
      let disabled: Promise<void>;
      if (order === "behind") {
        written = (await queue(writer, blocker, () => write(kind, writer, "race-key"))).operation;
        disabled = (await queue(disabler, blocker, () => disable(disabler))).operation;
      } else {
        disabled = (await queue(disabler, blocker, () => disable(disabler))).operation;
        written = (await queue(writer, blocker, () => write(kind, writer, "race-key"))).operation;
      }

      lock.release();
      await pg.finish("the blocker", lock.done);
      if (order === "behind") {
        expect(await pg.finish(`the ${kind}`, written)).toMatchObject({
          response: { status: 200 },
          replayed: false,
        });
      } else {
        await expect(pg.finish(`the ${kind}`, written)).rejects.toMatchObject(notFound);
      }
      await pg.finish("the disable", disabled);

      expect(await pg.accounts()).toEqual([
        { authSubject: identity.authSubject, displayName, deletedAt: NOW },
      ]);
      expect(await pg.receipts(identity.authSubject)).toEqual([]);
      await expect(
        pg.finish("a provision after the disable", provision(later, "race-key")),
      ).rejects.toMatchObject(notFound);
      await expect(
        pg.finish("an update after the disable", update(later, "later-key")),
      ).rejects.toMatchObject(notFound);
      expect(await pg.receipts(identity.authSubject)).toEqual([]);
    },
  );

  it.each(["provision", "update"] as const)(
    "never leaves a live account or an actor receipt when unsynchronised %s and disable calls race",
    async (kind) => {
      const writers = await pg.clientPool(kind, 3);
      const disablers = await pg.clientPool("disable", 2);
      for (let round = 0; round < 4; round += 1) {
        await pg.reset();
        if (kind === "update") await seedAccount();
        const writes = writers.map((client, index) =>
          write(kind, client, `race-${round}-${index}`),
        );
        const disables = disablers.map((client) => disable(client));
        const writeResults = await pg.settle(`${kind} round ${round}`, writes);
        const disableResults = await pg.settle(`disable round ${round}`, disables);

        for (const result of writeResults) {
          if (result.status === "rejected") expect(result.reason).toMatchObject(notFound);
          else expect(result.value).toMatchObject({ response: { status: 200 }, replayed: false });
        }
        expect(disableResults).toEqual(
          disables.map(() => ({ status: "fulfilled", value: undefined })),
        );
        expect(await pg.accounts()).toEqual([
          expect.objectContaining({ authSubject: identity.authSubject, deletedAt: NOW }),
        ]);
        expect(await pg.receipts(identity.authSubject)).toEqual([]);
      }
    },
  );

  it("refuses to replay a saved profile once another connection soft-deletes the account", async () => {
    const replayer = await pg.client("replayer");
    const deleter = await pg.client("deleter");
    await pg.finish("seeding the account", provision(replayer, "seed-key"));
    const locked = pg.latch("the deletion locked the account");
    const release = pg.latch("the deletion may commit", HOLD_MS);
    const deleting = pg.track(
      deleter.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ deletedAt: NOW })
          .where(eq(users.authSubject, identity.authSubject));
        locked.release();
        await release.wait();
      }),
    );
    await pg.reach("the deletion to lock the account", locked, deleting);
    const replay = provision(replayer, "seed-key");
    await pg.waitForRowLockWait(replayer, [deleter], replay);

    release.release();
    await pg.finish("the deletion", deleting);
    await expect(pg.finish("the replay", replay)).rejects.toMatchObject(notFound);

    expect(await pg.accounts()).toEqual([
      { authSubject: identity.authSubject, displayName: "Mia", deletedAt: NOW },
    ]);
    expect(await pg.receipts(identity.authSubject)).toHaveLength(1);
  });

  it("disables one actor while another actor holds its lock and leaves that actor untouched", async () => {
    await seedAccount(bystander);
    const blocker = await pg.client("bystander-lock");
    const disabler = await pg.client("disable");
    const lock = await pg.holdActorLock(blocker, bystander.authSubject);

    await pg.finish("disabling one actor while another actor's lock is held", disable(disabler));
    expect(await pg.holdsActorLock(blocker)).toBe(true);
    lock.release();
    await pg.finish("the bystander lock", lock.done);

    expect(await pg.accounts()).toEqual([
      { authSubject: identity.authSubject, displayName: "", deletedAt: NOW },
      { authSubject: bystander.authSubject, displayName: "Mia", deletedAt: null },
    ]);
    expect(await pg.receipts(bystander.authSubject)).toHaveLength(1);
    expect(await pg.receipts(identity.authSubject)).toEqual([]);
  });
});
