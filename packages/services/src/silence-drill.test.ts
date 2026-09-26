/**
 * Silence and the silence drill (flows §6, tests 2 and 3), end to end through the router, the
 * harness clock, and the queues.
 *
 * Silence: a morning nobody answers is repeated, opens a quiet event at T_quiet (silently while she
 * is still being learned), tells the organisers with the nearby contacts who said yes, comes back
 * once after "wait 2 hours", and closes on her late answer. A message she sends before her arrival
 * counts for that day, and the morning still goes out.
 *
 * The drill: sends that keep failing produce one delivery notice, no repeat, and no quiet event; a
 * blocked chat marks the link, and a block after her morning reached her brings no repeat and no
 * quiet notice beyond one a wait asked for, while her unblock looks at her day again; a wake nobody
 * served is caught by `reconcile` and delivered late, exactly once; and an outage of the AI or of speech-to-text never delays the light, the ack, or
 * the group post, with the understanding picked up again once the outage ends.
 */
import {
  type AiOutcome,
  createFakeAi,
  createFakeStt,
  fakeRecord,
  SAFE_DEFAULTS,
  type Understanding,
} from "@vela/ai";
import type { InboundEvent, InboundKind, LocalDate, MediaRef } from "@vela/contracts";
import { t } from "@vela/copy";
import {
  answers,
  channelLinks,
  type Exchange,
  exchanges,
  members,
  outbound,
  quietEvents,
} from "@vela/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MediaJob, OutboundJob, UnderstandJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedFamily,
  seedLinkedGroup,
  seedNearbyContact,
} from "./testing/seed.ts";
import { reconcile, tickMember } from "./tick.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  h.deps.stt = h.stt;
  sequence = 0;
  seen = 0;
});

afterAll(async () => {
  await h.close();
});

const ORGANISER = "1001";
const HER = "2001";
const GROUP = "-100500";
const VOICE: MediaRef = {
  kind: "audio",
  providerFileId: "voice-1",
  providerUniqueId: "u-voice-1",
  mime: "audio/ogg",
};

let sequence = 0;
let seen = 0;

function at(date: LocalDate, time: string): Date {
  return new Date(`${date}T${time}:00.000+08:00`);
}

function fromHer(extra: Partial<InboundEvent> & { kind: InboundKind }): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    messageId: String(sequence),
    sender: { externalUserId: HER, displayName: "Mom" },
    conversation: { externalId: HER, kind: "private" },
    ...extra,
  };
}

function fromOrganiser(extra: Partial<InboundEvent> & { kind: InboundKind }): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    messageId: String(sequence),
    sender: { externalUserId: ORGANISER, displayName: "Mia" },
    conversation: { externalId: ORGANISER, kind: "private" },
    ...extra,
  };
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

async function inbound(event: InboundEvent): Promise<void> {
  await handleInbound(h.deps, [event]);
  await h.run(handlers());
}

function newMessages(): [string, string][] {
  const fresh = h.telegram.sent.slice(seen);
  seen = h.telegram.sent.length;
  return fresh.map((entry) => [entry.message.to.conversationId, entry.message.text]);
}

function lastButtonTo(conversationId: string, index: number): string {
  const button = h.telegram.sentTo(conversationId).at(-1)?.message.buttons?.[0]?.[index];
  if (button === undefined) {
    throw new Error(`no button ${index} in the last message to ${conversationId}`);
  }
  return button.id;
}

async function nextWake(memberId: string): Promise<Date | null> {
  const [row] = await h.db
    .select({ at: members.nextWakeAt })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.at ?? null;
}

/** The Durable Object's part: her tick at each wake her row stores, then the queues it filled. */
async function runSchedulerUntil(memberId: string, until: Date): Promise<void> {
  for (let round = 0; round < 60; round += 1) {
    const wake = await nextWake(memberId);
    if (wake === null || wake.getTime() > until.getTime()) {
      if (h.clock.now().getTime() < until.getTime()) {
        h.clock.set(until);
      }
      return;
    }
    if (wake.getTime() > h.clock.now().getTime()) {
      h.clock.set(wake);
    }
    await tickMember(h.deps, memberId);
    await h.run(handlers());
  }
  throw new Error("her scheduler kept waking without settling");
}

/** A family that consented yesterday, with its group: her first morning is 14 September. */
async function consentedYesterday(): Promise<SeededFamily> {
  const seed = await seedFamily(h.db, { now: at("2026-09-13", "08:00") });
  await seedLinkedGroup(h.db, seed, { now: at("2026-09-13", "08:00") });
  h.clock.set(at("2026-09-14", "07:00"));
  await tickMember(h.deps, seed.member.id);
  await h.run(handlers());
  seen = h.telegram.sent.length;
  return seed;
}

async function exchangeOn(memberId: string, date: LocalDate): Promise<Exchange | undefined> {
  const [row] = await h.db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.recipientId, memberId), eq(exchanges.scheduledFor, date)));
  return row;
}

const HELLO_ARRIVAL = [
  t("en", "arrival.greeting", { address: "Mrs Chen" }),
  "",
  t("en", "arrival.hello"),
  t("en", "arrival.hello_signature"),
  "",
  t("en", "arrival.hint"),
].join("\n");

const HELLO_REPEAT = [
  t("en", "arrival.repeat"),
  t("en", "arrival.greeting", { address: "Mrs Chen" }),
  "",
  t("en", "arrival.hello"),
  t("en", "arrival.hello_signature"),
  "",
  t("en", "arrival.hint"),
].join("\n");

describe("silence", () => {
  it("repeats, opens quietly while she is learned, notifies with the nearby yes, waits, and lights again", async () => {
    const seed = await consentedYesterday();
    await seedNearbyContact(h.db, seed, {
      now: at("2026-09-13", "08:00"),
      name: "Anna",
      answer: { yes: { phone: "+886912000001" } },
    });
    await seedNearbyContact(h.db, seed, {
      now: at("2026-09-13", "08:00"),
      name: "Bob",
      answer: "no",
    });

    // 08:00 the morning, 10:30 the repeat (+150 minutes), 14:00 the quiet event, silently.
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "15:00"));
    expect(newMessages()).toEqual([
      [HER, HELLO_ARRIVAL],
      [HER, HELLO_REPEAT],
    ]);
    const quiet = await h.db.select().from(quietEvents);
    expect(quiet[0]).toMatchObject({ openedAt: at("2026-09-14", "14:00"), lastNotifiedAt: null });

    // 16:00, eight hours after the morning, the learning period lets the organisers hear it.
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "16:00"));
    expect(newMessages()).toEqual([
      [
        ORGANISER,
        `${t("en", "quiet.notice_no_usual", { name: "Mom", sent: "08:00" })}\n\n${t(
          "en",
          "quiet.nearby",
          { contacts: "Anna +886912000001" },
        )}`,
      ],
    ]);

    // "Wait 2 hours" brings it back once, and only after the wait.
    h.clock.set(at("2026-09-14", "16:05"));
    await inbound(
      fromOrganiser({
        kind: "button",
        buttonData: lastButtonTo(ORGANISER, 1),
        callbackId: "cb-wait",
        messageId: h.telegram.sentTo(ORGANISER).at(-1)?.result.primaryMessageId,
      }),
    );
    expect(h.telegram.closed.at(-1)).toMatchObject({
      conversationId: ORGANISER,
      replacementText: t("en", "quiet.waiting", { time: "18:05" }),
    });
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "17:30"));
    expect(newMessages()).toEqual([]);

    await runSchedulerUntil(seed.member.id, at("2026-09-14", "18:05"));
    expect(newMessages()).toHaveLength(1);
    expect(
      await h.db
        .select()
        .from(quietEvents)
        .then((rows) => rows[0]?.notifyCount),
    ).toBe(2);

    // Her late answer closes it and everyone who was told hears that the light is lit again.
    h.clock.set(at("2026-09-14", "18:30"));
    await inbound(fromHer({ kind: "text", text: "Sorry, I was in the garden." }));

    expect(newMessages()).toEqual([
      [ORGANISER, t("en", "quiet.resolved_answered", { name: "Mom", time: "18:30" })],
      [HER, t("en", "ack.thanks", { address: "Mrs Chen" })],
      [
        GROUP,
        `${t("en", "group.answer_hello", { name: "Mom", time: "18:30" })}\n${t(
          "en",
          "group.answer_text",
          { name: "Mom", text: "Sorry, I was in the garden." },
        )}`,
      ],
    ]);
    const [closed] = await h.db.select().from(quietEvents);
    expect(closed).toMatchObject({
      outcome: "answered_late",
      resolvedAt: at("2026-09-14", "18:30"),
    });
  });

  it("counts a message sent before the arrival for that day, delivers the morning, and stays quiet after it", async () => {
    const seed = await consentedYesterday();
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "09:00"));
    await inbound(fromHer({ kind: "text", text: "All well here." }));
    const herMessagesSoFar = h.telegram.sentTo(HER).length;

    // An hour before the next morning she writes again: it belongs to yesterday's exchange and
    // counts for today, so today needs no repeat and no quiet notice.
    h.clock.set(at("2026-09-15", "07:00"));
    await inbound(fromHer({ kind: "text", text: "Up early today." }));
    const yesterday = await exchangeOn(seed.member.id, "2026-09-14");
    const rows = await h.db.select().from(answers).orderBy(asc(answers.receivedAt));
    expect(rows.map((row) => row.exchangeId)).toEqual([yesterday?.id, yesterday?.id]);

    await runSchedulerUntil(seed.member.id, at("2026-09-15", "23:00"));

    const today = await exchangeOn(seed.member.id, "2026-09-15");
    expect(today).toMatchObject({ state: "delivered", repeatedAt: null, answeredAt: null });
    expect(await h.db.select().from(quietEvents)).toHaveLength(0);
    // Her day holds the thanks for the early message and the morning itself: no repeat, no notice.
    expect(
      h.telegram
        .sentTo(HER)
        .slice(herMessagesSoFar)
        .map((entry) => entry.message.text),
    ).toEqual([t("en", "ack.thanks", { address: "Mrs Chen" }), HELLO_ARRIVAL]);
  });
});

describe("the silence drill", () => {
  it("sends one delivery notice after the first send and its three retries fail, with no repeat and no quiet event", async () => {
    const seed = await consentedYesterday();
    h.telegram.failSendsTo(HER, "unavailable");

    await runSchedulerUntil(seed.member.id, at("2026-09-14", "23:00"));

    const [row] = await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"));
    expect(row).toMatchObject({ status: "failed", attempts: 4 });
    expect(h.telegram.failed.filter((entry) => entry.message.kind === "arrival")).toHaveLength(4);
    expect(h.telegram.sentTo(ORGANISER).map((entry) => entry.message.text)).toEqual([
      t("en", "delivery.failed", { name: "Mom", channel: "Telegram" }),
    ]);
    expect(await exchangeOn(seed.member.id, "2026-09-14")).toMatchObject({
      state: "scheduled",
      repeatedAt: null,
    });
    expect(await h.db.select().from(quietEvents)).toHaveLength(0);
    expect(await h.db.select().from(outbound).where(eq(outbound.kind, "repeat"))).toHaveLength(0);
  });

  it("marks the link when she has blocked the bot, and clears it when she unblocks", async () => {
    const seed = await consentedYesterday();
    h.telegram.failSendsTo(HER, "blocked");

    await runSchedulerUntil(seed.member.id, at("2026-09-14", "09:00"));

    const [row] = await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"));
    // A block cannot pass, so there is no retry: the link is marked on the first failure.
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    const blockedAt = at("2026-09-14", "08:00");
    expect(
      await h.db.select().from(channelLinks).where(eq(channelLinks.memberId, seed.member.id)),
    ).toMatchObject([{ blockedAt }]);

    // Telegram reports it in her chat too, and reports when she unblocks.
    h.clock.set(at("2026-09-14", "10:00"));
    await inbound(fromHer({ kind: "blocked" }));
    expect(
      (await h.db.select().from(channelLinks).where(eq(channelLinks.memberId, seed.member.id)))[0]
        ?.blockedAt,
    ).toEqual(at("2026-09-14", "10:00"));

    await inbound(fromHer({ kind: "unblocked" }));
    expect(
      (await h.db.select().from(channelLinks).where(eq(channelLinks.memberId, seed.member.id)))[0]
        ?.blockedAt,
    ).toBeNull();
  });

  it("pauses the light without a repeat or a quiet notice when she blocks the bot after her morning reached her", async () => {
    const seed = await consentedYesterday();
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "08:00"));
    expect(newMessages()).toEqual([[HER, HELLO_ARRIVAL]]);

    // 10:00: she deletes the chat with "Stop and block bot", and Telegram refuses every later send.
    h.clock.set(at("2026-09-14", "10:00"));
    await inbound(fromHer({ kind: "blocked" }));
    h.telegram.failSendsTo(HER, "blocked");

    // Past 14:00, when the quiet would open, and 16:00, when the learning period would tell them.
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "18:00"));

    expect(newMessages()).toEqual([]);
    expect(await h.db.select().from(quietEvents)).toHaveLength(0);
    expect(
      (await h.db.select({ kind: outbound.kind }).from(outbound)).map((row) => row.kind),
    ).toEqual(["arrival"]);
  });

  it("looks at her day again when she unblocks the bot, so the quiet still opens and tells on time", async () => {
    const seed = await consentedYesterday();
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "08:00"));
    expect(newMessages()).toEqual([[HER, HELLO_ARRIVAL]]);

    // Blocked at 10:00, over the 10:30 tick, which holds her morning back; unblocked at 10:45.
    h.clock.set(at("2026-09-14", "10:00"));
    await inbound(fromHer({ kind: "blocked" }));
    h.telegram.failSendsTo(HER, "blocked");
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "10:40"));
    h.clock.set(at("2026-09-14", "10:45"));
    h.telegram.clearFailures();
    await inbound(fromHer({ kind: "unblocked" }));

    // The repeat that fell due in the block goes at the unblock: nothing records when she unblocked.
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "15:00"));
    expect(newMessages()).toEqual([[HER, HELLO_REPEAT]]);
    expect(await h.db.select().from(quietEvents)).toMatchObject([
      { openedAt: at("2026-09-14", "14:00"), lastNotifiedAt: null },
    ]);

    await runSchedulerUntil(seed.member.id, at("2026-09-14", "16:00"));
    expect(newMessages()).toEqual([
      [ORGANISER, t("en", "quiet.notice_no_usual", { name: "Mom", sent: "08:00" })],
    ]);
  });

  it("brings the notice back when the wait the organiser asked for runs out, although she blocked the bot since", async () => {
    const seed = await consentedYesterday();
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "16:00"));
    expect(newMessages()).toEqual([
      [HER, HELLO_ARRIVAL],
      [HER, HELLO_REPEAT],
      [ORGANISER, t("en", "quiet.notice_no_usual", { name: "Mom", sent: "08:00" })],
    ]);
    h.clock.set(at("2026-09-14", "16:05"));
    await inbound(
      fromOrganiser({
        kind: "button",
        buttonData: lastButtonTo(ORGANISER, 1),
        callbackId: "cb-wait",
        messageId: h.telegram.sentTo(ORGANISER).at(-1)?.result.primaryMessageId,
      }),
    );
    expect(h.telegram.closed.at(-1)).toMatchObject({
      conversationId: ORGANISER,
      replacementText: t("en", "quiet.waiting", { time: "18:05" }),
    });

    h.clock.set(at("2026-09-14", "17:00"));
    await inbound(fromHer({ kind: "blocked" }));
    h.telegram.failSendsTo(HER, "blocked");

    // Vela said it would look again at 18:05, and she is still quiet.
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "18:05"));
    expect(newMessages()).toEqual([
      [ORGANISER, t("en", "quiet.notice_no_usual", { name: "Mom", sent: "08:00" })],
    ]);
    expect(await h.db.select().from(quietEvents)).toMatchObject([
      { notifyCount: 2, resolvedAt: null },
    ]);
  });

  it("ladders a morning that reached her after her link was marked blocked, as on any day", async () => {
    const seed = await consentedYesterday();
    // A block Telegram reported last night, and an unblock it never did: the morning goes through.
    await h.db
      .update(channelLinks)
      .set({ blockedAt: at("2026-09-13", "20:00") })
      .where(eq(channelLinks.memberId, seed.member.id));

    await runSchedulerUntil(seed.member.id, at("2026-09-14", "16:00"));

    expect(newMessages()).toEqual([
      [HER, HELLO_ARRIVAL],
      [HER, HELLO_REPEAT],
      [ORGANISER, t("en", "quiet.notice_no_usual", { name: "Mom", sent: "08:00" })],
    ]);
  });

  it("delivers a wake nobody served three hours late, with the note, exactly once", async () => {
    const seed = await seedFamily(h.db, { now: at("2026-09-13", "08:00") });
    await h.db
      .update(members)
      .set({ nextWakeAt: at("2026-09-14", "08:00") })
      .where(eq(members.id, seed.member.id));
    // Three hours and a note: the late note follows a delivery more than three hours behind.
    h.clock.set(at("2026-09-14", "11:05"));

    expect(await reconcile(h.deps)).toMatchObject({ ticked: 1, missed: 1 });
    await h.run(handlers());

    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toEqual([
      [
        t("en", "arrival.late"),
        t("en", "arrival.greeting", { address: "Mrs Chen" }),
        "",
        t("en", "arrival.hello"),
        t("en", "arrival.hello_signature"),
        "",
        t("en", "arrival.hint"),
      ].join("\n"),
    ]);
    expect(await exchangeOn(seed.member.id, "2026-09-14")).toMatchObject({
      state: "delivered",
      deliveryLate: true,
      deliveredAt: at("2026-09-14", "11:05"),
    });

    // The next reconciliation finds the morning already out and sends nothing again.
    h.clock.set(at("2026-09-14", "11:30"));
    await reconcile(h.deps);
    await h.run(handlers());
    expect(h.telegram.sentTo(HER)).toHaveLength(1);
    expect(await h.db.select().from(outbound).where(eq(outbound.kind, "arrival"))).toHaveLength(1);
  });

  it("lights her answer while the AI and speech-to-text are down, and understands it once they are back", async () => {
    const seed = await consentedYesterday();
    await runSchedulerUntil(seed.member.id, at("2026-09-14", "08:00"));
    seen = h.telegram.sent.length;
    h.telegram.mediaFiles.set("voice-1", {
      body: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
      mime: "audio/ogg",
    });
    // The outage: transcription fails and the model cannot be read.
    h.deps.stt = createFakeStt({ ok: false });
    h.deps.ai = createFakeAi({
      understand: (input) => Promise.resolve(failedUnderstanding(SAFE_DEFAULTS.understand(input))),
    });

    h.clock.set(at("2026-09-14", "08:10"));
    await inbound(fromHer({ kind: "voice", media: VOICE }));

    // The light is on and the family has heard her, outage or not.
    const [answer] = await h.db.select().from(answers);
    expect(answer).toMatchObject({ kind: "voice", understoodAt: null, processingAttempts: 1 });
    expect(await exchangeOn(seed.member.id, "2026-09-14")).toMatchObject({
      state: "answered",
      answeredAt: at("2026-09-14", "08:10"),
    });
    expect(newMessages()).toEqual([
      [HER, t("en", "ack.thanks", { address: "Mrs Chen" })],
      [GROUP, t("en", "group.answer_hello", { name: "Mom", time: "08:10" })],
    ]);
    expect(h.telegram.sentTo(GROUP).at(-1)?.message.media).toEqual([VOICE]);

    // The outage ends; the re-run picks the answer up a quarter of an hour later.
    h.deps.stt = h.stt;
    h.deps.ai = createFakeAi();
    h.clock.set(at("2026-09-14", "08:26"));
    expect(await reconcile(h.deps)).toMatchObject({ rerun: 1 });
    await h.run(handlers());

    const [understood] = await h.db.select().from(answers);
    expect(understood).toMatchObject({
      transcript: "fake transcript",
      summary: "fake transcript",
      processingAttempts: 3,
    });
    expect(understood?.understoodAt).not.toBeNull();
    expect(newMessages()).toEqual([
      [GROUP, t("en", "group.answer_transcript", { name: "Mom", text: "fake transcript" })],
    ]);
  });
});

function failedUnderstanding(value: Understanding): AiOutcome<Understanding> {
  return { ok: false, value, record: fakeRecord("understand", "http_529"), error: "http_529" };
}
