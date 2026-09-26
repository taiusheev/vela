import { MemberLight } from "@vela/contracts";
import { addDays, addMinutes, localDateOf } from "@vela/core";
import { answers, awayPeriods, exchanges, members, quietEvents, users } from "@vela/db";
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

  // An answer counts for the local date it arrives on, whichever exchange it attaches to (flows
  // §3.9). Yesterday's arrival keeps its buttons, and a tap on one today answers yesterday's exchange,
  // closes today's quiet and tells the organisers "Mom answered at 14:32. Everything is lit again.",
  // so the app must show her lit at 14:32 too, not resting.
  it("lights her from a tap today on yesterday's arrival that closed today's quiet, at the time she tapped", async () => {
    const eight = h.clock.now();
    const yesterday = await seedExchange(h.db, seed, {
      date: addDays(today(), -1),
      state: "answered",
      deliveredAt: addMinutes(eight, -24 * 60),
      answeredAt: addMinutes(eight, -23 * 60),
    });
    const day = await seedExchange(h.db, seed, {
      date: today(),
      state: "delivered",
      deliveredAt: eight,
    });
    h.clock.advanceMinutes(6 * 60 + 32);
    const tappedAt = h.clock.now();
    await h.db.insert(answers).values({
      exchangeId: yesterday.id,
      memberId: seed.member.id,
      kind: "fine",
      channel: "telegram",
      externalId: "2001:6",
      receivedAt: tappedAt,
    });
    await h.db.insert(quietEvents).values({
      exchangeId: day.id,
      memberId: seed.member.id,
      openedAt: addMinutes(eight, 6 * 60),
      resolvedAt: tappedAt,
      outcome: "answered_late",
    });

    expect(await lights()).toEqual([
      expect.objectContaining({
        state: "lit",
        answered_at: tappedAt.toISOString(),
        quiet_event_id: null,
      }),
    ]);
  });

  // Spec §19: an answer before the arrival counts as that day's answer. Her message at 07:30 attaches
  // to yesterday's exchange, the last one delivered, and still lights today; her answer to today's
  // own ask later keeps the time she first answered.
  it("lights her from a message before today's arrival, and keeps that time once she answers today's ask", async () => {
    const eight = h.clock.now();
    const early = addMinutes(eight, -30);
    const yesterday = await seedExchange(h.db, seed, {
      date: addDays(today(), -1),
      state: "answered",
      deliveredAt: addMinutes(eight, -24 * 60),
      answeredAt: early,
    });
    const day = await seedExchange(h.db, seed, { date: today(), state: "scheduled" });
    await h.db.insert(answers).values({
      exchangeId: yesterday.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2001:7",
      payload: { text: "Up early today." },
      receivedAt: early,
    });
    expect(await lights()).toEqual([
      expect.objectContaining({ state: "lit", answered_at: early.toISOString() }),
    ]);

    h.clock.advanceMinutes(60);
    await h.db
      .update(exchanges)
      .set({ state: "answered", deliveredAt: eight, answeredAt: h.clock.now() })
      .where(eq(exchanges.id, day.id));
    await h.db.insert(answers).values({
      exchangeId: day.id,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2001:8",
      payload: { text: "The tomatoes turned." },
      receivedAt: h.clock.now(),
    });
    expect(await lights()).toEqual([
      expect.objectContaining({ state: "lit", answered_at: early.toISOString() }),
    ]);
  });

  it("rests her when her latest answer arrived before her midnight, on yesterday's own exchange", async () => {
    const eight = h.clock.now();
    const lastNight = addMinutes(eight, -8 * 60 - 10);
    const yesterday = await seedExchange(h.db, seed, {
      date: addDays(today(), -1),
      state: "answered",
      deliveredAt: addMinutes(eight, -24 * 60),
      answeredAt: lastNight,
    });
    await seedExchange(h.db, seed, { date: today(), state: "delivered", deliveredAt: eight });
    await h.db.insert(answers).values({
      exchangeId: yesterday.id,
      memberId: seed.member.id,
      kind: "heart",
      channel: "telegram",
      externalId: "2001:9",
      receivedAt: lastNight,
    });
    expect(await lights()).toEqual([
      expect.objectContaining({ state: "resting", answered_at: null }),
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

describe("an invited member who has not said yes", () => {
  it("follows the lights with the state none, so the organiser's Today is not empty", async () => {
    const [invited] = await h.db
      .insert(members)
      .values({
        familyId: seed.family.id,
        role: "member",
        displayName: "Dad",
        addressForm: "Mr Chen",
        language: "en",
        tz: "Asia/Taipei",
        country: "TW",
        status: "invited",
        turnsIn: false,
        primarySurface: "telegram",
        lightOn: false,
        wakeTime: "06:30",
        arrivalTime: "07:00",
      })
      .returning();
    if (invited === undefined) throw new Error("expected an invited member");

    const rows = await lights();
    expect(rows?.map((row) => [row.display_name, row.state])).toEqual([
      ["Mom", "resting"],
      ["Dad", "none"],
    ]);
    expect(MemberLight.parse(rows?.[1])).toEqual({
      member_id: invited.id,
      display_name: "Dad",
      state: "none",
      answered_at: null,
      usual_time: "07:00",
      away_until: null,
      quiet_event_id: null,
    });
  });

  it("leaves a member who declined or left out of the row entirely", async () => {
    await h.db.insert(members).values({
      familyId: seed.family.id,
      role: "member",
      displayName: "Gone",
      language: "en",
      tz: "Asia/Taipei",
      country: "TW",
      status: "invited",
      turnsIn: false,
      primarySurface: "telegram",
      lightOn: false,
      leftAt: h.clock.now(),
    });
    expect((await lights())?.map((row) => row.display_name)).toEqual(["Mom"]);
  });
});
