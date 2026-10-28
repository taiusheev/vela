/**
 * A morning with the check-in on (ADR-54, ADR-55), end to end, in her first weeks: the morning has
 * no buttons; two hours later, still unanswered, the check-in asks how she is. One morning she taps
 * "Not okay" and her organiser and the founder hear at once; another she stays silent, the
 * organiser gets the quiet notice at four hours and, with nobody acting on it, again two hours later
 * with the founder told.
 *
 * Everything reaches the services the way Telegram would, as in `trial-week.test.ts`.
 */
import type { InboundEvent, InboundKind, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { exchanges, invites, members } from "@vela/db";
import { and, eq } from "drizzle-orm";
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
  (h.deps.config as { checkIn?: boolean }).checkIn = true;
});

afterAll(async () => {
  (h.deps.config as { checkIn?: boolean }).checkIn = undefined;
  await h.close();
});

const FOUNDER = "9001";

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

/** Mia's question for Mom's morning of 15 September, written the evening before. */
async function miaAsks(): Promise<void> {
  await runSchedulerUntil(await herId(), at("2026-09-14", "19:00"));
  h.clock.set(at("2026-09-14", "19:05"));
  await inbound(
    inGroup(ORGANISER, {
      kind: "text",
      text: "What are you cooking tonight?",
      replyToMessageId: lastTo(GROUP).result.primaryMessageId,
    }),
  );
}

async function herId(): Promise<string> {
  const [her] = await h.db.select().from(members).where(eq(members.role, "member")).limit(1);
  if (her === undefined) throw new Error("no Mom");
  return her.id;
}

describe("a morning with the check-in on", () => {
  it("asks how she is two hours on, and tells Mia and the founder at once when she is not okay", async () => {
    const her = await onboard();
    await miaAsks();

    // 08:00: her morning, Mia's question, with no buttons.
    await runSchedulerUntil(her.id, at("2026-09-15", "08:00"));
    const morning = lastTo(HER);
    expect(morning.message.text).toContain("What are you cooking tonight?\n— Mia");
    expect(morning.message.buttons ?? []).toEqual([]);

    // 09:59: nothing yet. 10:00, two hours in her first weeks: the check-in.
    await runSchedulerUntil(her.id, at("2026-09-15", "09:59"));
    expect(lastTo(HER)).toBe(morning);
    await runSchedulerUntil(her.id, at("2026-09-15", "10:00"));
    const checkIn = lastTo(HER);
    expect(checkIn.message.text).toBe(t("en", "checkin.text", { address: "Mrs Chen" }));
    expect(checkIn.message.buttons?.map((row) => row.map((button) => button.label))).toEqual([
      [t("en", "button.okay")],
      [t("en", "button.not_okay")],
    ]);

    // 10:05: "Not okay".
    h.clock.set(at("2026-09-15", "10:05"));
    await inbound(tapLast(HER, t("en", "button.not_okay")));
    expect(lastTo(ORGANISER).message.text).toBe(
      t("en", "not_okay.notice", { name: "Mom", time: "10:05" }),
    );
    expect(lastTo(FOUNDER).message.text).toMatch(/^"Not okay" tapped in /);
    expect(lastTo(HER).message.text).toBe(
      t("en", "ack.not_okay", { address: "Mrs Chen", names: "Mia" }),
    );
    expect(lastTo(GROUP).message.text).toBe(
      t("en", "group.answer_not_okay", { name: "Mom", time: "10:05" }),
    );
    expect(await exchangeOn(her.id, "2026-09-15")).toMatchObject({ state: "answered" });

    // She answered, so no quiet notice comes that afternoon.
    const toMia = h.telegram.sentTo(ORGANISER).length;
    await runSchedulerUntil(her.id, at("2026-09-15", "18:00"));
    expect(h.telegram.sentTo(ORGANISER)).toHaveLength(toMia);
  });

  it("tells Mia at four hours when she stays silent, and again two hours later with the founder told", async () => {
    const her = await onboard();
    await miaAsks();
    await runSchedulerUntil(her.id, at("2026-09-15", "10:00"));
    const toMia = h.telegram.sentTo(ORGANISER).length;
    const toFounder = h.telegram.sentTo(FOUNDER).length;

    // 11:59: still nothing for Mia. 12:00, four hours: the quiet notice.
    await runSchedulerUntil(her.id, at("2026-09-15", "11:59"));
    expect(h.telegram.sentTo(ORGANISER)).toHaveLength(toMia);
    await runSchedulerUntil(her.id, at("2026-09-15", "12:00"));
    expect(h.telegram.sentTo(ORGANISER)).toHaveLength(toMia + 1);
    expect(lastTo(ORGANISER).message.text).toContain("It's been quiet at Mom's today.");

    // Nobody acts. 14:00: sent again, and the founder hears it, once.
    await runSchedulerUntil(her.id, at("2026-09-15", "13:59"));
    expect(h.telegram.sentTo(ORGANISER)).toHaveLength(toMia + 1);
    await runSchedulerUntil(her.id, at("2026-09-15", "14:00"));
    expect(h.telegram.sentTo(ORGANISER)).toHaveLength(toMia + 2);
    const founder = h.telegram.sentTo(FOUNDER).slice(toFounder);
    expect(founder.map((sent) => sent.message.text)).toEqual([
      expect.stringMatching(/^Nobody has acted on Mom's quiet notice in .* for 2 hours\./),
    ]);

    // And never a third time by itself.
    await runSchedulerUntil(her.id, at("2026-09-15", "20:00"));
    expect(h.telegram.sentTo(ORGANISER)).toHaveLength(toMia + 2);
  });
});
