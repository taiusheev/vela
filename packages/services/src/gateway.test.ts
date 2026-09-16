import type { LocalDate } from "@vela/contracts";
import { encodeButton, outboundKey } from "@vela/core";
import type { VelaDatabase } from "@vela/db";
import {
  channelLinks,
  events,
  exchanges,
  families,
  familyChannels,
  members,
  messageRefs,
  outbound,
  quietEvents,
  replies,
  turns,
} from "@vela/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps, OutboundJob } from "./deps.ts";
import { VelaError } from "./errors.ts";
import {
  deliverOutbound,
  enqueueOutbound,
  type OutboundRequest,
  RETRY_DELAY_MINUTES,
  STRANDED_AFTER_MINUTES,
} from "./gateway.ts";
import { openQuiet } from "./quiet.ts";
import { messageRefFor } from "./repo.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
} from "./testing/seed.ts";
import { reconcile } from "./tick.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
});

afterAll(async () => {
  await h.close();
});

const TODAY: LocalDate = "2026-09-14";
const YESTERDAY: LocalDate = "2026-09-13";

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

async function family(): Promise<SeededFamily> {
  return seedFamily(h.db, { now: h.clock.now() });
}

function systemTo(seed: SeededFamily, suffix: string, text = "Hello"): OutboundRequest {
  return {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: seed.memberLink.externalId,
      suffix,
    }),
    memberId: seed.member.id,
    channel: "telegram",
    conversationId: seed.memberLink.externalId,
    lang: "en",
    text,
  };
}

async function outboundRows() {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function enqueued(request: OutboundRequest): Promise<string> {
  const result = await enqueueOutbound(h.deps, h.db, request);
  if (!("outboundId" in result)) {
    throw new Error("expected the row to be inserted");
  }
  return result.outboundId;
}

async function eventNames(): Promise<string[]> {
  const rows = await h.db.select({ name: events.name }).from(events).orderBy(asc(events.id));
  return rows.map((row) => row.name);
}

/** Today's arrival for her, queued with the effect the gateway applies on send. */
async function arrivalFor(seed: SeededFamily): Promise<{ id: string; exchangeId: string }> {
  const exchange = await seedExchange(h.db, seed, { date: TODAY });
  const id = await enqueued({
    kind: "arrival",
    idempotencyKey: outboundKey("arrival", { memberId: seed.member.id, date: TODAY }),
    memberId: seed.member.id,
    channel: "telegram",
    conversationId: seed.memberLink.externalId,
    localDay: TODAY,
    exchangeId: exchange.id,
    lang: "en",
    text: "Good morning, Mrs Chen.",
    ref: { purpose: "arrival", exchangeId: exchange.id },
    effect: {
      exchangeId: exchange.id,
      late: false,
      readBackReplyIds: [],
      previousExchangeId: null,
    },
  });
  return { id, exchangeId: exchange.id };
}

async function exchangeState(exchangeId: string) {
  const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, exchangeId));
  return row;
}

describe("enqueueOutbound", () => {
  it("inserts a row once for the same idempotency key and enqueues one delivery", async () => {
    const seed = await family();
    const first = await enqueueOutbound(h.deps, h.db, systemTo(seed, "hello"));
    const second = await enqueueOutbound(h.deps, h.db, systemTo(seed, "hello", "Different text"));

    expect(first).toHaveProperty("outboundId");
    expect(second).toEqual({ duplicate: true });
    expect(await outboundRows()).toHaveLength(1);
    expect(h.queues.outbound.pending).toHaveLength(1);
  });

  it("refuses a second budgeted message of the same kind for the member's local day", async () => {
    const seed = await family();
    // Two different keys, so only the budget index can refuse the second row.
    const ack = (suffix: string): OutboundRequest => ({
      kind: "ack",
      idempotencyKey: `ack-test:${suffix}`,
      memberId: seed.member.id,
      channel: "telegram",
      conversationId: seed.memberLink.externalId,
      lang: "en",
      text: "Thank you.",
    });
    const first = await enqueueOutbound(h.deps, h.db, ack("one"));
    const second = await enqueueOutbound(h.deps, h.db, ack("two"));

    expect(first).toHaveProperty("outboundId");
    expect(second).toEqual({ duplicate: true });
    const [row] = await outboundRows();
    // 00:00Z is 08:00 in Taipei: the budget day is hers, not UTC's.
    expect(row?.localDay).toBe(TODAY);
    expect(h.queues.outbound.pending).toHaveLength(1);
  });

  it("takes the date the message is about as the budget day when the request gives one", async () => {
    const seed = await family();
    const exchange = await seedExchange(h.db, seed, { date: YESTERDAY });
    await enqueued({
      kind: "repeat",
      idempotencyKey: outboundKey("repeat", { memberId: seed.member.id, date: YESTERDAY }),
      memberId: seed.member.id,
      channel: "telegram",
      conversationId: seed.memberLink.externalId,
      localDay: YESTERDAY,
      exchangeId: exchange.id,
      lang: "en",
      text: "In case you missed it",
      effect: { exchangeId: exchange.id },
    });
    const [row] = await outboundRows();
    expect(row?.localDay).toBe(YESTERDAY);
    expect(row?.exchangeId).toBe(exchange.id);
  });

  it("stores the message, the ref intent, and the effect in the payload", async () => {
    const seed = await family();
    const exchange = await seedExchange(h.db, seed, { date: TODAY });
    const buttons = [
      [
        {
          id: encodeButton({ type: "answer", exchangeId: exchange.id, answer: "fine" }),
          label: "I'm fine",
        },
      ],
    ];
    await enqueued({
      kind: "arrival",
      idempotencyKey: outboundKey("arrival", { memberId: seed.member.id, date: TODAY }),
      memberId: seed.member.id,
      channel: "telegram",
      conversationId: seed.memberLink.externalId,
      localDay: TODAY,
      exchangeId: exchange.id,
      lang: "en",
      text: "Good morning, Mrs Chen.",
      buttons,
      ref: { purpose: "arrival", exchangeId: exchange.id },
      effect: {
        exchangeId: exchange.id,
        late: false,
        readBackReplyIds: [],
        previousExchangeId: null,
      },
    });
    const [row] = await outboundRows();
    expect(row?.payload).toEqual({
      message: { lang: "en", text: "Good morning, Mrs Chen.", buttons },
      ref: { purpose: "arrival", exchangeId: exchange.id },
      effect: {
        exchangeId: exchange.id,
        late: false,
        readBackReplyIds: [],
        previousExchangeId: null,
      },
    });
  });

  it("throws for a request that cannot be a valid message", async () => {
    const seed = await family();
    await expect(enqueueOutbound(h.deps, h.db, systemTo(seed, "empty", ""))).rejects.toThrow(
      VelaError,
    );
    expect(await outboundRows()).toHaveLength(0);
  });

  it("works inside the caller's transaction", async () => {
    const seed = await family();
    await h.db.transaction(async (tx) => {
      await enqueueOutbound(h.deps, tx, systemTo(seed, "in-tx"));
    });
    expect(await outboundRows()).toHaveLength(1);
    expect(h.queues.outbound.pending).toHaveLength(1);
  });
});

describe("deliverOutbound", () => {
  it("sends the row, records the send, and maps every platform message to what it was about", async () => {
    const seed = await family();
    const exchange = await seedExchange(h.db, seed, { date: TODAY });
    const id = await enqueued({
      kind: "answer_post",
      idempotencyKey: outboundKey("answer_post", { exchangeId: exchange.id, suffix: "a1" }),
      memberId: seed.member.id,
      channel: "telegram",
      conversationId: "-100500",
      exchangeId: exchange.id,
      lang: "en",
      text: "☀️ Mom answered Mia · 08:12",
      media: [{ kind: "audio", providerFileId: "voice-1" }],
      ref: { purpose: "answer_post", exchangeId: exchange.id },
    });
    h.clock.advanceMinutes(12);

    expect(await deliverOutbound(h.deps, id)).toBe("sent");

    const [row] = await outboundRows();
    expect(row?.status).toBe("sent");
    expect(row?.sentAt).toEqual(h.clock.now());
    expect(row?.attempts).toBe(1);
    // The voice note is message 1, the text with the buttons message 2.
    expect(row?.externalId).toBe("2");
    const refs = await h.db.select().from(messageRefs).orderBy(asc(messageRefs.messageId));
    expect(refs.map((ref) => [ref.messageId, ref.purpose, ref.exchangeId])).toEqual([
      ["1", "answer_post", exchange.id],
      ["2", "answer_post", exchange.id],
    ]);
    expect(h.telegram.sent).toHaveLength(1);
    expect(h.telegram.sent[0]?.message.idempotencyKey).toBe(row?.idempotencyKey);
  });

  it("skips a row that is not queued, so a redelivered job sends nothing twice", async () => {
    const seed = await family();
    const id = await enqueued(systemTo(seed, "once"));
    expect(await deliverOutbound(h.deps, id)).toBe("sent");
    expect(await deliverOutbound(h.deps, id)).toBe("skipped");
    expect(h.telegram.sent).toHaveLength(1);
  });

  it("throws for a row that does not exist, so the queue retries a not-yet-committed insert", async () => {
    await expect(
      deliverOutbound(h.deps, "01990000-0000-7000-8000-000000000000"),
    ).rejects.toMatchObject({ name: "VelaError", code: "not_found" });
  });

  it("applies an arrival's effects: delivered, replies read back, the previous exchange closed, the scheduler woken", async () => {
    const seed = await family();
    const previous = await seedExchange(h.db, seed, {
      date: YESTERDAY,
      state: "answered",
      deliveredAt: new Date("2026-09-13T00:00:00Z"),
      answeredAt: new Date("2026-09-13T01:00:00Z"),
    });
    const [reply] = await h.db
      .insert(replies)
      .values({
        exchangeId: previous.id,
        memberId: seed.organiser.id,
        kind: "text",
        text: "Yum",
        channel: "telegram",
      })
      .returning();
    const exchange = await seedExchange(h.db, seed, { date: TODAY });
    const id = await enqueued({
      kind: "arrival",
      idempotencyKey: outboundKey("arrival", { memberId: seed.member.id, date: TODAY }),
      memberId: seed.member.id,
      channel: "telegram",
      conversationId: seed.memberLink.externalId,
      localDay: TODAY,
      exchangeId: exchange.id,
      lang: "en",
      text: "From yesterday:\nMia: Yum\n\nSorry this is late.\nGood morning, Mrs Chen.",
      ref: { purpose: "arrival", exchangeId: exchange.id },
      effect: {
        exchangeId: exchange.id,
        late: true,
        readBackReplyIds: reply === undefined ? [] : [reply.id],
        previousExchangeId: previous.id,
      },
    });
    h.clock.advanceMinutes(200);
    const sentAt = h.clock.now();

    expect(await deliverOutbound(h.deps, id)).toBe("sent");

    const [delivered] = await h.db.select().from(exchanges).where(eq(exchanges.id, exchange.id));
    expect(delivered?.state).toBe("delivered");
    expect(delivered?.deliveredAt).toEqual(sentAt);
    expect(delivered?.deliveryLate).toBe(true);
    const [readBack] = await h.db.select().from(exchanges).where(eq(exchanges.id, previous.id));
    expect(readBack?.state).toBe("read_back");
    expect(readBack?.readBackAt).toEqual(sentAt);
    const [stamped] = await h.db.select().from(replies);
    expect(stamped?.readBackAt).toEqual(sentAt);
    expect(h.scheduler.wakes.get(seed.member.id)).toEqual(sentAt);
    const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her?.nextWakeAt).toEqual(sentAt);
    expect(await eventNames()).toEqual(["arrival_delivered", "readback_delivered"]);
  });

  it("stamps repeated_at when a repeat is sent", async () => {
    const seed = await family();
    const exchange = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const id = await enqueued({
      kind: "repeat",
      idempotencyKey: outboundKey("repeat", { memberId: seed.member.id, date: TODAY }),
      memberId: seed.member.id,
      channel: "telegram",
      conversationId: seed.memberLink.externalId,
      localDay: TODAY,
      exchangeId: exchange.id,
      lang: "en",
      text: "In case you missed it:",
      effect: { exchangeId: exchange.id },
    });
    h.clock.advanceMinutes(150);

    expect(await deliverOutbound(h.deps, id)).toBe("sent");

    const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, exchange.id));
    expect(row?.repeatedAt).toEqual(h.clock.now());
    expect(row?.state).toBe("delivered");
    expect(await eventNames()).toEqual(["repeat_sent"]);
    expect(h.scheduler.wakes.size).toBe(0);
  });

  it("stamps the turn with the prompt's time and message id when a turn prompt is sent", async () => {
    const seed = await family();
    const group = await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const tomorrow: LocalDate = "2026-09-15";
    await h.db.insert(turns).values({
      familyId: seed.family.id,
      localDay: tomorrow,
      recipientId: seed.member.id,
      holderId: seed.organiser.id,
    });
    const id = await enqueued({
      kind: "turn_prompt",
      idempotencyKey: outboundKey("turn_prompt", { memberId: seed.member.id, date: tomorrow }),
      memberId: seed.organiser.id,
      channel: "telegram",
      conversationId: group.conversationId,
      lang: "en",
      text: "Tomorrow is Mia's turn with Mom.",
      ref: { purpose: "turn_prompt", memberId: seed.member.id, localDate: tomorrow },
      effect: { familyId: seed.family.id, recipientId: seed.member.id, localDay: tomorrow },
    });

    expect(await deliverOutbound(h.deps, id)).toBe("sent");

    const [turn] = await h.db.select().from(turns);
    expect(turn?.promptedAt).toEqual(h.clock.now());
    expect(turn?.promptMessageId).toBe("1");
    const [ref] = await h.db.select().from(messageRefs);
    expect(ref).toMatchObject({
      conversationId: group.conversationId,
      messageId: "1",
      purpose: "turn_prompt",
      memberId: seed.member.id,
      localDate: tomorrow,
    });
    expect(await eventNames()).toEqual(["turn_prompt_sent"]);
  });

  it("counts a sent quiet notice on the event and remembers who was told", async () => {
    const seed = await family();
    const exchange = await seedExchange(h.db, seed, {
      date: TODAY,
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const [quiet] = await h.db
      .insert(quietEvents)
      .values({ exchangeId: exchange.id, memberId: seed.member.id, openedAt: h.clock.now() })
      .returning();
    if (quiet === undefined) {
      throw new Error("quiet event not inserted");
    }
    const id = await enqueued({
      kind: "quiet_notice",
      idempotencyKey: outboundKey("quiet_notice", {
        quietEventId: quiet.id,
        memberId: seed.organiser.id,
        suffix: "0",
      }),
      memberId: seed.organiser.id,
      channel: "telegram",
      conversationId: seed.organiserLink.externalId,
      exchangeId: exchange.id,
      lang: "en",
      text: "It's been quiet at Mom's today.",
      ref: { purpose: "quiet_notice", exchangeId: exchange.id, quietEventId: quiet.id },
      effect: { quietEventId: quiet.id, notifyCount: 1, notifiedMemberId: seed.organiser.id },
    });
    h.clock.advanceMinutes(360);

    expect(await deliverOutbound(h.deps, id)).toBe("sent");

    const [updated] = await h.db.select().from(quietEvents);
    expect(updated?.notifyCount).toBe(1);
    expect(updated?.lastNotifiedAt).toEqual(h.clock.now());
    expect(updated?.notifiedMemberIds).toEqual([seed.organiser.id]);
    expect(await eventNames()).toEqual(["quiet_notice_sent"]);
  });
});

describe("deliverOutbound retries", () => {
  it("retries a passing failure at 5, 15, and 30 minutes and sends when the platform recovers", async () => {
    const seed = await family();
    const id = await enqueued(systemTo(seed, "flaky"));
    h.telegram.failNextSends(3, "unavailable");

    expect(await h.runDue(handlers())).toBe(1);
    const delays: number[] = [];
    for (const minutes of RETRY_DELAY_MINUTES) {
      const [pending] = h.queues.outbound.pending;
      expect(pending?.delaySeconds).toBe(minutes * 60);
      delays.push(pending?.delaySeconds ?? 0);
      // Not due yet: nothing runs until the delay has passed.
      h.clock.advanceMinutes(minutes - 1);
      expect(await h.runDue(handlers())).toBe(0);
      h.clock.advanceMinutes(1);
      expect(await h.runDue(handlers())).toBe(1);
    }

    expect(delays).toEqual([300, 900, 1800]);
    const [row] = await outboundRows();
    expect(row?.status).toBe("sent");
    expect(row?.attempts).toBe(4);
    expect(row?.error).toBeNull();
    expect(h.telegram.sent).toHaveLength(1);
    expect(h.telegram.failed).toHaveLength(3);
    expect(row?.id).toBe(id);
  });

  it("marks the row failed once the last retry fails", async () => {
    const seed = await family();
    await enqueued(systemTo(seed, "down"));
    h.telegram.failSendsTo(seed.memberLink.externalId, "unavailable");

    expect(await h.run(handlers())).toBe(4);

    const [row] = await outboundRows();
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(4);
    expect(row?.error).toMatch(/^unavailable: /);
    expect(h.queues.outbound.pending).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
  });

  it("waits for the platform's retry-after when it is longer than the schedule", async () => {
    const seed = await family();
    await enqueued(systemTo(seed, "limited"));
    h.telegram.failNextSends(1, "rate_limited", { retryAfterSeconds: 600 });

    expect(await h.runDue(handlers())).toBe(1);

    expect(h.queues.outbound.pending[0]?.delaySeconds).toBe(600);
    const [row] = await outboundRows();
    expect(row?.status).toBe("queued");
    expect(row?.attempts).toBe(1);
  });

  it("fails at once on an error that cannot pass", async () => {
    const seed = await family();
    await enqueued(systemTo(seed, "bad"));
    h.telegram.failNextSends(1, "invalid_request");

    expect(await h.runDue(handlers())).toBe(1);

    const [row] = await outboundRows();
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(1);
    expect(h.queues.outbound.pending).toHaveLength(0);
  });

  it("marks the link blocked when the person has blocked the bot", async () => {
    const seed = await family();
    const id = await enqueued(systemTo(seed, "blocked"));
    h.telegram.failNextSends(1, "blocked");
    h.clock.advanceMinutes(3);

    expect(await deliverOutbound(h.deps, id)).toBe("failed");

    const [link] = await h.db
      .select()
      .from(channelLinks)
      .where(eq(channelLinks.id, seed.memberLink.id));
    expect(link?.blockedAt).toEqual(h.clock.now());
    const [organiserLink] = await h.db
      .select()
      .from(channelLinks)
      .where(eq(channelLinks.id, seed.organiserLink.id));
    expect(organiserLink?.blockedAt).toBeNull();
  });
});

describe("deliverOutbound and the upgraded group", () => {
  const OLD_GROUP = "-100500";
  const NEW_GROUP = "-1001000500";

  async function groupPost(seed: SeededFamily, suffix: string): Promise<string> {
    return enqueued({
      kind: "system",
      idempotencyKey: outboundKey("system", { conversationId: OLD_GROUP, suffix }),
      memberId: seed.member.id,
      channel: "telegram",
      conversationId: OLD_GROUP,
      lang: "en",
      text: "Into Mom's morning.",
      ref: { purpose: "ask_confirmation" },
    });
  }

  it("re-points the family group and sends to the new id at once without counting an attempt", async () => {
    const seed = await family();
    await seedLinkedGroup(h.db, seed, { now: h.clock.now(), conversationId: OLD_GROUP });
    await h.db.insert(messageRefs).values({
      channel: "telegram",
      conversationId: OLD_GROUP,
      messageId: "7",
      familyId: seed.family.id,
      memberId: seed.member.id,
      localDate: TODAY,
      purpose: "turn_prompt",
    });
    const id = await groupPost(seed, "confirm");
    const other = await groupPost(seed, "another");
    h.telegram.failSendsTo(OLD_GROUP, "invalid_request", { migratedToConversationId: NEW_GROUP });

    expect(await deliverOutbound(h.deps, id)).toBe("retry");

    const [group] = await h.db.select().from(familyChannels);
    expect(group?.conversationId).toBe(NEW_GROUP);
    const moved = await h.db.select().from(messageRefs).where(eq(messageRefs.messageId, "7"));
    expect(moved.map((ref) => ref.conversationId)).toEqual([NEW_GROUP]);
    // The other row queued for the old group follows it, so it never hits the same error.
    const rows = await outboundRows();
    expect(rows.map((row) => [row.id, row.conversationId, row.attempts, row.status])).toEqual([
      [id, NEW_GROUP, 0, "queued"],
      [other, NEW_GROUP, 0, "queued"],
    ]);
    // Re-enqueued at once, behind the two original jobs (the first was run by hand above): all
    // due now, and the duplicate job finds its row already sent.
    expect(
      h.queues.outbound.pending.map((entry) => [entry.job.outboundId, entry.delaySeconds]),
    ).toEqual([
      [id, 0],
      [other, 0],
      [id, 0],
    ]);

    expect(await h.runDue(handlers())).toBe(3);

    expect(h.telegram.sentTo(OLD_GROUP)).toHaveLength(0);
    expect(h.telegram.sentTo(NEW_GROUP)).toHaveLength(2);
    const sent = await outboundRows();
    expect(sent.map((row) => [row.status, row.attempts])).toEqual([
      ["sent", 1],
      ["sent", 1],
    ]);
    const refs = await h.db
      .select()
      .from(messageRefs)
      .where(
        and(eq(messageRefs.conversationId, NEW_GROUP), eq(messageRefs.purpose, "ask_confirmation")),
      );
    expect(refs).toHaveLength(2);
    // A reply to the message as re-sent resolves, because its ref was written under the new id.
    const resent = h.telegram.sentTo(NEW_GROUP)[0];
    expect(
      await messageRefFor(h.db, "telegram", NEW_GROUP, resent?.result.primaryMessageId ?? ""),
    ).toMatchObject({ purpose: "ask_confirmation", familyId: seed.family.id });
  });

  it("fails a row the platform says to move to the id it already addresses, so a send cannot loop", async () => {
    const seed = await family();
    await seedLinkedGroup(h.db, seed, { now: h.clock.now(), conversationId: OLD_GROUP });
    await groupPost(seed, "loop");
    h.telegram.failSendsTo(OLD_GROUP, "invalid_request", { migratedToConversationId: OLD_GROUP });

    expect(await h.runDue(handlers())).toBe(1);

    const [row] = await outboundRows();
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(1);
    expect(h.queues.outbound.pending).toHaveLength(0);
  });
});

describe("deliverOutbound and a failed arrival", () => {
  async function failingArrival(seed: SeededFamily) {
    const exchange = await seedExchange(h.db, seed, { date: TODAY });
    await enqueued({
      kind: "arrival",
      idempotencyKey: outboundKey("arrival", { memberId: seed.member.id, date: TODAY }),
      memberId: seed.member.id,
      channel: "telegram",
      conversationId: seed.memberLink.externalId,
      localDay: TODAY,
      exchangeId: exchange.id,
      lang: "en",
      text: "Good morning, Mrs Chen.",
      ref: { purpose: "arrival", exchangeId: exchange.id },
      effect: {
        exchangeId: exchange.id,
        late: false,
        readBackReplyIds: [],
        previousExchangeId: null,
      },
    });
    h.telegram.failSendsTo(seed.memberLink.externalId, "unavailable");
    return exchange;
  }

  it("tells each organiser once, marks the day failed, wakes the scheduler, and opens no quiet event", async () => {
    const seed = await family();
    const second = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
      role: "organiser",
    });
    const exchange = await failingArrival(seed);

    // Four tries for the arrival, then the two notices.
    expect(await h.run(handlers())).toBe(6);
    const failedAt = h.clock.now();

    const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, exchange.id));
    expect(row?.deliveryFailedAt).toEqual(failedAt);
    expect(row?.state).toBe("scheduled");
    for (const link of [seed.organiserLink, second.link]) {
      const notices = h.telegram.sentTo(link.externalId);
      expect(notices).toHaveLength(1);
      expect(notices[0]?.message.text).toBe(
        "We couldn't reach Mom on Telegram today. Nothing else is known.",
      );
      expect(notices[0]?.message.kind).toBe("system");
    }
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(0);
    expect(h.scheduler.wakes.get(seed.member.id)).toEqual(failedAt);
    expect(await eventNames()).toEqual(["arrival_delivery_failed"]);

    // The schedule never opens a quiet event for a failed day, and neither does the flow when asked.
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    expect(await h.db.select().from(quietEvents)).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(3);
  });

  it("never sends the notice twice for the same morning", async () => {
    const seed = await family();
    const exchange = await failingArrival(seed);
    await h.run(handlers());

    // The same failure reported again enqueues nothing new: the notice is keyed by the exchange.
    const again = await enqueueOutbound(h.deps, h.db, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: seed.organiserLink.externalId,
        suffix: `delivery_failed:${exchange.id}`,
      }),
      memberId: seed.organiser.id,
      channel: "telegram",
      conversationId: seed.organiserLink.externalId,
      lang: "en",
      text: "We couldn't reach Mom on Telegram today. Nothing else is known.",
    });
    expect(again).toEqual({ duplicate: true });
    expect(h.telegram.sentTo(seed.organiserLink.externalId)).toHaveLength(1);
  });
});

describe("deliverOutbound and the effects of a send", () => {
  /**
   * Deps whose database rejects the `failFrom`-th transaction and every one after it. The send is
   * committed in the first transaction, so the second is the one a kind's effects run in (D-B1).
   * Every other call reaches the real database with the real receiver, private fields included.
   */
  function failsTransactionsFrom(failFrom: number): Deps {
    let calls = 0;
    const real = h.deps.db;
    const db = new Proxy(real, {
      get(target, property) {
        if (property === "transaction") {
          const wrapped: VelaDatabase["transaction"] = (...args) => {
            calls += 1;
            if (calls >= failFrom) {
              return Promise.reject(new Error("the effects transaction failed"));
            }
            return target.transaction(...args);
          };
          return wrapped;
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { ...h.deps, db };
  }

  it("keeps the row sent when its effects fail, and applies them on the retry without sending again", async () => {
    const seed = await family();
    const { id, exchangeId } = await arrivalFor(seed);
    const sentAt = h.clock.now();

    await expect(deliverOutbound(failsTransactionsFrom(2), id)).rejects.toThrow(
      "the effects transaction failed",
    );

    // The message is out and the row proves it; the morning is not delivered yet.
    const [row] = await outboundRows();
    expect(row).toMatchObject({ status: "sent", attempts: 1, sentAt, effectsAt: null });
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(1);
    expect(await exchangeState(exchangeId)).toMatchObject({
      state: "scheduled",
      deliveredAt: null,
    });
    expect(await eventNames()).toEqual([]);

    h.clock.advanceMinutes(1);
    expect(await deliverOutbound(h.deps, id)).toBe("sent");

    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(1);
    expect(await exchangeState(exchangeId)).toMatchObject({
      state: "delivered",
      deliveredAt: sentAt,
    });
    const [applied] = await outboundRows();
    expect(applied?.effectsAt).toEqual(h.clock.now());
    expect(applied?.attempts).toBe(1);
    expect(await eventNames()).toEqual(["arrival_delivered"]);
    expect(h.scheduler.wakes.get(seed.member.id)).toEqual(sentAt);
  });

  it("finishes a send whose effects never landed on the sweep two minutes later, once", async () => {
    const seed = await family();
    const { id, exchangeId } = await arrivalFor(seed);
    await expect(deliverOutbound(failsTransactionsFrom(2), id)).rejects.toThrow();
    h.queues.outbound.clear();

    // A minute later the row is still young enough to be on its way through the queue.
    h.clock.advanceMinutes(1);
    expect(await reconcile(h.deps)).toMatchObject({ effects: 0 });
    expect(await exchangeState(exchangeId)).toMatchObject({ state: "scheduled" });

    h.clock.advanceMinutes(2);
    expect(await reconcile(h.deps)).toMatchObject({ effects: 1 });

    expect(await exchangeState(exchangeId)).toMatchObject({ state: "delivered" });
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(1);
    expect(
      h.logger.entries.filter((entry) => entry.event === "outbound_effects_late"),
    ).toHaveLength(1);

    // Nothing is left for the next sweep, and nothing is sent again.
    expect(await reconcile(h.deps)).toMatchObject({ effects: 0 });
    expect(await eventNames()).toEqual(["arrival_delivered"]);
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(1);
  });
});

describe("deliverOutbound drops rows for a family that has ended", () => {
  it("drops a queued row once the family's deletion was requested", async () => {
    const seed = await family();
    const id = await enqueued(systemTo(seed, "late"));
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));

    expect(await deliverOutbound(h.deps, id)).toBe("skipped");

    const [row] = await outboundRows();
    expect(row?.status).toBe("dropped");
    expect(h.telegram.sent).toHaveLength(0);
    expect(await eventNames()).toEqual(["gateway_dropped"]);
  });

  it("drops an organiser's row once the kept-light member is deceased", async () => {
    const seed = await family();
    const id = await enqueued({
      ...systemTo(seed, "notice"),
      idempotencyKey: outboundKey("system", {
        conversationId: seed.organiserLink.externalId,
        suffix: "notice",
      }),
      memberId: seed.organiser.id,
      conversationId: seed.organiserLink.externalId,
    });
    await h.db
      .update(members)
      .set({ status: "deceased", lightOn: false })
      .where(eq(members.id, seed.member.id));

    expect(await deliverOutbound(h.deps, id)).toBe("skipped");

    const [row] = await outboundRows();
    expect(row?.status).toBe("dropped");
    expect(h.telegram.sent).toHaveLength(0);
  });

  it("drops her own row once she is left", async () => {
    const seed = await family();
    const id = await enqueued(systemTo(seed, "gone"));
    await h.db.update(members).set({ status: "left" }).where(eq(members.id, seed.member.id));

    expect(await deliverOutbound(h.deps, id)).toBe("skipped");
    expect(h.telegram.sent).toHaveLength(0);
  });
});

describe("reconcile and a delivery job that was lost", () => {
  it("re-drives a queued arrival whose job never ran, once, and it goes out exactly once", async () => {
    const seed = await family();
    const { id, exchangeId } = await arrivalFor(seed);
    // The job is gone: the queue send failed after the insert, or the dead-letter queue took it.
    h.queues.outbound.clear();

    // Within the grace a job may still be on its way.
    h.clock.advanceMinutes(STRANDED_AFTER_MINUTES - 1);
    await reconcile(h.deps);
    expect(h.queues.outbound.pending).toHaveLength(0);

    h.clock.advanceMinutes(2);
    await reconcile(h.deps);
    await reconcile(h.deps);

    expect(h.queues.outbound.pending.map((entry) => entry.job)).toEqual([
      { type: "deliver", outboundId: id },
    ]);
    const [claimed] = await outboundRows();
    expect(claimed).toMatchObject({
      status: "queued",
      attempts: 1,
      queuedAt: h.clock.now(),
      error: "stranded: no delivery ran by its due time",
    });
    expect(
      h.logger.entries.filter((entry) => entry.event === "outbound_stranded").map((e) => e.fields),
    ).toEqual([{ outboundId: id, kind: "arrival", attempts: 1 }]);

    await h.runDue(handlers());

    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(1);
    expect(await exchangeState(exchangeId)).toMatchObject({ state: "delivered" });
    h.clock.advanceMinutes(STRANDED_AFTER_MINUTES + 1);
    await reconcile(h.deps);
    await h.runDue(handlers());
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(1);
    expect((await outboundRows()).map((row) => [row.status, row.attempts])).toEqual([["sent", 2]]);
  });

  it("leaves a row waiting for its retry alone until the retry itself is overdue", async () => {
    const seed = await family();
    const id = await enqueued(systemTo(seed, "flaky"));
    h.telegram.failNextSends(1, "unavailable");
    await h.runDue(handlers());
    const [waiting] = await outboundRows();
    expect(waiting?.queuedAt).toEqual(new Date(h.clock.now().getTime() + 5 * 60_000));

    // Twelve minutes after the insert, but only seven after the retry was due.
    h.clock.advanceMinutes(12);
    await reconcile(h.deps);
    expect(h.queues.outbound.pending.map((entry) => entry.delaySeconds)).toEqual([300]);
    expect((await outboundRows())[0]?.attempts).toBe(1);

    // The retry job is lost too.
    h.queues.outbound.clear();
    h.clock.advanceMinutes(4);
    await reconcile(h.deps);

    expect(h.queues.outbound.pending.map((entry) => [entry.job, entry.delaySeconds])).toEqual([
      [{ type: "deliver", outboundId: id }, 0],
    ]);
    await h.runDue(handlers());
    expect((await outboundRows()).map((row) => [row.status, row.attempts])).toEqual([["sent", 3]]);
    expect(h.telegram.sent).toHaveLength(1);
  });

  it("fails an arrival whose every delivery is lost once its tries are spent, and tells each organiser once", async () => {
    const seed = await family();
    const { exchangeId } = await arrivalFor(seed);

    for (let lost = 0; lost < RETRY_DELAY_MINUTES.length + 1; lost += 1) {
      h.queues.outbound.clear();
      h.clock.advanceMinutes(STRANDED_AFTER_MINUTES + 1);
      await reconcile(h.deps);
    }

    const [arrival] = (await outboundRows()).filter((row) => row.kind === "arrival");
    expect(arrival).toMatchObject({ status: "failed", attempts: 4 });
    expect(arrival?.error).toMatch(/^stranded: /);
    expect(await exchangeState(exchangeId)).toMatchObject({ deliveryFailedAt: h.clock.now() });
    await h.run(handlers());
    expect(
      h.telegram.sentTo(seed.organiserLink.externalId).map((sent) => sent.message.text),
    ).toEqual(["We couldn't reach Mom on Telegram today. Nothing else is known."]);
    expect(h.telegram.sentTo(seed.memberLink.externalId)).toHaveLength(0);
    expect((await eventNames()).filter((name) => name === "arrival_delivery_failed")).toHaveLength(
      1,
    );
  });

  it("drops a spent arrival whose family has ended instead of failing it, and tells nobody", async () => {
    const seed = await family();
    const { exchangeId } = await arrivalFor(seed);
    for (let lost = 0; lost < RETRY_DELAY_MINUTES.length; lost += 1) {
      h.queues.outbound.clear();
      h.clock.advanceMinutes(STRANDED_AFTER_MINUTES + 1);
      await reconcile(h.deps);
    }
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    h.queues.outbound.clear();
    h.clock.advanceMinutes(STRANDED_AFTER_MINUTES + 1);

    await reconcile(h.deps);
    await h.run(handlers());

    expect((await outboundRows()).map((row) => [row.kind, row.status])).toEqual([
      ["arrival", "dropped"],
    ]);
    expect(await exchangeState(exchangeId)).toMatchObject({ deliveryFailedAt: null });
    expect(h.telegram.sent).toHaveLength(0);
  });
});
