/**
 * Push (ADR-34) against the fake Expo port: what the gateway does with a row on the `app` channel,
 * who the quiet ladder, her answer and the evening's turn write one for, how a quiet event closes on
 * a phone, what the receipts check reads and deletes, and when the founder is told. The fake answers
 * as the Expo client does (`testing/fake-push.ts`), so every failure here meets the codes the
 * gateway will meet in production. Tokens are made at run time: a literal shaped like one looks like
 * a credential to scanning.
 */
import { randomUUID } from "node:crypto";
import type { LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { outboundKey, TUNING } from "@vela/core";
import {
  channelLinks,
  type Member,
  members,
  type Outbound,
  outbound,
  type PushDevice,
  pushDevices,
  pushTickets,
  quietEvents,
  suggestions,
  turns,
  users,
  type VelaTransaction,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { markLeft } from "./admin.ts";
import { organisersUnreachableAlert } from "./admin-alerts.ts";
import { handleParentMessage } from "./answers.ts";
import { sendTurnPrompt } from "./arrivals.ts";
import type { OutboundJob } from "./deps.ts";
import {
  deliverOutbound,
  enqueueOutbound,
  insertOutbound,
  type OutboundRequest,
} from "./gateway.ts";
import { sha256Hex } from "./hash.ts";
import { applyRetention } from "./jobs.ts";
import { checkPushReceipts, RECEIPTS_PER_RUN, recordPushTickets } from "./push.ts";
import { answerReceiptPush } from "./push-messages.ts";
import { openQuiet } from "./quiet.ts";
import { fakeTicketId, pushFailureFor } from "./testing/fake-push.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
} from "./testing/seed.ts";
import { reconcile, tickMember } from "./tick.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  h.deps.push = h.push;
});

afterEach(() => {
  h.deps.push = h.push;
});

afterAll(async () => {
  await h.close();
});

const TODAY: LocalDate = "2026-09-14";
const TOMORROW: LocalDate = "2026-09-15";
const ADMIN = "9001";
const MINUTE = 60_000;

function token(label: string): string {
  return `${["Exponent", "PushToken"].join("")}[push-test-${label}]`;
}

function at(date: LocalDate, time: string): Date {
  return new Date(`${date}T${time}:00.000+08:00`);
}

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

/** An account for `member`, linked to them, with "One moment a day" as given. */
async function accountOf(member: Member, oneMomentADay = true): Promise<string> {
  const [user] = await h.db
    .insert(users)
    .values({ authSubject: `auth|${member.id}`, displayName: member.displayName, oneMomentADay })
    .returning();
  if (user === undefined) throw new Error("expected an account");
  await h.db.update(members).set({ userId: user.id }).where(eq(members.id, member.id));
  return user.id;
}

/** A phone of the account, registered now, that can be told unless `patch` says otherwise. */
async function phone(
  userId: string,
  label: string,
  patch: Partial<Pick<PushDevice, "permission" | "quietChannelBlocked">> = {},
): Promise<PushDevice> {
  const [device] = await h.db
    .insert(pushDevices)
    .values({
      userId,
      installationId: randomUUID(),
      token: token(label),
      platform: "android",
      permission: "granted",
      quietChannelBlocked: false,
      registeredAt: h.clock.now(),
      createdAt: h.clock.now(),
      ...patch,
    })
    .returning();
  if (device === undefined) throw new Error("expected a device");
  return device;
}

/** An organiser who joined in the app: no Telegram link, an account, and a phone. */
async function appOrganiser(
  seed: SeededFamily,
  name: string,
  externalId: string,
): Promise<{ member: Member; userId: string; device: PushDevice }> {
  const { member, link } = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name,
    externalId,
    role: "organiser",
  });
  await h.db.delete(channelLinks).where(eq(channelLinks.id, link.id));
  const userId = await accountOf(member);
  return { member, userId, device: await phone(userId, name.toLowerCase()) };
}

/** Mia keeps her membership but can no longer be told on Telegram. */
async function unlinkMia(seed: SeededFamily): Promise<void> {
  await h.db.delete(channelLinks).where(eq(channelLinks.id, seed.organiserLink.id));
}

interface QuietScene {
  seed: SeededFamily;
  exchangeId: string;
}

/** Mia asked today's question; it reached Mom at 08:00 and the clock stands at T_quiet. */
async function quietMorning(): Promise<QuietScene> {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    state: "delivered",
    deliveredAt: h.clock.now(),
  });
  h.clock.advanceMinutes(TUNING.defaultQuietAfterMinutes);
  return { seed, exchangeId: exchange.id };
}

async function tellQuiet(seed: SeededFamily): Promise<void> {
  await openQuiet(h.deps, seed.member.id, TODAY, true);
}

async function quietEvent() {
  const [quiet] = await h.db.select().from(quietEvents);
  if (quiet === undefined) throw new Error("expected a quiet event");
  return quiet;
}

async function outboundRows(): Promise<Outbound[]> {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function appRows(kind?: Outbound["kind"]): Promise<Outbound[]> {
  return (await outboundRows()).filter(
    (row) => row.channel === "app" && (kind === undefined || row.kind === kind),
  );
}

async function adminTexts(): Promise<string[]> {
  return (await outboundRows())
    .filter((row) => row.conversationId === ADMIN)
    .map((row) => textOf(row));
}

const StoredText = z.object({ message: z.object({ text: z.string() }) });

function textOf(row: Outbound): string {
  return StoredText.parse(row.payload).message.text;
}

async function devices(): Promise<PushDevice[]> {
  return h.db.select().from(pushDevices).orderBy(asc(pushDevices.createdAt), asc(pushDevices.id));
}

async function tickets() {
  return h.db.select().from(pushTickets).orderBy(asc(pushTickets.createdAt), asc(pushTickets.id));
}

function logged(event: string) {
  return h.logger.entries.filter((entry) => entry.event === event);
}

function emit(tx: VelaTransaction, request: OutboundRequest) {
  return enqueueOutbound(h.deps, tx, request);
}

function unheardText(seed: SeededFamily): string {
  return t("en", "admin.quiet_notice_unheard", {
    name: "Mom",
    family: seed.family.name,
    link: `https://vela.test/admin/families/${seed.family.id}`,
  });
}

/** The round-level alert (`quietNoticeFailed`): every notice of the round has failed. */
function nobodyToldText(seed: SeededFamily): string {
  return t("en", "admin.quiet_nobody_told", {
    name: "Mom",
    family: seed.family.name,
    link: `https://vela.test/admin/families/${seed.family.id}`,
  });
}

function unreachableText(seed: SeededFamily, name: string): string {
  return t("en", "admin.organisers_unreachable", {
    name,
    family: seed.family.name,
    link: `https://vela.test/admin/families/${seed.family.id}`,
  });
}

const MISCONFIGURED = t("en", "admin.push_misconfigured", { link: "https://vela.test/admin" });

// -------------------------------------------------------------------------------------------------

describe("an app row at the gateway's door", () => {
  it("takes a push, and refuses a kind that is no push, or one with buttons, files, a reply or a ref", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const miaUser = await accountOf(seed.organiser);
    const exchange = await seedExchange(h.db, seed, { date: TODAY, state: "delivered" });
    const push = answerReceiptPush({
      reader: { member: { ...seed.organiser, userId: miaUser }, userId: miaUser },
      exchangeId: exchange.id,
      herName: "Mom",
    });
    const refused: OutboundRequest[] = [
      { ...push, kind: "flag" } as OutboundRequest,
      { ...push, kind: "system" } as OutboundRequest,
      { ...push, buttons: [[{ id: "b1", label: "Yes" }]] },
      { ...push, media: [{ kind: "image", storageKey: "asks/photo.jpg" }] },
      { ...push, replyToMessageId: "7" },
      { ...push, ref: { purpose: "arrival", exchangeId: exchange.id } },
    ];

    for (const request of refused) {
      await expect(insertOutbound(h.deps, h.db, request), request.kind).rejects.toMatchObject({
        code: "invalid_outbound",
      });
    }
    expect(await outboundRows()).toEqual([]);
    expect(await insertOutbound(h.deps, h.db, push)).toMatchObject({
      outboundId: expect.any(String),
    });
  });
});

describe("a quiet notice on phones", () => {
  it("goes to every phone of the organiser's account that can be told, in one request, time-sensitive and carrying ids only", async () => {
    const { seed, exchangeId } = await quietMorning();
    const miaUser = await accountOf(seed.organiser);
    const first = await phone(miaUser, "first");
    const second = await phone(miaUser, "second");
    await phone(miaUser, "denied", { permission: "denied" });
    await phone(miaUser, "channel-off", { quietChannelBlocked: true });

    await tellQuiet(seed);
    await h.run(handlers());

    const quiet = await quietEvent();
    const body = t("en", "push.quiet_notice", { name: "Mom", sent: "08:00" });
    expect(h.push.sends).toHaveLength(1);
    const sent = h.push.sends[0] ?? [];
    expect(sent.map((message) => message.to).sort()).toEqual([first.token, second.token].sort());
    for (const message of sent) {
      expect(message).toEqual({
        to: message.to,
        body,
        data: {
          kind: "quiet_notice",
          family_id: seed.family.id,
          member_id: seed.member.id,
          quiet_event_id: quiet.id,
          exchange_id: exchangeId,
        },
        channelId: "quiet",
        priority: "high",
        interruptionLevel: "time-sensitive",
        sound: "default",
        ttl: 4 * 60 * 60,
      });
    }

    const [row] = await appRows("quiet_notice");
    expect(row).toMatchObject({
      idempotencyKey: outboundKey("quiet_notice", {
        quietEventId: quiet.id,
        memberId: seed.organiser.id,
        suffix: "0:app",
      }),
      memberId: seed.organiser.id,
      conversationId: miaUser,
      status: "sent",
      externalId: fakeTicketId(1),
    });
    expect(
      (await tickets()).map((ticket) => ({
        id: ticket.id,
        deviceId: ticket.deviceId,
        tokenSha256: ticket.tokenSha256,
        outboundId: ticket.outboundId,
      })),
    ).toEqual(
      await Promise.all(
        sent.map(async (message, index) => {
          const device = message.to === first.token ? first : second;
          return {
            id: fakeTicketId(index + 1),
            deviceId: device.id,
            tokenSha256: await sha256Hex(device.token),
            outboundId: row?.id,
          };
        }),
      ),
    );
    // Telegram hears it as before, with its buttons; the reader is counted as told once.
    expect(h.telegram.sentTo("1001")).toHaveLength(1);
    expect(quiet.notifiedMemberIds).toEqual([seed.organiser.id]);
    expect(await adminTexts()).toEqual([]);
  });

  it("reaches an organiser who has only the app, and says nobody was told once push is off", async () => {
    const { seed } = await quietMorning();
    await unlinkMia(seed);
    const sam = await appOrganiser(seed, "Sam", "1002");

    await tellQuiet(seed);
    await h.run(handlers());

    expect((await appRows("quiet_notice")).map((row) => [row.memberId, row.status])).toEqual([
      [sam.member.id, "sent"],
    ]);
    expect(h.push.sent.map((message) => message.to)).toEqual([sam.device.token]);
    expect(await adminTexts()).toEqual([]);

    // Push off: the same family has nobody who can be told, and the founder hears it.
    await h.reset();
    h.deps.push = null;
    const again = await quietMorning();
    await unlinkMia(again.seed);
    await appOrganiser(again.seed, "Sam", "1002");

    await tellQuiet(again.seed);
    await h.run(handlers());

    expect(await appRows()).toEqual([]);
    expect(await adminTexts()).toEqual([
      t("en", "admin.quiet_nobody_told", {
        name: "Mom",
        family: again.seed.family.name,
        link: `https://vela.test/admin/families/${again.seed.family.id}`,
      }),
    ]);
  });

  it("is not written before the learning period's eight hours, on a phone as on Telegram", async () => {
    const seed = await seedFamily(h.db, { now: at("2026-09-13", "08:00") });
    await seedLinkedGroup(h.db, seed, { now: at("2026-09-13", "08:00") });
    const miaUser = await accountOf(seed.organiser);
    await phone(miaUser, "mia");
    h.clock.set(at(TODAY, "07:00"));
    await tickMember(h.deps, seed.member.id);
    await h.run(handlers());

    // 08:00 the morning, 10:30 the repeat, 14:00 the quiet event, silently while she is learned.
    await runSchedulerUntil(seed.member.id, at(TODAY, "15:30"));
    expect((await quietEvent()).openedAt).toEqual(at(TODAY, "14:00"));
    expect(await appRows()).toEqual([]);
    expect(h.push.sent).toEqual([]);

    // 16:00, eight hours after the morning, both her channels hear it.
    await runSchedulerUntil(seed.member.id, at(TODAY, "16:00"));
    expect((await appRows("quiet_notice")).map((row) => row.status)).toEqual(["sent"]);
    expect(h.push.sent).toHaveLength(1);
    expect(h.telegram.sentTo("1001")).toHaveLength(1);
  });

  it("deletes a phone Expo says is gone and still goes to the others", async () => {
    const { seed } = await quietMorning();
    const miaUser = await accountOf(seed.organiser);
    const gone = await phone(miaUser, "gone");
    const kept = await phone(miaUser, "kept");
    h.push.unregister(gone.token);

    await tellQuiet(seed);
    await h.run(handlers());

    expect((await devices()).map((device) => device.id)).toEqual([kept.id]);
    expect((await appRows("quiet_notice")).map((row) => row.status)).toEqual(["sent"]);
    expect((await tickets()).map((ticket) => ticket.deviceId)).toEqual([kept.id]);
    expect(logged("push_device_gone")).toEqual([
      expect.objectContaining({ fields: { deviceId: gone.id, by: "ticket" } }),
    ]);
    // A log line names the device, never its token.
    expect(JSON.stringify(h.logger.entries)).not.toContain("PushToken");
  });

  it("is dropped when every phone is gone, and the founder hears it when nothing else reached that reader", async () => {
    const { seed } = await quietMorning();
    await unlinkMia(seed);
    const sam = await appOrganiser(seed, "Sam", "1002");
    h.push.unregister(sam.device.token);

    await tellQuiet(seed);
    await h.run(handlers());

    const [row] = await appRows("quiet_notice");
    expect(row).toMatchObject({ status: "dropped", error: "no_push_device" });
    expect(await devices()).toEqual([]);
    // Sam was the family's last organiser who could be told, and the notice reached nobody.
    expect((await adminTexts()).sort()).toEqual(
      [unheardText(seed), unreachableText(seed, "Sam")].sort(),
    );
    const quiet = await quietEvent();
    expect(quiet.notifiedMemberIds).toEqual([]);
    const alert = (await outboundRows()).find((entry) => textOf(entry) === unheardText(seed));
    expect(alert?.idempotencyKey).toBe(
      outboundKey("system", {
        conversationId: ADMIN,
        suffix: `quiet_nobody_told:${quiet.id}:0:${sam.member.id}`,
      }),
    );
  });

  it("tells the founder nothing when the round's Telegram notice is on its way, and that the round told nobody when it then fails for good", async () => {
    const { seed } = await quietMorning();
    const miaUser = await accountOf(seed.organiser);
    const gone = await phone(miaUser, "gone");
    h.push.unregister(gone.token);

    await tellQuiet(seed);
    // The phone's notice goes first and is dropped while Telegram's is still queued.
    await h.run(handlers());
    expect((await appRows("quiet_notice")).map((row) => row.status)).toEqual(["dropped"]);
    expect(h.telegram.sentTo("1001")).toHaveLength(1);
    expect(await adminTexts()).toEqual([]);

    // The next round: Telegram refuses it for good after the phone's was dropped.
    await h.reset();
    const again = await quietMorning();
    const miaAgain = await accountOf(again.seed.organiser);
    await phone(miaAgain, "gone-again");
    h.push.unregister(token("gone-again"));
    h.telegram.failSendsTo("1001", "invalid_request");

    await tellQuiet(again.seed);
    await h.run(handlers());

    expect(
      (await outboundRows())
        .filter((row) => row.kind === "quiet_notice")
        .map((row) => [row.channel, row.status]),
    ).toEqual([
      ["app", "dropped"],
      ["telegram", "failed"],
    ]);
    // Telegram's was the round's last notice, so the round-level alert says it, once.
    expect(await adminTexts()).toEqual([nobodyToldText(again.seed)]);
  });

  it("is tried again when Expo cannot take it, and the founder hears when the last try fails", async () => {
    const { seed } = await quietMorning();
    await unlinkMia(seed);
    await appOrganiser(seed, "Sam", "1002");
    h.push.failNextSends(4, { status: 503 });

    await tellQuiet(seed);
    await h.run(handlers());

    expect(h.push.sends).toHaveLength(4);
    const [row] = await appRows("quiet_notice");
    expect(row).toMatchObject({ status: "failed", attempts: 4 });
    expect(row?.error).toMatch(/^unavailable: /);
    expect(row?.error).not.toContain("PushToken");
    // Sam's phone was the round's only notice: the round told nobody.
    expect(await adminTexts()).toEqual([nobodyToldText(seed)]);
  });

  it("fails at once when Expo refuses Vela's credentials, and the founder hears that once a day", async () => {
    const { seed } = await quietMorning();
    await unlinkMia(seed);
    await appOrganiser(seed, "Sam", "1002");
    await appOrganiser(seed, "Lee", "1003");
    h.push.failNextSends(2, { status: 401 });

    await tellQuiet(seed);
    await h.run(handlers());

    expect(h.push.sends).toHaveLength(2);
    expect((await appRows("quiet_notice")).map((row) => [row.status, row.attempts])).toEqual([
      ["failed", 1],
      ["failed", 1],
    ]);
    const texts = await adminTexts();
    expect(texts.filter((text) => text === MISCONFIGURED)).toHaveLength(1);
    // Sam's fails while Lee's is still on its way, which tells of Sam; Lee's is the round's last.
    expect(texts.filter((text) => text === unheardText(seed))).toHaveLength(1);
    expect(texts.filter((text) => text === nobodyToldText(seed))).toHaveLength(1);
    expect(logged("push_misconfigured")).toHaveLength(2);
    const alert = (await outboundRows()).find((row) => textOf(row) === MISCONFIGURED);
    expect(alert?.idempotencyKey).toBe(
      outboundKey("system", {
        conversationId: ADMIN,
        suffix: `push_misconfigured:http_401:${TODAY}`,
      }),
    );
  });

  it("fails when a phone's ticket says Vela's credentials were refused, and the founder hears it", async () => {
    const { seed } = await quietMorning();
    await unlinkMia(seed);
    const sam = await appOrganiser(seed, "Sam", "1002");
    h.push.refuseTicketsTo(sam.device.token, "InvalidCredentials");

    await tellQuiet(seed);
    await h.run(handlers());

    expect((await appRows("quiet_notice")).map((row) => [row.status, row.attempts])).toEqual([
      ["failed", 1],
    ]);
    expect((await devices()).map((device) => device.id)).toEqual([sam.device.id]);
    expect((await adminTexts()).sort()).toEqual([MISCONFIGURED, nobodyToldText(seed)].sort());
  });

  it("is dropped once push is off by the time it goes, and the founder hears it unless Telegram carries it", async () => {
    const { seed } = await quietMorning();
    const miaUser = await accountOf(seed.organiser);
    await phone(miaUser, "mia");
    const sam = await appOrganiser(seed, "Sam", "1002");

    await tellQuiet(seed);
    h.deps.push = null;
    await h.run(handlers());

    expect(
      (await appRows("quiet_notice")).map((row) => [row.memberId, row.status, row.error]),
    ).toEqual([
      [seed.organiser.id, "dropped", "push_off"],
      [sam.member.id, "dropped", "push_off"],
    ]);
    // Mia's Telegram notice was on its way; Sam had nothing else.
    const quiet = await quietEvent();
    expect(await adminTexts()).toEqual([unheardText(seed)]);
    const [alert] = (await outboundRows()).filter((row) => row.conversationId === ADMIN);
    expect(alert?.idempotencyKey).toContain(`${quiet.id}%3A0%3A${sam.member.id}`);
  });
});

describe("a quiet event closing on phones", () => {
  it("tells a reader whose phone had the notice that her light is lit again, on the phone and on Telegram", async () => {
    const { seed, exchangeId } = await quietMorning();
    const miaUser = await accountOf(seed.organiser);
    const device = await phone(miaUser, "mia");
    await tellQuiet(seed);
    await h.run(handlers());
    h.push.reset();

    h.clock.advanceMinutes(20);
    await handleParentMessage(h.deps, seed.member, {
      channel: "telegram",
      eventId: "tg:answer",
      at: h.clock.now().toISOString(),
      messageId: "501",
      sender: { externalUserId: seed.memberLink.externalId },
      conversation: { externalId: seed.memberLink.externalId, kind: "private" },
      kind: "text",
      text: "In the garden",
    });
    await h.run(handlers());

    const quiet = await quietEvent();
    const closing = t("en", "quiet.resolved_answered", { name: "Mom", time: "14:20" });
    const resolved = (await outboundRows()).filter((row) => row.kind === "quiet_resolved");
    expect(resolved.map((row) => [row.channel, row.idempotencyKey, row.status])).toEqual([
      [
        "telegram",
        outboundKey("quiet_resolved", { quietEventId: quiet.id, memberId: seed.organiser.id }),
        "sent",
      ],
      [
        "app",
        outboundKey("quiet_resolved", {
          quietEventId: quiet.id,
          memberId: seed.organiser.id,
          suffix: "app",
        }),
        "sent",
      ],
    ]);
    expect(h.push.sent).toEqual([
      {
        to: device.token,
        body: closing,
        data: {
          kind: "quiet_resolved",
          family_id: seed.family.id,
          member_id: seed.member.id,
          quiet_event_id: quiet.id,
          exchange_id: exchangeId,
        },
        channelId: "quiet",
        priority: "high",
        interruptionLevel: "active",
        sound: "default",
        ttl: 12 * 60 * 60,
      },
    ]);
    // Mia asked the question, but the close has just told her: no "Mom answered you." as well.
    expect(await appRows("answer_receipt")).toEqual([]);
  });

  it("closes on the phone only for a reader whose app notice was sent", async () => {
    const { seed } = await quietMorning();
    await tellQuiet(seed);
    await h.run(handlers());
    // Mia registers a phone after the notice reached her on Telegram.
    const miaUser = await accountOf(seed.organiser);
    await phone(miaUser, "later");

    await handleParentMessage(h.deps, seed.member, {
      channel: "telegram",
      eventId: "tg:answer",
      at: h.clock.now().toISOString(),
      messageId: "501",
      sender: { externalUserId: seed.memberLink.externalId },
      conversation: { externalId: seed.memberLink.externalId, kind: "private" },
      kind: "text",
      text: "Here",
    });
    await h.run(handlers());

    expect(
      (await outboundRows())
        .filter((row) => row.kind === "quiet_resolved")
        .map((row) => row.channel),
    ).toEqual(["telegram"]);
    expect(await appRows("quiet_resolved")).toEqual([]);
  });

  it("follows a phone's notice that landed after the close with the close on the phone alone", async () => {
    const { seed } = await quietMorning();
    await unlinkMia(seed);
    const sam = await appOrganiser(seed, "Sam", "1002");
    await tellQuiet(seed);
    const [notice] = await appRows("quiet_notice");
    if (notice === undefined) throw new Error("expected Sam's notice");
    // The send is out, its effects not yet applied (D-B1), when her answer closes the event.
    await h.db
      .update(outbound)
      .set({ status: "sent", sentAt: h.clock.now(), attempts: 1, externalId: fakeTicketId(1) })
      .where(eq(outbound.id, notice.id));
    h.queues.outbound.clear();
    await handleParentMessage(h.deps, seed.member, {
      channel: "telegram",
      eventId: "tg:answer",
      at: h.clock.now().toISOString(),
      messageId: "501",
      sender: { externalUserId: seed.memberLink.externalId },
      conversation: { externalId: seed.memberLink.externalId, kind: "private" },
      kind: "text",
      text: "Here",
    });
    expect(await appRows("quiet_resolved")).toEqual([]);

    await deliverOutbound(h.deps, notice.id);
    await h.run(handlers());

    const resolved = (await outboundRows()).filter((row) => row.kind === "quiet_resolved");
    expect(resolved.map((row) => [row.channel, row.memberId, row.status])).toEqual([
      ["app", sam.member.id, "sent"],
    ]);
  });
});

describe("the answer receipt", () => {
  /** Mia asked today's question; it reached Mom at 08:00 and it is now 08:12. */
  async function askedMorning(options: { type?: "question" | "hello"; oneMoment?: boolean } = {}) {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, {
      date: TODAY,
      type: options.type ?? "question",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const miaUser = await accountOf(seed.organiser, options.oneMoment ?? true);
    const device = await phone(miaUser, "mia", { quietChannelBlocked: true });
    h.clock.advanceMinutes(12);
    return { seed, exchangeId: exchange.id, miaUser, device };
  }

  async function herAnswer(seed: SeededFamily): Promise<void> {
    await handleParentMessage(h.deps, seed.member, {
      channel: "telegram",
      eventId: `tg:${h.clock.now().getTime()}`,
      at: h.clock.now().toISOString(),
      messageId: String(h.clock.now().getTime()),
      sender: { externalUserId: seed.memberLink.externalId },
      conversation: { externalId: seed.memberLink.externalId, kind: "private" },
      kind: "text",
      text: "Soup",
    });
    await h.run(handlers());
  }

  it("tells whoever asked that she answered, silently, on the daily channel, even with the quiet channel blocked", async () => {
    const { seed, exchangeId, miaUser, device } = await askedMorning();

    await herAnswer(seed);

    const [row] = await appRows("answer_receipt");
    expect(row).toMatchObject({
      idempotencyKey: outboundKey("answer_receipt", { exchangeId }),
      memberId: seed.organiser.id,
      conversationId: miaUser,
      localDay: TODAY,
      status: "sent",
    });
    expect(h.push.sent).toEqual([
      {
        to: device.token,
        body: t("en", "push.answer_receipt", { name: "Mom" }),
        data: {
          kind: "answer_receipt",
          family_id: seed.family.id,
          member_id: seed.member.id,
          exchange_id: exchangeId,
        },
        channelId: "daily",
        priority: "normal",
        interruptionLevel: "active",
        ttl: 12 * 60 * 60,
      },
    ]);
  });

  it("is not written for a hello, with One moment a day off, for an asker without an account, or while push is off", async () => {
    const hello = await askedMorning({ type: "hello" });
    await herAnswer(hello.seed);
    expect(await appRows()).toEqual([]);

    await h.reset();
    const off = await askedMorning({ oneMoment: false });
    await herAnswer(off.seed);
    expect(await appRows()).toEqual([]);

    await h.reset();
    const noAccount = await askedMorning();
    await h.db
      .update(members)
      .set({ userId: null })
      .where(eq(members.id, noAccount.seed.organiser.id));
    await herAnswer(noAccount.seed);
    expect(await appRows()).toEqual([]);

    await h.reset();
    h.deps.push = null;
    const pushOff = await askedMorning();
    await herAnswer(pushOff.seed);
    expect(await appRows()).toEqual([]);
    expect(logged("after_light_failed")).toEqual([]);
  });

  it("is dropped outside the reader's waking hours, and the dropped row leaves the day's budget free", async () => {
    const { seed, exchangeId, miaUser } = await askedMorning();
    const reader = { member: { ...seed.organiser, userId: miaUser }, userId: miaUser };
    h.clock.set(at(TODAY, "21:30"));

    await enqueueOutbound(h.deps, h.db, answerReceiptPush({ reader, exchangeId, herName: "Mom" }));
    await h.run(handlers());

    expect((await appRows("answer_receipt")).map((row) => [row.status, row.error])).toEqual([
      ["dropped", "quiet_hours"],
    ]);
    expect(h.push.sent).toEqual([]);

    const other = await seedExchange(h.db, seed, { date: "2026-09-13", state: "delivered" });
    expect(
      await enqueueOutbound(
        h.deps,
        h.db,
        answerReceiptPush({ reader, exchangeId: other.id, herName: "Mom" }),
      ),
    ).toMatchObject({ outboundId: expect.any(String) });
  });

  it("is dropped once One moment a day is off by the time it goes", async () => {
    const { seed, exchangeId, miaUser } = await askedMorning();
    const reader = { member: { ...seed.organiser, userId: miaUser }, userId: miaUser };
    await enqueueOutbound(h.deps, h.db, answerReceiptPush({ reader, exchangeId, herName: "Mom" }));
    await h.db.update(users).set({ oneMomentADay: false }).where(eq(users.id, miaUser));

    await h.run(handlers());

    expect((await appRows("answer_receipt")).map((row) => [row.status, row.error])).toEqual([
      ["dropped", "one_moment_off"],
    ]);
    expect(h.push.sent).toEqual([]);
  });

  it("keeps to one a day, logging the budget's refusal apart from a replay", async () => {
    const { seed, exchangeId, miaUser } = await askedMorning();
    const reader = { member: { ...seed.organiser, userId: miaUser }, userId: miaUser };
    const other = await seedExchange(h.db, seed, { date: "2026-09-13", state: "delivered" });

    const first = await enqueueOutbound(
      h.deps,
      h.db,
      answerReceiptPush({ reader, exchangeId, herName: "Mom" }),
    );
    const replay = await enqueueOutbound(
      h.deps,
      h.db,
      answerReceiptPush({ reader, exchangeId, herName: "Mom" }),
    );
    const second = await enqueueOutbound(
      h.deps,
      h.db,
      answerReceiptPush({ reader, exchangeId: other.id, herName: "Mom" }),
    );

    expect(first).toMatchObject({ outboundId: expect.any(String) });
    expect(replay).toEqual({ duplicate: true });
    expect(second).toEqual({ duplicate: true });
    expect(logged("outbound_duplicate")).toEqual([
      expect.objectContaining({ fields: { kind: "answer_receipt", memberId: seed.organiser.id } }),
    ]);
    expect(logged("outbound_budget_refused")).toEqual([
      expect.objectContaining({
        level: "warn",
        fields: { kind: "answer_receipt", memberId: seed.organiser.id, channel: "app" },
      }),
    ]);
  });
});

describe("the evening turn without a group", () => {
  it("tells the first organiser's phone that tomorrow is theirs, once, with tomorrow's suggestion, and keeps no message id", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const miaUser = await accountOf(seed.organiser);
    const device = await phone(miaUser, "mia");
    const [suggestion] = await h.db
      .insert(suggestions)
      .values({
        familyId: seed.family.id,
        aboutMemberId: seed.member.id,
        localDay: TOMORROW,
        bankId: "life.childhood.home",
        type: "question",
        text: "",
        promptVersion: "bank.v1",
      })
      .returning();

    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);
    await sendTurnPrompt(h.deps, seed.member.id, TOMORROW);
    await h.run(handlers());

    const rows = await appRows("turn_prompt");
    expect(rows.map((row) => [row.idempotencyKey, row.memberId, row.status])).toEqual([
      [
        outboundKey("turn_prompt", { memberId: seed.member.id, date: TOMORROW }),
        seed.organiser.id,
        "sent",
      ],
    ]);
    expect(h.push.sent).toEqual([
      {
        to: device.token,
        body: t("en", "push.turn_prompt", { name: "Mom" }),
        data: {
          kind: "turn_prompt",
          family_id: seed.family.id,
          member_id: seed.member.id,
          suggestion_id: suggestion?.id,
        },
        channelId: "daily",
        priority: "normal",
        interruptionLevel: "active",
        ttl: 12 * 60 * 60,
      },
    ]);
    const [turn] = await h.db.select().from(turns);
    expect(turn).toMatchObject({ holderId: seed.organiser.id, promptMessageId: null });
  });

  it("writes nothing for phones in a family with a group, while push is off, or with One moment a day off", async () => {
    const grouped = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, grouped, { now: h.clock.now() });
    await phone(await accountOf(grouped.organiser), "grouped");
    await sendTurnPrompt(h.deps, grouped.member.id, TOMORROW);
    expect(await appRows()).toEqual([]);

    await h.reset();
    const off = await seedFamily(h.db, { now: h.clock.now() });
    await phone(await accountOf(off.organiser, false), "off");
    await sendTurnPrompt(h.deps, off.member.id, TOMORROW);
    expect(await appRows()).toEqual([]);

    await h.reset();
    h.deps.push = null;
    const pushOff = await seedFamily(h.db, { now: h.clock.now() });
    await phone(await accountOf(pushOff.organiser), "push-off");
    await sendTurnPrompt(h.deps, pushOff.member.id, TOMORROW);
    expect(await appRows()).toEqual([]);
    expect(await h.db.select().from(turns)).toHaveLength(1);
  });
});

describe("receipts", () => {
  /** An answer receipt Expo took for both of Mia's phones at 08:12. */
  async function sentToTwoPhones() {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, { date: TODAY, state: "delivered" });
    const miaUser = await accountOf(seed.organiser);
    const first = await phone(miaUser, "first");
    const second = await phone(miaUser, "second");
    h.clock.advanceMinutes(12);
    await enqueueOutbound(
      h.deps,
      h.db,
      answerReceiptPush({
        reader: { member: { ...seed.organiser, userId: miaUser }, userId: miaUser },
        exchangeId: exchange.id,
        herName: "Mom",
      }),
    );
    await h.run(handlers());
    const ids = (await tickets()).map((ticket) => ticket.id);
    const byToken = new Map([...h.push.tickets].map(([id, message]) => [message.to, id]));
    return {
      seed,
      miaUser,
      first,
      second,
      ids,
      firstTicket: byToken.get(first.token) ?? "",
      secondTicket: byToken.get(second.token) ?? "",
    };
  }

  it("asks nothing for fifteen minutes, then deletes the tickets whose receipts came back and asks again for the rest", async () => {
    const { firstTicket, secondTicket } = await sentToTwoPhones();
    h.push.receiptFor(secondTicket, null);

    h.clock.advanceMinutes(10);
    expect(await checkPushReceipts(h.deps, emit)).toMatchObject({ asked: 0 });
    expect(h.push.receiptRequests).toEqual([]);

    h.clock.advanceMinutes(5);
    expect(await checkPushReceipts(h.deps, emit)).toEqual({
      asked: 2,
      ok: 1,
      refused: 0,
      waiting: 1,
      missing: 0,
    });
    expect((await tickets()).map((ticket) => ticket.id)).toEqual([secondTicket]);

    h.push.receiptFor(secondTicket, { status: "ok" });
    h.clock.advanceMinutes(15);
    expect(await checkPushReceipts(h.deps, emit)).toMatchObject({ asked: 1, ok: 1 });
    expect(h.push.receiptRequests.map((ids) => [...ids].sort())).toEqual([
      [firstTicket, secondTicket].sort(),
      [secondTicket],
    ]);
    expect(await tickets()).toEqual([]);
  });

  it("gives up on a ticket a day old with no receipt, and logs it", async () => {
    const { firstTicket, secondTicket, first } = await sentToTwoPhones();
    h.push.receiptFor(firstTicket, null);
    h.push.receiptFor(secondTicket, null);

    h.clock.advanceMinutes(24 * 60);
    expect(await checkPushReceipts(h.deps, emit)).toMatchObject({ asked: 0, missing: 2 });

    expect(h.push.receiptRequests).toEqual([]);
    expect(await tickets()).toEqual([]);
    expect(logged("push_receipt_missing")).toContainEqual(
      expect.objectContaining({
        level: "warn",
        fields: expect.objectContaining({ kind: "answer_receipt", deviceId: first.id }),
      }),
    );
  });

  it("deletes a phone Apple says is gone while it holds that token, and not once the app has registered a new one", async () => {
    const { first, second, firstTicket, secondTicket } = await sentToTwoPhones();
    const gone = pushFailureFor("DeviceNotRegistered");
    h.push.receiptFor(firstTicket, { status: "error", failure: gone });
    h.push.receiptFor(secondTicket, { status: "error", failure: gone });
    // The app on the second phone has registered a new token since the push.
    await h.db
      .update(pushDevices)
      .set({ token: token("second-refreshed") })
      .where(eq(pushDevices.id, second.id));

    h.clock.advanceMinutes(15);
    expect(await checkPushReceipts(h.deps, emit)).toMatchObject({ asked: 2, refused: 2 });

    expect((await devices()).map((device) => [device.id, device.token])).toEqual([
      [second.id, token("second-refreshed")],
    ]);
    expect(first.id).not.toBe(second.id);
    expect(await tickets()).toEqual([]);
    // Mia is still reachable on Telegram: nobody to warn about.
    expect(await adminTexts()).toEqual([]);
  });

  it("tells the founder when a quiet notice's receipt says it reached no phone, whatever the refusal", async () => {
    const { seed } = await quietMorning();
    await unlinkMia(seed);
    const sam = await appOrganiser(seed, "Sam", "1002");
    const lee = await appOrganiser(seed, "Lee", "1003");
    await tellQuiet(seed);
    await h.run(handlers());
    const bySam = [...h.push.tickets].find(([, message]) => message.to === sam.device.token)?.[0];
    const byLee = [...h.push.tickets].find(([, message]) => message.to === lee.device.token)?.[0];
    if (bySam === undefined || byLee === undefined) throw new Error("expected two tickets");
    h.push.receiptFor(bySam, {
      status: "error",
      failure: pushFailureFor("DeviceNotRegistered"),
    });
    h.push.receiptFor(byLee, { status: "error", failure: pushFailureFor("MessageRateExceeded") });

    h.clock.advanceMinutes(15);
    await checkPushReceipts(h.deps, emit);

    // Sam's phone is gone; Lee's is kept, but neither heard the notice. Lee can still be told.
    expect((await devices()).map((device) => device.id)).toEqual([lee.device.id]);
    const quiet = await quietEvent();
    const alerts = (await outboundRows()).filter((row) => row.conversationId === ADMIN);
    expect(alerts.map((row) => [row.idempotencyKey, textOf(row)])).toEqual(
      [sam.member.id, lee.member.id].map((readerId) => [
        outboundKey("system", {
          conversationId: ADMIN,
          suffix: `quiet_nobody_told:${quiet.id}:0:${readerId}`,
        }),
        unheardText(seed),
      ]),
    );
  });

  it("tells the founder when a phone found gone at its receipt leaves the family with nobody to tell", async () => {
    const { seed } = await quietMorning();
    await unlinkMia(seed);
    const sam = await appOrganiser(seed, "Sam", "1002");
    await tellQuiet(seed);
    await h.run(handlers());
    h.push.receiptFor(fakeTicketId(1), {
      status: "error",
      failure: pushFailureFor("DeviceNotRegistered"),
    });

    h.clock.advanceMinutes(15);
    await checkPushReceipts(h.deps, emit);

    expect(await devices()).toEqual([]);
    expect((await adminTexts()).sort()).toEqual(
      [unheardText(seed), unreachableText(seed, "Sam")].sort(),
    );
    expect(logged("push_device_gone")).toEqual([
      expect.objectContaining({ fields: { deviceId: sam.device.id, by: "receipt" } }),
    ]);
  });

  it("stays silent about a quiet notice whose receipt is refused once Telegram has carried it", async () => {
    const { seed } = await quietMorning();
    const miaUser = await accountOf(seed.organiser);
    await phone(miaUser, "mia");
    await tellQuiet(seed);
    await h.run(handlers());
    h.push.receiptFor(fakeTicketId(1), {
      status: "error",
      failure: pushFailureFor("DeviceNotRegistered"),
    });

    h.clock.advanceMinutes(15);
    await checkPushReceipts(h.deps, emit);

    expect(await devices()).toEqual([]);
    expect(await adminTexts()).toEqual([]);
  });

  it("marks a quiet notice no phone took, so the founder hears when the round's Telegram notice waiting for a retry then fails for good", async () => {
    const { seed } = await quietMorning();
    const miaUser = await accountOf(seed.organiser);
    await phone(miaUser, "mia");
    h.telegram.failSendsTo("1001", "unavailable");

    await tellQuiet(seed);
    // The phone's notice goes; Telegram's fails and waits five minutes for its next try.
    await h.runDue(handlers());
    expect(
      (await outboundRows())
        .filter((row) => row.kind === "quiet_notice")
        .map((row) => [row.channel, row.status, row.attempts]),
    ).toEqual([
      ["app", "sent", 1],
      ["telegram", "queued", 1],
    ]);

    // The phone was uninstalled: its receipt says so while Telegram's retry still waits.
    h.push.receiptFor(fakeTicketId(1), {
      status: "error",
      failure: pushFailureFor("DeviceNotRegistered"),
    });
    h.clock.advanceMinutes(15);
    await checkPushReceipts(h.deps, emit);
    const [notice] = await appRows("quiet_notice");
    expect(notice).toMatchObject({ status: "sent", error: "push_unheard:DeviceNotRegistered" });
    expect(await adminTexts()).toEqual([]);

    // Telegram's last try fails: nothing of the round reached Mia, and the founder hears it once.
    await h.run(handlers());
    const quiet = await quietEvent();
    const rows = (await outboundRows()).filter((row) => row.kind === "quiet_notice");
    expect(rows.map((row) => [row.channel, row.status])).toEqual([
      ["app", "sent"],
      ["telegram", "failed"],
    ]);
    const alerts = (await outboundRows()).filter((row) => row.conversationId === ADMIN);
    expect(alerts.map((row) => [row.idempotencyKey, textOf(row)])).toEqual([
      [
        outboundKey("system", {
          conversationId: ADMIN,
          suffix: `quiet_nobody_told:${quiet.id}:0:${seed.organiser.id}`,
        }),
        unheardText(seed),
      ],
    ]);
  });

  it("tells the founder once a day when receipts say Vela's credentials were refused", async () => {
    const { firstTicket, secondTicket } = await sentToTwoPhones();
    const refused = { status: "error" as const, failure: pushFailureFor("InvalidCredentials") };
    h.push.receiptFor(firstTicket, refused);
    h.push.receiptFor(secondTicket, refused);

    h.clock.advanceMinutes(15);
    await checkPushReceipts(h.deps, emit);

    expect(await adminTexts()).toEqual([MISCONFIGURED]);
    expect(await devices()).toHaveLength(2);
    expect(await tickets()).toEqual([]);
  });

  it("reads receipts in reconcile after the heartbeat, and a check that fails changes nothing else", async () => {
    const { firstTicket } = await sentToTwoPhones();
    h.clock.advanceMinutes(15);
    h.push.failNextReceipts(1, { status: 503 });

    await reconcile(h.deps);

    expect(h.heartbeat.pings).toBe(1);
    expect(logged("push_receipts_failed")).toHaveLength(1);
    expect(await tickets()).toHaveLength(2);

    h.push.failNextReceipts(1, { status: 401 });
    await reconcile(h.deps);
    expect(h.heartbeat.pings).toBe(2);
    expect(logged("push_receipts_failed")).toHaveLength(2);
    expect(await adminTexts()).toEqual([MISCONFIGURED]);

    await reconcile(h.deps);
    expect(h.push.receiptRequests.at(-1)).toContain(firstTicket);
    expect(await tickets()).toEqual([]);
  });

  it("asks about the thousand oldest tickets a run", async () => {
    const { ids } = await sentToTwoPhones();
    const [newest] = await tickets();
    if (newest === undefined) throw new Error("expected a ticket");
    const older = Array.from({ length: RECEIPTS_PER_RUN }, (_, index) => ({
      id: `older-${String(index).padStart(4, "0")}`,
      deviceId: newest.deviceId,
      tokenSha256: newest.tokenSha256,
      outboundId: newest.outboundId,
      createdAt: new Date(newest.createdAt.getTime() - (index + 1) * MINUTE),
    }));
    await h.db.insert(pushTickets).values(older);

    h.clock.advanceMinutes(15);
    await checkPushReceipts(h.deps, emit);

    const [asked] = h.push.receiptRequests;
    expect(asked).toHaveLength(RECEIPTS_PER_RUN);
    for (const id of ids) {
      expect(asked).not.toContain(id);
    }
  });

  it("asks nothing while push is off", async () => {
    await sentToTwoPhones();
    h.deps.push = null;
    h.clock.advanceMinutes(15);

    expect(await checkPushReceipts(h.deps, emit)).toMatchObject({ asked: 0 });
    expect(h.push.receiptRequests).toEqual([]);
    expect(await tickets()).toHaveLength(2);
  });
});

describe("tickets", () => {
  it("keeps none for a phone deleted between the send and its record, and the record still commits", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const miaUser = await accountOf(seed.organiser);
    const device = await phone(miaUser, "mia");
    const exchange = await seedExchange(h.db, seed, { date: TODAY, state: "delivered" });
    const inserted = await insertOutbound(
      h.deps,
      h.db,
      answerReceiptPush({
        reader: { member: { ...seed.organiser, userId: miaUser }, userId: miaUser },
        exchangeId: exchange.id,
        herName: "Mom",
      }),
    );
    if (!("outboundId" in inserted)) throw new Error("expected a row");
    const ticket = {
      id: fakeTicketId(1),
      deviceId: device.id,
      tokenSha256: await sha256Hex(device.token),
      outboundId: inserted.outboundId,
      createdAt: h.clock.now(),
    };
    await h.db.delete(pushDevices).where(eq(pushDevices.id, device.id));

    await h.db.transaction((tx) => recordPushTickets(tx, [ticket]));

    expect(await tickets()).toEqual([]);
  });

  it("are deleted two days after their send", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const miaUser = await accountOf(seed.organiser);
    await phone(miaUser, "mia");
    const exchange = await seedExchange(h.db, seed, { date: TODAY, state: "delivered" });
    await enqueueOutbound(
      h.deps,
      h.db,
      answerReceiptPush({
        reader: { member: { ...seed.organiser, userId: miaUser }, userId: miaUser },
        exchangeId: exchange.id,
        herName: "Mom",
      }),
    );
    await h.run(handlers());
    const [original] = await tickets();
    if (original === undefined) throw new Error("expected a ticket");
    await h.db.insert(pushTickets).values({
      ...original,
      id: "older",
      createdAt: new Date(original.createdAt.getTime() - 2 * 24 * 60 * MINUTE),
    });
    h.clock.advanceMinutes(60);

    const counts = await applyRetention(h.deps);

    expect(counts.push_tickets_deleted).toBe(1);
    expect((await tickets()).map((ticket) => ticket.id)).toEqual([original.id]);
  });
});

describe("who can be told", () => {
  it("counts an organiser's phone only while push is on, notifications are allowed, the quiet channel is on, and the account lives", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await h.db
      .update(channelLinks)
      .set({ blockedAt: h.clock.now() })
      .where(eq(channelLinks.id, seed.organiserLink.id));
    const sam = await appOrganiser(seed, "Sam", "1002");
    const alert = () => organisersUnreachableAlert(h.deps, h.db, seed.organiser.id, "blocked:test");

    expect(await alert()).toBeNull();

    h.deps.push = null;
    expect(await alert()).toMatchObject({ kind: "system", conversationId: ADMIN });
    h.deps.push = h.push;

    for (const patch of [
      { permission: "denied" as const },
      { permission: "provisional" as const },
      { quietChannelBlocked: true },
    ]) {
      await h.db.update(pushDevices).set(patch).where(eq(pushDevices.id, sam.device.id));
      expect(await alert(), JSON.stringify(patch)).toMatchObject({ kind: "system" });
      await h.db
        .update(pushDevices)
        .set({ permission: "granted", quietChannelBlocked: false })
        .where(eq(pushDevices.id, sam.device.id));
    }
    expect(await alert()).toBeNull();

    await h.db.update(users).set({ deletedAt: h.clock.now() }).where(eq(users.id, sam.userId));
    expect(await alert()).toMatchObject({ kind: "system" });
    await h.db.update(users).set({ deletedAt: null }).where(eq(users.id, sam.userId));
    await h.db
      .update(members)
      .set({ status: "left", leftAt: h.clock.now() })
      .where(eq(members.id, sam.member.id));
    expect(await alert()).toMatchObject({ kind: "system" });
  });

  // The page tells the founder, who marked Mia left (flows §3.17); the admin chat hears nothing.
  it("answers the founder that nobody is left to tell when Mia, marked left, was the last Telegram could reach while push is off, whatever Sam's phone allows", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await appOrganiser(seed, "Sam", "1002");
    const founder = { admin: "founder@vela.test" };

    // Push on: Sam's phone can be told, so nobody is missing.
    expect(await markLeft(h.deps, founder, seed.organiser.id)).toBe("done");

    // Push off, as the admin Worker hands services (`push: null`): Sam's phone counts for nothing.
    await h.reset();
    h.deps.push = null;
    const again = await seedFamily(h.db, { now: h.clock.now() });
    await appOrganiser(again, "Sam", "1002");

    expect(await markLeft(h.deps, founder, again.organiser.id)).toBe("nobody_to_tell");
    expect(await adminTexts()).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------

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
