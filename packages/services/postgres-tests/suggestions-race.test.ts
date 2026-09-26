/**
 * Tomorrow's suggestion on independent PostgreSQL connections (build plan 3.3). The nightly writer
 * and a compose both reach for her morning, and both queue on her member row: the writer takes it
 * `for no key update` before it inserts the day's one suggestion, and compose takes it `for update`
 * before it claims the morning and marks the suggestion it started from. PGlite, on one connection,
 * never makes either of them wait. Every race here queues its contenders on her row behind a
 * connection that holds it, so each one reads what the one before it committed.
 */
import { addDays, localDateOf } from "@vela/core";
import {
  aiCalls,
  events,
  exchanges,
  members,
  suggestions,
  users,
  type VelaDatabase,
} from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { composeApiAsk } from "../src/api-asks.ts";
import { loadApiToday } from "../src/api-today.ts";
import { BANK_PROMPT_VERSION, writeSuggestionFor } from "../src/suggestions.ts";
import { createFakeClock } from "../src/testing/fakes.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import {
  databaseErrorCode,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

/** Mia organises; Sam is her brother. Each signs in as her or his own account. */
const mia: SessionIdentity = { authSubject: "pg-race|mia", sessionId: "session-mia" };
const sam: SessionIdentity = { authSubject: "pg-race|sam", sessionId: "session-sam" };

/** Each compose runs on its own clock, so a second mark over the first would show its later time. */
const EARLIER = new Date(NOW.getTime());
const LATER = new Date(NOW.getTime() + 60_000);

interface Scope {
  readonly familyId: string;
  readonly recipientId: string;
  readonly timeZone: string;
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
  scope = await seedSuggestionFamily(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** Her family, with two people who can ask her something and an account each. */
async function seedSuggestionFamily(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const brother = await seedGroupMember(db, family, { now: NOW, name: "Sam", externalId: "3001" });
  await signIn(db, mia, "Mia", family.organiser.id);
  await signIn(db, sam, "Sam", brother.member.id);
  return {
    familyId: family.family.id,
    recipientId: family.member.id,
    timeZone: family.member.tz,
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

function tomorrow(): string {
  return addDays(localDateOf(NOW, scope.timeZone), 1);
}

/** Her suggestion for tomorrow, as the nightly writer stores a bank item. */
async function seedSuggestion(): Promise<string> {
  const [row] = await seeder.db
    .insert(suggestions)
    .values({
      familyId: scope.familyId,
      aboutMemberId: scope.recipientId,
      localDay: tomorrow(),
      bankId: "life.childhood.home",
      type: "question",
      text: "",
      promptVersion: BANK_PROMPT_VERSION,
      createdAt: new Date(NOW.getTime() - 60 * 60_000),
    })
    .returning({ id: suggestions.id });
  if (row === undefined) throw new Error("expected a suggestion");
  return row.id;
}

/** An ask for her morning on `date`, composed at `at` whatever the harness clock says. */
function compose(
  client: RaceClient,
  who: SessionIdentity,
  key: string,
  date: string,
  at: Date,
  suggestionId?: string,
) {
  return composeApiAsk({ db: client.db, clock: createFakeClock(at) }, who, key, scope.familyId, {
    recipient_id: scope.recipientId,
    type: "question",
    text: `Composed by ${who.sessionId}`,
    when: "date",
    date,
    ...(suggestionId === undefined ? {} : { suggestion_id: suggestionId }),
  });
}

/** The nightly writer's step for one day of hers, with its own AI port and log. */
function write(client: RaceClient, date: string) {
  return writeSuggestionFor(pg.jobDeps(client), scope.recipientId, date);
}

/** Contenders queued on her member row, in the order given, behind a connection that holds it. */
function queueOnHerRow<T>(
  holder: RaceClient,
  contenders: readonly { client: RaceClient; start: () => Promise<T> }[],
) {
  return pg.queueBehindRowLock<T>(
    holder,
    (tx) => tx.select().from(members).where(eq(members.id, scope.recipientId)).for("update"),
    contenders,
  );
}

/**
 * The SQLSTATE each contender failed with, if any: every rule here is held by her row lock, so a
 * unique violation or a deadlock is the incident, never the control path.
 */
function databaseErrors(results: readonly PromiseSettledResult<unknown>[]) {
  return results.map((result) =>
    result.status === "rejected" ? databaseErrorCode(result.reason) : undefined,
  );
}

async function suggestionRows() {
  return seeder.db
    .select()
    .from(suggestions)
    .where(eq(suggestions.aboutMemberId, scope.recipientId));
}

describe("tomorrow's suggestion on independent PostgreSQL connections", () => {
  it("marks a suggestion used once, at the first ask, when two asks for different mornings start from it", async () => {
    const [first, second, holder] = await pg.clientPool("suggestion", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const suggestionId = await seedSuggestion();
    const date = tomorrow();
    const dayAfter = addDays(date, 1);

    // Mia queues first and composes a minute before Sam, for a different morning.
    const queued = await queueOnHerRow(holder, [
      {
        client: first,
        start: () => compose(first, mia, "key-mia", date, EARLIER, suggestionId),
      },
      {
        client: second,
        start: () => compose(second, sam, "key-sam", dayAfter, LATER, suggestionId),
      },
    ]);
    const results = await pg.settle("both composes", queued);
    expect(databaseErrors(results)).toEqual([undefined, undefined]);
    const [hers, his] = results;
    if (hers?.status !== "fulfilled" || his?.status !== "fulfilled") {
      throw new Error(`expected both asks composed, got ${JSON.stringify(results.map(settled))}`);
    }
    expect([hers.value.response.status, his.value.response.status]).toEqual([201, 201]);

    const asks = await seeder.db
      .select()
      .from(exchanges)
      .where(eq(exchanges.recipientId, scope.recipientId));
    expect(asks.map((row) => row.scheduledFor).sort()).toEqual([date, dayAfter]);

    // Sam's mark waited on her row until Mia's committed, so it found the suggestion used and left
    // her time on it.
    const [suggestion] = await suggestionRows();
    expect(suggestion?.usedAt).toEqual(EARLIER);
    const composed = await seeder.db
      .select({ memberId: events.memberId, props: events.props })
      .from(events)
      .where(eq(events.name, "ask_composed"));
    expect(composed.map((row) => [row.memberId, row.props.from_suggestion]).sort()).toEqual(
      [
        [scope.miaMemberId, true],
        [scope.samMemberId, false],
      ].sort(),
    );
  });

  it("writes one suggestion for a day two writers reach at once, without the unique key firing", async () => {
    const [first, second, holder] = await pg.clientPool("writer", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const date = tomorrow();

    // Both find the day empty before either writes, then queue on her row.
    const queued = await queueOnHerRow(holder, [
      { client: first, start: () => write(first, date) },
      { client: second, start: () => write(second, date) },
    ]);
    const results = await pg.settle("both writers", queued);
    expect(databaseErrors(results)).toEqual([undefined, undefined]);
    expect(results.map(settled)).toEqual([
      { status: "fulfilled", value: "written" },
      { status: "fulfilled", value: "existing" },
    ]);

    const rows = await suggestionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.localDay).toBe(date);

    // The model answered both, and both calls were paid for: the one that lost the day is logged
    // too. Both picked the same bank item, since the pick depends on nothing but what is stored.
    const calls = await seeder.db.select().from(aiCalls).where(eq(aiCalls.call, "suggest"));
    expect(calls.map((call) => call.inputRef)).toEqual([
      { member_id: scope.recipientId, for_date: date, bank_id: rows[0]?.bankId },
      { member_id: scope.recipientId, for_date: date, bank_id: rows[0]?.bankId },
    ]);
  });

  it("writes no suggestion for a morning an ask took while the writer waited", async () => {
    const [first, second, holder] = await pg.clientPool("claim", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    const date = tomorrow();

    // The writer found the morning free before it queued; the compose ahead of it takes it.
    const queued = await queueOnHerRow<unknown>(holder, [
      { client: first, start: () => compose(first, mia, "key-mia", date, EARLIER) },
      { client: second, start: () => write(second, date) },
    ]);
    const results = await pg.settle("the compose and the writer", queued);
    expect(databaseErrors(results)).toEqual([undefined, undefined]);
    expect(results.map(settled)).toEqual([
      {
        status: "fulfilled",
        value: expect.objectContaining({ response: expect.objectContaining({ status: 201 }) }),
      },
      { status: "fulfilled", value: "claimed" },
    ]);
    expect(await suggestionRows()).toEqual([]);

    const [ask] = await seeder.db
      .select()
      .from(exchanges)
      .where(eq(exchanges.recipientId, scope.recipientId));
    const day = await loadApiToday(seeder.db, mia, scope.familyId, NOW);
    expect(day?.tomorrow).toEqual([
      expect.objectContaining({
        local_day: date,
        ask: expect.objectContaining({ id: ask?.id, asker_name: "Mia" }),
        suggestion: null,
      }),
    ]);
  });
});
