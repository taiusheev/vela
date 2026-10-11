/**
 * A family's first trial mornings, end to end, as the founder will read them (product week, plan
 * C2/C3): the evening prompt offers an idea, a family ask is answered and replied to, a morning
 * nobody asked brings Vela's question from the bank, the evening says when her answer has no reply
 * yet, a second fallback asks something different, a quiet morning is noticed and answered late,
 * and the protected trial report counts exactly that.
 *
 * Everything reaches the services the way Telegram would, as in `loop.test.ts`: `handleInbound`,
 * her tick where the Durable Object's alarm would be, the nightly suggestion writer, and the queues.
 */
import type { InboundEvent, InboundKind, LocalDate } from "@vela/contracts";
import { askBankItem, t } from "@vela/copy";
import { exchanges, invites, members, quietEvents, suggestions } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAdminTrialReport, trialNumbers } from "./admin-trial-report.ts";
import type { MediaJob, OutboundJob, UnderstandJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
import { writeSuggestions } from "./suggestions.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
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
const GROUP = "-100500";
const NAMES: Readonly<Record<string, string>> = {
  [ORGANISER]: "Mia",
  [HER]: "Mom",
  [SIBLING]: "Sam",
};

let sequence = 0;

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

const privately = (user: string, extra: Partial<InboundEvent> & { kind: InboundKind }) =>
  event(user, { id: user, kind: "private" }, extra);
const inGroup = (user: string, extra: Partial<InboundEvent> & { kind: InboundKind }) =>
  event(user, { id: GROUP, kind: "group" }, extra);

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

async function inbound(...events: InboundEvent[]): Promise<void> {
  await handleInbound(h.deps, events);
  await h.run(handlers());
}

function lastTo(conversationId: string) {
  const sent = h.telegram.sentTo(conversationId).at(-1);
  if (sent === undefined) throw new Error(`nothing was sent to ${conversationId}`);
  return sent;
}

function tapLast(user: string, index: number | string, row = 0): InboundEvent {
  const buttons = lastTo(user).message.buttons ?? [];
  const button =
    typeof index === "string"
      ? buttons.flat().find((candidate) => candidate.label === index)
      : buttons[row]?.[index];
  if (button === undefined) throw new Error(`no button ${row}:${index} for ${user}`);
  return privately(user, {
    kind: "button",
    buttonData: button.id,
    callbackId: `cb${sequence + 1}`,
    messageId: lastTo(user).result.primaryMessageId,
  });
}

async function nextWake(memberId: string): Promise<Date | null> {
  const [row] = await h.db
    .select({ at: members.nextWakeAt })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.at ?? null;
}

/** Her Durable Object: each stored wake ticks, and the queues drain, until `until`. */
async function runSchedulerUntil(memberId: string, until: Date): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    const wake = await nextWake(memberId);
    if (wake === null || wake.getTime() > until.getTime()) {
      h.clock.set(until);
      return;
    }
    if (wake.getTime() > h.clock.now().getTime()) h.clock.set(wake);
    await tickMember(h.deps, memberId);
    await h.run(handlers());
  }
  throw new Error("her scheduler kept waking without settling");
}

function at(date: LocalDate, time: string): Date {
  return new Date(`${date}T${time}:00.000+08:00`);
}

/** Onboarding as in `loop.test.ts`: Mia sets Mom up, Mom says yes, the group is linked. */
async function onboard(): Promise<{ id: string; familyId: string }> {
  await inbound(privately(ORGANISER, { kind: "start" }));
  await inbound(privately(ORGANISER, { kind: "text", text: "Mom" }));
  await inbound(privately(ORGANISER, { kind: "text", text: "Mrs Chen" }));
  await inbound(tapLast(ORGANISER, 0));
  await inbound(tapLast(ORGANISER, t("en", "onboarding.country_tw")));
  await inbound(tapLast(ORGANISER, 3));
  await inbound(tapLast(ORGANISER, 0));
  const [invite] = await h.db.select().from(invites);
  await inbound(privately(HER, { kind: "start", startParam: invite?.token }));
  await inbound(tapLast(HER, 0));
  await inbound(tapLast(HER, 0));
  await inbound(inGroup(ORGANISER, { kind: "bot_added" }));
  const [her] = await h.db.select().from(members).where(eq(members.role, "member")).limit(1);
  if (her === undefined || her.lightOn !== true) throw new Error("Mom did not say yes");
  return { id: her.id, familyId: her.familyId };
}

async function exchangeOn(memberId: string, date: LocalDate) {
  const [row] = await h.db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.recipientId, memberId), eq(exchanges.scheduledFor, date)));
  return row;
}

async function bankTextOf(memberId: string, date: LocalDate): Promise<string | undefined> {
  const [row] = await h.db
    .select({ bankId: suggestions.bankId })
    .from(suggestions)
    .where(and(eq(suggestions.aboutMemberId, memberId), eq(suggestions.localDay, date)));
  return row === undefined ? undefined : askBankItem(row.bankId)?.text.en;
}

describe("a family's first trial mornings", () => {
  it("keeps the family asking, asks her something new when nobody did, and counts it all", async () => {
    const her = await onboard();
    // The nightly writer, as it runs where the app's API is on: ideas for her next three mornings.
    await writeSuggestions(h.deps);
    expect(await bankTextOf(her.id, "2026-09-16")).toBeDefined();

    // ── 14 Sep, 19:00: the turn prompt, with an idea ──────────────────────────────────────────
    await runSchedulerUntil(her.id, at("2026-09-14", "19:00"));
    const prompt = lastTo(GROUP);
    expect(prompt.message.text).toContain(
      t("en", "group.turn_prompt", { holder: "Mia", name: "Mom" }),
    );
    expect(prompt.message.text).toContain("If you'd like an idea:");

    // Mia asks; Mom taps a chip on 15 Sep; Sam replies under her answer.
    h.clock.set(at("2026-09-14", "19:05"));
    await inbound(
      inGroup(ORGANISER, {
        kind: "text",
        text: "What are you cooking tonight?",
        replyToMessageId: prompt.result.primaryMessageId,
      }),
    );
    await runSchedulerUntil(her.id, at("2026-09-15", "08:00"));
    h.clock.set(at("2026-09-15", "08:05"));
    await inbound(tapLast(HER, 0));
    const answerPost = lastTo(GROUP).result.primaryMessageId;
    h.clock.set(at("2026-09-15", "09:00"));
    await inbound(inGroup(SIBLING, { kind: "text", text: "Yum!", replyToMessageId: answerPost }));

    // ── 15 Sep evening: her answer has a reply, so the prompt is the plain one; nobody asks ────
    await runSchedulerUntil(her.id, at("2026-09-15", "22:30"));
    expect(lastTo(GROUP).message.text).not.toContain("nobody has replied yet");

    // ── 16 Sep: Sam's reply read back, then Vela's question from the bank ──────────────────────
    await runSchedulerUntil(her.id, at("2026-09-16", "08:00"));
    const question16 = await bankTextOf(her.id, "2026-09-16");
    expect(await exchangeOn(her.id, "2026-09-16")).toMatchObject({
      type: "hello",
      askerId: null,
      text: question16,
    });
    const morning16 = lastTo(HER).message.text;
    expect(morning16).toContain("Sam: Yum!");
    expect(morning16).toContain(`${t("en", "arrival.hello_question")}\n${question16}`);
    expect(morning16).not.toContain(t("en", "arrival.hello"));

    h.clock.set(at("2026-09-16", "08:30"));
    await inbound(privately(HER, { kind: "text", text: "I sold bread at the market" }));
    expect(lastTo(GROUP).message.text).toBe(
      `${t("en", "group.answer_question", { name: "Mom", time: "08:30", question: question16 ?? "" })}\n${t("en", "group.answer_text", { name: "Mom", text: "I sold bread at the market" })}`,
    );

    // ── 16 Sep, 19:00: nobody replied to her answer, and the group is told so first ────────────
    await runSchedulerUntil(her.id, at("2026-09-16", "19:00"));
    expect(lastTo(GROUP).message.text).toMatch(
      /^Mom answered this morning and nobody has replied yet\./,
    );

    // ── 17 Sep: nobody asks again; a different question; she stays quiet until late ────────────
    await runSchedulerUntil(her.id, at("2026-09-17", "08:00"));
    const question17 = (await exchangeOn(her.id, "2026-09-17"))?.text;
    expect(question17).toBe(await bankTextOf(her.id, "2026-09-17"));
    expect(question17).not.toBe(question16);

    await runSchedulerUntil(her.id, at("2026-09-17", "16:30"));
    const [quiet] = await h.db.select().from(quietEvents);
    expect(quiet).toMatchObject({ resolvedAt: null });
    expect(quiet?.notifyCount).toBeGreaterThanOrEqual(1);

    h.clock.set(at("2026-09-17", "17:00"));
    await inbound(privately(HER, { kind: "text", text: "Busy day, all good" }));
    const [settled] = await h.db.select().from(quietEvents);
    expect(settled).toMatchObject({ outcome: "answered_late" });

    // ── The founder's trial report, next day ───────────────────────────────────────────────────
    h.clock.set(at("2026-09-18", "12:00"));
    const report = await loadAdminTrialReport(
      h.deps,
      { admin: "founder@vela.test" },
      her.familyId,
      7,
    );
    const mom = report?.recipients.find((recipient) => recipient.recipientId === her.id);
    expect(mom?.lightOn).toBe(true);
    expect(mom?.summary).toMatchObject({
      recordedDays: 3,
      deliveredDays: 3,
      answeredDays: 3,
      eligibleDays: 3,
      eligibleAnsweredDays: 3,
      fallbackDays: 2,
      repliesHeardDays: 1,
      quietNoticeDays: 1,
      trueConcern: 0,
      stopsSaid: 0,
    });
    const numbers = Object.fromEntries(
      trialNumbers(mom?.summary ?? ({} as never)).map((n) => [n.key, n.status]),
    );
    // Three days are too few to judge; the report says so instead of a verdict.
    expect(numbers).toMatchObject({
      answer_rate: "too_early",
      fallback_share: "too_early",
      stops: "on_track",
      missed_trouble: "founder_check",
    });
  });
});
