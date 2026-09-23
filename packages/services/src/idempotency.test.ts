/**
 * Webhook redelivery (flows §5, §6 test 4): every inbound path, processed twice, changes nothing the
 * second time — no new row in any table and no second message — and two ticks for one member at the
 * same moment produce one arrival.
 *
 * Each case plays its events through the router, drains the queues, counts every table and every
 * message, plays exactly the same events again, and counts again.
 */
import type { InboundEvent, InboundKind, LocalDate } from "@vela/contracts";
import { encodeButton } from "@vela/core";
import {
  accountLinkChallenges,
  adminAccessLog,
  aiCalls,
  answers,
  apiRequestReceipts,
  awayPeriods,
  channelLinks,
  chips,
  consents,
  deletions,
  events,
  exchanges,
  families,
  familyChannels,
  invites,
  media,
  members,
  messageRefs,
  metricsDaily,
  nearbyContacts,
  onboardingSessions,
  outbound,
  quietEvents,
  replies,
  translations,
  turns,
  weeklyReads,
} from "@vela/db";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MediaJob, OutboundJob, UnderstandJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
} from "./testing/seed.ts";
import { tickMember } from "./tick.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  sequence = 0;
});

afterAll(async () => {
  await h.close();
});

const ORGANISER = "1001";
const HER = "2001";
const SIBLING = "3001";
const STRANGER = "4001";
const GROUP = "-100500";
const NEW_GROUP = "-1001000500";
const TODAY: LocalDate = "2026-09-14";
const TOMORROW: LocalDate = "2026-09-15";
const TURN_PROMPT_MESSAGE = "900";
const ANSWER_POST_MESSAGE = "901";

let sequence = 0;

/** Every table a flow can write to, so a replay that stored anything is caught wherever it landed. */
const TABLES = {
  families,
  members,
  channelLinks,
  familyChannels,
  invites,
  onboardingSessions,
  nearbyContacts,
  consents,
  media,
  exchanges,
  chips,
  answers,
  replies,
  translations,
  turns,
  quietEvents,
  awayPeriods,
  outbound,
  messageRefs,
  events,
  aiCalls,
  weeklyReads,
  metricsDaily,
  deletions,
  adminAccessLog,
  apiRequestReceipts,
  accountLinkChallenges,
};

/**
 * Every row and every message sent. Closing an arrival's or a notice's buttons is left out: a
 * replayed tap closes them again, which Telegram answers with "message is not modified" and the
 * adapter counts as success, and closing on every tap is what repairs a close that failed.
 */
async function snapshot(): Promise<Record<string, number>> {
  const counts: Record<string, number> = { sent: h.telegram.sent.length };
  for (const [name, table] of Object.entries(TABLES)) {
    const [row] = await h.db.select({ rows: count() }).from(table);
    counts[name] = row?.rows ?? 0;
  }
  return counts;
}

function handlers(): {
  outbound: (job: OutboundJob) => Promise<unknown>;
  media: (job: MediaJob) => Promise<unknown>;
  understand: (job: UnderstandJob) => Promise<unknown>;
} {
  return {
    outbound: (job) => deliverOutbound(h.deps, job.outboundId),
    media: (job) =>
      job.type === "ingest_answer_media"
        ? ingestAnswerMedia(h.deps, job.answerId)
        : Promise.resolve(),
    understand: (job) => understandAnswer(h.deps, job.answerId),
  };
}

function event(
  user: string,
  conversation: { id: string; kind: "private" | "group" },
  extra: Partial<InboundEvent> & { kind: InboundKind },
): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    messageId: String(sequence),
    sender: { externalUserId: user, displayName: "Sam", languageCode: "en" },
    conversation: { externalId: conversation.id, kind: conversation.kind },
    ...extra,
  };
}

function privately(
  user: string,
  extra: Partial<InboundEvent> & { kind: InboundKind },
): InboundEvent {
  return event(user, { id: user, kind: "private" }, extra);
}

function inGroup(user: string, extra: Partial<InboundEvent> & { kind: InboundKind }): InboundEvent {
  return event(user, { id: GROUP, kind: "group" }, extra);
}

interface Scene {
  seed: SeededFamily;
  exchangeId: string;
}

/**
 * Her family with its group, this morning already delivered, and the two message refs the gateway
 * would have written: the evening prompt for tomorrow and the post under her answer.
 */
async function scene(): Promise<Scene> {
  const now = h.clock.now();
  const seed = await seedFamily(h.db, { now });
  await seedLinkedGroup(h.db, seed, { now });
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    state: "delivered",
    deliveredAt: now,
  });
  await h.db.insert(messageRefs).values([
    {
      channel: "telegram",
      conversationId: GROUP,
      messageId: TURN_PROMPT_MESSAGE,
      familyId: seed.family.id,
      memberId: seed.member.id,
      localDate: TOMORROW,
      purpose: "turn_prompt",
    },
    {
      channel: "telegram",
      conversationId: GROUP,
      messageId: ANSWER_POST_MESSAGE,
      familyId: seed.family.id,
      exchangeId: exchange.id,
      memberId: seed.member.id,
      purpose: "answer_post",
    },
  ]);
  return { seed, exchangeId: exchange.id };
}

/** Plays the events, then plays exactly the same events again and proves nothing moved. */
async function unchangedOnReplay(events: readonly InboundEvent[]): Promise<void> {
  await handleInbound(h.deps, [...events]);
  await h.run(handlers());
  const before = await snapshot();

  await handleInbound(h.deps, [...events]);
  await h.run(handlers());

  expect(await snapshot()).toEqual(before);
}

describe("every inbound path processed twice", () => {
  it("stores one family from one /start, whatever the webhook repeats", async () => {
    await unchangedOnReplay([privately(STRANGER, { kind: "start" })]);
    expect(await h.db.select().from(onboardingSessions)).toHaveLength(1);
    expect(h.telegram.sentTo(STRANGER)).toHaveLength(1);
  });

  it("links the invited member and asks for consent once", async () => {
    const { seed } = await scene();
    const [invited] = await h.db
      .insert(members)
      .values({
        familyId: seed.family.id,
        role: "member",
        displayName: "Dad",
        language: "en",
        tz: "Asia/Taipei",
        country: "TW",
        status: "invited",
        primarySurface: "telegram",
        wakeTime: "07:00",
        arrivalTime: "07:30",
        createdAt: h.clock.now(),
      })
      .returning();
    await h.db.insert(invites).values({
      familyId: seed.family.id,
      invitedBy: seed.organiser.id,
      forMemberId: invited?.id,
      token: "invite-token",
      channel: "link",
      createdAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 7 * 24 * 60 * 60_000),
    });

    await unchangedOnReplay([privately(STRANGER, { kind: "start", startParam: "invite-token" })]);

    expect(h.telegram.sentTo(STRANGER)).toHaveLength(1);
    expect(
      await h.db.select().from(channelLinks).where(eq(channelLinks.externalId, STRANGER)),
    ).toHaveLength(1);

    // And the Yes on that request, twice.
    const request = h.telegram.sentTo(STRANGER).at(-1);
    const button = request?.message.buttons?.[0]?.[0];
    await unchangedOnReplay([
      privately(STRANGER, {
        kind: "button",
        buttonData: button?.id,
        callbackId: "cb-consent",
        messageId: request?.result.primaryMessageId,
      }),
    ]);
    expect(await h.db.select().from(consents)).toHaveLength(2);
  });

  it("lights her message once", async () => {
    await scene();
    await unchangedOnReplay([privately(HER, { kind: "text", text: "All well here." })]);
    expect(await h.db.select().from(answers)).toHaveLength(1);
  });

  it("counts her tap on an arrival once", async () => {
    const { exchangeId } = await scene();
    await unchangedOnReplay([
      privately(HER, {
        kind: "button",
        buttonData: encodeButton({ type: "answer", exchangeId, answer: "fine" }),
        callbackId: "cb-fine",
        messageId: "77",
      }),
    ]);
    expect(await h.db.select().from(answers)).toHaveLength(1);
  });

  it("pauses her once when she says stop", async () => {
    const { seed } = await scene();
    await unchangedOnReplay([privately(HER, { kind: "text", text: "stop" })]);
    const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her).toMatchObject({ status: "paused", nextWakeAt: null });
  });

  it("composes one ask from a reply to the evening prompt", async () => {
    await scene();
    await unchangedOnReplay([
      inGroup(SIBLING, {
        kind: "text",
        text: "What are you cooking tonight?",
        replyToMessageId: TURN_PROMPT_MESSAGE,
      }),
    ]);
    expect(await h.db.select().from(exchanges)).toHaveLength(2);
  });

  it("composes one ask from /ask", async () => {
    await scene();
    await unchangedOnReplay([
      inGroup(ORGANISER, { kind: "text", text: "/ask How is the garden?" }),
    ]);
    expect(await h.db.select().from(exchanges)).toHaveLength(2);
  });

  it("stores one reply under her answer", async () => {
    await scene();
    await unchangedOnReplay([
      inGroup(SIBLING, {
        kind: "text",
        text: "Lovely, Mom!",
        replyToMessageId: ANSWER_POST_MESSAGE,
      }),
    ]);
    expect(await h.db.select().from(replies)).toHaveLength(1);
  });

  it("stores one reaction on her answer", async () => {
    await scene();
    await unchangedOnReplay([
      inGroup(SIBLING, {
        kind: "reaction",
        messageId: ANSWER_POST_MESSAGE,
        reactions: ["❤️"],
      }),
    ]);
    expect(await h.db.select().from(replies)).toHaveLength(1);
  });

  it("resolves one quiet event from an organiser's tap", async () => {
    const { seed, exchangeId } = await scene();
    const [quiet] = await h.db
      .insert(quietEvents)
      .values({
        exchangeId,
        memberId: seed.member.id,
        openedAt: h.clock.now(),
        lastNotifiedAt: h.clock.now(),
        notifyCount: 1,
        notifiedMemberIds: [seed.organiser.id],
      })
      .returning();

    await unchangedOnReplay([
      privately(ORGANISER, {
        kind: "button",
        buttonData: encodeButton({ type: "quiet_fine", quietEventId: quiet?.id ?? "" }),
        callbackId: "cb-fine",
        messageId: "88",
      }),
    ]);
    const [resolved] = await h.db.select().from(quietEvents);
    expect(resolved?.outcome).toBe("fine_known");
  });

  it("links the group once when the bot is added", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await unchangedOnReplay([inGroup(ORGANISER, { kind: "bot_added" })]);
    expect(
      await h.db.select().from(familyChannels).where(eq(familyChannels.familyId, seed.family.id)),
    ).toHaveLength(1);
  });

  it("unlinks the group once when the bot is removed", async () => {
    await scene();
    await unchangedOnReplay([inGroup(ORGANISER, { kind: "bot_removed" })]);
    const [group] = await h.db.select().from(familyChannels);
    expect(group?.unlinkedAt).not.toBeNull();
  });

  it("moves the group once when it becomes a supergroup", async () => {
    await scene();
    await unchangedOnReplay([
      inGroup(ORGANISER, { kind: "migrated", migratedToConversationId: NEW_GROUP }),
    ]);
    const [group] = await h.db.select().from(familyChannels);
    expect(group?.conversationId).toBe(NEW_GROUP);
    // The refs moved with it, so a reply to the message as re-sent still resolves.
    const refs = await h.db.select().from(messageRefs);
    expect(refs.every((ref) => ref.conversationId === NEW_GROUP)).toBe(true);
  });

  it("records one departure from the group", async () => {
    const { seed } = await scene();
    const sibling = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: SIBLING,
    });

    await unchangedOnReplay([
      inGroup(ORGANISER, {
        kind: "member_left",
        subject: { externalUserId: SIBLING, displayName: "Sam" },
      }),
    ]);

    const [row] = await h.db.select().from(members).where(eq(members.id, sibling.member.id));
    expect(row).toMatchObject({ status: "left", turnsIn: false });
  });

  it("tells the founder once when an organiser leaves the group", async () => {
    await scene();
    await unchangedOnReplay([
      inGroup(ORGANISER, {
        kind: "member_left",
        subject: { externalUserId: ORGANISER, displayName: "Mia" },
      }),
    ]);
    expect(h.telegram.sentTo("9001")).toHaveLength(1);
  });

  it("marks the link once when she blocks the bot", async () => {
    const { seed } = await scene();
    await unchangedOnReplay([privately(HER, { kind: "blocked" })]);
    const [link] = await h.db
      .select()
      .from(channelLinks)
      .where(eq(channelLinks.memberId, seed.member.id));
    expect(link?.blockedAt).not.toBeNull();
  });
});

describe("two ticks at once", () => {
  it("produce one arrival", async () => {
    const seed = await seedFamily(h.db, { now: new Date("2026-09-13T00:00:00.000Z") });
    h.clock.set(new Date("2026-09-14T00:00:00.000Z"));

    await Promise.all([tickMember(h.deps, seed.member.id), tickMember(h.deps, seed.member.id)]);
    await h.run(handlers());

    expect(await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"))).toHaveLength(1);
    expect(h.telegram.sentTo(HER)).toHaveLength(1);
    expect(await h.db.select().from(exchanges)).toHaveLength(1);
  });
});
