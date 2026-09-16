import { ChannelSendError, type OutboundMessage } from "@vela/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutboundJob } from "../deps.ts";
import { createFakeTelegram } from "./fake-telegram.ts";
import { createFakeClock } from "./fakes.ts";
import { createHarness, HARNESS_START, type Harness } from "./harness.ts";

function message(conversationId: string, extra: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    kind: "system",
    idempotencyKey: `system:${conversationId}:${Math.random()}`,
    lang: "en",
    to: { channel: "telegram", conversationId },
    text: "Hello",
    ...extra,
  };
}

describe("the fake Telegram adapter", () => {
  it("numbers messages per conversation, media first, and returns the text as primary", async () => {
    const telegram = createFakeTelegram(createFakeClock(HARNESS_START));

    const first = await telegram.send(message("1001"));
    const album = await telegram.send(
      message("1001", {
        media: [
          { kind: "image", providerFileId: "p1" },
          { kind: "image", providerFileId: "p2" },
        ],
      }),
    );
    const other = await telegram.send(message("2001"));

    expect(first).toEqual({ externalMessageIds: ["1"], primaryMessageId: "1" });
    expect(album).toEqual({ externalMessageIds: ["2", "3", "4"], primaryMessageId: "4" });
    expect(other).toEqual({ externalMessageIds: ["1"], primaryMessageId: "1" });
    expect(telegram.sentTo("1001")).toHaveLength(2);
  });

  it("fails the next N sends with the chosen error, then sends again", async () => {
    const telegram = createFakeTelegram(createFakeClock(HARNESS_START));
    telegram.failNextSends(2, "rate_limited", { retryAfterSeconds: 42 });

    const failures: ChannelSendError[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await telegram.send(message("1001"));
      } catch (error) {
        if (error instanceof ChannelSendError) {
          failures.push(error);
        }
      }
    }
    const result = await telegram.send(message("1001"));

    expect(failures.map((error) => [error.code, error.retryable, error.retryAfterSeconds])).toEqual(
      [
        ["rate_limited", true, 42],
        ["rate_limited", true, 42],
      ],
    );
    expect(result.primaryMessageId).toBe("1");
    expect(telegram.failed).toHaveLength(2);
    expect(telegram.sent).toHaveLength(1);
  });

  it("fails every send to one conversation until the rule is cleared, leaving others alone", async () => {
    const telegram = createFakeTelegram(createFakeClock(HARNESS_START));
    telegram.failSendsTo("1001", "invalid_request", { migratedToConversationId: "-100" });

    await expect(telegram.send(message("1001"))).rejects.toMatchObject({
      code: "invalid_request",
      retryable: false,
      migratedToConversationId: "-100",
    });
    await expect(telegram.send(message("1001"))).rejects.toBeInstanceOf(ChannelSendError);
    await expect(telegram.send(message("2001"))).resolves.toBeDefined();

    telegram.clearFailures();
    await expect(telegram.send(message("1001"))).resolves.toEqual({
      externalMessageIds: ["1"],
      primaryMessageId: "1",
    });
  });

  it("records closed buttons, acknowledged taps, and fetched media", async () => {
    const telegram = createFakeTelegram(createFakeClock(HARNESS_START));
    telegram.mediaFiles.set("voice-1", { body: new ArrayBuffer(3), mime: "audio/ogg" });

    await telegram.closeButtons("1001", "5", "Chosen");
    await telegram.acknowledgeButton(
      {
        channel: "telegram",
        eventId: "tg:1",
        at: HARNESS_START.toISOString(),
        kind: "button",
        sender: { externalUserId: "1001" },
        conversation: { externalId: "1001", kind: "private" },
        callbackId: "cb1",
      },
      "Thanks",
    );
    const known = await telegram.fetchMedia("voice-1");
    const unknown = await telegram.fetchMedia("photo-9");

    expect(telegram.closed).toEqual([
      { conversationId: "1001", messageId: "5", replacementText: "Chosen" },
    ]);
    expect(telegram.acknowledged).toEqual([{ eventId: "tg:1", callbackId: "cb1", text: "Thanks" }]);
    expect(known.mime).toBe("audio/ogg");
    expect(unknown.mime).toBe("application/octet-stream");
    expect(telegram.fetched).toEqual(["voice-1", "photo-9"]);
  });
});

describe("the harness", () => {
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

  it("drains queues in due order, moving the clock to each delayed job", async () => {
    const ran: [string, number][] = [];
    await h.queues.outbound.send({ type: "deliver", outboundId: "later" }, { delaySeconds: 900 });
    await h.queues.outbound.send({ type: "deliver", outboundId: "sooner" }, { delaySeconds: 300 });
    await h.queues.outbound.send({ type: "deliver", outboundId: "now" });
    await h.queues.understand.send({ type: "understand_answer", answerId: "unhandled" });

    const count = await h.run({
      outbound: async (job: OutboundJob) => {
        ran.push([job.outboundId, (h.clock.now().getTime() - HARNESS_START.getTime()) / 60_000]);
      },
    });

    expect(count).toBe(3);
    expect(ran).toEqual([
      ["now", 0],
      ["sooner", 5],
      ["later", 15],
    ]);
    expect(h.queues.outbound.pending).toHaveLength(0);
    // A queue without a handler keeps its jobs for a later drain.
    expect(h.queues.understand.pending).toHaveLength(1);
  });

  it("runs only what is due when asked not to move the clock", async () => {
    await h.queues.outbound.send({ type: "deliver", outboundId: "now" });
    await h.queues.outbound.send({ type: "deliver", outboundId: "later" }, { delaySeconds: 60 });

    expect(await h.runDue({ outbound: async () => undefined })).toBe(1);
    expect(h.clock.now()).toEqual(HARNESS_START);
    expect(h.queues.outbound.pending.map((entry) => entry.job.outboundId)).toEqual(["later"]);

    h.clock.advanceMinutes(1);
    expect(await h.runDue({ outbound: async () => undefined })).toBe(1);
  });

  it("puts everything back on reset: the clock, the recorders, the queues, and the AI", async () => {
    h.clock.advanceMinutes(90);
    await h.queues.media.send({ type: "ingest_answer_media", answerId: "a1" });
    await h.scheduler.wakeAt("m1", h.clock.now());
    await h.heartbeat.ping();
    h.telegram.failNextSends(1, "unavailable");
    h.logger.info("something");
    await h.ai.flag({
      lang: "en",
      addressForm: "Mom",
      ask: null,
      answer: { kind: "text", text: "fine" },
      recentSummaries: [],
    });
    const before = h.ai;

    await h.reset();

    expect(h.clock.now()).toEqual(HARNESS_START);
    expect(h.queues.media.pending).toHaveLength(0);
    expect(h.scheduler.wakes.size).toBe(0);
    expect(h.heartbeat.pings).toBe(0);
    expect(h.logger.entries).toHaveLength(0);
    expect(h.ai).not.toBe(before);
    expect(h.ai.calls).toHaveLength(0);
    expect(h.deps.ai).toBe(h.ai);
    await expect(h.telegram.send(message("1001"))).resolves.toBeDefined();
  });

  it("hands out deterministic tokens and a Telegram adapter through the registry", () => {
    expect(h.random.token()).toMatch(/^token-1/);
    expect(h.random.token(8)).toMatch(/^token-2/);
    expect(h.deps.channels.get("telegram")).toBe(h.telegram);
    expect(() => h.deps.channels.get("line")).toThrow(/no adapter/);
    expect(h.config.privacyNoticeUrls["zh-TW"]).toContain("zh-TW");
    expect(h.config.privacyNoticeUrls.ja).toBe(h.config.privacyNoticeUrls.en);
  });
});
