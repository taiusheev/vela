/**
 * Starting Vela Light's thirty days on independent PostgreSQL connections (`POST .../plan/trial`,
 * API contract §7). There is one trial per kept-light member, never a second. Two organisers
 * starting it at once are different actors, so the lock on her member row is what queues them, and
 * the second is answered with the trial the first made. `subscriptions_member_id_key` would stop a
 * second row, but as a unique violation — an error for the second organiser, not the trial.
 */

import { localDateOf } from "@vela/core";
import { answers, events, members, subscriptions, users, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { startApiTrial } from "../src/api-trial.ts";
import { seedExchange, seedFamily, seedGroupMember } from "../src/testing/seed.ts";
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
  scope = await seedAnsweredOnce(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** Her light on, one morning answered, and two organisers who may start her thirty days. */
async function seedAnsweredOnce(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const sister = await seedGroupMember(db, family, {
    now: NOW,
    name: "Anna",
    externalId: "4001",
    role: "organiser",
  });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, anna, "Anna", sister.member.id);
  const exchange = await seedExchange(db, family, {
    date: localDateOf(NOW, family.member.tz),
    state: "answered",
    deliveredAt: new Date(NOW.getTime() - 60 * 60_000),
    answeredAt: new Date(NOW.getTime() - 30 * 60_000),
  });
  await db.insert(answers).values({
    exchangeId: exchange.id,
    memberId: family.member.id,
    kind: "text",
    channel: "telegram",
    externalId: "2001:7",
    payload: { text: "The tomatoes finally turned." },
    receivedAt: new Date(NOW.getTime() - 30 * 60_000),
  });
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

function start(client: RaceClient, who: SessionIdentity, key: string) {
  return startApiTrial(client.deps, who, key, scope.familyId, { member_id: scope.herId });
}

describe("starting the thirty days on independent PostgreSQL connections", () => {
  it("makes one trial when two organisers start it at once, and answers the second with it", async () => {
    const [first, second, holder] = await pg.clientPool("trial", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock(
      holder,
      (tx) => tx.select().from(members).where(eq(members.id, scope.herId)).for("update"),
      [
        { client: first, start: () => start(first, mia, "trial-mia") },
        { client: second, start: () => start(second, anna, "trial-anna") },
      ],
    );
    const results = await pg.settle("both starts", queued);
    // A unique violation here would mean both reached the insert: Anna would see an error.
    expect(results.map((result) => settled(result).status)).toEqual(["fulfilled", "fulfilled"]);
    const [made, answered] = results;
    if (made?.status !== "fulfilled" || answered?.status !== "fulfilled") {
      throw new Error("expected both organisers answered");
    }
    expect(answered.value.response).toEqual(made.value.response);

    expect(
      await seeder.db.select().from(subscriptions).where(eq(subscriptions.memberId, scope.herId)),
    ).toHaveLength(1);
    expect(
      await seeder.db.select().from(events).where(eq(events.name, "trial_started")),
    ).toHaveLength(1);
  });
});
