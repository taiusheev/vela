/**
 * A family's deletion and an invite into it, accepted at the same moment, on independent PostgreSQL
 * connections (flows §3.15). Deleting a family removes its members' channel links at once, so the
 * people in it are free to join another family without waiting a day for retention (a messenger
 * account is linked to one member at most). An invite accepted concurrently must not leave a link
 * behind in the family being deleted: `acceptInvite` locks the family row for share before it reads
 * `deleted_at`, and the deletion's update of that row then waits for the link and removes it.
 *
 * To hold the invite between its family check and its link insert, a third connection inserts a
 * link for the same Telegram account and keeps it uncommitted: the invite's insert waits on that
 * row's unique key. The holder then rolls back, so the invite's link goes in.
 */
import type { InboundEvent } from "@vela/contracts";
import { channelLinks, families, invites, members } from "@vela/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteFamily } from "../src/admin.ts";
import { handleInbound } from "../src/inbound/router.ts";
import { seedFamily } from "../src/testing/seed.ts";
import {
  HOLD_MS,
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

const FOUNDER = { admin: "founder@vela.test" };
const NEWCOMER = "7001";
const TOKEN = "race-invite-token-000000000001";

interface Scope {
  readonly familyId: string;
  /** A member of another family, whose id the holder's uncommitted link uses. */
  readonly elsewhereMemberId: string;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedInvitedFamily(seeder);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** The Chens, with a second adult invited by link; and the Lins, elsewhere. */
async function seedInvitedFamily(client: RaceClient): Promise<Scope> {
  const chens = await seedFamily(client.db, { now: NOW });
  const [invited] = await client.db
    .insert(members)
    .values({
      familyId: chens.family.id,
      role: "member",
      displayName: "Grandpa",
      language: "en",
      tz: "Asia/Taipei",
      country: "TW",
      status: "invited",
      turnsIn: false,
      primarySurface: "telegram",
      lightOn: false,
      createdAt: NOW,
    })
    .returning();
  if (invited === undefined) throw new Error("expected the invited member");
  await client.db.insert(invites).values({
    familyId: chens.family.id,
    invitedBy: chens.organiser.id,
    forMemberId: invited.id,
    token: TOKEN,
    channel: "link",
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60_000),
  });
  const lins = await seedFamily(client.db, {
    now: NOW,
    familyName: "The Lins",
    organiserExternalId: "1101",
    memberExternalId: "2101",
  });
  return { familyId: chens.family.id, elsewhereMemberId: lins.organiser.id };
}

function opensInvite(): InboundEvent {
  return {
    channel: "telegram",
    eventId: "tg:invite-open",
    at: NOW.toISOString(),
    kind: "start",
    sender: { externalUserId: NEWCOMER, displayName: "Grandpa", languageCode: "en" },
    conversation: { externalId: NEWCOMER, kind: "private" },
    messageId: "1",
    startParam: TOKEN,
  };
}

class RolledBack extends Error {}

/** An uncommitted link for the newcomer's account: the invite's insert waits on its unique key. */
async function holdNewcomersKey(holder: RaceClient): Promise<{ release(): Promise<void> }> {
  const entered = pg.latch(`${holder.name} to insert the link`);
  const release = pg.latch(`${holder.name} to roll the link back`, HOLD_MS);
  const held = pg.track(
    holder.db
      .transaction(async (tx) => {
        await tx.insert(channelLinks).values({
          memberId: scope.elsewhereMemberId,
          channel: "telegram",
          externalId: NEWCOMER,
          linkedAt: NOW,
        });
        entered.release();
        await release.wait();
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      }),
  );
  await pg.reach(`${holder.name} to insert the link`, entered, held);
  return {
    release: async () => {
      release.release();
      await pg.finish(`${holder.name} to roll the link back`, held);
    },
  };
}

async function linksInFamily(): Promise<string[]> {
  const rows = await seeder.db
    .select({ externalId: channelLinks.externalId })
    .from(channelLinks)
    .where(
      inArray(
        channelLinks.memberId,
        seeder.db
          .select({ id: members.id })
          .from(members)
          .where(eq(members.familyId, scope.familyId)),
      ),
    );
  return rows.map((row) => row.externalId).sort();
}

describe("a family's deletion and an invite into it", () => {
  it("leaves no link in the deleted family when the invite was past its family check", async () => {
    const [accepter, deleter, holder] = await pg.clientPool("delete-link", 3);
    if (accepter === undefined || deleter === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const held = await holdNewcomersKey(holder);
    // The invite has read the family, not yet deleted, and waits to insert the newcomer's link.
    const accepting = pg.track(handleInbound(pg.jobDeps(accepter), [opensInvite()]));
    await pg.waitForLockWait(accepter, [holder], accepting);
    // The deletion waits behind the invite's share lock on the family row; without that lock it
    // would mark the family and remove its links before the invite's link went in.
    const deleting = pg.track(deleteFamily(pg.jobDeps(deleter), FOUNDER, scope.familyId));
    await pg.waitForRowLockWaitOrCompletion(deleter, [accepter], deleting);
    await held.release();
    const results = await pg.settle<unknown>("the invite and the deletion", [accepting, deleting]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);

    const [family] = await seeder.db
      .select({ deletedAt: families.deletedAt })
      .from(families)
      .where(eq(families.id, scope.familyId));
    expect(family?.deletedAt).not.toBeNull();
    expect(await linksInFamily()).toEqual([]);
  });

  it("refuses an invite into a family already marked deleted, and frees its members at once", async () => {
    const [deleter, accepter] = await pg.clientPool("delete-first", 2);
    if (deleter === undefined || accepter === undefined) {
      throw new Error("expected two connections");
    }

    await deleteFamily(pg.jobDeps(deleter), FOUNDER, scope.familyId);
    expect(await linksInFamily()).toEqual([]);
    await handleInbound(pg.jobDeps(accepter), [opensInvite()]);

    expect(await linksInFamily()).toEqual([]);
  });
});
