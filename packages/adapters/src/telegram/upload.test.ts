/**
 * Photos Vela keeps (ADR-33) go to Telegram as uploads: `sendPhoto` or `sendMediaGroup` as
 * multipart/form-data, from the bytes the gateway loaded for the attempt, while a photo Telegram
 * already holds is still named in JSON. The error handling is the JSON path's own.
 */
import {
  ChannelSendError,
  type FetchedMedia,
  type OutboundMessage,
  type SendResult,
} from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { createTelegramAdapter } from "./adapter.ts";
import { createTelegramClient } from "./client.ts";
import {
  createRecordingFetch,
  type Responder,
  sequentialSends,
  TEST_BOT_TOKEN,
  TEST_BOT_USERNAME,
  TEST_WEBHOOK_SECRET,
  telegramErrorFixture,
  telegramOk,
} from "./testing.ts";

const PHOTO_A = "AgACAgUAAxkBAAIEsWbjS7pNAAKhwjEb0xAhV3M-rQABAQADAgADeQADNgQ";
const KEY_ONE = "asks/0199a0b2-4c5d-7e6f-8a9b-0c1d2e3f4a5b/one.jpg";
const KEY_TWO = "asks/0199a0b2-4c5d-7e6f-8a9b-0c1d2e3f4a5b/two.jpg";

const ARRIVAL: OutboundMessage = {
  kind: "arrival",
  idempotencyKey: "arrival:6023817745:2026-09-27",
  lang: "en",
  to: { channel: "telegram", conversationId: "6023817745" },
  text: "Mia asks:\nWhich one do you like more?",
  buttons: [
    [
      { id: "x:3f9a:p:0", label: "1" },
      { id: "x:3f9a:p:1", label: "2" },
    ],
  ],
};

function jpeg(marker: number): FetchedMedia {
  return { body: new Uint8Array([0xff, 0xd8, marker, 0xff, 0xd9]).buffer, mime: "image/jpeg" };
}

const FILES: ReadonlyMap<string, FetchedMedia> = new Map([
  [KEY_ONE, jpeg(1)],
  [KEY_TWO, jpeg(2)],
]);

function setup(responder: Responder = sequentialSends(700)) {
  const recording = createRecordingFetch(responder);
  const adapter = createTelegramAdapter({
    botToken: TEST_BOT_TOKEN,
    webhookSecret: TEST_WEBHOOK_SECRET,
    botUsername: TEST_BOT_USERNAME,
    fetch: recording.fetch,
  });
  return { adapter, requests: recording.requests };
}

function stored(storageKey: string) {
  return { kind: "image" as const, storageKey, mime: "image/jpeg" };
}

describe("a photo Vela keeps, sent to Telegram", () => {
  it("uploads one photo as a multipart sendPhoto, then sends the text as JSON", async () => {
    const { adapter, requests } = setup();

    const result = await adapter.send({ ...ARRIVAL, media: [stored(KEY_ONE)] }, FILES);

    expect(requests.map((request) => request.apiMethod)).toEqual(["sendPhoto", "sendMessage"]);
    const [photo, text] = requests;
    expect(photo?.url).toBe(`https://api.telegram.org/bot${TEST_BOT_TOKEN}/sendPhoto`);
    expect(photo?.httpMethod).toBe("POST");
    // `fetch` writes the multipart type with its boundary; the client sets none of its own.
    expect(photo?.contentType).toBeNull();
    expect(photo?.params).toStrictEqual({ chat_id: "6023817745" });
    expect(photo?.files).toStrictEqual([
      {
        field: "photo",
        filename: "photo.jpg",
        type: "image/jpeg",
        bytes: new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9]),
      },
    ]);
    expect(text?.contentType).toBe("application/json");
    expect(text?.files).toStrictEqual([]);
    expect(result).toStrictEqual<SendResult>({
      externalMessageIds: ["700", "701"],
      primaryMessageId: "701",
    });
  });

  it("uploads a photo choice as one album, attaching each photo in her order, buttons on the text", async () => {
    const { adapter, requests } = setup();

    const result = await adapter.send(
      { ...ARRIVAL, media: [stored(KEY_ONE), stored(KEY_TWO)] },
      FILES,
    );

    const [album, text] = requests;
    expect(album?.apiMethod).toBe("sendMediaGroup");
    expect(album?.contentType).toBeNull();
    expect(album?.params).toStrictEqual({
      chat_id: "6023817745",
      media: [
        { type: "photo", media: "attach://p0" },
        { type: "photo", media: "attach://p1" },
      ],
    });
    expect(album?.files.map((file) => [file.field, [...file.bytes]])).toStrictEqual([
      ["p0", [0xff, 0xd8, 1, 0xff, 0xd9]],
      ["p1", [0xff, 0xd8, 2, 0xff, 0xd9]],
    ]);
    expect(text?.params).toMatchObject({
      reply_markup: {
        inline_keyboard: [
          [
            { text: "1", callback_data: "x:3f9a:p:0" },
            { text: "2", callback_data: "x:3f9a:p:1" },
          ],
        ],
      },
    });
    expect(result).toStrictEqual<SendResult>({
      externalMessageIds: ["700", "701", "702"],
      primaryMessageId: "702",
    });
  });

  it("mixes a photo Telegram holds into the uploaded album by its file id", async () => {
    const { adapter, requests } = setup();

    await adapter.send(
      { ...ARRIVAL, media: [{ kind: "image", providerFileId: PHOTO_A }, stored(KEY_TWO)] },
      FILES,
    );

    expect(requests[0]?.params).toStrictEqual({
      chat_id: "6023817745",
      media: [
        { type: "photo", media: PHOTO_A },
        { type: "photo", media: "attach://p1" },
      ],
    });
    expect(requests[0]?.files.map((file) => file.field)).toStrictEqual(["p1"]);
  });

  it("keeps an album of file ids on the JSON path, whatever files it is handed", async () => {
    const { adapter, requests } = setup();

    await adapter.send(
      {
        ...ARRIVAL,
        media: [
          { kind: "image", providerFileId: PHOTO_A },
          { kind: "image", providerFileId: PHOTO_A },
        ],
      },
      FILES,
    );

    expect(requests[0]?.contentType).toBe("application/json");
    expect(requests[0]?.files).toStrictEqual([]);
    expect(requests[0]?.params).toStrictEqual({
      chat_id: 6023817745,
      media: [
        { type: "photo", media: PHOTO_A },
        { type: "photo", media: PHOTO_A },
      ],
    });
  });

  describe("refuses before calling Telegram", () => {
    const cases: [string, OutboundMessage, ReadonlyMap<string, FetchedMedia> | undefined][] = [
      [
        "a stored photo whose bytes were not handed over",
        { ...ARRIVAL, media: [stored(KEY_ONE)] },
        undefined,
      ],
      [
        "one of an album's stored photos missing from the files",
        { ...ARRIVAL, media: [stored(KEY_ONE), stored("asks/other.jpg")] },
        FILES,
      ],
      [
        "a stored voice note, which is never uploaded",
        { ...ARRIVAL, media: [{ kind: "audio", storageKey: KEY_ONE }] },
        FILES,
      ],
    ];

    it.each(cases)("%s", async (_name, message, files) => {
      const { adapter, requests } = setup();
      const failure = adapter.send(message, files);
      await expect(failure).rejects.toBeInstanceOf(ChannelSendError);
      await expect(failure).rejects.toMatchObject({ code: "invalid_request", retryable: false });
      expect(requests).toHaveLength(0);
    });
  });

  it("maps a refused upload as it maps any refused call", async () => {
    const { adapter } = setup(() => telegramErrorFixture("error-429-retry-after.json"));

    const failure = adapter.send({ ...ARRIVAL, media: [stored(KEY_ONE)] }, FILES);

    await expect(failure).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfterSeconds: 17,
    });
  });
});

describe("the client's upload calls", () => {
  function clientWith(responder: Responder) {
    const recording = createRecordingFetch(responder);
    return {
      client: createTelegramClient({ botToken: TEST_BOT_TOKEN, fetch: recording.fetch }),
      requests: recording.requests,
    };
  }

  it("reads the result of an upload as the JSON call's", async () => {
    const { client } = clientWith(() => telegramOk({ message_id: 42, date: 1789258325 }));

    await expect(
      client.sendPhotoUpload({
        chat_id: -1002214567890,
        photo: { body: new ArrayBuffer(3), mime: "image/jpeg", name: "photo.jpg" },
      }),
    ).resolves.toStrictEqual({ message_id: 42 });
  });

  it("treats an album upload answered without a list as an unknown outcome, not retried", async () => {
    const { client } = clientWith(() => telegramOk({ message_id: 42 }));

    const failure = client.sendMediaGroupUpload({
      chat_id: 6023817745,
      media: [
        { type: "photo", media: "attach://p0" },
        { type: "photo", media: PHOTO_A },
      ],
      files: { p0: { body: new ArrayBuffer(3), mime: "image/jpeg", name: "photo.jpg" } },
    });

    await expect(failure).rejects.toMatchObject({ code: "unknown", retryable: false });
  });

  it("maps an upload's network failure to unavailable without the token", async () => {
    const { client } = clientWith(() => {
      throw new TypeError(`fetch failed: https://api.telegram.org/bot${TEST_BOT_TOKEN}/sendPhoto`);
    });

    const error = await client
      .sendPhotoUpload({
        chat_id: 6023817745,
        photo: { body: new ArrayBuffer(3), mime: "image/jpeg", name: "photo.jpg" },
      })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(ChannelSendError);
    expect(error).toMatchObject({ code: "unavailable", retryable: true });
    expect(String((error as Error).message)).not.toContain(TEST_BOT_TOKEN);
  });
});
