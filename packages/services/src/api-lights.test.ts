import { MemberLight } from "@vela/contracts";
import { localDateOf } from "@vela/core";
import { awayPeriods, members, quietEvents, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { loadApiLights } from "./api-lights.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const identity: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
const missingId = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: identity.authSubject, displayName: "Mia" })
    .returning();
  if (user === undefined) throw new Error("expected a seeded account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
});
afterAll(async () => {
  await h.close();
});

function today(): string {
  return localDateOf(h.clock.now(), seed.member.tz);
}

async function lights() {
  return loadApiLights(h.db, identity, seed.family.id, h.clock.now());
}

describe("loadApiLights", () => {
  it("rests a kept-light member whose day holds nothing yet, in her own wire shape", async () => {
    const row = (await lights())?.[0];
    expect(MemberLight.parse(row)).toEqual({
      member_id: seed.member.id,
      display_name: seed.member.displayName,
      state: "resting",
      answered_at: null,
      usual_time: seed.member.arrivalTime,
      away_until: null,
      quiet_event_id: null,
    });
  });

  it("lights her from the day's answer and keeps the time she answered", async () => {
    const answeredAt = new Date(h.clock.now().getTime() - 60_000);
    await seedExchange(h.db, seed, { date: today(), state: "answered", answeredAt });
    expect(await lights()).toEqual([
      expect.objectContaining({ state: "lit", answered_at: answeredAt.toISOString() }),
    ]);
  });

  it("marks her quiet while the day's quiet event is open, and rests again once it resolves", async () => {
    const exchange = await seedExchange(h.db, seed, { date: today(), state: "delivered" });
    const [quiet] = await h.db
      .insert(quietEvents)
      .values({ exchangeId: exchange.id, memberId: seed.member.id, openedAt: h.clock.now() })
      .returning();
    if (quiet === undefined) throw new Error("expected a quiet event");
    expect(await lights()).toEqual([
      expect.objectContaining({ state: "quiet", quiet_event_id: quiet.id }),
    ]);

    await h.db
      .update(quietEvents)
      .set({ resolvedAt: h.clock.now(), outcome: "answered_late" })
      .where(eq(quietEvents.id, quiet.id));
    expect(await lights()).toEqual([
      expect.objectContaining({ state: "resting", quiet_event_id: null }),
    ]);
  });

  it("shows her away for a period covering her day, and carries the day it ends", async () => {
    await h.db.insert(awayPeriods).values({
      memberId: seed.member.id,
      fromDate: today(),
      toDate: "2026-09-20",
      source: "organiser",
    });
    expect(await lights()).toEqual([
      expect.objectContaining({ state: "away", away_until: "2026-09-20" }),
    ]);
  });

  it("prefers paused over everything else, because a paused light sends nothing", async () => {
    const answeredAt = new Date(h.clock.now().getTime() - 60_000);
    await seedExchange(h.db, seed, { date: today(), state: "answered", answeredAt });
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.member.id));
    expect(await lights()).toEqual([expect.objectContaining({ state: "paused" })]);
  });

  it("answers nothing to a stranger, an unknown family and a member of another family", async () => {
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "3001",
      memberExternalId: "3002",
    });
    expect(await loadApiLights(h.db, identity, other.family.id, h.clock.now())).toBeNull();
    expect(await loadApiLights(h.db, identity, missingId, h.clock.now())).toBeNull();
    expect(
      await loadApiLights(
        h.db,
        { ...identity, authSubject: "auth|Nobody" },
        seed.family.id,
        h.clock.now(),
      ),
    ).toBeNull();
  });

  it("leaves out a member who keeps no light", async () => {
    const rows = await lights();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.member_id).toBe(seed.member.id);
    expect(rows?.map((light) => light.member_id)).not.toContain(seed.organiser.id);
  });
});
