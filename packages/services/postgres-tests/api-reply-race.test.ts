/**
 * Replying to an exchange on independent PostgreSQL connections (`POST /v1/exchanges/:id/replies`,
 * api-contract §4). Two people replying to her at once are different actors, so the actor advisory
 * lock never queues them; the exchange's own row lock, taken in `authorize`, is what does.
 *
 * What that lock protects is `replied_at`, the moment the family first answered her back. The state
 * cannot show a lost update — `replied` plus a reply is `replied` again — but
 * `repliedAt: exchange.repliedAt ?? now` can: a second reply that read the row before the first
 * committed would find it empty and write its own time over the first. Each reply here runs on its
 * own clock, a minute apart, so that overwrite would leave the later time behind.
 */
import { localDateOf } from "@vela/core";
import { events, exchanges, members, replies, users, type VelaDatabase } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { replyToApiExchange } from "../src/api-replies.ts";
import { seedExchange, seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

/** Mia organises; Sam is her brother. Each signs in as her or his own account. */
const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "pg-race|sam", sessionId: "session-sam" };

const EARLIER = new Date(NOW.getTime());
const LATER = new Date(NOW.getTime() + 60_000);

interface Scope {
  readonly exchangeId: string;
  readonly miaMemberId: string;
  readonly samMemberId: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedAnsweredExchange(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** This morning's question, delivered and answered, with two people who can reply to her. */
async function seedAnsweredExchange(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const brother = await seedGroupMember(db, family, { now: NOW, name: "Sam", externalId: "3001" });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, sam, "Sam", brother.member.id);
  const exchange = await seedExchange(db, family, {
    date: localDateOf(NOW, family.member.tz),
    state: "answered",
    deliveredAt: new Date(NOW.getTime() - 60 * 60_000),
    answeredAt: new Date(NOW.getTime() - 30 * 60_000),
  });
  return {
    exchangeId: exchange.id,
    miaMemberId: family.organiser.id,
    samMemberId: brother.member.id,
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

/** A reply written at `at`, whatever the harness clock says. */
function reply(client: RaceClient, who: SessionIdentity, key: string, at: Date) {
  return replyToApiExchange(
    { db: client.db, clock: { now: () => new Date(at.getTime()) } },
    who,
    key,
    scope.exchangeId,
    { text: `From ${who.sessionId}` },
  );
}

describe("replying to an exchange on independent PostgreSQL connections", () => {
  it("keeps both replies and the first one's time when two people reply to her at once", async () => {
    const [first, second, holder] = await pg.clientPool("reply", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // Mia queues first and replies a minute before Sam does.
    const queued = await pg.queueBehindRowLock(
      holder,
      (tx) => tx.select().from(exchanges).where(eq(exchanges.id, scope.exchangeId)).for("update"),
      [
        { client: first, start: () => reply(first, mia, "reply-mia", EARLIER) },
        { client: second, start: () => reply(second, sam, "reply-sam", LATER) },
      ],
    );
    const [hers, his] = await pg.settle("both replies", queued);
    if (hers?.status !== "fulfilled" || his?.status !== "fulfilled") {
      throw new Error(`expected both replies written, got ${hers?.status} and ${his?.status}`);
    }
    expect([hers.value.response.status, his.value.response.status]).toEqual([201, 201]);

    const written = await seeder.db
      .select()
      .from(replies)
      .where(eq(replies.exchangeId, scope.exchangeId))
      .orderBy(asc(replies.createdAt));
    expect(written).toEqual([
      expect.objectContaining({ memberId: scope.miaMemberId, createdAt: EARLIER }),
      expect.objectContaining({ memberId: scope.samMemberId, createdAt: LATER }),
    ]);

    // Sam's reply waited on the row until Mia's committed, so it found her time and kept it.
    const [exchange] = await seeder.db
      .select()
      .from(exchanges)
      .where(eq(exchanges.id, scope.exchangeId));
    expect(exchange?.state).toBe("replied");
    expect(exchange?.repliedAt).toEqual(EARLIER);

    expect(
      await seeder.db.select().from(events).where(eq(events.name, "reply_posted")),
    ).toHaveLength(2);
  });
});
