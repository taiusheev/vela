/**
 * A family on LINE (05-line-flows §8, step 4): with every person's link and the family's group on
 * LINE, her mornings, the turn prompt, a quiet notice and the post of her answer all go there, and
 * none to Telegram. The harness's LINE is the Telegram fake under another name: these tests prove
 * routing by each person's messenger, and LINE's own behaviour belongs to its adapter's tests.
 */
import type { InboundEvent, LocalDate } from "@vela/contracts";
import { TUNING } from "@vela/core";
import { channelLinks, familyChannels, members } from "@vela/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { arrivalChannelOf, deliverArrival, prepareDay, sendTurnPrompt } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleBotAdded } from "./group.ts";
import { handleInbound } from "./inbound/router.ts";
import { openQuiet } from "./quiet.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedLinkedGroup } from "./testing/seed.ts";

let h: Harness;
let seed: SeededFamily;
const TODAY: LocalDate = "2026-09-14";
const TOMORROW: LocalDate = "2026-09-15";
const GROUP = "C-line-group";
let events = 0;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);
beforeEach(async () => {
  await h.reset();
  seed = await seedFamily(h.db, { now: h.clock.now() });
  await seedLinkedGroup(h.db, seed, { now: h.clock.now(), conversationId: GROUP });
  // Everyone, and the group, moves to LINE.
  const people = [seed.member.id, seed.organiser.id];
  await h.db
    .update(channelLinks)
    .set({ channel: "line" })
    .where(inArray(channelLinks.memberId, people));
  await h.db.update(members).set({ primarySurface: "line" }).where(inArray(members.id, people));
  await h.db
    .update(familyChannels)
    .set({ channel: "line" })
    .where(eq(familyChannels.familyId, seed.family.id));
});
afterAll(async () => {
  await h.close();
});

const handlers = { outbound: (job: OutboundJob) => deliverOutbound(h.deps, job.outboundId) };

function onLine(fields: Partial<InboundEvent> & { kind: InboundEvent["kind"] }): InboundEvent {
  events += 1;
  return {
    channel: "line",
    eventId: `line:${events}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: seed.memberLink.externalId },
    conversation: { externalId: seed.memberLink.externalId, kind: "private" },
    messageId: String(900 + events),
    ...fields,
  } as InboundEvent;
}

describe("a family on LINE", () => {
  it("sends her mornings to her LINE chat", async () => {
    expect(arrivalChannelOf({ primarySurface: "line" })).toBe("line");
    await prepareDay(h.deps, seed.member.id, TOMORROW);
    h.clock.set(new Date(`${TOMORROW}T08:00:00.000+08:00`));

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    await h.run(handlers);

    expect(h.line.sentTo(seed.memberLink.externalId)).toHaveLength(1);
    expect(h.telegram.sent).toEqual([]);
  });

  it("prompts tomorrow's turn in the family's LINE group", async () => {
    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);
    await h.run(handlers);

    expect(h.line.sentTo(GROUP)).toHaveLength(1);
    expect(h.telegram.sent).toEqual([]);
  });

  it("tells the organiser of a quiet morning on LINE", async () => {
    await seedExchange(h.db, seed, { date: TODAY, state: "delivered", deliveredAt: h.clock.now() });
    h.clock.advanceMinutes(TUNING.defaultQuietAfterMinutes);

    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers);

    expect(h.line.sentTo(seed.organiserLink.externalId).length).toBeGreaterThan(0);
    expect(h.telegram.sent).toEqual([]);
  });

  it("posts her answer to the family's LINE group", async () => {
    await seedExchange(h.db, seed, { date: TODAY, state: "delivered", deliveredAt: h.clock.now() });
    h.clock.advanceMinutes(10);

    await handleInbound(h.deps, [onLine({ kind: "text", text: "Rice porridge today." })]);
    await h.run(handlers);

    expect(
      h.line
        .sentTo(GROUP)
        .map((sent) => sent.message.text)
        .join("\n"),
    ).toContain("Rice porridge today.");
    expect(h.telegram.sent).toEqual([]);
  });

  it("refuses a second group on another messenger", async () => {
    events += 1;
    await handleBotAdded(h.deps, {
      channel: "line",
      eventId: `line:${events}`,
      at: h.clock.now().toISOString(),
      kind: "bot_added",
      sender: { externalUserId: seed.organiserLink.externalId },
      conversation: { externalId: "C-another-group", kind: "group" },
    } as InboundEvent);
    await h.db
      .update(familyChannels)
      .set({ channel: "telegram" })
      .where(eq(familyChannels.conversationId, GROUP));
    events += 1;
    await handleBotAdded(h.deps, {
      channel: "line",
      eventId: `line:${events}`,
      at: h.clock.now().toISOString(),
      kind: "bot_added",
      sender: { externalUserId: seed.organiserLink.externalId },
      conversation: { externalId: "C-third-group", kind: "group" },
    } as InboundEvent);

    const groups = await h.db
      .select()
      .from(familyChannels)
      .where(eq(familyChannels.familyId, seed.family.id));
    expect(groups.map((group) => group.conversationId)).toEqual([GROUP]);
  });
});
