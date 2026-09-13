import type { InboundEvent } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { parseTelegramUpdate } from "./parse.ts";
import { readFixture, TEST_BOT_USERNAME } from "./testing.ts";

const RECEIVED_AT = new Date("2026-09-13T00:11:02.345Z");

const MEIHUA = {
  externalUserId: "6023817745",
  displayName: "Mei-hua Lin",
  languageCode: "zh-hant",
};
const ANNA = { externalUserId: "5829174630", displayName: "Anna Chen", languageCode: "en" };
const SAM = { externalUserId: "1938475620", displayName: "Sam", languageCode: "en" };
const MEIHUA_CHAT = { externalId: "6023817745", kind: "private" } as const;
const FAMILY_GROUP = { externalId: "-1002214567890", kind: "group", title: "Chen family" } as const;
const NEW_GROUP = { externalId: "-4567812390", kind: "group", title: "Chen family" } as const;

function parseFixture(name: string): InboundEvent[] {
  return parseTelegramUpdate(readFixture(name), RECEIVED_AT, TEST_BOT_USERNAME);
}

function parseObject(update: unknown): InboundEvent[] {
  return parseTelegramUpdate(JSON.stringify(update), RECEIVED_AT, TEST_BOT_USERNAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("parseTelegramUpdate with recorded updates", () => {
  const cases: [fixture: string, expected: InboundEvent[]][] = [
    [
      "private-text.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920411",
          at: "2026-09-13T00:12:05.000Z",
          kind: "text",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "318",
          text: "今天去市場買了空心菜",
        },
      ],
    ],
    [
      "private-start-with-param.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920402",
          at: "2026-09-12T10:58:00.000Z",
          kind: "start",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "301",
          startParam: "inv_7Qm2xK9pLw3nR8sT",
        },
      ],
    ],
    [
      "group-start-with-mention.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920391",
          at: "2026-09-10T11:00:01.000Z",
          kind: "start",
          sender: ANNA,
          conversation: NEW_GROUP,
          messageId: "3",
          startParam: "grp_Hk3vQ9",
        },
      ],
    ],
    [
      "private-voice.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920412",
          at: "2026-09-13T00:14:40.000Z",
          kind: "voice",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "319",
          media: {
            kind: "audio",
            providerFileId:
              "AwACAgUAAxkBAAIBP2bj8x1kQz0vT6yWm3Hn2pLr5sUAAl8TAAKj3yBXkQ7ZsYw1d8o2BA",
            mime: "audio/ogg",
            durationMs: 23_000,
            bytes: 61_234,
          },
        },
      ],
    ],
    [
      "private-audio.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920418",
          at: "2026-09-13T00:21:09.000Z",
          kind: "voice",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "321",
          media: {
            kind: "audio",
            providerFileId:
              "CQACAgUAAxkBAAIBRWbj9t5Lr8KcJm0Q2xVnY4pZ3wEAAm0TAAKj3yBXw5sU8Qm1ZrI2BA",
            mime: "audio/mp4",
            durationMs: 41_000,
            bytes: 327_645,
          },
        },
      ],
    ],
    [
      "private-photo.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920413",
          at: "2026-09-13T00:15:02.000Z",
          kind: "image",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "320",
          text: "番茄紅了",
          media: {
            kind: "image",
            providerFileId: "AgACAgUAAxkBAAIBQGbj9A2xYAAKhwjEb0xAhV3M-rQABAQADAgADeQADNgQ",
            bytes: 142_887,
          },
        },
      ],
    ],
    [
      "private-sticker.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920422",
          at: "2026-09-13T02:40:00.000Z",
          kind: "sticker",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "322",
          text: "😊",
        },
      ],
    ],
    [
      "group-reply-to-bot.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920416",
          at: "2026-09-13T01:00:00.000Z",
          kind: "text",
          sender: SAM,
          conversation: FAMILY_GROUP,
          messageId: "1216",
          replyToMessageId: "1215",
          text: "Water spinach with garlic, my favourite! 😋",
        },
      ],
    ],
    [
      "callback-query.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920410",
          at: "2026-09-13T00:11:02.345Z",
          kind: "button",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "317",
          buttonData: "x:3f9a:c:1",
          callbackId: "2587416093847561234",
        },
      ],
    ],
    [
      "message-reaction.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920421",
          at: "2026-09-13T03:10:44.000Z",
          kind: "reaction",
          sender: SAM,
          conversation: FAMILY_GROUP,
          messageId: "1215",
          reactions: ["❤"],
        },
      ],
    ],
    [
      "my-chat-member-private-blocked.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920425",
          at: "2026-09-13T04:02:13.000Z",
          kind: "blocked",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
        },
      ],
    ],
    [
      "my-chat-member-private-unblocked.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920426",
          at: "2026-09-13T05:00:00.000Z",
          kind: "unblocked",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
        },
      ],
    ],
    [
      "my-chat-member-group-added.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920390",
          at: "2026-09-10T11:00:00.000Z",
          kind: "bot_added",
          sender: ANNA,
          conversation: NEW_GROUP,
        },
      ],
    ],
    [
      "my-chat-member-group-removed.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920431",
          at: "2026-09-13T05:00:00.000Z",
          kind: "bot_removed",
          sender: ANNA,
          conversation: FAMILY_GROUP,
        },
      ],
    ],
    [
      "my-chat-member-group-added-as-administrator.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920438",
          at: "2026-09-13T12:00:00.000Z",
          kind: "bot_added",
          sender: ANNA,
          conversation: FAMILY_GROUP,
        },
      ],
    ],
    [
      "my-chat-member-group-kicked.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920439",
          at: "2026-09-13T13:00:00.000Z",
          kind: "bot_removed",
          sender: ANNA,
          conversation: FAMILY_GROUP,
        },
      ],
    ],
    [
      "my-chat-member-group-restricted-removed.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920440",
          at: "2026-09-13T14:00:00.000Z",
          kind: "bot_removed",
          sender: ANNA,
          conversation: FAMILY_GROUP,
        },
      ],
    ],
    [
      "group-migrate-to-supergroup.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920392",
          at: "2026-09-10T11:01:00.000Z",
          kind: "migrated",
          sender: ANNA,
          conversation: NEW_GROUP,
          migratedToConversationId: FAMILY_GROUP.externalId,
        },
      ],
    ],
    [
      // The supergroup's copy of the same move, posted by the anonymous-group placeholder.
      "group-migrate-from-group.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920393",
          at: "2026-09-10T11:01:00.000Z",
          kind: "migrated",
          sender: { externalUserId: "1087968824", displayName: "Group" },
          conversation: NEW_GROUP,
          migratedToConversationId: FAMILY_GROUP.externalId,
        },
      ],
    ],
    [
      "group-ask-with-mention.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920432",
          at: "2026-09-13T11:00:00.000Z",
          kind: "text",
          sender: ANNA,
          conversation: FAMILY_GROUP,
          messageId: "1220",
          text: "/ask@VelaLightBot What did you have for breakfast?",
        },
      ],
    ],
    [
      "private-video.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920435",
          at: "2026-09-13T02:30:00.000Z",
          kind: "other",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "323",
          text: "孫子第一次騎腳踏車",
        },
      ],
    ],
    [
      "private-document.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920436",
          at: "2026-09-13T02:45:00.000Z",
          kind: "other",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "324",
          text: "醫生說都正常",
        },
      ],
    ],
    [
      "private-location.json",
      [
        {
          channel: "telegram",
          eventId: "tg:873920437",
          at: "2026-09-13T03:00:00.000Z",
          kind: "other",
          sender: MEIHUA,
          conversation: MEIHUA_CHAT,
          messageId: "325",
        },
      ],
    ],
    ["group-ask-other-bot.json", []],
    ["group-start-other-bot.json", []],
    ["my-chat-member-group-promoted.json", []],
    ["my-chat-member-group-restricted-outside.json", []],
    ["group-new-chat-members.json", []],
    ["edited-message.json", []],
    ["channel-post.json", []],
  ];

  it.each(cases)("%s parses to the expected events", (fixture, expected) => {
    expect(parseFixture(fixture)).toStrictEqual(expected);
  });

  it("parses each update of a two-photo album into an image sharing the media group id", () => {
    const updates: unknown = JSON.parse(readFixture("group-photo-album.json"));
    expect(Array.isArray(updates)).toBe(true);
    const events = (Array.isArray(updates) ? updates : []).flatMap(parseObject);

    const shared = {
      channel: "telegram",
      at: "2026-09-12T11:05:51.000Z",
      kind: "image",
      sender: ANNA,
      conversation: FAMILY_GROUP,
      replyToMessageId: "1198",
      mediaGroupId: "13816540938104752",
    } as const;
    expect(events).toStrictEqual([
      {
        ...shared,
        eventId: "tg:873920405",
        messageId: "1201",
        text: "Which one should we plant next spring?",
        media: {
          kind: "image",
          providerFileId: "AgACAgUAAxkBAAIEsWbjS7pNAAKhwjEb0xAhV3M-rQABAQADAgADeQADNgQ",
          bytes: 142_887,
        },
      },
      {
        ...shared,
        eventId: "tg:873920406",
        messageId: "1202",
        media: {
          kind: "image",
          providerFileId: "AgACAgUAAxkBAAIEsmbjS7pOAAKhwjEb0xAhV3M-rQABAQADAgADeQADNgQ",
          bytes: 142_887,
        },
      },
    ]);
  });
});

describe("parseTelegramUpdate edge cases", () => {
  const privateMessage = (fields: Record<string, unknown>): unknown => ({
    update_id: 1,
    message: {
      message_id: 9,
      from: { id: 6023817745, is_bot: false, first_name: "Mei-hua" },
      chat: { id: 6023817745, first_name: "Mei-hua", type: "private" },
      date: 1789258325,
      ...fields,
    },
  });

  it("throws on malformed JSON", () => {
    expect(() => parseTelegramUpdate("{not json", RECEIVED_AT, TEST_BOT_USERNAME)).toThrow(
      SyntaxError,
    );
  });

  it("throws on a JSON body that is not an update", () => {
    expect(() =>
      parseTelegramUpdate(JSON.stringify({ message: {} }), RECEIVED_AT, TEST_BOT_USERNAME),
    ).toThrow(/update_id/);
  });

  it("yields nothing for update types it does not know", () => {
    expect(parseObject({ update_id: 2, poll_answer: { poll_id: "1", option_ids: [0] } })).toEqual(
      [],
    );
  });

  it("reads a bare /start as a start without a parameter", () => {
    const [event] = parseObject(privateMessage({ text: "/start" }));
    expect(event?.kind).toBe("start");
    expect(event).not.toHaveProperty("startParam");
    expect(event).not.toHaveProperty("text");
  });

  it("treats words that merely begin with /start as text", () => {
    expect(parseObject(privateMessage({ text: "/starting over" }))[0]?.kind).toBe("text");
  });

  it("picks the largest photo size regardless of order", () => {
    const [event] = parseObject(
      privateMessage({
        photo: [
          { file_id: "big", file_unique_id: "b", width: 1280, height: 960 },
          { file_id: "small", file_unique_id: "s", width: 90, height: 68 },
        ],
      }),
    );
    expect(event?.media).toStrictEqual({ kind: "image", providerFileId: "big" });
  });

  it("ignores messages posted on behalf of a chat, which carry a placeholder bot sender", () => {
    const update = {
      update_id: 3,
      message: {
        message_id: 10,
        from: { id: 1087968824, is_bot: true, first_name: "Group", username: "GroupAnonymousBot" },
        sender_chat: { id: -1002214567890, title: "Chen family", type: "supergroup" },
        chat: { id: -1002214567890, title: "Chen family", type: "supergroup" },
        date: 1789258325,
        text: "ask: what did you cook today?",
      },
    };
    expect(parseObject(update)).toEqual([]);
  });

  it("ignores a linked channel's post auto-forwarded into the group, whose stand-in is no bot", () => {
    const post = {
      message_id: 1240,
      from: { id: 777000, is_bot: false, first_name: "Telegram" },
      chat: { id: -1002214567890, title: "Chen family", type: "supergroup" },
      date: 1789300800,
      text: "/ask What did you cook this weekend?",
    };
    const channel = { id: -1001987654321, title: "Chen family news", type: "channel" };
    const withMarkers = (markers: Record<string, unknown>): InboundEvent[] =>
      parseObject({ update_id: 8, message: { ...post, ...markers } });

    expect(withMarkers({})).toHaveLength(1);
    expect(
      withMarkers({
        sender_chat: channel,
        forward_origin: { type: "channel", chat: channel, message_id: 42, date: 1789300799 },
        is_automatic_forward: true,
      }),
    ).toEqual([]);
    expect(withMarkers({ sender_chat: channel })).toEqual([]);
    expect(withMarkers({ is_automatic_forward: true })).toEqual([]);
  });

  const otherContent: [field: string, value: Record<string, unknown>][] = [
    ["video_note", { file_id: "DQAC-note", file_unique_id: "n", length: 384, duration: 9 }],
    [
      "venue",
      {
        location: { latitude: 25.04, longitude: 121.5 },
        title: "Dihua Market",
        address: "Dihua St",
      },
    ],
    ["contact", { phone_number: "+886912345678", first_name: "Li-ting" }],
    [
      "poll",
      { id: "5321", question: "Dinner?", options: [], total_voter_count: 0, is_closed: false },
    ],
    ["dice", { emoji: "🎲", value: 4 }],
    ["story", { chat: { id: 5829174630, type: "private" }, id: 12 }],
  ];

  it.each(otherContent)(
    "reads a message with %s as other, with no text or media",
    (field, value) => {
      const [event, ...rest] = parseObject(privateMessage({ [field]: value }));
      expect(rest).toEqual([]);
      expect(event?.kind).toBe("other");
      expect(event).not.toHaveProperty("text");
      expect(event).not.toHaveProperty("media");
    },
  );

  it("reads a GIF, which Telegram sends as both animation and document, as one other event", () => {
    const gif = { file_id: "CgAC-gif", file_unique_id: "g", mime_type: "video/mp4" };
    const events = parseObject(
      privateMessage({
        animation: { ...gif, width: 320, height: 240, duration: 3 },
        document: gif,
        caption: "哈哈",
      }),
    );
    expect(events.map((event) => [event.kind, event.text, event.media])).toStrictEqual([
      ["other", "哈哈", undefined],
    ]);
  });

  it("ignores service messages, even one that carries content inside it", () => {
    const pinnedVideo = {
      message_id: 323,
      chat: { id: 6023817745, type: "private" },
      date: 1789266600,
      video: { file_id: "BAAC-video", file_unique_id: "v", width: 720, height: 1280, duration: 18 },
    };
    expect(parseObject(privateMessage({ pinned_message: pinnedVideo }))).toEqual([]);
    expect(parseObject(privateMessage({ new_chat_title: "Chen family" }))).toEqual([]);
    expect(parseObject(privateMessage({ delete_chat_photo: true }))).toEqual([]);
  });

  it("ignores an edited location, which is how a live location moves", () => {
    const update = {
      update_id: 5,
      edited_message: {
        message_id: 325,
        from: { id: 6023817745, is_bot: false, first_name: "Mei-hua" },
        chat: { id: 6023817745, first_name: "Mei-hua", type: "private" },
        date: 1789268400,
        edit_date: 1789268460,
        location: { latitude: 25.034, longitude: 121.5645, live_period: 900 },
      },
    };
    expect(parseObject(update)).toEqual([]);
  });

  it("ignores anonymous reactions", () => {
    const update = {
      update_id: 4,
      message_reaction: {
        chat: { id: -1002214567890, title: "Chen family", type: "supergroup" },
        message_id: 1215,
        actor_chat: { id: -1002214567890, title: "Chen family", type: "supergroup" },
        date: 1789269044,
        old_reaction: [],
        new_reaction: [{ type: "emoji", emoji: "👍" }],
      },
    };
    expect(parseObject(update)).toEqual([]);
  });

  it("reports a removed reaction as an empty reaction list", () => {
    const fixture: unknown = JSON.parse(readFixture("message-reaction.json"));
    if (!isRecord(fixture) || !isRecord(fixture.message_reaction)) {
      throw new Error("the reaction fixture must hold a message_reaction");
    }
    const reaction = fixture.message_reaction;
    const update = {
      ...fixture,
      message_reaction: { ...reaction, old_reaction: reaction.new_reaction, new_reaction: [] },
    };
    expect(parseObject(update)[0]?.reactions).toStrictEqual([]);
  });
});

describe("parseTelegramUpdate with commands addressed to a bot", () => {
  const groupMessage = (fields: Record<string, unknown>): unknown => ({
    update_id: 6,
    message: {
      message_id: 1230,
      from: { id: 1938475620, is_bot: false, first_name: "Sam", language_code: "en" },
      chat: { id: -1002214567890, title: "Chen family", type: "supergroup" },
      date: 1789297200,
      ...fields,
    },
  });
  const kindsOf = (text: string): [string, string | undefined, string | undefined][] =>
    parseObject(groupMessage({ text })).map((event) => [event.kind, event.text, event.startParam]);

  it("parses a command addressed to no bot", () => {
    expect(kindsOf("/ask What did you cook today?")).toStrictEqual([
      ["text", "/ask What did you cook today?", undefined],
    ]);
    expect(kindsOf("/start grp_Hk3vQ9")).toStrictEqual([["start", undefined, "grp_Hk3vQ9"]]);
  });

  it("matches this bot's username in any letter case", () => {
    expect(kindsOf("/ask@velalightbot What did you cook today?")).toStrictEqual([
      ["text", "/ask@velalightbot What did you cook today?", undefined],
    ]);
    expect(kindsOf("/start@VELALIGHTBOT grp_Hk3vQ9")).toStrictEqual([
      ["start", undefined, "grp_Hk3vQ9"],
    ]);
  });

  it("yields nothing for a command addressed to another bot", () => {
    expect(kindsOf("/start@RecipeHelperBot grp_Hk3vQ9")).toStrictEqual([]);
    expect(kindsOf("/later@RecipeHelperBot")).toStrictEqual([]);
  });

  it("does not take a username that merely begins with this bot's name as this bot", () => {
    expect(kindsOf("/ask@VelaLightBot2 What did you cook today?")).toStrictEqual([]);
  });

  it("yields nothing for a command to another bot in a private chat", () => {
    const update = {
      update_id: 7,
      message: {
        message_id: 326,
        from: { id: 6023817745, is_bot: false, first_name: "Mei-hua" },
        chat: { id: 6023817745, first_name: "Mei-hua", type: "private" },
        date: 1789297200,
        text: "/start@RecipeHelperBot inv_7Qm2xK9pLw3nR8sT",
      },
    };
    expect(parseObject(update)).toEqual([]);
  });

  it("yields nothing for media whose caption is a command to another bot", () => {
    const photo = [{ file_id: "AgAC-photo", file_unique_id: "p", width: 1280, height: 960 }];
    expect(
      parseObject(groupMessage({ photo, caption: "/ask@RecipeHelperBot what is this?" })),
    ).toEqual([]);
    expect(
      parseObject(groupMessage({ photo, caption: "/ask@VelaLightBot what is this?" })),
    ).toHaveLength(1);
  });

  it("treats a mention of another bot's command later in the text as ordinary text", () => {
    expect(kindsOf("Try /ask@RecipeHelperBot for recipes")).toStrictEqual([
      ["text", "Try /ask@RecipeHelperBot for recipes", undefined],
    ]);
  });
});
