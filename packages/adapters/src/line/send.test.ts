import { ChannelSendError, type OutboundMessage } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { createLineAdapter } from "./adapter.ts";
import { lineRetryKey } from "./retry-key.ts";
import { fitLabel } from "./send.ts";
import {
  bodyOf,
  createRecordingFetch,
  lineApiFixture,
  type RecordedRequest,
  type Responder,
  routeOf,
  sequentialIds,
  sequentialSends,
  TEST_CHANNEL_ACCESS_TOKEN,
  TEST_CHANNEL_SECRET,
} from "./testing.ts";

const MEIHUA = "U3bf020427417f5c0decf3c1612d4e59a";
const ANNA = "Ua848d9bbd60485659b74a9478b390c6f";
const GROUP_ID = "Ce5f4dcc362130dc312c78866466c6fff";
const ROOM_ID = "Rca6e8caf2a1ec2403b3dd52ecccd098a";
const KEY = "arrival:0f4c2b9e-7d1a-4e3b-9c8f-5a6b7c8d9e0f:2026-09-27";
const REPLY_TOKEN = "6052c5ed74a0a122b25391cb74942eb6";
const FIRST_ID = 533817094156927010n;
const PUSH = "POST /v2/bot/message/push";
const REPLY = "POST /v2/bot/message/reply";

const PHOTO_URL = "https://vela-light.example.workers.dev/media/ZmFtaWxpZXMvYS5qcGc/c2ln.jpg";
const VOICE_URL = "https://vela-light.example.workers.dev/media/ZmFtaWxpZXMvYi5tNGE/c2ln.m4a";
const PHOTO = { kind: "image", url: PHOTO_URL, mime: "image/jpeg", bytes: 480_000 } as const;
const VOICE = {
  kind: "audio",
  url: VOICE_URL,
  mime: "audio/x-m4a",
  durationMs: 23_000,
  bytes: 190_000,
} as const;

const ARRIVAL: OutboundMessage = {
  kind: "arrival",
  idempotencyKey: KEY,
  lang: "zh-TW",
  to: { channel: "line", conversationId: MEIHUA },
  text: "Anna asks:\nWhat did you have for breakfast? <b>not markup</b>",
  buttons: [
    [
      { id: "x:3f9a:h", label: "❤️" },
      { id: "x:3f9a:f", label: "I’m fine" },
    ],
    [
      { id: "x:3f9a:c:1", label: "Congee" },
      { id: "x:3f9a:c:2", label: "Toast" },
    ],
  ],
};

function setup(responder: Responder = sequentialSends(FIRST_ID)) {
  const recording = createRecordingFetch(responder);
  const adapter = createLineAdapter({
    channelSecret: TEST_CHANNEL_SECRET,
    channelAccessToken: TEST_CHANNEL_ACCESS_TOKEN,
    fetch: recording.fetch,
  });
  return { adapter, requests: recording.requests };
}

function postback(id: string, label: string, displayText: string = label) {
  return { type: "postback", label, data: id, displayText };
}

function quickReplyItem(id: string, label: string, displayText?: string) {
  return { type: "action", action: postback(id, label, displayText) };
}

function flexButton(id: string, label: string, displayText?: string) {
  return {
    type: "button",
    style: "secondary",
    height: "sm",
    action: postback(id, label, displayText),
  };
}

function bubble(altText: string, buttons: readonly unknown[]) {
  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", spacing: "sm", contents: buttons },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** Every message object sent, request by request. */
function objectsOf(requests: readonly RecordedRequest[]): unknown[][] {
  return requests.map((request) => {
    const messages = field(bodyOf(request), "messages");
    return Array.isArray(messages) ? messages : [];
  });
}

describe("adapter.send", () => {
  it("pushes a private arrival as one text whose quick replies are its buttons, under the message's retry key", async () => {
    const { adapter, requests } = setup();

    const result = await adapter.send(ARRIVAL);

    expect(requests.map(routeOf)).toStrictEqual([PUSH]);
    expect(bodyOf(requests[0])).toStrictEqual({
      to: MEIHUA,
      messages: [
        {
          type: "text",
          text: ARRIVAL.text,
          quickReply: {
            items: [
              quickReplyItem("x:3f9a:h", "❤️"),
              quickReplyItem("x:3f9a:f", "I’m fine"),
              quickReplyItem("x:3f9a:c:1", "Congee"),
              quickReplyItem("x:3f9a:c:2", "Toast"),
            ],
          },
        },
      ],
    });
    expect(requests[0]?.headers.get("x-line-retry-key")).toBe(await lineRetryKey(KEY, 0));
    expect(result).toStrictEqual({
      externalMessageIds: ["533817094156927010"],
      primaryMessageId: "533817094156927010",
    });
  });

  it("sends text alone as a plain text object", async () => {
    const { adapter, requests } = setup();

    await adapter.send({ ...ARRIVAL, kind: "ack", buttons: undefined, text: "Thank you, Meihua." });

    expect(objectsOf(requests)).toStrictEqual([[{ type: "text", text: "Thank you, Meihua." }]]);
  });

  it("fits a quick reply's label to 20 graphemes and a Flex button's to 40, keeping the whole label as what the tap posts", async () => {
    const family = "Braised pork 👨‍👩‍👧‍👦 with Grandma’s rice and greens";
    const long = "早".repeat(64);
    const { adapter, requests } = setup();

    await adapter.send({ ...ARRIVAL, buttons: [[{ id: "x:3f9a:c:1", label: family }]] });
    await adapter.send({
      ...ARRIVAL,
      kind: "consent",
      buttons: [[{ id: "consent:yes", label: long }]],
    });

    const sent = objectsOf(requests);
    const arrival = sent[0]?.[0];
    const consent = sent[1]?.[1];
    expect(arrival).toMatchObject({
      quickReply: {
        items: [quickReplyItem("x:3f9a:c:1", "Braised pork 👨‍👩‍👧‍👦 with…", family)],
      },
    });
    expect(consent).toMatchObject(
      bubble(long, [flexButton("consent:yes", `${"早".repeat(39)}…`, long)]),
    );
  });

  it("keeps a consent's buttons in a Flex bubble after the text, and names the text as the primary message", async () => {
    const { adapter, requests } = setup();

    const result = await adapter.send({
      ...ARRIVAL,
      kind: "consent",
      text: "Anna would like to keep a light for you. Is that all right?",
      buttons: [
        [
          { id: "consent:3f9a:yes", label: "Yes" },
          { id: "consent:3f9a:no", label: "No, thank you" },
        ],
      ],
    });

    expect(objectsOf(requests)).toStrictEqual([
      [
        { type: "text", text: "Anna would like to keep a light for you. Is that all right?" },
        bubble("Yes · No, thank you", [
          flexButton("consent:3f9a:yes", "Yes"),
          flexButton("consent:3f9a:no", "No, thank you"),
        ]),
      ],
    ]);
    expect(result).toStrictEqual({
      externalMessageIds: sequentialIds(FIRST_ID, 2),
      primaryMessageId: "533817094156927010",
    });
  });

  it("keeps a quiet notice's buttons, and any buttons sent to a group or a room, in a Flex bubble", async () => {
    const buttons = [[{ id: "q:77:fine", label: "She’s fine, I know why" }]];
    const { adapter, requests } = setup();

    await adapter.send({
      ...ARRIVAL,
      kind: "quiet_notice",
      to: { channel: "line", conversationId: ANNA },
      buttons,
    });
    await adapter.send({
      ...ARRIVAL,
      kind: "system",
      to: { channel: "line", conversationId: GROUP_ID },
      buttons,
    });
    await adapter.send({
      ...ARRIVAL,
      kind: "arrival",
      to: { channel: "line", conversationId: ROOM_ID },
      buttons,
    });

    const expected = [
      { type: "text", text: ARRIVAL.text },
      bubble("She’s fine, I know why", [flexButton("q:77:fine", "She’s fine, I know why")]),
    ];
    expect(objectsOf(requests)).toStrictEqual([expected, expected, expected]);
    expect(requests.map((request) => field(bodyOf(request), "to"))).toStrictEqual([
      ANNA,
      GROUP_ID,
      ROOM_ID,
    ]);
  });

  it("uses quick replies up to LINE's 13 and a Flex bubble for more", async () => {
    const buttonsOf = (count: number) =>
      Array.from({ length: Math.ceil(count / 4) }, (_, row) =>
        Array.from({ length: Math.min(4, count - row * 4) }, (_, column) => ({
          id: `onboarding:tz:${row * 4 + column}`,
          label: `Zone ${row * 4 + column}`,
        })),
      );
    const { adapter, requests } = setup();

    await adapter.send({ ...ARRIVAL, kind: "onboarding", buttons: buttonsOf(13) });
    await adapter.send({ ...ARRIVAL, kind: "onboarding", buttons: buttonsOf(14) });

    const sent = objectsOf(requests);
    const [thirteen, fourteen, flex] = [sent[0]?.[0], sent[1]?.[0], sent[1]?.[1]];
    expect(field(field(thirteen, "quickReply"), "items")).toHaveLength(13);
    expect(fourteen).toStrictEqual({ type: "text", text: ARRIVAL.text });
    expect(field(flex, "type")).toBe("flex");
    expect(field(field(field(flex, "contents"), "body"), "contents")).toHaveLength(14);
  });

  it("sends media before the text, in order, with a small image as its own preview and audio with its duration", async () => {
    const { adapter, requests } = setup();

    const result = await adapter.send({
      ...ARRIVAL,
      kind: "answer_post",
      to: { channel: "line", conversationId: GROUP_ID },
      buttons: undefined,
      replyToMessageId: "502621186619914619",
      media: [
        VOICE,
        { ...PHOTO, url: "https://vela-light.example.workers.dev/media/美華 早餐.jpg" },
        { ...PHOTO, mime: "image/png; charset=binary", bytes: 1_000_000 },
      ],
    });

    expect(objectsOf(requests)).toStrictEqual([
      [
        { type: "audio", originalContentUrl: VOICE_URL, duration: 23_000 },
        {
          type: "image",
          originalContentUrl:
            "https://vela-light.example.workers.dev/media/%E7%BE%8E%E8%8F%AF%20%E6%97%A9%E9%A4%90.jpg",
          previewImageUrl:
            "https://vela-light.example.workers.dev/media/%E7%BE%8E%E8%8F%AF%20%E6%97%A9%E9%A4%90.jpg",
        },
        { type: "image", originalContentUrl: PHOTO_URL, previewImageUrl: PHOTO_URL },
        // LINE quotes by quote token, which Vela does not keep, so the quote is not sent.
        { type: "text", text: ARRIVAL.text },
      ],
    ]);
    expect(result).toStrictEqual({
      externalMessageIds: sequentialIds(FIRST_ID, 4),
      primaryMessageId: "533817094156927013",
    });
  });

  it("puts quick replies only on the last object, even when media fills a request before the text", async () => {
    const { adapter, requests } = setup();

    await adapter.send({ ...ARRIVAL, media: [VOICE, PHOTO] });
    await adapter.send({ ...ARRIVAL, media: [PHOTO, PHOTO, PHOTO, PHOTO, PHOTO] });

    const sent = objectsOf(requests);
    expect(sent.map((objects) => objects.length)).toStrictEqual([3, 5, 1]);
    const withQuickReplies = sent
      .flat()
      .flatMap((object, index) => (field(object, "quickReply") === undefined ? [] : [index]));
    expect(withQuickReplies).toStrictEqual([2, 8]);
  });

  it("cuts more than five objects into requests of five, in order, each under a retry key of its own", async () => {
    const { adapter, requests } = setup();

    const result = await adapter.send({
      ...ARRIVAL,
      kind: "answer_post",
      to: { channel: "line", conversationId: GROUP_ID },
      media: Array.from({ length: 10 }, () => PHOTO),
      buttons: [[{ id: "r:9d1c:heart", label: "❤️" }]],
    });

    const sent = objectsOf(requests);
    expect(requests.map(routeOf)).toStrictEqual([PUSH, PUSH, PUSH]);
    expect(sent.map((objects) => objects.map((object) => field(object, "type")))).toStrictEqual([
      ["image", "image", "image", "image", "image"],
      ["image", "image", "image", "image", "image"],
      ["text", "flex"],
    ]);
    expect(requests.map((request) => request.headers.get("x-line-retry-key"))).toStrictEqual(
      await Promise.all([0, 1, 2].map((index) => lineRetryKey(KEY, index))),
    );
    expect(result.externalMessageIds).toStrictEqual(sequentialIds(FIRST_ID, 12));
    expect(result.primaryMessageId).toBe(sequentialIds(FIRST_ID, 12)[10]);
  });

  it("sends one message twice byte for byte the same, retry key included, as LINE requires of a retry", async () => {
    const message: OutboundMessage = {
      ...ARRIVAL,
      kind: "answer_post",
      to: { channel: "line", conversationId: GROUP_ID },
      media: [VOICE, PHOTO, PHOTO, PHOTO, PHOTO, PHOTO],
    };
    const { adapter, requests } = setup();

    await adapter.send(message);
    await adapter.send(message);

    const [first, second] = [requests.slice(0, 2), requests.slice(2)];
    expect(second.map((request) => request.body)).toStrictEqual(
      first.map((request) => request.body),
    );
    expect(second.map((request) => request.headers.get("x-line-retry-key"))).toStrictEqual(
      first.map((request) => request.headers.get("x-line-retry-key")),
    );
  });

  it("reads a 409 for an already accepted key as the success it was", async () => {
    const { adapter } = setup(() => lineApiFixture("api-push-409.json"));

    await expect(adapter.send({ ...ARRIVAL, buttons: undefined })).resolves.toStrictEqual({
      externalMessageIds: ["533817094156927010"],
      primaryMessageId: "533817094156927010",
    });
  });

  it("stops at the first failed request, and a retry finishes the message, the first request answered 409", async () => {
    const message: OutboundMessage = { ...ARRIVAL, media: [PHOTO, PHOTO, PHOTO, PHOTO, PHOTO] };
    const first = setup((request) =>
      objectsOf([request])[0]?.length === 5
        ? Response.json({ sentMessages: sequentialIds(FIRST_ID, 5).map((id) => ({ id })) })
        : lineApiFixture("api-error-500.json"),
    );

    await expect(first.adapter.send(message)).rejects.toMatchObject({
      code: "unavailable",
      retryable: true,
    });
    expect(first.requests).toHaveLength(2);

    const acceptedKey = first.requests[0]?.headers.get("x-line-retry-key");
    const retry = setup((request) =>
      request.headers.get("x-line-retry-key") === acceptedKey
        ? Response.json(
            {
              message: "The retry key is already accepted",
              sentMessages: sequentialIds(FIRST_ID, 5).map((id) => ({ id })),
            },
            { status: 409 },
          )
        : Response.json({ sentMessages: [{ id: "533817094156927015" }] }),
    );

    await expect(retry.adapter.send(message)).resolves.toStrictEqual({
      externalMessageIds: sequentialIds(FIRST_ID, 6),
      primaryMessageId: "533817094156927015",
    });
    expect(retry.requests.map((request) => request.body)).toStrictEqual(
      first.requests.map((request) => request.body),
    );
  });

  describe("with a reply token", () => {
    it("replies, free and without a retry key, when the message fits one request", async () => {
      const { adapter, requests } = setup();

      const result = await adapter.send({ ...ARRIVAL, kind: "ack", replyToken: REPLY_TOKEN });

      expect(requests.map(routeOf)).toStrictEqual([REPLY]);
      expect(requests[0]?.headers.has("x-line-retry-key")).toBe(false);
      expect(bodyOf(requests[0])).toMatchObject({ replyToken: REPLY_TOKEN });
      expect(bodyOf(requests[0])).not.toHaveProperty("to");
      expect(result.primaryMessageId).toBe("533817094156927010");
    });

    it("pushes at once, under the retry key, when LINE refuses the token", async () => {
      const refusing = sequentialSends(FIRST_ID);
      const { adapter, requests } = setup((request) =>
        routeOf(request) === REPLY
          ? lineApiFixture("api-reply-400-invalid-token.json")
          : refusing(request),
      );

      const result = await adapter.send({ ...ARRIVAL, kind: "ack", replyToken: REPLY_TOKEN });

      expect(requests.map(routeOf)).toStrictEqual([REPLY, PUSH]);
      expect(requests[1]?.headers.get("x-line-retry-key")).toBe(await lineRetryKey(KEY, 0));
      const [replied, pushed] = objectsOf(requests);
      expect(pushed).toStrictEqual(replied);
      expect(result.primaryMessageId).toBe("533817094156927010");
    });

    it("throws unavailable without pushing when the reply fails or times out, leaving the retry to the gateway", async () => {
      for (const responder of [
        () => lineApiFixture("api-error-500.json"),
        () => {
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        },
      ]) {
        const { adapter, requests } = setup(responder);
        await expect(adapter.send({ ...ARRIVAL, replyToken: REPLY_TOKEN })).rejects.toMatchObject({
          code: "unavailable",
          retryable: true,
        });
        expect(requests.map(routeOf)).toStrictEqual([REPLY]);
      }
    });

    it("does not push after a reply LINE accepted without readable ids, since it went out", async () => {
      const { adapter, requests } = setup(() => Response.json({ sentMessages: [] }));

      await expect(adapter.send({ ...ARRIVAL, replyToken: REPLY_TOKEN })).rejects.toMatchObject({
        code: "unknown",
        retryable: false,
      });
      expect(requests.map(routeOf)).toStrictEqual([REPLY]);
    });

    it("pushes a message of more than one request, since one token answers only one", async () => {
      const { adapter, requests } = setup();

      await adapter.send({
        ...ARRIVAL,
        replyToken: REPLY_TOKEN,
        media: [PHOTO, PHOTO, PHOTO, PHOTO, PHOTO],
      });

      expect(requests.map(routeOf)).toStrictEqual([PUSH, PUSH]);
    });
  });

  it("cuts a Flex bubble's alt text to 1,500 UTF-16 units without splitting an emoji", async () => {
    const buttons = Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 4 }, (_, column) => ({
        id: `vote:${row}:${column}`,
        label: "😀".repeat(32),
      })),
    );
    const { adapter, requests } = setup();

    await adapter.send({ ...ARRIVAL, to: { channel: "line", conversationId: GROUP_ID }, buttons });

    const flex = objectsOf(requests)[0]?.[1];
    const altText = String(field(flex, "altText"));
    expect(altText.length).toBeLessThanOrEqual(1_500);
    expect(altText.length).toBeGreaterThan(1_490);
    expect(altText.isWellFormed()).toBe(true);
    expect(altText.endsWith("😀…")).toBe(true);
  });

  it("keeps the largest bubble the contract allows within LINE's 30 KB", async () => {
    const buttons = Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 4 }, (_, column) => ({
        id: `${row}${column}${"早".repeat(62)}`,
        label: "早".repeat(64),
      })),
    );
    const { adapter, requests } = setup();

    await adapter.send({ ...ARRIVAL, kind: "consent", buttons, text: "早".repeat(4_000) });

    const flex = objectsOf(requests)[0]?.[1];
    const bytes = new TextEncoder().encode(JSON.stringify(field(flex, "contents")));
    expect(bytes.length).toBeGreaterThan(15_000);
    expect(bytes.length).toBeLessThan(30_000);
  });

  describe("refuses before calling LINE", () => {
    const withMedia = (media: OutboundMessage["media"]): OutboundMessage => ({ ...ARRIVAL, media });
    const invalid: [string, OutboundMessage][] = [
      [
        "a message for another channel",
        { ...ARRIVAL, to: { channel: "telegram", conversationId: "6023817745" } },
      ],
      [
        "a conversation id that is not LINE's",
        { ...ARRIVAL, to: { channel: "line", conversationId: "6023817745" } },
      ],
      [
        "a conversation id in capitals",
        { ...ARRIVAL, to: { channel: "line", conversationId: MEIHUA.toUpperCase() } },
      ],
      ["a message the contract rejects", { ...ARRIVAL, text: "" }],
      [
        "a file known only by its platform id",
        withMedia([
          { kind: "image", providerFileId: "508667044176309088", mime: "image/jpeg", bytes: 1 },
        ]),
      ],
      [
        "a URL that is not HTTPS",
        withMedia([{ ...PHOTO, url: "http://vela-light.example/a.jpg" }]),
      ],
      [
        "a URL over 2,000 characters",
        withMedia([{ ...PHOTO, url: `https://vela-light.example/${"a".repeat(2_000)}.jpg` }]),
      ],
      ["media without a MIME type", withMedia([{ kind: "image", url: PHOTO_URL, bytes: 1 }])],
      [
        "audio without its duration",
        withMedia([{ kind: "audio", url: VOICE_URL, mime: "audio/x-m4a" }]),
      ],
      ["audio LINE cannot play", withMedia([{ ...VOICE, mime: "audio/ogg" }])],
      ["audio over 200 MB", withMedia([{ ...VOICE, bytes: 200_000_001 }])],
      ["an image LINE cannot show", withMedia([{ ...PHOTO, mime: "image/webp" }])],
      ["an image over 10 MB", withMedia([{ ...PHOTO, bytes: 10_000_001 }])],
      ["an image over 1 MB, with no preview", withMedia([{ ...PHOTO, bytes: 1_000_001 }])],
      [
        "an image of unknown size",
        withMedia([{ kind: "image", url: PHOTO_URL, mime: "image/png" }]),
      ],
      [
        "a bad item after a good one",
        withMedia([PHOTO, PHOTO, PHOTO, PHOTO, PHOTO, { ...VOICE, mime: "audio/ogg" }]),
      ],
    ];

    it.each(invalid)("%s", async (_name, message) => {
      const { adapter, requests } = setup();
      const failure = adapter.send({ ...message, replyToken: REPLY_TOKEN });
      await expect(failure).rejects.toBeInstanceOf(ChannelSendError);
      await expect(failure).rejects.toMatchObject({ code: "invalid_request", retryable: false });
      expect(requests).toHaveLength(0);
    });
  });
});

describe("fitLabel", () => {
  it("leaves a label within the limit as it is", () => {
    expect(fitLabel("Congee", 20)).toBe("Congee");
    expect(fitLabel("a".repeat(20), 20)).toBe("a".repeat(20));
  });

  it("counts an emoji family as one grapheme, as LINE does", () => {
    expect(fitLabel("👨‍👩‍👧‍👦".repeat(20), 20)).toBe("👨‍👩‍👧‍👦".repeat(20));
    expect(fitLabel("👨‍👩‍👧‍👦".repeat(21), 20)).toBe(`${"👨‍👩‍👧‍👦".repeat(19)}…`);
  });

  it("ends a cut label in an ellipsis without a space before it", () => {
    expect(fitLabel("Wait two hours, please", 10)).toBe("Wait two…");
  });
});
