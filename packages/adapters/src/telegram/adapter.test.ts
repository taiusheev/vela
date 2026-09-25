import { ChannelSendError, type InboundEvent } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { createTelegramAdapter } from "./adapter.ts";
import { mimeFor, TELEGRAM_MAX_DOWNLOAD_BYTES } from "./media.ts";
import {
  botApi,
  createRecordingFetch,
  type Responder,
  readFixture,
  TEST_BOT_TOKEN,
  TEST_BOT_USERNAME,
  TEST_WEBHOOK_SECRET,
  telegramOk,
} from "./testing.ts";

const TAPPED_AT = new Date("2026-09-13T00:11:02.345Z");

function setup(responder: Responder) {
  const recording = createRecordingFetch(responder);
  const adapter = createTelegramAdapter({
    botToken: TEST_BOT_TOKEN,
    webhookSecret: TEST_WEBHOOK_SECRET,
    botUsername: TEST_BOT_USERNAME,
    fetch: recording.fetch,
    now: () => TAPPED_AT,
  });
  const calls = (): [string, unknown][] =>
    recording.requests.map((request) => [request.apiMethod, request.params]);
  return { adapter, requests: recording.requests, calls };
}

function tapEvent(adapter: ReturnType<typeof setup>["adapter"]): InboundEvent {
  const [event] = adapter.parse({
    headers: new Headers(),
    rawBody: readFixture("callback-query.json"),
  });
  if (event === undefined) throw new Error("the callback fixture must parse to an event");
  return event;
}

describe("createTelegramAdapter", () => {
  it("describes Telegram's capabilities", () => {
    const { adapter } = setup(botApi({}));
    expect(adapter.id).toBe("telegram");
    expect(adapter.capabilities).toStrictEqual({
      buttons: true,
      voiceIn: true,
      voiceOut: true,
      readReceipts: false,
      reactions: true,
      albums: true,
      editMessages: true,
      resendsProviderFiles: true,
      mediaByUrl: false,
      mediaReplies: true,
    });
  });

  it("implements none of the optional methods", () => {
    const { adapter } = setup(botApi({}));
    expect(adapter.profile).toBeUndefined();
    expect(adapter.leaveConversation).toBeUndefined();
    expect(adapter.quota).toBeUndefined();
    expect(adapter.fetchPreview).toBeUndefined();
  });

  it("refuses a webhook secret Telegram would not accept", () => {
    expect(() =>
      createTelegramAdapter({
        botToken: TEST_BOT_TOKEN,
        webhookSecret: "has spaces",
        botUsername: TEST_BOT_USERNAME,
      }),
    ).toThrow(/webhook secret/);
    expect(() =>
      createTelegramAdapter({
        botToken: TEST_BOT_TOKEN,
        webhookSecret: "",
        botUsername: TEST_BOT_USERNAME,
      }),
    ).toThrow(/webhook secret/);
  });

  it("refuses a bot username given with the @ or empty", () => {
    for (const botUsername of ["@VelaLightBot", "", "Vela Light Bot"]) {
      expect(() =>
        createTelegramAdapter({
          botToken: TEST_BOT_TOKEN,
          webhookSecret: TEST_WEBHOOK_SECRET,
          botUsername,
        }),
      ).toThrow(/bot username/);
    }
  });

  it("dates button taps with the injected clock", () => {
    const { adapter } = setup(botApi({}));
    expect(tapEvent(adapter).at).toBe("2026-09-13T00:11:02.345Z");
  });

  it("parses commands against its own bot username", () => {
    const rawBody = readFixture("group-ask-with-mention.json");
    const velaLight = setup(botApi({})).adapter;
    const otherBot = createTelegramAdapter({
      botToken: TEST_BOT_TOKEN,
      webhookSecret: TEST_WEBHOOK_SECRET,
      botUsername: "RecipeHelperBot",
    });

    expect(velaLight.parse({ headers: new Headers(), rawBody }).map((e) => e.kind)).toStrictEqual([
      "text",
    ]);
    expect(otherBot.parse({ headers: new Headers(), rawBody })).toStrictEqual([]);
  });
});

describe("adapter.acknowledgeButton", () => {
  it("answers the callback query with the optional text", async () => {
    const { adapter, calls } = setup(botApi({ answerCallbackQuery: () => true }));
    const tap = tapEvent(adapter);

    await adapter.acknowledgeButton(tap);
    await adapter.acknowledgeButton(tap, "Sent to Anna");

    expect(calls()).toStrictEqual([
      ["answerCallbackQuery", { callback_query_id: "2587416093847561234" }],
      ["answerCallbackQuery", { callback_query_id: "2587416093847561234", text: "Sent to Anna" }],
    ]);
  });

  it("refuses an event that is not a button tap without calling Telegram", async () => {
    const { adapter, requests } = setup(botApi({ answerCallbackQuery: () => true }));
    const [text] = adapter.parse({
      headers: new Headers(),
      rawBody: readFixture("private-text.json"),
    });
    if (text === undefined) throw new Error("the text fixture must parse to an event");

    await expect(adapter.acknowledgeButton(text)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(requests).toHaveLength(0);
  });
});

describe("adapter.closeButtons", () => {
  it("removes the keyboard with editMessageReplyMarkup when no text is given", async () => {
    const { adapter, calls } = setup(
      botApi({ editMessageReplyMarkup: () => ({ message_id: 317 }) }),
    );

    await adapter.closeButtons("6023817745", "317");

    expect(calls()).toStrictEqual([
      ["editMessageReplyMarkup", { chat_id: 6023817745, message_id: 317 }],
    ]);
  });

  it("replaces the text, which also drops the keyboard, when text is given", async () => {
    const { adapter, calls } = setup(botApi({ editMessageText: () => ({ message_id: 317 }) }));

    await adapter.closeButtons(
      "6023817745",
      "317",
      "Anna asks: What did you have for breakfast?\n→ Congee",
    );

    expect(calls()).toStrictEqual([
      [
        "editMessageText",
        {
          chat_id: 6023817745,
          message_id: 317,
          text: "Anna asks: What did you have for breakfast?\n→ Congee",
          link_preview_options: { is_disabled: true },
        },
      ],
    ]);
  });

  it("treats a message that is already closed as done", async () => {
    const { adapter } = setup(() =>
      Response.json(
        {
          ok: false,
          error_code: 400,
          description:
            "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message",
        },
        { status: 400 },
      ),
    );

    await expect(adapter.closeButtons("6023817745", "317")).resolves.toBeUndefined();
  });

  it("throws other failures", async () => {
    const { adapter } = setup(() =>
      Response.json(
        { ok: false, error_code: 400, description: "Bad Request: message to edit not found" },
        { status: 400 },
      ),
    );

    await expect(adapter.closeButtons("6023817745", "317")).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("adapter.fetchMedia", () => {
  const VOICE_ID = "AwACAgUAAxkBAAIBP2bj8x1kQz0vT6yWm3Hn2pLr5sUAAl8TAAKj3yBXkQ7ZsYw1d8o2BA";
  const audioBytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);

  it("calls getFile and then downloads the file path", async () => {
    const { adapter, requests } = setup((request) =>
      request.apiMethod === "getFile"
        ? telegramOk({
            file_id: VOICE_ID,
            file_unique_id: "AgADXxMAAqPfIFc",
            file_size: 6,
            file_path: "voice/file_12.oga",
          })
        : new Response(audioBytes, { headers: { "content-type": "application/octet-stream" } }),
    );

    const media = await adapter.fetchMedia(VOICE_ID);

    expect(
      requests.map((request) => [request.httpMethod, request.url, request.params]),
    ).toStrictEqual([
      ["POST", `https://api.telegram.org/bot${TEST_BOT_TOKEN}/getFile`, { file_id: VOICE_ID }],
      ["GET", `https://api.telegram.org/file/bot${TEST_BOT_TOKEN}/voice/file_12.oga`, undefined],
    ]);
    expect(new Uint8Array(media.body)).toStrictEqual(audioBytes);
    expect(media.mime).toBe("audio/ogg");
  });

  it("rejects a file over 20 MB before downloading it", async () => {
    // A download path is present, so only the size Telegram reported can stop the download.
    const { adapter, requests } = setup(
      botApi({
        getFile: () => ({
          file_id: VOICE_ID,
          file_unique_id: "AgADXxMAAqPfIFc",
          file_size: TELEGRAM_MAX_DOWNLOAD_BYTES + 1,
          file_path: "voice/file_12.oga",
        }),
      }),
    );

    const failure = adapter.fetchMedia(VOICE_ID);

    await expect(failure).rejects.toBeInstanceOf(ChannelSendError);
    await expect(failure).rejects.toMatchObject({ code: "invalid_request", retryable: false });
    await expect(failure).rejects.toThrow(/download limit/);
    expect(requests.map((request) => request.apiMethod)).toStrictEqual(["getFile"]);
  });

  it("rejects a download whose declared length is over 20 MB when getFile gave no size", async () => {
    const { adapter } = setup((request) =>
      request.apiMethod === "getFile"
        ? telegramOk({
            file_id: VOICE_ID,
            file_unique_id: "AgADXxMAAqPfIFc",
            file_path: "voice/file_12.oga",
          })
        : new Response(audioBytes, {
            headers: { "content-length": String(TELEGRAM_MAX_DOWNLOAD_BYTES + 1) },
          }),
    );

    await expect(adapter.fetchMedia(VOICE_ID)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("maps a getFile failure like any other call", async () => {
    const { adapter } = setup(() =>
      Response.json(
        { ok: false, error_code: 400, description: "Bad Request: invalid file_id" },
        { status: 400 },
      ),
    );

    await expect(adapter.fetchMedia("nonsense")).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("mimeFor", () => {
  it("prefers the extension Telegram stored the file under", () => {
    expect(mimeFor("photos/file_3.jpg", "application/octet-stream")).toBe("image/jpeg");
    expect(mimeFor("music/file_4.m4a", null)).toBe("audio/mp4");
  });

  it("falls back to the declared content type, then to a generic type", () => {
    expect(mimeFor("documents/file_5", "image/heic; charset=binary")).toBe("image/heic");
    expect(mimeFor("documents/file_5", null)).toBe("application/octet-stream");
  });

  it("does not mistake inherited object keys for extensions", () => {
    expect(mimeFor("documents/file.constructor", null)).toBe("application/octet-stream");
  });
});
