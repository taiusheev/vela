/**
 * Adding someone nearby from the app on independent PostgreSQL connections (`POST .../nearby`, API
 * contract § "People nearby"). She has at most two people nearby (spec §17), and no constraint
 * holds that: the count is read and the row written in one transaction. Two organisers adding at
 * once are different actors, so the lock on her member row is what queues them, and the second
 * counts the first's contact. Without it both read one contact and both write, leaving three: seen
 * on 1 October 2026 with the lock removed, both contenders past the count and at the insert, where
 * the queueing then times out waiting for the second to wait on the first.
 */

import { members, nearbyContacts, users, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { addApiNearby, NearbyRefusedError } from "../src/api-nearby.ts";
import { seedFamily, seedGroupMember, seedNearbyContact } from "../src/testing/seed.ts";
import {
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const anna: SessionIdentity = { authSubject: "pg-race|anna", sessionId: "session-anna" };

interface Scope {
  readonly familyId: string;
  readonly herId: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedOneNearby(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** Two organisers, and one person already near her, so one place is left. */
async function seedOneNearby(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const sister = await seedGroupMember(db, family, {
    now: NOW,
    name: "Anna",
    externalId: "4001",
    role: "organiser",
  });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, anna, "Anna", sister.member.id);
  await seedNearbyContact(db, family, { now: NOW, name: "Lena", answer: null });
  return { familyId: family.family.id, herId: family.member.id };
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

function add(client: RaceClient, who: SessionIdentity, key: string, name: string) {
  return addApiNearby(client.deps, who, key, scope.familyId, {
    member_id: scope.herId,
    name,
    relation: null,
  });
}

describe("adding someone nearby on independent PostgreSQL connections", () => {
  it("keeps her at two when two organisers add the last place at once, refusing the second", async () => {
    const [first, second, holder] = await pg.clientPool("nearby", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock(
      holder,
      (tx) => tx.select().from(members).where(eq(members.id, scope.herId)).for("update"),
      [
        { client: first, start: () => add(first, mia, "nearby-mia", "Petro") },
        { client: second, start: () => add(second, anna, "nearby-anna", "Igor") },
      ],
    );
    const results = await pg.settle("both adds", queued);
    const [made, refused] = results;
    if (made === undefined || refused === undefined) throw new Error("expected both adds settled");
    // The first queued holds her row first: its contact is the second, and the other is one too many.
    expect(settled(made).status).toBe("fulfilled");
    expect(refused.status).toBe("rejected");
    if (refused.status === "rejected") {
      expect(refused.reason).toBeInstanceOf(NearbyRefusedError);
      expect((refused.reason as NearbyRefusedError).reason).toBe("full");
    }

    const near = await seeder.db
      .select({ name: nearbyContacts.name })
      .from(nearbyContacts)
      .where(eq(nearbyContacts.memberId, scope.herId));
    expect(near.map((row) => row.name).sort()).toEqual(["Lena", "Petro"]);
  });
});
