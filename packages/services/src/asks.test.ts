import type { InboundEvent, LocalDate, MediaRef } from "@vela/contracts";
import { t } from "@vela/copy";
import {
  events,
  exchanges,
  families,
  media,
  members,
  messageRefs,
  outbound,
  turns,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AskTarget, handleAskCommand, handleGroupAsk, parseAskCommand } from "./asks.ts";
import type { OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
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
});

afterAll(async () => {
  await h.close();
});

const GROUP = "-100500";
/** The prompt's message in the group, which the family replies to. */
const PROMPT_MESSAGE = "10";
const SAM = "1002";
/** The clock starts at 08:00 Taipei on 14 September, so tomorrow is the 15th. */
const TOMORROW: LocalDate = "2026-09-15";

interface Scene {
  seed: SeededFamily;
  sam: Awaited<ReturnType<typeof seedGroupMember>>;
  target: AskTarget;
}

/** The family group with tonight's prompt for Sam already posted. */
async function scene(options: { conversationId?: string; ids?: string[] } = {}): Promise<Scene> {
  const [organiserId, memberId, samId] = options.ids ?? ["1001", "2001", SAM];
  const seed = await seedFamily(h.db, {
    now: h.clock.now(),
    organiserExternalId: organiserId,
    memberExternalId: memberId,
  });
  const conversationId = options.conversationId ?? GROUP;
  await seedLinkedGroup(h.db, seed, { now: h.clock.now(), conversationId });
  const sam = await seedGroupMember(h.db, seed, {
    now: h.clock.now(),
    name: "Sam",
    externalId: samId ?? SAM,
  });
  await h.db.insert(turns).values({
    familyId: seed.family.id,
    localDay: TOMORROW,
    recipientId: seed.member.id,
    holderId: sam.member.id,
    promptedAt: h.clock.now(),
    promptMessageId: PROMPT_MESSAGE,
  });
  await h.db.insert(messageRefs).values({
    channel: "telegram",
    conversationId,
    messageId: PROMPT_MESSAGE,
    familyId: seed.family.id,
    memberId: seed.member.id,
    localDate: TOMORROW,
    purpose: "turn_prompt",
  });
  return {
    seed,
    sam,
    target: {
      familyId: seed.family.id,
      recipientId: seed.member.id,
      senderId: sam.member.id,
      date: TOMORROW,
    },
  };
}

let sequence = 0;

function groupEvent(
  extra: Partial<InboundEvent> & { kind: InboundEvent["kind"] },
  user = SAM,
  conversationId = GROUP,
): InboundEvent {
  sequence += 1;
  return {
    channel: "telegram",
    eventId: `tg:${sequence}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: user, displayName: "Sam" },
    conversation: { externalId: conversationId, kind: "group" },
    messageId: String(100 + sequence),
    ...extra,
  };
}

/** A reply to the prompt. */
function reply(extra: Partial<InboundEvent> & { kind: InboundEvent["kind"] }): InboundEvent {
  return groupEvent({ replyToMessageId: PROMPT_MESSAGE, ...extra });
}

function photo(fileId: string, uniqueId = `u-${fileId}`): MediaRef {
  return { kind: "image", providerFileId: fileId, providerUniqueId: uniqueId, bytes: 1234 };
}

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

async function exchangeRows() {
  return h.db.select().from(exchanges).orderBy(asc(exchanges.createdAt), asc(exchanges.id));
}

async function mediaRows() {
  return h.db.select().from(media).orderBy(asc(media.createdAt), asc(media.id));
}

async function outboundRows() {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function eventRows() {
  return h.db.select().from(events).orderBy(asc(events.id));
}

describe("parseAskCommand", () => {
  it("reads /ask and /later, with or without the bot's name in any letter case", () => {
    expect(parseAskCommand("/ask What did you cook?", "VelaLightBot")).toEqual({
      command: "ask",
      text: "What did you cook?",
    });
    expect(
      parseAskCommand("/later@velalightbot  Tell us about the garden ", "VelaLightBot"),
    ).toEqual({
      command: "later",
      text: "Tell us about the garden",
    });
    expect(parseAskCommand("/ask", "VelaLightBot")).toEqual({ command: "ask", text: "" });
    expect(parseAskCommand("/ask@OtherBot hello", "VelaLightBot")).toBeNull();
    expect(parseAskCommand("/asking you", "VelaLightBot")).toBeNull();
    expect(parseAskCommand("ask me", "VelaLightBot")).toBeNull();
    expect(parseAskCommand(undefined, "VelaLightBot")).toBeNull();
  });
});

describe("handleGroupAsk: a reply to the prompt", () => {
  it("makes a text reply tomorrow's question, marks the turn acted, and confirms in the group", async () => {
    const { seed, sam, target } = await scene();
    h.clock.advanceMinutes(15);
    const event = reply({ kind: "text", text: " What did you cook today? " });

    await handleGroupAsk(h.deps, event, target);

    const rows = await exchangeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      familyId: seed.family.id,
      recipientId: seed.member.id,
      askerId: sam.member.id,
      type: "question",
      state: "composed",
      text: "What did you cook today?",
      textLang: "en",
      whenRule: "tomorrow",
      scheduledFor: TOMORROW,
      mediaIds: [],
      createdAt: h.clock.now(),
    });
    const [turn] = await h.db.select().from(turns);
    expect(turn?.actedAt).toEqual(h.clock.now());
    const [composed] = await eventRows();
    expect(composed).toMatchObject({
      name: "ask_composed",
      familyId: seed.family.id,
      memberId: sam.member.id,
      exchangeId: rows[0]?.id,
      props: { type: "question", when_rule: "tomorrow", source: "reply", media: 0, queued: false },
    });
    const [confirmation] = await outboundRows();
    expect(confirmation).toMatchObject({
      kind: "system",
      memberId: sam.member.id,
      conversationId: GROUP,
      exchangeId: rows[0]?.id,
    });
    await h.run(handlers());
    const [sent] = h.telegram.sentTo(GROUP);
    expect(sent?.message.text).toBe("Into Mom's morning.");
    expect(sent?.message.replyToMessageId).toBe(event.messageId);
    const refs = await h.db
      .select()
      .from(messageRefs)
      .where(eq(messageRefs.purpose, "ask_confirmation"));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      conversationId: GROUP,
      messageId: sent?.result.primaryMessageId,
      exchangeId: rows[0]?.id,
    });
  });

  it("makes a voice reply a voice note and records the file by its Telegram ids", async () => {
    const { seed, sam, target } = await scene();
    const voice: MediaRef = {
      kind: "audio",
      providerFileId: "voice-1",
      providerUniqueId: "uv-1",
      mime: "audio/ogg",
      durationMs: 9000,
      bytes: 4321,
    };

    await handleGroupAsk(h.deps, reply({ kind: "voice", media: voice }), target);

    const [file] = await mediaRows();
    expect(file).toMatchObject({
      familyId: seed.family.id,
      uploadedBy: sam.member.id,
      kind: "audio",
      channel: "telegram",
      providerFileId: "voice-1",
      providerUniqueId: "uv-1",
      mime: "audio/ogg",
      durationMs: 9000,
      bytes: 4321,
      storageKey: null,
      expiresAt: new Date(h.clock.now().getTime() + 30 * 24 * 60 * 60_000),
    });
    const [exchange] = await exchangeRows();
    expect(exchange).toMatchObject({ type: "voice_note", text: null, mediaIds: [file?.id] });
  });

  it("makes one photo a question with one image and its caption", async () => {
    const { target } = await scene();

    await handleGroupAsk(
      h.deps,
      reply({ kind: "image", text: "Which hat?", media: photo("p1") }),
      target,
    );

    const [file] = await mediaRows();
    const [exchange] = await exchangeRows();
    expect(exchange).toMatchObject({ type: "question", text: "Which hat?", mediaIds: [file?.id] });
    expect(file?.kind).toBe("image");
  });

  it("joins two photos of one album into a photo choice, whichever arrives first", async () => {
    const { target } = await scene();
    const first = reply({
      kind: "image",
      text: "Which one?",
      media: photo("p1"),
      mediaGroupId: "g1",
    });
    const second = reply({ kind: "image", media: photo("p2"), mediaGroupId: "g1" });

    await handleGroupAsk(h.deps, first, target);
    await handleGroupAsk(h.deps, second, target);

    let files = await mediaRows();
    let rows = await exchangeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "photo_choice",
      text: "Which one?",
      mediaIds: files.map((file) => file.id),
      options: { media_group_id: "g1", inbound_event_ids: [first.eventId, second.eventId] },
    });
    expect(await outboundRows()).toHaveLength(1);
    expect(await eventRows()).toHaveLength(1);

    await h.reset();
    const again = await scene();
    const late = reply({
      kind: "image",
      text: "Which one?",
      media: photo("p1"),
      mediaGroupId: "g2",
    });
    const early = reply({ kind: "image", media: photo("p2"), mediaGroupId: "g2" });
    await handleGroupAsk(h.deps, early, again.target);
    await handleGroupAsk(h.deps, late, again.target);

    files = await mediaRows();
    rows = await exchangeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "photo_choice",
      text: "Which one?",
      mediaIds: files.map((file) => file.id),
    });
    expect(files.map((file) => file.providerFileId)).toEqual(["p2", "p1"]);
    expect(await outboundRows()).toHaveLength(1);
  });

  it("keeps the first two photos of a longer album and ignores a redelivered album message", async () => {
    const { target } = await scene();
    const second = reply({ kind: "image", media: photo("p2"), mediaGroupId: "g1" });

    await handleGroupAsk(
      h.deps,
      reply({ kind: "image", media: photo("p1"), mediaGroupId: "g1" }),
      target,
    );
    await handleGroupAsk(h.deps, second, target);
    await handleGroupAsk(h.deps, second, target);
    await handleGroupAsk(
      h.deps,
      reply({ kind: "image", media: photo("p3"), mediaGroupId: "g1" }),
      target,
    );

    const rows = await exchangeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mediaIds).toHaveLength(2);
    expect((await mediaRows()).map((file) => file.providerFileId)).toEqual(["p1", "p2"]);
    expect(await outboundRows()).toHaveLength(1);
  });

  it("queues an ask for a morning that is already taken and says whose it is", async () => {
    const { seed, target } = await scene();
    const taken = await seedExchange(h.db, seed, {
      date: TOMORROW,
      state: "composed",
      createdAt: new Date(h.clock.now().getTime() - 60_000),
    });

    await handleGroupAsk(h.deps, reply({ kind: "text", text: "Sleep well?" }), target);

    const rows = await exchangeRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe(taken.id);
    expect(rows[1]).toMatchObject({
      type: "question",
      text: "Sleep well?",
      whenRule: "whenever",
      scheduledFor: null,
    });
    expect((await eventRows())[0]?.props).toMatchObject({ when_rule: "whenever", queued: true });
    await h.run(handlers());
    expect(h.telegram.sentTo(GROUP)[0]?.message.text).toBe(
      "Tomorrow already has Mia's ask. This one is saved for another morning.",
    );
  });

  it("makes a whenever ask when the prompt carries no date", async () => {
    const { target } = await scene();

    await handleGroupAsk(h.deps, reply({ kind: "text", text: "Any time" }), {
      ...target,
      date: null,
    });

    const [exchange] = await exchangeRows();
    expect(exchange).toMatchObject({ whenRule: "whenever", scheduledFor: null });
    const [turn] = await h.db.select().from(turns);
    expect(turn?.actedAt).toBeNull();
    await h.run(handlers());
    expect(h.telegram.sentTo(GROUP)[0]?.message.text).toBe("Into Mom's morning.");
  });

  it("reuses a file's media row within one family and records another family's own", async () => {
    const { target } = await scene();
    const other = await scene({ conversationId: "-100700", ids: ["7001", "7002", "7003"] });

    await handleGroupAsk(h.deps, reply({ kind: "image", media: photo("p1", "same") }), target);
    await handleGroupAsk(h.deps, reply({ kind: "image", media: photo("p1-again", "same") }), {
      ...target,
      date: null,
    });
    await handleGroupAsk(
      h.deps,
      groupEvent(
        { kind: "image", media: photo("p1", "same"), replyToMessageId: PROMPT_MESSAGE },
        "7003",
        "-100700",
      ),
      other.target,
    );

    const files = await mediaRows();
    expect(files.map((file) => [file.familyId, file.providerUniqueId])).toEqual([
      [target.familyId, "same"],
      [other.target.familyId, "same"],
    ]);
    const rows = await exchangeRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.mediaIds).toEqual([files[0]?.id]);
    expect(rows[1]?.mediaIds).toEqual([files[0]?.id]);
    expect(rows[2]?.mediaIds).toEqual([files[1]?.id]);
  });

  it("changes nothing when the same reply is delivered twice", async () => {
    const { target } = await scene();
    const event = reply({ kind: "text", text: "How are the tomatoes?" });

    await handleGroupAsk(h.deps, event, target);
    await handleGroupAsk(h.deps, event, target);

    expect(await exchangeRows()).toHaveLength(1);
    expect(await outboundRows()).toHaveLength(1);
    expect(await eventRows()).toHaveLength(1);
  });

  it("ignores a reply with nothing to ask", async () => {
    const { target } = await scene();

    await handleGroupAsk(h.deps, reply({ kind: "text", text: "   " }), target);
    await handleGroupAsk(h.deps, reply({ kind: "sticker", text: "🙂" }), target);
    await handleGroupAsk(h.deps, reply({ kind: "other", text: "a video" }), target);

    expect(await exchangeRows()).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
  });

  it("stores and sends nothing once the family has ended", async () => {
    const { seed, target } = await scene();
    await h.db
      .update(members)
      .set({ status: "deceased", lightOn: false })
      .where(eq(members.id, seed.member.id));
    await handleGroupAsk(h.deps, reply({ kind: "text", text: "Hello?" }), target);
    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "text", text: "/ask Hello?" }),
      seed.family.id,
      target.senderId,
    );

    await h.db
      .update(members)
      .set({ status: "active", lightOn: true })
      .where(eq(members.id, seed.member.id));
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    await handleGroupAsk(h.deps, reply({ kind: "text", text: "Hello?" }), target);

    expect(await exchangeRows()).toHaveLength(0);
    expect(await mediaRows()).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
  });
});

describe("handleAskCommand", () => {
  it("makes /ask tomorrow's question in her zone and /later a whenever ask", async () => {
    const { seed, sam } = await scene();

    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "text", text: "/ask What did you cook?" }),
      seed.family.id,
      sam.member.id,
    );
    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "text", text: "/later@VELALIGHTBOT Tell us about the garden" }),
      seed.family.id,
      sam.member.id,
    );

    const rows = await exchangeRows();
    expect(rows.map((row) => [row.text, row.whenRule, row.scheduledFor, row.askerId])).toEqual([
      ["What did you cook?", "tomorrow", TOMORROW, sam.member.id],
      ["Tell us about the garden", "whenever", null, sam.member.id],
    ]);
    expect((await eventRows()).map((row) => row.props.source)).toEqual(["ask", "later"]);
    const [turn] = await h.db.select().from(turns);
    expect(turn?.actedAt).toEqual(h.clock.now());
    await h.run(handlers());
    expect(h.telegram.sentTo(GROUP).map((entry) => entry.message.text)).toEqual([
      "Into Mom's morning.",
      "Into Mom's morning.",
    ]);
  });

  it("takes the command from a photo's caption", async () => {
    const { seed, sam } = await scene();

    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "image", text: "/later Which hat?", media: photo("p1") }),
      seed.family.id,
      sam.member.id,
    );

    const [exchange] = await exchangeRows();
    expect(exchange).toMatchObject({ type: "question", text: "Which hat?", whenRule: "whenever" });
    expect(exchange?.mediaIds).toHaveLength(1);
  });

  it("queues a second /ask for the same morning", async () => {
    const { seed, sam } = await scene();

    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "text", text: "/ask First" }),
      seed.family.id,
      sam.member.id,
    );
    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "text", text: "/ask Second" }),
      seed.family.id,
      sam.member.id,
    );

    const rows = await exchangeRows();
    expect(rows.map((row) => [row.text, row.whenRule])).toEqual([
      ["First", "tomorrow"],
      ["Second", "whenever"],
    ]);
    await h.run(handlers());
    expect(h.telegram.sentTo(GROUP).at(-1)?.message.text).toBe(
      t("en", "group.ask_queued", { asker: "Sam" }),
    );
  });

  it("ignores a command for another bot, a bare command, and a redelivered one", async () => {
    const { seed, sam } = await scene();
    const event = groupEvent({ kind: "text", text: "/ask Once" });

    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "text", text: "/ask@OtherBot Hello" }),
      seed.family.id,
      sam.member.id,
    );
    await handleAskCommand(
      h.deps,
      groupEvent({ kind: "text", text: "/ask" }),
      seed.family.id,
      sam.member.id,
    );
    await handleAskCommand(h.deps, event, seed.family.id, sam.member.id);
    await handleAskCommand(h.deps, event, seed.family.id, sam.member.id);

    const rows = await exchangeRows();
    expect(rows.map((row) => row.text)).toEqual(["Once"]);
    expect(await outboundRows()).toHaveLength(1);
    expect(await eventRows()).toHaveLength(1);
  });
});
