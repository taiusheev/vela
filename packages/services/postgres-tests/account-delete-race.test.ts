/**
 * Deleting accounts on independent PostgreSQL connections (ADR-43, `POST /v1/me/delete` and
 * Clerk's `user.deleted`). Deletion leaves a family where Leave would and keeps the member where
 * Leave would refuse, so two organisers deleting their accounts at once must not both read the
 * other as still there and both leave: the family would have no organiser. They are different
 * actors, so only the lock on the family's organiser rows, in id order, queues them. Every race here
 * queues both behind a connection holding the first organiser row that lock takes.
 */
import { members, users, type VelaDatabase, type VelaTransaction } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { disableApiAccount } from "../src/api-account-writes.ts";
import { leaveApiFamily } from "../src/api-members.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

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

/** The first organiser row the deletion's lock takes: the lower id. */
function onTheFirstOrganiser(tx: VelaTransaction) {
  const first = [scope.miaId, scope.annaId].sort()[0] ?? "";
  return tx.select().from(members).where(eq(members.id, first)).for("update");
}

function deleteAccount(client: RaceClient, who: SessionIdentity) {
  return disableApiAccount(client.deps, who.authSubject);
}

async function organisers() {
  return seeder.db
    .select({ id: members.id, status: members.status, userId: members.userId })
    .from(members)
    .where(and(eq(members.familyId, scope.familyId), eq(members.role, "organiser")));
}

describe("account deletion on independent PostgreSQL connections", () => {
  it("lets one of two organisers deleting at once leave, and keeps the other in the family", async () => {
    const [first, second, holder] = await pg.clientPool("delete", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheFirstOrganiser, [
      { client: first, start: () => deleteAccount(first, mia) },
      { client: second, start: () => deleteAccount(second, anna) },
    ]);
    const settled = await pg.settle("both deletions", queued);
    expect(settled.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);

    // Mia went first; Anna then read her gone, and stays as the organiser who is told.
    const rows = await organisers();
    expect(rows.find((row) => row.id === scope.miaId)?.status).toBe("left");
    expect(rows.find((row) => row.id === scope.annaId)).toMatchObject({
      status: "active",
      userId: null,
    });
  });

  it("keeps the organiser whose deletion is queued behind the other organiser's Leave", async () => {
    const [first, second, holder] = await pg.clientPool("delete", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock<unknown>(holder, onTheFirstOrganiser, [
      {
        client: first,
        start: () => leaveApiFamily(first.deps, mia, "leave-mia", scope.familyId, scope.miaId, {}),
      },
      { client: second, start: () => deleteAccount(second, anna) },
    ]);
    const settled = await pg.settle("the leave and the deletion", queued);
    expect(settled.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);

    const rows = await organisers();
    expect(rows.find((row) => row.id === scope.miaId)?.status).toBe("left");
    expect(rows.find((row) => row.id === scope.annaId)).toMatchObject({
      status: "active",
      userId: null,
    });
  });
});
