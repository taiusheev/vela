import { TUNING } from "@vela/core";
import { channelLinks, exchanges, members, outbound, quietEvents, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { removeApiDevice, setUpApiDevice } from "./api-device.ts";
import { arrivalChannelOf, deliverArrival } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { openQuiet } from "./quiet.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

/**
 * Her morning on her phone (ADR-35, phase 2): with the parent surface set up, the arrival goes
 * through the gateway to the `device` adapter instead of Telegram, is marked delivered as any
 * arrival is, and her silence is measured from that delivery as on Telegram.
 */
let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: mia.authSubject, displayName: "Mia" })
    .returning();
  if (user === undefined) throw new Error("expected an account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, seed.organiser.id));
});
afterAll(async () => {
  await h.close();
});

const handlers = { outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) };

/** Her first morning, the day after the seed's, at 08:00 in Taipei. */
async function herFirstMorning(): Promise<string> {
  const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  const first = her?.lightStartsOn;
  if (first === null || first === undefined) throw new Error("expected her first morning");
  h.clock.set(new Date(`${first}T08:00:00.000+08:00`));
  await deliverArrival(h.deps, seed.member.id, first, false);
  await h.run(handlers);
  return first;
}

describe("her morning on her phone", () => {
  it("goes to her phone through the gateway, not to Telegram, and is marked delivered", async () => {
    await setUpApiDevice(h.deps, mia, seed.family.id, seed.member.id);

    const date = await herFirstMorning();

    const [arrival] = await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"));
    expect(arrival).toMatchObject({ channel: "device", status: "sent" });
    expect(h.device.sent).toHaveLength(1);
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toEqual([]);
    const [exchange] = await h.db.select().from(exchanges).where(eq(exchanges.scheduledFor, date));
    expect(exchange?.deliveredAt).toEqual(h.clock.now());
  });

  it("opens the quiet ladder for the organisers when her phone's morning goes unanswered", async () => {
    await setUpApiDevice(h.deps, mia, seed.family.id, seed.member.id);
    const date = await herFirstMorning();

    h.clock.advanceMinutes(TUNING.defaultQuietAfterMinutes);
    await openQuiet(h.deps, seed.member.id, date, true);
    await h.run(handlers);

    expect(await h.db.select().from(quietEvents)).toHaveLength(1);
    const [notice] = await h.db.select().from(outbound).where(eq(outbound.kind, "quiet_notice"));
    expect(notice).toMatchObject({ channel: "telegram", memberId: seed.organiser.id });
  });

  it("goes back to Telegram once her phone is removed", async () => {
    await setUpApiDevice(h.deps, mia, seed.family.id, seed.member.id);
    await removeApiDevice(h.deps, mia, "rm", seed.family.id, seed.member.id);

    await herFirstMorning();

    const [arrival] = await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"));
    expect(arrival?.channel).toBe("telegram");
    expect(h.device.sent).toEqual([]);
  });

  it("keeps her phone's link out of the blocked check while her Telegram link is blocked", async () => {
    await setUpApiDevice(h.deps, mia, seed.family.id, seed.member.id);
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.memberLink.id));
    const date = await herFirstMorning();

    h.clock.advanceMinutes(TUNING.defaultQuietAfterMinutes);
    await openQuiet(h.deps, seed.member.id, date, true);

    // A blocked Telegram link holds no morning back from a phone she answers on.
    expect(await h.db.select().from(quietEvents)).toHaveLength(1);
  });

  it("names her phone's channel only for the parent surface", () => {
    expect(arrivalChannelOf({ primarySurface: "parent-surface" })).toBe("device");
    expect(arrivalChannelOf({ primarySurface: "telegram" })).toBe("telegram");
    expect(arrivalChannelOf({ primarySurface: "app" })).toBe("telegram");
  });
});
