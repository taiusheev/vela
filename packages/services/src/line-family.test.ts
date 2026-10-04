/**
 * A family on LINE (05-line-flows §8, step 4): with every person's link and the family's group on
 * LINE, her mornings, the turn prompt, a quiet notice and the post of her answer all go there, and
 * none to Telegram. The harness's LINE is the Telegram fake under another name: these tests prove
 * routing by each person's messenger, and LINE's own behaviour belongs to its adapter's tests.
 */
import type { InboundEvent, LocalDate } from "@vela/contracts";
import { encodeButton, TUNING } from "@vela/core";
import {
  answers,
  channelLinks,
  consents,
  familyChannels,
  invites,
  members,
  outbound,
} from "@vela/db";
import { and, eq, inArray } from "drizzle-orm";
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

describe("taps on LINE, which name no message", () => {
  it("count her same tap delivered twice as one answer", async () => {
    const today = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    h.clock.advanceMinutes(5);
    const tap = encodeButton({ type: "answer", exchangeId: today.id, answer: "fine" });

    for (let i = 0; i < 2; i += 1) {
      await handleInbound(h.deps, [
        onLine({ kind: "button", buttonData: tap, callbackId: `cb${i}`, messageId: undefined }),
      ]);
    }

    expect(await h.db.select().from(answers).where(eq(answers.exchangeId, today.id))).toHaveLength(
      1,
    );
  });

  it("still show the organiser what Wait 2 hours did, as a message of its own", async () => {
    await seedExchange(h.db, seed, { date: TODAY, state: "delivered", deliveredAt: h.clock.now() });
    h.clock.advanceMinutes(TUNING.defaultQuietAfterMinutes);
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers);
    const notice = h.line.sentTo(seed.organiserLink.externalId).at(-1);
    const wait = notice?.message.buttons?.flat().find((button) => button.id.endsWith(":w"));
    if (wait === undefined) throw new Error("expected Wait 2 hours");

    events += 1;
    await handleInbound(h.deps, [
      {
        channel: "line",
        eventId: `line:${events}`,
        at: h.clock.now().toISOString(),
        kind: "button",
        sender: { externalUserId: seed.organiserLink.externalId },
        conversation: { externalId: seed.organiserLink.externalId, kind: "private" },
        buttonData: wait.id,
        callbackId: "cb-wait",
      } as InboundEvent,
    ]);

    expect(h.line.sentTo(seed.organiserLink.externalId).at(-1)?.message.text).toMatch(
      /look again/i,
    );
  });

  it("prove her yes by the message that carried the buttons, and send her mornings to LINE", async () => {
    await h.db.delete(channelLinks).where(eq(channelLinks.id, seed.memberLink.id));
    await h.db
      .update(members)
      .set({
        status: "invited",
        lightOn: false,
        lightConsentedAt: null,
        primarySurface: "telegram",
      })
      .where(eq(members.id, seed.member.id));
    await h.db.insert(invites).values({
      familyId: seed.family.id,
      invitedBy: seed.organiser.id,
      forMemberId: seed.member.id,
      token: "line-invite-token-0123456789abcdef0123456789",
      channel: "link",
      createdAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 7 * 86_400_000),
    });
    const HER = "U-her-on-line";
    events += 1;
    await handleInbound(h.deps, [
      {
        channel: "line",
        eventId: `line:${events}`,
        at: h.clock.now().toISOString(),
        kind: "start",
        sender: { externalUserId: HER, displayName: "Mom" },
        conversation: { externalId: HER, kind: "private" },
        messageId: "m-start",
        startParam: "line-invite-token-0123456789abcdef0123456789",
      } as InboundEvent,
    ]);
    await h.run(handlers);
    const [request] = await h.db.select().from(outbound).where(eq(outbound.kind, "consent"));

    events += 1;
    await handleInbound(h.deps, [
      {
        channel: "line",
        eventId: `line:${events}`,
        at: h.clock.now().toISOString(),
        kind: "button",
        sender: { externalUserId: HER },
        conversation: { externalId: HER, kind: "private" },
        buttonData: encodeButton({ type: "consent", memberId: seed.member.id, accept: true }),
        callbackId: "cb-yes",
      } as InboundEvent,
    ]);

    const [yes] = await h.db
      .select()
      .from(consents)
      .where(and(eq(consents.kind, "light"), eq(consents.channel, "line")));
    expect(request?.externalId).not.toBeNull();
    expect(yes?.evidence).toMatchObject({ chat_id: HER, message_id: request?.externalId });
    const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her?.primarySurface).toBe("line");
  });
});

describe("free replies on LINE", () => {
  async function answerWithReply(until: Date) {
    await seedExchange(h.db, seed, { date: TODAY, state: "delivered", deliveredAt: h.clock.now() });
    h.clock.advanceMinutes(5);
    await handleInbound(h.deps, [
      onLine({
        kind: "text",
        text: "Rice porridge today.",
        reply: { token: "reply-token-1", until: until.toISOString() },
      }),
    ]);
    await h.run(handlers);
  }

  it("answer her with her own reply token, and never use it for the family's group", async () => {
    await answerWithReply(new Date(h.clock.now().getTime() + 6 * 60_000 + 50_000));

    expect(h.line.sentTo(seed.memberLink.externalId).at(-1)?.message.replyToken).toBe(
      "reply-token-1",
    );
    for (const sent of h.line.sentTo(GROUP)) {
      expect(sent.message.replyToken).toBeUndefined();
    }
  });

  it("answer a stranger who writes to Vela with their own token, straight from the adapter", async () => {
    events += 1;
    await handleInbound(h.deps, [
      {
        channel: "line",
        eventId: `line:${events}`,
        at: h.clock.now().toISOString(),
        kind: "text",
        text: "hello?",
        sender: { externalUserId: "U-stranger" },
        conversation: { externalId: "U-stranger", kind: "private" },
        messageId: "m-hello",
        reply: {
          token: "stranger-token",
          until: new Date(h.clock.now().getTime() + 50_000).toISOString(),
        },
      } as InboundEvent,
    ]);

    expect(h.line.sentTo("U-stranger").at(-1)?.message.replyToken).toBe("stranger-token");
  });

  it("send as usual once the token has expired", async () => {
    await answerWithReply(new Date(h.clock.now().getTime() + 60_000));

    expect(h.line.sentTo(seed.memberLink.externalId).at(-1)?.message.replyToken).toBeUndefined();
  });
});

describe("a follow on LINE", () => {
  it("unblocks her link when she adds Vela again", async () => {
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.memberLink.id));

    await handleInbound(h.deps, [onLine({ kind: "followed", messageId: undefined })]);

    const [link] = await h.db
      .select()
      .from(channelLinks)
      .where(eq(channelLinks.id, seed.memberLink.id));
    expect(link?.blockedAt).toBeNull();
  });
});

describe("a spent LINE quota", () => {
  it("tells the founder once, however many sends it refuses, and the sends wait to retry", async () => {
    await prepareDay(h.deps, seed.member.id, TOMORROW);
    h.clock.set(new Date(`${TOMORROW}T08:00:00.000+08:00`));
    h.line.failNextSends(2, "quota_exhausted");

    await deliverArrival(h.deps, seed.member.id, TOMORROW, false);
    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);
    await h.run(handlers);

    const alerts = h.telegram
      .sentTo(h.config.adminConversationId ?? "")
      .filter((sent) => sent.message.text.includes("LINE"));
    expect(alerts).toHaveLength(1);
  });
});

describe("names on LINE", () => {
  it("names a new group member from their LINE profile when their message carries no name", async () => {
    h.line.profiles.set("U-cousin", { displayName: "Cousin Wei" });
    await seedExchange(h.db, seed, { date: TODAY, state: "delivered", deliveredAt: h.clock.now() });
    events += 1;

    await handleInbound(h.deps, [
      {
        channel: "line",
        eventId: `line:${events}`,
        at: h.clock.now().toISOString(),
        kind: "text",
        text: "/ask What did you cook today?",
        sender: { externalUserId: "U-cousin" },
        conversation: { externalId: GROUP, kind: "group" },
        messageId: `m-${events}`,
      } as InboundEvent,
    ]);

    const [cousin] = await h.db
      .select({ name: members.displayName })
      .from(members)
      .innerJoin(channelLinks, eq(channelLinks.memberId, members.id))
      .where(eq(channelLinks.externalId, "U-cousin"));
    expect(cousin?.name).toBe("Cousin Wei");
  });
});
