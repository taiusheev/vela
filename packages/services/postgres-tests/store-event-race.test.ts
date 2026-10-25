/**
 * RevenueCat's purchase events on independent PostgreSQL connections (`POST /webhooks/revenuecat`).
 * RevenueCat may deliver two events for one parent at once, or an older one late. Both lock her
 * member row first, so they are applied one after the other, and an event whose period ends before
 * the stored one is dropped as older news. Without the lock both read "no store row yet" and the
 * second insert fails on `subscriptions_member_id_key`; without the period check the older event
 * written last would leave her plan ending a year early.
 */

import { events, members, subscriptions, users, type VelaDatabase } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyStoreEvent, type StoreEvent } from "../src/store-events.ts";
import { seedFamily } from "../src/testing/seed.ts";
import {
  NOW,
  openPostgresHarness,
  type PostgresHarness,
  type RaceClient,
  settled,
} from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

const PAYER = "pg-race|payer";
let herId: string;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  herId = await seedPayingOrganiser(seeder.db);
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

/** A family whose organiser pays for her light through the App Store. */
async function seedPayingOrganiser(db: VelaDatabase): Promise<string> {
  const family = await seedFamily(db, { now: NOW });
  const [account] = await db
    .insert(users)
    .values({ authSubject: PAYER, displayName: "Mia" })
    .returning();
  if (account === undefined) throw new Error("expected the payer's account");
  await db.update(members).set({ userId: account.id }).where(eq(members.id, family.organiser.id));
  return family.member.id;
}

const YEAR_ONE = new Date("2027-10-25T00:00:00Z");
const YEAR_TWO = new Date("2028-10-25T00:00:00Z");

function storeEvent(id: string, type: string, expiresAt: Date): StoreEvent {
  return {
    id,
    type,
    appUserId: PAYER,
    memberId: herId,
    expiresAt,
    graceUntil: null,
    periodType: "NORMAL",
    productId: "vela_light_yearly",
    price: 2490,
    currency: "TWD",
    originalTransactionId: "2000000000000001",
  };
}

describe("store events on independent PostgreSQL connections", () => {
  it("applies a purchase and a later renewal delivered at once, ending on the later period", async () => {
    const [first, second, holder] = await pg.clientPool("store", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock(
      holder,
      (tx) => tx.select().from(members).where(eq(members.id, herId)).for("update"),
      [
        {
          client: second,
          start: () => applyStoreEvent(second.deps, storeEvent("evt-renewal", "RENEWAL", YEAR_TWO)),
        },
        {
          client: first,
          start: () =>
            applyStoreEvent(first.deps, storeEvent("evt-purchase", "INITIAL_PURCHASE", YEAR_ONE)),
        },
      ],
    );
    const results = await pg.settle("both events", queued);
    // A unique violation here would mean both reached the insert.
    expect(results.map((result) => settled(result).status)).toEqual(["fulfilled", "fulfilled"]);

    const rows = await seeder.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.memberId, herId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("revenuecat");
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.currentPeriodEnd?.toISOString()).toBe(YEAR_TWO.toISOString());
    expect(
      await seeder.db.select().from(events).where(eq(events.name, "plan_started")),
    ).toHaveLength(1);
  });
});
