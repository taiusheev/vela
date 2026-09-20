import {
  type Ai,
  type AiOutcome,
  createFakeAi,
  createFakeStt,
  createOffAi,
  type FakeAi,
  type FlagResult,
  fakeRecord,
  SAFE_DEFAULTS,
  type Understanding,
} from "@vela/ai";
import {
  type ChannelAdapter,
  ChannelSendError,
  type InboundEvent,
  type Lang,
  type LocalDate,
  type MediaRef,
} from "@vela/contracts";
import { t } from "@vela/copy";
import { addMinutes, encodeButton, outboundKey } from "@vela/core";
import {
  type Answer,
  aiCalls,
  answers,
  awayPeriods,
  type ChannelLink,
  consents,
  events,
  media,
  members,
  type Outbound,
  outbound,
  translations,
} from "@vela/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type AnswerButtonAction, handleAnswerButton, handleParentMessage } from "./answers.ts";
import type { Deps, OutboundJob } from "./deps.ts";
import { deliverOutbound } from "./gateway.ts";
import { ingestAnswerMedia, understandAnswer } from "./pipeline.ts";
import { createHarness, type Harness } from "./testing/harness.ts";
import {
  type SeededFamily,
  seedExchange,
  seedFamily,
  seedGroupMember,
  seedHealthWordsConsent,
  seedLinkedGroup,
} from "./testing/seed.ts";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
}, 60_000);

beforeEach(async () => {
  await h.reset();
  h.deps.stt = h.stt;
  messages = 0;
});

afterAll(async () => {
  await h.close();
});

const TODAY: LocalDate = "2026-09-14";
const GROUP = "-100500";
const ADMIN = "9001";
/**
 * A voice note as Telegram delivers one: `bytes` is the `file_size` it reports, which the media row
 * keeps whether or not there is a store, so the tests below see what a real row holds.
 */
const VOICE: MediaRef = {
  kind: "audio",
  providerFileId: "voice-1",
  providerUniqueId: "u-voice-1",
  mime: "audio/ogg",
  bytes: 4321,
};
/** The file itself, which is shorter than the `file_size` above, so the two are told apart. */
const VOICE_BYTES = new Uint8Array([1, 2, 3]).buffer;

function handlers(): { outbound: (job: OutboundJob) => Promise<unknown> } {
  return { outbound: (job) => deliverOutbound(h.deps, job.outboundId) };
}

let messages = 0;

function fromHer(
  link: ChannelLink,
  extra: Partial<InboundEvent> & { kind: InboundEvent["kind"] },
): InboundEvent {
  messages += 1;
  return {
    channel: "telegram",
    eventId: `tg:${messages}`,
    at: h.clock.now().toISOString(),
    sender: { externalUserId: link.externalId },
    conversation: { externalId: link.externalId, kind: "private" },
    messageId: String(100 + messages),
    ...extra,
  };
}

interface Scene {
  seed: SeededFamily;
  exchangeId: string;
}

/** Her family with its group; today's question went out at 08:00 and it is 08:12. */
async function morning(options: { language?: Lang; memberLanguage?: Lang } = {}): Promise<Scene> {
  const seed = await seedFamily(h.db, { now: h.clock.now(), ...options });
  await seedLinkedGroup(h.db, seed, { now: h.clock.now() });
  const exchange = await seedExchange(h.db, seed, {
    date: TODAY,
    state: "delivered",
    deliveredAt: h.clock.now(),
  });
  h.clock.advanceMinutes(12);
  return { seed, exchangeId: exchange.id };
}

async function latestAnswer(): Promise<Answer> {
  const rows = await h.db.select().from(answers).orderBy(asc(answers.receivedAt), asc(answers.id));
  const row = rows.at(-1);
  if (row === undefined) {
    throw new Error("no answer recorded");
  }
  return row;
}

async function answerById(id: string): Promise<Answer> {
  const [row] = await h.db.select().from(answers).where(eq(answers.id, id));
  if (row === undefined) {
    throw new Error("answer vanished");
  }
  return row;
}

/** Her answer, with its group post already sent, so the pipeline finds a message to reply to. */
async function answered(scene: Scene, event: InboundEvent): Promise<Answer> {
  await handleParentMessage(h.deps, scene.seed.member, event);
  await h.run(handlers());
  h.queues.understand.clear();
  h.queues.media.clear();
  return latestAnswer();
}

async function herText(scene: Scene, text: string): Promise<Answer> {
  return answered(scene, fromHer(scene.seed.memberLink, { kind: "text", text }));
}

async function herVoice(scene: Scene): Promise<Answer> {
  h.telegram.mediaFiles.set("voice-1", { body: VOICE_BYTES, mime: "audio/ogg" });
  return answered(scene, fromHer(scene.seed.memberLink, { kind: "voice", media: VOICE }));
}

async function herTap(scene: Scene, action: AnswerButtonAction): Promise<Answer> {
  messages += 1;
  await handleAnswerButton(
    h.deps,
    scene.seed.member,
    {
      channel: "telegram",
      eventId: `tg:${messages}`,
      at: h.clock.now().toISOString(),
      kind: "button",
      sender: { externalUserId: scene.seed.memberLink.externalId },
      conversation: { externalId: scene.seed.memberLink.externalId, kind: "private" },
      messageId: "7",
      buttonData: encodeButton(action),
      callbackId: `cb${messages}`,
    },
    action,
  );
  await h.run(handlers());
  h.queues.understand.clear();
  return latestAnswer();
}

/** Replaces the harness's fake AI for one test; `reset` puts the default back. */
function withAi(overrides: Partial<Ai>): FakeAi {
  const ai = createFakeAi(overrides);
  h.deps.ai = ai;
  return ai;
}

function failed<T>(call: "understand" | "flag" | "translate", value: T): AiOutcome<T> {
  return { ok: false, value, record: fakeRecord(call, "http_529"), error: "http_529" };
}

const RAISED: FlagResult = {
  flag: true,
  category: "health",
  severity: "concern",
  evidenceQuote: "my chest hurts",
};

function raised(quote: string | null = RAISED.evidenceQuote): AiOutcome<FlagResult> {
  return { ok: true, value: { ...RAISED, evidenceQuote: quote }, record: fakeRecord("flag") };
}

function understood(
  input: Parameters<Ai["understand"]>[0],
  away: Understanding["away"],
): AiOutcome<Understanding> {
  return {
    ok: true,
    value: { ...SAFE_DEFAULTS.understand(input), summary: input.answer.text, away },
    record: fakeRecord("understand"),
  };
}

/** The harness's speech-to-text, recording the language hint of each call. */
function recordingStt(): { hints: (Lang | null)[] } {
  const hints: (Lang | null)[] = [];
  const inner = h.stt;
  h.deps.stt = {
    transcribe: (input) => {
      hints.push(input.languageHint);
      return inner.transcribe(input);
    },
  };
  return { hints };
}

async function outboundRows(): Promise<Outbound[]> {
  return h.db.select().from(outbound).orderBy(asc(outbound.queuedAt), asc(outbound.id));
}

const StoredMessage = z.object({
  message: z.object({ text: z.string(), replyToMessageId: z.string().optional() }),
});

function textOf(row: Outbound): string {
  return StoredMessage.parse(row.payload).message.text;
}

async function aiCallRows() {
  return h.db
    .select({
      call: aiCalls.call,
      ok: aiCalls.ok,
      inputRef: aiCalls.inputRef,
      output: aiCalls.output,
    })
    .from(aiCalls)
    .orderBy(asc(aiCalls.at), asc(aiCalls.id));
}

async function eventNames(): Promise<string[]> {
  const rows = await h.db.select({ name: events.name }).from(events).orderBy(asc(events.id));
  return rows.map((row) => row.name);
}

function adminLink(familyId: string): string {
  return `https://vela.test/admin/families/${familyId}`;
}

describe("understandAnswer", () => {
  it("reads her words once: understand and flag logged, the summary stored, understood_at set, no second run", async () => {
    const scene = await morning();
    const answer = await herText(scene, "Cooking soup");
    const now = h.clock.now();

    await understandAnswer(h.deps, answer.id);

    expect(h.ai.calls.map((call) => call.call)).toEqual(["understand", "flag"]);
    expect(h.ai.calls[0]?.input).toEqual({
      lang: "en",
      summaryLang: "en",
      addressForm: "Mrs Chen",
      today: TODAY,
      todayWeekday: "Monday",
      ask: { askerName: "Mia", type: "question", text: "What are you cooking tonight?" },
      answer: { kind: "text", text: "Cooking soup" },
      recentSummaries: [],
      healthWordsConsent: false,
    });
    const stored = await answerById(answer.id);
    expect(stored).toMatchObject({
      summary: "Cooking soup",
      moodWords: [],
      flag: false,
      flagReason: null,
      awayUntil: null,
      understoodAt: now,
      processingAttempts: 1,
    });
    const logged = await aiCallRows();
    expect(logged.map((row) => [row.call, row.ok, row.inputRef])).toEqual([
      ["understand", true, { answer_id: answer.id }],
      ["flag", true, { answer_id: answer.id }],
    ]);
    expect(await h.db.select().from(translations)).toHaveLength(0);
    expect((await outboundRows()).map((row) => row.kind)).toEqual(["ack", "answer_post"]);

    await understandAnswer(h.deps, answer.id);
    expect(h.ai.calls).toHaveLength(2);
    expect((await answerById(answer.id)).processingAttempts).toBe(1);
  });

  it("gives the model her last three summaries before this answer, oldest first", async () => {
    const scene = await morning();
    const start = h.clock.now();
    await h.db.insert(answers).values(
      ["first", "second", "third", "fourth"].map((summary, index) => ({
        exchangeId: scene.exchangeId,
        memberId: scene.seed.member.id,
        kind: "text" as const,
        channel: "telegram" as const,
        externalId: `2001:${index}`,
        payload: {},
        summary,
        receivedAt: new Date(start.getTime() - (10 - index) * 60_000),
      })),
    );
    const answer = await herText(scene, "Cooking soup");

    await understandAnswer(h.deps, answer.id);

    const input = z.object({ recentSummaries: z.array(z.string()) }).parse(h.ai.calls[0]?.input);
    expect(input.recentSummaries).toEqual(["second", "third", "fourth"]);
  });

  it("translates into the family language when it differs and posts it under the answer post, once across re-runs", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    const answer = await herText(scene, "我在煮湯");
    let flagCalls = 0;
    const ai = withAi({
      flag: async (input) => {
        flagCalls += 1;
        return flagCalls === 1 ? failed("flag", SAFE_DEFAULTS.flag(input)) : raised(null);
      },
    });

    await understandAnswer(h.deps, answer.id);

    // Her words into the family's language, then the summary into hers.
    expect(ai.calls.map((call) => call.call)).toEqual([
      "understand",
      "flag",
      "translate",
      "translate",
    ]);
    expect(ai.calls[2]?.input).toMatchObject({ text: "我在煮湯", from: "zh-TW", to: "en" });
    const stored = await h.db.select().from(translations).where(eq(translations.lang, "en"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      objectType: "answer",
      objectId: answer.id,
      lang: "en",
      text: "[en] 我在煮湯",
    });
    expect(stored[0]?.provider).toMatch(/^claude:/);
    const posts = (await outboundRows()).filter((row) => row.kind === "answer_post");
    expect(posts).toHaveLength(2);
    expect(posts[1]?.idempotencyKey).toBe(
      outboundKey("answer_post", {
        exchangeId: scene.exchangeId,
        suffix: `${answer.id}:transcript`,
      }),
    );
    expect(textOf(posts[1] as Outbound)).toBe("Mom: [en] 我在煮湯");
    expect(StoredMessage.parse(posts[1]?.payload).message.replyToMessageId).toBe(
      posts[0]?.externalId,
    );
    expect((await answerById(answer.id)).understoodAt).toBeNull();

    // The re-run after the failed flag reuses the stored translations and posts nothing twice.
    await understandAnswer(h.deps, answer.id);
    expect(ai.calls.map((call) => call.call)).toEqual([
      "understand",
      "flag",
      "translate",
      "translate",
      "understand",
      "flag",
    ]);
    expect(await h.db.select().from(translations)).toHaveLength(2);
    expect((await outboundRows()).filter((row) => row.kind === "answer_post")).toHaveLength(2);
    expect((await answerById(answer.id)).understoodAt).toEqual(h.clock.now());
    await h.run(handlers());
    const [, transcript] = h.telegram.sentTo(GROUP);
    expect(transcript?.message.replyToMessageId).toBe(posts[0]?.externalId);
  });

  it("stores nothing for a failed translation and still sets understood_at", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    const answer = await herText(scene, "我在煮湯");
    withAi({ translate: async (input) => failed("translate", SAFE_DEFAULTS.translate(input)) });

    await understandAnswer(h.deps, answer.id);

    expect(await h.db.select().from(translations)).toHaveLength(0);
    expect((await outboundRows()).filter((row) => row.kind === "answer_post")).toHaveLength(1);
    expect((await answerById(answer.id)).understoodAt).toEqual(h.clock.now());
    expect((await aiCallRows()).map((row) => [row.call, row.ok])).toEqual([
      ["understand", true],
      ["flag", true],
      ["translate", false],
      ["translate", false],
    ]);
  });

  it("keeps the summary in her language when the family writes in another, following a re-run that rewrites it", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    const answer = await herText(scene, "我在煮湯");
    const summaries = ["Mom is cooking soup.", "Mom is cooking soup.", "Mom made soup for dinner."];
    let flagCalls = 0;
    const ai = withAi({
      understand: async (input) => ({
        ok: true,
        value: { ...SAFE_DEFAULTS.understand(input), summary: summaries.shift() ?? "answered" },
        record: fakeRecord("understand"),
      }),
      flag: async (input) => {
        flagCalls += 1;
        return flagCalls < 3
          ? failed("flag", SAFE_DEFAULTS.flag(input))
          : { ok: true, value: SAFE_DEFAULTS.flag(input), record: fakeRecord("flag") };
      },
    });
    const forHer = async () =>
      (await h.db.select().from(translations).where(eq(translations.lang, "zh-TW"))).map((row) => [
        row.objectType,
        row.objectId,
        row.text,
      ]);

    await understandAnswer(h.deps, answer.id);

    expect(ai.calls.at(-1)?.input).toMatchObject({
      text: "Mom is cooking soup.",
      from: "en",
      to: "zh-TW",
    });
    expect(await forHer()).toEqual([["answer", answer.id, "[zh-TW] Mom is cooking soup."]]);

    // The same summary again: its translation is kept, not asked for twice.
    await understandAnswer(h.deps, answer.id);
    expect(ai.calls.filter((call) => call.call === "translate")).toHaveLength(2);

    // A rewritten summary: her copy follows it.
    await understandAnswer(h.deps, answer.id);
    expect(ai.calls.filter((call) => call.call === "translate")).toHaveLength(3);
    expect(await forHer()).toEqual([["answer", answer.id, "[zh-TW] Mom made soup for dinner."]]);
    expect(await answerById(answer.id)).toMatchObject({
      summary: "Mom made soup for dinner.",
      understoodAt: h.clock.now(),
    });
  });

  it("stores no summary for her when its translation fails", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    const answer = await herText(scene, "我在煮湯");
    withAi({
      translate: async (input) =>
        input.to === "zh-TW"
          ? failed("translate", SAFE_DEFAULTS.translate(input))
          : {
              ok: true,
              value: { text: `[${input.to}] ${input.text}` },
              record: fakeRecord("translate"),
            },
    });

    await understandAnswer(h.deps, answer.id);

    expect(await h.db.select().from(translations).where(eq(translations.lang, "zh-TW"))).toEqual(
      [],
    );
    expect(h.logger.entries.map((entry) => entry.event)).toContain("summary_translation_failed");
    expect((await answerById(answer.id)).understoodAt).toEqual(h.clock.now());
  });

  it("does not translate a button answer, whose words are not hers in her language", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    const answer = await herTap(scene, {
      type: "answer",
      exchangeId: scene.exchangeId,
      answer: "fine",
    });

    await understandAnswer(h.deps, answer.id);

    // The one translation is the summary, into her language.
    expect(h.ai.calls.map((call) => call.call)).toEqual(["understand", "flag", "translate"]);
    expect(h.ai.calls[0]?.input).toMatchObject({ answer: { kind: "fine", text: "我很好" } });
    expect(h.ai.calls[2]?.input).toMatchObject({ from: "en", to: "zh-TW" });
    expect(await h.db.select().from(translations).where(eq(translations.lang, "en"))).toEqual([]);
    expect((await outboundRows()).filter((row) => row.kind === "answer_post")).toHaveLength(1);
    expect((await answerById(answer.id)).understoodAt).toEqual(h.clock.now());
  });

  it("understands a photo without words at once, without a model call", async () => {
    const scene = await morning();
    const answer = await answered(
      scene,
      fromHer(scene.seed.memberLink, {
        kind: "image",
        media: { kind: "image", providerFileId: "photo-1", providerUniqueId: "u-photo-1" },
      }),
    );

    await understandAnswer(h.deps, answer.id);

    expect(h.ai.calls).toHaveLength(0);
    expect(await aiCallRows()).toHaveLength(0);
    expect(await answerById(answer.id)).toMatchObject({
      kind: "photo",
      understoodAt: h.clock.now(),
      processingAttempts: 1,
    });
  });

  it("raises a flag to each organiser with her words, when she agreed to health words, and to the founder with a link and no words, once", async () => {
    const scene = await morning();
    await seedHealthWordsConsent(h.db, scene.seed, { at: h.clock.now(), answer: "yes" });
    const sam = await seedGroupMember(h.db, scene.seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
      role: "organiser",
    });
    const answer = await herText(scene, "Not great, my chest hurts a bit");
    let understandCalls = 0;
    withAi({
      understand: async (input) => {
        understandCalls += 1;
        return understandCalls === 1
          ? failed("understand", SAFE_DEFAULTS.understand(input))
          : understood(input, null);
      },
      flag: async () => raised(),
    });

    await understandAnswer(h.deps, answer.id);

    const flags = (await outboundRows()).filter((row) => row.kind === "flag");
    expect(flags.map((row) => [row.conversationId, textOf(row)])).toEqual([
      [
        scene.seed.organiserLink.externalId,
        'Mom said something you may want to hear: "my chest hurts"',
      ],
      [sam.link.externalId, 'Mom said something you may want to hear: "my chest hurts"'],
      [ADMIN, `Flag in The Chens. Open: ${adminLink(scene.seed.family.id)}`],
    ]);
    expect(flags[2]?.idempotencyKey).toBe(
      outboundKey("flag", {
        exchangeId: scene.exchangeId,
        conversationId: ADMIN,
        suffix: answer.id,
      }),
    );
    expect(await answerById(answer.id)).toMatchObject({
      flag: true,
      flagReason: "health:concern",
      understoodAt: null,
    });
    expect((await eventNames()).filter((name) => name === "flag_raised")).toHaveLength(1);

    await understandAnswer(h.deps, answer.id);
    expect((await outboundRows()).filter((row) => row.kind === "flag")).toHaveLength(3);
    expect((await eventNames()).filter((name) => name === "flag_raised")).toHaveLength(1);
    expect((await answerById(answer.id)).understoodAt).toEqual(h.clock.now());
    await h.run(handlers());
    expect(h.telegram.sentTo(ADMIN).map((sent) => sent.message.text)).toEqual([
      `Flag in The Chens. Open: ${adminLink(scene.seed.family.id)}`,
    ]);
    expect(h.telegram.sentTo(ADMIN)[0]?.message.text).not.toContain("chest");
  });

  // The admin conversation is one chat on one channel (flows §3.14). A row addressed to it on the
  // family's channel would be handed to that channel's adapter with a Telegram chat id, and the
  // founder would never hear about the flag or the answer nobody could read.
  it("addresses the founder on the admin channel even when her answer came in on another", async () => {
    const scene = await morning();
    const answer = await herText(scene, "Not great, my chest hurts a bit");
    await h.db.update(answers).set({ channel: "line" }).where(eq(answers.id, answer.id));
    withAi({
      understand: async (input) => failed("understand", SAFE_DEFAULTS.understand(input)),
      flag: async () => raised(),
    });

    await understandAnswer(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);

    const toAdmin = (await outboundRows()).filter((row) => row.conversationId === ADMIN);
    expect(toAdmin.map((row) => [row.kind, row.channel])).toEqual([
      ["flag", "telegram"],
      ["system", "telegram"],
    ]);
  });

  // The AI layer drops an excerpt that is not exactly hers (a curly apostrophe, re-spaced Chinese)
  // but keeps the flag: the organisers still hear it, with everything she said.
  it("tells each organiser her own words when the model kept no exact quote", async () => {
    const scene = await morning();
    const sam = await seedGroupMember(h.db, scene.seed, {
      now: h.clock.now(),
      name: "Sam",
      externalId: "1002",
      role: "organiser",
    });
    await seedHealthWordsConsent(h.db, scene.seed, { at: h.clock.now(), answer: "yes" });
    const answer = await herText(scene, "Not great, I can’t breathe well");
    withAi({ flag: async () => raised(null) });

    await understandAnswer(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);

    const flags = (await outboundRows()).filter((row) => row.kind === "flag");
    const notice = 'Mom said something you may want to hear: "Not great, I can’t breathe well"';
    expect(flags.map((row) => [row.conversationId, textOf(row)])).toEqual([
      [scene.seed.organiserLink.externalId, notice],
      [sam.link.externalId, notice],
      [ADMIN, `Flag in The Chens. Open: ${adminLink(scene.seed.family.id)}`],
    ]);
    const raisedEvents = await h.db
      .select({ props: events.props })
      .from(events)
      .where(eq(events.name, "flag_raised"));
    expect(raisedEvents.map((row) => row.props)).toEqual([
      { severity: "concern", words: true, category: "health", excerpt: false },
    ]);
    await h.run(handlers());
    expect(
      h.telegram.sentTo(scene.seed.organiserLink.externalId).map((s) => s.message.text),
    ).toEqual([notice]);
  });

  it("leaves understood_at null when flag fails, counts each attempt, and tells the founder once after the third", async () => {
    const scene = await morning();
    const answer = await herText(scene, "Cooking soup");
    withAi({ flag: async (input) => failed("flag", SAFE_DEFAULTS.flag(input)) });
    const notices = async () =>
      (await outboundRows()).filter((row) => row.kind === "system" && row.conversationId === ADMIN);

    await understandAnswer(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);
    expect(await notices()).toHaveLength(0);
    expect((await answerById(answer.id)).processingAttempts).toBe(2);

    await understandAnswer(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);

    const stored = await answerById(answer.id);
    expect(stored).toMatchObject({
      summary: "Cooking soup",
      understoodAt: null,
      processingAttempts: 4,
    });
    const [notice] = await notices();
    expect(await notices()).toHaveLength(1);
    expect(notice?.idempotencyKey).toBe(
      outboundKey("system", { conversationId: ADMIN, suffix: `understand_failed:${answer.id}` }),
    );
    expect(notice === undefined ? null : textOf(notice)).toBe(
      `Could not read an answer in The Chens after three tries. Open: ${adminLink(scene.seed.family.id)}`,
    );
    expect((await aiCallRows()).filter((row) => row.call === "flag" && !row.ok)).toHaveLength(4);
  });

  it("sets an away period from the model's dates, confirms it to her once, and wakes her scheduler", async () => {
    const scene = await morning();
    const answer = await herText(scene, "Going to my sister's from Wednesday until Sunday");
    let flagCalls = 0;
    withAi({
      understand: async (input) => understood(input, { from: "2026-09-16", until: "2026-09-20" }),
      flag: async (input) => {
        flagCalls += 1;
        return flagCalls === 1 ? failed("flag", SAFE_DEFAULTS.flag(input)) : raised(null);
      },
    });

    await understandAnswer(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);

    const periods = await h.db.select().from(awayPeriods);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      memberId: scene.seed.member.id,
      fromDate: "2026-09-16",
      toDate: "2026-09-20",
      source: "answer",
      endedAt: null,
    });
    expect((await answerById(answer.id)).awayUntil).toBe("2026-09-20");
    const confirmations = (await outboundRows()).filter(
      (row) => row.kind === "system" && row.conversationId === scene.seed.memberLink.externalId,
    );
    expect(confirmations.map((row) => [row.idempotencyKey, textOf(row)])).toEqual([
      [
        outboundKey("system", {
          conversationId: scene.seed.memberLink.externalId,
          suffix: `away:${answer.id}`,
        }),
        "Until Sunday 20 September, then. Have a lovely time.",
      ],
    ]);
    expect((await eventNames()).filter((name) => name === "away_set")).toHaveLength(1);
    expect(h.scheduler.wakes.get(scene.seed.member.id)).toEqual(h.clock.now());
    const [her] = await h.db.select().from(members).where(eq(members.id, scene.seed.member.id));
    expect(her?.nextWakeAt).toEqual(h.clock.now());
  });

  it("writes the away date in her language", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    const answer = await herText(scene, "我星期三去妹妹家，星期日回來");
    withAi({
      understand: async (input) => understood(input, { from: "2026-09-16", until: "2026-09-20" }),
      translate: async (input) => failed("translate", SAFE_DEFAULTS.translate(input)),
    });

    await understandAnswer(h.deps, answer.id);

    const [confirmation] = (await outboundRows()).filter(
      (row) => row.kind === "system" && row.conversationId === scene.seed.memberLink.externalId,
    );
    expect(confirmation === undefined ? null : textOf(confirmation)).toBe(
      "好的，那就到9月20日（星期日）為止。祝您過得愉快。",
    );
  });

  it("confirms an open-ended away without a date, and ends it only on her answer on or after its start", async () => {
    const scene = await morning();
    const answer = await herText(scene, "Off to my sister's tomorrow, back when I'm back");
    withAi({ understand: async (input) => understood(input, { from: "2026-09-15", until: null }) });

    await understandAnswer(h.deps, answer.id);

    const [confirmation] = (await outboundRows()).filter(
      (row) => row.kind === "system" && row.conversationId === scene.seed.memberLink.externalId,
    );
    expect(confirmation === undefined ? null : textOf(confirmation)).toBe(
      "Understood. Have a lovely time.",
    );
    expect((await answerById(answer.id)).awayUntil).toBeNull();

    // A second answer today, before the away starts, leaves it open.
    h.clock.advanceMinutes(30);
    await herText(scene, "Packing now");
    expect((await h.db.select().from(awayPeriods))[0]?.endedAt).toBeNull();

    // Her first answer on or after the start ends it: 09:00 Taipei the next day.
    h.clock.set("2026-09-15T01:00:00Z");
    await seedExchange(h.db, scene.seed, {
      date: "2026-09-15",
      state: "delivered",
      deliveredAt: h.clock.now(),
    });
    await herText(scene, "Arrived safely");
    expect((await h.db.select().from(awayPeriods))[0]?.endedAt).toEqual(h.clock.now());
    expect(await eventNames()).toContain("away_ended");
  });
});

// Decision X (2026-09-18): with AI_PROVIDER "off" every model step takes the failure path, but AI
// off is not a failure, so nothing claims a call happened and nothing waits for a re-run.
describe("understandAnswer with AI off", () => {
  it("stores nothing a model writes, logs no call, sends no flag, and counts the answer understood", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    await seedHealthWordsConsent(h.db, scene.seed, { at: h.clock.now(), answer: "yes" });
    const answer = await herText(scene, "我明天去妹妹家住到星期日，今天跌倒了，膝蓋很痛");
    h.deps.ai = createOffAi();
    const logged = h.logger.entries.length;

    await understandAnswer(h.deps, answer.id);

    expect(await answerById(answer.id)).toMatchObject({
      summary: null,
      moodWords: [],
      mentions: {},
      flag: false,
      flagReason: null,
      awayUntil: null,
      understoodAt: h.clock.now(),
      processingAttempts: 1,
    });
    expect(await aiCallRows()).toEqual([]);
    expect(await h.db.select().from(translations)).toEqual([]);
    expect(await h.db.select().from(awayPeriods)).toEqual([]);
    // Her words are in the group already, in the answer post; no flag, away reply, or note follows.
    expect((await outboundRows()).map((row) => row.kind)).toEqual(["ack", "answer_post"]);
    expect(h.logger.entries.slice(logged).filter((entry) => entry.level !== "info")).toEqual([]);

    await understandAnswer(h.deps, answer.id);
    expect((await answerById(answer.id)).processingAttempts).toBe(1);
  });

  it("posts a voice answer's transcript untranslated, and logs only the speech-to-text call", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    const answer = await herVoice(scene);
    h.deps.ai = createOffAi();

    await ingestAnswerMedia(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);

    const posts = (await outboundRows()).filter((row) => row.kind === "answer_post");
    expect(posts.map(textOf)).toEqual([
      "☀️ Mom answered Mia · 08:12",
      "Mom (voice): fake transcript",
    ]);
    expect((await aiCallRows()).map((row) => [row.call, row.ok])).toEqual([["transcribe", true]]);
    expect(await answerById(answer.id)).toMatchObject({
      transcript: "fake transcript",
      summary: null,
      understoodAt: h.clock.now(),
      processingAttempts: 2,
    });
  });
});

describe("understandAnswer: health words (ADR-27)", () => {
  const WORDS = "I fell yesterday and my knee hurts";

  /** A model that heard health in her answer: a health mention, `unwell`, and a flag with a quote. */
  function healthAi(): FakeAi {
    return withAi({
      understand: async (input) => ({
        ok: true,
        value: {
          ...SAFE_DEFAULTS.understand(input),
          summary: "Mom answered.",
          moodWords: ["tired", "unwell"],
          mentions: {
            people: [],
            places: ["the market"],
            plans: [],
            health: ["fell", "knee hurts"],
            dates: [],
          },
        },
        record: fakeRecord("understand"),
      }),
      flag: async () => ({
        ok: true,
        value: {
          flag: true,
          category: "health",
          severity: "urgent",
          evidenceQuote: "I fell yesterday",
        },
        record: fakeRecord("flag"),
      }),
    });
  }

  async function flagNotices(): Promise<[string, string][]> {
    return (await outboundRows())
      .filter((row) => row.kind === "flag")
      .map((row) => [row.conversationId, textOf(row)]);
  }

  async function flagEvents(): Promise<unknown[]> {
    const rows = await h.db
      .select({ props: events.props })
      .from(events)
      .where(eq(events.name, "flag_raised"));
    return rows.map((row) => row.props);
  }

  it("without her consent stores no health mention, no unwell, no category and no quote, and tells the organisers only that a call may be worth it", async () => {
    const scene = await morning();
    const answer = await herText(scene, WORDS);
    const ai = healthAi();

    await understandAnswer(h.deps, answer.id);

    expect(ai.calls[0]?.input).toMatchObject({ healthWordsConsent: false });
    expect(await answerById(answer.id)).toMatchObject({
      moodWords: ["tired"],
      mentions: { people: [], places: ["the market"], plans: [], health: [], dates: [] },
      flag: true,
      flagReason: "urgent",
      understoodAt: h.clock.now(),
    });
    const logged = await aiCallRows();
    expect(logged.map((row) => [row.call, row.output])).toEqual([
      [
        "understand",
        {
          summary: "Mom answered.",
          moodWords: ["tired"],
          mentions: { people: [], places: ["the market"], plans: [], health: [], dates: [] },
          away: null,
          language: "en",
        },
      ],
      ["flag", { flag: true, category: null, severity: "urgent", evidenceQuote: null }],
    ]);
    expect(JSON.stringify(logged)).not.toContain("fell");
    expect(await flagNotices()).toEqual([
      [scene.seed.organiserLink.externalId, t("en", "flag.notice_no_words", { name: "Mom" })],
      [ADMIN, `Flag in The Chens. Open: ${adminLink(scene.seed.family.id)}`],
    ]);
    expect(await flagEvents()).toEqual([{ severity: "urgent", words: false }]);
  });

  it("with her yes given before the answer stores what the models returned and quotes her to the organisers", async () => {
    const scene = await morning();
    await seedHealthWordsConsent(h.db, scene.seed, {
      at: addMinutes(h.clock.now(), -60),
      answer: "yes",
    });
    const answer = await herText(scene, WORDS);
    const ai = healthAi();

    await understandAnswer(h.deps, answer.id);

    expect(ai.calls[0]?.input).toMatchObject({ healthWordsConsent: true });
    expect(await answerById(answer.id)).toMatchObject({
      moodWords: ["tired", "unwell"],
      mentions: { health: ["fell", "knee hurts"] },
      flagReason: "health:urgent",
    });
    expect(await flagNotices()).toEqual([
      [
        scene.seed.organiserLink.externalId,
        t("en", "flag.notice", { name: "Mom", quote: "I fell yesterday" }),
      ],
      [ADMIN, `Flag in The Chens. Open: ${adminLink(scene.seed.family.id)}`],
    ]);
    expect(await flagEvents()).toEqual([
      { severity: "urgent", words: true, category: "health", excerpt: true },
    ]);
  });

  it("counts a yes given after the answer arrived, a withdrawn yes, and a no as no consent", async () => {
    const setUps: ((scene: Scene) => Promise<unknown>)[] = [
      (scene) =>
        seedHealthWordsConsent(h.db, scene.seed, {
          at: addMinutes(h.clock.now(), 5),
          answer: "yes",
        }),
      async (scene) => {
        const yes = await seedHealthWordsConsent(h.db, scene.seed, {
          at: addMinutes(h.clock.now(), -60),
          answer: "yes",
        });
        await h.db
          .update(consents)
          .set({ withdrawnAt: h.clock.now() })
          .where(eq(consents.id, yes.id));
      },
      (scene) =>
        seedHealthWordsConsent(h.db, scene.seed, {
          at: addMinutes(h.clock.now(), -60),
          answer: "no",
        }),
    ];
    for (const setUp of setUps) {
      await h.reset();
      h.deps.stt = h.stt;
      const scene = await morning();
      const answer = await herText(scene, WORDS);
      await setUp(scene);
      const ai = healthAi();

      await understandAnswer(h.deps, answer.id);

      expect(ai.calls[0]?.input).toMatchObject({ healthWordsConsent: false });
      expect((await answerById(answer.id)).flagReason).toBe("urgent");
      expect((await flagNotices())[0]?.[1]).toBe(t("en", "flag.notice_no_words", { name: "Mom" }));
    }
  });

  it("sends no second notice when a re-run finds her consent changed", async () => {
    const scene = await morning();
    const answer = await herText(scene, WORDS);
    let understandCalls = 0;
    const ai = withAi({
      understand: async (input) => {
        understandCalls += 1;
        return understandCalls === 1
          ? failed("understand", SAFE_DEFAULTS.understand(input))
          : understood(input, null);
      },
      flag: async () => raised(),
    });

    await understandAnswer(h.deps, answer.id);
    await seedHealthWordsConsent(h.db, scene.seed, {
      at: addMinutes(answer.receivedAt, -60),
      answer: "yes",
    });
    await understandAnswer(h.deps, answer.id);

    expect(
      ai.calls.filter((call) => call.call === "understand").map((call) => call.input),
    ).toMatchObject([{ healthWordsConsent: false }, { healthWordsConsent: true }]);
    expect(await flagNotices()).toEqual([
      [scene.seed.organiserLink.externalId, t("en", "flag.notice_no_words", { name: "Mom" })],
      [ADMIN, `Flag in The Chens. Open: ${adminLink(scene.seed.family.id)}`],
    ]);
    expect(await flagEvents()).toHaveLength(1);
  });
});

describe("ingestAnswerMedia", () => {
  it("fetches, stores, transcribes with her language as the hint, logs the call, and hands the answer to understanding", async () => {
    const scene = await morning({ language: "en", memberLanguage: "zh-TW" });
    const { hints } = recordingStt();
    const answer = await herVoice(scene);

    await ingestAnswerMedia(h.deps, answer.id);

    expect(h.telegram.fetched).toEqual(["voice-1"]);
    const key = `families/${scene.seed.family.id}/answers/${answer.id}.ogg`;
    expect(h.media.objects.get(key)).toEqual({ body: VOICE_BYTES, mime: "audio/ogg" });
    const [file] = await h.db.select().from(media);
    // With a store, `bytes` becomes the length of what was stored, over the size Telegram reported.
    expect(file).toMatchObject({ storageKey: key, mime: "audio/ogg", bytes: 3 });
    expect(hints).toEqual(["zh-TW"]);
    expect(await answerById(answer.id)).toMatchObject({
      transcript: "fake transcript",
      transcriptLang: "zh-TW",
      understoodAt: null,
      processingAttempts: 1,
    });
    expect((await aiCallRows()).map((row) => [row.call, row.ok, row.output])).toEqual([
      ["transcribe", true, { language: "zh-TW", confidence: 0.99 }],
    ]);
    expect(h.queues.understand.pending.map((entry) => entry.job)).toEqual([
      { type: "understand_answer", answerId: answer.id },
    ]);

    await understandAnswer(h.deps, answer.id);
    expect(h.ai.calls[0]?.input).toMatchObject({
      answer: { kind: "voice", text: "fake transcript" },
    });
    expect((await answerById(answer.id)).processingAttempts).toBe(2);
    const posts = (await outboundRows()).filter((row) => row.kind === "answer_post");
    expect(posts.map(textOf)).toEqual([
      "☀️ Mom answered Mia · 08:12",
      "Mom (voice): fake transcript\n[en] fake transcript",
    ]);
    expect(StoredMessage.parse(posts[1]?.payload).message.replyToMessageId).toBe(
      posts[0]?.externalId,
    );
  });

  it("posts the transcript alone when the family shares her language", async () => {
    const scene = await morning();
    const answer = await herVoice(scene);

    await ingestAnswerMedia(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);

    const posts = (await outboundRows()).filter((row) => row.kind === "answer_post");
    expect(posts.map(textOf)).toEqual([
      "☀️ Mom answered Mia · 08:12",
      "Mom (voice): fake transcript",
    ]);
    expect(await h.db.select().from(translations)).toHaveLength(0);
  });

  it("ends the attempt without a transcript when transcription fails, reads the stored file next time, and tells the founder once after the third", async () => {
    const scene = await morning();
    const answer = await herVoice(scene);
    h.deps.stt = createFakeStt({ ok: false });
    const notices = async () =>
      (await outboundRows()).filter((row) => row.kind === "system" && row.conversationId === ADMIN);

    await ingestAnswerMedia(h.deps, answer.id);

    expect(await answerById(answer.id)).toMatchObject({ transcript: null, processingAttempts: 1 });
    expect(h.queues.understand.pending).toHaveLength(0);
    expect((await aiCallRows()).map((row) => [row.call, row.ok])).toEqual([["transcribe", false]]);
    expect(h.logger.entries.map((entry) => entry.event)).toContain("transcription_failed");
    // The voice reached the group before any of this.
    expect(h.telegram.sentTo(GROUP)[0]?.message.media).toEqual([VOICE]);

    await ingestAnswerMedia(h.deps, answer.id);
    expect(h.telegram.fetched).toEqual(["voice-1"]);
    expect(await notices()).toHaveLength(0);

    await ingestAnswerMedia(h.deps, answer.id);
    await ingestAnswerMedia(h.deps, answer.id);
    expect((await answerById(answer.id)).processingAttempts).toBe(4);
    const [notice] = await notices();
    expect(await notices()).toHaveLength(1);
    expect(notice === undefined ? null : textOf(notice)).toBe(
      `Could not read an answer in The Chens after three tries. Open: ${adminLink(scene.seed.family.id)}`,
    );
  });

  it("transcribes on the attempt the provider recovers and understands the answer", async () => {
    const scene = await morning();
    const answer = await herVoice(scene);
    h.deps.stt = createFakeStt({ ok: false });
    await ingestAnswerMedia(h.deps, answer.id);
    await ingestAnswerMedia(h.deps, answer.id);
    h.deps.stt = h.stt;

    await ingestAnswerMedia(h.deps, answer.id);
    await understandAnswer(h.deps, answer.id);

    expect(await answerById(answer.id)).toMatchObject({
      transcript: "fake transcript",
      understoodAt: h.clock.now(),
      processingAttempts: 4,
    });
    expect((await outboundRows()).filter((row) => row.kind === "answer_post")).toHaveLength(2);
    expect(
      (await outboundRows()).filter((row) => row.kind === "system" && row.conversationId === ADMIN),
    ).toHaveLength(0);
  });

  it("does not transcribe twice a voice whose transcript is already known", async () => {
    const scene = await morning();
    const { hints } = recordingStt();
    const answer = await herVoice(scene);
    await ingestAnswerMedia(h.deps, answer.id);

    await ingestAnswerMedia(h.deps, answer.id);

    expect(hints).toHaveLength(1);
    expect(h.telegram.fetched).toHaveLength(1);
    expect((await answerById(answer.id)).processingAttempts).toBe(1);
    expect(h.queues.understand.pending).toHaveLength(2);
  });

  // Decision M (2026-09-20): staging runs without R2. The only thing that changes for her is that
  // Vela keeps no copy; Telegram carries the voice note, and the transcript is made from the bytes
  // fetched from there.
  it("keeps no copy with media storage off, and still transcribes and hands the answer to understanding", async () => {
    const scene = await morning({ memberLanguage: "zh-TW" });
    const { hints } = recordingStt();
    const answer = await herVoice(scene);
    const storageOff: Deps = { ...h.deps, media: null };

    await ingestAnswerMedia(storageOff, answer.id);

    expect(h.telegram.fetched).toEqual(["voice-1"]);
    expect([...h.media.objects.keys()]).toEqual([]);
    const [file] = await h.db.select().from(media);
    // No storage key and no object, but the row still holds what Telegram said about the file: its
    // id, its type and the size it reported. The media_storage_off line says exactly this much.
    expect(file).toMatchObject({
      storageKey: null,
      providerFileId: "voice-1",
      mime: "audio/ogg",
      bytes: VOICE.bytes,
    });
    expect(hints).toEqual(["zh-TW"]);
    expect(await answerById(answer.id)).toMatchObject({
      transcript: "fake transcript",
      transcriptLang: "zh-TW",
      processingAttempts: 1,
    });
    expect((await aiCallRows()).map((row) => [row.call, row.ok])).toEqual([["transcribe", true]]);
    expect(h.queues.understand.pending.map((entry) => entry.job)).toEqual([
      { type: "understand_answer", answerId: answer.id },
    ]);
    // The voice reached the group as it always does, by its Telegram file id.
    expect(h.telegram.sentTo(GROUP)[0]?.message.media).toEqual([VOICE]);
  });

  // Nothing is stored to read back, so a second attempt asks Telegram again rather than giving up.
  it("fetches the voice from the channel again on a re-run with media storage off", async () => {
    const scene = await morning();
    const answer = await herVoice(scene);
    const storageOff: Deps = { ...h.deps, media: null, stt: createFakeStt({ ok: false }) };

    await ingestAnswerMedia(storageOff, answer.id);
    expect(await answerById(answer.id)).toMatchObject({ transcript: null, processingAttempts: 1 });

    await ingestAnswerMedia({ ...storageOff, stt: h.stt }, answer.id);

    expect(h.telegram.fetched).toEqual(["voice-1", "voice-1"]);
    expect(await answerById(answer.id)).toMatchObject({ transcript: "fake transcript" });
  });

  // A file stored while storage was on: nothing here can open its object any more, so the bytes
  // come from Telegram, which still holds the voice note.
  it("reads a row stored before media storage was switched off from the channel instead", async () => {
    const scene = await morning();
    const answer = await herVoice(scene);
    const key = `families/${scene.seed.family.id}/answers/${answer.id}.ogg`;
    await h.media.put(key, VOICE_BYTES, "audio/ogg");
    await h.db.update(media).set({ storageKey: key, bytes: 3 });

    await ingestAnswerMedia({ ...h.deps, media: null }, answer.id);

    expect(h.telegram.fetched).toEqual(["voice-1"]);
    expect(h.logger.entries.map((entry) => entry.event)).not.toContain(
      "answer_media_object_missing",
    );
    expect(await answerById(answer.id)).toMatchObject({ transcript: "fake transcript" });
    // The object and the key it was stored under are left exactly as they were.
    expect(h.media.objects.get(key)).toEqual({ body: VOICE_BYTES, mime: "audio/ogg" });
    expect((await h.db.select().from(media))[0]?.storageKey).toBe(key);
  });

  it("never throws when the platform or the store fails, and spends the attempt", async () => {
    const scene = await morning();
    const { hints } = recordingStt();
    const answer = await herVoice(scene);
    const unreachable: ChannelAdapter = {
      ...h.telegram,
      fetchMedia: async () => {
        throw new ChannelSendError("unavailable", "fake telegram: unavailable");
      },
    };
    const deps: Deps = { ...h.deps, channels: { get: () => unreachable } };

    await expect(ingestAnswerMedia(deps, answer.id)).resolves.toBeUndefined();

    expect(hints).toEqual([]);
    expect(await answerById(answer.id)).toMatchObject({ transcript: null, processingAttempts: 1 });
    expect(h.logger.entries.map((entry) => entry.event)).toContain("answer_media_fetch_failed");

    const fullStore: Deps = {
      ...h.deps,
      media: {
        ...h.media,
        put: async () => {
          throw new Error("bucket unavailable");
        },
      },
    };
    await expect(ingestAnswerMedia(fullStore, answer.id)).resolves.toBeUndefined();
    expect(hints).toEqual([]);
    expect((await h.db.select().from(media))[0]?.storageKey).toBeNull();
    expect(h.logger.entries.map((entry) => entry.event)).toContain("answer_media_store_failed");
  });
});
