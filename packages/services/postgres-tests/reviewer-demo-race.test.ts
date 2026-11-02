/** The private fixture shares the account lock with provisioning/deletion and retries once. */
import { adminAccessLog, answers, families, members, replies } from "@vela/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { APP_REVIEW_SUBJECT, prepareAppReviewFamily } from "../src/reviewer-demo.ts";
import { openPostgresHarness, type PostgresHarness } from "./testing.ts";

let pg: PostgresHarness;
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

describe("private reviewer setup on independent PostgreSQL connections", () => {
  it("waits for normal account work and creates one fixture for simultaneous retries", async () => {
    const [earlier, later, blocker, reader] = await pg.clientPool("reviewer-fixture", 4);
    if (!earlier || !later || !blocker || !reader) throw new Error("missing race clients");
    const lock = await pg.holdActorLock(blocker, APP_REVIEW_SUBJECT);
    const first = pg.track(prepareAppReviewFamily(pg.jobDeps(earlier), APP_REVIEW_SUBJECT));
    await pg.waitForActorLockWait(earlier, [blocker], first);
    const second = pg.track(prepareAppReviewFamily(pg.jobDeps(later), APP_REVIEW_SUBJECT));
    await pg.waitForActorLockWait(later, [blocker], second);
    lock.release();
    await pg.finish("reviewer setup account blocker", lock.done);
    const results = await pg.settle("reviewer setup retries", [first, second]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const completed = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.replayed] : [],
    );
    expect(completed.sort()).toEqual([false, true]);
    expect(await reader.db.select().from(families)).toHaveLength(1);
    expect(await reader.db.select().from(members)).toHaveLength(2);
    expect(await reader.db.select().from(answers)).toHaveLength(1);
    expect(await reader.db.select().from(replies)).toHaveLength(1);
    expect(await reader.db.select().from(adminAccessLog)).toHaveLength(1);
  });
});
