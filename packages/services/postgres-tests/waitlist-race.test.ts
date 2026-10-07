/**
 * Joining the website's waitlist on independent PostgreSQL connections. The same address sent
 * twice at once (a double tap, a retried form) must keep one row and answer both alike: the unique
 * address is the idempotency key, and `on conflict do nothing` is what turns the second insert
 * into a quiet no-op rather than a unique violation shown to the person as an error.
 */

import { waitlistSignups } from "@vela/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { joinWaitlist } from "../src/waitlist.ts";
import { openPostgresHarness, type PostgresHarness, type RaceClient, settled } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

describe("joining the waitlist on independent PostgreSQL connections", () => {
  it("keeps one row and answers both when the same address arrives while the first is uncommitted", async () => {
    const [holder, contender] = await pg.clientPool("waitlist", 2);
    if (holder === undefined || contender === undefined) {
      throw new Error("expected two race connections");
    }
    const input = { email: "mia@example.com", lang: "en", role: "organiser" } as const;

    // The first submit has inserted its row and not yet committed; the second reaches the same
    // unique key and has to wait on it.
    const held = await pg.holdRows(holder, (tx) => joinWaitlist(tx, input));
    const second = pg.track(joinWaitlist(contender.db, { ...input, role: null }));
    await pg.waitForLockWait(contender, [holder], second);
    await held.release();
    const [result] = await pg.settle("the second submit", [second]);

    expect(result === undefined ? null : settled(result).status).toBe("fulfilled");
    const rows = await seeder.db.select().from(waitlistSignups);
    expect(rows.map((row) => [row.email, row.role])).toEqual([["mia@example.com", "organiser"]]);
  });
});
