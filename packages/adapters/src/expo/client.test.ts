import { ChannelSendError } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import {
  createExpoPushClient,
  EXPO_PUSH_ERROR_NAMES,
  EXPO_PUSH_RECEIPTS_LIMIT,
  EXPO_PUSH_RECEIPTS_PATH,
  EXPO_PUSH_SEND_LIMIT,
  EXPO_PUSH_SEND_PATH,
  type ExpoPushClient,
  type ExpoPushFailure,
  type ExpoPushMessage,
  ExpoPushRequestError,
  type ExpoPushTicket,
  expoPushErrorCode,
  expoRequestErrorCode,
} from "./client.ts";
import {
  bodyOf,
  createRecordingFetch,
  expoApiFixture,
  expoPushToken,
  type FixtureValues,
  fakeExpoPushService,
  type Responder,
  TEST_EXPO_ACCESS_TOKEN,
  ticketId,
} from "./testing.ts";

/** What a push says: a name and a time, which must never reach an error's text either. */
const WORDS = "It's been quiet at Meihua's today.";
const TOKENS = [1, 2, 3, 4, 5, 6].map((serial) => expoPushToken(`phone-${serial}`));
const TICKETS = [1, 2, 3, 4].map(ticketId);
const VALUES: FixtureValues = {
  tokens: TOKENS,
  tickets: TICKETS,
  accessToken: TEST_EXPO_ACCESS_TOKEN,
};

function messageTo(to: string, body = WORDS): ExpoPushMessage {
  return {
    to,
    body,
    data: { kind: "quiet_notice", family_id: "0198f6aa-0000-7000-8000-000000000001" },
    channelId: "quiet",
    priority: "high",
    interruptionLevel: "time-sensitive",
    sound: "default",
    ttl: 4 * 60 * 60,
  };
}

function clientWith(
  responder: Responder,
  options: { accessToken?: string | null; apiBaseUrl?: string; timeoutMs?: number } = {},
) {
  const recording = createRecordingFetch(responder);
  const client = createExpoPushClient({
    ...(options.accessToken === null
      ? {}
      : { accessToken: options.accessToken ?? TEST_EXPO_ACCESS_TOKEN }),
    fetch: recording.fetch,
    ...(options.apiBaseUrl === undefined ? {} : { apiBaseUrl: options.apiBaseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return { client, requests: recording.requests };
}

async function failureOf(
  attempt: (client: ExpoPushClient) => Promise<unknown>,
  responder: Responder,
): Promise<ExpoPushRequestError> {
  const { client } = clientWith(responder);
  const error = await attempt(client).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ExpoPushRequestError);
  expect(error).toBeInstanceOf(ChannelSendError);
  if (!(error instanceof ExpoPushRequestError)) throw new Error("not reached");
  return error;
}

/** No push token, no access token and nothing that was sent may reach a failure's text. */
function expectNothingPrivate(text: string): void {
  for (const secret of [...TOKENS, TEST_EXPO_ACCESS_TOKEN, WORDS]) {
    expect(text).not.toContain(secret);
  }
  expect(text).not.toMatch(/Expo(nent)?PushToken\[/);
}

function expectPrivateError(error: ExpoPushRequestError): void {
  expectNothingPrivate(error.message);
  expectNothingPrivate(error.stack ?? "");
  expectNothingPrivate(error.failure.message);
  expectNothingPrivate(error.failure.reason);
  expect(error.cause).toBeUndefined();
}

function failureOfTicket(ticket: ExpoPushTicket | undefined): ExpoPushFailure {
  if (ticket?.status !== "error")
    throw new Error(`expected a failed ticket, got ${ticket?.status}`);
  return ticket.failure;
}

const sendTwo = (client: ExpoPushClient) =>
  client.send([messageTo(TOKENS[0] ?? ""), messageTo(TOKENS[1] ?? "")]);

describe("createExpoPushClient", () => {
  it("refuses an access token that cannot go into a header", () => {
    for (const accessToken of ["", "with space", "line\nbreak", "naïve"]) {
      expect(() => createExpoPushClient({ accessToken }), JSON.stringify(accessToken)).toThrow(
        "Expo access token must be visible ASCII without spaces",
      );
    }
  });
});

describe("send", () => {
  it("posts the messages as one JSON array to Expo's send path, with the access token", async () => {
    const { client, requests } = clientWith(() => expoApiFixture("send-200-ok.json", VALUES));

    const tickets = await sendTwo(client);

    expect(tickets).toEqual([
      { status: "ok", id: TICKETS[0] },
      { status: "ok", id: TICKETS[1] },
    ]);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.host).toBe("exp.host");
    expect(request?.pathname).toBe(EXPO_PUSH_SEND_PATH);
    expect(request?.headers.get("authorization")).toBe(`Bearer ${TEST_EXPO_ACCESS_TOKEN}`);
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(request?.headers.get("accept")).toBe("application/json");
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(bodyOf(request)).toEqual([messageTo(TOKENS[0] ?? ""), messageTo(TOKENS[1] ?? "")]);
  });

  it("sends no authorization header without an access token, and takes another origin", async () => {
    const { client, requests } = clientWith(() => expoApiFixture("send-200-ok.json", VALUES), {
      accessToken: null,
      apiBaseUrl: "https://expo.fake.test/",
    });

    await sendTwo(client);

    expect(requests[0]?.headers.has("authorization")).toBe(false);
    expect(requests[0]?.host).toBe("expo.fake.test");
    expect(requests[0]?.pathname).toBe(EXPO_PUSH_SEND_PATH);
  });

  it("makes no request for no messages", async () => {
    const { client, requests } = clientWith(() => {
      throw new Error("no request expected");
    });

    expect(await client.send([])).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("sends at most 100 messages a request and answers the tickets in the order given", async () => {
    const service = fakeExpoPushService();
    const { client, requests } = clientWith(service.responder);
    const messages = Array.from({ length: 250 }, (_, index) =>
      messageTo(expoPushToken(`bulk-${index}`), `Message ${index}`),
    );

    const tickets = await client.send(messages);

    expect(EXPO_PUSH_SEND_LIMIT).toBe(100);
    expect(requests.map((request) => (bodyOf(request) as unknown[]).length)).toEqual([
      100, 100, 50,
    ]);
    expect(tickets).toEqual(
      Array.from({ length: 250 }, (_, index) => ({ status: "ok", id: ticketId(index + 1) })),
    );
    expect(service.accepted).toEqual(messages);
  });

  it("reads each failed ticket's details.error, never its message", async () => {
    const { client } = clientWith(() => expoApiFixture("send-200-mixed.json", VALUES));

    const tickets = await client.send(TOKENS.map((token) => messageTo(token)));

    expect(tickets[0]).toEqual({ status: "ok", id: TICKETS[0] });
    const failures = tickets.slice(1).map(failureOfTicket);
    expect(
      failures.map(({ code, misconfigured, reason }) => ({ code, misconfigured, reason })),
    ).toEqual([
      { code: "blocked", misconfigured: false, reason: "DeviceNotRegistered" },
      { code: "invalid_request", misconfigured: false, reason: "MessageTooBig" },
      { code: "rate_limited", misconfigured: false, reason: "MessageRateExceeded" },
      { code: "unknown", misconfigured: true, reason: "InvalidCredentials" },
      { code: "unknown", misconfigured: true, reason: "MismatchSenderId" },
    ]);
    for (const failure of failures) {
      expectNothingPrivate(failure.message);
      expect(failure.message).toMatch(/^expo push ticket: /);
    }
    expect(failures[0]?.message).toContain("[push token]");
  });

  it("names a failed ticket without details, or with a name it does not know, as unknown", async () => {
    const { client } = clientWith(() =>
      Response.json({
        data: [
          { status: "error", message: `Something went wrong for ${TOKENS[0]}` },
          { status: "error", message: "New", details: { error: "BrandNewError" } },
          { status: "error", message: "Odd", details: { error: `${TOKENS[1]}` } },
        ],
      }),
    );

    const tickets = await client.send(TOKENS.slice(0, 3).map((token) => messageTo(token)));

    expect(
      tickets
        .map(failureOfTicket)
        .map(({ code, misconfigured, reason }) => [code, misconfigured, reason]),
    ).toEqual([
      ["unknown", false, "unnamed_error"],
      ["unknown", false, "BrandNewError"],
      ["unknown", false, "unrecognised_error"],
    ]);
    for (const ticket of tickets) expectNothingPrivate(failureOfTicket(ticket).message);
  });

  it("refuses a message not addressed to a push token before any request", async () => {
    const { client, requests } = clientWith(() => {
      throw new Error("no request expected");
    });

    const error = await client.send([messageTo(TOKENS[0] ?? ""), messageTo("fcm:abc")]).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ExpoPushRequestError);
    expect(error).toMatchObject({
      code: "invalid_request",
      retryable: false,
      failure: { code: "invalid_request", misconfigured: false, reason: "not_a_push_token" },
    });
    expect(requests).toEqual([]);
  });

  it.each([
    [
      "send-400-too-many-experience-ids.json",
      "invalid_request",
      false,
      false,
      "PUSH_TOO_MANY_EXPERIENCE_IDS",
    ],
    ["send-401-unauthorized.json", "unknown", false, true, "UNAUTHORIZED"],
    ["send-403-no-code.json", "unknown", false, true, "http_403"],
    ["send-429-too-many-requests.json", "rate_limited", true, false, "TOO_MANY_REQUESTS"],
    ["send-500-internal.json", "unavailable", true, false, "INTERNAL_SERVER_ERROR"],
    ["send-502-html.json", "unavailable", true, false, "http_502"],
    ["send-200-errors.json", "invalid_request", false, false, "VALIDATION_ERROR"],
  ] as const)(
    "fails the whole send on %s as %s (retryable %s, misconfigured %s)",
    async (fixture, code, retryable, misconfigured, reason) => {
      const error = await failureOf(sendTwo, () => expoApiFixture(fixture, VALUES));

      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expect(error.failure).toMatchObject({ code, misconfigured, reason });
      expect(error.message).toBe(error.failure.message);
      expectPrivateError(error);
    },
  );

  it("says how long Expo asks it to wait", async () => {
    const error = await failureOf(sendTwo, () =>
      expoApiFixture("send-429-too-many-requests.json", VALUES),
    );

    expect(error.retryAfterSeconds).toBe(30);
  });

  it("fails as unavailable on a network error, without the error it caught", async () => {
    const error = await failureOf(sendTwo, () => {
      throw new TypeError(
        `connect failed for ${TOKENS[0]} with Bearer ${TEST_EXPO_ACCESS_TOKEN}: ${WORDS}`,
      );
    });

    expect(error.failure).toMatchObject({ code: "unavailable", reason: "network" });
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("TypeError");
    expectPrivateError(error);
  });

  it("fails as unavailable when Expo does not answer in time", async () => {
    const { client } = clientWith(
      (request) =>
        new Promise<Response>((_, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason));
        }),
      { timeoutMs: 20 },
    );

    const error = await client.send([messageTo(TOKENS[0] ?? "")]).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ExpoPushRequestError);
    expect(error).toMatchObject({
      code: "unavailable",
      failure: { reason: "timeout", message: "expo push send: timeout no answer within 0.02 s" },
    });
  });

  it.each([
    ["no JSON", () => new Response("OK", { status: 200 })],
    ["no data", () => Response.json({})],
    ["too few tickets", () => Response.json({ data: [{ status: "ok", id: "one" }] })],
    ["a ticket without an id", () => Response.json({ data: [{ status: "ok" }, { status: "ok" }] })],
    [
      "a ticket of no status",
      () => Response.json({ data: [{ id: "a" }, { status: "ok", id: "b" }] }),
    ],
  ])("never sends again what a 2xx it cannot read may have sent (%s)", async (_, answer) => {
    const error = await failureOf(sendTwo, answer);

    expect(error.failure).toMatchObject({ code: "unknown", reason: "unexpected_result" });
    expect(error.retryable).toBe(false);
  });

  it("keeps what Expo accepted when a later request fails, and fails the rest as tickets", async () => {
    let calls = 0;
    const service = fakeExpoPushService();
    const { client, requests } = clientWith((request) => {
      calls += 1;
      return calls === 1
        ? service.responder(request)
        : expoApiFixture("send-429-too-many-requests.json");
    });
    const messages = Array.from({ length: 150 }, (_, index) =>
      messageTo(expoPushToken(`later-${index}`)),
    );

    const tickets = await client.send(messages);

    expect(requests).toHaveLength(2);
    expect(tickets).toHaveLength(150);
    expect(tickets.slice(0, 100).every((ticket) => ticket.status === "ok")).toBe(true);
    const rest = tickets.slice(100).map(failureOfTicket);
    expect(rest.every((failure) => failure.code === "rate_limited")).toBe(true);
    expect(rest[0]?.reason).toBe("TOO_MANY_REQUESTS");
  });

  it("stops at the failing request and sends nothing after it", async () => {
    let calls = 0;
    const service = fakeExpoPushService();
    const { client, requests } = clientWith((request) => {
      calls += 1;
      return calls === 2 ? expoApiFixture("send-500-internal.json") : service.responder(request);
    });
    const messages = Array.from({ length: 250 }, (_, index) =>
      messageTo(expoPushToken(`stop-${index}`)),
    );

    const tickets = await client.send(messages);

    expect(requests).toHaveLength(2);
    expect(tickets.filter((ticket) => ticket.status === "ok")).toHaveLength(100);
    expect(
      tickets
        .slice(100)
        .map(failureOfTicket)
        .map((failure) => failure.reason),
    ).toEqual(Array.from({ length: 150 }, () => "INTERNAL_SERVER_ERROR"));
  });
});

describe("getReceipts", () => {
  it("asks for the ids and answers the receipts that are ready, read by details.error", async () => {
    const { client, requests } = clientWith(() => expoApiFixture("receipts-200.json", VALUES));
    const notReady = ticketId(99);

    const receipts = await client.getReceipts([...TICKETS, notReady]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe(EXPO_PUSH_RECEIPTS_PATH);
    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${TEST_EXPO_ACCESS_TOKEN}`);
    expect(bodyOf(requests[0])).toEqual({ ids: [...TICKETS, notReady] });
    expect(Object.keys(receipts).sort()).toEqual([...TICKETS].sort());
    expect(receipts[TICKETS[0] ?? ""]).toEqual({ status: "ok" });
    const failures = TICKETS.slice(1).map((id) => {
      const receipt = receipts[id];
      if (receipt?.status !== "error") throw new Error(`expected a failed receipt for ${id}`);
      return receipt.failure;
    });
    expect(
      failures.map(({ code, misconfigured, reason }) => ({ code, misconfigured, reason })),
    ).toEqual([
      { code: "blocked", misconfigured: false, reason: "DeviceNotRegistered" },
      { code: "unknown", misconfigured: true, reason: "InvalidCredentials" },
      { code: "rate_limited", misconfigured: false, reason: "MessageRateExceeded" },
    ]);
    for (const failure of failures) {
      expectNothingPrivate(failure.message);
      expect(failure.message).toMatch(/^expo push receipt: /);
    }
  });

  it("asks for at most 1,000 ids a request", async () => {
    const service = fakeExpoPushService();
    const { client, requests } = clientWith(service.responder);
    const ids = Array.from({ length: 2_500 }, (_, index) => ticketId(index + 1));
    service.receipt(ids[0] ?? "", { status: "ok" });
    service.receipt(ids[2_499] ?? "", { status: "error", error: "DeviceNotRegistered" });

    const receipts = await client.getReceipts(ids);

    expect(EXPO_PUSH_RECEIPTS_LIMIT).toBe(1_000);
    expect(requests.map((request) => (bodyOf(request) as { ids: string[] }).ids.length)).toEqual([
      1_000, 1_000, 500,
    ]);
    expect(Object.keys(receipts)).toEqual([ids[0], ids[2_499]]);
  });

  it("makes no request for no ids", async () => {
    const { client, requests } = clientWith(() => {
      throw new Error("no request expected");
    });

    expect(await client.getReceipts([])).toEqual({});
    expect(requests).toEqual([]);
  });

  it("ignores a receipt it did not ask for", async () => {
    const { client } = clientWith(() =>
      Response.json({ data: { [ticketId(1)]: { status: "ok" }, other: { status: "ok" } } }),
    );

    expect(await client.getReceipts([ticketId(1)])).toEqual({ [ticketId(1)]: { status: "ok" } });
  });

  it.each([
    ["send-401-unauthorized.json", "unknown", true],
    ["send-429-too-many-requests.json", "rate_limited", false],
    ["send-500-internal.json", "unavailable", false],
  ] as const)("throws on %s so the check is made again", async (fixture, code, misconfigured) => {
    const error = await failureOf(
      (client) => client.getReceipts([ticketId(1)]),
      () => expoApiFixture(fixture, VALUES),
    );

    expect(error.failure).toMatchObject({ code, misconfigured });
    expectPrivateError(error);
  });

  it("throws on an answer it cannot read", async () => {
    const error = await failureOf(
      (client) => client.getReceipts([ticketId(1)]),
      () => Response.json({ data: { [ticketId(1)]: { status: "maybe" } } }),
    );

    expect(error.failure).toMatchObject({ code: "unknown", reason: "unexpected_result" });
  });
});

describe("the error mapping", () => {
  it("maps every name Expo gives a ticket or a receipt", () => {
    expect(
      Object.fromEntries(EXPO_PUSH_ERROR_NAMES.map((name) => [name, expoPushErrorCode(name)])),
    ).toEqual({
      DeviceNotRegistered: { code: "blocked", misconfigured: false },
      MessageTooBig: { code: "invalid_request", misconfigured: false },
      MessageRateExceeded: { code: "rate_limited", misconfigured: false },
      MismatchSenderId: { code: "unknown", misconfigured: true },
      InvalidCredentials: { code: "unknown", misconfigured: true },
      DeveloperError: { code: "invalid_request", misconfigured: false },
      ExpoError: { code: "unavailable", misconfigured: false },
      ProviderError: { code: "unavailable", misconfigured: false },
    });
    expect(expoPushErrorCode(undefined)).toEqual({ code: "unknown", misconfigured: false });
  });

  it("maps a request's code first and its status otherwise", () => {
    expect(expoRequestErrorCode(400, "TOO_MANY_REQUESTS")).toEqual({
      code: "rate_limited",
      misconfigured: false,
    });
    expect(expoRequestErrorCode(400, "UNAUTHORIZED")).toEqual({
      code: "unknown",
      misconfigured: true,
    });
    expect(expoRequestErrorCode(500, "PUSH_TOO_MANY_EXPERIENCE_IDS")).toEqual({
      code: "invalid_request",
      misconfigured: false,
    });
    const byStatus = [429, 401, 403, 500, 503, 400, 404, 413, 302].map((status) => [
      status,
      expoRequestErrorCode(status, "SOMETHING_NEW"),
    ]);
    expect(byStatus).toEqual([
      [429, { code: "rate_limited", misconfigured: false }],
      [401, { code: "unknown", misconfigured: true }],
      [403, { code: "unknown", misconfigured: true }],
      [500, { code: "unavailable", misconfigured: false }],
      [503, { code: "unavailable", misconfigured: false }],
      [400, { code: "invalid_request", misconfigured: false }],
      [404, { code: "invalid_request", misconfigured: false }],
      [413, { code: "invalid_request", misconfigured: false }],
      [302, { code: "unknown", misconfigured: false }],
    ]);
  });

  it("retries what can pass and never what cannot", () => {
    const retryable = (code: Parameters<typeof expoPushErrorCode>[0]) =>
      new ChannelSendError(expoPushErrorCode(code).code, "x").retryable;
    expect(retryable("MessageRateExceeded")).toBe(true);
    expect(retryable("ProviderError")).toBe(true);
    expect(retryable("DeviceNotRegistered")).toBe(false);
    expect(retryable("InvalidCredentials")).toBe(false);
    expect(retryable("MessageTooBig")).toBe(false);
  });
});

describe("redaction", () => {
  // Every fixture that fails, filled with this test's tokens, the access token, and the words sent.
  it.each([
    "send-400-too-many-experience-ids.json",
    "send-401-unauthorized.json",
    "send-200-errors.json",
    "send-429-too-many-requests.json",
  ])("keeps every token and the words sent out of %s's error", async (fixture) => {
    const error = await failureOf(sendTwo, () => expoApiFixture(fixture, VALUES));

    expectPrivateError(error);
    expect(error.message).toMatch(/^expo push send: /);
  });

  it("keeps the access token out when Expo echoes it", async () => {
    const error = await failureOf(sendTwo, () =>
      expoApiFixture("send-401-unauthorized.json", VALUES),
    );

    expect(error.message).toContain("[access token]");
    expect(error.message).not.toContain(TEST_EXPO_ACCESS_TOKEN);
  });

  it("keeps a token cut short out, and the words of what was sent", async () => {
    const cut = (TOKENS[0] ?? "").slice(0, -4);
    const { client } = clientWith(() =>
      Response.json({
        data: [
          {
            status: "error",
            message: `${cut} could not deliver "${WORDS}"`,
            details: { error: "ProviderError" },
          },
          { status: "ok", id: "b" },
        ],
      }),
    );

    const [first] = await sendTwo(client);

    const failure = failureOfTicket(first);
    expectNothingPrivate(failure.message);
    expect(failure.message).not.toContain(cut);
  });
});
