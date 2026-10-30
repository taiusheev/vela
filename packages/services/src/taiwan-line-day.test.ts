/**
 * A Taiwan family's first days as production runs them for the closed test (ADR-52, ADR-54,
 * ADR-55): family approval on, English and Traditional Chinese, everyone on LINE, the check-in on.
 * The organiser sets up in Chinese; nothing reaches Mom until the founder approves the family; then
 * her morning, the check-in and "Not okay" all arrive in Chinese, on LINE, and the founder's alert
 * on the founder's own chat.
 *
 * The Worker refreshes the approved families on every request (`admissionWithRoster`); here the
 * test does it after the founder's click.
 */
import type { InboundEvent, InboundKind, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { exchanges, invites, members } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MediaJob, OutboundJob, UnderstandJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleInbound } from "./inbound/router.ts";
import type { PilotAdmission } from "./pilot-admission.ts";
import { admissionWithRoster, approveFamily } from "./pilot-roster.ts";
import { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { tickMember } from "./tick.ts";

let h: Harness;

const BASE: PilotAdmission = { telegramUserIds: [], familyIds: [], languages: ["en", "zh-TW"] };

type Settable = {
  checkIn?: boolean;
  pilotAdmission?: PilotAdmission | null;
  lineBasicId?: string | null;
};

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  sequence = 0;
  const config = h.deps.config as Settable;
  config.checkIn = true;
  config.lineBasicId = "@675nhrpg";
  config.pilotAdmission = BASE;
});

afterAll(async () => {
  const config = h.deps.config as Settable;
  config.checkIn = undefined;
  config.lineBasicId = null;
  config.pilotAdmission = undefined;
  await h.close();
});

const FOUNDER = "9001";
const ORGANISER = `U${"a".repeat(32)}`;
const HER = `U${"b".repeat(32)}`;
const SISTER = `U${"c".repeat(32)}`;
const GROUP = `C${"d".repeat(32)}`;
const NAMES: Readonly<Record<string, string>> = {
  [ORGANISER]: "小美",
  [HER]: "媽媽",
  [SISTER]: "安安",
};

let sequence = 0;

function event(
  user: string,
  conversation: { id: string; kind: "private" | "group" },
  extra: Partial<InboundEvent> & { kind: InboundKind },
): InboundEvent {
  sequence += 1;
  return {
    channel: "line",
    eventId: `line:${sequence}`,
    at: h.clock.now().toISOString(),
    messageId: String(7000 + sequence),
    sender: { externalUserId: user, displayName: NAMES[user], languageCode: "zh-TW" },
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
  const sent = h.line.sentTo(conversationId).at(-1);
  if (sent === undefined) throw new Error(`nothing was sent to ${conversationId} on LINE`);
  return sent;
}

function lastToFounder() {
  const sent = h.telegram.sentTo(FOUNDER).at(-1);
  if (sent === undefined) throw new Error("nothing was sent to the founder");
  return sent;
}

function tapLast(user: string, label: string | number): InboundEvent {
  const buttons = lastTo(user).message.buttons ?? [];
  const button =
    typeof label === "string"
      ? buttons.flat().find((candidate) => candidate.label === label)
      : buttons.flat()[label];
  if (button === undefined) throw new Error(`no button ${label} for ${user}`);
  return privately(user, {
    kind: "button",
    buttonData: button.id,
    callbackId: `cb${sequence + 1}`,
  });
}

function at(date: LocalDate, time: string): Date {
  return new Date(`${date}T${time}:00.000+08:00`);
}

async function nextWake(memberId: string): Promise<Date | null> {
  const [row] = await h.db
    .select({ at: members.nextWakeAt })
    .from(members)
    .where(eq(members.id, memberId));
  return row?.at ?? null;
}

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

async function her() {
  const [row] = await h.db.select().from(members).where(eq(members.role, "member")).limit(1);
  if (row === undefined) throw new Error("no Mom");
  return row;
}

/** 小美 sets 媽媽 up in Chinese, in her private chat with Vela Light. */
async function organiserSetsUp(): Promise<string> {
  await inbound(privately(ORGANISER, { kind: "start" }));
  expect(lastTo(ORGANISER).message.text).toBe(
    `${t("zh-TW", "onboarding.welcome")}\n\n${t("zh-TW", "onboarding.ask_name")}`,
  );
  await inbound(privately(ORGANISER, { kind: "text", text: "媽媽" }));
  await inbound(privately(ORGANISER, { kind: "text", text: "陳太太" }));
  // Only the test's languages are offered.
  expect(lastTo(ORGANISER).message.text).toBe(t("zh-TW", "onboarding.ask_language"));
  expect(lastTo(ORGANISER).message.buttons?.flat()).toHaveLength(2);
  await inbound(tapLast(ORGANISER, "繁體中文"));
  await inbound(tapLast(ORGANISER, t("zh-TW", "onboarding.country_tw")));
  await inbound(tapLast(ORGANISER, 3));
  await inbound(tapLast(ORGANISER, t("zh-TW", "onboarding.skip")));
  const done = lastTo(ORGANISER).message.text;
  expect(done).toContain("設定完成。");
  expect(done).toContain("https://line.me/R/oaMessage/");
  const [invite] = await h.db.select().from(invites);
  if (invite === undefined) throw new Error("no invite");
  return invite.token;
}

async function exchangeOn(memberId: string, date: LocalDate) {
  const [row] = await h.db
    .select()
    .from(exchanges)
    .where(and(eq(exchanges.recipientId, memberId), eq(exchanges.scheduledFor, date)));
  return row;
}

describe("a Taiwan family on LINE, in Chinese, with family approval on", () => {
  it("runs her yes, morning, check-in and Not okay in Chinese once the founder approved the family", async () => {
    const token = await organiserSetsUp();

    // The founder approves the family on the admin page before the organiser sends her the link.
    const [invite] = await h.db.select().from(invites);
    if (invite === undefined) throw new Error("no invite");
    expect(await approveFamily(h.deps, { admin: "founder@vela-light.com" }, invite.familyId)).toBe(
      "approved",
    );
    (h.deps.config as Settable).pilotAdmission = await admissionWithRoster(h.db, BASE);

    // Her LINE link opens Vela Light with /start typed; she sends it and says yes.
    await inbound(privately(HER, { kind: "start", startParam: token }));
    expect(lastTo(HER).message.text).toContain("想為您留一盞燈");
    await inbound(tapLast(HER, t("zh-TW", "consent.both")));
    expect((await her()).lightOn).toBe(true);
    expect(lastTo(ORGANISER).message.text).toMatch(/[\u4e00-\u9fff]/);

    // The family group: the organiser and her sister add Vela Light.
    await inbound(inGroup(ORGANISER, { kind: "bot_added" }));
    expect(lastTo(GROUP).message.text).toContain("大家好，我是 Vela。");

    // Her first morning, in Chinese, with no buttons.
    const mom = await her();
    await runSchedulerUntil(mom.id, at("2026-09-15", "08:30"));
    const morning = lastTo(HER);
    expect(morning.message.buttons ?? []).toEqual([]);
    expect(morning.message.text).toMatch(/[一-鿿]/);
    expect(morning.message.text).not.toMatch(/\b(Mom|Good morning|family)\b/);

    // Two hours on, still quiet: the check-in, in Chinese.
    const sentAt = new Date(morning.at ?? h.clock.now());
    await runSchedulerUntil(mom.id, new Date(sentAt.getTime() + 2 * 60 * 60 * 1000 + 60_000));
    const checkIn = lastTo(HER);
    expect(checkIn.message.text).toBe(t("zh-TW", "checkin.text", { address: "陳太太" }));
    expect(checkIn.message.buttons?.flat().map((button) => button.label)).toEqual([
      t("zh-TW", "button.okay"),
      t("zh-TW", "button.not_okay"),
    ]);

    // "不太好，告訴家人": 小美 hears on LINE at once, the group sees it, the founder is told.
    await inbound(tapLast(HER, t("zh-TW", "button.not_okay")));
    const notice = lastTo(ORGANISER).message.text;
    expect(notice).toMatch(/[一-鿿]/);
    expect(notice).toContain("媽媽");
    expect(lastTo(GROUP).message.text).toContain("說今天不太好");
    expect(lastToFounder().message.text).toMatch(/不太好|Not okay/);
    expect(lastTo(HER).message.text).not.toBe(
      t("zh-TW", "ack.not_okay_founder", { address: "陳太太" }),
    );
    expect(await exchangeOn(mom.id, "2026-09-15")).toMatchObject({ state: "answered" });

    // Nothing reached Telegram but the founder's own chat.
    expect(h.telegram.sentTo(HER)).toEqual([]);
    expect(h.telegram.sentTo(ORGANISER)).toEqual([]);
  });

  it("sends Mom nothing, and starts no light, for a family the founder never approved", async () => {
    const token = await organiserSetsUp();
    await inbound(privately(HER, { kind: "start", startParam: token }));
    await inbound(tapLast(HER, t("zh-TW", "consent.both")));
    const mom = await her();
    expect(mom.lightOn).not.toBe(true);
    // Only the wait reply reaches her, so nothing she did is lost in silence.
    expect(lastTo(HER).message.text).toBe(t("zh-TW", "pilot.activation_wait"));

    const toHer = h.line.sentTo(HER).length;
    await runSchedulerUntil(mom.id, at("2026-09-16", "12:00"));
    expect(h.line.sentTo(HER)).toHaveLength(toHer);
  });

  it("answers Mom's early yes, tells the founder once, and counts her next tap after approval", async () => {
    const token = await organiserSetsUp();
    const [invite] = await h.db.select().from(invites);
    if (invite === undefined) throw new Error("no invite");
    await inbound(privately(HER, { kind: "start", startParam: token }));
    const request = tapLast(HER, t("zh-TW", "consent.both"));

    // The organiser sent the link before the founder's click: she taps yes, twice.
    await inbound(request);
    await inbound({ ...request, eventId: "line:again", callbackId: "cb-again" });
    expect((await her()).lightOn).not.toBe(true);
    expect(lastTo(HER).message.text).toBe(t("zh-TW", "pilot.activation_wait"));
    const told = h.telegram
      .sentTo(FOUNDER)
      .filter((sent) => sent.message.text.includes("/admin/roster"));
    expect(told).toHaveLength(1);
    expect(told[0]?.message.text).toContain("媽媽");
    expect(told[0]?.message.text).toContain("tapped yes");

    // The founder approves; the same buttons are still there, and her next tap starts her light.
    await approveFamily(h.deps, { admin: "founder@vela-light.com" }, invite.familyId);
    (h.deps.config as Settable).pilotAdmission = await admissionWithRoster(h.db, BASE);
    await inbound({ ...request, eventId: "line:after", callbackId: "cb-after" });
    expect((await her()).lightOn).toBe(true);
  });

  it("lets Mom say no thanks before the founder approves the family", async () => {
    const token = await organiserSetsUp();
    await inbound(privately(HER, { kind: "start", startParam: token }));
    await inbound(tapLast(HER, t("zh-TW", "consent.no")));
    const left = await h.db.select().from(members).where(eq(members.role, "member"));
    expect(left.every((row) => row.leftAt !== null || row.status !== "invited")).toBe(true);
    expect(lastTo(HER).message.text).not.toBe(t("zh-TW", "pilot.activation_wait"));
  });
});
