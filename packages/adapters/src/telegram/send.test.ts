import { ChannelSendError, type OutboundMessage } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { createTelegramAdapter } from "./adapter.ts";
import {
  createRecordingFetch,
  type Responder,
  sequentialSends,
  TEST_BOT_TOKEN,
  TEST_WEBHOOK_SECRET,
  telegramErrorFixture,
} from "./testing.ts";

const PHOTO_A = "AgACAgUAAxkBAAIEsWbjS7pNAAKhwjEb0xAhV3M-rQABAQADAgADeQADNgQ";
const PHOTO_B_URL = "https://media.vela.example/asks/7f3c/b.jpg?sig=abc";
const VOICE = "AwACAgUAAxkBAAIBP2bj8x1kQz0vT6yWm3Hn2pLr5sUAAl8TAAKj3yBXkQ7ZsYw1d8o2BA";

const ARRIVAL: OutboundMessage = {
  kind: "arrival",
  idempotencyKey: "arrival:6023817745:2026-09-13",
  lang: "zh-TW",
  to: { channel: "telegram", conversationId: "6023817745" },
  text: "Anna asks:\nWhat did you have for breakfast? <b>not markup</b> https://example.com",
};

const TEXT_PARAMS = {
  chat_id: 6023817745,
  text: ARRIVAL.text,
  link_preview_options: { is_disabled: true },
};

function setup(responder: Responder = sequentialSends(500)) {
  const recording = createRecordingFetch(responder);
  const adapter = createTelegramAdapter({
    botToken: TEST_BOT_TOKEN,
    webhookSecret: TEST_WEBHOOK_SECRET,
    fetch: recording.fetch,
  });
  const calls = (): [string, unknown][] =>
    recording.requests.map((request) => [request.apiMethod, request.params]);
  return { adapter, requests: recording.requests, calls };
}

describe("adapter.send", () => {
  it("sends text alone as one sendMessage with previews off and no parse mode", async () => {
    const { adapter, requests, calls } = setup();

    const result = await adapter.send(ARRIVAL);

    expect(calls()).toStrictEqual([["sendMessage", TEXT_PARAMS]]);
    expect(requests[0]?.url).toBe(`https://api.telegram.org/bot${TEST_BOT_TOKEN}/sendMessage`);
    expect(requests[0]?.httpMethod).toBe("POST");
    expect(requests[0]?.contentType).toBe("application/json");
    expect(result).toStrictEqual({ externalMessageIds: ["500"], primaryMessageId: "500" });
  });

  it("attaches buttons to the text as an inline keyboard of callback buttons", async () => {
    const { adapter, calls } = setup();

    await adapter.send({
      ...ARRIVAL,
      buttons: [
        [
          { id: "x:3f9a:c:1", label: "Congee" },
          { id: "x:3f9a:c:2", label: "Toast" },
        ],
        [{ id: "x:3f9a:f", label: "I’m fine" }],
      ],
    });

    expect(calls()).toStrictEqual([
      [
        "sendMessage",
        {
          ...TEXT_PARAMS,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Congee", callback_data: "x:3f9a:c:1" },
                { text: "Toast", callback_data: "x:3f9a:c:2" },
              ],
              [{ text: "I’m fine", callback_data: "x:3f9a:f" }],
            ],
          },
        },
      ],
    ]);
  });

  it("sends one image with sendPhoto before the text", async () => {
    const { adapter, calls } = setup();

    const result = await adapter.send({
      ...ARRIVAL,
      media: [{ kind: "image", providerFileId: PHOTO_A }],
    });

    expect(calls()).toStrictEqual([
      ["sendPhoto", { chat_id: 6023817745, photo: PHOTO_A }],
      ["sendMessage", TEXT_PARAMS],
    ]);
    expect(result).toStrictEqual({ externalMessageIds: ["500", "501"], primaryMessageId: "501" });
  });

  it("sends several images as one album before the text", async () => {
    const { adapter, calls } = setup();

    const result = await adapter.send({
      ...ARRIVAL,
      media: [
        { kind: "image", providerFileId: PHOTO_A },
        { kind: "image", url: PHOTO_B_URL },
      ],
    });

    expect(calls()).toStrictEqual([
      [
        "sendMediaGroup",
        {
          chat_id: 6023817745,
          media: [
            { type: "photo", media: PHOTO_A },
            { type: "photo", media: PHOTO_B_URL },
          ],
        },
      ],
      ["sendMessage", TEXT_PARAMS],
    ]);
    expect(result).toStrictEqual({
      externalMessageIds: ["500", "501", "502"],
      primaryMessageId: "502",
    });
  });

  it("sends audio as a voice message with its duration in whole seconds before the text", async () => {
    const { adapter, calls } = setup();

    await adapter.send({
      ...ARRIVAL,
      media: [{ kind: "audio", providerFileId: VOICE, durationMs: 22_400, mime: "audio/ogg" }],
    });

    expect(calls()).toStrictEqual([
      ["sendVoice", { chat_id: 6023817745, voice: VOICE, duration: 23 }],
      ["sendMessage", TEXT_PARAMS],
    ]);
  });

  it("keeps media in the given order, grouping only consecutive images", async () => {
    const { adapter, calls } = setup();

    const result = await adapter.send({
      ...ARRIVAL,
      media: [
        { kind: "audio", providerFileId: VOICE },
        { kind: "image", providerFileId: PHOTO_A },
        { kind: "image", url: PHOTO_B_URL },
        { kind: "audio", url: "https://media.vela.example/replies/sam.ogg" },
        { kind: "image", providerFileId: PHOTO_A },
      ],
    });

    expect(calls().map(([method]) => method)).toStrictEqual([
      "sendVoice",
      "sendMediaGroup",
      "sendVoice",
      "sendPhoto",
      "sendMessage",
    ]);
    expect(result.externalMessageIds).toStrictEqual(["500", "501", "502", "503", "504", "505"]);
    expect(result.primaryMessageId).toBe("505");
  });

  it("replies with reply_parameters, still sending if the original is gone", async () => {
    const { adapter, calls } = setup();

    await adapter.send({
      ...ARRIVAL,
      kind: "answer_post",
      to: { channel: "telegram", conversationId: "-1002214567890" },
      replyToMessageId: "1198",
    });

    expect(calls()).toStrictEqual([
      [
        "sendMessage",
        {
          chat_id: -1002214567890,
          text: ARRIVAL.text,
          link_preview_options: { is_disabled: true },
          reply_parameters: { message_id: 1198, allow_sending_without_reply: true },
        },
      ],
    ]);
  });

  it("stops at the first failed call and throws its mapped error", async () => {
    const { adapter, calls } = setup(() => telegramErrorFixture("error-403-blocked.json"));

    const failure = adapter.send({
      ...ARRIVAL,
      media: [{ kind: "image", providerFileId: PHOTO_A }],
    });

    await expect(failure).rejects.toMatchObject({ code: "blocked", retryable: false });
    expect(calls().map(([method]) => method)).toStrictEqual(["sendPhoto"]);
  });

  describe("rejects before calling Telegram", () => {
    const invalid: [string, OutboundMessage][] = [
      [
        "a message for another channel",
        { ...ARRIVAL, to: { channel: "line", conversationId: "U123" } },
      ],
      [
        "a conversation id that is not a chat id",
        { ...ARRIVAL, to: { channel: "telegram", conversationId: "abc" } },
      ],
      ["a reply id that is not a message id", { ...ARRIVAL, replyToMessageId: "latest" }],
      [
        "a button id over 64 bytes",
        // 22 characters within the schema's limit, but 66 bytes of UTF-8.
        { ...ARRIVAL, buttons: [[{ id: "早".repeat(22), label: "Breakfast" }]] },
      ],
      ["a message the contract rejects", { ...ARRIVAL, text: "" }],
    ];

    it.each(invalid)("%s", async (_name, message) => {
      const { adapter, requests } = setup();
      const failure = adapter.send(message);
      await expect(failure).rejects.toBeInstanceOf(ChannelSendError);
      await expect(failure).rejects.toMatchObject({ code: "invalid_request", retryable: false });
      expect(requests).toHaveLength(0);
    });
  });
});
