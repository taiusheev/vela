import type { InboundEvent, LocalDate } from "@vela/contracts";
import { decodeButton, encodeButton, outboundKey, TUNING } from "@vela/core";
import { type ChannelLink, events, exchanges, members, outbound, quietEvents } from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { handleQuietButton, notifyQuiet, openQuiet, resolveQuietOnAnswer } from "./quiet.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedNearbyContact,
} from "./testing/seed.ts";

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

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

interface Scene {
  seed: SeededFamily;
  second: { member: SeededFamily["organiser"]; link: ChannelLink };
  exchangeId: string;
}

/** Her morning went out at 08:00 Taipei (the clock's start) and the clock now stands at T_quiet. */
async function quietMorning(): Promise<Scene> {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  const second = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: "1002",
    role: "organiser",
  });
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    state: "delivered",
    deliveredAt: h.clock.now(),
  });
  h.clock.advanceMinutes(TUNING.defaultQuietAfterMinutes);
  return { seed, second, exchangeId: exchange.id };
}

async function quietRows() {
  return h.db.select().from(quietEvents);
}

async function noticeRows() {
  return h.db
    .select()
    .from(outbound)
    .where(eq(outbound.kind, "quiet_notice"))
    .orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function resolvedRows() {
  return h.db
    .select()
    .from(outbound)
    .where(eq(outbound.kind, "quiet_resolved"))
    .orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function eventNames(): Promise<string[]> {
  const rows = await h.db.select({ name: events.name }).from(events).orderBy(asc(events.id));
  return rows.map((row) => row.name);
}

let taps = 0;

function tap(
  link: ChannelLink,
  quietEventId: string,
  type: "quiet_fine" | "quiet_wait",
): InboundEvent {
  taps += 1;
  return {
    channel: "telegram",
    eventId: `tg:${taps}`,
    at: h.clock.now().toISOString(),
    kind: "button",
    sender: { externalUserId: link.externalId },
    conversation: { externalId: link.externalId, kind: "private" },
    messageId: "1",
    buttonData: encodeButton({ type, quietEventId }),
    callbackId: `cb${taps}`,
  };
}

describe("openQuiet", () => {
  it("opens the event and, with notify, tells every organiser in one transaction", async () => {
    const { seed, second, exchangeId } = await quietMorning();

    await openQuiet(h.deps, seed.member.id, TODAY, true);

    const [quiet] = await quietRows();
    expect(quiet).toMatchObject({
      exchangeId,
      memberId: seed.member.id,
      openedAt: h.clock.now(),
      lastNotifiedAt: h.clock.now(),
      notifyCount: 0,
      resolvedAt: null,
    });
    const notices = await noticeRows();
    expect(notices.map((row) => [row.memberId, row.conversationId, row.idempotencyKey])).toEqual([
      [
        seed.organiser.id,
        seed.organiserLink.externalId,
        outboundKey("quiet_notice", {
          quietEventId: quiet?.id ?? "",
          memberId: seed.organiser.id,
          suffix: "0",
        }),
      ],
      [
        second.member.id,
        second.link.externalId,
        outboundKey("quiet_notice", {
          quietEventId: quiet?.id ?? "",
          memberId: second.member.id,
          suffix: "0",
        }),
      ],
    ]);
    expect(h.queues.outbound.pending).toHaveLength(2);
  });

  it("writes the notice from her rhythm: no usual time yet, her name, the delivery time, two buttons", async () => {
    const { seed } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());

    const [notice] = h.telegram.sentTo(seed.organiserLink.externalId);
    expect(notice?.message.text).toBe(
      "It's been quiet at Mom's today. The morning message went out at 08:00. Nothing worrying is known.",
    );
    const [quiet] = await quietRows();
    const buttons = notice?.message.buttons?.flat() ?? [];
    expect(buttons.map((button) => [decodeButton(button.id), button.label])).toEqual([
      [{ type: "quiet_fine", quietEventId: quiet?.id }, "Mom is fine, I know why"],
      [{ type: "quiet_wait", quietEventId: quiet?.id }, "Wait 2 hours"],
    ]);
    expect(quiet?.notifyCount).toBe(1);
    expect(quiet?.notifiedMemberIds).toEqual(expect.arrayContaining([seed.organiser.id]));
    expect(await eventNames()).toEqual(["quiet_notice_sent", "quiet_notice_sent"]);
  });

  it("gives her usual answer time once her rhythm is known", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    // Fourteen answered days at 09:00 Taipei, then today's unanswered morning.
    for (let day = 1; day <= TUNING.minSamples; day += 1) {
      const date = `2026-08-${String(day).padStart(2, "0")}`;
      await seedExchange(h.db, seed, {
        date,
        state: "answered",
        deliveredAt: new Date(`${date}T00:00:00Z`),
        answeredAt: new Date(`${date}T01:00:00Z`),
      });
    }
    await seedExchange(h.db, seed, { date: TODAY, state: "delivered", deliveredAt: h.clock.now() });
    h.clock.advanceMinutes(TUNING.defaultQuietAfterMinutes);

    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());

    const [notice] = h.telegram.sentTo(seed.organiserLink.externalId);
    expect(notice?.message.text).toBe(
      "It's been quiet at Mom's today. The morning message went out at 08:00; Mom usually answers by 09:00. Nothing worrying is known.",
    );
  });

  it("lists only the nearby contacts who said yes, and no line when none did", async () => {
    const { seed } = await quietMorning();
    await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Anna",
      answer: { yes: { phone: "+886912000001" } },
    });
    await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Bob",
      answer: null,
    });
    await seedNearbyContact(h.db, seed, {
      now: h.clock.now(),
      name: "Cara",
      answer: "no",
    });

    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());

    const [notice] = h.telegram.sentTo(seed.organiserLink.externalId);
    expect(notice?.message.text).toContain("\n\nNearby: Anna +886912000001");
    expect(notice?.message.text).not.toContain("Bob");
    expect(notice?.message.text).not.toContain("+886912000002");
    expect(notice?.message.text).not.toContain("Cara");
    expect(notice?.message.text).not.toContain("+886912000003");
  });

  it("opens silently in the learning period and opens once however often it is asked", async () => {
    const { seed } = await quietMorning();

    await openQuiet(h.deps, seed.member.id, TODAY, false);
    await openQuiet(h.deps, seed.member.id, TODAY, true);

    const rows = await quietRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastNotifiedAt).toBeNull();
    expect(await noticeRows()).toHaveLength(0);
  });

  it("opens nothing for a morning that was never delivered", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedExchange(h.db, seed, { date: TODAY, state: "scheduled" });

    await openQuiet(h.deps, seed.member.id, TODAY, true);

    expect(await quietRows()).toHaveLength(0);
    expect(await noticeRows()).toHaveLength(0);
  });

  // The schedule decides from state read before the transaction opens, so her answer can land
  // between that read and this insert; an answered morning is never quiet, and an event opened
  // after her answer would stay open, since only the answer's own transaction resolves one.
  it("opens nothing when she answered after the schedule decided", async () => {
    const { seed, exchangeId } = await quietMorning();
    await h.db
      .update(exchanges)
      .set({ state: "answered", answeredAt: h.clock.now() })
      .where(eq(exchanges.id, exchangeId));

    await openQuiet(h.deps, seed.member.id, TODAY, true);

    expect(await quietRows()).toHaveLength(0);
    expect(await noticeRows()).toHaveLength(0);
  });
});

describe("notifyQuiet", () => {
  it("tells the organisers once after a silent opening, and not again in the same round", async () => {
    const { seed } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, false);
    h.clock.advanceMinutes(120);

    await notifyQuiet(h.deps, seed.member.id, TODAY);
    await notifyQuiet(h.deps, seed.member.id, TODAY);

    expect(await noticeRows()).toHaveLength(2);
    const [quiet] = await quietRows();
    expect(quiet?.lastNotifiedAt).toEqual(h.clock.now());
    await h.run(handlers());
    expect(h.telegram.sent).toHaveLength(2);
  });

  it("re-notifies after a wait with a new key, and not before the wait has passed", async () => {
    const { seed, exchangeId } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());
    const [quiet] = await quietRows();
    if (quiet === undefined) {
      throw new Error("quiet event not opened");
    }
    h.clock.advanceMinutes(5);

    await handleQuietButton(h.deps, tap(seed.organiserLink, quiet.id, "quiet_wait"), {
      type: "quiet_wait",
      quietEventId: quiet.id,
    });

    const waitUntil = new Date(h.clock.now().getTime() + 120 * 60_000);
    const [waiting] = await quietRows();
    expect(waiting?.waitUntil).toEqual(waitUntil);
    expect(waiting?.resolvedAt).toBeNull();
    expect(h.telegram.closed).toEqual([
      {
        conversationId: seed.organiserLink.externalId,
        messageId: "1",
        replacementText: "I'll look again at 16:05.",
      },
    ]);
    expect(h.telegram.acknowledged).toHaveLength(1);
    expect(h.scheduler.wakes.get(seed.member.id)).toEqual(h.clock.now());
    // Stamped on the row too, so reconcile picks the wait up should the alarm never fire.
    const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her?.nextWakeAt).toEqual(h.clock.now());

    h.clock.advanceMinutes(119);
    await notifyQuiet(h.deps, seed.member.id, TODAY);
    expect(await noticeRows()).toHaveLength(2);

    h.clock.advanceMinutes(1);
    await notifyQuiet(h.deps, seed.member.id, TODAY);
    const notices = await noticeRows();
    expect(notices).toHaveLength(4);
    expect(notices.map((row) => row.idempotencyKey.split(":").at(-1))).toEqual([
      "0",
      "0",
      "1",
      "1",
    ]);
    await h.run(handlers());
    const [again] = await quietRows();
    expect(again?.notifyCount).toBe(2);
    expect(again?.exchangeId).toBe(exchangeId);
    expect(h.telegram.sentTo(seed.organiserLink.externalId)).toHaveLength(2);
  });
});

describe("resolveQuietOnAnswer", () => {
  it("closes the open event as answered late and tells everyone who was told", async () => {
    const { seed, second, exchangeId } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());
    h.clock.advanceMinutes(40);

    await h.db.transaction((tx) => resolveQuietOnAnswer(h.deps, tx, exchangeId));

    const [quiet] = await quietRows();
    expect(quiet?.resolvedAt).toEqual(h.clock.now());
    expect(quiet?.outcome).toBe("answered_late");
    const told = await resolvedRows();
    expect(told.map((row) => row.memberId).sort()).toEqual(
      [seed.organiser.id, second.member.id].sort(),
    );
    await h.run(handlers());
    const [message] = h.telegram.sentTo(second.link.externalId).slice(-1);
    expect(message?.message.text).toBe("Mom answered at 14:40. Everything is lit again.");
    expect(await eventNames()).toContain("quiet_notice_resolved");
  });

  it("does nothing when no event is open, and nothing twice", async () => {
    const { seed, exchangeId } = await quietMorning();
    await h.db.transaction((tx) => resolveQuietOnAnswer(h.deps, tx, exchangeId));
    expect(await resolvedRows()).toHaveLength(0);

    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());
    await h.db.transaction((tx) => resolveQuietOnAnswer(h.deps, tx, exchangeId));
    await h.db.transaction((tx) => resolveQuietOnAnswer(h.deps, tx, exchangeId));

    // One message per organiser who was told (the scene has two), and no second round.
    const [quiet] = await quietRows();
    const told = await resolvedRows();
    expect(told).toHaveLength(2);
    expect(told.map((row) => row.memberId).sort()).toEqual(
      [...(quiet?.notifiedMemberIds ?? [])].sort(),
    );
    expect((await eventNames()).filter((name) => name === "quiet_notice_resolved")).toHaveLength(1);
  });

  it("drops the notices still queued when her answer closes the event first", async () => {
    const { seed, second, exchangeId } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    // She answers in the seconds before the queue delivers either notice.
    h.clock.advanceMinutes(2);
    await h.db.transaction((tx) => resolveQuietOnAnswer(h.deps, tx, exchangeId));

    await h.run(handlers());

    // Nobody hears she is quiet after she answered: the notices are moot, not late.
    expect(h.telegram.sentTo(seed.organiserLink.externalId)).toEqual([]);
    expect(h.telegram.sentTo(second.link.externalId)).toEqual([]);
    expect((await noticeRows()).map((row) => [row.status, row.error])).toEqual([
      ["dropped", "quiet_resolved"],
      ["dropped", "quiet_resolved"],
    ]);
    expect(await resolvedRows()).toEqual([]);
  });

  it("tells an organiser whose notice was on its way when her answer closed the event", async () => {
    const { seed, second, exchangeId } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    // Mia's notice has gone out, and its effect — which adds her to those told — has not run yet:
    // the window a check before sending cannot close. Sam's is still queued.
    await h.db
      .update(outbound)
      .set({ status: "sent", sentAt: h.clock.now(), externalId: "900" })
      .where(eq(outbound.memberId, seed.organiser.id));
    h.clock.advanceMinutes(2);
    await h.db.transaction((tx) => resolveQuietOnAnswer(h.deps, tx, exchangeId));

    await h.run(handlers());

    // Mia read that her mother is quiet, so she hears at once that she answered; Sam hears nothing.
    expect(
      h.telegram.sentTo(seed.organiserLink.externalId).map((sent) => sent.message.text),
    ).toEqual(["Mom answered at 14:02. Everything is lit again."]);
    expect(h.telegram.sentTo(second.link.externalId)).toEqual([]);
    expect((await resolvedRows()).map((row) => row.memberId)).toEqual([seed.organiser.id]);
    const [quiet] = await quietRows();
    expect(quiet?.notifiedMemberIds).toEqual([seed.organiser.id]);
  });
});

describe("handleQuietButton with 'she's fine'", () => {
  it("resolves the event, closes the buttons with the choice, and tells the other organisers", async () => {
    const { seed, second } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());
    const [quiet] = await quietRows();
    if (quiet === undefined) {
      throw new Error("quiet event not opened");
    }
    h.clock.advanceMinutes(3);

    await handleQuietButton(h.deps, tap(seed.organiserLink, quiet.id, "quiet_fine"), {
      type: "quiet_fine",
      quietEventId: quiet.id,
    });

    const [resolved] = await quietRows();
    expect(resolved).toMatchObject({
      resolvedAt: h.clock.now(),
      outcome: "fine_known",
      resolvedBy: seed.organiser.id,
    });
    expect(h.telegram.acknowledged).toHaveLength(1);
    expect(h.telegram.closed).toEqual([
      {
        conversationId: seed.organiserLink.externalId,
        messageId: "1",
        replacementText: "Mom is fine, I know why",
      },
    ]);
    const told = await resolvedRows();
    expect(told.map((row) => row.memberId)).toEqual([second.member.id]);
    await h.run(handlers());
    const [message] = h.telegram.sentTo(second.link.externalId).slice(-1);
    expect(message?.message.text).toBe("Mia says Mom is fine.");
    expect(await eventNames()).toContain("quiet_notice_resolved");
  });

  it("tells an organiser whose notice was on its way when another said she is fine", async () => {
    const { seed, second } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    const byMember = new Map((await noticeRows()).map((row) => [row.memberId, row.id]));
    // Mia's notice is delivered and she is among those told; Sam's has gone out, its effect not run.
    await deliverOutbound(h.deps, byMember.get(seed.organiser.id) ?? "");
    await h.db
      .update(outbound)
      .set({ status: "sent", sentAt: h.clock.now(), externalId: "901" })
      .where(eq(outbound.id, byMember.get(second.member.id) ?? ""));
    const [quiet] = await quietRows();
    if (quiet === undefined) {
      throw new Error("quiet event not opened");
    }
    h.clock.advanceMinutes(3);
    await handleQuietButton(h.deps, tap(seed.organiserLink, quiet.id, "quiet_fine"), {
      type: "quiet_fine",
      quietEventId: quiet.id,
    });

    await h.run(handlers());

    // Sam read the notice, so he hears Mia's answer to it; Mia, who gave it, hears nothing back.
    expect(h.telegram.sentTo(second.link.externalId).map((sent) => sent.message.text)).toEqual([
      "Mia says Mom is fine.",
    ]);
    expect((await resolvedRows()).map((row) => row.memberId)).toEqual([second.member.id]);
  });

  it("only takes the buttons away on a second tap or a tap after the event closed", async () => {
    const { seed, second } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());
    const [quiet] = await quietRows();
    if (quiet === undefined) {
      throw new Error("quiet event not opened");
    }
    const action = { type: "quiet_fine", quietEventId: quiet.id } as const;
    await handleQuietButton(h.deps, tap(seed.organiserLink, quiet.id, "quiet_fine"), action);

    await handleQuietButton(h.deps, tap(seed.organiserLink, quiet.id, "quiet_fine"), action);
    await handleQuietButton(h.deps, tap(second.link, quiet.id, "quiet_fine"), action);

    expect(await resolvedRows()).toHaveLength(1);
    expect(h.telegram.closed.map((call) => call.replacementText)).toEqual([
      "Mom is fine, I know why",
      undefined,
      undefined,
    ]);
    expect(h.telegram.acknowledged).toHaveLength(3);
    const [resolved] = await quietRows();
    expect(resolved?.resolvedBy).toBe(seed.organiser.id);
  });

  it("ignores a tap from someone outside her family", async () => {
    const { seed } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    const [quiet] = await quietRows();
    if (quiet === undefined) {
      throw new Error("quiet event not opened");
    }
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "7001",
      memberExternalId: "7002",
    });
    const stranger: ChannelLink = { ...other.organiserLink };

    await handleQuietButton(h.deps, tap(stranger, quiet.id, "quiet_fine"), {
      type: "quiet_fine",
      quietEventId: quiet.id,
    });
    await handleQuietButton(
      h.deps,
      tap({ ...seed.organiserLink, externalId: "unknown-user" }, quiet.id, "quiet_wait"),
      { type: "quiet_wait", quietEventId: quiet.id },
    );

    const [untouched] = await quietRows();
    expect(untouched?.resolvedAt).toBeNull();
    expect(untouched?.waitUntil).toBeNull();
    expect(h.telegram.acknowledged).toHaveLength(2);
    expect(h.telegram.closed).toHaveLength(0);
    expect(await resolvedRows()).toHaveLength(0);
  });

  it("does not wait on an event that is already resolved", async () => {
    const { seed, exchangeId } = await quietMorning();
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());
    await h.db.transaction((tx) => resolveQuietOnAnswer(h.deps, tx, exchangeId));
    const [quiet] = await quietRows();
    if (quiet === undefined) {
      throw new Error("quiet event not opened");
    }

    await handleQuietButton(h.deps, tap(seed.organiserLink, quiet.id, "quiet_wait"), {
      type: "quiet_wait",
      quietEventId: quiet.id,
    });

    const [row] = await quietRows();
    expect(row?.waitUntil).toBeNull();
    expect(h.telegram.closed.map((call) => call.replacementText)).toEqual([undefined]);
    expect(h.scheduler.wakes.has(seed.member.id)).toBe(false);
    const [exchange] = await h.db.select().from(exchanges).where(eq(exchanges.id, exchangeId));
    expect(exchange?.id).toBe(exchangeId);
  });
});
