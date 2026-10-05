/** Current permission and lifecycle must still hold after a queued quoted notice waits. */
import { createFakeAi, fakeRecord, SAFE_DEFAULTS } from "@vela/ai";
import { aiCalls, answers, consents, families, members, outbound } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverOutbound, insertOutbound } from "../src/gateway.ts";
import { understandAnswer } from "../src/pipeline.ts";
import { createFakeTelegram } from "../src/testing/fake-telegram.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedHealthWordsConsent,
} from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let seed: SeededFamily;
let exchangeId: string;
let answerId: string;
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  seed = await seedFamily(seeder.db, { now: NOW });
  const exchange = await seedExchange(seeder.db, seed, {
    date: "2026-09-14",
    state: "answered",
    answeredAt: NOW,
  });
  exchangeId = exchange.id;
  const [answer] = await seeder.db
    .insert(answers)
    .values({
      exchangeId,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      payload: { text: "My chest hurts" },
      receivedAt: NOW,
    })
    .returning();
  if (answer === undefined) throw new Error("Expected answer");
  answerId = answer.id;
  await seedHealthWordsConsent(seeder.db, seed, {
    at: new Date(NOW.getTime() - 1000),
    answer: "yes",
  });
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

async function notice() {
  const result = await insertOutbound(pg.jobDeps(seeder), seeder.db, {
    kind: "flag",
    idempotencyKey: `quoted-notice:${answerId}`,
    memberId: seed.organiser.id,
    exchangeId,
    channel: "telegram",
    conversationId: seed.organiserLink.externalId,
    lang: "en",
    text: "Mom said: My chest hurts",
    healthWordsFor: { memberId: seed.member.id, answerId, receivedAt: NOW.toISOString() },
  });
  if (!("outboundId" in result)) throw new Error("Expected new quoted notice");
  return result.outboundId;
}

describe("quoted health-word notices on independent PostgreSQL connections", () => {
  it("drops a notice after family deletion commits while delivery waits", async () => {
    const id = await notice();
    const holder = await pg.client("family-deletion");
    const delivery = await pg.client("delivery");
    const held = await pg.holdRows(holder, async (tx) => {
      await tx.update(families).set({ deletedAt: NOW }).where(eq(families.id, seed.family.id));
      await tx.update(members).set({ nextWakeAt: null }).where(eq(members.id, seed.member.id));
    });
    const deps = pg.jobDeps(delivery);
    const telegram = createFakeTelegram(deps.clock);
    const operation = pg.track(deliverOutbound({ ...deps, channels: { get: () => telegram } }, id));
    await pg.waitForRowLockWaitOrCompletion(delivery, [holder], operation);
    await held.release();
    expect(await pg.finish("notice delivery", operation)).toBe("skipped");
    expect(telegram.sent).toEqual([]);
    const [row] = await seeder.db.select().from(outbound).where(eq(outbound.id, id));
    expect(row?.status).toBe("dropped");
  });

  it("sends a content-free notice after consent withdrawal commits while delivery waits", async () => {
    const id = await notice();
    const holder = await pg.client("withdrawal");
    const delivery = await pg.client("delivery");
    const held = await pg.holdRows(holder, async (tx) => {
      await tx.select().from(members).where(eq(members.id, seed.member.id)).for("update");
      await tx
        .update(consents)
        .set({ withdrawnAt: NOW })
        .where(eq(consents.memberId, seed.member.id));
    });
    const deps = pg.jobDeps(delivery);
    const telegram = createFakeTelegram(deps.clock);
    const operation = pg.track(deliverOutbound({ ...deps, channels: { get: () => telegram } }, id));
    await pg.waitForRowLockWaitOrCompletion(delivery, [holder], operation);
    await held.release();
    expect(await pg.finish("notice delivery", operation)).toBe("sent");
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]?.message.text).not.toContain("chest");
    const [row] = await seeder.db.select().from(outbound).where(eq(outbound.id, id));
    expect(JSON.stringify(row?.payload)).not.toContain("chest");
  });

  it("finishes model commit and family deletion without a family/member lock cycle", async () => {
    const holder = await pg.client("family-deletion");
    const model = await pg.client("model-commit");
    const familyHeld = pg.latch("family deletion holds its first row");
    const proceed = pg.latch("family deletion updates the member");
    const deleting = pg.track(
      holder.db.transaction(async (tx) => {
        await tx.select().from(families).where(eq(families.id, seed.family.id)).for("update");
        familyHeld.release();
        await proceed.wait();
        await tx.update(families).set({ deletedAt: NOW }).where(eq(families.id, seed.family.id));
        await tx.update(members).set({ nextWakeAt: null }).where(eq(members.id, seed.member.id));
      }),
    );
    await familyHeld.wait();
    const ai = createFakeAi({
      understand: async (input) => ({
        ok: true,
        value: { ...SAFE_DEFAULTS.understand(input), summary: "My chest hurts" },
        record: fakeRecord("understand"),
      }),
      flag: async () => ({
        ok: true,
        value: {
          flag: true,
          category: "health",
          severity: "concern",
          evidenceQuote: "My chest hurts",
        },
        record: fakeRecord("flag"),
      }),
    });
    const processing = pg.track(understandAnswer({ ...pg.jobDeps(model), ai }, answerId));
    await pg.waitForRowLockWaitOrCompletion(model, [holder], processing);
    proceed.release();
    await pg.finish("family deletion and model commit", Promise.all([deleting, processing]));
    expect(await seeder.db.select().from(aiCalls)).toEqual([]);
    expect(await seeder.db.select().from(outbound)).toEqual([]);
    const [answer] = await seeder.db.select().from(answers).where(eq(answers.id, answerId));
    expect(answer?.summary).toBeNull();
    const [family] = await seeder.db.select().from(families).where(eq(families.id, seed.family.id));
    expect(family?.deletedAt).toEqual(NOW);
  });
});
