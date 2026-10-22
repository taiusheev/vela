/** Two taps on the single consent message at once record one answer, never a mixed pair. */
import type { InboundEvent } from "@vela/contracts";
import { encodeButton } from "@vela/core";
import { consents, exchanges, members, outbound } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleCombinedConsentButton } from "../src/consent.ts";
import { type SeededFamily, seedFamily } from "../src/testing/seed.ts";
import { NOW, openPostgresHarness, type PostgresHarness, type RaceClient } from "./testing.ts";

let pg: PostgresHarness;
let seeder: RaceClient;
let seed: SeededFamily;
beforeAll(async () => {
  pg = await openPostgresHarness();
}, 60_000);
beforeEach(async () => {
  await pg.reset();
  seeder = await pg.client("seed");
  seed = await seedFamily(seeder.db, { now: NOW });
  // She has opened her link and not answered yet: invited, linked, with no consent of her own.
  await seeder.db.delete(consents).where(eq(consents.memberId, seed.member.id));
  await seeder.db
    .update(members)
    .set({ status: "invited", lightOn: false, lightConsentedAt: null, lightConsentText: null })
    .where(eq(members.id, seed.member.id));
  // A question her child wrote while she was invited, waiting for her yes.
  await seeder.db.insert(exchanges).values({
    familyId: seed.family.id,
    recipientId: seed.member.id,
    askerId: seed.organiser.id,
    type: "question",
    state: "composed",
    text: "What did you have for breakfast?",
    textLang: "en",
    options: {},
    whenRule: "whenever",
    scheduledFor: null,
    createdAt: new Date(NOW.getTime() - 60_000),
    mediaIds: [],
  });
});
afterEach(async () => {
  await pg.cleanup();
});
afterAll(async () => {
  await pg?.close();
});

let sequence = 0;
function tap(choice: "both" | "light"): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:race:${sequence}`,
    at: NOW.toISOString(),
    kind: "button",
    sender: { externalUserId: seed.memberLink.externalId },
    conversation: { externalId: seed.memberLink.externalId, kind: "private" },
    messageId: "1",
    buttonData: encodeButton({ type: "consent_both", memberId: seed.member.id, choice }),
    callbackId: `cb:race:${sequence}`,
  };
}

describe("the single consent message on independent PostgreSQL connections", () => {
  it("records one light and one matching health answer when both choices are tapped at once", async () => {
    const [first, second, holder] = await pg.clientPool("combined-consent", 3);
    if (!first || !second || !holder) throw new Error("Missing clients");
    const held = await pg.holdRows(holder, (tx) =>
      tx.select().from(members).where(eq(members.id, seed.member.id)).for("update"),
    );
    const both = pg.track(
      handleCombinedConsentButton(
        pg.jobDeps(first),
        tap("both"),
        { type: "consent_both", memberId: seed.member.id, choice: "both" },
        async () => {},
      ),
    );
    await pg.waitForRowLockWait(first, [holder], both);
    const light = pg.track(
      handleCombinedConsentButton(
        pg.jobDeps(second),
        tap("light"),
        { type: "consent_both", memberId: seed.member.id, choice: "light" },
        async () => {},
      ),
    );
    await pg.waitForRowLockWait(second, [first], light);
    await held.release();
    expect(await pg.settle("both taps", [both, light])).toMatchObject([
      { status: "fulfilled" },
      { status: "fulfilled" },
    ]);

    const rows = await seeder.db
      .select()
      .from(consents)
      .where(eq(consents.memberId, seed.member.id));
    const lights = rows.filter((row) => row.kind === "light");
    const health = rows.filter((row) => row.kind === "health_words");
    expect(lights).toHaveLength(1);
    expect(health).toHaveLength(1);
    // The pair comes from one tap: same moment, same proof.
    expect(health[0]?.givenAt.getTime()).toBe(lights[0]?.givenAt.getTime());
    expect(health[0]?.evidence).toEqual(lights[0]?.evidence);
    const [her] = await seeder.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her).toMatchObject({ status: "active", lightOn: true });
    // Her child's first words go out once, whichever tap won.
    expect(
      await seeder.db.select().from(outbound).where(eq(outbound.kind, "conversation")),
    ).toHaveLength(1);
  });
});
