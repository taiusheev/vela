import type { InboundEvent } from "@vela/contracts";
import { t } from "@vela/copy";
import { decodeButton, encodeButton, outboundKey } from "@vela/core";
import {
  channelLinks,
  consents,
  events,
  exchanges,
  families,
  familyChannels,
  members,
  messageRefs,
  outbound,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleAskCommand } from "./asks.ts";
import { handleConsentButton } from "./consent.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound, enqueueOutbound } from "./gateway.ts";
import {
  handleBotAdded,
  handleBotRemoved,
  handleGroupMigrated,
  handleMemberLeft,
  handleNoticeReadButton,
  resolveGroupSender,
} from "./group.ts";
import { sha256Hex } from "./hash.ts";
import { familyByLinkedGroup } from "./repo.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedFamily, seedGroupMember, seedLinkedGroup } from "./testing/seed.ts";

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

const GROUP = "-100500";
const ADMIN = "9001";

let sequence = 0;

function groupEvent(
  extra: Partial<InboundEvent> & { kind: InboundEvent["kind"]; user: string },
): InboundEvent {
  sequence += 1;
  const { user, ...rest } = extra;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: user, displayName: `User ${user}` },
    conversation: { externalId: GROUP, kind: "group", title: "Chen family" },
    messageId: String(sequence),
    ...rest,
  };
}

const botAdded = (user: string, conversationId = GROUP): InboundEvent =>
  groupEvent({
    kind: "bot_added",
    user,
    conversation: { externalId: conversationId, kind: "group" },
  });
const botRemoved = (user: string): InboundEvent => groupEvent({ kind: "bot_removed", user });
const migrated = (from: string, to: string): InboundEvent =>
  groupEvent({
    kind: "migrated",
    user: "1001",
    conversation: { externalId: from, kind: "group" },
    migratedToConversationId: to,
  });
const memberLeft = (subject: string, sender = subject): InboundEvent =>
  groupEvent({
    kind: "member_left",
    user: sender,
    subject: { externalUserId: subject, displayName: `User ${subject}` },
  });
const groupText = (user: string, name: string): InboundEvent =>
  groupEvent({
    kind: "text",
    user,
    text: "hello",
    sender: { externalUserId: user, displayName: name },
  });

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

async function links() {
  return h.db.select().from(familyChannels).orderBy(asc(familyChannels.linkedAt));
}

async function outboundRows() {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function eventRows() {
  return h.db.select().from(events).orderBy(asc(events.id));
}

async function memberRow(id: string) {
  const [row] = await h.db.select().from(members).where(eq(members.id, id));
  return row;
}

describe("handleBotAdded", () => {
  it("links the group for the organiser, sets the family language, and greets the group with the notice", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now(), language: "zh-TW" });

    await handleBotAdded(h.deps, botAdded(seed.organiserLink.externalId));

    const rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      familyId: seed.family.id,
      channel: "telegram",
      conversationId: GROUP,
      kind: "group",
      linkedByMemberId: seed.organiser.id,
      linkedAt: h.clock.now(),
      unlinkedAt: null,
    });
    const [family] = await h.db.select().from(families);
    expect(family?.language).toBe("zh-TW");
    await h.run(handlers());
    const [greeting] = h.telegram.sentTo(GROUP);
    expect(greeting?.message.text).toBe(
      t("zh-TW", "group.linked", { name: "Mom", notice: "https://vela.test/privacy/zh-TW" }),
    );
    expect(greeting?.message.text).toContain("https://vela.test/privacy/zh-TW");
    expect(rows[0]?.linkedTextSha256).toBe(await sha256Hex(greeting?.message.text ?? ""));
    expect(
      greeting?.message.buttons?.map((row) =>
        row.map((button) => [decodeButton(button.id), button.label]),
      ),
    ).toEqual([[[{ type: "notice_read", familyChannelId: rows[0]?.id }, "我看過了"]]]);
    expect((await memberRow(seed.organiser.id))?.turnsIn).toBe(true);
  });

  it("carries the English notice for an English family", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });

    await handleBotAdded(h.deps, botAdded(seed.organiserLink.externalId));
    await h.run(handlers());

    expect(h.telegram.sentTo(GROUP)[0]?.message.text).toBe(
      t("en", "group.linked", { name: "Mom", notice: "https://vela.test/privacy/en" }),
    );
  });

  it("links once when the addition is reported twice", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });

    await handleBotAdded(h.deps, botAdded(seed.organiserLink.externalId));
    await handleBotAdded(h.deps, botAdded(seed.organiserLink.externalId));

    expect(await links()).toHaveLength(1);
    expect(await outboundRows()).toHaveLength(1);
  });

  it("refuses a member who is not the organiser, through the gateway", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
    });

    await handleBotAdded(h.deps, botAdded(sam.link.externalId));

    expect(await links()).toHaveLength(0);
    const rows = await outboundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "system",
      memberId: sam.member.id,
      conversationId: GROUP,
    });
    await h.run(handlers());
    expect(h.telegram.sentTo(GROUP).map((entry) => entry.message.text)).toEqual([
      t("en", "group.not_linked"),
    ]);
  });

  it("refuses a stranger directly and stores nothing", async () => {
    await seedFamily(h.db, { now: h.clock.now() });

    await handleBotAdded(h.deps, botAdded("4242"));

    expect(await links()).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
    expect(h.telegram.sentTo(GROUP).map((entry) => entry.message.text)).toEqual([
      t("en", "group.not_linked"),
    ]);
  });

  it("refuses a second group while the first is linked, and a group linked to another family", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await handleBotAdded(h.deps, botAdded(seed.organiserLink.externalId));
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "7001",
      memberExternalId: "7002",
    });

    await handleBotAdded(h.deps, botAdded(seed.organiserLink.externalId, "-100600"));
    await handleBotAdded(h.deps, botAdded(other.organiserLink.externalId, GROUP));

    const rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ familyId: seed.family.id, conversationId: GROUP });
    await h.run(handlers());
    expect(h.telegram.sentTo("-100600").map((entry) => entry.message.text)).toEqual([
      t("en", "group.not_linked"),
    ]);
    expect(h.telegram.sentTo(GROUP).map((entry) => entry.message.text)).toEqual([
      t("en", "group.linked", { name: "Mom", notice: "https://vela.test/privacy/en" }),
      t("en", "group.not_linked"),
    ]);
  });
});

describe("handleNoticeReadButton", () => {
  const NOTICE = "https://vela.test/privacy/en";

  /**
   * Her family with its group linked through Vela, so the greeting and its button went out. With
   * `invited`, she has not answered her invite yet, as when the README's step 4 links the group.
   */
  async function linkedFamily(options: { invited?: boolean } = {}): Promise<{
    seed: SeededFamily;
    channelId: string;
    greetingId: string;
    greetingSha256: string;
  }> {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    if (options.invited === true) {
      await h.db.delete(consents).where(eq(consents.memberId, seed.member.id));
      await h.db
        .update(members)
        .set({
          status: "invited",
          lightOn: false,
          lightConsentedAt: null,
          lightConsentText: null,
          lightStartsOn: null,
          learningUntil: null,
        })
        .where(eq(members.id, seed.member.id));
    }
    await handleBotAdded(h.deps, botAdded(seed.organiserLink.externalId));
    await h.run(handlers());
    const [link] = await links();
    const [greeting] = h.telegram.sentTo(GROUP);
    return {
      seed,
      channelId: link?.id ?? "",
      greetingId: greeting?.result.primaryMessageId ?? "",
      greetingSha256: await sha256Hex(greeting?.message.text ?? ""),
    };
  }

  function readTap(
    user: string,
    channelId: string,
    messageId: string,
    name = `User ${user}`,
  ): InboundEvent {
    return groupEvent({
      kind: "button",
      user,
      sender: { externalUserId: user, displayName: name },
      messageId,
      buttonData: encodeButton({ type: "notice_read", familyChannelId: channelId }),
      callbackId: `cb-${user}`,
    });
  }

  async function noticeRows() {
    return h.db
      .select()
      .from(consents)
      .where(eq(consents.kind, "privacy_notice"))
      .orderBy(asc(consents.givenAt), asc(consents.id));
  }

  it("creates a family member who never wrote in the group and records their reading once, with evidence hashed over the greeting", async () => {
    const { seed, channelId, greetingId, greetingSha256 } = await linkedFamily();
    const tap = readTap("3001", channelId, greetingId, "Sam");
    const action = { type: "notice_read", familyChannelId: channelId } as const;

    await handleNoticeReadButton(h.deps, seed.family.id, tap, action);
    await handleNoticeReadButton(h.deps, seed.family.id, tap, action);
    await handleNoticeReadButton(
      h.deps,
      seed.family.id,
      readTap("3001", channelId, greetingId, "Sam"),
      action,
    );

    const [sam] = await h.db.select().from(members).where(eq(members.displayName, "Sam"));
    expect(sam).toMatchObject({ familyId: seed.family.id, role: "member", status: "active" });
    expect(greetingSha256).toBe(
      await sha256Hex(t("en", "group.linked", { name: "Mom", notice: NOTICE })),
    );
    const rows = await noticeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memberId: sam?.id,
      subjectRef: `member:${sam?.id}`,
      kind: "privacy_notice",
      answer: "yes",
      textVersion: "privacy-notice.v1",
      lang: "en",
      channel: "telegram",
      givenAt: h.clock.now(),
      withdrawnAt: null,
      evidence: { chat_id: GROUP, message_id: greetingId, text_sha256: greetingSha256 },
    });
    const given = (await eventRows()).filter((row) => row.name === "consent_given");
    expect(given.map((row) => [row.memberId, row.props])).toEqual([
      [sam?.id, { kind: "privacy_notice", text_version: "privacy-notice.v1", source: "button" }],
    ]);
    expect(h.telegram.acknowledged).toHaveLength(3);
    expect(h.telegram.closed).toEqual([]);
    await h.run(handlers());
    expect(h.telegram.sentTo(GROUP)).toHaveLength(1);
  });

  it("records each adult who taps once, the organiser included, and a new notice version again", async () => {
    const { seed, channelId, greetingId } = await linkedFamily();
    const action = { type: "notice_read", familyChannelId: channelId } as const;

    await handleNoticeReadButton(
      h.deps,
      seed.family.id,
      readTap(seed.organiserLink.externalId, channelId, greetingId),
      action,
    );
    await handleNoticeReadButton(
      h.deps,
      seed.family.id,
      readTap("3001", channelId, greetingId),
      action,
    );
    h.deps.config.privacyNoticeVersion = "privacy-notice.v2";
    try {
      await handleNoticeReadButton(
        h.deps,
        seed.family.id,
        readTap("3001", channelId, greetingId),
        action,
      );
    } finally {
      h.deps.config.privacyNoticeVersion = "privacy-notice.v1";
    }

    const rows = await noticeRows();
    expect(rows.map((row) => row.textVersion)).toEqual([
      "privacy-notice.v1",
      "privacy-notice.v1",
      "privacy-notice.v2",
    ]);
    expect(rows[0]?.memberId).toBe(seed.organiser.id);
  });

  it("keeps her name out of every adult's proof, and hashes the greeting the group received after her No", async () => {
    const { seed, channelId, greetingId, greetingSha256 } = await linkedFamily({ invited: true });
    const action = { type: "notice_read", familyChannelId: channelId } as const;
    const her = seed.memberLink.externalId;

    await handleNoticeReadButton(
      h.deps,
      seed.family.id,
      readTap("3001", channelId, greetingId, "Sam"),
      action,
    );
    await handleConsentButton(
      h.deps,
      groupEvent({
        kind: "button",
        user: her,
        conversation: { externalId: her, kind: "private" },
        messageId: "1",
        buttonData: encodeButton({ type: "consent", memberId: seed.member.id, accept: false }),
        callbackId: "cb-her",
      }),
      { type: "consent", memberId: seed.member.id, accept: false },
    );
    await handleNoticeReadButton(
      h.deps,
      seed.family.id,
      readTap("3002", channelId, greetingId, "Lee"),
      action,
    );

    expect(await memberRow(seed.member.id)).toBeUndefined();
    const proof = { chat_id: GROUP, message_id: greetingId, text_sha256: greetingSha256 };
    expect((await noticeRows()).map((row) => row.evidence)).toEqual([proof, proof]);
    expect(JSON.stringify(await h.db.select().from(consents))).not.toContain("Mom");
  });

  it("records nothing for a user linked to another family, a button of another family's group, or a family that has ended", async () => {
    const { seed, channelId, greetingId } = await linkedFamily();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      familyName: "The Lins",
      organiserExternalId: "1101",
      memberExternalId: "2101",
    });
    const otherGroup = await seedLinkedGroup(h.db, other, {
      now: h.clock.now(),
      conversationId: "-100900",
    });
    const action = { type: "notice_read", familyChannelId: channelId } as const;

    await handleNoticeReadButton(
      h.deps,
      seed.family.id,
      readTap("1101", channelId, greetingId),
      action,
    );
    await handleNoticeReadButton(
      h.deps,
      seed.family.id,
      readTap("3001", otherGroup.id, greetingId),
      { type: "notice_read", familyChannelId: otherGroup.id },
    );
    await h.db
      .update(members)
      .set({ status: "deceased", lightOn: false })
      .where(eq(members.id, seed.member.id));
    await handleNoticeReadButton(
      h.deps,
      seed.family.id,
      readTap("3001", channelId, greetingId),
      action,
    );

    expect(await noticeRows()).toEqual([]);
    expect(
      await h.db.select().from(members).where(eq(members.familyId, seed.family.id)),
    ).toHaveLength(2);
    expect(h.telegram.acknowledged).toHaveLength(3);
  });

  it("never holds back an ask from a family member who has not tapped it", async () => {
    const { seed } = await linkedFamily();
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "3001",
    });

    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "text", user: "3001", text: "/ask What did you cook?" }),
      seed.family.id,
      sam.member.id,
    );

    expect(await noticeRows()).toEqual([]);
    const asked = await h.db.select().from(exchanges).where(eq(exchanges.askerId, sam.member.id));
    expect(asked.map((row) => row.text)).toEqual(["What did you cook?"]);
  });
});

describe("handleBotRemoved", () => {
  it("ends the link and keeps the row as history; a repeat changes nothing", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    h.clock.advanceMinutes(10);

    await handleBotRemoved(h.deps, botRemoved(seed.organiserLink.externalId));
    const at = h.clock.now();
    h.clock.advanceMinutes(10);
    await handleBotRemoved(h.deps, botRemoved(seed.organiserLink.externalId));

    const rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unlinkedAt).toEqual(at);
    expect(await familyByLinkedGroup(h.db, "telegram", GROUP)).toBeNull();
  });

  it("does nothing for a group that was never linked", async () => {
    await seedFamily(h.db, { now: h.clock.now() });

    await handleBotRemoved(h.deps, botRemoved("1001"));

    expect(await links()).toHaveLength(0);
  });
});

describe("handleGroupMigrated", () => {
  it("moves the link, the group's message refs, and its queued sends to the new id, once", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    await h.db.insert(messageRefs).values({
      channel: "telegram",
      conversationId: GROUP,
      messageId: "10",
      familyId: seed.family.id,
      memberId: seed.member.id,
      localDate: "2026-09-15",
      purpose: "turn_prompt",
    });
    await enqueueOutbound(h.deps, h.db, {
      kind: "system",
      idempotencyKey: outboundKey("system", { conversationId: GROUP, suffix: "test" }),
      memberId: seed.organiser.id,
      channel: "telegram",
      conversationId: GROUP,
      lang: "en",
      text: "Hello",
    });

    await handleGroupMigrated(h.deps, migrated(GROUP, "-1001000"));
    // Telegram posts the notice in both chats, so the move arrives again.
    await handleGroupMigrated(h.deps, migrated(GROUP, "-1001000"));

    const rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conversationId: "-1001000", unlinkedAt: null });
    expect((await familyByLinkedGroup(h.db, "telegram", "-1001000"))?.family.id).toBe(
      seed.family.id,
    );
    expect(await familyByLinkedGroup(h.db, "telegram", GROUP)).toBeNull();
    const refs = await h.db.select().from(messageRefs);
    expect(refs.map((ref) => [ref.conversationId, ref.messageId])).toEqual([["-1001000", "10"]]);
    const [queued] = await outboundRows();
    expect(queued?.conversationId).toBe("-1001000");
    await h.run(handlers());
    expect(h.telegram.sentTo("-1001000")).toHaveLength(1);
  });

  it("moves nothing for a group that is not linked", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });

    await handleGroupMigrated(h.deps, migrated("-100999", "-1001999"));

    expect((await links())[0]?.conversationId).toBe(GROUP);
  });
});

describe("handleMemberLeft", () => {
  async function linkedScene(): Promise<{
    seed: SeededFamily;
    sam: Awaited<ReturnType<typeof seedGroupMember>>;
  }> {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
    });
    return { seed, sam };
  }

  it("marks a member who leaves as left, out of the rotation, and sends nothing", async () => {
    const { seed, sam } = await linkedScene();
    h.clock.advanceMinutes(30);
    const left = memberLeft(sam.link.externalId);

    await handleMemberLeft(h.deps, seed.family.id, left);

    expect(await memberRow(sam.member.id)).toMatchObject({
      status: "left",
      leftAt: new Date(left.at),
      turnsIn: false,
    });
    const rows = await eventRows();
    expect(rows.map((row) => [row.name, row.memberId, row.props])).toEqual([
      ["member_left", sam.member.id, { reason: "left_group", removed: false }],
    ]);
    expect(await outboundRows()).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
  });

  it("records who removed a member, and changes nothing on a second report", async () => {
    const { seed, sam } = await linkedScene();
    const removed = memberLeft(sam.link.externalId, seed.organiserLink.externalId);

    await handleMemberLeft(h.deps, seed.family.id, removed);
    h.clock.advanceMinutes(5);
    await handleMemberLeft(h.deps, seed.family.id, removed);
    await handleMemberLeft(h.deps, seed.family.id, memberLeft(sam.link.externalId));

    expect((await memberRow(sam.member.id))?.leftAt).toEqual(new Date(removed.at));
    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.props).toEqual({ reason: "left_group", removed: true });
  });

  it("keeps an organiser who leaves as they are and tells the founder once, with no content", async () => {
    const { seed } = await linkedScene();
    const left = memberLeft(seed.organiserLink.externalId);

    await handleMemberLeft(h.deps, seed.family.id, left);
    await handleMemberLeft(h.deps, seed.family.id, left);

    expect(await memberRow(seed.organiser.id)).toMatchObject({
      status: "active",
      leftAt: null,
      turnsIn: true,
    });
    const rows = await eventRows();
    expect(rows.map((row) => row.name)).toEqual(["member_left_group"]);
    expect(rows[0]).toMatchObject({ familyId: seed.family.id, memberId: seed.organiser.id });
    expect(rows[0]?.props).toMatchObject({ role: "organiser", kept_light: false, removed: false });
    const notices = await outboundRows();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "system", conversationId: ADMIN });
    await h.run(handlers());
    expect(h.telegram.sentTo(ADMIN).map((entry) => entry.message.text)).toEqual([
      "Mia left the family group in The Chens. Nothing changed for them.",
    ]);
    expect(h.telegram.sentTo(GROUP)).toHaveLength(0);
  });

  // The admin conversation is the founder's Telegram chat whatever channel the group is on
  // (flows §3.14); a row addressed to it on the group's channel would never reach him.
  it("tells the founder on the admin channel when the group is on another", async () => {
    const { seed } = await linkedScene();
    await h.db.insert(channelLinks).values({
      memberId: seed.organiser.id,
      channel: "line",
      externalId: "L1001",
      displayName: seed.organiser.displayName,
      linkedAt: h.clock.now(),
    });

    await handleMemberLeft(h.deps, seed.family.id, {
      ...memberLeft("L1001"),
      channel: "line",
    });

    const notices = await outboundRows();
    expect(notices.map((row) => [row.kind, row.channel, row.conversationId])).toEqual([
      ["system", "telegram", ADMIN],
    ]);
  });

  it("keeps the kept-light member who leaves as she is and tells the founder", async () => {
    const { seed } = await linkedScene();

    await handleMemberLeft(h.deps, seed.family.id, memberLeft(seed.memberLink.externalId));

    expect(await memberRow(seed.member.id)).toMatchObject({
      status: "active",
      lightOn: true,
      leftAt: null,
    });
    const rows = await eventRows();
    expect(rows.map((row) => row.name)).toEqual(["member_left_group"]);
    expect(rows[0]?.props).toMatchObject({ role: "member", kept_light: true });
    await h.run(handlers());
    expect(h.telegram.sentTo(ADMIN).map((entry) => entry.message.text)).toEqual([
      "Mom left the family group in The Chens. Nothing changed for them.",
    ]);
  });

  it("records the departure without a message when no admin conversation is configured", async () => {
    const { seed } = await linkedScene();
    const configured = h.config.adminConversationId;
    h.config.adminConversationId = null;
    try {
      await handleMemberLeft(h.deps, seed.family.id, memberLeft(seed.organiserLink.externalId));
    } finally {
      h.config.adminConversationId = configured;
    }

    expect((await eventRows()).map((row) => row.name)).toEqual(["member_left_group"]);
    expect(await outboundRows()).toHaveLength(0);
  });

  it("stores nothing for a person with no link, another bot, or another family's member", async () => {
    const { seed } = await linkedScene();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "7001",
      memberExternalId: "7002",
    });

    await handleMemberLeft(h.deps, seed.family.id, memberLeft("4242"));
    await handleMemberLeft(h.deps, seed.family.id, memberLeft("777000"));
    await handleMemberLeft(h.deps, seed.family.id, memberLeft(other.organiserLink.externalId));
    await handleMemberLeft(
      h.deps,
      seed.family.id,
      groupEvent({ kind: "member_left", user: "4242" }),
    );

    expect(await eventRows()).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
    // Three in the linked family, two in the other: nobody new.
    expect(await h.db.select().from(members)).toHaveLength(5);
    expect((await memberRow(other.organiser.id))?.status).toBe("active");
  });
});

describe("resolveGroupSender", () => {
  it("creates a member on their first act, in the family's language and her zone, once", async () => {
    const seed = await seedFamily(h.db, {
      now: h.clock.now(),
      language: "zh-TW",
      timeZone: "Asia/Taipei",
    });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });

    const created = await resolveGroupSender(h.deps, seed.family.id, groupText("1003", "Lee"));
    const again = await resolveGroupSender(h.deps, seed.family.id, groupText("1003", "Lee"));

    expect(created).toMatchObject({
      familyId: seed.family.id,
      role: "member",
      displayName: "Lee",
      language: "zh-TW",
      tz: "Asia/Taipei",
      country: "TW",
      status: "active",
      turnsIn: true,
      primarySurface: "telegram",
      lightOn: false,
    });
    expect(again?.id).toBe(created?.id);
    const [link] = await h.db
      .select()
      .from(channelLinks)
      .where(eq(channelLinks.externalId, "1003"));
    expect(link).toMatchObject({ memberId: created?.id, displayName: "Lee" });
    const rows = await eventRows();
    expect(rows.map((row) => [row.name, row.props])).toEqual([
      ["member_joined", { rejoined: false }],
    ]);
  });

  it("makes a member who left active again when they act, with their turn back", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
    });
    await handleMemberLeft(h.deps, seed.family.id, memberLeft(sam.link.externalId));
    h.clock.advanceMinutes(60);

    const back = await resolveGroupSender(h.deps, seed.family.id, groupText("1002", "Sam"));
    await resolveGroupSender(h.deps, seed.family.id, groupText("1002", "Sam"));

    expect(back).toMatchObject({
      id: sam.member.id,
      status: "active",
      leftAt: null,
      turnsIn: true,
    });
    expect(await memberRow(sam.member.id)).toMatchObject({
      status: "active",
      leftAt: null,
      turnsIn: true,
    });
    const rows = await eventRows();
    expect(rows.map((row) => [row.name, row.props])).toEqual([
      ["member_left", { reason: "left_group", removed: false }],
      ["member_joined", { rejoined: true }],
    ]);
    expect(await h.db.select().from(members)).toHaveLength(3);
  });

  it("returns an organiser and the kept-light member as they are, and null for another family's member", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "7001",
      memberExternalId: "7002",
    });

    const organiser = await resolveGroupSender(
      h.deps,
      seed.family.id,
      groupText(seed.organiserLink.externalId, "Mia"),
    );
    const her = await resolveGroupSender(
      h.deps,
      seed.family.id,
      groupText(seed.memberLink.externalId, "Mom"),
    );
    const stranger = await resolveGroupSender(h.deps, seed.family.id, groupText("7001", "Other"));

    expect(organiser?.id).toBe(seed.organiser.id);
    expect(her?.id).toBe(seed.member.id);
    expect(stranger).toBeNull();
    expect(await eventRows()).toHaveLength(0);
    expect((await memberRow(other.organiser.id))?.familyId).toBe(other.family.id);
  });
});
