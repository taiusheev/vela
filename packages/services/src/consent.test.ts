import type { InboundEvent, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
import { decodeButton, encodeButton, outboundKey } from "@vela/core";
import {
  type ChannelLink,
  channelLinks,
  consents,
  events,
  type Family,
  families,
  type Invite,
  invites,
  type Member,
  members,
  messageRefs,
  nearbyContacts,
  outbound,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleConsentButton, handleHealthWordsButton, handleInviteStart } from "./consent.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { sha256Hex } from "./hash.ts";
import { handleParentCommand } from "./parent-commands.ts";
import { hasHealthWordsConsent } from "./repo.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { seedFamily } from "./testing/seed.ts";

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

const ORGANISER = "1001";
const HER = "2001";
const TOKEN = "token-1";
const NOTICE_EN = "https://vela.test/privacy/en";

interface Invited {
  family: Family;
  organiser: Member;
  organiserLink: ChannelLink;
  her: Member;
  invite: Invite;
}

function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error("expected one row");
  }
  return row;
}

/** A family fresh from onboarding: she is invited, unlinked, and holds an unspent invite. */
async function seedInvited(
  options: { language?: Lang; tz?: string; expired?: boolean; used?: boolean } = {},
): Promise<Invited> {
  const now = h.clock.now();
  const language = options.language ?? "en";
  const family = only(
    await h.db
      .insert(families)
      .values({ name: "The Chens", region: "apac", country: "TW", language, createdAt: now })
      .returning(),
  );
  const organiser = only(
    await h.db
      .insert(members)
      .values({
        familyId: family.id,
        role: "organiser",
        billing: true,
        displayName: "Mia",
        language,
        tz: options.tz ?? "Asia/Taipei",
        country: "TW",
        status: "active",
        primarySurface: "telegram",
        createdAt: now,
      })
      .returning(),
  );
  const organiserLink = only(
    await h.db
      .insert(channelLinks)
      .values({
        memberId: organiser.id,
        channel: "telegram",
        externalId: ORGANISER,
        displayName: "Mia",
        linkedAt: now,
      })
      .returning(),
  );
  const her = only(
    await h.db
      .insert(members)
      .values({
        familyId: family.id,
        role: "member",
        displayName: "Mom",
        addressForm: "Mrs Chen",
        language,
        tz: options.tz ?? "Asia/Taipei",
        country: "TW",
        status: "invited",
        turnsIn: false,
        primarySurface: "telegram",
        lightOn: false,
        wakeTime: "07:30",
        arrivalTime: "08:00",
        createdAt: now,
      })
      .returning(),
  );
  const invite = only(
    await h.db
      .insert(invites)
      .values({
        familyId: family.id,
        invitedBy: organiser.id,
        forMemberId: her.id,
        token: TOKEN,
        channel: "link",
        createdAt: now,
        expiresAt:
          options.expired === true
            ? new Date(now.getTime() - 60_000)
            : new Date(now.getTime() + 7 * 24 * 60 * 60_000),
        acceptedAt: options.used === true ? now : null,
      })
      .returning(),
  );
  return { family, organiser, organiserLink, her, invite };
}

let sequence = 0;

function startEvent(token: string, user = HER): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    kind: "start",
    sender: { externalUserId: user, displayName: "Mom", languageCode: "en" },
    conversation: { externalId: user, kind: "private" },
    messageId: String(sequence),
    startParam: token,
  };
}

function tapEvent(memberId: string, accept: boolean, user = HER): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    kind: "button",
    sender: { externalUserId: user },
    conversation: { externalId: user, kind: "private" },
    messageId: "1",
    buttonData: encodeButton({ type: "consent", memberId, accept }),
    callbackId: `cb${sequence}`,
  };
}

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

async function outboundRows() {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function eventNames(): Promise<string[]> {
  const rows = await h.db.select({ name: events.name }).from(events).orderBy(asc(events.id));
  return rows.map((row) => row.name);
}

async function herRow(id: string): Promise<Member | undefined> {
  const [row] = await h.db.select().from(members).where(eq(members.id, id));
  return row;
}

/** She opened her link; the request is on its way. */
async function linked(options: Parameters<typeof seedInvited>[0] = {}): Promise<Invited> {
  const seed = await seedInvited(options);
  await handleInviteStart(h.deps, startEvent(TOKEN));
  await h.run(handlers());
  return seed;
}

describe("handleInviteStart", () => {
  it("refuses an unknown token with one direct message and links nobody", async () => {
    await seedInvited();

    await handleInviteStart(h.deps, startEvent("nope"));

    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toEqual([
      t("en", "consent.invalid_link"),
    ]);
    expect(await outboundRows()).toHaveLength(0);
    expect(await h.db.select().from(channelLinks).where(eq(channelLinks.externalId, HER))).toEqual(
      [],
    );
  });

  it("refuses an expired token and a used one, leaving the invite as it is", async () => {
    const expired = await seedInvited({ expired: true });
    await handleInviteStart(h.deps, startEvent(TOKEN));
    expect(h.telegram.sentTo(HER)).toHaveLength(1);
    expect((await h.db.select().from(invites))[0]?.acceptedAt).toBeNull();

    await h.reset();
    const used = await seedInvited({ used: true });
    await handleInviteStart(h.deps, startEvent(TOKEN));

    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toEqual([
      t("en", "consent.invalid_link"),
    ]);
    expect(await h.db.select().from(channelLinks).where(eq(channelLinks.externalId, HER))).toEqual(
      [],
    );
    expect(expired.invite.id).not.toBe(used.invite.id);
  });

  it("links her, spends the invite, and sends the request with Yes and No", async () => {
    const seed = await seedInvited();

    await handleInviteStart(h.deps, startEvent(TOKEN));

    const [link] = await h.db.select().from(channelLinks).where(eq(channelLinks.externalId, HER));
    expect(link).toMatchObject({
      memberId: seed.her.id,
      channel: "telegram",
      displayName: "Mom",
      linkedAt: h.clock.now(),
    });
    const [invite] = await h.db.select().from(invites);
    expect(invite).toMatchObject({ acceptedAt: h.clock.now(), acceptedBy: seed.her.id });
    const rows = await outboundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "consent", memberId: seed.her.id, conversationId: HER });
    await h.run(handlers());
    const [request] = h.telegram.sentTo(HER);
    expect(request?.message.text).toBe(
      t("en", "consent.request", { organiser: "Mia", notice: NOTICE_EN }),
    );
    expect(request?.message.text).toContain("Timur Aiusheev");
    expect(request?.message.lang).toBe("en");
    expect(
      request?.message.buttons?.flat().map((button) => [decodeButton(button.id), button.label]),
    ).toEqual([
      [{ type: "consent", memberId: seed.her.id, accept: true }, "Yes, that's fine"],
      [{ type: "consent", memberId: seed.her.id, accept: false }, "No, thank you"],
    ]);
    const [ref] = await h.db.select().from(messageRefs);
    expect(ref).toMatchObject({
      conversationId: HER,
      messageId: request?.result.primaryMessageId,
      purpose: "consent",
      memberId: seed.her.id,
      familyId: seed.family.id,
    });
    expect(await eventNames()).toEqual(["invite_accepted"]);
    expect((await herRow(seed.her.id))?.status).toBe("invited");
  });

  it("asks in her language", async () => {
    await seedInvited({ language: "zh-TW" });

    await handleInviteStart(h.deps, startEvent(TOKEN));
    await h.run(handlers());

    const [request] = h.telegram.sentTo(HER);
    expect(request?.message.text).toBe(
      t("zh-TW", "consent.request", {
        organiser: "Mia",
        notice: "https://vela.test/privacy/zh-TW",
      }),
    );
    expect(request?.message.buttons?.flat().map((button) => button.label)).toEqual([
      "好，沒問題",
      "不用了，謝謝",
    ]);
  });

  it("changes nothing when her link is opened again or the update is redelivered", async () => {
    await seedInvited();
    const first = startEvent(TOKEN);

    await handleInviteStart(h.deps, first);
    await handleInviteStart(h.deps, first);
    await handleInviteStart(h.deps, startEvent(TOKEN));

    expect(await outboundRows()).toHaveLength(1);
    expect(
      await h.db.select().from(channelLinks).where(eq(channelLinks.externalId, HER)),
    ).toHaveLength(1);
    expect(await eventNames()).toEqual(["invite_accepted"]);
    expect(h.telegram.sent).toHaveLength(0);
  });

  it("refuses a person linked to another family and leaves the invite unspent", async () => {
    const seed = await seedInvited();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "7001",
      memberExternalId: HER,
    });

    await handleInviteStart(h.deps, startEvent(TOKEN));

    const rows = await outboundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "consent", memberId: other.member.id });
    await h.run(handlers());
    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toEqual([
      t("en", "consent.already_linked"),
    ]);
    expect((await h.db.select().from(invites))[0]?.acceptedAt).toBeNull();
    expect(
      await h.db.select().from(channelLinks).where(eq(channelLinks.memberId, seed.her.id)),
    ).toEqual([]);
  });
});

describe("handleConsentButton: Yes", () => {
  it("switches the light on from tomorrow, records the consent with its evidence, thanks her, and tells the organiser", async () => {
    const seed = await linked();
    h.clock.advanceMinutes(5);
    const tap = tapEvent(seed.her.id, true);

    await handleConsentButton(h.deps, tap, {
      type: "consent",
      memberId: seed.her.id,
      accept: true,
    });

    const now = h.clock.now();
    // Her schedule runs at once: nothing is due before tomorrow's first morning, so the next wake
    // is this evening's turn prompt, 19:00 in Taipei.
    const turnPrompt = new Date("2026-09-14T11:00:00.000Z");
    expect(await herRow(seed.her.id)).toMatchObject({
      lightOn: true,
      lightConsentedAt: now,
      lightConsentText: "consent.request@2",
      status: "active",
      lightStartsOn: "2026-09-15",
      learningUntil: "2026-09-28",
      nextWakeAt: turnPrompt,
    });
    const params = { organiser: "Mia", notice: NOTICE_EN };
    const [consent] = await h.db.select().from(consents);
    expect(consent).toEqual({
      id: expect.any(String),
      memberId: seed.her.id,
      contactId: null,
      subjectRef: `member:${seed.her.id}`,
      kind: "light",
      answer: "yes",
      textVersion: "consent.request@2",
      lang: "en",
      channel: "telegram",
      givenAt: now,
      withdrawnAt: null,
      subjectDeletedAt: null,
      evidence: {
        chat_id: HER,
        message_id: "1",
        params,
        text_sha256: await sha256Hex(t("en", "consent.request", params)),
      },
    });
    await h.run(handlers());
    expect(h.telegram.sentTo(ORGANISER).map((entry) => entry.message.text)).toEqual([
      "Mom said yes. The first morning arrives tomorrow at 08:00.",
    ]);
    expect(h.telegram.acknowledged.map((call) => call.eventId)).toEqual([tap.eventId]);
    // The request stays in her chat, who runs Vela and the notice link included, with her choice.
    expect(h.telegram.closed).toEqual([
      {
        conversationId: HER,
        messageId: "1",
        replacementText: `${t("en", "consent.request", params)}\n\nYes, that's fine`,
      },
    ]);
    expect(h.telegram.closed[0]?.replacementText).toContain("Timur Aiusheev");
    expect(h.telegram.closed[0]?.replacementText).toContain(NOTICE_EN);
    expect(await eventNames()).toEqual(["invite_accepted", "consent_given"]);
    expect(h.scheduler.wakes.get(seed.her.id)).toEqual(turnPrompt);
  });

  it("takes tomorrow in her zone", async () => {
    // 00:00 UTC on 14 September is 20:00 on 13 September in New York.
    const seed = await linked({ tz: "America/New_York" });

    await handleConsentButton(h.deps, tapEvent(seed.her.id, true), {
      type: "consent",
      memberId: seed.her.id,
      accept: true,
    });

    expect(await herRow(seed.her.id)).toMatchObject({
      lightStartsOn: "2026-09-14",
      learningUntil: "2026-09-27",
    });
  });

  it("ticks her through the function it is given instead of the scheduler", async () => {
    const seed = await linked();
    const ticked: string[] = [];

    await handleConsentButton(
      h.deps,
      tapEvent(seed.her.id, true),
      { type: "consent", memberId: seed.her.id, accept: true },
      async (_deps, memberId) => {
        ticked.push(memberId);
      },
    );

    expect(ticked).toEqual([seed.her.id]);
    expect(h.scheduler.wakes.has(seed.her.id)).toBe(false);
  });

  it("consents once when Yes is tapped or delivered twice", async () => {
    const seed = await linked();
    const action = { type: "consent", memberId: seed.her.id, accept: true } as const;

    await handleConsentButton(h.deps, tapEvent(seed.her.id, true), action);
    await handleConsentButton(h.deps, tapEvent(seed.her.id, true), action);

    expect(await h.db.select().from(consents)).toHaveLength(1);
    expect((await outboundRows()).map((row) => row.conversationId)).toEqual([
      HER,
      HER,
      ORGANISER,
      HER,
    ]);
    expect((await eventNames()).filter((name) => name === "consent_given")).toHaveLength(1);
    // The second tap records nothing, so it only makes sure the buttons are gone.
    expect(h.telegram.closed.map((call) => call.replacementText)).toEqual([
      `${t("en", "consent.request", { organiser: "Mia", notice: NOTICE_EN })}\n\nYes, that's fine`,
      undefined,
    ]);
    expect(h.scheduler.history).toHaveLength(1);
  });
});

describe("the health-words question", () => {
  async function consented(options: Parameters<typeof seedInvited>[0] = {}): Promise<Invited> {
    const seed = await linked(options);
    await handleConsentButton(
      h.deps,
      tapEvent(seed.her.id, true),
      { type: "consent", memberId: seed.her.id, accept: true },
      async () => {},
    );
    await h.run(handlers());
    return seed;
  }

  function healthTap(memberId: string, accept: boolean, user = HER): InboundEvent {
    sequence += 1;
    return {
      channel: "telegram",
      eventId: `tg:${sequence}`,
      at: h.clock.now().toISOString(),
      kind: "button",
      sender: { externalUserId: user },
      conversation: { externalId: user, kind: "private" },
      messageId: "3",
      buttonData: encodeButton({ type: "health_words", memberId, accept }),
      callbackId: `cb${sequence}`,
    };
  }

  async function healthRows() {
    return h.db.select().from(consents).where(eq(consents.kind, "health_words"));
  }

  it("follows her thanks, ten seconds later, with its own Yes and No buttons, once", async () => {
    const seed = await consented();

    const toHer = h.telegram.sentTo(HER);
    expect(toHer.map((entry) => entry.message.text)).toEqual([
      t("en", "consent.request", { organiser: "Mia", notice: NOTICE_EN }),
      t("en", "consent.accepted", { time: "08:00" }),
      t("en", "consent.health_words", { organiser: "Mia" }),
    ]);
    const [accepted, question] = toHer.slice(1);
    expect((question?.at.getTime() ?? 0) - (accepted?.at.getTime() ?? 0)).toBe(10_000);
    expect(
      question?.message.buttons?.flat().map((button) => [decodeButton(button.id), button.label]),
    ).toEqual([
      [{ type: "health_words", memberId: seed.her.id, accept: true }, "Yes, that's fine"],
      [{ type: "health_words", memberId: seed.her.id, accept: false }, "No, thank you"],
    ]);
    const rows = await outboundRows();
    const questionKey = outboundKey("consent", {
      conversationId: HER,
      suffix: `health_words:${seed.her.id}`,
    });
    expect(rows.filter((row) => row.idempotencyKey === questionKey)).toHaveLength(1);
    const refs = await h.db.select().from(messageRefs).where(eq(messageRefs.conversationId, HER));
    expect(refs.map((ref) => [ref.messageId, ref.purpose, ref.memberId])).toContainEqual([
      question?.result.primaryMessageId,
      "consent",
      seed.her.id,
    ]);
  });

  it("is asked in her language, and never before a Yes", async () => {
    const seed = await linked({ language: "zh-TW" });
    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).not.toContain(
      t("zh-TW", "consent.health_words", { organiser: "Mia" }),
    );

    await handleConsentButton(
      h.deps,
      tapEvent(seed.her.id, true),
      { type: "consent", memberId: seed.her.id, accept: true },
      async () => {},
    );
    await h.run(handlers());

    expect(h.telegram.sentTo(HER).at(-1)?.message.text).toBe(
      t("zh-TW", "consent.health_words", { organiser: "Mia" }),
    );
  });

  it("records her Yes with its evidence, sends nothing, and records nothing for a second tap, the other button, or a redelivery", async () => {
    const seed = await consented();
    const sentBefore = h.telegram.sent.length;
    h.clock.advanceMinutes(1);
    const tap = healthTap(seed.her.id, true);

    await handleHealthWordsButton(h.deps, tap, {
      type: "health_words",
      memberId: seed.her.id,
      accept: true,
    });
    await handleHealthWordsButton(h.deps, tap, {
      type: "health_words",
      memberId: seed.her.id,
      accept: true,
    });
    await handleHealthWordsButton(h.deps, healthTap(seed.her.id, false), {
      type: "health_words",
      memberId: seed.her.id,
      accept: false,
    });
    await h.run(handlers());

    const params = { organiser: "Mia" };
    const rows = await healthRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memberId: seed.her.id,
      subjectRef: `member:${seed.her.id}`,
      answer: "yes",
      textVersion: "consent.health_words@1",
      lang: "en",
      givenAt: h.clock.now(),
      withdrawnAt: null,
      evidence: {
        chat_id: HER,
        message_id: "3",
        params,
        text_sha256: await sha256Hex(t("en", "consent.health_words", params)),
      },
    });
    const given = await h.db
      .select({ props: events.props })
      .from(events)
      .where(eq(events.name, "consent_given"));
    expect(given.map((row) => row.props)).toContainEqual({
      kind: "health_words",
      text_version: "consent.health_words@1",
    });
    expect(h.telegram.sent.length).toBe(sentBefore);
    expect(h.telegram.closed.at(-1)).toEqual({
      conversationId: HER,
      messageId: "3",
      replacementText: `${t("en", "consent.health_words", params)}\n\nYes, that's fine`,
    });
    expect(h.telegram.closed.filter((call) => call.messageId === "3")).toHaveLength(1);
    expect(h.telegram.acknowledged.slice(-3)).toHaveLength(3);
    expect(
      h.logger.entries.filter((entry) => entry.event === "health_words_button_ignored"),
    ).toEqual([
      {
        level: "info",
        event: "health_words_button_ignored",
        fields: { familyId: seed.family.id, reason: "already_answered" },
      },
      {
        level: "info",
        event: "health_words_button_ignored",
        fields: { familyId: seed.family.id, reason: "already_answered" },
      },
    ]);
  });

  it("records her No as a decline and sends nothing to anyone", async () => {
    const seed = await consented();
    const sentBefore = h.telegram.sent.length;

    await handleHealthWordsButton(h.deps, healthTap(seed.her.id, false), {
      type: "health_words",
      memberId: seed.her.id,
      accept: false,
    });
    await h.run(handlers());

    expect((await healthRows()).map((row) => [row.answer, row.withdrawnAt])).toEqual([
      ["no", null],
    ]);
    expect((await eventNames()).at(-1)).toBe("consent_declined");
    expect(h.telegram.sent.length).toBe(sentBefore);
    expect(h.telegram.closed.at(-1)).toEqual({
      conversationId: HER,
      messageId: "3",
      replacementText: `${t("en", "consent.health_words", { organiser: "Mia" })}\n\nNo, thank you`,
    });
  });

  it("records nothing for a tap from another person, before her Yes, or while she is paused", async () => {
    const seed = await consented();
    const action = { type: "health_words", memberId: seed.her.id, accept: true } as const;

    await handleHealthWordsButton(h.deps, healthTap(seed.her.id, true, ORGANISER), action);
    await h.db.update(members).set({ status: "paused" }).where(eq(members.id, seed.her.id));
    await handleHealthWordsButton(h.deps, healthTap(seed.her.id, true), action);

    await h.reset();
    const before = await linked();
    await handleHealthWordsButton(h.deps, healthTap(before.her.id, true), {
      type: "health_words",
      memberId: before.her.id,
      accept: true,
    });

    expect(await healthRows()).toEqual([]);
    expect(h.telegram.closed).toEqual([]);
    expect(
      h.logger.entries.filter((entry) => entry.event === "health_words_button_ignored"),
    ).toEqual([
      {
        level: "info",
        event: "health_words_button_ignored",
        fields: { familyId: before.family.id, reason: "status" },
      },
    ]);
  });

  it("is not asked again after a stop, a start, or a second Yes", async () => {
    const seed = await consented();
    const her = await herRow(seed.her.id);
    if (her === undefined) {
      throw new Error("she is gone");
    }
    const say = (text: string): InboundEvent => {
      sequence += 1;
      return {
        channel: "telegram",
        eventId: `tg:${sequence}`,
        at: h.clock.now().toISOString(),
        kind: "text",
        text,
        sender: { externalUserId: HER },
        conversation: { externalId: HER, kind: "private" },
        messageId: String(100 + sequence),
      };
    };

    await handleParentCommand(h.deps, her, "stop", say("stop"), async () => {});
    const paused = await herRow(seed.her.id);
    if (paused === undefined) {
      throw new Error("she is gone");
    }
    await handleParentCommand(h.deps, paused, "start", say("start"), async () => {});
    await handleConsentButton(
      h.deps,
      tapEvent(seed.her.id, true),
      { type: "consent", memberId: seed.her.id, accept: true },
      async () => {},
    );
    await h.run(handlers());

    const questions = h.telegram
      .sentTo(HER)
      .filter(
        (entry) => entry.message.text === t("en", "consent.health_words", { organiser: "Mia" }),
      );
    expect(questions).toHaveLength(1);
  });

  it("stop withdraws her Yes, and start leaves it withdrawn", async () => {
    const seed = await consented();
    await handleHealthWordsButton(h.deps, healthTap(seed.her.id, true), {
      type: "health_words",
      memberId: seed.her.id,
      accept: true,
    });
    const stopAt = h.clock.now();
    const her = await herRow(seed.her.id);
    if (her === undefined) {
      throw new Error("she is gone");
    }
    const command = (text: string): InboundEvent => {
      sequence += 1;
      return {
        channel: "telegram",
        eventId: `tg:${sequence}`,
        at: h.clock.now().toISOString(),
        kind: "text",
        text,
        sender: { externalUserId: HER },
        conversation: { externalId: HER, kind: "private" },
        messageId: String(100 + sequence),
      };
    };

    await handleParentCommand(h.deps, her, "stop", command("stop"), async () => {});
    h.clock.advanceMinutes(30);
    const paused = await herRow(seed.her.id);
    if (paused === undefined) {
      throw new Error("she is gone");
    }
    await handleParentCommand(h.deps, paused, "start", command("start"), async () => {});

    expect((await healthRows()).map((row) => [row.answer, row.withdrawnAt])).toEqual([
      ["yes", stopAt],
    ]);
    expect(await hasHealthWordsConsent(h.db, seed.her.id, h.clock.now())).toBe(false);
    const stops = await h.db
      .select({ props: events.props })
      .from(events)
      .where(eq(events.name, "stop_said"));
    expect(stops.map((row) => row.props)).toEqual([{ health_words_withdrawn: true }]);
  });
});

describe("handleConsentButton: No", () => {
  it("records the decline, tells the organiser, deletes her member row with everything setup stored, and keeps only the forgotten proof", async () => {
    const seed = await linked();
    const contact = only(
      await h.db
        .insert(nearbyContacts)
        .values({
          familyId: seed.family.id,
          memberId: seed.her.id,
          name: "Anna",
          relation: "neighbour",
          createdAt: h.clock.now(),
        })
        .returning(),
    );
    await h.db.insert(consents).values({
      memberId: seed.her.id,
      subjectRef: `member:${seed.her.id}`,
      kind: "privacy_notice",
      answer: "yes",
      textVersion: "privacy-notice.v1",
      lang: "en",
      channel: "paper",
      givenAt: h.clock.now(),
      evidence: { note: "Mom read it with me", recorded_by: "founder" },
    });
    h.clock.advanceMinutes(2);

    await handleConsentButton(h.deps, tapEvent(seed.her.id, false), {
      type: "consent",
      memberId: seed.her.id,
      accept: false,
    });

    const now = h.clock.now();
    expect(await herRow(seed.her.id)).toBeUndefined();
    expect(await h.db.select().from(channelLinks).where(eq(channelLinks.externalId, HER))).toEqual(
      [],
    );
    expect(await h.db.select().from(invites)).toEqual([]);
    expect(await h.db.select().from(nearbyContacts)).toEqual([]);
    expect(
      await h.db.select().from(messageRefs).where(eq(messageRefs.conversationId, HER)),
    ).toEqual([]);
    expect(await h.db.select().from(outbound).where(eq(outbound.conversationId, HER))).toEqual([]);
    const params = { organiser: "Mia", notice: NOTICE_EN };
    const proofs = await h.db.select().from(consents).orderBy(asc(consents.givenAt));
    expect(
      proofs.map((row) => ({
        memberId: row.memberId,
        subjectRef: row.subjectRef,
        kind: row.kind,
        answer: row.answer,
        textVersion: row.textVersion,
        subjectDeletedAt: row.subjectDeletedAt,
        evidence: row.evidence,
      })),
    ).toEqual([
      {
        memberId: null,
        subjectRef: `member:${seed.her.id}`,
        kind: "privacy_notice",
        answer: "yes",
        textVersion: "privacy-notice.v1",
        subjectDeletedAt: now,
        evidence: { recorded_by: "founder" },
      },
      {
        memberId: null,
        subjectRef: `member:${seed.her.id}`,
        kind: "light",
        answer: "no",
        textVersion: "consent.request@2",
        subjectDeletedAt: now,
        evidence: {
          chat_id: HER,
          message_id: "1",
          text_sha256: await sha256Hex(t("en", "consent.request", params)),
        },
      },
    ]);
    expect(contact.id).toBeDefined();
    await h.run(handlers());
    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toEqual([
      t("en", "consent.request", params),
      "That's fine. Nothing will arrive.",
    ]);
    expect(h.telegram.sentTo(ORGANISER).map((entry) => entry.message.text)).toEqual([
      "Mom said no for now. Nothing will be sent.",
    ]);
    expect(h.telegram.closed).toEqual([
      {
        conversationId: HER,
        messageId: "1",
        replacementText: `${t("en", "consent.request", params)}\n\nNo, thank you`,
      },
    ]);
    expect(await eventNames()).toEqual(["invite_accepted", "consent_declined"]);
    const [declined] = await h.db
      .select({ props: events.props })
      .from(events)
      .where(eq(events.name, "consent_declined"));
    expect(declined?.props).toEqual({
      kind: "light",
      text_version: "consent.request@2",
      member_deleted: true,
    });
    expect(h.scheduler.history).toHaveLength(0);
  });

  it("changes and sends nothing for a second No or a redelivered one, and the old link is no longer valid", async () => {
    const seed = await linked();
    const action = { type: "consent", memberId: seed.her.id, accept: false } as const;
    const tap = tapEvent(seed.her.id, false);

    await handleConsentButton(h.deps, tap, action);
    await handleConsentButton(h.deps, tap, action);
    await handleConsentButton(h.deps, tapEvent(seed.her.id, false), action);
    await h.run(handlers());

    expect((await eventNames()).filter((name) => name === "consent_declined")).toHaveLength(1);
    expect(await h.db.select().from(consents)).toHaveLength(1);
    expect(h.telegram.sentTo(HER).map((entry) => entry.message.text)).toEqual([
      t("en", "consent.request", { organiser: "Mia", notice: NOTICE_EN }),
      "That's fine. Nothing will arrive.",
    ]);
    expect(h.telegram.sentTo(ORGANISER)).toHaveLength(1);

    await handleInviteStart(h.deps, startEvent(TOKEN));
    expect(h.telegram.sentTo(HER).at(-1)?.message.text).toBe(t("en", "consent.invalid_link"));
  });

  it("keeps the decline when the reply to her cannot be sent, and logs it without retrying", async () => {
    const seed = await linked();
    h.telegram.failSendsTo(HER, "blocked");

    await handleConsentButton(h.deps, tapEvent(seed.her.id, false), {
      type: "consent",
      memberId: seed.her.id,
      accept: false,
    });

    expect(await herRow(seed.her.id)).toBeUndefined();
    expect((await h.db.select().from(consents)).map((row) => row.answer)).toEqual(["no"]);
    expect(h.logger.entries.map((entry) => entry.event)).toContain("direct_send_failed");
    expect(h.telegram.closed).toHaveLength(1);
  });

  it("ignores a No after a Yes", async () => {
    const seed = await linked();
    await handleConsentButton(h.deps, tapEvent(seed.her.id, true), {
      type: "consent",
      memberId: seed.her.id,
      accept: true,
    });

    await handleConsentButton(h.deps, tapEvent(seed.her.id, false), {
      type: "consent",
      memberId: seed.her.id,
      accept: false,
    });

    expect((await herRow(seed.her.id))?.status).toBe("active");
    expect(await eventNames()).toEqual(["invite_accepted", "consent_given"]);
    // The request keeps showing the Yes that stands.
    expect(h.telegram.closed.map((call) => call.replacementText?.split("\n\n").at(-1))).toEqual([
      "Yes, that's fine",
      undefined,
    ]);
  });
});

describe("handleConsentButton: who may answer", () => {
  it("acknowledges and otherwise ignores a tap by anyone but her", async () => {
    const seed = await linked();

    await handleConsentButton(h.deps, tapEvent(seed.her.id, true, ORGANISER), {
      type: "consent",
      memberId: seed.her.id,
      accept: true,
    });
    await handleConsentButton(h.deps, tapEvent(seed.her.id, false, "4242"), {
      type: "consent",
      memberId: seed.her.id,
      accept: false,
    });

    expect((await herRow(seed.her.id))?.status).toBe("invited");
    expect(await h.db.select().from(consents)).toHaveLength(0);
    expect(h.telegram.acknowledged).toHaveLength(2);
    expect(h.telegram.closed).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(1);
  });

  it("ignores a tap that names a member she is not linked to", async () => {
    const seed = await linked();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "7001",
      memberExternalId: "7002",
    });

    await handleConsentButton(h.deps, tapEvent(other.member.id, false), {
      type: "consent",
      memberId: other.member.id,
      accept: false,
    });

    expect((await herRow(seed.her.id))?.status).toBe("invited");
    expect(await herRow(other.member.id)).toBeDefined();
    expect(await h.db.select().from(consents).where(eq(consents.memberId, seed.her.id))).toEqual(
      [],
    );
    expect(h.telegram.closed).toHaveLength(0);
  });
});
