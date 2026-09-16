import type { ChannelAdapter, InboundEvent, LocalDate, MediaRef } from "@vela/contracts";
import { addMinutes, encodeButton, outboundKey } from "@vela/core";
import {
  answers,
  awayPeriods,
  type ChannelLink,
  chips,
  events,
  exchanges,
  families,
  media,
  members,
  messageRefs,
  type Outbound,
  outbound,
  quietEvents,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type AnswerButtonAction, handleAnswerButton, handleParentMessage } from "./answers.ts";
import type { Deps, OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { openQuiet } from "./quiet.ts";
import { MEDIA_RETENTION_DAYS } from "./repo.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import { type SeededFamily, seedExchange, seedFamily, seedLinkedGroup } from "./testing/seed.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  taps = 0;
});

afterAll(async () => {
  await h.close();
});

/** The clock starts at 08:00 Taipei on this date; her arrival went out then. */
const TODAY: LocalDate = "2026-09-14";
const YESTERDAY: LocalDate = "2026-09-13";
const GROUP = "-100500";

const VOICE: MediaRef = {
  kind: "audio",
  providerFileId: "voice-1",
  providerUniqueId: "u-voice-1",
  mime: "audio/ogg",
  durationMs: 4000,
};

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

let taps = 0;

/** A message from a private chat; the message id counts up per call, as Telegram's do. */
function privateEvent(
  link: ChannelLink,
  extra: Partial<InboundEvent> & { kind: InboundEvent["kind"] },
): InboundEvent {
  taps += 1;
  return {
    channel: "telegram",
    eventId: `tg:${taps}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: link.externalId },
    conversation: { externalId: link.externalId, kind: "private" },
    messageId: String(100 + taps),
    ...extra,
  };
}

/** Her tap on the arrival message `messageId`, which carries the buttons. */
function tap(link: ChannelLink, messageId: string, action: AnswerButtonAction): InboundEvent {
  return privateEvent(link, {
    kind: "button",
    messageId,
    buttonData: encodeButton(action),
    callbackId: `cb${taps + 1}`,
  });
}

interface Scene {
  seed: SeededFamily;
  exchangeId: string;
}

/** Her family with its group; today's question was delivered at 08:00 and it is now 08:12. */
async function morning(options: { type?: "question" | "hello" } = {}): Promise<Scene> {
  const seed = await seedFamily(h.db, { now: h.clock.now() });
  await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    type: options.type ?? "question",
    state: "delivered",
    deliveredAt: h.clock.now(),
  });
  h.clock.advanceMinutes(12);
  return { seed, exchangeId: exchange.id };
}

async function answerRows() {
  return h.db.select().from(answers).orderBy(asc(answers.receivedAt), asc(answers.id));
}

async function outboundRows(): Promise<Outbound[]> {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

async function eventRows() {
  return h.db.select().from(events).orderBy(asc(events.id));
}

async function exchangeById(id: string) {
  const [row] = await h.db.select().from(exchanges).where(eq(exchanges.id, id));
  return row;
}

const StoredText = z.object({ message: z.object({ text: z.string() }) });

function textOf(row: Outbound): string {
  return StoredText.parse(row.payload).message.text;
}

async function setMember(seed: SeededFamily, patch: Partial<typeof members.$inferInsert>) {
  await h.db.update(members).set(patch).where(eq(members.id, seed.member.id));
  const [row] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
  if (row === undefined) {
    throw new Error("member vanished");
  }
  return row;
}

describe("handleParentMessage", () => {
  it("lights the exchange in one transaction, then acks her, posts to the group, and queues understanding", async () => {
    const { seed, exchangeId } = await morning();
    const now = h.clock.now();

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "text", text: " Cooking soup " }),
    );

    const [answer] = await answerRows();
    expect(answer).toMatchObject({
      exchangeId,
      memberId: seed.member.id,
      kind: "text",
      channel: "telegram",
      externalId: "2001:101",
      payload: { text: "Cooking soup" },
      mediaId: null,
      receivedAt: now,
      processingAttempts: 0,
    });
    const exchange = await exchangeById(exchangeId);
    expect(exchange?.state).toBe("answered");
    expect(exchange?.answeredAt).toEqual(now);

    const recorded = await eventRows();
    expect(recorded.map((row) => row.name)).toEqual(["answer_recorded"]);
    expect(recorded[0]?.props).toEqual({ kind: "text", latency: 12, type: "question" });

    const rows = await outboundRows();
    expect(rows.map((row) => [row.kind, row.conversationId, textOf(row)])).toEqual([
      ["ack", seed.memberLink.externalId, "Thank you, Mrs Chen. The family will hear it."],
      ["answer_post", GROUP, "☀️ Mom answered Mia · 08:12\nMom: Cooking soup"],
    ]);
    expect(rows[1]?.idempotencyKey).toBe(
      outboundKey("answer_post", { exchangeId, suffix: answer?.id ?? "" }),
    );
    expect(h.queues.understand.pending.map((entry) => entry.job)).toEqual([
      { type: "understand_answer", answerId: answer?.id },
    ]);
    expect(h.queues.media.pending).toHaveLength(0);
    expect(h.scheduler.wakes.get(seed.member.id)).toEqual(now);
    const [her] = await h.db.select().from(members).where(eq(members.id, seed.member.id));
    expect(her?.nextWakeAt).toEqual(now);

    await h.run(handlers());
    const [post] = h.telegram.sentTo(GROUP);
    expect(post?.message.text).toBe("☀️ Mom answered Mia · 08:12\nMom: Cooking soup");
    expect(post?.message.media).toBeUndefined();
    const refs = await h.db
      .select()
      .from(messageRefs)
      .where(eq(messageRefs.purpose, "answer_post"));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      conversationId: GROUP,
      messageId: post?.result.primaryMessageId,
      exchangeId,
      memberId: seed.member.id,
    });
  });

  it("changes nothing on a redelivered message", async () => {
    const { seed } = await morning();
    const event = privateEvent(seed.memberLink, { kind: "text", text: "Cooking soup" });

    await handleParentMessage(h.deps, seed.member, event);
    await handleParentMessage(h.deps, seed.member, event);

    expect(await answerRows()).toHaveLength(1);
    expect(await outboundRows()).toHaveLength(2);
    expect(await eventRows()).toHaveLength(1);
    expect(h.queues.understand.pending).toHaveLength(1);
    expect(h.logger.entries.map((entry) => entry.event)).toContain("answer_duplicate");
  });

  it("posts the answer as a hello when nobody asked, with no content line for a voice", async () => {
    const { seed } = await morning({ type: "hello" });

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "voice", media: VOICE }),
    );
    await h.run(handlers());

    const [post] = h.telegram.sentTo(GROUP);
    expect(post?.message.text).toBe("☀️ Mom is fine · 08:12");
    expect(post?.message.media).toEqual([VOICE]);
  });

  it("attaches a message sent before today's arrival to yesterday's exchange and leaves today's untouched", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const yesterday = await seedExchange(h.db, seed, {
      date: YESTERDAY,
      state: "delivered",
      deliveredAt: new Date("2026-09-13T00:00:00Z"),
    });
    const today = await seedExchange(h.db, seed, { date: TODAY, state: "scheduled" });
    // 07:00 Taipei: an hour before today's arrival.
    h.clock.set("2026-09-13T23:00:00Z");

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "text", text: "Up early today" }),
    );

    const [answer] = await answerRows();
    expect(answer?.exchangeId).toBe(yesterday.id);
    expect((await exchangeById(yesterday.id))?.state).toBe("answered");
    const untouched = await exchangeById(today.id);
    expect(untouched?.state).toBe("scheduled");
    expect(untouched?.answeredAt).toBeNull();
  });

  it("posts a message with no delivered exchange in 36 hours to the group as a system message, without an answers row", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const old = await seedExchange(h.db, seed, {
      date: "2026-09-12",
      state: "delivered",
      deliveredAt: addMinutes(h.clock.now(), -40 * 60),
    });
    const event = privateEvent(seed.memberLink, { kind: "text", text: "Hello there" });

    await handleParentMessage(h.deps, seed.member, event);
    await handleParentMessage(h.deps, seed.member, event);

    expect(await answerRows()).toHaveLength(0);
    const rows = await outboundRows();
    expect(
      rows.map((row) => [row.kind, row.conversationId, row.idempotencyKey, textOf(row)]),
    ).toEqual([
      [
        "system",
        GROUP,
        outboundKey("system", { conversationId: GROUP, suffix: event.eventId }),
        "Mom: Hello there",
      ],
    ]);
    const recorded = await eventRows();
    expect(recorded.map((row) => [row.name, row.props])).toEqual([
      ["answer_recorded", { kind: "text", unattached: true, posted: true }],
      ["answer_recorded", { kind: "text", unattached: true, posted: true }],
    ]);
    expect(recorded[0]?.exchangeId).toBeNull();
    expect(h.queues.understand.pending).toHaveLength(0);
    expect((await exchangeById(old.id))?.state).toBe("delivered");
    expect(h.scheduler.wakes.has(seed.member.id)).toBe(false);
  });

  it("posts an unattached voice message with the voice attached", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "voice", media: VOICE }),
    );
    await h.run(handlers());

    const [post] = h.telegram.sentTo(GROUP);
    expect(post?.message.kind).toBe("system");
    expect(post?.message.text).toBe("Mom sent a voice message.");
    expect(post?.message.media).toEqual([VOICE]);
    expect(await answerRows()).toHaveLength(0);
    expect(await h.db.select().from(media)).toHaveLength(0);
  });

  it("ignores everything from her before consent, after a No, once she is left or deceased, and once her family's deletion is requested", async () => {
    const { seed, exchangeId } = await morning();
    const patches: Partial<typeof members.$inferInsert>[] = [
      { status: "invited", lightOn: false, lightConsentedAt: null },
      { status: "left", leftAt: h.clock.now() },
      { status: "deceased", lightOn: false },
    ];
    for (const patch of patches) {
      const her = await setMember(seed, patch);
      await handleParentMessage(
        h.deps,
        her,
        privateEvent(seed.memberLink, { kind: "text", text: "stop" }),
      );
      await handleParentMessage(
        h.deps,
        her,
        privateEvent(seed.memberLink, { kind: "voice", media: VOICE }),
      );
    }
    await setMember(seed, { status: "active", lightOn: true, lightConsentedAt: h.clock.now() });
    await h.db
      .update(families)
      .set({ deletedAt: h.clock.now() })
      .where(eq(families.id, seed.family.id));
    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "text", text: "Cooking soup" }),
    );

    expect(await answerRows()).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
    expect(await h.db.select().from(media)).toHaveLength(0);
    expect(h.logger.entries).toHaveLength(0);
    expect(h.queues.understand.pending).toHaveLength(0);
    expect(h.queues.media.pending).toHaveLength(0);
    expect((await exchangeById(exchangeId))?.state).toBe("delivered");
  });

  it("records a voice answer's file once per family and hands it to media ingestion", async () => {
    const { seed, exchangeId } = await morning();
    const now = h.clock.now();

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "voice", media: VOICE }),
    );

    const files = await h.db.select().from(media);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      familyId: seed.family.id,
      uploadedBy: seed.member.id,
      kind: "audio",
      channel: "telegram",
      providerFileId: "voice-1",
      providerUniqueId: "u-voice-1",
      mime: "audio/ogg",
      durationMs: 4000,
      storageKey: null,
      createdAt: now,
      expiresAt: addMinutes(now, MEDIA_RETENTION_DAYS * 24 * 60),
    });
    const [answer] = await answerRows();
    expect(answer?.kind).toBe("voice");
    expect(answer?.mediaId).toBe(files[0]?.id);
    expect(h.queues.media.pending.map((entry) => entry.job)).toEqual([
      { type: "ingest_answer_media", answerId: answer?.id },
    ]);
    expect(h.queues.understand.pending).toHaveLength(0);

    // The same file forwarded again is a second answer on the same media row.
    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "voice", media: VOICE }),
    );
    expect(await h.db.select().from(media)).toHaveLength(1);
    const both = await answerRows();
    expect(both.map((row) => row.mediaId)).toEqual([files[0]?.id, files[0]?.id]);
    expect(both.map((row) => row.exchangeId)).toEqual([exchangeId, exchangeId]);

    await h.run(handlers());
    const posts = h.telegram.sentTo(GROUP);
    expect(posts).toHaveLength(2);
    expect(posts[0]?.message.text).toBe("☀️ Mom answered Mia · 08:12");
    expect(posts[0]?.message.media).toEqual([VOICE]);
  });

  it("treats content of another kind as an answer of kind other", async () => {
    const { seed } = await morning();

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "other", text: "The garden" }),
    );

    const [answer] = await answerRows();
    expect(answer).toMatchObject({ kind: "other", payload: { text: "The garden" } });
    const [, post] = await outboundRows();
    expect(post === undefined ? null : textOf(post)).toBe(
      "☀️ Mom answered Mia · 08:12\nMom: The garden",
    );
  });

  it("acks once a day however many answers she gives, and posts each", async () => {
    const { seed } = await morning();

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "text", text: "Soup" }),
    );
    h.clock.advanceMinutes(30);
    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "text", text: "And rice" }),
    );

    const rows = await outboundRows();
    expect(rows.filter((row) => row.kind === "ack")).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "answer_post")).toHaveLength(2);
    expect(await answerRows()).toHaveLength(2);
  });

  it("resolves the open quiet event and ends her open-ended away periods that have started", async () => {
    const { seed, exchangeId } = await morning();
    h.clock.advanceMinutes(360);
    await openQuiet(h.deps, seed.member.id, TODAY, true);
    await h.run(handlers());
    await h.db.insert(awayPeriods).values([
      { memberId: seed.member.id, fromDate: TODAY, toDate: null, source: "answer" },
      { memberId: seed.member.id, fromDate: "2026-09-15", toDate: null, source: "organiser" },
    ]);
    h.clock.advanceMinutes(20);

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "text", text: "Sorry, busy morning" }),
    );

    const [quiet] = await h.db.select().from(quietEvents);
    expect(quiet).toMatchObject({
      exchangeId,
      outcome: "answered_late",
      resolvedAt: h.clock.now(),
    });
    const told = (await outboundRows()).filter((row) => row.kind === "quiet_resolved");
    expect(told.map((row) => row.memberId)).toEqual([seed.organiser.id]);
    const periods = await h.db.select().from(awayPeriods).orderBy(asc(awayPeriods.fromDate));
    expect(periods.map((row) => [row.fromDate, row.endedAt])).toEqual([
      [TODAY, h.clock.now()],
      ["2026-09-15", null],
    ]);
    const names = (await eventRows()).map((row) => row.name);
    expect(names.filter((name) => name === "away_ended")).toHaveLength(1);
    expect(names).toContain("quiet_notice_resolved");
    expect(names).toContain("answer_recorded");
  });

  it("sets the light even when the ack, the post, the queue, and the wake all fail", async () => {
    const { seed, exchangeId } = await morning();
    const broken = async (): Promise<never> => {
      throw new Error("port down");
    };
    const deps: Deps = {
      ...h.deps,
      queues: {
        outbound: { send: broken },
        media: { send: broken },
        understand: { send: broken },
      },
      scheduler: { wakeAt: broken },
    };

    await expect(
      handleParentMessage(
        deps,
        seed.member,
        privateEvent(seed.memberLink, { kind: "text", text: "Cooking soup" }),
      ),
    ).resolves.toBeUndefined();

    expect(await answerRows()).toHaveLength(1);
    expect((await exchangeById(exchangeId))?.state).toBe("answered");
    expect((await eventRows()).map((row) => row.name)).toEqual(["answer_recorded"]);
    const failures = h.logger.entries.filter((entry) => entry.event === "after_light_failed");
    expect(failures.map((entry) => entry.fields?.step)).toEqual(["ack", "post", "queue", "wake"]);
  });

  it("keeps the light when every send to her and to the group fails", async () => {
    const { seed, exchangeId } = await morning();
    h.telegram.failSendsTo(GROUP, "unavailable");
    h.telegram.failSendsTo(seed.memberLink.externalId, "unavailable");

    await handleParentMessage(
      h.deps,
      seed.member,
      privateEvent(seed.memberLink, { kind: "text", text: "Cooking soup" }),
    );
    await h.run(handlers());

    expect(h.telegram.sent).toHaveLength(0);
    expect((await outboundRows()).map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(await answerRows()).toHaveLength(1);
    expect((await exchangeById(exchangeId))?.state).toBe("answered");
  });
});

describe("handleAnswerButton", () => {
  const ARRIVAL_MESSAGE = "7";

  async function tapped(
    scene: Scene,
    action: AnswerButtonAction,
    messageId = ARRIVAL_MESSAGE,
  ): Promise<void> {
    await handleAnswerButton(
      h.deps,
      scene.seed.member,
      tap(scene.seed.memberLink, messageId, action),
      action,
    );
  }

  it("answers 'I'm fine': acknowledged, closed with the label, posted as a hello", async () => {
    const scene = await morning();
    const { seed, exchangeId } = scene;

    await tapped(scene, { type: "answer", exchangeId, answer: "fine" });

    expect(h.telegram.acknowledged).toEqual([
      { eventId: "tg:1", callbackId: "cb1", text: undefined },
    ]);
    expect(h.telegram.closed).toEqual([
      {
        conversationId: seed.memberLink.externalId,
        messageId: ARRIVAL_MESSAGE,
        replacementText: "I'm fine",
      },
    ]);
    const [answer] = await answerRows();
    expect(answer).toMatchObject({
      kind: "fine",
      payload: {},
      externalId: "2001:7",
      mediaId: null,
    });
    expect((await exchangeById(exchangeId))?.state).toBe("answered");
    const rows = await outboundRows();
    expect(rows.map((row) => [row.kind, textOf(row)])).toEqual([
      ["ack", "Thank you, Mrs Chen. The family will hear it."],
      ["answer_post", "☀️ Mom is fine · 08:12"],
    ]);
    expect(h.queues.understand.pending).toHaveLength(1);
    expect(h.scheduler.wakes.get(seed.member.id)).toEqual(h.clock.now());
  });

  it("answers a heart", async () => {
    const scene = await morning();

    await tapped(scene, { type: "answer", exchangeId: scene.exchangeId, answer: "heart" });

    expect((await answerRows())[0]?.kind).toBe("heart");
    expect(h.telegram.closed[0]?.replacementText).toBe("❤️");
    const [, post] = await outboundRows();
    expect(post === undefined ? null : textOf(post)).toBe("☀️ Mom answered Mia · 08:12");
  });

  it("answers a chip by index and ignores an index the arrival never showed", async () => {
    const scene = await morning();
    await h.db.insert(chips).values({
      exchangeId: scene.exchangeId,
      chips: ["Soup", "Rice", "Nothing yet"],
      promptVersion: "chips.v1",
    });

    await tapped(scene, { type: "chip", exchangeId: scene.exchangeId, index: 5 });
    expect(await answerRows()).toHaveLength(0);
    expect(h.telegram.acknowledged).toHaveLength(1);
    expect(h.telegram.closed).toHaveLength(0);
    expect(h.logger.entries.map((entry) => entry.event)).toContain("answer_button_option_ignored");

    await tapped(scene, { type: "chip", exchangeId: scene.exchangeId, index: 1 });
    const [answer] = await answerRows();
    expect(answer).toMatchObject({ kind: "chip", payload: { index: 1, choice: "Rice" } });
    expect(h.telegram.closed[0]?.replacementText).toBe("Rice");
    const [, post] = await outboundRows();
    expect(post === undefined ? null : textOf(post)).toBe(
      "☀️ Mom answered Mia · 08:12\nMom chose: Rice",
    );
  });

  it("answers a photo choice by picking one of its two photos", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const photos = await h.db
      .insert(media)
      .values(
        ["p1", "p2"].map((fileId) => ({
          familyId: seed.family.id,
          uploadedBy: seed.organiser.id,
          kind: "image" as const,
          channel: "telegram" as const,
          providerFileId: fileId,
          providerUniqueId: `u-${fileId}`,
        })),
      )
      .returning({ id: media.id });
    const exchange = await seedExchange(h.db, seed, {
      date: TODAY,
      type: "photo_choice",
      text: null,
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    await h.db
      .update(exchanges)
      .set({ mediaIds: photos.map((row) => row.id) })
      .where(eq(exchanges.id, exchange.id));
    h.clock.advanceMinutes(12);
    const scene: Scene = { seed, exchangeId: exchange.id };

    await tapped(scene, { type: "pick", exchangeId: exchange.id, index: 2 });
    expect(await answerRows()).toHaveLength(0);

    await tapped(scene, { type: "pick", exchangeId: exchange.id, index: 1 });
    const [answer] = await answerRows();
    expect(answer).toMatchObject({
      kind: "photo_pick",
      payload: { index: 1, media_id: photos[1]?.id },
    });
    expect(h.telegram.closed.map((call) => call.replacementText)).toEqual(["2"]);
    const [, post] = await outboundRows();
    expect(post === undefined ? null : textOf(post)).toBe(
      "☀️ Mom answered Mia · 08:12\nMom picked photo 2.",
    );
  });

  it("answers a vote by option and ignores an option outside the list", async () => {
    const seed = await seedFamily(h.db, { now: h.clock.now() });
    await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
    const exchange = await seedExchange(h.db, seed, {
      date: TODAY,
      type: "vote",
      text: "Tea or coffee on Sunday?",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    await h.db
      .update(exchanges)
      .set({ options: { vote_options: ["Tea", "Coffee"] } })
      .where(eq(exchanges.id, exchange.id));
    h.clock.advanceMinutes(12);
    const scene: Scene = { seed, exchangeId: exchange.id };

    await tapped(scene, { type: "vote", exchangeId: exchange.id, index: 3 });
    expect(await answerRows()).toHaveLength(0);

    await tapped(scene, { type: "vote", exchangeId: exchange.id, index: 0 });
    const [answer] = await answerRows();
    expect(answer).toMatchObject({ kind: "vote", payload: { index: 0, choice: "Tea" } });
    expect(h.telegram.closed.map((call) => call.replacementText)).toEqual(["Tea"]);
    const [, post] = await outboundRows();
    expect(post === undefined ? null : textOf(post)).toBe(
      "☀️ Mom answered Mia · 08:12\nMom voted: Tea",
    );
  });

  it("acknowledges and otherwise ignores a tap before consent, on another member's exchange, or on an exchange not delivered", async () => {
    const scene = await morning();
    const { seed, exchangeId } = scene;
    const other = await seedFamily(h.db, {
      now: h.clock.now(),
      organiserExternalId: "7001",
      memberExternalId: "7002",
    });
    const theirs = await seedExchange(h.db, other, {
      date: TODAY,
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    const tomorrow = await seedExchange(h.db, seed, { date: "2026-09-15", state: "scheduled" });

    const invited = await setMember(seed, {
      status: "invited",
      lightOn: false,
      lightConsentedAt: null,
    });
    await handleAnswerButton(
      h.deps,
      invited,
      tap(seed.memberLink, ARRIVAL_MESSAGE, { type: "answer", exchangeId, answer: "fine" }),
      { type: "answer", exchangeId, answer: "fine" },
    );
    await setMember(seed, { status: "active", lightOn: true, lightConsentedAt: h.clock.now() });
    await tapped(scene, { type: "answer", exchangeId: theirs.id, answer: "fine" });
    await tapped(scene, { type: "answer", exchangeId: tomorrow.id, answer: "fine" });

    expect(h.telegram.acknowledged).toHaveLength(3);
    expect(h.telegram.closed).toHaveLength(0);
    expect(await answerRows()).toHaveLength(0);
    expect(await outboundRows()).toHaveLength(0);
    expect(await eventRows()).toHaveLength(0);
    expect((await exchangeById(theirs.id))?.state).toBe("delivered");
  });

  it("counts a second tap on the same arrival once", async () => {
    const scene = await morning();
    const action: AnswerButtonAction = {
      type: "answer",
      exchangeId: scene.exchangeId,
      answer: "fine",
    };

    await tapped(scene, action);
    await tapped(scene, { ...action, answer: "heart" });

    expect(await answerRows()).toHaveLength(1);
    expect(h.telegram.acknowledged).toHaveLength(2);
    expect(h.telegram.closed).toHaveLength(1);
    expect((await outboundRows()).filter((row) => row.kind === "answer_post")).toHaveLength(1);
  });

  it("keeps the light when acknowledging and closing the buttons fail", async () => {
    const scene = await morning();
    const failing: ChannelAdapter = {
      ...h.telegram,
      acknowledgeButton: async () => {
        throw new Error("telegram down");
      },
      closeButtons: async () => {
        throw new Error("telegram down");
      },
    };
    const deps: Deps = { ...h.deps, channels: { get: () => failing } };

    await expect(
      handleAnswerButton(
        deps,
        scene.seed.member,
        tap(scene.seed.memberLink, ARRIVAL_MESSAGE, {
          type: "answer",
          exchangeId: scene.exchangeId,
          answer: "fine",
        }),
        { type: "answer", exchangeId: scene.exchangeId, answer: "fine" },
      ),
    ).resolves.toBeUndefined();

    expect(await answerRows()).toHaveLength(1);
    expect((await exchangeById(scene.exchangeId))?.state).toBe("answered");
    expect(h.logger.entries.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(["answer_button_ack_failed", "answer_button_close_failed"]),
    );
    expect((await outboundRows()).map((row) => row.kind)).toEqual(["ack", "answer_post"]);
  });
});
