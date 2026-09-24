/**
 * Composing an ask on independent PostgreSQL connections (api-contract §"Compose an ask"). The
 * one-ask-per-day rule is held by a `for update` on the recipient's member row, taken as the first
 * statement of the mutation; `exchanges_one_per_day` is the backstop whose firing is an incident.
 * Two people in one family reaching for the same morning are different actors, so their actor
 * advisory locks never meet and that row lock is the only thing between them — which PGlite, on one
 * connection, cannot prove. Every race here queues both composes on that row before letting go.
 */
import { addDays, localDateOf } from "@vela/core";
import { exchanges, members, users, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { AskDayTakenError, composeApiAsk } from "../src/api-asks.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import {
  databaseErrorCode,
  HOLD_MS,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
} from "./testing.ts";

let pg: PostgresHarness;

/** Mia organises; Sam is her brother. Each signs in as her or his own account. */
const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "pg-race|sam", sessionId: "session-sam" };

interface Scope {
  readonly familyId: string;
  readonly recipientId: string;
  readonly timeZone: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  const seeding = await pg.client("seed");
  scope = await seedComposeFamily(seeding.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** Her family, with two people who can ask her something and an account each. */
async function seedComposeFamily(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const brother = await seedGroupMember(db, family, {
    now: NOW,
    name: "Sam",
    externalId: "3001",
  });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, sam, "Sam", brother.member.id);
  return {
    familyId: family.family.id,
    recipientId: family.member.id,
    timeZone: family.member.tz,
  };
}

async function signIn(
  db: VelaDatabase,
  identity: SessionIdentity,
  displayName: string,
  memberId: string,
): Promise<void> {
  const [account] = await db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName })
    .returning();
  if (account === undefined) throw new Error(`expected an account for ${displayName}`);
  await db.update(members).set({ userId: account.id }).where(eq(members.id, memberId));
}

function tomorrow(): string {
  return addDays(localDateOf(NOW, scope.timeZone), 1);
}

function compose(client: RaceClient, who: SessionIdentity, key: string, date: string) {
  return pg.track(
    composeApiAsk(client.deps, who, key, scope.familyId, {
      recipient_id: scope.recipientId,
      type: "question",
      text: `Composed by ${who.sessionId}`,
      when: "date",
      date,
    }),
  );
}

/**
 * Every compose queued on her member row behind a third connection holding it, in the order given,
 * then the holder lets go and they serialise on that row alone.
 *
 * Each one is started only once the one before it is confirmed waiting, because `pg_blocking_pids`
 * names a backend's *direct* blocker and nothing further up: the first waiter blocks on the holder's
 * transaction, the second on the first waiter's tuple lock, and so on. Starting them together would
 * leave the queue order to chance, and with it which asker gets the morning.
 */
async function queueOnHerRow(
  holder: RaceClient,
  starts: readonly { client: RaceClient; start: () => Promise<unknown> }[],
): Promise<Promise<unknown>[]> {
  const entered = pg.latch("the holder to take her row");
  const release = pg.latch("the holder to let her row go", HOLD_MS);
  const held = pg.track(
    holder.db.transaction(async (tx) => {
      await tx.select().from(members).where(eq(members.id, scope.recipientId)).for("update");
      entered.release();
      await release.wait();
    }),
  );
  await entered.wait();

  const operations: Promise<unknown>[] = [];
  let ahead: RaceClient = holder;
  for (const queued of starts) {
    const operation = queued.start();
    operations.push(operation);
    await pg.waitForRowLockWait(queued.client, [ahead], operation);
    ahead = queued.client;
  }

  release.release();
  await held;
  return operations;
}

async function exchangeRows(client: RaceClient) {
  return client.db.select().from(exchanges).where(eq(exchanges.recipientId, scope.recipientId));
}

describe("composing an ask on independent PostgreSQL connections", () => {
  it("gives one morning to one asker and tells the other who holds it, without the constraint firing", async () => {
    const [first, second, holder] = await pg.clientPool("compose", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const date = tomorrow();

    // Mia queues first, so the morning is hers and Sam is the one who hears about it.
    const queued = await queueOnHerRow(holder, [
      { client: first, start: () => compose(first, mia, "key-mia", date) },
      { client: second, start: () => compose(second, sam, "key-sam", date) },
    ]);
    const [won, lost] = await pg.settle("both composes", queued);
    if (won?.status !== "fulfilled" || lost?.status !== "rejected") {
      throw new Error(
        `expected Mia's ask and Sam's refusal, got ${won?.status} and ${lost?.status}`,
      );
    }

    const composed = won.value as {
      response: { status: number; body: unknown };
      replayed: boolean;
    };
    expect(composed.response.status).toBe(201);
    expect(composed.replayed).toBe(false);
    expect((composed.response.body as { asker_name: string }).asker_name).toBe("Mia");

    expect(lost.reason).toBeInstanceOf(AskDayTakenError);
    // The rule was held by the row lock, not by `exchanges_one_per_day`: a unique violation here
    // would mean both mutations reached the insert, which is the incident the backstop exists for.
    expect(databaseErrorCode(lost.reason)).toBeUndefined();
    expect((lost.reason as AskDayTakenError).conflict).toEqual({
      taken_by: "Mia",
      date_alternative: addDays(date, 1),
    });

    const rows = await exchangeRows(holder);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scheduledFor).toBe(date);
    expect(rows[0]?.state).toBe("composed");
  });

  it("gives both askers their own morning when they reach for different days on the same row", async () => {
    const [first, second, holder] = await pg.clientPool("compose", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const date = tomorrow();
    const dayAfter = addDays(date, 1);

    const queued = await queueOnHerRow(holder, [
      { client: first, start: () => compose(first, mia, "key-mia", date) },
      { client: second, start: () => compose(second, sam, "key-sam", dayAfter) },
    ]);

    // Serialising on her row must not turn two free mornings into a conflict.
    const results = await pg.settle("both composes", queued);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);

    const rows = await exchangeRows(holder);
    expect(rows.map((row) => row.scheduledFor).sort()).toEqual([date, dayAfter]);
  });
});
