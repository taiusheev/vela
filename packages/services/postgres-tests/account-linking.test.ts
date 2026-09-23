import { ApiLinkChallenge, type InboundEvent } from "@vela/contracts";
import { accountLinkChallenges, events, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  completeAccountLink,
  issueAccountLinkCode,
  startAccountLink,
} from "../src/account-linking.ts";
import type { SessionIdentity } from "../src/api-access.ts";
import { disableApiAccount } from "../src/api-account-writes.ts";
import type { Deps } from "../src/deps.ts";
import { createFakeRandom } from "../src/testing/fakes.ts";
import { type SeededFamily, seedFamily } from "../src/testing/seed.ts";
import {
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let seed: SeededFamily;
let ownerId: string;
let random: Deps["random"];
const identity: SessionIdentity = { authSubject: "pg-race|linker", sessionId: "session-one" };
const notFound = { name: "VelaError", code: "not_found" };

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  // Every client is closed after each test, so the seeding connection is opened per test too.
  seeder = await pg.client("seeder");
  random = createFakeRandom();
  seed = await seedFamily(seeder.db, { now: NOW });
  const [owner] = await seeder.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Mia" })
    .returning();
  if (owner === undefined) throw new Error("the owner account was not seeded");
  ownerId = owner.id;
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function linkDeps(client: RaceClient): Deps {
  return { ...pg.jobDeps(client), random };
}

function telegramStart(): InboundEvent {
  const externalId = seed.memberLink.externalId;
  return {
    channel: "telegram",
    eventId: "verified-private-start",
    at: NOW.toISOString(),
    kind: "start",
    sender: { externalUserId: externalId },
    conversation: { externalId, kind: "private" },
  };
}

async function startChallenge(client: RaceClient, key = "start") {
  const started = await pg.track(startAccountLink(client.deps, identity, key));
  return ApiLinkChallenge.parse(started.response.body);
}

async function issueCode(client: RaceClient, challengeId: string) {
  return pg.track(issueAccountLinkCode(linkDeps(client), challengeId, telegramStart()));
}

function complete(client: RaceClient, key: string, challengeId: string, code: string) {
  return pg.track(completeAccountLink(client.deps, identity, key, challengeId, code));
}

async function challenges() {
  return seeder.db.select().from(accountLinkChallenges).orderBy(accountLinkChallenges.createdAt);
}

async function linkedMember() {
  const [member] = await seeder.db.select().from(members).where(eq(members.id, seed.member.id));
  return member?.userId ?? null;
}

async function linkEvents() {
  return seeder.db.select().from(events).where(eq(events.name, "account_linked"));
}

describe("account linking on independent PostgreSQL connections", () => {
  it("links the member once when two connections complete the same challenge with the same code", async () => {
    const opener = await pg.client("opener");
    const first = await pg.client("first");
    const second = await pg.client("second");
    const blocker = await pg.client("blocker");
    const challenge = await startChallenge(opener);
    const { code } = await issueCode(opener, challenge.challenge_id);
    const lock = await pg.holdActorLock(blocker, identity.authSubject);
    const queued: Promise<unknown>[] = [];
    for (const [index, client] of [first, second].entries()) {
      const operation = complete(client, `complete-${index}`, challenge.challenge_id, code);
      queued.push(operation);
      await pg.waitForActorLockWait(client, [blocker], operation);
    }

    lock.release();
    await pg.finish("the blocker", lock.done);
    const results = await pg.finish("both completions", Promise.allSettled(queued));

    for (const result of results) {
      expect(settled(result)).toMatchObject({
        status: "fulfilled",
        value: {
          response: {
            status: 200,
            body: { linked: true, member_id: seed.member.id, family_id: seed.family.id },
          },
        },
      });
    }
    expect(await linkedMember()).toBe(ownerId);
    expect(await linkEvents()).toHaveLength(1);
    expect(await challenges()).toEqual([
      expect.objectContaining({ completedAt: NOW, codeHash: null, attempts: 0 }),
    ]);
  });

  it("keeps only the newest code valid when two connections issue on the actor lock", async () => {
    const opener = await pg.client("opener");
    const reissuer = await pg.client("reissuer");
    const completer = await pg.client("completer");
    const blocker = await pg.client("blocker");
    const challenge = await startChallenge(opener);
    const lock = await pg.holdActorLock(blocker, identity.authSubject);
    const issuing = issueCode(opener, challenge.challenge_id);
    await pg.waitForActorLockWait(opener, [blocker], issuing);
    const reissuing = issueCode(reissuer, challenge.challenge_id);
    await pg.waitForActorLockWait(reissuer, [blocker], reissuing);

    lock.release();
    await pg.finish("the blocker", lock.done);
    const { code: first } = await pg.finish("the first code", issuing);
    const { code: second } = await pg.finish("the second code", reissuing);

    expect(second).not.toBe(first);
    expect(
      await pg.finish(
        "a completion with the replaced code",
        complete(completer, "stale", challenge.challenge_id, first),
      ),
    ).toMatchObject({ response: { status: 200, body: { linked: false } } });
    expect(await challenges()).toEqual([expect.objectContaining({ attempts: 1 })]);
    expect(await linkedMember()).toBeNull();

    expect(
      await pg.finish(
        "a completion with the newest code",
        complete(completer, "fresh", challenge.challenge_id, second),
      ),
    ).toMatchObject({ response: { status: 200, body: { linked: true } } });
    expect(await linkedMember()).toBe(ownerId);
  });

  it("invalidates the earlier challenge when two starts are queued on the actor lock", async () => {
    const earlier = await pg.client("earlier");
    const later = await pg.client("later");
    const blocker = await pg.client("blocker");
    const lock = await pg.holdActorLock(blocker, identity.authSubject);
    const first = pg.track(startAccountLink(earlier.deps, identity, "start-one"));
    await pg.waitForActorLockWait(earlier, [blocker], first);
    const second = pg.track(startAccountLink(later.deps, identity, "start-two"));
    await pg.waitForActorLockWait(later, [blocker], second);

    lock.release();
    await pg.finish("the blocker", lock.done);
    const opened = ApiLinkChallenge.parse(
      (await pg.finish("the first start", first)).response.body,
    );
    const reopened = ApiLinkChallenge.parse(
      (await pg.finish("the second start", second)).response.body,
    );

    expect(reopened.challenge_id).not.toBe(opened.challenge_id);
    expect(await challenges()).toEqual([
      expect.objectContaining({ id: opened.challenge_id, invalidatedAt: NOW, codeHash: null }),
      expect.objectContaining({ id: reopened.challenge_id, invalidatedAt: null }),
    ]);
  });

  it("refuses a completion queued behind a disable of the same account", async () => {
    const opener = await pg.client("opener");
    const completer = await pg.client("completer");
    const disabler = await pg.client("disabler");
    const blocker = await pg.client("blocker");
    const challenge = await startChallenge(opener);
    const { code } = await issueCode(opener, challenge.challenge_id);
    const lock = await pg.holdActorLock(blocker, identity.authSubject);
    const disabling = pg.track(disableApiAccount(disabler.deps, identity.authSubject));
    await pg.waitForActorLockWait(disabler, [blocker], disabling);
    const completing = complete(completer, "after-disable", challenge.challenge_id, code);
    await pg.waitForActorLockWait(completer, [blocker], completing);

    lock.release();
    await pg.finish("the blocker", lock.done);
    await pg.finish("the disable", disabling);
    await expect(pg.finish("the completion", completing)).rejects.toMatchObject(notFound);

    expect(await linkedMember()).toBeNull();
    expect(await challenges()).toEqual([]);
    expect(await pg.receipts(identity.authSubject)).toEqual([]);
    expect(await linkEvents()).toEqual([]);
    expect(await pg.accounts()).toEqual([
      expect.objectContaining({ authSubject: identity.authSubject, deletedAt: NOW }),
    ]);
  });

  it("purges the challenge and receipts when a disable follows a completion, leaving the membership pointing at the tombstone", async () => {
    const opener = await pg.client("opener");
    const completer = await pg.client("completer");
    const disabler = await pg.client("disabler");
    const blocker = await pg.client("blocker");
    const challenge = await startChallenge(opener);
    const { code } = await issueCode(opener, challenge.challenge_id);
    const lock = await pg.holdActorLock(blocker, identity.authSubject);
    const completing = complete(completer, "before-disable", challenge.challenge_id, code);
    await pg.waitForActorLockWait(completer, [blocker], completing);
    const disabling = pg.track(disableApiAccount(disabler.deps, identity.authSubject));
    await pg.waitForActorLockWait(disabler, [blocker], disabling);

    lock.release();
    await pg.finish("the blocker", lock.done);
    expect(await pg.finish("the completion", completing)).toMatchObject({
      response: { status: 200, body: { linked: true } },
    });
    await pg.finish("the disable", disabling);

    expect(await challenges()).toEqual([]);
    expect(await pg.receipts(identity.authSubject)).toEqual([]);
    expect(await linkEvents()).toHaveLength(1);
    expect(await pg.accounts()).toEqual([
      expect.objectContaining({ authSubject: identity.authSubject, deletedAt: NOW }),
    ]);
    // Disable is a tombstone, not erasure (API contract §1): the membership it linked still names
    // the deleted account, which the erasure work still has to clear.
    expect(await linkedMember()).toBe(ownerId);
  });
});
