import type { InboundEvent } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { createLineAdapter } from "./adapter.ts";
import {
  createRecordingFetch,
  lineApi,
  lineApiFixture,
  type Responder,
  readFixture,
  routeOf,
  signedWebhook,
  TEST_CHANNEL_ACCESS_TOKEN,
  TEST_CHANNEL_SECRET,
} from "./testing.ts";

const RECEIVED_AT = new Date("2026-09-26T23:10:30.000Z");
const MEIHUA = "U3bf020427417f5c0decf3c1612d4e59a";
const SAM = "U8f8c4117e99b1a4fa8346f3d1c56731b";
const GROUP_ID = "Ce5f4dcc362130dc312c78866466c6fff";
const ROOM_ID = "Rca6e8caf2a1ec2403b3dd52ecccd098a";

function setup(responder: Responder = lineApi({})) {
  const recording = createRecordingFetch(responder);
  const adapter = createLineAdapter({
    channelSecret: TEST_CHANNEL_SECRET,
    channelAccessToken: TEST_CHANNEL_ACCESS_TOKEN,
    fetch: recording.fetch,
    now: () => RECEIVED_AT,
  });
  return { adapter, requests: recording.requests };
}

describe("createLineAdapter", () => {
  it("describes LINE's capabilities", () => {
    const { adapter } = setup();
    expect(adapter.id).toBe("line");
    expect(adapter.capabilities).toStrictEqual({
      buttons: true,
      voiceIn: true,
      voiceOut: true,
      readReceipts: false,
      reactions: false,
      albums: false,
      editMessages: false,
      resendsProviderFiles: false,
      mediaByUrl: true,
      mediaReplies: false,
    });
  });

  it("implements every optional method", () => {
    const { adapter } = setup();
    expect(adapter.profile).toBeTypeOf("function");
    expect(adapter.leaveConversation).toBeTypeOf("function");
    expect(adapter.quota).toBeTypeOf("function");
    expect(adapter.fetchPreview).toBeTypeOf("function");
  });

  it("refuses a secret or token that is empty or cannot go in a header, without repeating it", () => {
    const refusals: [secret: string, token: string, pattern: RegExp][] = [
      ["", TEST_CHANNEL_ACCESS_TOKEN, /channel secret/],
      ["2e4e6837 a5d6004e", TEST_CHANNEL_ACCESS_TOKEN, /channel secret/],
      ["2e4e6837a5d6004eab062f322de9c3e5\n", TEST_CHANNEL_ACCESS_TOKEN, /channel secret/],
      [TEST_CHANNEL_SECRET, "", /access token/],
      [TEST_CHANNEL_SECRET, "Bearer abc", /access token/],
      [TEST_CHANNEL_SECRET, "abc\u0000def", /access token/],
      [TEST_CHANNEL_SECRET, "トークン", /access token/],
    ];
    for (const [channelSecret, channelAccessToken, pattern] of refusals) {
      let thrown: unknown;
      try {
        createLineAdapter({ channelSecret, channelAccessToken });
      } catch (error) {
        thrown = error;
      }
      expect(String(thrown)).toMatch(pattern);
      for (const value of [channelSecret, channelAccessToken]) {
        if (value !== "") expect(String(thrown)).not.toContain(value);
      }
    }
  });

  it("verifies webhooks against its own channel secret", async () => {
    const { adapter } = setup();
    const rawBody = readFixture("webhook-private-text.json");

    await expect(adapter.verify(signedWebhook(rawBody))).resolves.toBe(true);
    await expect(
      adapter.verify(signedWebhook(rawBody, "0123456789abcdef0123456789abcdef")),
    ).resolves.toBe(false);
  });

  it("starts each reply token's minute with the injected clock", () => {
    const { adapter } = setup();
    const [event] = adapter.parse(signedWebhook(readFixture("webhook-private-text.json")));
    expect(event?.reply?.until).toBe("2026-09-26T23:11:20.000Z");
  });
});

describe("adapter.acknowledgeButton and adapter.closeButtons", () => {
  it("resolve for any event without calling LINE, which has nothing to acknowledge or edit", async () => {
    const { adapter, requests } = setup();
    const [tap] = adapter.parse(signedWebhook(readFixture("webhook-private-postback.json")));
    const telegramText: InboundEvent = {
      channel: "telegram",
      eventId: "tg:1",
      at: "2026-09-26T23:00:00.000Z",
      kind: "text",
      sender: { externalUserId: "6023817745" },
      conversation: { externalId: "6023817745", kind: "private" },
      text: "hello",
    };
    if (tap === undefined) throw new Error("the postback fixture must parse to an event");

    await expect(adapter.acknowledgeButton(tap, "Sent to Anna")).resolves.toBeUndefined();
    await expect(adapter.acknowledgeButton(telegramText)).resolves.toBeUndefined();
    await expect(
      adapter.closeButtons(MEIHUA, "533817094156927010", "→ Congee"),
    ).resolves.toBeUndefined();
    await expect(adapter.closeButtons("anything", "at all")).resolves.toBeUndefined();
    expect(requests).toHaveLength(0);
  });
});

describe("adapter.profile", () => {
  it("asks for a person's main profile, with their language, when no chat or their own is named", async () => {
    const { adapter, requests } = setup(
      lineApi({ [`GET /v2/bot/profile/${MEIHUA}`]: () => lineApiFixture("api-profile-200.json") }),
    );

    await expect(adapter.profile?.(MEIHUA)).resolves.toStrictEqual({
      displayName: "陳美華",
      languageCode: "zh-TW",
    });
    await expect(adapter.profile?.(MEIHUA, MEIHUA)).resolves.toStrictEqual({
      displayName: "陳美華",
      languageCode: "zh-TW",
    });
    expect(requests).toHaveLength(2);
  });

  it("asks through the group for a member of it, which gives the name only", async () => {
    const { adapter, requests } = setup(
      lineApi({
        [`GET /v2/bot/group/${GROUP_ID}/member/${SAM}`]: () =>
          lineApiFixture("api-group-member-profile-200.json"),
      }),
    );

    await expect(adapter.profile?.(SAM, GROUP_ID)).resolves.toStrictEqual({ displayName: "Sam" });
    expect(requests.map(routeOf)).toStrictEqual([`GET /v2/bot/group/${GROUP_ID}/member/${SAM}`]);
  });

  it("answers null for someone LINE does not know there", async () => {
    const { adapter } = setup(() => lineApiFixture("api-profile-404.json"));

    await expect(adapter.profile?.(MEIHUA)).resolves.toBeNull();
    await expect(adapter.profile?.(SAM, GROUP_ID)).resolves.toBeNull();
  });

  it("answers null for a multi-person chat without asking LINE", async () => {
    const { adapter, requests } = setup();
    await expect(adapter.profile?.(SAM, ROOM_ID)).resolves.toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("throws other failures for callers to treat as unknown", async () => {
    const { adapter } = setup(() => lineApiFixture("api-error-500.json"));
    await expect(adapter.profile?.(MEIHUA)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses a conversation id that is not LINE's without asking LINE", async () => {
    const { adapter, requests } = setup();
    await expect(adapter.profile?.(MEIHUA, "-1002214567890")).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(requests).toHaveLength(0);
  });
});

describe("adapter.leaveConversation", () => {
  it("leaves a group or a multi-person chat through its own endpoint", async () => {
    const { adapter, requests } = setup(
      lineApi({
        [`POST /v2/bot/group/${GROUP_ID}/leave`]: () => lineApiFixture("api-leave-200.json"),
        [`POST /v2/bot/room/${ROOM_ID}/leave`]: () => lineApiFixture("api-leave-200.json"),
      }),
    );

    await adapter.leaveConversation?.(GROUP_ID);
    await adapter.leaveConversation?.(ROOM_ID);

    expect(requests.map(routeOf)).toStrictEqual([
      `POST /v2/bot/group/${GROUP_ID}/leave`,
      `POST /v2/bot/room/${ROOM_ID}/leave`,
    ]);
  });

  it("counts a group it is no longer in as left", async () => {
    const { adapter } = setup(() => lineApiFixture("api-leave-404.json"));
    await expect(adapter.leaveConversation?.(GROUP_ID)).resolves.toBeUndefined();
  });

  it("throws other failures", async () => {
    const { adapter } = setup(() => lineApiFixture("api-error-500.json"));
    await expect(adapter.leaveConversation?.(GROUP_ID)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("refuses to leave a person's own chat without asking LINE", async () => {
    const { adapter, requests } = setup();
    await expect(adapter.leaveConversation?.(MEIHUA)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(requests).toHaveLength(0);
  });
});
