import type {
  ApiComposedAsk,
  ApiCreatedFamily,
  ApiErrorBody,
  ApiExchangePage,
  ApiFamily,
  ApiFamilyPlan,
  ApiLeft,
  ApiMe,
  ApiMemberPause,
  ApiPushDevice,
  ApiQuietNotice,
  ApiQuietState,
  ApiReply,
  ApiToday,
  ApiTrial,
  MemberLight,
} from "@vela/contracts";
import type { Member, VelaDatabase } from "@vela/db";
import {
  AlreadyOrganiserError,
  ApiIdempotencyError,
  AskDayTakenError,
  LookInRefusedError,
  MemberChangeRefusedError,
  NearbyInviteRefusedError,
  NearbyRefusedError,
  QuietUsefulRefusedError,
  ReplyRefusedError,
  type SessionIdentity,
  TrialRefusedError,
  VelaError,
} from "@vela/services";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApiReadServices, type ApiRuntime, createApiApp } from "./api-app.ts";
import { SessionVerificationUnavailable } from "./session.ts";

const USER_ID = "11111111-1111-7111-8111-111111111111";
const MEMBER_ID = "22222222-2222-7222-8222-222222222222";
const FAMILY_ID = "33333333-3333-7333-8333-333333333333";
const IDENTITY: SessionIdentity = { authSubject: "verified-user", sessionId: "verified-session" };
const PLAN_PATH = `/v1/families/${FAMILY_ID}/plan`;
const LIGHTS_PATH = `/v1/families/${FAMILY_ID}/lights`;
const TODAY_PATH = `/v1/families/${FAMILY_ID}/today`;
const WEEKLY_READ_PATH = `/v1/families/${FAMILY_ID}/weekly-read?member=${MEMBER_ID}`;
const PRECISION_PATH = `/v1/families/${FAMILY_ID}/precision`;
/** What the account service answers; the route adds `photos` and `push`, the API's own. */
const ME: Omit<ApiMe, "photos" | "push"> = {
  user: { id: USER_ID, display_name: "Synthetic user", language: "en", tz: "Asia/Taipei" },
  memberships: [
    {
      member_id: MEMBER_ID,
      role: "member",
      status: "active",
      family: { id: FAMILY_ID, name: "Synthetic family", region: "apac", plan: "light" },
    },
  ],
  one_moment_a_day: true,
};
/** What `GET /v1/me` answers from `ME` on a runtime that keeps no photos and sends no pushes. */
const ME_BODY: ApiMe = { ...ME, photos: false, push: false };
const PLAN: ApiFamilyPlan = {
  family_id: FAMILY_ID,
  plan: "light",
  subscriptions: [
    {
      member_id: MEMBER_ID,
      status: "trial",
      trial_ends_at: "2026-09-14T00:00:00.000Z",
      current_period_end: null,
      grace_until: null,
    },
  ],
};
const LIGHTS: MemberLight[] = [
  {
    member_id: MEMBER_ID,
    display_name: "Synthetic member",
    state: "lit",
    answered_at: "2026-09-22T00:12:00.000Z",
    usual_time: "08:00",
    away_until: null,
    away_id: null,
    unreachable_on: null,
    quiet_event_id: null,
  },
];
const FAMILY_PATH = `/v1/families/${FAMILY_ID}`;
const FAMILY: ApiFamily = {
  family: { id: FAMILY_ID, name: "Synthetic family", plan: "free" },
  me: { member_id: MEMBER_ID, role: "organiser" },
  members: [
    {
      member_id: MEMBER_ID,
      display_name: "Synthetic member",
      role: "member",
      status: "active",
      light: "on",
      subscription: null,
    },
  ],
  nearby: [],
  told_if_quiet: { telegram: true, app: false },
};
const TODAY: ApiToday = {
  lights: LIGHTS,
  exchanges: [
    {
      id: "44444444-4444-7444-8444-444444444444",
      recipient_id: MEMBER_ID,
      recipient_name: "Synthetic member",
      asker_name: "Synthetic user",
      on_behalf_of: null,
      type: "question",
      ask: "What did the garden look like this morning?",
      answer: {
        kind: "text",
        text: "The tomatoes finally turned.",
        at: "2026-09-22T00:12:00.000Z",
        picked_media_id: null,
        picked_number: null,
        translation: null,
      },
      replies: [{ from: "Synthetic user", kind: "heart", text: null, photo: null }],
      seen_at: null,
      replies_reach_her: true,
      photos: [],
    },
  ],
  tomorrow: [],
};
const LISTED = TODAY.exchanges[0];
if (LISTED === undefined) throw new Error("the Today fixture needs an exchange");
const EXCHANGE_PAGE: ApiExchangePage = {
  exchanges: [
    {
      ...LISTED,
      scheduled_for: "2026-09-22",
      delivered_at: "2026-09-22T00:00:00.000Z",
    },
  ],
  next_cursor: null,
};
const CREATED: ApiCreatedFamily = {
  family: { id: FAMILY_ID, name: "Synthetic user", region: "apac", country: "TW" },
  organiser_member_id: USER_ID,
  kept_light_member: {
    id: MEMBER_ID,
    display_name: "Synthetic member",
    status: "invited",
    arrival_time: "08:00",
  },
  invite: {
    url: "https://t.me/VelaTestBot?start=fixture-token",
    expires_at: "2026-09-29T00:00:00.000Z",
    text: "Hello",
  },
};
const NEW_FAMILY = {
  country: "TW",
  kept_light_member: {
    display_name: "Synthetic member",
    address_form: "Mrs Chen",
    language: "en",
    tz: "Asia/Taipei",
    wake_time: "07:30",
  },
};
const TRIAL: ApiTrial = {
  member_id: MEMBER_ID,
  status: "trial",
  trial_ends_at: "2026-10-22T00:00:00.000Z",
};
const PAUSED: ApiMemberPause = { member_id: MEMBER_ID, status: "paused" };
const LEFT: ApiLeft = { member_id: MEMBER_ID, left_at: "2026-09-22T00:00:00.000Z" };
const QUIET_ID = "88888888-8888-7888-8888-888888888888";
const QUIET_STATE: ApiQuietState = {
  quiet_event_id: QUIET_ID,
  member_id: MEMBER_ID,
  member_name: "Synthetic member",
  delivered_at: "2026-09-22T00:00:00.000Z",
  repeated_at: null,
  usual_time: null,
  last_answered_at: null,
  opened_at: "2026-09-22T03:00:00.000Z",
  wait_until: null,
  resolved: { outcome: "fine_known", at: "2026-09-22T04:00:00.000Z", by_name: "Synthetic user" },
  useful: null,
};
const QUIET_NOTICE: ApiQuietNotice = {
  ...QUIET_STATE,
  resolved: null,
  contacts: [
    {
      id: MEMBER_ID,
      name: "Lena",
      relation: "neighbour",
      phone: "+886 2 1234 5678",
      can_ask: false,
      asked: null,
    },
  ],
};
const EXCHANGE_ID = "66666666-6666-7666-8666-666666666666";
const REPLIES_PATH = `/v1/exchanges/${EXCHANGE_ID}/replies`;
const REPLY: ApiReply = {
  id: "77777777-7777-7777-8777-777777777777",
  exchange_id: EXCHANGE_ID,
  from: "Synthetic user",
  kind: "text",
  text: "Those are the seeds you saved",
  created_at: "2026-09-22T00:00:00.000Z",
  reaches_her: true,
};
const EXCHANGES_PATH = `/v1/families/${FAMILY_ID}/exchanges`;
const COMPOSED: ApiComposedAsk = {
  id: "55555555-5555-7555-8555-555555555555",
  family_id: FAMILY_ID,
  recipient_id: MEMBER_ID,
  recipient_name: "Synthetic member",
  asker_name: "Synthetic user",
  on_behalf_of: null,
  type: "question",
  ask: "What did the garden look like this morning?",
  when_rule: "tomorrow",
  scheduled_for: "2026-09-23",
  state: "composed",
};
const INSTALLATION_ID = "99999999-9999-7999-8999-999999999999";
const PUSH_DEVICE: ApiPushDevice = {
  installation_id: INSTALLATION_ID,
  platform: "android",
  permission: "granted",
  quiet_channel_blocked: false,
  registered_at: "2026-09-22T00:00:00.000Z",
};
const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };
const CONTACT_ID = "44444444-4444-7444-8444-444444444444";
const DEVICE_TOKEN = "d".repeat(43);
const PRIVACY = {
  en: "https://vela.test/privacy",
  "zh-TW": "https://vela.test/privacy/zh-TW",
  ja: "https://vela.test/privacy",
  de: "https://vela.test/privacy",
  hi: "https://vela.test/privacy",
  ru: "https://vela.test/privacy",
};
const NEARBY_CONTACT = {
  id: CONTACT_ID,
  near_member_id: MEMBER_ID,
  name: "Lena",
  relation: "neighbour",
  consent: "waiting",
};
const PRECISION = {
  family: [
    {
      month: "2026-09",
      notices: 2,
      open: 0,
      outcomes: { answered_late: 1, away: 1, fine_known: 0, true_concern: 0, unknown: 0 },
      useful: { yes: 1, no: 1 },
    },
  ],
  vela: [],
  vela_minimum: { notices: 10, families: 3 },
};
const WEEKLY_READ = {
  member_id: MEMBER_ID,
  display_name: "Mom",
  locked: true,
  read: null,
};
const FAMILY_NOT_FOUND = { error: { code: "not_found", message: "Family not found." } };
const INTERNAL = { error: { code: "internal", message: "Internal server error." } };
const UNAVAILABLE = {
  error: { code: "unavailable", message: "Service temporarily unavailable." },
};

function database(): VelaDatabase {
  return {} as VelaDatabase;
}

function fixture(enableWrites = false, push?: boolean) {
  const db = database();
  const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const verifySession = vi.fn<ApiRuntime["verifySession"]>().mockResolvedValue(IDENTITY);
  const openDatabase = vi.fn<ApiRuntime["openDatabase"]>().mockResolvedValue({ db, close });
  const services = {
    loadApiMe: vi.fn<ApiReadServices["loadApiMe"]>().mockResolvedValue(ME),
    loadApiFamilyPlan: vi.fn<ApiReadServices["loadApiFamilyPlan"]>().mockResolvedValue(PLAN),
    loadApiLights: vi.fn<ApiReadServices["loadApiLights"]>().mockResolvedValue(LIGHTS),
    loadApiToday: vi.fn<ApiReadServices["loadApiToday"]>().mockResolvedValue(TODAY),
    loadApiFamily: vi.fn<ApiReadServices["loadApiFamily"]>().mockResolvedValue(FAMILY),
    loadApiBook: vi
      .fn<ApiReadServices["loadApiBook"]>()
      .mockResolvedValue({ entries: [], coming: [], recipes: [] }),
    loadApiReminders: vi
      .fn<ApiReadServices["loadApiReminders"]>()
      .mockResolvedValue({ suggestions: [], reminders: [] }),
    loadApiExchange: vi.fn<ApiReadServices["loadApiExchange"]>().mockResolvedValue(null),
    loadApiExchanges: vi.fn<ApiReadServices["loadApiExchanges"]>().mockResolvedValue(EXCHANGE_PAGE),
    loadApiQuiet: vi.fn<ApiReadServices["loadApiQuiet"]>().mockResolvedValue(QUIET_NOTICE),
    loadApiWeeklyRead: vi.fn<ApiReadServices["loadApiWeeklyRead"]>().mockResolvedValue(WEEKLY_READ),
    loadApiPrecision: vi.fn<ApiReadServices["loadApiPrecision"]>().mockResolvedValue(PRECISION),
    memberOfDeviceToken: vi.fn<ApiReadServices["memberOfDeviceToken"]>().mockResolvedValue(null),
    loadDeviceMessages: vi.fn<ApiReadServices["loadDeviceMessages"]>().mockResolvedValue([]),
    readDeviceMedia: vi.fn<ApiReadServices["readDeviceMedia"]>().mockResolvedValue(null),
    authorizeFamilyAccess: vi.fn<ApiReadServices["authorizeFamilyAccess"]>().mockResolvedValue({
      kind: "granted",
      access: { userId: USER_ID, memberId: MEMBER_ID, familyId: FAMILY_ID, role: "member" },
    }),
    // Photos have their own tests (api-media.test.ts); here they are never reached.
    readApiMedia: vi
      .fn<ApiReadServices["readApiMedia"]>()
      .mockRejectedValue(new Error("no photo read in these tests")),
  };
  const logger = { error: vi.fn<ApiRuntime["logger"]["error"]>() };
  const writes = {
    verifyActiveSession: vi
      .fn<NonNullable<ApiRuntime["writes"]>["verifyActiveSession"]>()
      .mockResolvedValue(true),
    clock: { now: () => new Date("2026-09-22T00:00:00.000Z") },
    services: {
      provisionApiAccount: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["provisionApiAccount"]>()
        .mockResolvedValue({ response: { status: 200, body: ME.user }, replayed: false }),
      updateApiAccount: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["updateApiAccount"]>()
        .mockResolvedValue({ response: { status: 200, body: ME.user }, replayed: false }),
      composeApiAsk: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["composeApiAsk"]>()
        .mockResolvedValue({
          response: { status: 201, body: COMPOSED },
          replayed: false,
          after: { outboundIds: ["group-row"], wakeMemberIds: [] },
        }),
      replyToApiExchange: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["replyToApiExchange"]>()
        .mockResolvedValue({ response: { status: 201, body: REPLY }, replayed: false }),
      createApiFamily: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["createApiFamily"]>()
        .mockResolvedValue({ response: { status: 201, body: CREATED }, replayed: false }),
      pauseApiMember: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["pauseApiMember"]>()
        .mockResolvedValue({ response: { status: 200, body: PAUSED }, replayed: false }),
      setUpApiDevice: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["setUpApiDevice"]>()
        .mockResolvedValue({
          body: { member_id: MEMBER_ID, token: DEVICE_TOKEN },
          after: { outboundIds: [], wakeMemberIds: [] },
        }),
      removeApiDevice: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["removeApiDevice"]>()
        .mockResolvedValue({
          response: { status: 200, body: { member_id: MEMBER_ID, removed: true } },
          replayed: false,
        }),
      startApiTrial: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["startApiTrial"]>()
        .mockResolvedValue({ response: { status: 200, body: TRIAL }, replayed: false }),
      addApiNearby: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["addApiNearby"]>()
        .mockResolvedValue({ response: { status: 201, body: NEARBY_CONTACT }, replayed: false }),
      removeApiNearby: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["removeApiNearby"]>()
        .mockResolvedValue({
          response: { status: 200, body: { id: CONTACT_ID, removed: true } },
          replayed: false,
        }),
      setApiAway: vi.fn().mockRejectedValue(new Error("no away in these tests")),
      markApiDeceased: vi.fn().mockRejectedValue(new Error("no deceased in these tests")),
      endApiAway: vi.fn().mockRejectedValue(new Error("no away in these tests")),
      leaveApiFamily: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["leaveApiFamily"]>()
        .mockResolvedValue({
          response: { status: 200, body: LEFT },
          replayed: false,
          after: { outboundIds: [], wakeMemberIds: [] },
        }),
      resolveApiQuiet: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["resolveApiQuiet"]>()
        .mockResolvedValue({
          response: { status: 200, body: QUIET_STATE },
          replayed: false,
          after: { outboundIds: ["row-1"], wakeMemberIds: [] },
        }),
      uploadApiMedia: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["uploadApiMedia"]>()
        .mockRejectedValue(new Error("no photo upload in these tests")),
      uploadApiVoice: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["uploadApiVoice"]>()
        .mockRejectedValue(new Error("no voice upload in these tests")),
      createApiReminder: vi.fn().mockRejectedValue(new Error("no reminders in these tests")),
      finishApiReminder: vi.fn().mockRejectedValue(new Error("no reminders in these tests")),
      removeApiBookEntry: vi
        .fn()
        .mockResolvedValue({ response: { status: 200, body: { removed: true } }, replayed: false }),
      askApiToLookIn: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["askApiToLookIn"]>()
        .mockResolvedValue({
          response: {
            status: 201,
            body: {
              quiet_event_id: QUIET_ID,
              contact_id: MEMBER_ID,
              asked_at: "2026-09-22T03:10:00.000Z",
              reply: null,
            },
          },
          replayed: false,
          after: { outboundIds: ["row-ask"], wakeMemberIds: [] },
        }),
      markApiQuietUseful: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["markApiQuietUseful"]>()
        .mockResolvedValue({
          response: { status: 200, body: { ...QUIET_STATE, useful: true } },
          replayed: false,
        }),
      inviteApiNearby: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["inviteApiNearby"]>()
        .mockResolvedValue({
          contact_id: MEMBER_ID,
          link: "https://t.me/vela_test_bot?start=nTOKEN",
        }),
      registerApiPushDevice: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["registerApiPushDevice"]>()
        .mockResolvedValue({
          response: { status: 200, body: PUSH_DEVICE },
          replayed: false,
          after: { outboundIds: [], wakeMemberIds: [] },
        }),
      removeApiPushDevice: vi
        .fn<NonNullable<ApiRuntime["writes"]>["services"]["removeApiPushDevice"]>()
        .mockResolvedValue({
          response: { status: 200, body: { installation_id: INSTALLATION_ID, removed: true } },
          replayed: false,
          after: { outboundIds: [], wakeMemberIds: [] },
        }),
    },
    nudges: {
      deliver: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
      wake: vi.fn<(id: string, at: Date) => Promise<void>>().mockResolvedValue(undefined),
    },
    devices: { random: { token: () => DEVICE_TOKEN }, config: { privacyNoticeUrls: PRIVACY } },
    families: {
      random: { token: () => "fixture-token" },
      config: { telegramBotUsername: "VelaTestBot", regions: ["apac"] as const },
    },
  };
  const runtime: ApiRuntime = {
    verifySession,
    now: () => new Date("2026-09-22T00:00:00.000Z"),
    openDatabase,
    services,
    logger,
    ...(enableWrites ? { writes } : {}),
    ...(push === undefined ? {} : { push }),
  };
  return {
    app: createApiApp(runtime),
    db,
    close,
    verifySession,
    openDatabase,
    services,
    logger,
    writes,
  };
}

async function expectResponse(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual(body);
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isolated API read routes", () => {
  it.each(["/v1/me", PLAN_PATH])("authenticates %s before opening a database", async (path) => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    const response = await f.app.request(path, {
      headers: { authorization: "Bearer invalid.secret.token", "x-user-id": USER_ID },
    });

    await expectResponse(response, 401, {
      error: { code: "unauthenticated", message: "Sign in required." },
    });
    expect(f.verifySession).toHaveBeenCalledOnce();
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
    expect(f.services.loadApiMe).not.toHaveBeenCalled();
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it.each(["/v1/me", PLAN_PATH])(
    "maps a session outage on %s before database creation",
    async (path) => {
      const f = fixture();
      f.verifySession.mockRejectedValue(new SessionVerificationUnavailable());

      await expectResponse(await f.app.request(path), 503, UNAVAILABLE);
      expect(f.openDatabase).not.toHaveBeenCalled();
      expect(f.close).not.toHaveBeenCalled();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
        error: "SessionVerificationUnavailable",
      });
    },
  );

  it("passes only the verified identity to the me service", async () => {
    const f = fixture();
    const request = new Request("https://api.test/v1/me?userId=forged&authSubject=forged", {
      headers: {
        authorization: "Bearer signed.token.value",
        "x-user-id": "forged",
        "x-role": "organiser",
      },
    });

    await expectResponse(await f.app.request(request), 200, ME_BODY);
    expect(f.verifySession).toHaveBeenCalledExactlyOnceWith(request);
    expect(f.openDatabase).toHaveBeenCalledExactlyOnceWith();
    expect(f.services.loadApiMe).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY);
    expect(f.services.loadApiMe.mock.calls[0]?.[1]).toBe(IDENTITY);
    expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledExactlyOnceWith();
  });

  // ADR-34: the app says its notifications are not sent yet while the switch is off.
  it.each([
    [undefined, false],
    [false, false],
    [true, true],
  ] as const)("says whether pushes are sent here (push %s)", async (push, sent) => {
    const f = fixture(false, push);
    const response = await f.app.request("/v1/me", { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 200, { ...ME_BODY, push: sent });
  });

  it("authorizes and reads the path family with the signed identity, not forged request claims", async () => {
    const f = fixture();
    const response = await f.app.request(
      `${PLAN_PATH}?familyId=forged-family&userId=forged-user&authSubject=forged&role=organiser&requiredRole=organiser`,
      {
        headers: {
          "x-family-id": "forged-family",
          "x-user-id": "forged-user",
          "x-auth-subject": "forged-subject",
          "x-session-id": "forged-session",
          "x-role": "organiser",
        },
      },
    );

    await expectResponse(response, 200, PLAN);
    expect(f.services.authorizeFamilyAccess).toHaveBeenCalledExactlyOnceWith(
      f.db,
      IDENTITY,
      FAMILY_ID,
      undefined,
    );
    expect(f.services.loadApiFamilyPlan).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY, FAMILY_ID);
    expect(f.services.loadApiFamilyPlan.mock.calls[0]?.[1]).toBe(IDENTITY);
    expect(f.openDatabase).toHaveBeenCalledExactlyOnceWith();
    expect(f.close).toHaveBeenCalledExactlyOnceWith();
    expect(f.services.loadApiMe).not.toHaveBeenCalled();
  });

  it.each(["/v1/me", PLAN_PATH])("does not consult request JSON for GET %s", async (path) => {
    const f = fixture();
    const request = new Request(`https://api.test${path}`);
    const readJson = vi.spyOn(request, "json").mockResolvedValue({
      authSubject: "forged-user",
      session: { authSubject: "forged-user", sessionId: "forged-session" },
      userId: "forged-user-id",
      familyId: "forged-family",
      role: "organiser",
    });

    await expectResponse(await f.app.request(request), 200, path === "/v1/me" ? ME_BODY : PLAN);
    expect(readJson).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    if (path === "/v1/me") {
      expect(f.services.loadApiMe).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY);
    } else {
      expect(f.services.authorizeFamilyAccess).toHaveBeenCalledExactlyOnceWith(
        f.db,
        IDENTITY,
        FAMILY_ID,
        undefined,
      );
      expect(f.services.loadApiFamilyPlan).toHaveBeenCalledExactlyOnceWith(
        f.db,
        IDENTITY,
        FAMILY_ID,
      );
    }
    expect(f.close).toHaveBeenCalledOnce();
  });

  it.each(["not_found", "forbidden"] as const)(
    "a %s family guard skips the read and closes its handle",
    async (kind) => {
      const f = fixture();
      f.services.authorizeFamilyAccess.mockResolvedValue({ kind });

      await expectResponse(
        await f.app.request(PLAN_PATH),
        kind === "not_found" ? 404 : 403,
        kind === "not_found"
          ? FAMILY_NOT_FOUND
          : { error: { code: "forbidden", message: "Access denied." } },
      );
      expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
      expect(f.openDatabase).toHaveBeenCalledOnce();
      expect(f.close).toHaveBeenCalledOnce();
    },
  );

  it("returns the same not-found body when membership is revoked after the guard", async () => {
    const f = fixture();
    f.services.authorizeFamilyAccess.mockResolvedValueOnce({ kind: "not_found" });
    const denied = await f.app.request(PLAN_PATH);
    f.services.loadApiFamilyPlan.mockResolvedValue(null);
    const revoked = await f.app.request(PLAN_PATH);

    await expectResponse(denied, 404, FAMILY_NOT_FOUND);
    await expectResponse(revoked, 404, FAMILY_NOT_FOUND);
    expect(f.services.loadApiFamilyPlan).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY, FAMILY_ID);
    expect(f.openDatabase).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalledTimes(2);
  });

  it("lets the family service refuse malformed IDs without attempting a read", async () => {
    const f = fixture();
    f.services.authorizeFamilyAccess.mockResolvedValue({ kind: "not_found" });

    await expectResponse(
      await f.app.request("/v1/families/not-a-uuid/plan"),
      404,
      FAMILY_NOT_FOUND,
    );
    expect(f.services.authorizeFamilyAccess).toHaveBeenCalledExactlyOnceWith(
      f.db,
      IDENTITY,
      "not-a-uuid",
      undefined,
    );
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("returns not found for an unprovisioned user without provisioning on GET", async () => {
    const f = fixture();
    f.services.loadApiMe.mockResolvedValue(null);

    await expectResponse(await f.app.request("/v1/me"), 404, NOT_FOUND);
    expect(f.services.loadApiMe).toHaveBeenCalledExactlyOnceWith(f.db, IDENTITY);
    expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("projects me fields at every DTO level", async () => {
    const f = fixture();
    const membership = ME.memberships[0];
    if (!membership) throw new Error("Missing synthetic membership");
    const privateResult = {
      ...ME,
      authSubject: "private-subject",
      user: { ...ME.user, authSubject: "private-subject", phone: "+15550000000" },
      memberships: [
        { ...membership, billing: true, family: { ...membership.family, internal: "private" } },
      ],
    };
    f.services.loadApiMe.mockResolvedValue(privateResult);

    await expectResponse(await f.app.request("/v1/me"), 200, ME_BODY);
    expect(f.close).toHaveBeenCalledOnce();
  });

  it("projects plan and subscription fields without billing identifiers", async () => {
    const f = fixture();
    const subscription = PLAN.subscriptions[0];
    if (!subscription) throw new Error("Missing synthetic subscription");
    const privateResult = {
      ...PLAN,
      billing_customer_id: "private-customer",
      subscriptions: [
        {
          ...subscription,
          billing_subscription_id: "private-subscription",
          phone: "+15550000000",
          internal: "private",
        },
      ],
    };
    f.services.loadApiFamilyPlan.mockResolvedValue(privateResult);

    await expectResponse(await f.app.request(PLAN_PATH), 200, PLAN);
    expect(f.close).toHaveBeenCalledOnce();
  });

  it.each(["/v1/me", PLAN_PATH])(
    "treats invalid service output on %s as a server error, not a client error",
    async (path) => {
      const f = fixture();
      f.services.loadApiMe.mockResolvedValue({ ...ME, user: { ...ME.user, id: "invalid" } });
      f.services.loadApiFamilyPlan.mockResolvedValue({ ...PLAN, family_id: "invalid" });

      await expectResponse(await f.app.request(path), 500, INTERNAL);
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
        error: "ZodError",
      });
    },
  );

  it.each(["verify", "open", "authorize", "me", "plan"] as const)(
    "sanitizes %s failures and closes exactly once if opened",
    async (stage) => {
      const f = fixture();
      const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );
      const secret = "secret.token.private-family-prose";
      const error = new Error(`Failed request ${PLAN_PATH} ${secret}`, {
        cause: new Error(secret),
      });
      const fail = {
        verify: f.verifySession,
        open: f.openDatabase,
        authorize: f.services.authorizeFamilyAccess,
        me: f.services.loadApiMe,
        plan: f.services.loadApiFamilyPlan,
      }[stage];
      fail.mockRejectedValue(error);
      const path = stage === "me" ? "/v1/me" : PLAN_PATH;

      await expectResponse(
        await f.app.request(`${path}?private=${secret}`, {
          headers: { authorization: `Bearer ${secret}`, "x-private": secret },
        }),
        500,
        INTERNAL,
      );
      expect(f.close).toHaveBeenCalledTimes(stage === "verify" || stage === "open" ? 0 : 1);
      expect(f.openDatabase).toHaveBeenCalledTimes(stage === "verify" ? 0 : 1);
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
        error: "Error <- Error",
      });
      const logs = JSON.stringify(f.logger.error.mock.calls);
      expect(logs).not.toContain(secret);
      expect(logs).not.toContain(path);
      for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["success", 200, ME_BODY],
    ["not_found", 404, NOT_FOUND],
    ["denied", 404, FAMILY_NOT_FOUND],
    ["internal", 500, INTERNAL],
    ["unavailable", 503, UNAVAILABLE],
  ] as const)(
    "logs a cleanup failure without changing the original %s response",
    async (outcome, status, body) => {
      const f = fixture();
      f.close.mockRejectedValue(new Error("private cleanup detail"));
      if (outcome === "not_found") f.services.loadApiMe.mockResolvedValue(null);
      if (outcome === "denied")
        f.services.authorizeFamilyAccess.mockResolvedValue({ kind: "not_found" });
      if (outcome === "internal")
        f.services.loadApiMe.mockRejectedValue(new Error("private query detail"));
      if (outcome === "unavailable")
        f.services.loadApiMe.mockRejectedValue(new SessionVerificationUnavailable());
      const response = await f.app.request(outcome === "denied" ? PLAN_PATH : "/v1/me");
      await expectResponse(response, status, body);
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.logger.error).toHaveBeenCalledWith("api_database_close_failed", { error: "Error" });
      expect(f.logger.error).toHaveBeenCalledTimes(
        outcome === "internal" || outcome === "unavailable" ? 2 : 1,
      );
      expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain("private");
    },
  );

  it("awaits closing the handle before resolving the response", async () => {
    const f = fixture();
    const closing = deferred();
    const release = deferred();
    f.close.mockImplementation(async () => {
      closing.resolve();
      await release.promise;
    });
    let settled = false;
    const response = Promise.resolve(f.app.request("/v1/me")).then((value) => {
      settled = true;
      return value;
    });
    await closing.promise;
    expect(settled).toBe(false);
    release.resolve();

    await expectResponse(await response, 200, ME_BODY);
    expect(f.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["GET", "/"],
    ["GET", "/v1/unknown"],
    ["GET", "/v1/families"],
    ["DELETE", "/v1/families/id"],
    ["GET", "/v1/families/id/plan/extra"],
    ["POST", "/v1/me"],
    ["POST", "/v1/me/provision"],
    ["PATCH", "/v1/me"],
    ["PUT", "/v1/me"],
    ["PATCH", PLAN_PATH],
    ["DELETE", PLAN_PATH],
    ["OPTIONS", PLAN_PATH],
    ["POST", "/v1/users"],
    ["POST", "/v1/families"],
  ])("does not authenticate or open a database for unsupported %s %s", async (method, path) => {
    const f = fixture();
    const response = await f.app.request(path, {
      method,
      ...(method === "GET"
        ? {}
        : {
            headers: { "content-type": "application/json", "x-role": "organiser" },
            body: JSON.stringify({
              userId: USER_ID,
              authSubject: "forged",
              familyId: FAMILY_ID,
              role: "organiser",
            }),
          }),
    });

    await expectResponse(response, 404, NOT_FOUND);
    expect(f.verifySession).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.services.loadApiMe).not.toHaveBeenCalled();
    expect(f.services.loadApiFamilyPlan).not.toHaveBeenCalled();
    expect(f.services.authorizeFamilyAccess).not.toHaveBeenCalled();
  });

  it.each(["/v1/me", PLAN_PATH])(
    "rejects HEAD %s without Hono's implicit GET opening a database",
    async (path) => {
      const f = fixture();
      const response = await f.app.request(path, { method: "HEAD" });

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
      expect(f.verifySession).not.toHaveBeenCalled();
      expect(f.openDatabase).not.toHaveBeenCalled();
    },
  );

  it("keeps concurrent family requests on independent handles and verified identities", async () => {
    const f = fixture();
    const otherDb = database();
    const otherClose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const otherIdentity: SessionIdentity = {
      authSubject: "other-verified-user",
      sessionId: "other-session",
    };
    const otherFamily = "44444444-4444-7444-8444-444444444444";
    const firstAuthorized = deferred();
    const releaseFirst = deferred();
    f.verifySession.mockResolvedValueOnce(IDENTITY).mockResolvedValueOnce(otherIdentity);
    f.openDatabase
      .mockResolvedValueOnce({ db: f.db, close: f.close })
      .mockResolvedValueOnce({ db: otherDb, close: otherClose });
    f.services.authorizeFamilyAccess.mockImplementation(async (db, identity, familyId) => {
      if (identity === IDENTITY) {
        expect(db).toBe(f.db);
        firstAuthorized.resolve();
        await releaseFirst.promise;
      } else {
        expect(db).toBe(otherDb);
      }
      return {
        kind: "granted",
        access: { userId: USER_ID, memberId: MEMBER_ID, familyId, role: "member" },
      };
    });
    f.services.loadApiFamilyPlan.mockImplementation(async (db, identity, familyId) => {
      expect(db).toBe(identity === IDENTITY ? f.db : otherDb);
      return { ...PLAN, family_id: familyId };
    });
    const firstResponse = f.app.request(PLAN_PATH);
    await firstAuthorized.promise;
    await expectResponse(await f.app.request(`/v1/families/${otherFamily}/plan`), 200, {
      ...PLAN,
      family_id: otherFamily,
    });
    expect(otherClose).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    releaseFirst.resolve();
    await expectResponse(await firstResponse, 200, PLAN);

    expect(f.services.authorizeFamilyAccess).toHaveBeenNthCalledWith(
      1,
      f.db,
      IDENTITY,
      FAMILY_ID,
      undefined,
    );
    expect(f.services.authorizeFamilyAccess).toHaveBeenNthCalledWith(
      2,
      otherDb,
      otherIdentity,
      otherFamily,
      undefined,
    );
    expect(f.services.loadApiFamilyPlan).toHaveBeenNthCalledWith(
      1,
      otherDb,
      otherIdentity,
      otherFamily,
    );
    expect(f.services.loadApiFamilyPlan).toHaveBeenNthCalledWith(2, f.db, IDENTITY, FAMILY_ID);
    expect(f.openDatabase).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalledOnce();
    expect(otherClose).toHaveBeenCalledOnce();
  });
});

const PROFILE = { display_name: "Synthetic user", language: "en", tz: "Asia/Taipei" };
const INVALID = { error: { code: "invalid", message: "Invalid request." } };
const CONFLICT = {
  error: { code: "conflict", message: "Request conflicts with an earlier operation." },
};
const UNAUTHENTICATED = { error: { code: "unauthenticated", message: "Sign in required." } };
const WRITE_ROUTES = [
  ["POST", "/v1/me/provision", "provisionApiAccount"],
  ["PATCH", "/v1/me", "updateApiAccount"],
] as const;

function writeRequest(
  method = "POST",
  path = "/v1/me/provision",
  body: BodyInit | null = JSON.stringify(PROFILE),
  headers: Record<string, string> = {},
) {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": "request-1", ...headers },
    body,
  });
}

function expectNoWrite(f: ReturnType<typeof fixture>) {
  expect(f.writes.verifyActiveSession).not.toHaveBeenCalled();
  expect(f.openDatabase).not.toHaveBeenCalled();
  expect(f.close).not.toHaveBeenCalled();
  expect(f.writes.services.provisionApiAccount).not.toHaveBeenCalled();
  expect(f.writes.services.updateApiAccount).not.toHaveBeenCalled();
  expect(f.logger.error).not.toHaveBeenCalled();
}

function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });
  return { request: writeRequest("POST", "/v1/me/provision", body, headers), body, cancel };
}

describe("isolated API account writes", () => {
  it.each(WRITE_ROUTES)(
    "dispatches %s %s with only verified actor and parsed input",
    async (method, path, service) => {
      const f = fixture(true);
      const request = writeRequest(
        method,
        `${path}?authSubject=forged&userId=forged`,
        JSON.stringify({ ...PROFILE, display_name: "  Synthetic user  " }),
        {
          "x-user-id": "forged",
          "x-session-id": "forged",
          "x-role": "organiser",
          "content-type": 'Application/JSON; charset="UTF-8"',
          "content-encoding": "identity",
        },
      );
      const json = vi.spyOn(request, "json");
      const text = vi.spyOn(request, "text");
      const response = await f.app.request(request);
      await expectResponse(response, 200, ME.user);
      expect(response.headers.get("idempotency-replayed")).toBe("false");
      expect(f.verifySession).toHaveBeenCalledExactlyOnceWith(request);
      expect(f.writes.verifyActiveSession).toHaveBeenCalledExactlyOnceWith(IDENTITY);
      expect(f.writes.services[service]).toHaveBeenCalledExactlyOnceWith(
        { db: f.db, clock: f.writes.clock },
        IDENTITY,
        "request-1",
        PROFILE,
      );
      expect(f.writes.services[service].mock.calls[0]?.[1]).toBe(IDENTITY);
      expect(f.verifySession.mock.invocationCallOrder[0]).toBeLessThan(
        f.writes.verifyActiveSession.mock.invocationCallOrder[0] ?? 0,
      );
      expect(f.writes.verifyActiveSession.mock.invocationCallOrder[0]).toBeLessThan(
        f.openDatabase.mock.invocationCallOrder[0] ?? 0,
      );
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.services.loadApiMe).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
    },
  );

  it.each(WRITE_ROUTES)("authenticates before validating %s %s", async (method, path) => {
    const f = fixture(true);
    f.verifySession.mockResolvedValue(null);
    await expectResponse(
      await f.app.request(
        writeRequest(method, path, "private invalid json", {
          "idempotency-key": "",
          "content-type": "text/plain",
        }),
      ),
      401,
      UNAUTHENTICATED,
    );
    expectNoWrite(f);
  });

  it.each([
    "id",
    "user_id",
    "userId",
    "authSubject",
    "sessionId",
    "role",
    "member_id",
    "member",
    "family_id",
    "family",
    "email",
    "phone",
    "invite_token",
  ])("rejects unknown %s before liveness or database", async (field) => {
    for (const [method, path] of WRITE_ROUTES) {
      const f = fixture(true);
      await expectResponse(
        await f.app.request(
          writeRequest(method, path, JSON.stringify({ ...PROFILE, [field]: "private" })),
        ),
        400,
        INVALID,
      );
      expectNoWrite(f);
    }
  });

  it.each([
    null,
    "",
    "{",
    "null",
    "[]",
    "42",
    '"private"',
    "{}",
    '{"display_name":""}',
    '{"tz":"not-a-zone"}',
  ])("rejects malformed or invalid body %s", async (body) => {
    for (const [method, path] of WRITE_ROUTES) {
      const f = fixture(true);
      await expectResponse(await f.app.request(writeRequest(method, path, body)), 400, INVALID);
      expectNoWrite(f);
    }
  });

  it.each([undefined, "", "private/key", "two,keys", "has space", "x".repeat(201)])(
    "rejects missing or invalid key %s",
    async (key) => {
      const f = fixture(true);
      const request = writeRequest();
      if (key === undefined) request.headers.delete("idempotency-key");
      else request.headers.set("idempotency-key", key);
      await expectResponse(await f.app.request(request), 400, INVALID);
      expectNoWrite(f);
    },
  );

  it.each([
    undefined,
    "text/plain",
    "application/problem+json",
    "application/json; charset=iso-8859-1",
    "application/json; charset=utf-16",
    "application/json; charset=utf-8; charset=utf-16",
    "application/json; private=secret",
  ])("rejects unsupported media type %s", async (type) => {
    const f = fixture(true);
    const request = writeRequest();
    if (type === undefined) request.headers.delete("content-type");
    else request.headers.set("content-type", type);
    await expectResponse(await f.app.request(request), 415, INVALID);
    expectNoWrite(f);
  });

  it.each(["gzip", "br", "deflate", "identity, gzip", ""])(
    "rejects content encoding %s",
    async (encoding) => {
      const f = fixture(true);
      await expectResponse(
        await f.app.request(
          writeRequest("POST", "/v1/me/provision", JSON.stringify(PROFILE), {
            "content-encoding": encoding,
          }),
        ),
        415,
        INVALID,
      );
      expectNoWrite(f);
    },
  );

  it("rejects an oversized declared length without reading", async () => {
    const f = fixture(true);
    const request = writeRequest("POST", "/v1/me/provision", JSON.stringify(PROFILE), {
      "content-length": "4097",
    });
    const read = vi.spyOn(request.body as ReadableStream, "getReader");
    await expectResponse(await f.app.request(request), 413, INVALID);
    expect(read).not.toHaveBeenCalled();
    expectNoWrite(f);
  });

  it.each([{}, { "content-length": "1" }] as Record<string, string>[])(
    "enforces actual UTF-8 bytes for streamed bodies with headers %j",
    async (headers) => {
      const f = fixture(true);
      const encoder = new TextEncoder();
      const { request, body, cancel } = streamedRequest(
        [
          encoder.encode('{"display_name":"'),
          encoder.encode("界".repeat(1400)),
          encoder.encode('"}'),
        ],
        headers,
      );
      await expectResponse(await f.app.request(request), 413, INVALID);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expectNoWrite(f);
    },
  );

  it("accepts exactly 4096 streamed bytes including split multibyte characters", async () => {
    const f = fixture(true);
    const input = JSON.stringify({ ...PROFILE, display_name: "界" });
    const bytes = new TextEncoder().encode(input);
    const padded = new Uint8Array(4096).fill(32);
    padded.set(bytes);
    const { request, body } = streamedRequest(Array.from(padded, (byte) => new Uint8Array([byte])));
    await expectResponse(await f.app.request(request), 200, ME.user);
    expect(body.locked).toBe(false);
    expect(f.writes.services.provisionApiAccount.mock.calls[0]?.[3]).toEqual({
      ...PROFILE,
      display_name: "界",
    });
  });

  it.each([[0xc3, 0x28], [0xff], [0xe2, 0x82]])("rejects invalid UTF-8 %j", async (...bytes) => {
    const f = fixture(true);
    const { request, body } = streamedRequest([
      new TextEncoder().encode('{"display_name":"'),
      new Uint8Array(bytes),
      new TextEncoder().encode('","language":"en","tz":"Asia/Taipei"}'),
    ]);
    await expectResponse(await f.app.request(request), 400, INVALID);
    expect(body.locked).toBe(false);
    expectNoWrite(f);
  });

  it("does not wait for a stalled overflow cancellation", async () => {
    const f = fixture(true);
    const cancellation = deferred();
    const cancel = vi.fn(() => cancellation.promise);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel,
    });
    try {
      await expectResponse(
        await f.app.request(writeRequest("POST", "/v1/me/provision", body)),
        413,
        INVALID,
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expectNoWrite(f);
    } finally {
      cancellation.resolve();
    }
  });

  it("sanitizes stream read errors and releases the reader", async () => {
    const f = fixture(true);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("private stream error"));
      },
    });
    await expectResponse(
      await f.app.request(writeRequest("POST", "/v1/me/provision", body)),
      400,
      INVALID,
    );
    expect(body.locked).toBe(false);
    expectNoWrite(f);
  });

  it("bounds empty chunk reader work and cancels", async () => {
    const f = fixture(true);
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) =>
      controller.enqueue(new Uint8Array()),
    );
    const body = new ReadableStream<Uint8Array>({ pull, cancel });
    await expectResponse(
      await f.app.request(writeRequest("POST", "/v1/me/provision", body)),
      400,
      INVALID,
    );
    expect(pull.mock.calls.length).toBeLessThanOrEqual(4098);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expectNoWrite(f);
  });

  it("requires an explicit true from the activity checker", async () => {
    for (const value of [null, undefined, "active", "false", 1, {}]) {
      const f = fixture(true);
      f.writes.verifyActiveSession.mockResolvedValue(value as unknown as boolean);
      await expectResponse(await f.app.request(writeRequest()), 401, UNAUTHENTICATED);
      expect(f.openDatabase).not.toHaveBeenCalled();
      expect(f.writes.services.provisionApiAccount).not.toHaveBeenCalled();
    }
  });

  it("times out a stalled JSON body without checking activity or opening a database", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(true);
      const waiting = deferred();
      const cancel = vi.fn();
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new TextEncoder().encode(JSON.stringify(PROFILE)));
          } else waiting.resolve();
        },
        cancel,
      });
      const response = Promise.resolve(
        f.app.request(writeRequest("POST", "/v1/me/provision", body)),
      );
      await waiting.promise;
      await vi.advanceTimersByTimeAsync(10_001);
      await expectResponse(await response, 408, INVALID);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expectNoWrite(f);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs cancellation failures without exposing input or changing rejection", async () => {
    const f = fixture(true);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel() {
        throw new Error("private cancellation detail");
      },
    });
    await expectResponse(
      await f.app.request(writeRequest("POST", "/v1/me/provision", body)),
      413,
      INVALID,
    );
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_body_cancel_failed", {
      error: "Error",
    });
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.writes.verifyActiveSession).not.toHaveBeenCalled();
  });

  it.each(WRITE_ROUTES)(
    "checks activity before %s %s including replay",
    async (method, path, service) => {
      const f = fixture(true);
      f.writes.services[service].mockResolvedValue({
        response: { status: 200, body: ME.user },
        replayed: true,
      });
      const replay = await f.app.request(writeRequest(method, path));
      await expectResponse(replay, 200, ME.user);
      expect(replay.headers.get("idempotency-replayed")).toBe("true");
      f.writes.verifyActiveSession.mockResolvedValue(false);
      const denied = await f.app.request(writeRequest(method, path));
      await expectResponse(denied, 401, UNAUTHENTICATED);
      expect(denied.headers.has("idempotency-replayed")).toBe(false);
      expect(f.writes.verifyActiveSession).toHaveBeenCalledTimes(2);
      expect(f.openDatabase).toHaveBeenCalledOnce();
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.writes.services[service]).toHaveBeenCalledOnce();
    },
  );

  it.each(["verify", "open"] as const)(
    "sanitizes write %s failures without closing an unowned handle",
    async (stage) => {
      const f = fixture(true);
      const fail = stage === "verify" ? f.verifySession : f.openDatabase;
      fail.mockRejectedValue(new Error("private.token.key.body"));
      await expectResponse(await f.app.request(writeRequest()), 500, INTERNAL);
      expect(f.close).not.toHaveBeenCalled();
      expect(f.openDatabase).toHaveBeenCalledTimes(stage === "verify" ? 0 : 1);
      expect(f.writes.verifyActiveSession).toHaveBeenCalledTimes(stage === "verify" ? 0 : 1);
      expect(f.writes.services.provisionApiAccount).not.toHaveBeenCalled();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
        error: "Error",
      });
    },
  );

  it("maps online outage before database creation", async () => {
    const f = fixture(true);
    f.writes.verifyActiveSession.mockRejectedValue(new SessionVerificationUnavailable());
    await expectResponse(await f.app.request(writeRequest()), 503, UNAVAILABLE);
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_request_failed", {
      error: "SessionVerificationUnavailable",
    });
  });

  it.each([
    [new ApiIdempotencyError("invalid"), 400, INVALID],
    [new ApiIdempotencyError("conflict"), 409, CONFLICT],
    [new ApiIdempotencyError("unavailable"), 503, UNAVAILABLE],
    [
      new ApiIdempotencyError("rate_limited"),
      429,
      { error: { code: "rate_limited", message: "Too many requests." } },
    ],
    [new VelaError("not_found", "private deleted account"), 404, NOT_FOUND],
    [new VelaError("invalid_payload", "private invalid profile"), 400, INVALID],
    [new Error("private database problem"), 500, INTERNAL],
  ] as const)("maps expected failures safely: %s", async (error, status, body) => {
    for (const [method, path, service] of WRITE_ROUTES) {
      const f = fixture(true);
      f.writes.services[service].mockRejectedValue(error);
      const response = await f.app.request(writeRequest(method, path));
      await expectResponse(response, status, body);
      expect(response.headers.has("idempotency-replayed")).toBe(false);
      expect(f.close).toHaveBeenCalledOnce();
      if (status < 500) expect(f.logger.error).not.toHaveBeenCalled();
      expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain("private");
    }
  });

  it.each([
    { response: { status: 201, body: ME.user }, replayed: false },
    { response: { status: 200, body: { ...ME.user, id: "bad" } }, replayed: false },
    { response: { status: 200, body: ME.user }, replayed: "true" },
    { response: { status: 200, body: ME.user } },
  ])("treats invalid service results as server failures: %j", async (result) => {
    const f = fixture(true);
    f.writes.services.provisionApiAccount.mockResolvedValue(
      result as Awaited<ReturnType<typeof f.writes.services.provisionApiAccount>>,
    );
    const response = await f.app.request(writeRequest());
    await expectResponse(response, 500, INTERNAL);
    expect(response.headers.has("idempotency-replayed")).toBe(false);
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.logger.error).toHaveBeenCalledOnce();
  });

  it("projects the user and preserves formatting on write results", async () => {
    const f = fixture(true);
    const user = {
      ...ME.user,
      display_name: "  User formatting  ",
      phone: "private",
      authSubject: "private",
    };
    f.writes.services.updateApiAccount.mockResolvedValue({
      response: { status: 200, body: user },
      replayed: false,
    });
    await expectResponse(
      await f.app.request(writeRequest("PATCH", "/v1/me", '{"language":"en"}')),
      200,
      { ...ME.user, display_name: "  User formatting  " },
    );
    expect(f.writes.services.updateApiAccount.mock.calls[0]?.[3]).toEqual({ language: "en" });
  });

  it.each([false, true])(
    "awaits cleanup without overriding write outcome (failure=%s)",
    async (failure) => {
      const f = fixture(true);
      const closing = deferred();
      const release = deferred();
      f.close.mockImplementation(async () => {
        closing.resolve();
        await release.promise;
        throw new Error("private cleanup");
      });
      if (failure)
        f.writes.services.provisionApiAccount.mockRejectedValue(
          new ApiIdempotencyError("conflict"),
        );
      let settled = false;
      const pending = Promise.resolve(f.app.request(writeRequest())).then((response) => {
        settled = true;
        return response;
      });
      await closing.promise;
      expect(settled).toBe(false);
      release.resolve();
      await expectResponse(await pending, failure ? 409 : 200, failure ? CONFLICT : ME.user);
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.logger.error).toHaveBeenCalledExactlyOnceWith("api_database_close_failed", {
        error: "Error",
      });
    },
  );

  it.each([
    ["POST", "/v1/me"],
    ["DELETE", "/v1/me"],
    ["PUT", "/v1/me"],
    ["POST", "/v1/me/link"],
    ["POST", "/v1/link"],
    ["PUT", "/v1/families"],
    ["PATCH", PLAN_PATH],
    ["GET", "/v1/me/provision"],
    ["PATCH", "/v1/me/provision"],
  ])("does not dispatch unsupported %s %s", async (method, path) => {
    const f = fixture(true);
    await expectResponse(await f.app.request(path, { method }), 404, NOT_FOUND);
    expect(f.verifySession).not.toHaveBeenCalled();
    expectNoWrite(f);
  });

  it.each(["/v1/me", "/v1/me/provision", PLAN_PATH])(
    "rejects HEAD %s with writes enabled",
    async (path) => {
      const f = fixture(true);
      const response = await f.app.request(path, { method: "HEAD" });
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
      expect(f.verifySession).not.toHaveBeenCalled();
      expectNoWrite(f);
    },
  );

  it("keeps existing GETs read-only when writes are configured", async () => {
    const f = fixture(true);
    await expectResponse(await f.app.request("/v1/me"), 200, ME_BODY);
    await expectResponse(await f.app.request(PLAN_PATH), 200, PLAN);
    expect(f.writes.verifyActiveSession).not.toHaveBeenCalled();
    expect(f.writes.services.provisionApiAccount).not.toHaveBeenCalled();
    expect(f.writes.services.updateApiAccount).not.toHaveBeenCalled();
  });

  it("isolates concurrent write bodies, keys, identities, and handles", async () => {
    const f = fixture(true);
    const otherDb = database();
    const otherClose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const otherIdentity = { authSubject: "other", sessionId: "other-session" };
    const started = deferred();
    const release = deferred();
    f.verifySession.mockResolvedValueOnce(IDENTITY).mockResolvedValueOnce(otherIdentity);
    f.openDatabase
      .mockResolvedValueOnce({ db: f.db, close: f.close })
      .mockResolvedValueOnce({ db: otherDb, close: otherClose });
    f.writes.services.updateApiAccount.mockImplementation(async () => {
      started.resolve();
      await release.promise;
      return { response: { status: 200, body: ME.user }, replayed: false };
    });
    const first = f.app.request(
      writeRequest("PATCH", "/v1/me", '{"display_name":"First"}', {
        "idempotency-key": "first-key",
      }),
    );
    await started.promise;
    await expectResponse(
      await f.app.request(
        writeRequest(
          "POST",
          "/v1/me/provision",
          JSON.stringify({ ...PROFILE, display_name: "Second" }),
          { "idempotency-key": "second-key" },
        ),
      ),
      200,
      ME.user,
    );
    expect(otherClose).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    release.resolve();
    await expectResponse(await first, 200, ME.user);
    expect(f.writes.services.updateApiAccount).toHaveBeenCalledExactlyOnceWith(
      { db: f.db, clock: f.writes.clock },
      IDENTITY,
      "first-key",
      { display_name: "First" },
    );
    expect(f.writes.services.provisionApiAccount).toHaveBeenCalledExactlyOnceWith(
      { db: otherDb, clock: f.writes.clock },
      otherIdentity,
      "second-key",
      { ...PROFILE, display_name: "Second" },
    );
    expect(f.writes.verifyActiveSession).toHaveBeenNthCalledWith(1, IDENTITY);
    expect(f.writes.verifyActiveSession).toHaveBeenNthCalledWith(2, otherIdentity);
    expect(f.close).toHaveBeenCalledOnce();
  });
});

describe("the lights of a family", () => {
  it("answers the kept lights to a member of that family", async () => {
    const { app, services } = fixture();
    const response = await app.request(LIGHTS_PATH, { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 200, LIGHTS);
    expect(services.loadApiLights).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      new Date("2026-09-22T00:00:00.000Z"),
    );
  });

  it("answers not found when the family is not the caller's", async () => {
    const { app, services } = fixture();
    services.loadApiLights.mockResolvedValue(null);
    const response = await app.request(LIGHTS_PATH, { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 404, FAMILY_NOT_FOUND);
  });

  it("refuses a request without a verified session before reading anything", async () => {
    const f = fixture();
    const { app, services, openDatabase } = f;
    f.verifySession.mockResolvedValue(null);
    const response = await app.request(LIGHTS_PATH, { headers: { authorization: "Bearer bad" } });
    expect(response.status).toBe(401);
    expect(services.loadApiLights).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });
});

describe("how Vela is doing", () => {
  it("answers the family's and Vela's notices to an organiser, asking the guard for an organiser", async () => {
    const f = fixture();
    await expectResponse(
      await f.app.request(PRECISION_PATH, { headers: { authorization: "Bearer good" } }),
      200,
      PRECISION,
    );
    expect(f.services.authorizeFamilyAccess).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      "organiser",
    );
    expect(f.services.loadApiPrecision).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      new Date("2026-09-22T00:00:00.000Z"),
    );
  });

  it.each(["not_found", "forbidden"] as const)("a %s family guard skips the read", async (kind) => {
    const f = fixture();
    f.services.authorizeFamilyAccess.mockResolvedValue({ kind });
    await expectResponse(
      await f.app.request(PRECISION_PATH, { headers: { authorization: "Bearer good" } }),
      kind === "not_found" ? 404 : 403,
      kind === "not_found"
        ? FAMILY_NOT_FOUND
        : { error: { code: "forbidden", message: "Access denied." } },
    );
    expect(f.services.loadApiPrecision).not.toHaveBeenCalled();
  });

  it("answers not found when the service finds nothing to answer", async () => {
    const f = fixture();
    f.services.loadApiPrecision.mockResolvedValue(null);
    await expectResponse(
      await f.app.request(PRECISION_PATH, { headers: { authorization: "Bearer good" } }),
      404,
      NOT_FOUND,
    );
  });

  it("refuses a request without a verified session before reading anything", async () => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    const response = await f.app.request(PRECISION_PATH, {
      headers: { authorization: "Bearer bad" },
    });
    expect(response.status).toBe(401);
    expect(f.services.loadApiPrecision).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});

describe("the weekly read", () => {
  it("answers her latest read to an organiser, asking the guard for an organiser", async () => {
    const f = fixture();
    const response = await f.app.request(WEEKLY_READ_PATH, {
      headers: { authorization: "Bearer good" },
    });
    await expectResponse(response, 200, WEEKLY_READ);
    expect(f.services.authorizeFamilyAccess).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      "organiser",
    );
    expect(f.services.loadApiWeeklyRead).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      MEMBER_ID,
      new Date("2026-09-22T00:00:00.000Z"),
    );
  });

  it.each(["not_found", "forbidden"] as const)("a %s family guard skips the read", async (kind) => {
    const f = fixture();
    f.services.authorizeFamilyAccess.mockResolvedValue({ kind });
    await expectResponse(
      await f.app.request(WEEKLY_READ_PATH, { headers: { authorization: "Bearer good" } }),
      kind === "not_found" ? 404 : 403,
      kind === "not_found"
        ? FAMILY_NOT_FOUND
        : { error: { code: "forbidden", message: "Access denied." } },
    );
    expect(f.services.loadApiWeeklyRead).not.toHaveBeenCalled();
  });

  it("answers not found for a member who is not hers to read", async () => {
    const f = fixture();
    f.services.loadApiWeeklyRead.mockResolvedValue(null);
    await expectResponse(
      await f.app.request(WEEKLY_READ_PATH, { headers: { authorization: "Bearer good" } }),
      404,
      NOT_FOUND,
    );
  });

  it("refuses a request without a verified session before reading anything", async () => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    const response = await f.app.request(WEEKLY_READ_PATH, {
      headers: { authorization: "Bearer bad" },
    });
    expect(response.status).toBe(401);
    expect(f.services.loadApiWeeklyRead).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});

describe("the Today screen", () => {
  it("answers the day to a member of that family, in that family's own hour", async () => {
    const { app, services } = fixture();
    const response = await app.request(TODAY_PATH, { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 200, TODAY);
    expect(services.loadApiToday).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      new Date("2026-09-22T00:00:00.000Z"),
    );
  });

  it("answers not found when the family is not the caller's", async () => {
    const { app, services } = fixture();
    services.loadApiToday.mockResolvedValue(null);
    const response = await app.request(TODAY_PATH, { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 404, FAMILY_NOT_FOUND);
  });

  it("refuses a request without a verified session before reading anything", async () => {
    const f = fixture();
    const { app, services, openDatabase } = f;
    f.verifySession.mockResolvedValue(null);
    const response = await app.request(TODAY_PATH, { headers: { authorization: "Bearer bad" } });
    expect(response.status).toBe(401);
    expect(services.loadApiToday).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });
});

describe("the family", () => {
  it("answers the family to one of its members, through the family check", async () => {
    const { app, services } = fixture();
    const response = await app.request(FAMILY_PATH, { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 200, FAMILY);
    expect(services.loadApiFamily).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      false,
    );
    expect(services.authorizeFamilyAccess).toHaveBeenCalled();
  });

  // ADR-34: a phone counts toward how an organiser is told only where pushes are sent.
  it.each([
    [undefined, false],
    [false, false],
    [true, true],
  ] as const)("tells the family read whether pushes are sent here (push %s)", async (push, on) => {
    const { app, services } = fixture(false, push);
    await app.request(FAMILY_PATH, { headers: { authorization: "Bearer good" } });
    expect(services.loadApiFamily).toHaveBeenCalledWith(expect.anything(), IDENTITY, FAMILY_ID, on);
  });

  it("answers not found when the family is not the caller's", async () => {
    const { app, services } = fixture();
    services.loadApiFamily.mockResolvedValue(null);
    const response = await app.request(FAMILY_PATH, { headers: { authorization: "Bearer good" } });
    await expectResponse(response, 404, FAMILY_NOT_FOUND);
  });

  it("refuses a request without a verified session before reading anything", async () => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    const response = await f.app.request(FAMILY_PATH, {
      headers: { authorization: "Bearer bad" },
    });
    expect(response.status).toBe(401);
    expect(f.services.loadApiFamily).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});

const ASK = {
  recipient_id: MEMBER_ID,
  type: "question",
  text: "What did the garden look like this morning?",
  when: "tomorrow",
};

function composeRequest(body: unknown = ASK, headers: Record<string, string> = {}) {
  return writeRequest("POST", EXCHANGES_PATH, JSON.stringify(body), headers);
}

describe("composing an ask", () => {
  it("dispatches the family's own id, the verified actor and the key, and answers 201", async () => {
    const { app, writes, services } = fixture(true);
    const response = await app.request(composeRequest(undefined, { authorization: "Bearer good" }));
    expect(response.status).toBe(201);
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(COMPOSED);
    expect(writes.services.composeApiAsk).toHaveBeenCalledWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      FAMILY_ID,
      ASK,
    );
    expect(services.authorizeFamilyAccess).toHaveBeenCalled();
  });

  it("hands compose the suggestion the ask started from", async () => {
    const { app, writes } = fixture(true);
    const fromSuggestion = { ...ASK, suggestion_id: "99999999-9999-7999-8999-999999999999" };
    const response = await app.request(
      composeRequest(fromSuggestion, { authorization: "Bearer good" }),
    );
    expect(response.status).toBe(201);
    expect(writes.services.composeApiAsk).toHaveBeenCalledWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      FAMILY_ID,
      fromSuggestion,
    );
  });

  it("answers 404 without composing when the family is not the caller's", async () => {
    const { app, writes, services } = fixture(true);
    services.authorizeFamilyAccess.mockResolvedValue({ kind: "not_found" });
    const response = await app.request(composeRequest(undefined, { authorization: "Bearer good" }));
    await expectResponse(response, 404, FAMILY_NOT_FOUND);
    expect(writes.services.composeApiAsk).not.toHaveBeenCalled();
  });

  it("answers 409 with who holds the day and the one to offer instead", async () => {
    const { app, writes } = fixture(true);
    writes.services.composeApiAsk.mockRejectedValue(
      new AskDayTakenError({ taken_by: "Anna", date_alternative: "2026-09-24" }),
    );
    const response = await app.request(composeRequest(undefined, { authorization: "Bearer good" }));
    await expectResponse(response, 409, {
      error: {
        code: "conflict",
        message: "That day already has an ask.",
        details: { taken_by: "Anna", date_alternative: "2026-09-24" },
      },
    });
  });

  it("refuses a body the contract would not accept, before any database is opened", async () => {
    for (const body of [
      { ...ASK, text: "" },
      { ...ASK, type: "voice_note" },
      { ...ASK, when: "date" },
      { ...ASK, extra: "field" },
      { ...ASK, suggestion_id: "not-a-uuid" },
      { ...ASK, suggestion_id: null },
      {},
    ]) {
      const f = fixture(true);
      const response = await f.app.request(composeRequest(body, { authorization: "Bearer good" }));
      await expectResponse(response, 400, INVALID);
      expect(f.writes.services.composeApiAsk).not.toHaveBeenCalled();
      expect(f.openDatabase).not.toHaveBeenCalled();
    }
  });

  it("refuses a request with no idempotency key, and one whose session is not live", async () => {
    const withoutKey = fixture(true);
    const noKey = await withoutKey.app.request(
      new Request(`https://api.test${EXCHANGES_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer good" },
        body: JSON.stringify(ASK),
      }),
    );
    await expectResponse(noKey, 400, INVALID);
    expect(withoutKey.writes.services.composeApiAsk).not.toHaveBeenCalled();

    const stale = fixture(true);
    stale.writes.verifyActiveSession.mockResolvedValue(false);
    const response = await stale.app.request(
      composeRequest(undefined, { authorization: "Bearer good" }),
    );
    expect(response.status).toBe(401);
    expect(stale.writes.services.composeApiAsk).not.toHaveBeenCalled();
    expect(stale.openDatabase).not.toHaveBeenCalled();
  });

  it("is not there at all when the runtime has no write capability", async () => {
    const { app, services } = fixture();
    const response = await app.request(composeRequest(undefined, { authorization: "Bearer good" }));
    await expectResponse(response, 404, NOT_FOUND);
    expect(services.authorizeFamilyAccess).not.toHaveBeenCalled();
  });

  it("hands the family group's line to the queue once the ask is written", async () => {
    const { app, writes } = fixture(true);
    const response = await app.request(composeRequest(undefined, { authorization: "Bearer good" }));
    expect(response.status).toBe(201);
    expect(writes.nudges.deliver).toHaveBeenCalledWith("group-row");
  });

  it("marks a replayed compose so the screen knows nothing new was written", async () => {
    const { app, writes } = fixture(true);
    writes.services.composeApiAsk.mockResolvedValue({
      response: { status: 201, body: COMPOSED },
      replayed: true,
      after: { outboundIds: [], wakeMemberIds: [] },
    });
    const response = await app.request(composeRequest(undefined, { authorization: "Bearer good" }));
    expect(response.status).toBe(201);
    expect(response.headers.get("idempotency-replayed")).toBe("true");
  });
});

describe("the Exchanges list", () => {
  it("answers the page to a member of that family, passing the query through", async () => {
    const { app, services } = fixture();
    const response = await app.request(`${EXCHANGES_PATH}?cursor=abc&limit=5`, {
      headers: { authorization: "Bearer good" },
    });
    await expectResponse(response, 200, EXCHANGE_PAGE);
    expect(services.loadApiExchanges).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      new Date("2026-09-22T00:00:00.000Z"),
      { cursor: "abc", limit: 5 },
    );
  });

  it("leaves a nonsense limit to the service's own default", async () => {
    for (const limit of ["0", "-3", "abc", "1.5"]) {
      const { app, services } = fixture();
      await app.request(`${EXCHANGES_PATH}?limit=${limit}`, {
        headers: { authorization: "Bearer good" },
      });
      expect(services.loadApiExchanges, limit).toHaveBeenCalledWith(
        expect.anything(),
        IDENTITY,
        FAMILY_ID,
        expect.anything(),
        { cursor: undefined },
      );
    }
  });

  it("answers not found when the family is not the caller's", async () => {
    const { app, services } = fixture();
    services.loadApiExchanges.mockResolvedValue(null);
    const response = await app.request(EXCHANGES_PATH, {
      headers: { authorization: "Bearer good" },
    });
    await expectResponse(response, 404, FAMILY_NOT_FOUND);
  });

  it("is served without the write capability, unlike composing", async () => {
    const { app } = fixture();
    const read = await app.request(EXCHANGES_PATH, { headers: { authorization: "Bearer good" } });
    expect(read.status).toBe(200);
    const write = await app.request(composeRequest(undefined, { authorization: "Bearer good" }));
    expect(write.status).toBe(404);
  });

  it("refuses a request without a verified session before reading anything", async () => {
    const f = fixture();
    f.verifySession.mockResolvedValue(null);
    const response = await f.app.request(EXCHANGES_PATH, {
      headers: { authorization: "Bearer bad" },
    });
    expect(response.status).toBe(401);
    expect(f.services.loadApiExchanges).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});

function replyRequest(body: unknown = { text: "Those are the seeds you saved" }) {
  return writeRequest("POST", REPLIES_PATH, JSON.stringify(body), { authorization: "Bearer good" });
}

describe("replying to an exchange", () => {
  it("dispatches the exchange from the path, the verified actor and the key, and answers 201", async () => {
    const { app, writes, services } = fixture(true);
    const response = await app.request(replyRequest());
    expect(response.status).toBe(201);
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(REPLY);
    expect(writes.services.replyToApiExchange).toHaveBeenCalledWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      EXCHANGE_ID,
      { text: "Those are the seeds you saved" },
    );
    // The path has no family, so no family middleware runs: the service authorizes by exchange.
    expect(services.authorizeFamilyAccess).not.toHaveBeenCalled();
  });

  it("answers 404 when the service cannot find the exchange for this caller", async () => {
    const { app, writes } = fixture(true);
    writes.services.replyToApiExchange.mockRejectedValue(
      new VelaError("not_found", "Exchange not found"),
    );
    await expectResponse(await app.request(replyRequest()), 404, NOT_FOUND);
  });

  it("answers 409 before she has answered, and 403 for her own exchange, each with its reason", async () => {
    const early = fixture(true);
    early.writes.services.replyToApiExchange.mockRejectedValue(
      new ReplyRefusedError("not_answered"),
    );
    await expectResponse(await early.app.request(replyRequest()), 409, {
      error: {
        code: "conflict",
        message: "She has not answered yet.",
        details: { reason: "not_answered" },
      },
    });

    const hers = fixture(true);
    hers.writes.services.replyToApiExchange.mockRejectedValue(new ReplyRefusedError("her_own"));
    await expectResponse(await hers.app.request(replyRequest()), 403, {
      error: {
        code: "forbidden",
        message: "She cannot reply to her own exchange.",
        details: { reason: "her_own" },
      },
    });
  });

  it("refuses a reaction or an empty reply before any database is opened", async () => {
    for (const body of [{}, { text: "" }, { text: "hi", kind: "heart" }, { kind: "heart" }]) {
      const f = fixture(true);
      await expectResponse(await f.app.request(replyRequest(body)), 400, INVALID);
      expect(f.writes.services.replyToApiExchange).not.toHaveBeenCalled();
      expect(f.openDatabase).not.toHaveBeenCalled();
    }
  });

  it("is not there at all without the write capability", async () => {
    const { app } = fixture();
    await expectResponse(await app.request(replyRequest()), 404, NOT_FOUND);
  });

  it("refuses a session that is no longer live before opening the database", async () => {
    const f = fixture(true);
    f.writes.verifyActiveSession.mockResolvedValue(false);
    const response = await f.app.request(replyRequest());
    expect(response.status).toBe(401);
    expect(f.writes.services.replyToApiExchange).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});

function familyRequest(body: unknown = NEW_FAMILY) {
  return writeRequest("POST", "/v1/families", JSON.stringify(body), {
    authorization: "Bearer good",
  });
}

describe("creating a family", () => {
  it("dispatches the verified actor, the key and the body with its token and bot, and answers 201", async () => {
    const { app, writes } = fixture(true);
    const response = await app.request(familyRequest());
    expect(response.status).toBe(201);
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(CREATED);
    expect(writes.services.createApiFamily).toHaveBeenCalledWith(
      {
        db: expect.anything(),
        clock: writes.clock,
        random: writes.families.random,
        config: writes.families.config,
      },
      IDENTITY,
      "request-1",
      NEW_FAMILY,
    );
  });

  it("answers 409 with its reason for an account that already runs a family", async () => {
    const { app, writes } = fixture(true);
    writes.services.createApiFamily.mockRejectedValue(new AlreadyOrganiserError());
    await expectResponse(await app.request(familyRequest()), 409, {
      error: {
        code: "conflict",
        message: "This account already runs a family.",
        details: { reason: "already_organiser" },
      },
    });
  });

  it("answers 404 for a caller whose account does not exist yet", async () => {
    const { app, writes } = fixture(true);
    writes.services.createApiFamily.mockRejectedValue(
      new VelaError("not_found", "Account not found"),
    );
    await expectResponse(await app.request(familyRequest()), 404, NOT_FOUND);
  });

  it("refuses a body the contract would not accept before any database is opened", async () => {
    for (const body of [
      {},
      { ...NEW_FAMILY, country: "Taiwan" },
      { ...NEW_FAMILY, extra: true },
      { ...NEW_FAMILY, kept_light_member: { ...NEW_FAMILY.kept_light_member, wake_time: "7" } },
    ]) {
      const f = fixture(true);
      await expectResponse(await f.app.request(familyRequest(body)), 400, INVALID);
      expect(f.writes.services.createApiFamily).not.toHaveBeenCalled();
      expect(f.openDatabase).not.toHaveBeenCalled();
    }
  });

  it("is not there without the family capability, even with writes on", async () => {
    const f = fixture(true);
    const runtime = createApiApp({
      verifySession: f.verifySession,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
      openDatabase: f.openDatabase,
      services: f.services,
      logger: f.logger,
      writes: {
        verifyActiveSession: f.writes.verifyActiveSession,
        clock: f.writes.clock,
        services: f.writes.services,
      },
    });
    await expectResponse(await runtime.request(familyRequest()), 404, NOT_FOUND);
    expect(f.writes.services.createApiFamily).not.toHaveBeenCalled();
  });
});

function quietRequest(action: "fine" | "wait", body: unknown = {}) {
  return writeRequest("POST", `/v1/quiet/${QUIET_ID}/${action}`, JSON.stringify(body), {
    authorization: "Bearer good",
  });
}

describe("the quiet notice", () => {
  it("reads the notice for the caller, with no family middleware since the event names its family", async () => {
    const { app, services } = fixture();
    const response = await app.request(`/v1/quiet/${QUIET_ID}`, {
      headers: { authorization: "Bearer good" },
    });
    await expectResponse(response, 200, QUIET_NOTICE);
    expect(services.loadApiQuiet).toHaveBeenCalledWith(expect.anything(), IDENTITY, QUIET_ID);
    expect(services.authorizeFamilyAccess).not.toHaveBeenCalled();
  });

  it("answers 404 when the service finds nothing for this caller", async () => {
    const { app, services } = fixture();
    services.loadApiQuiet.mockResolvedValue(null);
    const response = await app.request(`/v1/quiet/${QUIET_ID}`, {
      headers: { authorization: "Bearer good" },
    });
    await expectResponse(response, 404, NOT_FOUND);
  });

  it.each(["fine", "wait"] as const)(
    "dispatches %s, answers the state, and then hands over what the write left behind",
    async (action) => {
      const { app, writes } = fixture(true);
      const order: string[] = [];
      writes.services.resolveApiQuiet.mockImplementation(async () => {
        order.push("service");
        return {
          response: { status: 200, body: QUIET_STATE },
          replayed: false,
          after: { outboundIds: ["row-1"], wakeMemberIds: ["her"] },
        };
      });
      writes.nudges.deliver.mockImplementation(async () => {
        order.push("deliver");
      });
      writes.nudges.wake.mockImplementation(async () => {
        order.push("wake");
      });

      const response = await app.request(quietRequest(action));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(QUIET_STATE);
      expect(writes.services.resolveApiQuiet).toHaveBeenCalledWith(
        { db: expect.anything(), clock: writes.clock },
        IDENTITY,
        "request-1",
        QUIET_ID,
        action,
        {},
      );
      expect(order).toEqual(["service", "deliver", "wake"]);
      expect(writes.nudges.deliver).toHaveBeenCalledWith("row-1");
      expect(writes.nudges.wake).toHaveBeenCalledWith("her", expect.any(Date));
    },
  );

  it("still answers 200 when handing over fails: the write committed, and reconcile finishes it", async () => {
    const { app, writes, logger } = fixture(true);
    writes.nudges.deliver.mockRejectedValue(new Error("queue down"));
    const response = await app.request(quietRequest("fine"));
    expect(response.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith("api_after_commit_deliver_failed", {
      outboundId: "row-1",
    });
  });

  it("refuses a body with anything in it before the database is opened", async () => {
    const f = fixture(true);
    await expectResponse(await f.app.request(quietRequest("fine", { reason: "x" })), 400, INVALID);
    expect(f.writes.services.resolveApiQuiet).not.toHaveBeenCalled();
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it("is not there without the write capability", async () => {
    const { app } = fixture();
    await expectResponse(await app.request(quietRequest("wait")), 404, NOT_FOUND);
  });
});

describe("pausing and leaving", () => {
  const PAUSE_PATH = `/v1/families/${FAMILY_ID}/members/${MEMBER_ID}/pause`;
  const LEFT_PATH = `/v1/families/${FAMILY_ID}/members/${MEMBER_ID}/left`;
  const good = { authorization: "Bearer good" };

  it("pauses through the family check and answers the new state", async () => {
    const { app, writes, services } = fixture(true);
    const response = await app.request(
      writeRequest("POST", PAUSE_PATH, JSON.stringify({ paused: true }), good),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PAUSED);
    expect(services.authorizeFamilyAccess).toHaveBeenCalled();
    expect(writes.services.pauseApiMember).toHaveBeenCalledWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      FAMILY_ID,
      MEMBER_ID,
      { paused: true },
    );
  });

  // ADR-34: an organiser who leaves may have been the last one who could be told of a quiet morning.
  it("gives Leave where the founder is told, and hands over the alert it wrote after the commit", async () => {
    const f = fixture(true);
    const alerts = {
      adminConversationId: "123456789",
      publicBaseUrl: "https://vela-admin.vela.example",
      pushSending: false,
    };
    const app = createApiApp({
      verifySession: f.verifySession,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
      openDatabase: f.openDatabase,
      services: f.services,
      logger: f.logger,
      writes: { ...f.writes, alerts },
    });
    f.writes.services.leaveApiFamily.mockResolvedValue({
      response: { status: 200, body: LEFT },
      replayed: false,
      after: { outboundIds: ["alert-row"], wakeMemberIds: [] },
    });

    expect((await app.request(writeRequest("POST", LEFT_PATH, "{}", good))).status).toBe(200);

    expect(f.writes.services.leaveApiFamily.mock.calls[0]?.[0]).toEqual({
      db: expect.anything(),
      clock: f.writes.clock,
      alerts,
    });
    expect(f.writes.nudges.deliver).toHaveBeenCalledExactlyOnceWith("alert-row");
  });

  it("leaves without the family check, so the replay after leaving still answers", async () => {
    const { app, writes, services } = fixture(true);
    const response = await app.request(writeRequest("POST", LEFT_PATH, "{}", good));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(LEFT);
    expect(services.authorizeFamilyAccess).not.toHaveBeenCalled();
    expect(writes.services.leaveApiFamily).toHaveBeenCalledWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      FAMILY_ID,
      MEMBER_ID,
      {},
    );
  });

  it.each([
    ["last_organiser", "Someone else who organises the family has to be active first."],
    ["kept_light", "A kept light is paused from her own chat."],
  ] as const)("answers a %s refusal as a 409 that says why", async (reason, message) => {
    const { app, writes } = fixture(true);
    writes.services.leaveApiFamily.mockRejectedValue(new MemberChangeRefusedError(reason));
    await expectResponse(await app.request(writeRequest("POST", LEFT_PATH, "{}", good)), 409, {
      error: { code: "conflict", message, details: { reason } },
    });
  });

  it("refuses a body that is not the contract's before the database is opened", async () => {
    const f = fixture(true);
    await expectResponse(
      await f.app.request(
        writeRequest("POST", PAUSE_PATH, JSON.stringify({ paused: "yes" }), good),
      ),
      400,
      INVALID,
    );
    await expectResponse(
      await f.app.request(writeRequest("POST", LEFT_PATH, JSON.stringify({ why: "x" }), good)),
      400,
      INVALID,
    );
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it("is not there without the write capability", async () => {
    const { app } = fixture();
    await expectResponse(
      await app.request(writeRequest("POST", LEFT_PATH, "{}", good)),
      404,
      NOT_FOUND,
    );
  });
});

describe("one exchange", () => {
  const summary = EXCHANGE_PAGE.exchanges[0];
  const path = (id: string) => `/v1/exchanges/${id}`;

  it("answers the exchange the service reads, and 404 for one it does not", async () => {
    if (summary === undefined) throw new Error("expected the fixture's exchange");
    const { app, services } = fixture();
    services.loadApiExchange.mockResolvedValue(summary);
    const found = await app.request(path(summary.id), {
      headers: { authorization: "Bearer good" },
    });
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(summary);
    expect(services.loadApiExchange).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      summary.id,
      expect.any(Date),
    );

    services.loadApiExchange.mockResolvedValue(null);
    const missing = await app.request(path(summary.id), {
      headers: { authorization: "Bearer good" },
    });
    expect(missing.status).toBe(404);
  });

  it("answers 401 without a session", async () => {
    const { app, verifySession } = fixture();
    verifySession.mockResolvedValue(null);
    expect((await app.request(path(QUIET_ID))).status).toBe(401);
  });
});

describe("whether a quiet notice was useful", () => {
  const PATH = `/v1/quiet/${QUIET_ID}/useful`;
  const good = { authorization: "Bearer good" };

  it("keeps the verdict through the service and answers the state", async () => {
    const f = fixture(true);
    const response = await f.app.request(
      writeRequest("POST", PATH, JSON.stringify({ useful: true }), good),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ useful: true });
    expect(f.writes.services.markApiQuietUseful).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      "request-1",
      QUIET_ID,
      { useful: true },
    );
  });

  it("answers 409 while the morning is still quiet, and 400 for anything but a boolean", async () => {
    const f = fixture(true);
    f.writes.services.markApiQuietUseful.mockRejectedValue(new QuietUsefulRefusedError());
    const open = await f.app.request(
      writeRequest("POST", PATH, JSON.stringify({ useful: false }), good),
    );
    expect(open.status).toBe(409);
    const bad = await f.app.request(
      writeRequest("POST", PATH, JSON.stringify({ useful: "yes" }), good),
    );
    expect(bad.status).toBe(400);
  });
});

describe("someone nearby on Telegram (ADR-36)", () => {
  const good = { authorization: "Bearer good" };
  const ASK_PATH = `/v1/quiet/${QUIET_ID}/ask-to-check`;
  const INVITE_PATH = `/v1/nearby/${MEMBER_ID}/invite`;

  it("asks them to look in through the service, and hands its message to the queue", async () => {
    const f = fixture(true);
    const response = await f.app.request(
      writeRequest("POST", ASK_PATH, JSON.stringify({ contact_id: MEMBER_ID }), good),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ quiet_event_id: QUIET_ID, reply: null });
    expect(f.writes.services.askApiToLookIn).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      "request-1",
      QUIET_ID,
      { contact_id: MEMBER_ID },
    );
  });

  it("answers a morning already settled, or someone who cannot be asked, with 409 and the reason", async () => {
    for (const reason of ["settled", "cannot_be_asked"] as const) {
      const f = fixture(true);
      f.writes.services.askApiToLookIn.mockRejectedValue(new LookInRefusedError(reason));
      const response = await f.app.request(
        writeRequest("POST", ASK_PATH, JSON.stringify({ contact_id: MEMBER_ID }), good),
      );
      expect(response.status).toBe(409);
      expect(((await response.json()) as ApiErrorBody).error.details).toEqual({ reason });
    }
  });

  it("refuses an ask whose body is not one contact", async () => {
    const f = fixture(true);
    const response = await f.app.request(writeRequest("POST", ASK_PATH, "{}", good));
    expect(response.status).toBe(400);
    expect(f.writes.services.askApiToLookIn).not.toHaveBeenCalled();
  });

  it("answers the link to share once, uncached, and 409 for someone already listed", async () => {
    const f = fixture(true);
    const response = await f.app.request(writeRequest("POST", INVITE_PATH, "{}", good));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      contact_id: MEMBER_ID,
      link: "https://t.me/vela_test_bot?start=nTOKEN",
    });

    f.writes.services.inviteApiNearby.mockRejectedValue(
      new NearbyInviteRefusedError("already_listed"),
    );
    const listed = await f.app.request(writeRequest("POST", INVITE_PATH, "{}", good));
    expect(listed.status).toBe(409);
  });
});

describe("her phone for the parent surface", () => {
  const SET_UP_PATH = `/v1/families/${FAMILY_ID}/members/${MEMBER_ID}/device`;
  const good = { authorization: "Bearer good" };
  const her = {
    id: MEMBER_ID,
    displayName: "Mom",
    addressForm: "Mrs Chen",
    language: "zh-TW",
    status: "invited",
    arrivalTime: "08:00",
  } as unknown as Member;

  it("sets her phone up through the organiser guard and answers the token once, uncached", async () => {
    const f = fixture(true);
    const response = await f.app.request(writeRequest("POST", SET_UP_PATH, "{}", good));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ member_id: MEMBER_ID, token: DEVICE_TOKEN });
    expect(f.services.authorizeFamilyAccess).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITY,
      FAMILY_ID,
      "organiser",
    );
    expect(f.writes.services.setUpApiDevice).toHaveBeenCalledWith(
      {
        db: expect.anything(),
        clock: f.writes.clock,
        random: f.writes.devices.random,
        config: f.writes.devices.config,
      },
      IDENTITY,
      FAMILY_ID,
      MEMBER_ID,
    );
  });

  it("answers 403 to someone who does not organise, before anything is set up", async () => {
    const f = fixture(true);
    f.services.authorizeFamilyAccess.mockResolvedValue({ kind: "forbidden" });
    expect((await f.app.request(writeRequest("POST", SET_UP_PATH, "{}", good))).status).toBe(403);
    expect(f.writes.services.setUpApiDevice).not.toHaveBeenCalled();
  });

  it("answers 404 when the service finds no kept-light member of hers", async () => {
    const f = fixture(true);
    f.writes.services.setUpApiDevice.mockRejectedValue(new VelaError("not_found", "Not found"));
    expect((await f.app.request(writeRequest("POST", SET_UP_PATH, "{}", good))).status).toBe(404);
  });

  it("removes her phone and answers that it is removed", async () => {
    const f = fixture(true);
    const response = await f.app.request(writeRequest("POST", `${SET_UP_PATH}/remove`, "{}", good));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ member_id: MEMBER_ID, removed: true });
  });

  it("is not there without the write capability", async () => {
    const { app } = fixture();
    expect((await app.request(writeRequest("POST", SET_UP_PATH, "{}", good))).status).toBe(404);
  });

  it("tells her phone who she is, by its token alone", async () => {
    const f = fixture();
    f.services.memberOfDeviceToken.mockResolvedValue(her);
    const response = await f.app.request("/v1/device", {
      headers: { authorization: `Device ${DEVICE_TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      member_id: MEMBER_ID,
      display_name: "Mom",
      address_form: "Mrs Chen",
      language: "zh-TW",
      status: "invited",
      arrival_time: "08:00",
    });
    expect(f.services.memberOfDeviceToken).toHaveBeenCalledWith(expect.anything(), DEVICE_TOKEN);
  });

  it("gives her phone the messages Vela sent it, newest first, by its token alone", async () => {
    const f = fixture();
    f.services.memberOfDeviceToken.mockResolvedValue(her);
    const morning = {
      message_id: "m-2",
      kind: "arrival",
      exchange_id: null,
      text: "Good morning, Mrs Chen.",
      buttons: [[{ id: "c:1", label: "I'm fine" }]],
      photos: [],
      voices: [],
      sent_at: "2026-09-22T00:00:00.000Z",
    };
    f.services.loadDeviceMessages.mockResolvedValue([morning]);
    const response = await f.app.request("/v1/device/messages", {
      headers: { authorization: `Device ${DEVICE_TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [morning] });
    expect(f.services.loadDeviceMessages).toHaveBeenCalledWith(expect.anything(), her);

    expect((await f.app.request("/v1/device/messages")).status).toBe(401);
  });

  it("answers 401 to a token it does not know, a session's Bearer, and no token", async () => {
    const f = fixture();
    const asked = async (authorization?: string) =>
      (
        await f.app.request(
          "/v1/device",
          authorization === undefined ? {} : { headers: { authorization } },
        )
      ).status;
    expect(await asked(`Device ${DEVICE_TOKEN}`)).toBe(401);
    expect(await asked("Bearer good")).toBe(401);
    expect(await asked()).toBe(401);
    expect(await asked("Device short")).toBe(401);
  });
});

describe("people nearby", () => {
  const NEARBY_PATH = `/v1/families/${FAMILY_ID}/nearby`;
  const REMOVE_PATH = `/v1/nearby/${CONTACT_ID}/remove`;
  const good = { authorization: "Bearer good" };
  const body = JSON.stringify({ member_id: MEMBER_ID, name: "Lena", relation: "neighbour" });

  it("adds someone nearby through the family check and answers 201 with them", async () => {
    const { app, writes, services } = fixture(true);
    const response = await app.request(writeRequest("POST", NEARBY_PATH, body, good));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(NEARBY_CONTACT);
    expect(services.authorizeFamilyAccess).toHaveBeenCalled();
    expect(writes.services.addApiNearby).toHaveBeenCalledWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      FAMILY_ID,
      { member_id: MEMBER_ID, name: "Lena", relation: "neighbour" },
    );
  });

  it("answers 200 with the contact already near her", async () => {
    const { app, writes } = fixture(true);
    writes.services.addApiNearby.mockResolvedValue({
      response: { status: 200, body: NEARBY_CONTACT },
      replayed: false,
    });
    const response = await app.request(writeRequest("POST", NEARBY_PATH, body, good));
    expect(response.status).toBe(200);
  });

  it.each([
    ["full", "Two people nearby is the most."],
    ["number", "Leave the number out: it is added with their yes."],
  ] as const)("answers a %s refusal as a 409 that says why", async (reason, message) => {
    const { app, writes } = fixture(true);
    writes.services.addApiNearby.mockRejectedValue(new NearbyRefusedError(reason));
    await expectResponse(await app.request(writeRequest("POST", NEARBY_PATH, body, good)), 409, {
      error: { code: "conflict", message, details: { reason } },
    });
  });

  it("answers 403 to a family member the guard refuses, before the service", async () => {
    const f = fixture(true);
    f.services.authorizeFamilyAccess.mockResolvedValue({ kind: "forbidden" });
    await expectResponse(await f.app.request(writeRequest("POST", NEARBY_PATH, body, good)), 403, {
      error: { code: "forbidden", message: "Access denied." },
    });
    expect(f.writes.services.addApiNearby).not.toHaveBeenCalled();
  });

  it("answers 404 when the service finds nothing that is the caller's", async () => {
    const { app, writes } = fixture(true);
    writes.services.addApiNearby.mockRejectedValue(new VelaError("not_found", "Not found"));
    expect((await app.request(writeRequest("POST", NEARBY_PATH, body, good))).status).toBe(404);
  });

  it("refuses a body that is not the contract's before the database is opened", async () => {
    const f = fixture(true);
    const bad = JSON.stringify({ member_id: MEMBER_ID, name: "Lena", phone: "0912345678" });
    await expectResponse(
      await f.app.request(writeRequest("POST", NEARBY_PATH, bad, good)),
      400,
      INVALID,
    );
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it("removes someone nearby and answers that they are removed", async () => {
    const { app, writes } = fixture(true);
    const response = await app.request(writeRequest("POST", REMOVE_PATH, "{}", good));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: CONTACT_ID, removed: true });
    expect(writes.services.removeApiNearby).toHaveBeenCalledWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      CONTACT_ID,
    );
  });

  it("answers 404 for a contact that is not the caller's to remove", async () => {
    const { app, writes } = fixture(true);
    writes.services.removeApiNearby.mockRejectedValue(new VelaError("not_found", "Not found"));
    expect((await app.request(writeRequest("POST", REMOVE_PATH, "{}", good))).status).toBe(404);
  });

  it("is not there without the write capability", async () => {
    const { app } = fixture();
    expect((await app.request(writeRequest("POST", NEARBY_PATH, body, good))).status).toBe(404);
    expect((await app.request(writeRequest("POST", REMOVE_PATH, "{}", good))).status).toBe(404);
  });
});

describe("starting the trial", () => {
  const TRIAL_PATH = `/v1/families/${FAMILY_ID}/plan/trial`;
  const good = { authorization: "Bearer good" };
  const body = JSON.stringify({ member_id: MEMBER_ID });

  it("starts it through the family check and answers where her Vela Light stands", async () => {
    const { app, writes, services } = fixture(true);
    const response = await app.request(writeRequest("POST", TRIAL_PATH, body, good));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TRIAL);
    expect(services.authorizeFamilyAccess).toHaveBeenCalled();
    expect(writes.services.startApiTrial).toHaveBeenCalledWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      FAMILY_ID,
      { member_id: MEMBER_ID },
    );
  });

  it.each([
    ["not_answered_yet", "The trial starts after her first answer."],
    ["light_off", "Her light is not on."],
  ] as const)("answers a %s refusal as a 409 that says why", async (reason, message) => {
    const { app, writes } = fixture(true);
    writes.services.startApiTrial.mockRejectedValue(new TrialRefusedError(reason));
    await expectResponse(await app.request(writeRequest("POST", TRIAL_PATH, body, good)), 409, {
      error: { code: "conflict", message, details: { reason } },
    });
  });

  it("refuses a body that is not the contract's before the database is opened", async () => {
    const f = fixture(true);
    await expectResponse(
      await f.app.request(writeRequest("POST", TRIAL_PATH, JSON.stringify({ months: 2 }), good)),
      400,
      INVALID,
    );
    expect(f.openDatabase).not.toHaveBeenCalled();
  });
});

// ADR-34: this installation's phone, registered for the signed-in account and removed at sign-out.
describe("push devices", () => {
  const REMOVE_PATH = `/v1/me/devices/${INSTALLATION_ID}/remove`;
  const good = { authorization: "Bearer good" };
  // Made at run time: a literal shaped like a push token looks like a credential to scanning.
  const PUSH_TOKEN = `${["Exponent", "PushToken"].join("")}[api-app-test]`;
  const REGISTRATION = {
    installation_id: INSTALLATION_ID,
    token: PUSH_TOKEN,
    platform: "android",
    permission: "granted",
    quiet_channel_blocked: false,
  };
  const ALERTS = {
    adminConversationId: "123456789",
    publicBaseUrl: "https://vela-admin.vela.example",
    pushSending: false,
  };
  const SIGN_IN = { error: { code: "unauthenticated", message: "Sign in required." } };

  function registerRequest(body: unknown = REGISTRATION, key = "request-1") {
    return writeRequest("POST", "/v1/me/devices", JSON.stringify(body), {
      ...good,
      "idempotency-key": key,
    });
  }

  function removeRequest(path = REMOVE_PATH, body: unknown = {}) {
    return writeRequest("POST", path, JSON.stringify(body), good);
  }

  it("registers this phone for the account, answers it without its token, and hands over what it wrote", async () => {
    const { app, writes, services } = fixture(true);
    writes.services.registerApiPushDevice.mockResolvedValue({
      response: { status: 200, body: PUSH_DEVICE },
      replayed: false,
      after: { outboundIds: ["alert-row"], wakeMemberIds: [] },
    });

    const response = await app.request(registerRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    const body = await response.json();
    expect(body).toEqual(PUSH_DEVICE);
    expect(JSON.stringify(body)).not.toContain("PushToken");
    expect(writes.services.registerApiPushDevice).toHaveBeenCalledExactlyOnceWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      REGISTRATION,
    );
    expect(services.authorizeFamilyAccess).not.toHaveBeenCalled();
    expect(writes.nudges.deliver).toHaveBeenCalledExactlyOnceWith("alert-row");
  });

  it("gives both device services where the founder is told and whether pushes are sent", async () => {
    const f = fixture(true);
    const app = createApiApp({
      verifySession: f.verifySession,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
      openDatabase: f.openDatabase,
      services: f.services,
      logger: f.logger,
      writes: { ...f.writes, alerts: ALERTS },
    });

    expect((await app.request(registerRequest())).status).toBe(200);
    expect((await app.request(removeRequest())).status).toBe(200);

    expect(f.writes.services.registerApiPushDevice.mock.calls[0]?.[0]).toEqual({
      db: expect.anything(),
      clock: f.writes.clock,
      alerts: ALERTS,
    });
    expect(f.writes.services.removeApiPushDevice.mock.calls[0]?.[0]).toEqual({
      db: expect.anything(),
      clock: f.writes.clock,
      alerts: ALERTS,
    });
  });

  it("says when a registration is a replay, and hands nothing over again", async () => {
    const { app, writes } = fixture(true);
    writes.services.registerApiPushDevice.mockResolvedValue({
      response: { status: 200, body: PUSH_DEVICE },
      replayed: true,
      after: { outboundIds: [], wakeMemberIds: [] },
    });

    const response = await app.request(registerRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    expect(await response.json()).toEqual(PUSH_DEVICE);
    expect(writes.nudges.deliver).not.toHaveBeenCalled();
  });

  it("removes this installation, named by its path, and answers whether the account had it", async () => {
    const { app, writes } = fixture(true);
    writes.services.removeApiPushDevice.mockResolvedValue({
      response: { status: 200, body: { installation_id: INSTALLATION_ID, removed: true } },
      replayed: false,
      after: { outboundIds: ["alert-row"], wakeMemberIds: [] },
    });

    const response = await app.request(removeRequest());

    await expectResponse(response, 200, { installation_id: INSTALLATION_ID, removed: true });
    expect(writes.services.removeApiPushDevice).toHaveBeenCalledExactlyOnceWith(
      { db: expect.anything(), clock: writes.clock },
      IDENTITY,
      "request-1",
      INSTALLATION_ID,
      {},
    );
    expect(writes.nudges.deliver).toHaveBeenCalledExactlyOnceWith("alert-row");
  });

  // Account-scoped routes: nothing here is anyone else's to refuse, so there is no 403. Another
  // account's installation is not removed, and says so with a 200.
  it("has no 403: another account's installation answers 200 with removed false", async () => {
    const { app, writes } = fixture(true);
    writes.services.removeApiPushDevice.mockResolvedValue({
      response: { status: 200, body: { installation_id: INSTALLATION_ID, removed: false } },
      replayed: false,
      after: { outboundIds: [], wakeMemberIds: [] },
    });

    await expectResponse(await app.request(removeRequest()), 200, {
      installation_id: INSTALLATION_ID,
      removed: false,
    });
  });

  it.each([
    ["a token that is not Expo's", { ...REGISTRATION, token: "fcm:abc" }],
    ["no permission", { ...REGISTRATION, permission: undefined }],
    ["a platform the app never runs on", { ...REGISTRATION, platform: "web" }],
    ["a field that is not the contract's", { ...REGISTRATION, user_id: USER_ID }],
  ])("answers 400 for %s before the database is opened", async (_, body) => {
    const f = fixture(true);

    await expectResponse(await f.app.request(registerRequest(body)), 400, INVALID);
    await expectResponse(await f.app.request(removeRequest(REMOVE_PATH, { why: 1 })), 400, INVALID);
    expect(f.openDatabase).not.toHaveBeenCalled();
    expect(f.writes.services.registerApiPushDevice).not.toHaveBeenCalled();
    expect(f.writes.services.removeApiPushDevice).not.toHaveBeenCalled();
  });

  it("answers 400 without an idempotency key", async () => {
    const f = fixture(true);
    const request = new Request("https://api.test/v1/me/devices", {
      method: "POST",
      headers: { "content-type": "application/json", ...good },
      body: JSON.stringify(REGISTRATION),
    });

    await expectResponse(await f.app.request(request), 400, INVALID);
    expect(f.openDatabase).not.toHaveBeenCalled();
  });

  it("answers 401 without a session, or with one no longer live, before the database is opened", async () => {
    const signedOut = fixture(true);
    signedOut.verifySession.mockResolvedValue(null);
    await expectResponse(await signedOut.app.request(registerRequest()), 401, SIGN_IN);
    await expectResponse(await signedOut.app.request(removeRequest()), 401, SIGN_IN);

    const ended = fixture(true);
    ended.writes.verifyActiveSession.mockResolvedValue(false);
    await expectResponse(await ended.app.request(registerRequest()), 401, SIGN_IN);
    await expectResponse(await ended.app.request(removeRequest()), 401, SIGN_IN);
    expect(signedOut.openDatabase).not.toHaveBeenCalled();
    expect(ended.openDatabase).not.toHaveBeenCalled();
  });

  it("answers 404 for an account that is not there, and for a path that is no installation", async () => {
    const f = fixture(true);
    f.writes.services.registerApiPushDevice.mockRejectedValue(
      new VelaError("not_found", "Account not found"),
    );
    await expectResponse(await f.app.request(registerRequest()), 404, NOT_FOUND);

    const g = fixture(true);
    await expectResponse(
      await g.app.request(removeRequest("/v1/me/devices/not-an-installation/remove")),
      404,
      NOT_FOUND,
    );
    expect(g.openDatabase).not.toHaveBeenCalled();
    expect(g.writes.verifyActiveSession).not.toHaveBeenCalled();
    expect(g.writes.services.removeApiPushDevice).not.toHaveBeenCalled();
  });

  it("answers 409 for a key used before with another body", async () => {
    const f = fixture(true);
    f.writes.services.registerApiPushDevice.mockRejectedValue(new ApiIdempotencyError("conflict"));
    f.writes.services.removeApiPushDevice.mockRejectedValue(new ApiIdempotencyError("conflict"));

    await expectResponse(await f.app.request(registerRequest()), 409, CONFLICT);
    await expectResponse(await f.app.request(removeRequest()), 409, CONFLICT);
  });

  it("still answers 200 when handing over fails: the write committed, and reconcile finishes it", async () => {
    const { app, writes, logger } = fixture(true);
    writes.services.removeApiPushDevice.mockResolvedValue({
      response: { status: 200, body: { installation_id: INSTALLATION_ID, removed: true } },
      replayed: false,
      after: { outboundIds: ["alert-row"], wakeMemberIds: [] },
    });
    writes.nudges.deliver.mockRejectedValue(new Error("queue down"));

    expect((await app.request(removeRequest())).status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith("api_after_commit_deliver_failed", {
      outboundId: "alert-row",
    });
  });

  it("is not there without the write capability", async () => {
    const { app } = fixture();

    await expectResponse(await app.request(registerRequest()), 404, NOT_FOUND);
    await expectResponse(await app.request(removeRequest()), 404, NOT_FOUND);
  });
});
