import type { InboundEvent, LocalDate, MediaRef } from "@vela/contracts";
import {
  type ChannelLink,
  events,
  exchanges,
  type MessageRef,
  media,
  members,
  messageRefs,
  replies,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleGroupReply, handleReaction } from "./replies.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedLinkedGroup,
} from "./testing/seed.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  messages = 0;
});

afterAll(async () => {
  await h.close();
});

const TODAY: LocalDate = "2026-09-14";
const GROUP = "-100500";
/** The group message that carries her answer post. */
const ANSWER_POST = "10";

const VOICE: MediaRef = {
  kind: "audio",
  providerFileId: "reply-voice-1",
  providerUniqueId: "u-reply-voice-1",
  mime: "audio/ogg",
};

let messages = 0;

/** A message in the family group from `link`, replying to `replyTo`. */
function groupEvent(
  link: ChannelLink,
  extra: Partial<InboundEvent> & { kind: InboundEvent["kind"] },
): InboundEvent {
  messages += 1;
  return {
    channel: "telegram",
    eventId: `tg:${messages}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: link.externalId },
    conversation: { externalId: GROUP, kind: "group" },
    messageId: String(10 + messages),
    replyToMessageId: ANSWER_POST,
    ...extra,
  };
}

interface Scene {
  seed: SeededFamily;
  anna: { member: SeededFamily["organiser"]; link: ChannelLink };
  exchangeId: string;
  ref: MessageRef;
}

/** Her answer to today's question is in the group as message 10; Anna is a family member. */
async function answeredMorning(): Promise<Scene> {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
  const anna = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Anna",
    externalId: "1003",
  });
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    state: "answered",
    deliveredAt: h.clock.now(),
    answeredAt: new Date(h.clock.now().getTime() + 12 * 60_000),
  });
  const [ref] = await h.db
    .insert(messageRefs)
    .values({
      channel: "telegram",
      conversationId: GROUP,
      messageId: ANSWER_POST,
      familyId: seed.family.id,
      exchangeId: exchange.id,
      memberId: seed.member.id,
      purpose: "answer_post",
    })
    .returning();
  if (ref === undefined) {
    throw new Error("ref not inserted");
  }
  h.clock.advanceMinutes(45);
  return { seed, anna, exchangeId: exchange.id, ref };
}

async function replyRows() {
  return h.db.select().from(replies).orderBy(asc(replies.createdAt), asc(replies.id));
}

async function eventRows() {
  return h.db.select().from(events).orderBy(asc(events.id));
}

async function exchangeById(id: string) {
  const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, id));
  return row;
}

describe("handleGroupReply", () => {
  it("stores a text reply to an answer post once, moves the exchange to replied, and records the event", async () => {
    const { seed, anna, exchangeId, ref } = await answeredMorning();
    const event = groupEvent(anna.link, { kind: "text", text: " Sounds lovely, Mom " });

    await handleGroupReply(h.deps, seed.family.id, anna.member.id, event, ref);
    await handleGroupReply(h.deps, seed.family.id, anna.member.id, event, ref);

    const rows = await replyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      exchangeId,
      memberId: anna.member.id,
      kind: "text",
      text: "Sounds lovely, Mom",
      mediaId: null,
      channel: "telegram",
      externalId: `${GROUP}:11`,
      toRecipient: true,
      readBackAt: null,
      createdAt: h.clock.now(),
    });
    const exchange = await exchangeById(exchangeId);
    expect(exchange?.state).toBe("replied");
    expect(exchange?.repliedAt).toEqual(h.clock.now());
    const recorded = await eventRows();
    expect(recorded.map((row) => [row.name, row.props])).toEqual([
      ["reply_posted", { kind: "text", by: anna.member.id }],
    ]);
    expect(recorded[0]?.exchangeId).toBe(exchangeId);
    expect(h.logger.entries.map((entry) => entry.event)).toContain("reply_duplicate");
  });

  it("stores a voice reply with its file, and a photo reply with its caption", async () => {
    const { seed, anna, ref } = await answeredMorning();

    await handleGroupReply(
      h.deps,
      seed.family.id,
      anna.member.id,
      groupEvent(anna.link, { kind: "voice", media: VOICE }),
      ref,
    );
    await handleGroupReply(
      h.deps,
      seed.family.id,
      anna.member.id,
      groupEvent(anna.link, {
        kind: "image",
        text: "Look who came by",
        media: { kind: "image", providerFileId: "reply-photo-1", providerUniqueId: "u-photo-1" },
      }),
      ref,
    );

    const files = await h.db.select().from(media).orderBy(asc(media.createdAt), asc(media.id));
    expect(files.map((row) => [row.kind, row.uploadedBy, row.providerFileId])).toEqual([
      ["audio", anna.member.id, "reply-voice-1"],
      ["image", anna.member.id, "reply-photo-1"],
    ]);
    const rows = await replyRows();
    expect(rows.map((row) => [row.kind, row.text, row.mediaId])).toEqual([
      ["voice", null, files[0]?.id],
      ["photo", "Look who came by", files[1]?.id],
    ]);
    // The second reply finds the exchange already replied and leaves its time alone.
    expect((await eventRows()).map((row) => row.name)).toEqual(["reply_posted", "reply_posted"]);
  });

  it("ignores a sticker, a reply to a message of another purpose, and one from another family, storing and logging nothing", async () => {
    const { seed, anna, ref } = await answeredMorning();
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "7001",
      memberExternalId: "7002",
    });

    await handleGroupReply(
      h.deps,
      seed.family.id,
      anna.member.id,
      groupEvent(anna.link, { kind: "sticker" }),
      ref,
    );
    await handleGroupReply(
      h.deps,
      seed.family.id,
      anna.member.id,
      groupEvent(anna.link, { kind: "text", text: "What should we ask?" }),
      { ...ref, purpose: "turn_prompt" },
    );
    await handleGroupReply(
      h.deps,
      other.family.id,
      other.organiser.id,
      groupEvent(other.organiserLink, { kind: "text", text: "Hello" }),
      ref,
    );

    expect(await replyRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
    expect(await h.db.select().from(media)).toHaveLength(0);
    expect(h.logger.entries).toHaveLength(0);
  });

  it("ignores replies and reactions once the kept-light member is left or deceased or the family is being deleted", async () => {
    const { seed, anna, exchangeId, ref } = await answeredMorning();
    await h.db
      .update(members)
      .set({ status: "deceased", lightOn: false })
      .where(eq(members.id, seed.member.id));

    await handleGroupReply(
      h.deps,
      seed.family.id,
      anna.member.id,
      groupEvent(anna.link, { kind: "text", text: "Miss you" }),
      ref,
    );
    await handleReaction(
      h.deps,
      seed.family.id,
      anna.member.id,
      groupEvent(anna.link, { kind: "reaction", messageId: ANSWER_POST, reactions: ["❤️"] }),
      ref,
    );

    expect(await replyRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
    expect((await exchangeById(exchangeId))?.state).toBe("answered");
    expect(h.logger.entries.map((entry) => entry.event)).toEqual([
      "reply_ignored",
      "reaction_ignored",
    ]);
  });
});

describe("handleReaction", () => {
  function reaction(link: ChannelLink, reactions: string[]): InboundEvent {
    return groupEvent(link, {
      kind: "reaction",
      messageId: ANSWER_POST,
      replyToMessageId: undefined,
      reactions,
    });
  }

  it("makes the member's reaction rows equal to the mapped set, ignoring unmapped emoji, and records nothing for a repeat", async () => {
    const { seed, anna, exchangeId, ref } = await answeredMorning();
    const kinds = async () => (await replyRows()).map((row) => row.kind).sort();

    await handleReaction(
      h.deps,
      seed.family.id,
      anna.member.id,
      reaction(anna.link, ["❤️", "😂", "🎉"]),
      ref,
    );
    expect(await kinds()).toEqual(["heart", "laugh"]);
    expect((await exchangeById(exchangeId))?.state).toBe("replied");
    expect((await eventRows()).map((row) => row.props)).toEqual([
      { kind: "reaction", added: 2, removed: 0, by: anna.member.id },
    ]);

    await handleReaction(
      h.deps,
      seed.family.id,
      anna.member.id,
      reaction(anna.link, ["😂", "🤗"]),
      ref,
    );
    expect(await kinds()).toEqual(["hug", "laugh"]);
    expect((await eventRows()).map((row) => row.props)).toEqual([
      { kind: "reaction", added: 2, removed: 0, by: anna.member.id },
      { kind: "reaction", added: 1, removed: 1, by: anna.member.id },
    ]);

    await handleReaction(
      h.deps,
      seed.family.id,
      anna.member.id,
      reaction(anna.link, ["😂", "🤗"]),
      ref,
    );
    expect(await kinds()).toEqual(["hug", "laugh"]);
    expect(await eventRows()).toHaveLength(2);

    await handleReaction(h.deps, seed.family.id, anna.member.id, reaction(anna.link, ["🎉"]), ref);
    expect(await kinds()).toEqual([]);
    expect(await eventRows()).toHaveLength(2);
  });

  it("keeps each member's reactions apart and every row addressed to her", async () => {
    const { seed, anna, exchangeId, ref } = await answeredMorning();
    const sam = await seedGroupMember(h.db, seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1004",
    });

    await handleReaction(h.deps, seed.family.id, anna.member.id, reaction(anna.link, ["👍"]), ref);
    await handleReaction(
      h.deps,
      seed.family.id,
      sam.member.id,
      reaction(sam.link, ["🥰", "😆"]),
      ref,
    );
    await handleReaction(h.deps, seed.family.id, anna.member.id, reaction(anna.link, []), ref);

    const rows = await replyRows();
    expect(rows.map((row) => [row.memberId, row.kind]).sort()).toEqual(
      [
        [sam.member.id, "heart"],
        [sam.member.id, "laugh"],
      ].sort(),
    );
    expect(rows.every((row) => row.toRecipient && row.exchangeId === exchangeId)).toBe(true);
    expect(rows.every((row) => row.externalId === null)).toBe(true);
  });

  it("ignores a reaction on a message that is not an answer post", async () => {
    const { seed, anna, ref } = await answeredMorning();

    await handleReaction(h.deps, seed.family.id, anna.member.id, reaction(anna.link, ["❤️"]), {
      ...ref,
      purpose: "turn_prompt",
    });

    expect(await replyRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
    expect(h.logger.entries).toHaveLength(0);
  });
});
