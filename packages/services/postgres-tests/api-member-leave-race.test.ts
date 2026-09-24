/**
 * Pausing and leaving on independent PostgreSQL connections (`POST .../members/:id/pause` and
 * `/left`, API contract §2). The last active organiser may not pause or leave, because nobody else
 * would be told when her light goes quiet. Two organisers doing so at once are different actors, so
 * only the lock the route takes on the family's organiser rows, in id order, queues them — and it is
 * what keeps each from reading the other as still there. Every race here queues both behind a
 * connection holding the first organiser row that lock takes.
 */
import { events, members, users, type VelaDatabase, type VelaTransaction } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { leaveApiFamily, MemberChangeRefusedError, pauseApiMember } from "../src/api-members.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

/** Mia and Anna both organise her family. */
const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const anna: SessionIdentity = { authSubject: "pg-race|anna", sessionId: "session-anna" };

interface Scope {
  readonly familyId: string;
  readonly miaId: string;
  readonly annaId: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedTwoOrganisers(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

async function seedTwoOrganisers(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const sister = await seedGroupMember(db, family, {
    now: NOW,
    name: "Anna",
    externalId: "4001",
    role: "organiser",
  });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, anna, "Anna", sister.member.id);
  return { familyId: family.family.id, miaId: family.organiser.id, annaId: sister.member.id };
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

/** The first organiser row the route's lock takes: the lower id. */
function onTheFirstOrganiser(tx: VelaTransaction) {
  const first = [scope.miaId, scope.annaId].sort()[0] ?? "";
  return tx.select().from(members).where(eq(members.id, first)).for("update");
}

function leave(client: RaceClient, who: SessionIdentity, memberId: string, key: string) {
  return leaveApiFamily(client.deps, who, key, scope.familyId, memberId, {});
}

function pause(client: RaceClient, who: SessionIdentity, memberId: string, key: string) {
  return pauseApiMember(client.deps, who, key, scope.familyId, memberId, { paused: true });
}

function expectLastOrganiserRefusal(result: PromiseSettledResult<unknown> | undefined): void {
  if (result?.status !== "rejected") {
    throw new Error(`expected the second change refused, got ${result?.status}`);
  }
  expect(result.reason).toBeInstanceOf(MemberChangeRefusedError);
  expect((result.reason as MemberChangeRefusedError).reason).toBe("last_organiser");
}

async function organisers() {
  return seeder.db
    .select({ id: members.id, status: members.status })
    .from(members)
    .where(and(eq(members.familyId, scope.familyId), eq(members.role, "organiser")));
}

describe("pausing and leaving on independent PostgreSQL connections", () => {
  it("lets one of two organisers leaving at once go, and keeps the other as the last", async () => {
    const [first, second, holder] = await pg.clientPool("leave", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheFirstOrganiser, [
      { client: first, start: () => leave(first, mia, scope.miaId, "leave-mia") },
      { client: second, start: () => leave(second, anna, scope.annaId, "leave-anna") },
    ]);
    const [left, stayed] = await pg.settle("both leaves", queued);

    // Mia went first; Anna then read her gone, and is the one still told.
    expect(left?.status).toBe("fulfilled");
    expectLastOrganiserRefusal(stayed);
    expect((await organisers()).map((row) => [row.id, row.status]).sort()).toEqual(
      [
        [scope.miaId, "left"],
        [scope.annaId, "active"],
      ].sort(),
    );
    expect(
      await seeder.db.select().from(events).where(eq(events.name, "member_left")),
    ).toHaveLength(1);
  });

  it("refuses the leave queued behind the other organiser's pause", async () => {
    const [first, second, holder] = await pg.clientPool("leave", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheFirstOrganiser, [
      { client: first, start: () => pause(first, mia, scope.miaId, "pause-mia") },
      { client: second, start: () => leave(second, anna, scope.annaId, "leave-anna") },
    ]);
    const [paused, stayed] = await pg.settle("the pause and the leave", queued);

    // A paused organiser is not told either, so Anna, the only active one, may not go.
    expect(paused?.status).toBe("fulfilled");
    expectLastOrganiserRefusal(stayed);
    expect((await organisers()).map((row) => [row.id, row.status]).sort()).toEqual(
      [
        [scope.miaId, "paused"],
        [scope.annaId, "active"],
      ].sort(),
    );
    expect(await seeder.db.select().from(events).where(eq(events.name, "member_left"))).toEqual([]);
  });
});
