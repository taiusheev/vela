/**
 * The routing table of flows §5: which flow each event belongs to, and, as much as that, what the
 * router refuses to do. A group message that is not an ask, a reply, or a reaction leaves no trace
 * at all; a message from her before she has consented leaves none either; a stranger gets one line
 * about how to begin, and a person Vela knows gets it through the gateway.
 */
import type { InboundEvent, InboundKind, LocalDate } from "@vela/contracts";
import { t } from "@vela/copy";
import { encodeButton } from "@vela/core";
import {
  answers,
  consents,
  events,
  exchanges,
  families,
  familyChannels,
  invites,
  members,
  messageRefs,
  outbound,
  replies,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps, OutboundJob } from "../deps.ts";
import { deliverOutbound } from "../gateway.ts";
import { createHarness, type Harness } from "../testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedLinkedGroup } from "../testing/seed.ts";
import { handleInbound } from "./router.ts";

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
const STRANGER = "4001";
const GROUP = "-100500";
const OTHER_GROUP = "-100777";
const TODAY: LocalDate = "2026-09-14";
const ANSWER_POST_MESSAGE = "901";

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
    sender: { externalUserId: user, displayName: "Sam", languageCode: "en" },
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

function inGroup(
  user: string,
  extra: Partial<InboundEvent> & { kind: InboundKind },
  conversationId = GROUP,
): InboundEvent {
  return event(user, { id: conversationId, kind: "group" }, extra);
}

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

async function inbound(...batch: InboundEvent[]): Promise<void> {
  await handleInbound(h.deps, batch);
  await h.run(handlers());
}

interface Scene {
  seed: SeededFamily;
  exchangeId: string;
}

/** Her family with its group and this morning delivered, with the post under her answer mapped. */
async function scene(): Promise<Scene> {
  const now = h.clock.now();
  const seed = await seedFamily(h.db, { now });
  await seedLinkedGroup(h.db, seed, { now });
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    state: "delivered",
    deliveredAt: now,
  });
  await h.db.insert(messageRefs).values({
    channel: "telegram",
    conversationId: GROUP,
    messageId: ANSWER_POST_MESSAGE,
    familyId: seed.family.id,
    exchangeId: exchange.id,
    memberId: seed.member.id,
    purpose: "answer_post",
  });
  return { seed, exchangeId: exchange.id };
}

async function memberCount(): Promise<number> {
  return (await h.db.select().from(members)).length;
}

describe("the private chat", () => {
  it("tells the founder once when the family's last organiser blocks the bot, and not for her", async () => {
    const { seed } = await scene();
    const founder = h.deps.config.adminConversationId ?? "";

    // Her block matters to her morning, not to who can be told of it.
    await inbound(privately(HER, { kind: "blocked" }));
    expect(h.telegram.sentTo(founder)).toEqual([]);

    // Mia was the only organiser: from now on nobody hears when her light goes quiet.
    await inbound(privately(ORGANISER, { kind: "blocked" }));
    await inbound(privately(ORGANISER, { kind: "blocked" }));

    expect(h.telegram.sentTo(founder).map((sent) => sent.message.text)).toEqual([
      `Mia can no longer be told anything in The Chens, and no other organiser can: nobody will hear if a light there goes quiet. Open: https://vela.test/admin/families/${seed.family.id}`,
    ]);
  });

  it("answers a stranger with how to begin, directly, and a member of a family through the gateway", async () => {
    const { seed } = await scene();

    await inbound(privately(STRANGER, { kind: "text", text: "hello?" }));
    expect(h.telegram.sentTo(STRANGER).map((entry) => entry.message.text)).toEqual([
      t("en", "help.private"),
    ]);
    expect(await h.db.select().from(outbound)).toHaveLength(0);

    await inbound(privately(ORGANISER, { kind: "text", text: "how do I add my sister?" }));
    expect(h.telegram.sentTo(ORGANISER).map((entry) => entry.message.text)).toEqual([
      t("en", "help.private"),
    ]);
    const rows = await h.db.select().from(outbound);
    expect(rows.map((row) => [row.memberId, row.kind])).toEqual([[seed.organiser.id, "system"]]);
  });

  it("ignores everything she sends while she is only invited", async () => {
    const { seed } = await scene();
    await h.db
      .update(members)
      .set({ status: "invited", lightOn: false, lightConsentedAt: null })
      .where(eq(members.id, seed.member.id));

    await inbound(
      privately(HER, { kind: "text", text: "Is anyone there?" }),
      privately(HER, { kind: "text", text: "stop" }),
    );

    expect(await h.db.select().from(answers)).toHaveLength(0);
    expect(await h.db.select().from(outbound)).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
    expect(await h.db.select().from(events)).toHaveLength(0);
  });

  it("acknowledges and otherwise ignores a tap it cannot read and an answer tap from anyone but her", async () => {
    const { exchangeId } = await scene();

    await inbound(
      privately(HER, { kind: "button", buttonData: "not-a-payload", callbackId: "cb1" }),
      privately(ORGANISER, {
        kind: "button",
        buttonData: encodeButton({ type: "answer", exchangeId, answer: "fine" }),
        callbackId: "cb2",
      }),
      privately(STRANGER, {
        kind: "button",
        buttonData: encodeButton({ type: "answer", exchangeId, answer: "fine" }),
        callbackId: "cb3",
      }),
    );

    expect(h.telegram.acknowledged.map((tap) => tap.callbackId)).toEqual(["cb1", "cb2", "cb3"]);
    expect(await h.db.select().from(answers)).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
  });
});

describe("the consent buttons", () => {
  /** She opened her invite and has not answered: linked, invited, no consent. */
  async function invited(): Promise<Scene> {
    const found = await scene();
    const { seed } = found;
    await h.db.delete(consents).where(eq(consents.memberId, seed.member.id));
    await h.db
      .update(members)
      .set({ status: "invited", lightOn: false, lightConsentedAt: null, lightConsentText: null })
      .where(eq(members.id, seed.member.id));
    await h.db.insert(invites).values({
      familyId: seed.family.id,
      invitedBy: seed.organiser.id,
      forMemberId: seed.member.id,
      token: "her-token",
      createdAt: h.clock.now(),
      expiresAt: new Date(h.clock.now().getTime() + 7 * 86_400_000),
      acceptedAt: h.clock.now(),
    });
    return found;
  }

  it("answers her as a stranger after she taps No: help.private once per message, and nothing stored", async () => {
    const { seed } = await invited();

    await inbound(
      privately(HER, {
        kind: "button",
        buttonData: encodeButton({ type: "consent", memberId: seed.member.id, accept: false }),
        callbackId: "cb1",
      }),
    );
    const people = await memberCount();
    const sentBefore = h.telegram.sentTo(HER).length;
    await inbound(
      privately(HER, { kind: "text", text: "Hello?" }),
      privately(HER, { kind: "voice", media: { kind: "audio", providerFileId: "v-1" } }),
      privately(HER, { kind: "text", text: "stop" }),
    );

    expect(await memberCount()).toBe(people);
    expect(await h.db.select().from(members).where(eq(members.id, seed.member.id))).toEqual([]);
    expect(await h.db.select().from(answers)).toHaveLength(0);
    expect(await h.db.select().from(outbound).where(eq(outbound.conversationId, HER))).toEqual([]);
    expect(
      h.telegram
        .sentTo(HER)
        .slice(sentBefore)
        .map((entry) => entry.message.text),
    ).toEqual([t("en", "help.private"), t("en", "help.private"), t("en", "help.private")]);
  });

  it("hands her tap on the health-words question to its handler, and only acknowledges a notice button in a private chat", async () => {
    const { seed } = await scene();

    await inbound(
      privately(HER, {
        kind: "button",
        buttonData: encodeButton({ type: "health_words", memberId: seed.member.id, accept: true }),
        callbackId: "cb1",
      }),
      privately(HER, {
        kind: "button",
        buttonData: encodeButton({ type: "notice_read", familyChannelId: seed.member.id }),
        callbackId: "cb2",
      }),
    );

    expect(h.telegram.acknowledged.map((tap) => tap.callbackId)).toEqual(["cb1", "cb2"]);
    const rows = await h.db.select().from(consents).orderBy(asc(consents.kind));
    expect(rows.map((row) => [row.kind, row.answer])).toEqual([
      ["health_words", "yes"],
      ["light", "yes"],
    ]);
    expect(h.telegram.sent).toHaveLength(0);
  });
});

describe("the family group", () => {
  it("drops a message that is not an ask, a reply, or a reaction, storing and logging nothing of it", async () => {
    await scene();
    const before = await memberCount();

    await inbound(
      inGroup(STRANGER, { kind: "text", text: "shall we meet on Sunday?" }),
      inGroup(STRANGER, { kind: "image", text: "the cat again" }),
    );

    expect(await memberCount()).toBe(before);
    expect(await h.db.select().from(exchanges)).toHaveLength(1);
    expect(await h.db.select().from(replies)).toHaveLength(0);
    expect(await h.db.select().from(events)).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
    // The family's own conversation never reaches a log line.
    expect(JSON.stringify(h.logger.entries)).not.toContain("Sunday");
  });

  it("ignores a reply to a message that was not one of Vela's", async () => {
    await scene();

    await inbound(inGroup(STRANGER, { kind: "text", text: "Lovely!", replyToMessageId: "12345" }));

    expect(await h.db.select().from(replies)).toHaveLength(0);
    expect(await memberCount()).toBe(2);
  });

  it("ignores a group Vela is not linked to, departures included", async () => {
    await scene();

    await inbound(
      inGroup(ORGANISER, { kind: "text", text: "/ask How are you?" }, OTHER_GROUP),
      inGroup(
        ORGANISER,
        { kind: "member_left", subject: { externalUserId: HER, displayName: "Mom" } },
        OTHER_GROUP,
      ),
    );

    expect(await h.db.select().from(exchanges)).toHaveLength(1);
    expect(await h.db.select().from(events)).toHaveLength(0);
  });

  it("ignores the group once the family's deletion has been requested", async () => {
    const { seed } = await scene();
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    const before = await memberCount();

    await inbound(
      inGroup(ORGANISER, { kind: "text", text: "/ask How is the garden?" }),
      inGroup(STRANGER, {
        kind: "text",
        text: "Lovely!",
        replyToMessageId: ANSWER_POST_MESSAGE,
      }),
    );

    expect(await h.db.select().from(exchanges)).toHaveLength(1);
    expect(await h.db.select().from(replies)).toHaveLength(0);
    expect(await memberCount()).toBe(before);
    expect(h.telegram.sent).toHaveLength(0);
  });
});

describe("the family group's buttons", () => {
  it("hands a tap on the notice button to its handler, and only acknowledges any other tap there", async () => {
    const { seed, exchangeId } = await scene();
    const [group] = await h.db.select().from(familyChannels);

    await inbound(
      inGroup(ORGANISER, {
        kind: "button",
        buttonData: encodeButton({ type: "notice_read", familyChannelId: group?.id ?? "" }),
        callbackId: "cb1",
      }),
      inGroup(ORGANISER, {
        kind: "button",
        buttonData: encodeButton({ type: "answer", exchangeId, answer: "fine" }),
        callbackId: "cb2",
      }),
    );

    expect(h.telegram.acknowledged.map((tap) => tap.callbackId)).toEqual(["cb1", "cb2"]);
    const rows = await h.db.select().from(consents).where(eq(consents.kind, "privacy_notice"));
    expect(rows.map((row) => row.memberId)).toEqual([seed.organiser.id]);
    expect(await h.db.select().from(answers)).toHaveLength(0);
    expect(h.telegram.sent).toHaveLength(0);
  });
});

describe("a batch", () => {
  it("carries on after an event that throws, and reports the failure once it is done", async () => {
    await scene();
    // An adapter nobody can reach: the stranger's one line cannot go out. Its message repeats
    // what was written, as a failed query's message lists its parameters.
    const broken: Deps = {
      ...h.deps,
      channels: {
        get: () => {
          throw new Error("Failed query: insert\nparams: hello?");
        },
      },
    };

    await expect(
      handleInbound(broken, [
        privately(STRANGER, { kind: "text", text: "hello?" }),
        inGroup(STRANGER, {
          kind: "text",
          text: "Lovely!",
          replyToMessageId: ANSWER_POST_MESSAGE,
        }),
      ]),
    ).rejects.toThrow("params: hello?");

    // The reply behind the failing event was still stored.
    expect(await h.db.select().from(replies)).toHaveLength(1);
    // The log names the failure and never repeats the words inside its message.
    expect(
      h.logger.entries
        .filter((entry) => entry.event === "inbound_failed")
        .map((entry) => entry.fields),
    ).toEqual([{ kind: "text", conversation: "private", error: "Error" }]);
  });
});
