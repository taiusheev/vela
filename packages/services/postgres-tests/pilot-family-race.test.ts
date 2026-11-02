/**
 * The founder's approval of a family for the closed test (ADR-52, `/admin/roster`) on independent
 * PostgreSQL connections. Two approvals sent at once (a double click, two tabs) both lock the
 * family's row first, so they run one after the other: one approves and logs, the other finds it
 * already approved. Without the lock and the conflict rule, both reach the insert and the second
 * fails on `pilot_families_pkey`, or both log an approval.
 */

import { adminAccessLog, families, pilotFamilies } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveFamily } from "../src/pilot-roster.ts";
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
let familyId: string;
const ctx = { admin: "founder@vela.test" };

beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  familyId = (await seedFamily(seeder.db, { now: NOW })).family.id;
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

describe("approving a family on independent PostgreSQL connections", () => {
  it("approves once and logs once when two approvals arrive together", async () => {
    const [first, second, holder] = await pg.clientPool("approve", 3);
    if (first === undefined || second === undefined || holder === undefined) {
      throw new Error("expected three race connections");
    }

    const queued = await pg.queueBehindRowLock(
      holder,
      (tx) => tx.select().from(families).where(eq(families.id, familyId)).for("update"),
      [
        { client: first, start: () => approveFamily(first.deps, ctx, familyId) },
        { client: second, start: () => approveFamily(second.deps, ctx, familyId) },
      ],
    );
    const results = await pg.settle("both approvals", queued);
    const outcomes = results.map((result) => settled(result));
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(
      outcomes.map((outcome) => (outcome.status === "fulfilled" ? outcome.value : null)).sort(),
    ).toEqual(["already", "approved"]);

    expect(await seeder.db.select().from(pilotFamilies)).toHaveLength(1);
    expect(
      await seeder.db.select().from(adminAccessLog).where(eq(adminAccessLog.familyId, familyId)),
    ).toHaveLength(1);
  });
});
