import { describe, expect, it } from "vitest";
import { getMe, setMyCommands, setWebhook } from "./setup.ts";
import { botApi, createRecordingFetch, TEST_BOT_TOKEN, TEST_WEBHOOK_SECRET } from "./testing.ts";

describe("setWebhook", () => {
  it("registers the URL and secret and subscribes to the updates the adapter parses", async () => {
    const recording = createRecordingFetch(botApi({ setWebhook: () => true }));

    await setWebhook({
      botToken: TEST_BOT_TOKEN,
      fetch: recording.fetch,
      url: "https://api.vela.example/webhooks/telegram",
      secretToken: TEST_WEBHOOK_SECRET,
      dropPendingUpdates: true,
    });

    expect(recording.requests.map((request) => [request.apiMethod, request.params])).toStrictEqual([
      [
        "setWebhook",
        {
          url: "https://api.vela.example/webhooks/telegram",
          secret_token: TEST_WEBHOOK_SECRET,
          allowed_updates: ["message", "callback_query", "message_reaction", "my_chat_member"],
          drop_pending_updates: true,
        },
      ],
    ]);
  });

  it("refuses a secret Telegram would reject without calling it", async () => {
    const recording = createRecordingFetch(botApi({ setWebhook: () => true }));

    await expect(
      setWebhook({
        botToken: TEST_BOT_TOKEN,
        fetch: recording.fetch,
        url: "https://api.vela.example/webhooks/telegram",
        secretToken: "not/allowed",
      }),
    ).rejects.toThrow(/webhook secret/);
    expect(recording.requests).toHaveLength(0);
  });
});

describe("setMyCommands", () => {
  it("sends the commands with their scope and language", async () => {
    const recording = createRecordingFetch(botApi({ setMyCommands: () => true }));

    await setMyCommands({
      botToken: TEST_BOT_TOKEN,
      fetch: recording.fetch,
      commands: [{ command: "start", description: "開始" }],
      scope: { type: "all_private_chats" },
      languageCode: "zh",
    });

    expect(recording.requests.map((request) => [request.apiMethod, request.params])).toStrictEqual([
      [
        "setMyCommands",
        {
          commands: [{ command: "start", description: "開始" }],
          scope: { type: "all_private_chats" },
          language_code: "zh",
        },
      ],
    ]);
  });
});

describe("getMe", () => {
  it("returns the bot's identity and whether it can read group messages", async () => {
    const recording = createRecordingFetch(
      botApi({
        getMe: () => ({
          id: 7412589630,
          is_bot: true,
          first_name: "Vela Light",
          username: "VelaLightBot",
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        }),
      }),
    );

    await expect(
      getMe({ botToken: TEST_BOT_TOKEN, fetch: recording.fetch }),
    ).resolves.toStrictEqual({
      id: "7412589630",
      username: "VelaLightBot",
      firstName: "Vela Light",
      canJoinGroups: true,
      canReadAllGroupMessages: false,
    });
    expect(recording.requests.map((request) => request.apiMethod)).toStrictEqual(["getMe"]);
  });

  it("maps an invalid token to a non-retryable error that does not contain it", async () => {
    const recording = createRecordingFetch(() =>
      Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }),
    );

    const error: unknown = await getMe({ botToken: TEST_BOT_TOKEN, fetch: recording.fetch }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toMatchObject({ code: "unknown", retryable: false });
    expect(String(error)).toContain("Unauthorized");
    expect(String(error)).not.toContain(TEST_BOT_TOKEN);
  });
});
