/**
 * Her unblock and a tick of her schedule, on independent PostgreSQL connections (flows §3.12). While
 * her link is blocked, her schedule wakes for none of the repeat and quiet thresholds of a morning
 * delivered before the block, so a tick in the block stores a later, unrelated wake. Her `unblocked`
 * event marks her wake due in the transaction that clears the mark (`markWakeDue`). A tick that read
 * her still blocked and stores its wake after that mark must keep the sooner one (`storedWake` in
 * `tick.ts`), or the quiet that the unblock let through is judged hours late: `reconcile` ticks her
 * only once her stored wake has passed.
 */
import type { InboundEvent } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import { type ChannelLink, channelLinks, members, type VelaTransaction } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleInbound } from "../src/inbound/router.ts";
import { seedExchange, seedFamily, seedLinkedGroup } from "../src/testing/seed.ts";
import { tickMember } from "../src/tick.ts";
import {
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

const hour = 60 * 60_000;
/** The wake a tick in the block stored: tomorrow's preparation at 22:00, fourteen hours on. */
const STALE_WAKE = new Date(NOW.getTime() + 14 * hour);

interface Scope {
  readonly herId: string;
  readonly herLink: ChannelLink;
}

let scope: Scope;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  scope = await seedBlockedMorning(seeder);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/**
 * Her light on for ten days; this morning was delivered three hours ago and is unanswered, and she
 * blocked the bot an hour after it reached her, so her schedule stored a later wake.
 */
async function seedBlockedMorning(client: RaceClient): Promise<Scope> {
  const seed = await seedFamily(client.db, { now: new Date(NOW.getTime() - 240 * hour) });
  await seedLinkedGroup(client.db, seed, { now: NOW });
  await seedExchange(client.db, seed, {
    date: localDateOf(NOW, seed.member.tz),
    state: "delivered",
    deliveredAt: new Date(NOW.getTime() - 3 * hour),
  });
  await client.db
    .update(channelLinks)
    .set({ blockedAt: new Date(NOW.getTime() - 2 * hour) })
    .where(eq(channelLinks.id, seed.memberLink.id));
  await client.db
    .update(members)
    .set({ nextWakeAt: STALE_WAKE })
    .where(eq(members.id, seed.member.id));
  return { herId: seed.member.id, herLink: seed.memberLink };
}

function unblocked(): InboundEvent {
  return {
    channel: "telegram",
    eventId: "tg:unblocked",
    at: NOW.toISOString(),
    sender: { externalUserId: scope.herLink.externalId },
    conversation: { externalId: scope.herLink.externalId, kind: "private" },
    kind: "unblocked",
  };
}

function onHerRow(tx: VelaTransaction) {
  return tx.select().from(members).where(eq(members.id, scope.herId)).for("no key update");
}

function outcomes(results: readonly PromiseSettledResult<unknown>[]): string[] {
  return results.map((result) => {
    const shown = settled(result);
    return shown.status === "fulfilled" ? "fulfilled" : shown.reason;
  });
}

describe("her unblock and a tick of her schedule", () => {
  it("keeps the wake her unblock marked due when a tick that read her blocked stores its wake after it", async () => {
    const [unblocker, ticker, holder] = await pg.clientPool("unblock", 3);
    if (unblocker === undefined || ticker === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    // Her unblock has cleared the mark and waits to mark her wake due. The tick then reads her day,
    // still blocked since the unblock has not committed, and waits to store its later wake.
    const held = await pg.holdRows(holder, onHerRow);
    const unblocking = pg.track(handleInbound(pg.jobDeps(unblocker), [unblocked()]));
    await pg.waitForRowLockWait(unblocker, [holder], unblocking);
    const ticking = pg.track(tickMember(pg.jobDeps(ticker), scope.herId));
    await pg.waitForRowLockWait(ticker, [unblocker], ticking);
    await held.release();
    const results = await pg.settle<unknown>("her unblock and the tick", [unblocking, ticking]);
    expect(outcomes(results)).toEqual(["fulfilled", "fulfilled"]);

    // The tick's decision did not see the unblock, so the sooner wake — now — stands.
    const [her] = await seeder.db.select().from(members).where(eq(members.id, scope.herId));
    expect(her?.nextWakeAt).toEqual(NOW);
    const [link] = await seeder.db
      .select()
      .from(channelLinks)
      .where(eq(channelLinks.memberId, scope.herId));
    expect(link?.blockedAt).toBeNull();
    const ticked = results[1];
    expect(ticked?.status === "fulfilled" ? ticked.value : null).toEqual(NOW);
  });
});
