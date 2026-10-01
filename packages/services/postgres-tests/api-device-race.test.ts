/**
 * Setting her phone up for the parent surface on independent PostgreSQL connections (ADR-35). She
 * has one phone at most: setting up deletes her `device` links and writes one, and no constraint
 * holds that, since each phone's hash is its own key. Two organisers setting up at once are
 * different actors, so the lock on her member row is what queues them, and the second replaces the
 * first. Without it both delete nothing they can see and both write, leaving her two phones.
 */

import { LANGS, type Lang } from "@vela/contracts";
import { channelLinks, members, users, type VelaDatabase } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "../src/api-access.ts";
import { memberOfDeviceToken, setUpApiDevice } from "../src/api-device.ts";
import { seedFamily, seedGroupMember } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

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

/** Each contender with its own token, as two phones would make. */
function setUp(client: RaceClient, who: SessionIdentity, token: string) {
  return setUpApiDevice(
    {
      ...client.deps,
      random: { token: () => token },
      config: {
        privacyNoticeUrls: Object.fromEntries(
          LANGS.map((lang) => [lang, `https://vela.test/privacy/${lang}`]),
        ) as Record<Lang, string>,
      },
    },
    who,
    scope.familyId,
    scope.herId,
  );
}

const MIA_TOKEN = "M".repeat(43);
const ANNA_TOKEN = "A".repeat(43);

describe("setting her phone up on independent PostgreSQL connections", () => {
  it("leaves her one phone, the second organiser's, when two set it up at once", async () => {
    const [first, second, holder] = await pg.clientPool("device", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock(
      holder,
      (tx) => tx.select().from(members).where(eq(members.id, scope.herId)).for("update"),
      [
        { client: first, start: () => setUp(first, mia, MIA_TOKEN) },
        { client: second, start: () => setUp(second, anna, ANNA_TOKEN) },
      ],
    );
    const results = await pg.settle("both set-ups", queued);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);

    const links = await seeder.db
      .select()
      .from(channelLinks)
      .where(and(eq(channelLinks.memberId, scope.herId), eq(channelLinks.channel, "device")));
    expect(links).toHaveLength(1);
    expect(await memberOfDeviceToken(seeder.db, MIA_TOKEN)).toBeNull();
    expect((await memberOfDeviceToken(seeder.db, ANNA_TOKEN))?.id).toBe(scope.herId);
  });
});
