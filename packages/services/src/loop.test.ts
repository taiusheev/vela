/**
 * The pilot loop of spec Appendix A, end to end (flows §6, test 1): an organiser onboards, the
 * parent consents, the group is linked, the evening prompt names the holder, the holder asks, the
 * chips are drafted, the morning arrives with them, she taps one, the family sees it, a sibling
 * replies, and the next morning opens with that reply.
 *
 * Everything reaches the services the way Telegram would: `handleInbound` with parsed events, the
 * harness clock, the member's tick where the Durable Object's alarm would be, and the queue
 * handlers the Worker will wire. Each step asserts the exact messages that went out, in order.
 */
import type { InboundEvent, InboundKind, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { localDateOf } from "@vela/core";
import { answers, chips, exchanges, invites, members, replies, turns } from "@vela/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MediaJob, OutboundJob, UnderstandJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { tickMember } from "./tick.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  sequence = 0;
  seen = 0;
});

afterAll(async () => {
  await h.close();
});

const ORGANISER = "1001";
const HER = "2001";
const SIBLING = "3001";
const GROUP = "-100500";
const ZONE = "Asia/Taipei";
const NAMES: Readonly<Record<string, string>> = {
  [ORGANISER]: "Mia",
  [HER]: "Mom",
  [SIBLING]: "Sam",
};

let sequence = 0;
/** How many sent messages have already been asserted. */
let seen = 0;

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
    sender: { externalUserId: user, displayName: NAMES[user], languageCode: "en" },
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

/** One event through the router, then everything the queues carry away. */
async function inbound(...events: InboundEvent[]): Promise<void> {
  await handleInbound(h.deps, events);
  await h.run(handlers());
}

/** The messages sent since the last check: where each went and what it said, in order. */
function newMessages(): [string, string][] {
  const fresh = h.telegram.sent.slice(seen);
  seen = h.telegram.sent.length;
  return fresh.map((entry) => [entry.message.to.conversationId, entry.message.text]);
}

function lastMessageIdTo(conversationId: string): string {
  const sent = h.telegram.sentTo(conversationId).at(-1);
  if (sent === undefined) {
    throw new Error(`nothing was sent to ${conversationId}`);
  }
  return sent.result.primaryMessageId;
}

async function keptLightMember() {
  const [row] = await h.db.select().from(members).where(eq(members.role, "member")).limit(1);
  if (row === undefined) {
    throw new Error("the family has no kept-light member yet");
  }
  return row;
}

async function nextWake(memberId: string): Promise<Date | null> {
  const [row] = await h.db
    .select({ at: members.nextWakeAt })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.at ?? null;
}

/**
 * The Durable Object's part: at each wake her row stores, the clock moves there, her tick runs, and
 * the queues it filled are drained, until nothing is due before `until`.
 */
async function runSchedulerUntil(memberId: string, until: Date): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    const wake = await nextWake(memberId);
    if (wake === null || wake.getTime() > until.getTime()) {
      h.clock.set(until);
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

function at(date: LocalDate, time: string): Date {
  return new Date(`${date}T${time}:00.000+08:00`);
}

describe("the pilot loop", () => {
  it("carries one family from onboarding to the morning that reads yesterday's reply back", async () => {
    // ── The organiser sets the light up, in her own chat ────────────────────────────────────────
    await inbound(privately(ORGANISER, { kind: "start" }));
    await inbound(privately(ORGANISER, { kind: "text", text: "Mom" }));
    await inbound(privately(ORGANISER, { kind: "text", text: "Mrs Chen" }));
    expect(newMessages()).toEqual([
      [ORGANISER, `${t("en", "onboarding.welcome")}\n\n${t("en", "onboarding.ask_name")}`],
      [ORGANISER, t("en", "onboarding.ask_address")],
      [ORGANISER, t("en", "onboarding.ask_language")],
    ]);

    const tapLast = (user: string, index: number, row = 0): InboundEvent => {
      const buttons = h.telegram.sentTo(user).at(-1)?.message.buttons ?? [];
      const button = buttons[row]?.[index];
      if (button === undefined) {
        throw new Error(`no button ${row}:${index} in the last message to ${user}`);
      }
      return privately(user, {
        kind: "button",
        buttonData: button.id,
        callbackId: `cb${sequence + 1}`,
        messageId: lastMessageIdTo(user),
      });
    };

    // English, Taiwan, awake at 07:30, nobody nearby to note yet.
    await inbound(tapLast(ORGANISER, 0));
    await inbound(tapLast(ORGANISER, 0));
    await inbound(tapLast(ORGANISER, 3));
    await inbound(tapLast(ORGANISER, 0));

    const her = await keptLightMember();
    expect(her).toMatchObject({
      displayName: "Mom",
      addressForm: "Mrs Chen",
      language: "en",
      tz: ZONE,
      status: "invited",
      lightOn: false,
      wakeTime: "07:30",
      arrivalTime: "08:00",
    });
    const [invite] = await h.db.select().from(invites);
    const link = `https://t.me/VelaLightBot?start=${invite?.token ?? ""}`;
    expect(newMessages()).toEqual([
      [ORGANISER, t("en", "onboarding.ask_country")],
      [ORGANISER, t("en", "onboarding.ask_wake")],
      [ORGANISER, t("en", "onboarding.ask_nearby")],
      [ORGANISER, t("en", "onboarding.done", { name: "Mom", link })],
    ]);

    // ── She opens the link and says yes ────────────────────────────────────────────────────────
    await inbound(privately(HER, { kind: "start", startParam: invite?.token }));
    expect(newMessages()).toEqual([[HER, t("en", "consent.request", { organiser: "Mia" })]]);

    await inbound(tapLast(HER, 0));

    expect(await keptLightMember()).toMatchObject({
      status: "active",
      lightOn: true,
      lightStartsOn: "2026-09-15",
      learningUntil: "2026-09-28",
    });
    expect(newMessages()).toEqual([
      [HER, t("en", "consent.accepted", { time: "08:00" })],
      [ORGANISER, t("en", "organiser.consent_given", { name: "Mom", time: "08:00" })],
    ]);
    // Her first wake is this evening's turn prompt: the light starts tomorrow.
    expect(await nextWake(her.id)).toEqual(at("2026-09-14", "19:00"));

    // ── The organiser adds Vela to the family group ────────────────────────────────────────────
    await inbound(inGroup(ORGANISER, { kind: "bot_added" }));
    expect(newMessages()).toEqual([
      [GROUP, t("en", "group.linked", { name: "Mom", notice: "https://vela.test/privacy/en" })],
    ]);

    // ── 19:00: whose turn it is ───────────────────────────────────────────────────────────────
    await runSchedulerUntil(her.id, at("2026-09-14", "19:00"));
    expect(newMessages()).toEqual([
      [GROUP, t("en", "group.turn_prompt", { holder: "Mia", name: "Mom" })],
    ]);
    const promptMessageId = lastMessageIdTo(GROUP);
    const [turn] = await h.db.select().from(turns);
    expect(turn).toMatchObject({ localDay: "2026-09-15", holderId: expect.any(String) });

    // ── The holder replies to the prompt with a question ──────────────────────────────────────
    h.clock.set(at("2026-09-14", "19:05"));
    await inbound(
      inGroup(ORGANISER, {
        kind: "text",
        text: "What are you cooking tonight?",
        replyToMessageId: promptMessageId,
      }),
    );
    expect(newMessages()).toEqual([[GROUP, t("en", "group.ask_confirmed", { name: "Mom" })]]);
    const [composed] = await h.db.select().from(exchanges);
    expect(composed).toMatchObject({
      state: "composed",
      type: "question",
      text: "What are you cooking tonight?",
      scheduledFor: "2026-09-15",
    });

    // ── 22:00: the morning is prepared and its chips drafted ──────────────────────────────────
    await runSchedulerUntil(her.id, at("2026-09-14", "22:30"));
    expect(newMessages()).toEqual([]);
    const [drafted] = await h.db.select().from(chips);
    expect(drafted?.chips).toEqual(["Good", "Not yet", "Tell you later"]);
    expect(h.ai.calls.map((call) => call.call)).toEqual(["chips"]);

    // ── 08:00: her morning, with the chips as buttons ─────────────────────────────────────────
    await runSchedulerUntil(her.id, at("2026-09-15", "08:00"));
    expect(newMessages()).toEqual([
      [
        HER,
        [
          t("en", "arrival.greeting", { address: "Mrs Chen" }),
          "",
          t("en", "arrival.asks", { asker: "Mia" }),
          "What are you cooking tonight?",
          "",
          t("en", "arrival.hint"),
        ].join("\n"),
      ],
    ]);
    const arrival = h.telegram.sentTo(HER).at(-1)?.message;
    expect(arrival?.buttons?.map((row) => row.map((button) => button.label))).toEqual([
      ["Good"],
      ["Not yet"],
      ["Tell you later"],
      [t("en", "button.heart"), t("en", "button.fine")],
    ]);

    // ── She taps a chip; the family sees it ───────────────────────────────────────────────────
    h.clock.set(at("2026-09-15", "08:05"));
    await inbound(tapLast(HER, 0));

    expect(newMessages()).toEqual([
      [HER, t("en", "ack.thanks", { address: "Mrs Chen" })],
      [
        GROUP,
        `${t("en", "group.answer_light", { name: "Mom", asker: "Mia", time: "08:05" })}\n${t(
          "en",
          "group.answer_chip",
          { name: "Mom", choice: "Good" },
        )}`,
      ],
    ]);
    expect(h.telegram.closed.at(-1)).toMatchObject({
      conversationId: HER,
      replacementText: "Good",
    });
    const [answer] = await h.db.select().from(answers);
    expect(answer).toMatchObject({ kind: "chip", payload: { index: 0, choice: "Good" } });
    expect(answer?.understoodAt).not.toBeNull();
    const answerPostMessageId = lastMessageIdTo(GROUP);

    // ── A sibling replies under her answer ────────────────────────────────────────────────────
    h.clock.set(at("2026-09-15", "09:00"));
    await inbound(
      inGroup(SIBLING, {
        kind: "text",
        text: "Sounds good, Mom!",
        replyToMessageId: answerPostMessageId,
      }),
    );
    expect(newMessages()).toEqual([]);
    const [reply] = await h.db.select().from(replies);
    expect(reply).toMatchObject({ kind: "text", text: "Sounds good, Mom!", readBackAt: null });

    // ── That evening the turn moves on, and nobody asks ───────────────────────────────────────
    await runSchedulerUntil(her.id, at("2026-09-15", "22:30"));
    expect(newMessages()).toEqual([
      [GROUP, t("en", "group.turn_prompt", { holder: "Sam", name: "Mom" })],
    ]);

    // ── The next morning opens with yesterday's reply, which is then read back ────────────────
    await runSchedulerUntil(her.id, at("2026-09-16", "08:00"));
    expect(newMessages()).toEqual([
      [
        HER,
        [
          t("en", "arrival.readback_heading"),
          t("en", "readback.replied", { name: "Sam", text: "Sounds good, Mom!" }),
          "",
          t("en", "arrival.greeting", { address: "Mrs Chen" }),
          "",
          t("en", "arrival.hello"),
          t("en", "arrival.hello_signature"),
          "",
          t("en", "arrival.hint"),
        ].join("\n"),
      ],
    ]);
    const [readBack] = await h.db.select().from(replies);
    expect(readBack?.readBackAt).toEqual(at("2026-09-16", "08:00"));
    const yesterday = await h.db
      .select({ state: exchanges.state })
      .from(exchanges)
      .where(
        and(
          eq(exchanges.recipientId, her.id),
          eq(exchanges.scheduledFor, "2026-09-15" as LocalDate),
        ),
      );
    expect(yesterday.map((row) => row.state)).toEqual(["read_back"]);

    // Nothing reached the founder's chat, and every message went where it belonged.
    expect(h.telegram.sentTo("9001")).toHaveLength(0);
    expect(localDateOf(h.clock.now(), ZONE)).toBe("2026-09-16");
    const everything = await h.db
      .select({ name: exchanges.type })
      .from(exchanges)
      .orderBy(asc(exchanges.createdAt));
    expect(everything.map((row) => row.name)).toEqual(["question", "hello"]);
  });
});
