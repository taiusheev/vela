import { PUBLIC_ELIGIBILITY_TERMS_VERSION, PUBLIC_ELIGIBILITY_VERSION } from "@vela/contracts";
import { users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearOwnPublicEligibility,
  loadOwnPublicEligibility,
  type OwnEligibilityActor,
  recordOwnPublicEligibility,
} from "../src/public-eligibility.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
const actor: OwnEligibilityActor = {
  kind: "app",
  identity: { authSubject: "synthetic-pg|alex", sessionId: "session-test" },
};
const choice = {
  version: PUBLIC_ELIGIBILITY_VERSION,
  terms_version: PUBLIC_ELIGIBILITY_TERMS_VERSION,
  language: "en",
  adult_self_declared: true,
  residence_self_declared: "TW",
  notice_read: true,
  review_terms_acknowledged: true,
};
const eligibility = {
  enabled: true,
  environment: "synthetic-review" as const,
  policyVersion: PUBLIC_ELIGIBILITY_VERSION,
};
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seeder");
  await seeder.db.insert(users).values({ authSubject: "synthetic-pg|alex", displayName: "Alex" });
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});
describe("eligibility declarations on independent PostgreSQL connections", () => {
  it("rechecks the account tombstone after waiting for a concurrent deletion", async () => {
    const deleting = await pg.client("deleting");
    const saving = await pg.client("saving");
    const held = await pg.holdRows(deleting, async (tx) => {
      await tx
        .update(users)
        .set({ deletedAt: NOW, publicEligibility: null })
        .where(eq(users.authSubject, "synthetic-pg|alex"));
    });
    const save = pg.track(
      recordOwnPublicEligibility(
        { ...pg.jobDeps(saving), eligibility },
        actor,
        "racing-delete",
        choice,
      ),
    );
    await pg.waitForRowLockWaitOrCompletion(saving, [deleting], save);
    await held.release();
    const result = await pg.settle("save after account deletion", [save]);
    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected")
      expect(result[0].reason).toMatchObject({ code: "not_found" });
    expect((await seeder.db.select().from(users))[0]?.publicEligibility).toBeNull();
  });
  it("does not restore cleared data when another connection retries the old save", async () => {
    const saving = await pg.client("saving");
    const clearing = await pg.client("clearing");
    await recordOwnPublicEligibility(
      { ...pg.jobDeps(saving), eligibility },
      actor,
      "original-save",
      choice,
    );
    await clearOwnPublicEligibility(pg.jobDeps(clearing), actor, "own-clear");
    const replay = await recordOwnPublicEligibility(
      { ...pg.jobDeps(saving), eligibility },
      actor,
      "original-save",
      choice,
    );
    expect(replay.replayed).toBe(true);
    expect(await loadOwnPublicEligibility(pg.jobDeps(seeder), actor)).toBeNull();
  });
});
