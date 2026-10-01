import { answers, exchanges, members, users } from "@vela/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionIdentity } from "./api-access.ts";
import { setUpApiDevice } from "./api-device.ts";
import { deliverArrival } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import { deviceInboundEvent, loadDeviceMessages } from "./device-messages.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily } from "./testing/seed.ts";

/**
 * Her side of the parent surface (ADR-35, phase 3), end to end through the inbound router a Telegram
 * chat uses: her phone, set up before her yes, is asked for it; she taps Yes; her first morning
 * reaches the phone; and her words answer it and light her day.
 */
let h: Harness;
let seed: SeededFamily;
const mia: SessionIdentity = { authSubject: "auth|Mia", sessionId: "session-1" };
let events = 0;

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
  await h.db
    .update(members)
    .set({
      status: "invited",
      lightOn: false,
      lightConsentedAt: null,
      lightConsentText: null,
      lightStartsOn: null,
    })
    .where(eq(members.id, seed.member.id));
});
afterAll(async () => {
  await h.close();
});

const handlers = { outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) };

async function her() {
  const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  if (row === undefined) throw new Error("expected her");
  return row;
}

/** Her phone set up, and what the set-up wrote handed to the queue, as the Worker does. */
async function setUpHerPhone() {
  const set = await setUpApiDevice(h.deps, mia, seed.family.id, seed.member.id);
  for (const id of set.after.outboundIds)
    await h.queues.outbound.send({ type: "deliver", outboundId: id });
  await h.run(handlers);
}

async function send(input: Parameters<typeof deviceInboundEvent>[2]) {
  events += 1;
  const event = await deviceInboundEvent(
    h.db,
    await her(),
    input,
    { eventId: `e${events}`, messageId: `m${events}` },
    h.clock.now(),
  );
  if (event === null) throw new Error("expected her phone's link");
  await handleInbound(h.deps, [event]);
  await h.run(handlers);
}

describe("her phone on the parent surface", () => {
  it("is asked for her yes when set up before it, in her language, with Yes and No", async () => {
    await setUpHerPhone();

    const [request] = await loadDeviceMessages(h.db, await her());
    expect(request?.kind).toBe("consent");
    // Who asks: the one who invited her, else the family, as on Telegram (no invite is seeded here).
    expect(request?.text).toContain("would like to keep a light on for you");
    expect(request?.buttons.flat()).toHaveLength(2);
  });

  it("turns her light on when she taps Yes on her phone, as a Telegram tap would", async () => {
    await setUpHerPhone();
    const [request] = await loadDeviceMessages(h.db, await her());
    const yes = request?.buttons[0]?.[0];
    if (request === undefined || yes === undefined) throw new Error("expected the request");

    await send({ button: yes.id, message_id: request.message_id });

    const after = await her();
    expect(after).toMatchObject({ status: "active", lightOn: true });
    expect(after.lightConsentedAt).toBeInstanceOf(Date);
  });

  it("brings her first morning to the phone after her yes, and her words answer it", async () => {
    await setUpHerPhone();
    const [request] = await loadDeviceMessages(h.db, await her());
    const yes = request?.buttons[0]?.[0];
    if (request === undefined || yes === undefined) throw new Error("expected the request");
    await send({ button: yes.id, message_id: request.message_id });

    const first = (await her()).lightStartsOn;
    if (first === null) throw new Error("expected her first morning");
    h.clock.set(new Date(`${first}T08:00:00.000+08:00`));
    await deliverArrival(h.deps, seed.member.id, first, false);
    await h.run(handlers);
    const [morning] = await loadDeviceMessages(h.db, await her());
    expect(morning?.kind).toBe("arrival");

    h.clock.advanceMinutes(20);
    await send({ text: "The tomatoes finally turned." });

    const [answer] = await h.db.select().from(answers).where(eq(answers.memberId, seed.member.id));
    expect(answer).toMatchObject({ channel: "device", kind: "text" });
    const [exchange] = await h.db.select().from(exchanges).where(eq(exchanges.scheduledFor, first));
    expect(exchange?.answeredAt).toEqual(h.clock.now());
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toEqual([]);
  });

  it("is not asked again for a yes she has given", async () => {
    await h.db
      .update(members)
      .set({ status: "active", lightOn: true, lightConsentedAt: h.clock.now() })
      .where(eq(members.id, seed.member.id));
    await setUpHerPhone();
    expect(await loadDeviceMessages(h.db, await her())).toEqual([]);
  });
});
