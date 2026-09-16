import type { InboundEvent, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
import { decodeButton, encodeButton } from "@vela/core";
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
  outbound,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleConsentButton, handleInviteStart } from "./consent.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
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
    expect(request?.message.text).toBe(t("en", "consent.request", { organiser: "Mia" }));
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
    expect(request?.message.text).toBe(t("zh-TW", "consent.request", { organiser: "Mia" }));
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
  it("switches the light on from tomorrow, records the consent, thanks her, and tells the organiser", async () => {
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
      lightConsentText: "consent.request@1",
      status: "active",
      lightStartsOn: "2026-09-15",
      learningUntil: "2026-09-28",
      nextWakeAt: turnPrompt,
    });
    const [consent] = await h.db.select().from(consents);
    expect(consent).toMatchObject({
      memberId: seed.her.id,
      kind: "light",
      textVersion: "consent.request@1",
      lang: "en",
      channel: "telegram",
      givenAt: now,
      evidence: { message_id: "1" },
    });
    await h.run(handlers());
    expect(h.telegram.sentTo(HER).at(-1)?.message.text).toBe(
      "Thank you. Your first morning arrives tomorrow at 08:00.",
    );
    expect(h.telegram.sentTo(ORGANISER).map((entry) => entry.message.text)).toEqual([
      "Mom said yes. The first morning arrives tomorrow at 08:00.",
    ]);
    expect(h.telegram.acknowledged.map((call) => call.eventId)).toEqual([tap.eventId]);
    expect(h.telegram.closed).toEqual([
      { conversationId: HER, messageId: "1", replacementText: "Yes, that's fine" },
    ]);
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
    expect((await outboundRows()).map((row) => row.conversationId)).toEqual([HER, HER, ORGANISER]);
    expect((await eventNames()).filter((name) => name === "consent_given")).toHaveLength(1);
    expect(h.telegram.closed).toHaveLength(2);
    expect(h.scheduler.history).toHaveLength(1);
  });
});

describe("handleConsentButton: No", () => {
  it("records the decline, tells her and the organiser, and leaves her invited with the light off", async () => {
    const seed = await linked();
    h.clock.advanceMinutes(2);

    await handleConsentButton(h.deps, tapEvent(seed.her.id, false), {
      type: "consent",
      memberId: seed.her.id,
      accept: false,
    });

    expect(await herRow(seed.her.id)).toMatchObject({
      lightOn: false,
      lightConsentedAt: null,
      status: "invited",
      lightStartsOn: null,
      nextWakeAt: null,
    });
    expect(await h.db.select().from(consents)).toHaveLength(0);
    await h.run(handlers());
    expect(h.telegram.sentTo(HER).at(-1)?.message.text).toBe("That's fine. Nothing will arrive.");
    expect(h.telegram.sentTo(ORGANISER).map((entry) => entry.message.text)).toEqual([
      "Mom said no for now. Nothing will be sent.",
    ]);
    expect(h.telegram.closed).toEqual([
      { conversationId: HER, messageId: "1", replacementText: "No, thank you" },
    ]);
    expect(await eventNames()).toEqual(["invite_accepted", "consent_declined"]);
    expect(h.scheduler.history).toHaveLength(0);
  });

  it("records a second No nowhere", async () => {
    const seed = await linked();
    const action = { type: "consent", memberId: seed.her.id, accept: false } as const;

    await handleConsentButton(h.deps, tapEvent(seed.her.id, false), action);
    await handleConsentButton(h.deps, tapEvent(seed.her.id, false), action);

    expect((await eventNames()).filter((name) => name === "consent_declined")).toHaveLength(1);
    expect((await outboundRows()).map((row) => row.conversationId)).toEqual([HER, HER, ORGANISER]);
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
    await handleConsentButton(h.deps, tapEvent(seed.her.id, true, "4242"), {
      type: "consent",
      memberId: seed.her.id,
      accept: true,
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

    await handleConsentButton(h.deps, tapEvent(other.member.id, true), {
      type: "consent",
      memberId: other.member.id,
      accept: true,
    });

    expect((await herRow(seed.her.id))?.status).toBe("invited");
    expect(await h.db.select().from(consents).where(eq(consents.memberId, seed.her.id))).toEqual(
      [],
    );
    expect(h.telegram.closed).toHaveLength(0);
  });
});
