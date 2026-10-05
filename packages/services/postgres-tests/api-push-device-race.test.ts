/**
 * Registering and removing phones on independent PostgreSQL connections (`POST /v1/me/devices`,
 * `POST /v1/me/devices/:installationId/remove`, and Leave, ADR-34). The accounts are different
 * actors, so their actor locks queue nothing; what keeps each race right is:
 *
 * - two installations registering one token at once: the advisory lock every registration takes on
 *   its installation and its token, before it reads a device row. Without it the second finds no
 *   row with the token (the first's is not in its snapshot), inserts, and fails on the token's key;
 * - a phone handed to another account while its old account signs out, or leaves its last family:
 *   the delete names the account in the same statement, which PostgreSQL checks again once the row
 *   it waited on is free. Without that, the old account's delete takes the phone from the new one.
 */
import { members, pushDevices, users, type VelaDatabase, type VelaTransaction } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { leaveApiFamily } from "../src/api-members.ts";
import { registerApiPushDevice, removeApiPushDevice } from "../src/api-push.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
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
const sam: SessionIdentity = { authSubject: "pg-race|sam", sessionId: "session-sam" };

const X0 = "0198f6aa-0000-7000-8000-0000000000c0";
const X1 = "0198f6aa-0000-7000-8000-0000000000c1";
const X2 = "0198f6aa-0000-7000-8000-0000000000c2";

/** Made at run time: a literal shaped like a push token looks like a credential to scanning. */
function token(label: string): string {
  return `${["Exponent", "PushToken"].join("")}[pg-race-${label}]`;
}

interface Scope {
  readonly familyId: string;
  readonly samMemberId: string;
  readonly accounts: Readonly<Record<"mia" | "anna" | "sam", string>>;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedAccounts(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** Mia organises her family; Sam is in it and nowhere else; Anna has an account and no family. */
async function seedAccounts(db: VelaDatabase): Promise<Scope> {
  const family = await seedFamily(db, { now: NOW });
  const plain = await seedGroupMember(db, family, { now: NOW, name: "Sam", externalId: "4002" });
  const accountOf = async (identity: SessionIdentity, memberId?: string): Promise<string> => {
    const [account] = await db
      .insert(users)
      .values({ authSubject: identity.authSubject, displayName: identity.authSubject })
      .returning();
    if (account === undefined) throw new Error(`expected an account for ${identity.authSubject}`);
    if (memberId !== undefined) {
      await db.update(members).set({ userId: account.id }).where(eq(members.id, memberId));
    }
    return account.id;
  };
  return {
    familyId: family.family.id,
    samMemberId: plain.member.id,
    accounts: {
      mia: await accountOf(mia, family.organiser.id),
      anna: await accountOf(anna),
      sam: await accountOf(sam, plain.member.id),
    },
  };
}

/** A device already registered, written directly, as a registration before the race left it. */
async function seedDevice(userId: string, installationId: string, pushToken: string) {
  await seeder.db.insert(pushDevices).values({
    userId,
    installationId,
    token: pushToken,
    platform: "android",
    permission: "granted",
    registeredAt: NOW,
    createdAt: NOW,
  });
}

function register(
  client: RaceClient,
  who: SessionIdentity,
  installationId: string,
  pushToken: string,
  key: string,
) {
  return registerApiPushDevice(client.deps, who, key, {
    installation_id: installationId,
    token: pushToken,
    platform: "android",
    permission: "granted",
    quiet_channel_blocked: false,
  });
}

function onDevice(installationId: string) {
  return (tx: VelaTransaction) =>
    tx
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.installationId, installationId))
      .for("update");
}

async function devices() {
  const rows = await seeder.db
    .select({
      installationId: pushDevices.installationId,
      userId: pushDevices.userId,
      token: pushDevices.token,
    })
    .from(pushDevices)
    .orderBy(asc(pushDevices.installationId));
  return rows;
}

function statusOf(result: PromiseSettledResult<unknown> | undefined) {
  if (result === undefined) throw new Error("expected a result");
  return settled(result).status;
}

describe("registering phones on independent PostgreSQL connections", () => {
  it("gives one token, registered from two installations at once, to the last and answers both", async () => {
    const [first, second, holder] = await pg.clientPool("token", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    // The token was an old installation's, which both registrations find and wait on.
    await seedDevice(scope.accounts.sam, X0, token("shared"));
    const held = await pg.holdRows(holder, onDevice(X0));

    const annas = pg.track(register(first, anna, X1, token("shared"), "anna-registers"));
    await pg.waitForRowLockWait(first, [holder], annas);
    const mias = pg.track(register(second, mia, X2, token("shared"), "mia-registers"));
    // Behind Anna's lock on the token: an advisory lock with the guard, the old row without it.
    await pg.waitForLockWait(second, [first], mias);
    await held.release();
    const results = await pg.settle("both registrations", [annas, mias]);

    expect(results.map(settled)).toEqual([
      { status: "fulfilled", value: expect.objectContaining({ replayed: false }) },
      { status: "fulfilled", value: expect.objectContaining({ replayed: false }) },
    ]);
    expect(await devices()).toEqual([
      { installationId: X2, userId: scope.accounts.mia, token: token("shared") },
    ]);
  });
});

describe("a phone handed to another account as the old one lets it go", () => {
  it("keeps the phone with the account it moved to when the old account signs out", async () => {
    const [first, second, holder] = await pg.clientPool("remove", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    await seedDevice(scope.accounts.anna, X1, token("annas"));

    const queued = await pg.queueBehindRowLock<unknown>(holder, onDevice(X1), [
      { client: first, start: () => register(first, mia, X1, token("mias"), "mia-takes-it") },
      {
        client: second,
        start: () => removeApiPushDevice(second.deps, anna, "anna-signs-out", X1, {}),
      },
    ]);
    const [registered, removed] = await pg.settle("the move and the sign-out", queued);

    expect(statusOf(registered)).toBe("fulfilled");
    expect(removed?.status === "fulfilled" ? removed.value : removed).toMatchObject({
      response: { status: 200, body: { installation_id: X1, removed: false } },
    });
    expect(await devices()).toEqual([
      { installationId: X1, userId: scope.accounts.mia, token: token("mias") },
    ]);
  });

  it("keeps the phone with the account it moved to when the old account leaves its last family", async () => {
    const [first, second, holder] = await pg.clientPool("leave", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }
    await seedDevice(scope.accounts.sam, X1, token("sams"));

    const queued = await pg.queueBehindRowLock<unknown>(holder, onDevice(X1), [
      { client: first, start: () => register(first, anna, X1, token("annas"), "anna-takes-it") },
      {
        client: second,
        start: () =>
          leaveApiFamily(second.deps, sam, "sam-leaves", scope.familyId, scope.samMemberId, {}),
      },
    ]);
    const [registered, left] = await pg.settle("the move and the leave", queued);

    expect(statusOf(registered)).toBe("fulfilled");
    expect(statusOf(left)).toBe("fulfilled");
    expect(await devices()).toEqual([
      { installationId: X1, userId: scope.accounts.anna, token: token("annas") },
    ]);
    const [samRow] = await seeder.db
      .select({ status: members.status })
      .from(members)
      .where(eq(members.id, scope.samMemberId));
    expect(samRow?.status).toBe("left");
  });
});
