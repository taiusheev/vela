/** A delayed queue delivery cannot recreate erased words on a second database connection. */
import { InboundEvent } from "@vela/contracts";
import { deadLetters, families, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteFamily } from "../src/admin.ts";
import { disableApiAccount } from "../src/api-account-writes.ts";
import { keepDeadLetter, scrubDeadLetters } from "../src/dead-letters.ts";
import { forgetMembersWithTheirContacts } from "../src/proofs.ts";
import { seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness } from "./testing.ts";

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

describe("failed-message erasure on independent PostgreSQL connections", () => {
  it("finishes a family deletion overlapping the kept-light member's account deletion", async () => {
    const account = await pg.client("account-deletion");
    const family = await pg.client("family-deletion");
    const holder = await pg.client("member-row-holder");
    const seed = await seedFamily(holder.db, { now: NOW });
    const [user] = await holder.db
      .insert(users)
      .values({ authSubject: "synthetic|parent-delete", displayName: "Synthetic Parent" })
      .returning();
    if (user === undefined) throw new Error("missing account");
    await holder.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.member.id));
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(members).where(eq(members.id, seed.member.id)).for("update"),
    );
    const deletingAccount = pg.track(disableApiAccount(account.deps, "synthetic|parent-delete"));
    await pg.waitForRowLockWait(account, [holder], deletingAccount);
    const deletingFamily = pg.track(
      deleteFamily(pg.jobDeps(family), { admin: "synthetic-founder" }, seed.family.id),
    );
    try {
      await pg.waitForLockWait(family, [account], deletingFamily);
    } finally {
      await held.release();
    }
    const outcomes = await pg.settle<unknown>("overlapping family and account deletion", [
      deletingAccount,
      deletingFamily,
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it.each(["family", "member"] as const)(
    "does not restore a %s's words after its erasure sweep",
    async (subject) => {
      const eraser = await pg.client("eraser");
      const delivery = await pg.client("late-delivery");
      const seed = await seedFamily(eraser.db, { now: NOW });
      const event = InboundEvent.parse({
        channel: "telegram",
        kind: "text",
        eventId: "synthetic-delayed-answer",
        at: NOW.toISOString(),
        sender: { externalUserId: seed.memberLink.externalId },
        conversation: { kind: "private", externalId: seed.memberLink.externalId },
        text: "Synthetic private words",
      });
      const swept = pg.latch("recovery copies swept");
      const finishErasure = pg.latch("commit erasure");
      const erasing = pg.track(
        eraser.db.transaction(async (tx) => {
          if (subject === "family") {
            await tx
              .update(families)
              .set({ deletedAt: NOW })
              .where(eq(families.id, seed.family.id));
            await scrubDeadLetters(tx, NOW);
          } else {
            await forgetMembersWithTheirContacts(tx, [seed.member.id], NOW);
            await tx.delete(members).where(eq(members.id, seed.member.id));
          }
          swept.release();
          await finishErasure.wait();
        }),
      );
      await pg.reach("erasure swept", swept, erasing);
      const keeping = pg.track(
        keepDeadLetter(pg.jobDeps(delivery), {
          messageId: "synthetic-late-delivery",
          jobType: "handle_inbound",
          job: { type: "handle_inbound", events: [event] },
        }),
      );
      try {
        await pg.waitForLockWait(delivery, [eraser], keeping);
      } finally {
        finishErasure.release();
      }
      await pg.finish("erasure commits", erasing);
      expect(await pg.finish("late recovery is refused", keeping)).toBe(false);
      expect(await eraser.db.select().from(deadLetters)).toEqual([]);
    },
  );
});
