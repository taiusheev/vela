/**
 * Sending a dead job again on independent PostgreSQL connections (technical plan 2.7). Two
 * reconciles can run at once (a slow one overlapping the next quarter hour), and a LINE inbound job
 * sent twice would be her answer handled twice, so a job the founder asked for must be claimed by
 * exactly one of them: the claim selects with `for update skip locked` and sets `replayed_at` in
 * the same statement.
 */
import { deadLetters } from "@vela/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimDeadLetterReplays,
  keepDeadLetter,
  requestDeadLetterReplay,
} from "../src/dead-letters.ts";
import { openPostgresHarness, type PostgresHarness, type RaceClient, settled } from "./testing.ts";

let pg: PostgresHarness;
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
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

describe("replaying dead letters on independent PostgreSQL connections", () => {
  it("lets exactly one of two reconciles claim each asked-for job", async () => {
    for (let index = 0; index < 5; index += 1) {
      await keepDeadLetter(
        { ...seeder.deps, logger: quiet },
        {
          messageId: `m-${index}`,
          jobType: "handle_inbound",
          job: { type: "handle_inbound", events: [] },
        },
      );
    }
    for (const row of await seeder.db.select({ id: deadLetters.id }).from(deadLetters)) {
      await requestDeadLetterReplay({ ...seeder.deps, logger: quiet }, row.id);
    }
    const reconciles = await pg.clientPool("reconcile", 4);
    for (let round = 0; round < 3; round += 1) {
      await seeder.db.update(deadLetters).set({ replayedAt: null });
      const results = await pg.settle(
        `claims round ${round}`,
        reconciles.map((client) => pg.track(claimDeadLetterReplays(client.deps))),
      );
      const claimed = results.flatMap((result) => {
        const outcome = settled(result);
        if (outcome.status !== "fulfilled") throw new Error("a claim failed");
        return (outcome.value as { id: string }[]).map((row) => row.id);
      });
      expect(claimed).toHaveLength(5);
      expect(new Set(claimed).size).toBe(5);
    }
  });
});
