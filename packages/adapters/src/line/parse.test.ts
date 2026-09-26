import { readdirSync } from "node:fs";
import { InboundEvent } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { parseLineWebhook } from "./parse.ts";
import { readFixture } from "./testing.ts";

/** Every fixture happened in the ten minutes before this, so each reply token runs 50 s past it. */
const RECEIVED_AT = new Date("2026-09-26T23:10:30.000Z");
const UNTIL = "2026-09-26T23:11:20.000Z";

const MEIHUA = "U3bf020427417f5c0decf3c1612d4e59a";
const ANNA = "Ua848d9bbd60485659b74a9478b390c6f";
const SAM = "U8f8c4117e99b1a4fa8346f3d1c56731b";
const WEI = "Uc883b1237ee2a3bf59863ac7b4e2337a";
const GROUP_ID = "Ce5f4dcc362130dc312c78866466c6fff";
const ROOM_ID = "Rca6e8caf2a1ec2403b3dd52ecccd098a";
const INVITE_TOKEN = "ErEYahuipGG-rJJkYfgFTSC7mcJ-iQVLPaLcxkGhSFg";

const MEIHUA_CHAT = { externalId: MEIHUA, kind: "private" } as const;
const ANNA_CHAT = { externalId: ANNA, kind: "private" } as const;
const SAM_CHAT = { externalId: SAM, kind: "private" } as const;
const FAMILY_GROUP = { externalId: GROUP_ID, kind: "group" } as const;
const OLD_ROOM = { externalId: ROOM_ID, kind: "group" } as const;
/** The contract's unknown actor: the group's own id stands in for whoever LINE does not name. */
const NOBODY_IN_GROUP = { externalUserId: GROUP_ID };

function reply(token: string): { token: string; until: string } {
  return { token, until: UNTIL };
}

function parseFixture(name: string): InboundEvent[] {
  return parseLineWebhook(readFixture(name), RECEIVED_AT);
}

function parseEvents(events: readonly unknown[], receivedAt: Date = RECEIVED_AT): InboundEvent[] {
  return parseLineWebhook(
    JSON.stringify({ destination: "U2ba6561a468b4afe9fa1df6d946e23de", events }),
    receivedAt,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first event of a fixture, to vary one field of a shape LINE documents. */
function eventOf(name: string): Record<string, unknown> {
  const body: unknown = JSON.parse(readFixture(name));
  const event: unknown = isRecord(body) && Array.isArray(body.events) ? body.events[0] : undefined;
  if (!isRecord(event)) throw new Error(`${name} must hold an event`);
  return event;
}

/** A fixture's event with fields of its `message` replaced. */
function withMessage(name: string, fields: Record<string, unknown>): Record<string, unknown> {
  const event = eventOf(name);
  const message = isRecord(event.message) ? event.message : {};
  return { ...event, message: { ...message, ...fields } };
}

describe("parseLineWebhook with LINE-shaped fixtures", () => {
  const cases: [fixture: string, expected: InboundEvent[]][] = [
    [
      "webhook-private-start-organiser.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ5232YVGRDDM36HGDWQYD",
          at: "2026-09-26T23:00:08.930Z",
          kind: "start",
          sender: { externalUserId: ANNA },
          conversation: ANNA_CHAT,
          messageId: "520703524547983865",
          reply: reply("7cf61a9a81f5fd3d4fe9b8e7effb7880"),
        },
      ],
    ],
    [
      "webhook-follow.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ59RMJ4BNBCC2P0RK129D",
          at: "2026-09-26T23:00:16.788Z",
          kind: "followed",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          reply: reply("abb2777791c6bf91a81dc6ec715ecfd0"),
        },
      ],
    ],
    [
      "webhook-private-start-invite.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ5NQMP2DH2S8DSM0WR41F",
          at: "2026-09-26T23:00:29.044Z",
          kind: "start",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "561707744202016141",
          startParam: INVITE_TOKEN,
          reply: reply("77827c980761f4f31a3adab6bf817214"),
        },
      ],
    ],
    [
      // A keyboard's trailing line break does not turn her invite into a chat message.
      "webhook-private-start-trailing-newline.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ627Q4BNE9E2XK2RT4KVE",
          at: "2026-09-26T23:00:41.847Z",
          kind: "start",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "535994107146443946",
          startParam: INVITE_TOKEN,
          reply: reply("8fce1ba17741d22b7c949f6915049029"),
        },
      ],
    ],
    [
      // A damaged token is still a start, so the invite flow can say the link is not valid.
      "webhook-private-start-damaged.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ6D738C4JYGKSPSXQ037W",
          at: "2026-09-26T23:00:53.091Z",
          kind: "start",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "563828068441382707",
          startParam: "ErEYahuipGG-rJJkYfgFTSC7 謝謝",
          reply: reply("15f77f7162d99b2fc5633ff5732107bc"),
        },
      ],
    ],
    [
      "webhook-private-postback.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ6TH07787SEBPP3BCNAJY",
          at: "2026-09-26T23:01:06.720Z",
          kind: "button",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          buttonData: "k:0192a4c8e1f37b6d9a2c5e8f1b4d7a3c:y",
          reply: reply("efce7b948cf82a629239a11721de4a82"),
        },
      ],
    ],
    [
      "webhook-group-join.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ70A9GYACC1YCASQP26FJ",
          at: "2026-09-26T23:01:12.649Z",
          kind: "bot_added",
          sender: NOBODY_IN_GROUP,
          conversation: FAMILY_GROUP,
          reply: reply("043fe6913b4731ee79bae87a4ce8cf05"),
        },
      ],
    ],
    [
      "webhook-room-join.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ7FJSASCN96JMS5Z2ABHJ",
          at: "2026-09-26T23:01:28.281Z",
          kind: "bot_added",
          sender: { externalUserId: ROOM_ID },
          conversation: OLD_ROOM,
          reply: reply("21108343e0b9e1cca623a0a4b14dc51c"),
        },
      ],
    ],
    [
      "webhook-group-postback.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ7Z43E637ZNV578Y947BN",
          at: "2026-09-26T23:01:44.195Z",
          kind: "button",
          sender: { externalUserId: ANNA },
          conversation: FAMILY_GROUP,
          buttonData: "n:0192a4c9f2e84a1db3c6e9f2a5b8c1d4:r",
          reply: reply("b58c23dd0da8d41f2e035458c1d0231c"),
        },
      ],
    ],
    [
      "webhook-group-ask.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ8HBWCP5V9RA2V8JCXF50",
          at: "2026-09-26T23:02:02.876Z",
          kind: "text",
          sender: { externalUserId: ANNA },
          conversation: FAMILY_GROUP,
          messageId: "502621186619914619",
          text: "/ask What did you cook today?",
          reply: reply("9d6614ad733db6cab0bca149bbe5d021"),
        },
      ],
    ],
    [
      "webhook-private-text.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ9A9NW73PK6SZ3PDQ7PYS",
          at: "2026-09-26T23:02:28.405Z",
          kind: "text",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "552078231551808266",
          text: "今天去市場買了空心菜",
          reply: reply("c49772f8bb2228e107007ca23b93a3b3"),
        },
      ],
    ],
    [
      "webhook-private-text-quote.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZ9RZFQD7MPQ66ZYXK8ZBZ",
          at: "2026-09-26T23:02:43.439Z",
          kind: "text",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "542402518368845950",
          replyToMessageId: "514869307975298878",
          text: "睡得很好，謝謝",
          reply: reply("615cd098e708f4b799182917e7353721"),
        },
      ],
    ],
    [
      "webhook-private-image.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZA3PX86KFTMB45SH3NF52",
          at: "2026-09-26T23:02:54.429Z",
          kind: "image",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "534327666218059873",
          mediaGroupId: "C4E600FF7FFECEDF48881AD8F2F882E6B3CF161905F87DD434B1B7E44444B377",
          media: {
            kind: "image",
            providerFileId: "534327666218059873",
            providerUniqueId: "534327666218059873",
          },
          reply: reply("5b2ca5a6eeacf1861b79bb922ed2f085"),
        },
      ],
    ],
    [
      // Served from elsewhere, so nothing can be downloaded; it still counts as her reply.
      "webhook-private-image-external.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZADKPSVS61TK8PGMWT97X",
          at: "2026-09-26T23:03:04.566Z",
          kind: "other",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "514245091421792905",
          reply: reply("83f34858dfb022eed2e2f9bfaa1f4023"),
        },
      ],
    ],
    [
      "webhook-private-audio.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZASNZAX7K7JS626DFST6T",
          at: "2026-09-26T23:03:16.927Z",
          kind: "voice",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "508667044176309088",
          media: {
            kind: "audio",
            providerFileId: "508667044176309088",
            providerUniqueId: "508667044176309088",
            durationMs: 23_000,
          },
          reply: reply("6052c5ed74a0a122b25391cb74942eb6"),
        },
      ],
    ],
    [
      "webhook-private-video.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZB6B0N6ME87XD4Y5REQNV",
          at: "2026-09-26T23:03:29.888Z",
          kind: "other",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "541491910429487253",
          reply: reply("1316118ae6bbd373609a3946c608407c"),
        },
      ],
    ],
    [
      "webhook-private-file.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZBK5ZYJ4EYFE0PQY2WF2X",
          at: "2026-09-26T23:03:43.039Z",
          kind: "other",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "508378059350039548",
          reply: reply("f90e78aed98c45c74761d524df7dcf12"),
        },
      ],
    ],
    [
      "webhook-private-location.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZBXF4YNS73HA21GCH3CBX",
          at: "2026-09-26T23:03:53.572Z",
          kind: "other",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "546644395973635865",
          reply: reply("c314c05c208bbb2ee175a97aea92222c"),
        },
      ],
    ],
    [
      "webhook-private-sticker.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZC678GAPH9A62F80RZNBB",
          at: "2026-09-26T23:04:02.536Z",
          kind: "sticker",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "559873372611860523",
          text: "謝謝你",
          reply: reply("fee249f9295eb042ec81e49b3d9c43a2"),
        },
      ],
    ],
    [
      "webhook-private-unsend.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZCQAKV20T7JZS9R28K4J7",
          at: "2026-09-26T23:04:20.051Z",
          kind: "unsent",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "552078231551808266",
        },
      ],
    ],
    [
      "webhook-unfollow.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZCVWSN6N9GQSN8NHHXXGG",
          at: "2026-09-26T23:04:24.729Z",
          kind: "blocked",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
        },
      ],
    ],
    [
      "webhook-group-quote-reply.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZD9W9VT4VY2EFTYDHFEKD",
          at: "2026-09-26T23:04:39.049Z",
          kind: "text",
          sender: { externalUserId: SAM },
          conversation: FAMILY_GROUP,
          messageId: "530253224766452121",
          replyToMessageId: "501968441952665100",
          text: "Water spinach with garlic, my favourite! 😋",
          reply: reply("8dfe80e2f4a7316682026109dfb7bda9"),
        },
      ],
    ],
    [
      // LINE's group sources name a user only on message events, so an unsend usually names no one.
      "webhook-group-unsend.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZGW5JKBY4W5QGBV8XEE21",
          at: "2026-09-26T23:06:36.082Z",
          kind: "unsent",
          sender: NOBODY_IN_GROUP,
          conversation: FAMILY_GROUP,
          messageId: "502621186619914619",
        },
      ],
    ],
    [
      // LINE's own example of a group unsend names the user, so one that does is read as sent.
      "webhook-group-unsend-with-user.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZHA8BXPHKHXF7HKCKB3KW",
          at: "2026-09-26T23:06:50.507Z",
          kind: "unsent",
          sender: { externalUserId: SAM },
          conversation: FAMILY_GROUP,
          messageId: "530253224766452121",
        },
      ],
    ],
    [
      "webhook-group-member-left.json",
      [
        {
          channel: "line",
          eventId: `line:01M3FZHZYXW99Q647HEWJ0NPFF:${SAM}`,
          at: "2026-09-26T23:07:12.733Z",
          kind: "member_left",
          sender: NOBODY_IN_GROUP,
          conversation: FAMILY_GROUP,
          subject: { externalUserId: SAM },
        },
        {
          channel: "line",
          eventId: `line:01M3FZHZYXW99Q647HEWJ0NPFF:${WEI}`,
          at: "2026-09-26T23:07:12.733Z",
          kind: "member_left",
          sender: NOBODY_IN_GROUP,
          conversation: FAMILY_GROUP,
          subject: { externalUserId: WEI },
        },
      ],
    ],
    [
      "webhook-group-leave.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZJFXCC0BDR0G9MB2MSZ9C",
          at: "2026-09-26T23:07:29.068Z",
          kind: "bot_removed",
          sender: NOBODY_IN_GROUP,
          conversation: FAMILY_GROUP,
        },
      ],
    ],
    [
      "webhook-two-users.json",
      [
        {
          channel: "line",
          eventId: "line:01M3FZK3A7MQ64X9EMG0VMD9GX",
          at: "2026-09-26T23:07:48.935Z",
          kind: "text",
          sender: { externalUserId: MEIHUA },
          conversation: MEIHUA_CHAT,
          messageId: "560279695737337817",
          text: "早安",
          reply: reply("52cda1cec6ca1481babfa4686c05ace6"),
        },
        {
          channel: "line",
          eventId: "line:01M3FZKMKZ42PQMSR6W2KA1A7N",
          at: "2026-09-26T23:08:06.655Z",
          kind: "followed",
          sender: { externalUserId: SAM },
          conversation: SAM_CHAT,
          reply: reply("f452095ec7e2129b91bf24a4e829bf04"),
        },
      ],
    ],
  ];

  it.each(cases)("%s parses to the expected events", (fixture, expected) => {
    expect(parseFixture(fixture)).toStrictEqual(expected);
  });

  const droppedInGroups = [
    "webhook-group-text.json",
    "webhook-group-mention.json",
    "webhook-group-ask-no-user.json",
    "webhook-group-postback-no-user.json",
    "webhook-group-image.json",
    "webhook-group-audio.json",
    "webhook-group-video.json",
    "webhook-group-file.json",
    "webhook-group-location.json",
    // A message sticker with words that quotes Vela: the words would pass for a family reply.
    "webhook-group-sticker-quote.json",
    "webhook-group-edited.json",
    "webhook-group-member-joined.json",
  ];

  it.each(droppedInGroups)("%s yields nothing, so it never leaves the adapter", (fixture) => {
    expect(parseFixture(fixture)).toStrictEqual([]);
  });

  it("yields nothing for a standby event, which belongs to a module channel", () => {
    expect(parseFixture("webhook-standby.json")).toStrictEqual([]);
  });

  it("yields nothing for event types Vela does not use, or that LINE adds later", () => {
    expect(parseFixture("webhook-ignored-types.json")).toStrictEqual([]);
  });

  it("keeps the order of a body that carries two users' events", () => {
    expect(
      parseFixture("webhook-two-users.json").map((event) => [event.kind, event.sender]),
    ).toStrictEqual([
      ["text", { externalUserId: MEIHUA }],
      ["followed", { externalUserId: SAM }],
    ]);
  });

  it("yields only events the contract's schema accepts, for every fixture", () => {
    const fixtures = readdirSync(new URL("./fixtures/", import.meta.url)).filter((name) =>
      name.startsWith("webhook-"),
    );
    expect(fixtures.length).toBeGreaterThan(30);
    for (const fixture of fixtures) {
      for (const event of parseFixture(fixture)) {
        expect(InboundEvent.parse(event)).toStrictEqual(event);
      }
    }
  });
});

describe("parseLineWebhook body rules", () => {
  it("throws on malformed JSON", () => {
    expect(() => parseLineWebhook("{not json", RECEIVED_AT)).toThrow(SyntaxError);
  });

  it("throws on a body without an events array", () => {
    const destination = "U2ba6561a468b4afe9fa1df6d946e23de";
    expect(() => parseLineWebhook(JSON.stringify({ destination }), RECEIVED_AT)).toThrow(/events/);
    expect(() =>
      parseLineWebhook(JSON.stringify({ destination, events: {} }), RECEIVED_AT),
    ).toThrow(/events/);
    expect(() => parseLineWebhook("[]", RECEIVED_AT)).toThrow(/events/);
  });

  it("yields nothing for the Verify button's body, whose events are empty", () => {
    const body = '{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}';
    expect(parseLineWebhook(body, RECEIVED_AT)).toStrictEqual([]);
  });

  it("gives an event LINE delivers again the same event id", () => {
    const first = eventOf("webhook-private-text.json");
    const again = { ...first, deliveryContext: { isRedelivery: true } };
    const later = new Date("2026-09-26T23:13:30.000Z");
    const [original] = parseEvents([first]);
    const [redelivered] = parseEvents([again], later);
    expect(original?.eventId).toBe("line:01M3FZ9A9NW73PK6SZ3PDQ7PYS");
    expect(redelivered?.eventId).toBe(original?.eventId);
  });

  it("skips an event that fails its own shape and keeps the ones around it", () => {
    const good = eventOf("webhook-private-text.json");
    const alsoGood = eventOf("webhook-unfollow.json");
    const withoutId = Object.fromEntries(
      Object.entries(good).filter(([key]) => key !== "webhookEventId"),
    );
    const broken: unknown[] = [
      "not an event",
      null,
      withoutId,
      { ...good, webhookEventId: "" },
      { ...good, webhookEventId: 42 },
      { ...good, timestamp: "1790463748405" },
      { ...good, timestamp: 1790463748405.5 },
      { ...good, timestamp: -1 },
      { ...good, timestamp: 9_000_000_000_000_000 },
      { ...good, type: 7 },
      { ...good, source: { type: "chat", chatId: GROUP_ID } },
      { ...good, source: { type: "user", userId: "U123" } },
      { ...good, source: { type: "group", groupId: MEIHUA, userId: SAM } },
      { ...good, source: undefined },
    ];
    const events = parseEvents([broken[0], good, ...broken.slice(1), alsoGood]);
    expect(events.map((event) => [event.kind, event.eventId])).toStrictEqual([
      ["text", "line:01M3FZ9A9NW73PK6SZ3PDQ7PYS"],
      ["blocked", "line:01M3FZCVWSN6N9GQSN8NHHXXGG"],
    ]);
  });
});

describe("parseLineWebhook reply tokens", () => {
  // webhook-private-text.json happened at 2026-09-26T23:02:28.405Z.
  const event = eventOf("webhook-private-text.json");
  const untilWhenReceivedAt = (receivedAt: string): string | undefined =>
    parseEvents([event], new Date(receivedAt))[0]?.reply?.until;

  it("lets a fresh event's token be used for 50 seconds after it arrived", () => {
    expect(untilWhenReceivedAt("2026-09-26T23:02:29.605Z")).toBe("2026-09-26T23:03:19.605Z");
  });

  it("never lets a late delivery's token run past 19 minutes after the event", () => {
    expect(untilWhenReceivedAt("2026-09-26T23:20:58.405Z")).toBe("2026-09-26T23:21:28.405Z");
  });

  it("reports a token redelivered 25 minutes after its event with a time already past", () => {
    const receivedAt = "2026-09-26T23:27:28.405Z";
    const until = untilWhenReceivedAt(receivedAt);
    expect(until).toBe("2026-09-26T23:21:28.405Z");
    expect(Date.parse(until ?? "")).toBeLessThan(Date.parse(receivedAt));
  });

  it("carries no reply for an event LINE sends without a token", () => {
    expect(parseFixture("webhook-private-unsend.json")[0]).not.toHaveProperty("reply");
  });
});

describe("parseLineWebhook in a private chat", () => {
  const textOf = (text: string): [string, string | undefined, string | undefined][] =>
    parseEvents([withMessage("webhook-private-text.json", { text })]).map((event) => [
      event.kind,
      event.text,
      event.startParam,
    ]);

  it("reads /start with only trailing spaces as a start without a parameter", () => {
    expect(textOf("/start  ")).toStrictEqual([["start", undefined, undefined]]);
  });

  it("reads /start followed by any whitespace but a line break as a start", () => {
    expect(textOf("/start\u3000ErEYahuipGG")).toStrictEqual([["start", undefined, "ErEYahuipGG"]]);
  });

  it("treats words that merely begin with /start as text", () => {
    expect(textOf("/starting over")).toStrictEqual([["text", "/starting over", undefined]]);
  });

  it("treats /start with more lines after it as text", () => {
    const text = `/start ${INVITE_TOKEN}\n謝謝`;
    expect(textOf(text)).toStrictEqual([["text", text, undefined]]);
  });

  it("reads audio held elsewhere as other, with no media", () => {
    const [event, ...rest] = parseEvents([
      withMessage("webhook-private-audio.json", { contentProvider: { type: "external" } }),
    ]);
    expect(rest).toStrictEqual([]);
    expect(event?.kind).toBe("other");
    expect(event).not.toHaveProperty("media");
  });

  it("reads a voice note LINE gives no duration for as voice without one", () => {
    const [event] = parseEvents([
      withMessage("webhook-private-audio.json", { duration: undefined }),
    ]);
    expect(event?.media).toStrictEqual({
      kind: "audio",
      providerFileId: "508667044176309088",
      providerUniqueId: "508667044176309088",
    });
  });

  it("reads a sticker without words as a sticker with no text", () => {
    const [event] = parseEvents([withMessage("webhook-private-sticker.json", { text: undefined })]);
    expect(event?.kind).toBe("sticker");
    expect(event).not.toHaveProperty("text");
  });

  it("yields nothing for a message type it does not know", () => {
    expect(
      parseEvents([withMessage("webhook-private-text.json", { type: "hologram" })]),
    ).toStrictEqual([]);
  });

  it("yields nothing for a message without a readable id", () => {
    expect(
      parseEvents([withMessage("webhook-private-text.json", { id: "../content" })]),
    ).toStrictEqual([]);
  });

  it("yields nothing from a person LINE does not name, who has no chat to answer in", () => {
    const event = eventOf("webhook-private-text.json");
    expect(parseEvents([{ ...event, source: { type: "user" } }])).toStrictEqual([]);
  });

  it("yields nothing for a tap without data", () => {
    const event = eventOf("webhook-private-postback.json");
    expect(parseEvents([{ ...event, postback: { data: "" } }])).toStrictEqual([]);
    expect(parseEvents([{ ...event, postback: {} }])).toStrictEqual([]);
  });
});

describe("parseLineWebhook in a group", () => {
  const groupText = (text: string): InboundEvent[] =>
    parseEvents([withMessage("webhook-group-ask.json", { text })]);

  it("reads a command with leading whitespace, since services trim it", () => {
    expect(
      groupText("  /later Tomorrow, ask about the garden").map((event) => event.kind),
    ).toStrictEqual(["text"]);
  });

  it("keeps /start in a group as text", () => {
    expect(
      groupText(`/start ${INVITE_TOKEN}`).map((event) => [event.kind, event.startParam]),
    ).toStrictEqual([["text", undefined]]);
  });

  it("drops a text that only mentions a command further in", () => {
    expect(groupText("Try /ask tomorrow")).toStrictEqual([]);
  });

  it("drops every message but text on its type, even one that carries words and a quote", () => {
    // Stray words and a quote, as a message sticker carries, on every other kind and on a type LINE
    // adds later: were the text read, each would pass for a family reply.
    const words = { text: "/ask Did you sleep well?", quotedMessageId: "501968441952665100" };
    const others = ["image", "audio", "video", "file", "location"].map((kind) =>
      withMessage(`webhook-group-${kind}.json`, words),
    );
    const later = withMessage("webhook-group-ask.json", { ...words, type: "hologram" });
    expect(parseEvents([...others, later])).toStrictEqual([]);
    // The same fields on a text message make an event, so only the type drops the others.
    const asText = withMessage("webhook-group-image.json", { ...words, type: "text" });
    expect(parseEvents([asText]).map((event) => event.kind)).toStrictEqual(["text"]);
  });

  it("reads a multi-person chat like a group", () => {
    const event = eventOf("webhook-group-ask.json");
    const inRoom = { ...event, source: { type: "room", roomId: ROOM_ID, userId: ANNA } };
    expect(parseEvents([inRoom]).map((parsed) => parsed.conversation)).toStrictEqual([OLD_ROOM]);
  });

  it("names each departed member once and leaves out one LINE does not name", () => {
    const event = eventOf("webhook-group-member-left.json");
    const members = [
      { type: "user", userId: SAM },
      { type: "user" },
      { type: "user", userId: SAM },
      { type: "bot", userId: WEI },
    ];
    const events = parseEvents([{ ...event, left: { members } }]);
    expect(events.map((parsed) => parsed.subject)).toStrictEqual([{ externalUserId: SAM }]);
  });

  it("yields nothing for membership events from a chat they cannot come from", () => {
    const join = eventOf("webhook-group-join.json");
    const follow = eventOf("webhook-follow.json");
    const unfollow = eventOf("webhook-unfollow.json");
    const inGroup = { type: "group", groupId: GROUP_ID, userId: MEIHUA };
    expect(
      parseEvents([
        { ...join, source: { type: "user", userId: ANNA } },
        { ...follow, source: inGroup },
        { ...unfollow, source: inGroup },
      ]),
    ).toStrictEqual([]);
  });
});
