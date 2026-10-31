/** Real PostgreSQL connections prove profile writes cannot resurrect deleted or superseded notes. */
import { QUESTION_PROFILE_NOTICE_VERSION } from "@vela/contracts";
import { members, questionProfiles, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  forgetApiQuestionProfile,
  loadApiQuestionProfile,
  saveApiQuestionProfile,
} from "../src/question-profiles.ts";
import { type SeededFamily, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let seed: SeededFamily;
const identity = { authSubject: "pg-profile|mia", sessionId: "pg-profile-session" };
const settings = {
  language: "en",
  address_form: "dad",
  context: { connection: "practical", talking_rhythm: "rarely", avoid_topics: [], never_say: [] },
  writing_examples: ["dad how's the garden"],
};
const input = (revision: string | null = null) => ({
  settings,
  expected_revision: revision,
  notice_version: QUESTION_PROFILE_NOTICE_VERSION,
});
const save = (client: RaceClient, key: string, revision: string | null = null) =>
  pg.track(
    saveApiQuestionProfile(
      { ...client.deps, savingEnabled: true },
      identity,
      key,
      seed.family.id,
      seed.member.id,
      input(revision),
    ),
  );
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  seed = await seedFamily(seeder.db, { now: NOW });
  const [user] = await seeder.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Mia" })
    .returning();
  if (!user) throw new Error("Missing user");
  await seeder.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

describe("saved question choices on independent connections", () => {
  it("two first saves based on an empty setup yield exactly one accepted revision", async () => {
    const holder = await pg.client("holder"),
      a = await pg.client("a"),
      b = await pg.client("b");
    const held = await pg.holdActorLock(holder, identity.authSubject);
    const first = save(a, "first-create");
    await pg.waitForActorLockWait(a, [holder], first);
    const second = save(b, "second-create");
    await pg.waitForActorLockWait(b, [holder, a], second);
    held.release();
    await held.done;
    const outcomes = await pg.settle("both first saves", [first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refusal = outcomes.find((outcome) => outcome.status === "rejected");
    expect(refusal?.status === "rejected" && refusal.reason).toMatchObject({
      code: "question_profile_changed",
    });
    expect(await seeder.db.select().from(questionProfiles)).toHaveLength(1);
  });
  it("a parent withdrawing while save is queued leaves no profile", async () => {
    const withdrawal = await pg.client("withdrawal"),
      saver = await pg.client("saver");
    const held = await pg.holdRows(withdrawal, (tx) =>
      tx.update(members).set({ lightOn: false }).where(eq(members.id, seed.member.id)),
    );
    const pending = save(saver, "queued-save");
    await pg.waitForRowLockWait(saver, [withdrawal], pending);
    await held.release();
    await expect(pending).rejects.toMatchObject({ code: "not_found" });
    expect(await seeder.db.select().from(questionProfiles)).toEqual([]);
  });
  it("forgetting after a queued save removes the notes and stale retries cannot restore them", async () => {
    const holder = await pg.client("holder"),
      saver = await pg.client("saver"),
      forgetter = await pg.client("forgetter");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(members).where(eq(members.id, seed.member.id)).for("update"),
    );
    const pending = save(saver, "queued-original");
    await pg.waitForRowLockWait(saver, [holder], pending);
    const forgotten = pg.track(
      forgetApiQuestionProfile(
        forgetter.deps,
        identity,
        "queued-forget",
        seed.family.id,
        seed.member.id,
        {},
      ),
    );
    await pg.waitForActorLockWait(forgetter, [saver], forgotten);
    await held.release();
    await pg.finish("queued save", pending);
    await pg.finish("queued forget", forgotten);
    expect(
      (await loadApiQuestionProfile(seeder.deps, identity, seed.family.id, seed.member.id)).profile,
    ).toBeNull();
    expect((await save(saver, "queued-original")).replayed).toBe(true);
    await expect(save(saver, "old-tab-create")).rejects.toMatchObject({
      code: "question_profile_changed",
    });
    expect((await seeder.db.select().from(questionProfiles))[0]?.data).toBeNull();
  });
});
