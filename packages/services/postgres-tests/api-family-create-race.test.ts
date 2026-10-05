/**
 * Creating a family on independent PostgreSQL connections (`POST /v1/families`, api-contract §2).
 * An account runs at most one family, and nothing in the schema says so:
 * `members_family_id_user_id_key` keeps one account out of one family twice, not out of two
 * families. The rule is exactly as good as the check in `mutate` and the lock that runs it once at
 * a time. Two creates from one account are one actor, so `runApiMutation`'s actor advisory lock
 * queues them; the second must then find the first's family and refuse, having written nothing.
 */
import { events, families, invites, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { AlreadyOrganiserError, createApiFamily } from "../src/api-families.ts";
import type { Deps } from "../src/deps.ts";
import { createFakeRandom } from "../src/testing/fakes.ts";
import { openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let accountId: string;
let random: Deps["random"];
const organiser: SessionIdentity = { authSubject: "pg-race|organiser", sessionId: "session-one" };

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  // One random for every create in a test. Two fresh fakes would both mint `token-1`, so a broken
  // rule would fail on the invite token's unique key rather than on the second family it made.
  random = createFakeRandom();
  const [account] = await seeder.db
    .insert(users)
    .values({ authSubject: organiser.authSubject, displayName: "Mia", tz: "Asia/Taipei" })
    .returning();
  if (account === undefined) throw new Error("the organiser's account was not seeded");
  accountId = account.id;
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

function create(client: RaceClient, key: string) {
  return pg.track(
    createApiFamily({ ...pg.jobDeps(client), random }, organiser, key, {
      country: "TW",
      kept_light_member: {
        display_name: "Mom",
        address_form: "Mrs Chen",
        language: "en",
        tz: "Asia/Taipei",
        wake_time: "07:00",
      },
    }),
  );
}

describe("creating a family on independent PostgreSQL connections", () => {
  it("makes one family when one account asks twice at once, and the refusal leaves nothing behind", async () => {
    const earlier = await pg.client("earlier");
    const later = await pg.client("later");
    const blocker = await pg.client("blocker");
    const lock = await pg.holdActorLock(blocker, organiser.authSubject);
    // Two keys, as two taps or two phones would send: a replay would be the receipt's business.
    const first = create(earlier, "create-one");
    await pg.waitForActorLockWait(earlier, [blocker], first);
    const second = create(later, "create-two");
    await pg.waitForActorLockWait(later, [blocker], second);

    lock.release();
    await pg.finish("the blocker", lock.done);
    const [made, refused] = await pg.settle("both creates", [first, second]);
    if (made?.status !== "fulfilled" || refused?.status !== "rejected") {
      throw new Error(
        `expected one family and one refusal, got ${made?.status} and ${refused?.status}`,
      );
    }
    expect(made.value.response.status).toBe(201);
    expect(made.value.replayed).toBe(false);
    expect(refused.reason).toBeInstanceOf(AlreadyOrganiserError);

    // The refusal comes before any insert, and its transaction rolls back besides: whichever of the
    // two held, a second family, organiser, invited member, invite or event must not exist.
    expect(await seeder.db.select().from(families)).toHaveLength(1);
    expect(await seeder.db.select().from(members).where(eq(members.userId, accountId))).toEqual([
      expect.objectContaining({ role: "organiser", leftAt: null }),
    ]);
    expect(await seeder.db.select().from(members)).toHaveLength(2);
    expect(await seeder.db.select().from(invites)).toHaveLength(1);
    expect(
      await seeder.db.select().from(events).where(eq(events.name, "family_created")),
    ).toHaveLength(1);
  });
});
