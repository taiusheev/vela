import { ChannelSendError } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import {
  createLineClient,
  type LineClient,
  type LinePushRequest,
  lineContentErrorCode,
  lineErrorCode,
} from "./client.ts";
import {
  bodyOf,
  createRecordingFetch,
  lineApiFixture,
  type Responder,
  routeOf,
  TEST_CHANNEL_ACCESS_TOKEN,
} from "./testing.ts";

const MEIHUA = "U3bf020427417f5c0decf3c1612d4e59a";
const SAM = "U8f8c4117e99b1a4fa8346f3d1c56731b";
const GROUP_ID = "Ce5f4dcc362130dc312c78866466c6fff";
const ROOM_ID = "Rca6e8caf2a1ec2403b3dd52ecccd098a";
const RETRY_KEY = "8a1bef97-4963-5200-aac8-9904f060f50b";
const WORDS = "Good morning, Meihua. What did you have for breakfast?";

const PUSH: LinePushRequest = { to: MEIHUA, messages: [{ type: "text", text: WORDS }] };

function clientWith(responder: Responder, bases: { api?: string; data?: string } = {}) {
  const recording = createRecordingFetch(responder);
  const client = createLineClient({
    channelAccessToken: TEST_CHANNEL_ACCESS_TOKEN,
    fetch: recording.fetch,
    apiBaseUrl: bases.api,
    dataApiBaseUrl: bases.data,
  });
  return { client, requests: recording.requests };
}

async function failureOf(
  attempt: (client: LineClient) => Promise<unknown>,
  responder: Responder,
): Promise<ChannelSendError> {
  const { client } = clientWith(responder);
  const error = await attempt(client).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ChannelSendError);
  return error instanceof ChannelSendError ? error : new ChannelSendError("unknown", "not reached");
}

const push = (client: LineClient) => client.push(PUSH, RETRY_KEY);

/** Nothing that names a person, the token, or what was sent may reach an error's text. */
function expectNothingPrivate(error: ChannelSendError): void {
  for (const secret of [TEST_CHANNEL_ACCESS_TOKEN, MEIHUA, SAM, GROUP_ID, WORDS]) {
    expect(error.message).not.toContain(secret);
    expect(error.stack ?? "").not.toContain(secret);
  }
  expect(error.cause).toBeUndefined();
}

describe("createLineClient", () => {
  it("pushes JSON with the token, the retry key and a timeout, and returns the ids as strings", async () => {
    const { client, requests } = clientWith(() => lineApiFixture("api-push-200.json"));

    await expect(client.push(PUSH, RETRY_KEY)).resolves.toStrictEqual(["533817094156927010"]);

    const [request] = requests;
    expect(requests).toHaveLength(1);
    expect(request?.method).toBe("POST");
    expect(request?.host).toBe("api.line.me");
    expect(request?.pathname).toBe("/v2/bot/message/push");
    expect(request?.headers.get("authorization")).toBe(`Bearer ${TEST_CHANNEL_ACCESS_TOKEN}`);
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(request?.headers.get("x-line-retry-key")).toBe(RETRY_KEY);
    expect(request?.body).toBe(JSON.stringify(PUSH));
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(request?.signal?.aborted).toBe(false);
  });

  it("reads a 409 for a key LINE already accepted as the first request's success", async () => {
    const { client } = clientWith(() => lineApiFixture("api-push-409.json"));
    await expect(client.push(PUSH, RETRY_KEY)).resolves.toStrictEqual(["533817094156927010"]);
  });

  it("replies with the token and no retry key, which LINE refuses on replies", async () => {
    const { client, requests } = clientWith(() => lineApiFixture("api-reply-200.json"));

    await expect(
      client.reply({ replyToken: "6052c5ed74a0a122b25391cb74942eb6", messages: PUSH.messages }),
    ).resolves.toStrictEqual({ accepted: true, sentMessageIds: ["533817201984417330"] });

    expect(requests.map(routeOf)).toStrictEqual(["POST /v2/bot/message/reply"]);
    expect(requests[0]?.headers.has("x-line-retry-key")).toBe(false);
    expect(bodyOf(requests[0])).toStrictEqual({
      replyToken: "6052c5ed74a0a122b25391cb74942eb6",
      messages: PUSH.messages,
    });
  });

  it("reports a reply token LINE refuses as not accepted, since nothing was sent", async () => {
    const { client } = clientWith(() => lineApiFixture("api-reply-400-invalid-token.json"));
    await expect(
      client.reply({ replyToken: "used", messages: PUSH.messages }),
    ).resolves.toStrictEqual({ accepted: false });
  });

  it("strips trailing slashes from both base URLs", async () => {
    const { client, requests } = clientWith(
      (request) =>
        request.pathname.endsWith("/content")
          ? new Response(new Uint8Array([1]))
          : lineApiFixture("api-quota-none.json"),
      { api: "http://localhost:8787/line/", data: "http://localhost:8788//" },
    );

    await client.quota();
    await client.content("508667044176309088", 10);

    expect(requests.map((request) => `${request.host}${request.pathname}`)).toStrictEqual([
      "localhost:8787/line/v2/bot/message/quota",
      "localhost:8788/v2/bot/message/508667044176309088/content",
    ]);
  });

  it("refuses a token that cannot go in a header, without repeating it", () => {
    for (const token of ["", "has space", "tab\there", "line\nbreak", "ünïcode"]) {
      let thrown: unknown;
      try {
        createLineClient({ channelAccessToken: token });
      } catch (error) {
        thrown = error;
      }
      expect(String(thrown)).toMatch(/access token/);
      if (token !== "") expect(String(thrown)).not.toContain(token);
    }
  });
});

describe("LINE error mapping (05 §5.6)", () => {
  const rows: [fixture: string, code: string, retryable: boolean][] = [
    ["api-error-400.json", "invalid_request", false],
    ["api-error-401.json", "unavailable", true],
    ["api-error-403.json", "invalid_request", false],
    ["api-error-404.json", "not_found", false],
    ["api-error-413.json", "invalid_request", false],
    ["api-error-415.json", "invalid_request", false],
    ["api-error-429-monthly.json", "quota_exhausted", true],
    ["api-error-429-rate.json", "rate_limited", true],
    ["api-error-500.json", "unavailable", true],
    // A 409 without the ids LINE promises for push: a retry under the same key brings them.
    ["api-push-409-no-sent-messages.json", "unavailable", true],
    // The ids exceed 2^53, so a number has already lost digits: they are read only as strings.
    ["api-push-200-numeric-id.json", "unavailable", true],
  ];

  it.each(rows)("a push answered with %s is %s", async (fixture, code, retryable) => {
    const error = await failureOf(push, () => lineApiFixture(fixture));

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.retryAfterSeconds).toBeUndefined();
    expectNothingPrivate(error);
  });

  it("says line_auth on a refused token, so the outbound row shows why sends keep failing", async () => {
    const error = await failureOf(push, () => lineApiFixture("api-error-401.json"));
    expect(error.message).toMatch(/^line push failed: 401 line_auth Authentication failed/);
  });

  it("names LINE's message and the properties it refused, never the values", async () => {
    const error = await failureOf(push, () => lineApiFixture("api-error-400-details.json"));
    expect(error.message).toBe(
      "line push failed: 400 The request body has 2 error(s) (messages[0].quickReply.items[0].action.label, to)",
    );
  });

  it("redacts the token and any LINE id LINE's message repeats", async () => {
    const error = await failureOf(push, () =>
      Response.json(
        {
          message: `The user ${MEIHUA} in ${GROUP_ID} refused Bearer ${TEST_CHANNEL_ACCESS_TOKEN}`,
        },
        { status: 400 },
      ),
    );
    expect(error.message).toBe(
      "line push failed: 400 The user [id] in [id] refused Bearer [token]",
    );
  });

  it("maps a gateway error page that is not JSON to unavailable", async () => {
    const error = await failureOf(
      push,
      () =>
        new Response("<html><body><h1>502 Bad Gateway</h1></body></html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );
    expect(error.code).toBe("unavailable");
    expect(error.message).toBe("line push failed: 502");
  });

  it("maps a status LINE does not document to unknown, which is not retried", async () => {
    const error = await failureOf(push, () => Response.json({ message: "?" }, { status: 418 }));
    expect(error.code).toBe("unknown");
    expect(error.retryable).toBe(false);
  });

  it("maps a network failure to unavailable without the token or ids from the runtime's message", async () => {
    const error = await failureOf(push, () => {
      throw new TypeError(
        `fetch failed: connect ETIMEDOUT https://api.line.me/v2/bot/profile/${MEIHUA} (Bearer ${TEST_CHANNEL_ACCESS_TOKEN})`,
      );
    });
    expect(error.code).toBe("unavailable");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("ETIMEDOUT");
    expectNothingPrivate(error);
  });

  it("maps a call that outlasts its timeout to unavailable", async () => {
    const error = await failureOf(push, () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(error.code).toBe("unavailable");
    expect(error.message).toBe("line push failed: no answer within 10 s");
  });

  it("treats a reply answered 2xx without readable ids as unknown, since it went out and has no retry key", async () => {
    const error = await failureOf(
      (client) => client.reply({ replyToken: "fresh", messages: PUSH.messages }),
      () => Response.json({}),
    );
    expect(error.code).toBe("unknown");
    expect(error.retryable).toBe(false);
  });

  it("treats a push answered with fewer ids than objects as unreadable", async () => {
    const error = await failureOf(
      (client) =>
        client.push(
          { to: MEIHUA, messages: [...PUSH.messages, { type: "text", text: "second" }] },
          RETRY_KEY,
        ),
      () => lineApiFixture("api-push-200.json"),
    );
    expect(error.code).toBe("unavailable");
  });

  it("maps a reply that fails other than on its token like a push", async () => {
    for (const [fixture, code] of [
      ["api-error-500.json", "unavailable"],
      ["api-error-401.json", "unavailable"],
      ["api-error-429-rate.json", "rate_limited"],
    ] as const) {
      const error = await failureOf(
        (client) => client.reply({ replyToken: "fresh", messages: PUSH.messages }),
        () => lineApiFixture(fixture),
      );
      expect(error.code).toBe(code);
    }
  });

  it("maps download statuses apart: 400 has come from an outage and 410 means unsent", () => {
    expect(lineContentErrorCode(400, "")).toBe("unavailable");
    expect(lineContentErrorCode(410, "")).toBe("not_found");
    expect(lineContentErrorCode(404, "")).toBe("not_found");
    expect(lineContentErrorCode(401, "")).toBe("unavailable");
    expect(lineContentErrorCode(503, "")).toBe("unavailable");
    expect(lineErrorCode(400, "")).toBe("invalid_request");
    expect(lineErrorCode(410, "")).toBe("unknown");
  });
});

describe("LINE lookups", () => {
  it("reads a profile's name and language and nothing else", async () => {
    const { client, requests } = clientWith(() => lineApiFixture("api-profile-200.json"));

    await expect(client.profile(MEIHUA)).resolves.toStrictEqual({
      displayName: "陳美華",
      language: "zh-TW",
    });
    expect(requests.map(routeOf)).toStrictEqual([`GET /v2/bot/profile/${MEIHUA}`]);
    expect(requests[0]?.body).toBeUndefined();
    expect(requests[0]?.headers.has("content-type")).toBe(false);
  });

  it("reads a group member's name through the group", async () => {
    const { client, requests } = clientWith(() =>
      lineApiFixture("api-group-member-profile-200.json"),
    );

    await expect(client.groupMemberProfile(GROUP_ID, SAM)).resolves.toStrictEqual({
      displayName: "Sam",
    });
    expect(requests.map(routeOf)).toStrictEqual([`GET /v2/bot/group/${GROUP_ID}/member/${SAM}`]);
  });

  it("answers null for a person LINE does not know", async () => {
    const profile = clientWith(() => lineApiFixture("api-profile-404.json")).client;
    const member = clientWith(() => lineApiFixture("api-group-member-profile-404.json")).client;

    await expect(profile.profile(MEIHUA)).resolves.toBeNull();
    await expect(member.groupMemberProfile(GROUP_ID, SAM)).resolves.toBeNull();
  });

  it("leaves a group or a room with a bodiless POST, a 404 counting as left", async () => {
    const { client, requests } = clientWith((request) =>
      request.pathname.startsWith("/v2/bot/group/")
        ? lineApiFixture("api-leave-200.json")
        : lineApiFixture("api-leave-404.json"),
    );

    await client.leaveGroup(GROUP_ID);
    await client.leaveRoom(ROOM_ID);

    expect(requests.map(routeOf)).toStrictEqual([
      `POST /v2/bot/group/${GROUP_ID}/leave`,
      `POST /v2/bot/room/${ROOM_ID}/leave`,
    ]);
    expect(requests.map((request) => request.body)).toStrictEqual([undefined, undefined]);
  });

  it("reads the quota and its consumption", async () => {
    const { client, requests } = clientWith((request) =>
      request.pathname.endsWith("/consumption")
        ? lineApiFixture("api-quota-consumption.json")
        : lineApiFixture("api-quota-limited.json"),
    );

    await expect(client.quota()).resolves.toStrictEqual({ type: "limited", value: 3000 });
    await expect(client.quotaConsumption()).resolves.toBe(1287);
    expect(requests.map(routeOf)).toStrictEqual([
      "GET /v2/bot/message/quota",
      "GET /v2/bot/message/quota/consumption",
    ]);
  });

  it("treats a lookup answered 2xx with an unexpected body as unknown", async () => {
    const odd = (): Response => Response.json({ type: "limited", value: -1, totalUsage: "many" });
    for (const attempt of [
      (client: LineClient) => client.quota(),
      (client: LineClient) => client.quotaConsumption(),
      (client: LineClient) => client.transcodingStatus("508667044176309088"),
    ]) {
      const error = await failureOf(attempt, odd);
      expect(error.code).toBe("unknown");
    }
  });

  it("throws other lookup failures", async () => {
    const error = await failureOf(
      (client) => client.profile(MEIHUA),
      () => lineApiFixture("api-error-500.json"),
    );
    expect(error.code).toBe("unavailable");
    expect(error.message).toBe("line profile failed: 500 Internal server error");
  });

  describe("refuses an id of the wrong shape before any request, keeping it out of the URL", () => {
    const attempts: [string, (client: LineClient) => Promise<unknown>][] = [
      ["a profile of a group id", (client) => client.profile(GROUP_ID)],
      ["a profile with a path in it", (client) => client.profile(`${MEIHUA}/../quota`)],
      ["a member of a room", (client) => client.groupMemberProfile(ROOM_ID, SAM)],
      ["a member who is a group", (client) => client.groupMemberProfile(GROUP_ID, GROUP_ID)],
      ["leaving a user as a group", (client) => client.leaveGroup(MEIHUA)],
      ["leaving a group as a room", (client) => client.leaveRoom(GROUP_ID)],
      ["content of a non-decimal id", (client) => client.content("508667044176309088?x=1", 10)],
      ["a preview of an empty id", (client) => client.preview("", 10)],
      ["transcoding of a negative id", (client) => client.transcodingStatus("-1")],
    ];

    it.each(attempts)("%s", async (_name, attempt) => {
      const { client, requests } = clientWith(() => lineApiFixture("api-leave-200.json"));
      await expect(attempt(client)).rejects.toMatchObject({
        code: "invalid_request",
        retryable: false,
      });
      expect(requests).toHaveLength(0);
    });
  });
});
