import { MEMORY_PERMISSION_TEXT_EN, MEMORY_PERMISSION_VERSION } from "@vela/contracts";
import { consents, members, users, type VelaDatabase } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/hash.ts";
import { withdrawOwnMemoryConsent } from "../src/memory-consent.ts";
import { answerMemoryPermission, prepareMemoryPermission } from "../src/memory-permission.ts";
import { seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seed: RaceClient;
const identity = { authSubject: "synthetic|postgres-permission", sessionId: "synthetic-session" };
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seed = await pg.client("seed");
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});
const deps = (client: RaceClient) => {
  const job = pg.jobDeps(client);
  return { ...job, config: { ...job.config, richMemories: true } };
};
async function owner(db: VelaDatabase) {
  const family = await seedFamily(db, { now: NOW });
  const [user] = await db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Synthetic" })
    .returning();
  if (!user) throw new Error("Missing synthetic account");
  await db.update(members).set({ userId: user.id }).where(eq(members.id, family.member.id));
  return family;
}

describe("memory permission on independent PostgreSQL connections", () => {
  it("refuses a yes from a question shown before a withdrawal that commits first", async () => {
    const family = await owner(seed.db);
    const familyId = family.family.id;
    const prepared = await prepareMemoryPermission(
      deps(seed),
      identity,
      "synthetic:prepare",
      familyId,
      { lang: "en" },
    );
    const presentationId = (prepared.response.body as { id: string }).id;
    const [withdrawer, answerer, holder] = await pg.clientPool("permission-withdraw", 3);
    if (!withdrawer || !answerer || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(members).where(eq(members.id, family.member.id)).for("share"),
    );
    const withdrawal = pg.track(
      withdrawOwnMemoryConsent(deps(withdrawer), identity, "synthetic:withdraw", familyId),
    );
    await pg.waitForRowLockWait(withdrawer, [holder], withdrawal);
    const yes = pg.track(
      answerMemoryPermission(deps(answerer), identity, "synthetic:yes", familyId, {
        presentation_id: presentationId,
        answer: "yes",
        text_version: MEMORY_PERMISSION_VERSION,
        text_sha256: await sha256Hex(MEMORY_PERMISSION_TEXT_EN),
      }),
    );
    await pg.waitForActorLockWait(answerer, [withdrawer], yes);
    await held.release();
    expect(await pg.settle("withdrawal", [withdrawal])).toMatchObject([{ status: "fulfilled" }]);
    expect(await pg.settle("late yes", [yes])).toMatchObject([
      { status: "rejected", reason: { code: "illegal_state" } },
    ]);
    const active = await seed.db
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.memberId, family.member.id),
          eq(consents.kind, "rich_memories"),
          eq(consents.answer, "yes"),
          isNull(consents.withdrawnAt),
        ),
      );
    expect(active).toHaveLength(0);
  });
});
