import { ChannelSendError } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { createTelegramClient, type TelegramClient } from "./client.ts";
import {
  createRecordingFetch,
  type Responder,
  TEST_BOT_TOKEN,
  telegramErrorFixture,
  telegramOk,
} from "./testing.ts";

function clientWith(responder: Responder, apiBaseUrl?: string) {
  const recording = createRecordingFetch(responder);
  const client = createTelegramClient({
    botToken: TEST_BOT_TOKEN,
    fetch: recording.fetch,
    apiBaseUrl,
  });
  return { client, requests: recording.requests };
}

async function failureOf(
  attempt: (client: TelegramClient) => Promise<unknown>,
  responder: Responder,
) {
  const { client } = clientWith(responder);
  const error = await attempt(client).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ChannelSendError);
  return error instanceof ChannelSendError ? error : new ChannelSendError("unknown", "not reached");
}

const sendText = (client: TelegramClient) =>
  client.sendMessage({ chat_id: 6023817745, text: "hello" });

describe("createTelegramClient", () => {
  it("posts JSON to the bot's method URL and returns the documented result", async () => {
    const { client, requests } = clientWith(() => telegramOk({ message_id: 42, date: 1789258325 }));

    await expect(client.sendMessage({ chat_id: 6023817745, text: "hello" })).resolves.toStrictEqual(
      {
        message_id: 42,
      },
    );
    expect(requests).toStrictEqual([
      {
        url: `https://api.telegram.org/bot${TEST_BOT_TOKEN}/sendMessage`,
        httpMethod: "POST",
        apiMethod: "sendMessage",
        contentType: "application/json",
        params: { chat_id: 6023817745, text: "hello" },
      },
    ]);
  });

  it("uses a configured API base URL", async () => {
    const { client, requests } = clientWith(() => telegramOk(true), "http://localhost:8081/");

    await client.answerCallbackQuery({ callback_query_id: "1" });

    expect(requests[0]?.url).toBe(`http://localhost:8081/bot${TEST_BOT_TOKEN}/answerCallbackQuery`);
  });

  it("refuses a malformed token without repeating it", () => {
    const token = "not a token/../getMe";
    expect(() => createTelegramClient({ botToken: token })).toThrow(/malformed/);
    try {
      createTelegramClient({ botToken: token });
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });
});

describe("Bot API error mapping", () => {
  const recorded: [
    fixture: string,
    code: string,
    retryable: boolean,
    retryAfter: number | undefined,
    migratedTo: string | undefined,
  ][] = [
    ["error-403-blocked.json", "blocked", false, undefined, undefined],
    ["error-400-chat-not-found.json", "not_found", false, undefined, undefined],
    // The group's new id is the way forward, so the error names it rather than being retried.
    ["error-400-group-upgraded.json", "invalid_request", false, undefined, "-1002214567890"],
    ["error-429-retry-after.json", "rate_limited", true, 17, undefined],
    ["error-502-bad-gateway.json", "unavailable", true, undefined, undefined],
  ];

  it.each(recorded)("%s maps to %s", async (fixture, code, retryable, retryAfter, migratedTo) => {
    const error = await failureOf(sendText, () => telegramErrorFixture(fixture));

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.retryAfterSeconds).toBe(retryAfter);
    expect(error.migratedToConversationId).toBe(migratedTo);
    expect(error.message).not.toContain(TEST_BOT_TOKEN);
  });

  it("maps other bad requests to invalid_request", async () => {
    const error = await failureOf(sendText, () =>
      Response.json(
        { ok: false, error_code: 400, description: "Bad Request: message text is empty" },
        { status: 400 },
      ),
    );
    expect(error.code).toBe("invalid_request");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("message text is empty");
  });

  it("maps other forbidden sends, such as a kicked bot, to blocked", async () => {
    const error = await failureOf(sendText, () =>
      Response.json(
        {
          ok: false,
          error_code: 403,
          description: "Forbidden: bot was kicked from the group chat",
        },
        { status: 403 },
      ),
    );
    expect(error.code).toBe("blocked");
  });

  it("maps a gateway error page that is not JSON to unavailable", async () => {
    const error = await failureOf(
      sendText,
      () =>
        new Response("<html><body><h1>502 Bad Gateway</h1></body></html>", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "content-type": "text/html" },
        }),
    );
    expect(error.code).toBe("unavailable");
    expect(error.retryable).toBe(true);
  });

  it("maps an unauthorised token to unknown, which is not retried", async () => {
    const error = await failureOf(sendText, () =>
      Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }),
    );
    expect(error.code).toBe("unknown");
    expect(error.retryable).toBe(false);
  });

  it("maps a network failure to unavailable without leaking the token from the runtime's message", async () => {
    const error = await failureOf(sendText, () => {
      throw new TypeError(
        `fetch failed: connect ETIMEDOUT https://api.telegram.org/bot${TEST_BOT_TOKEN}/sendMessage (${encodeURIComponent(TEST_BOT_TOKEN)})`,
      );
    });
    expect(error.code).toBe("unavailable");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("ETIMEDOUT");
    expect(error.message).not.toContain(TEST_BOT_TOKEN);
    expect(error.message).not.toContain(encodeURIComponent(TEST_BOT_TOKEN));
    expect(error.stack ?? "").not.toContain(TEST_BOT_TOKEN);
    expect(error.cause).toBeUndefined();
  });

  it("treats a success status without the documented body as unknown, since the send may have happened", async () => {
    const error = await failureOf(sendText, () => new Response("OK", { status: 200 }));
    expect(error.code).toBe("unknown");
    expect(error.retryable).toBe(false);
  });

  it("treats a result without a message id as unknown", async () => {
    const error = await failureOf(sendText, () => telegramOk(true));
    expect(error.code).toBe("unknown");
  });

  it("maps a missing file download to not_found", async () => {
    const error = await failureOf(
      (client) => client.downloadFile("voice/file_12.oga", 1024),
      () => new Response("Not Found", { status: 404 }),
    );
    expect(error.code).toBe("not_found");
    expect(error.message).not.toContain(TEST_BOT_TOKEN);
  });
});
