import {
  AddNearby,
  ApiAccountPatch,
  ApiAccountProfile,
  ApiAway,
  ApiBook,
  ApiBookRemoved,
  ApiCapabilities,
  ApiComposedAsk,
  ApiCreatedFamily,
  ApiDeceased,
  ApiDeviceMember,
  ApiDeviceMessages,
  ApiDeviceRemoved,
  ApiDeviceSetUp,
  type ApiErrorBody,
  ApiExchangePage,
  ApiExchangeSummary,
  ApiFamily,
  ApiFamilyPlan,
  ApiIdempotencyKey,
  ApiLeft,
  ApiLinkChallenge,
  ApiLinkCompleteInput,
  ApiLinkOutcome,
  ApiLinkStartInput,
  ApiLookInAsk,
  ApiMe,
  ApiMemberPause,
  ApiNearbyContact,
  ApiNearbyInvite,
  ApiNearbyRemoved,
  ApiPrecision,
  ApiPushDevice,
  ApiPushDeviceRemoved,
  ApiQuietNotice,
  ApiQuietState,
  ApiReminder,
  ApiReminderDone,
  ApiReminders,
  ApiReply,
  ApiToday,
  ApiTrial,
  ApiUploadedMedia,
  ApiUploadedVoice,
  ApiUser,
  ApiWeeklyRead,
  ApiWeeklyReadOpened,
  ApiWithdrawn,
  AskToLookIn,
  ComposeAsk,
  ComposeReply,
  CreateFamily,
  CreateReminder,
  DeviceWrite,
  EndAway,
  FinishReminder,
  InviteNearby,
  type Lang,
  LeaveFamily,
  MarkDeceased,
  type MediaUnavailableReason,
  MemberLight,
  OpenWeeklyRead,
  PauseMember,
  QuietAction,
  QuietUseful,
  RegisterPushDevice,
  RemoveBookEntry,
  RemoveNearby,
  RemovePushDevice,
  SetAway,
  StartTrial,
  WithdrawAsk,
} from "@vela/contracts";
import type { Member, VelaDatabase } from "@vela/db";
import {
  AlreadyOrganiserError,
  type ApiFamilyDeps,
  ApiIdempotencyError,
  type ApiNudges,
  AskDayTakenError,
  AskPhotoMissingError,
  AskVoiceMissingError,
  AwayRefusedError,
  type addApiNearby,
  type askApiToLookIn,
  type authorizeFamilyAccess,
  type Clock,
  type completeAccountLink,
  type composeApiAsk,
  type createApiFamily,
  type createApiReminder,
  type DeviceAlerts,
  type endApiAway,
  errorLabel,
  FactMissingError,
  type finishApiReminder,
  type inviteApiNearby,
  type Logger,
  LookInRefusedError,
  type leaveApiFamily,
  type loadApiBook,
  type loadApiExchange,
  type loadApiExchanges,
  type loadApiFamily,
  type loadApiFamilyPlan,
  type loadApiLights,
  type loadApiMe,
  type loadApiPrecision,
  type loadApiQuiet,
  type loadApiReminders,
  type loadApiToday,
  type loadApiWeeklyRead,
  type loadDeviceMessages,
  MAX_VOICE_BYTES,
  MediaRefusedError,
  type MediaStore,
  MemberChangeRefusedError,
  type markApiDeceased,
  type markApiQuietUseful,
  type memberOfDeviceToken,
  NearbyInviteRefusedError,
  NearbyRefusedError,
  type openApiWeeklyRead,
  type PilotAdmission,
  type pauseApiMember,
  type pilotApiAccountAllowed,
  type provisionApiAccount,
  QuietUsefulRefusedError,
  type Random,
  ReplyRefusedError,
  type readApiMedia,
  type readDeviceMedia,
  type registerApiPushDevice,
  type removeApiBookEntry,
  type removeApiDevice,
  type removeApiNearby,
  type removeApiPushDevice,
  type replyToApiExchange,
  type resolveApiQuiet,
  runAfterCommit,
  type setApiAway,
  type setUpApiDevice,
  type startAccountLink,
  type startApiTrial,
  TrialRefusedError,
  type updateApiAccount,
  type uploadApiMedia,
  type uploadApiVoice,
  VelaError,
  WithdrawTooLateError,
  type withdrawApiAsk,
} from "@vela/services";
import { Hono, type MiddlewareHandler } from "hono";
import {
  type ApiSecurityEnv,
  createApiAuthentication,
  createFamilyAuthorization,
  withApiErrorNoStore,
} from "./api-security.ts";
import {
  M4A_CONTENT_TYPE,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_READ_MS,
  MAX_UPLOAD_READS,
  readUploadBody,
  uploadHeaders,
} from "./api-upload.ts";
import {
  type SessionActivityChecker,
  SessionVerificationUnavailable,
  type SessionVerifier,
} from "./session.ts";

export interface ApiReadServices {
  loadApiMe: typeof loadApiMe;
  loadApiFamilyPlan: typeof loadApiFamilyPlan;
  loadApiLights: typeof loadApiLights;
  loadApiToday: typeof loadApiToday;
  loadApiFamily: typeof loadApiFamily;
  loadApiBook: typeof loadApiBook;
  loadApiReminders: typeof loadApiReminders;
  loadApiExchange: typeof loadApiExchange;
  loadApiExchanges: typeof loadApiExchanges;
  loadApiQuiet: typeof loadApiQuiet;
  loadApiWeeklyRead: typeof loadApiWeeklyRead;
  loadApiPrecision: typeof loadApiPrecision;
  memberOfDeviceToken: typeof memberOfDeviceToken;
  loadDeviceMessages: typeof loadDeviceMessages;
  authorizeFamilyAccess: typeof authorizeFamilyAccess;
  readApiMedia: typeof readApiMedia;
  readDeviceMedia: typeof readDeviceMedia;
}

export interface ApiWriteServices {
  provisionApiAccount: typeof provisionApiAccount;
  updateApiAccount: typeof updateApiAccount;
  composeApiAsk: typeof composeApiAsk;
  replyToApiExchange: typeof replyToApiExchange;
  createApiFamily: typeof createApiFamily;
  resolveApiQuiet: typeof resolveApiQuiet;
  pauseApiMember: typeof pauseApiMember;
  leaveApiFamily: typeof leaveApiFamily;
  setApiAway: typeof setApiAway;
  withdrawApiAsk: typeof withdrawApiAsk;
  markApiDeceased: typeof markApiDeceased;
  endApiAway: typeof endApiAway;
  startApiTrial: typeof startApiTrial;
  openApiWeeklyRead: typeof openApiWeeklyRead;
  addApiNearby: typeof addApiNearby;
  setUpApiDevice: typeof setUpApiDevice;
  removeApiDevice: typeof removeApiDevice;
  removeApiNearby: typeof removeApiNearby;
  uploadApiMedia: typeof uploadApiMedia;
  uploadApiVoice: typeof uploadApiVoice;
  askApiToLookIn: typeof askApiToLookIn;
  removeApiBookEntry: typeof removeApiBookEntry;
  createApiReminder: typeof createApiReminder;
  finishApiReminder: typeof finishApiReminder;
  markApiQuietUseful: typeof markApiQuietUseful;
  inviteApiNearby: typeof inviteApiNearby;
  registerApiPushDevice: typeof registerApiPushDevice;
  removeApiPushDevice: typeof removeApiPushDevice;
}

export interface ApiRuntime {
  capabilities?: ApiCapabilities;
  admission?: { config: PilotAdmission; permitsAccount: typeof pilotApiAccountAllowed };
  verifySession: SessionVerifier;
  /** Reads that answer in a member's own local day need the hour it is now. */
  now(): Date;
  openDatabase(): Promise<{ db: VelaDatabase; close(): Promise<void> }>;
  services: ApiReadServices;
  logger: Pick<Logger, "error">;
  writes?: {
    links?: {
      start: typeof startAccountLink;
      complete: typeof completeAccountLink;
      telegramBotUsername: string;
    };
    verifyActiveSession: SessionActivityChecker;
    clock: Clock;
    services: ApiWriteServices;
    /**
     * Creating a family: a token source for her invite, and the bot and regions it needs. Without
     * it `POST /v1/families` answers 404, as every write does without `writes`.
     */
    families?: Pick<ApiFamilyDeps, "random" | "config">;
    /**
     * Setting her phone up for the parent surface (ADR-35): the token source. Without it the device
     * routes answer 404.
     */
    devices?: {
      random: Random;
      config: { privacyNoticeUrls: Record<Lang, string> };
    };
    /**
     * What a committed write left behind — rows to hand to the queue, members to wake — is carried out
     * through these. Without them nothing is lost: `reconcile` re-drives the rows and ticks the members.
     */
    nudges?: ApiNudges;
    /**
     * Where the founder is told when a phone leaving an account, or an organiser leaving, leaves a
     * family with no organiser who can be told, and whether pushes are sent here (ADR-34). Without
     * it the device routes record devices and Leave leaves, and neither writes an alert.
     */
    alerts?: DeviceAlerts;
  };
  /**
   * Where photos from the app are kept (ADR-33): the store, and a token source for the keys an
   * upload mints. Undefined where there is nowhere to keep them, and `mediaOff` says why: an upload
   * answers 503 with that reason, a photo read 404, and `GET /v1/me` says `photos: false`.
   */
  media?: { store: MediaStore; random: Random };
  /** Why `media` is undefined; "media_storage_off" when it is left out. */
  mediaOff?: MediaUnavailableReason;
  /**
   * Whether pushes are sent here (ADR-34, `PUSH_SEND` "expo"). `GET /v1/me` says so, and a phone
   * counts toward how an organiser is told only when it is true. Left out, pushes are off.
   */
  push?: boolean;
}

interface RuntimeEnv {
  Variables: ApiSecurityEnv["Variables"] & {
    db: VelaDatabase;
    writeKey: string;
    writeInput: unknown;
    /** Her, on her own routes, as her phone's token names her (ADR-35). */
    deviceMember: Member;
  };
}

const NOT_FOUND: ApiErrorBody = {
  error: { code: "not_found", message: "Not found." },
};
/** `Authorization: Device <token>`: her phone's 43-character token (ADR-35). */
const DEVICE_AUTHORIZATION = /^Device ([A-Za-z0-9_-]{43})$/;
/** A media id as the read route takes one: a uuid, checked before any query. */
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An installation id as the device routes take one: a uuid, checked before the body is read. */
const INSTALLATION_ID = MEDIA_ID;
const FAMILY_NOT_FOUND: ApiErrorBody = {
  error: { code: "not_found", message: "Family not found." },
};
const INTERNAL: ApiErrorBody = {
  error: { code: "internal", message: "Internal server error." },
};
const UNAVAILABLE: ApiErrorBody = {
  error: { code: "unavailable", message: "Service temporarily unavailable." },
};

const INVALID: ApiErrorBody = {
  error: { code: "invalid", message: "Invalid request." },
};
const DAY_TAKEN: ApiErrorBody = {
  error: { code: "conflict", message: "That day already has an ask." },
};
const CONFLICT: ApiErrorBody = {
  error: { code: "conflict", message: "Request conflicts with an earlier operation." },
};
const RATE_LIMITED: ApiErrorBody = {
  error: { code: "rate_limited", message: "Too many requests." },
};
const UNAUTHENTICATED: ApiErrorBody = {
  error: { code: "unauthenticated", message: "Sign in required." },
};
/** What a refused photo is told, by `MediaRefusedError.reason` (ADR-33). */
const PHOTO_REFUSALS = {
  jpeg_only: "Only JPEG photos can be kept.",
  malformed: "That photo could not be read.",
  dimensions: "That photo is too large or too narrow.",
  photo_limit: "Too many photos for now.",
  m4a_only: "Only an .m4a recording can be kept.",
  voice_limit: "Too many voices for now.",
} as const;
const MAX_BODY_BYTES = 4096;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i;

type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 408 | 413 };
const MAX_BODY_READ_MS = 10_000;

function cancelBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  logger: Pick<Logger, "error">,
): void {
  void reader.cancel().catch((error: unknown) => {
    logger.error("api_body_cancel_failed", { error: errorLabel(error) });
  });
}

async function readWriteBody(request: Request, logger: Pick<Logger, "error">): Promise<BodyResult> {
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) {
    return { ok: false, status: 413 };
  }
  if (request.body === null) return { ok: false, status: 400 };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = request.body.getReader();
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), MAX_BODY_READ_MS);
    });
    const bytes = new Uint8Array(MAX_BODY_BYTES);
    let size = 0;
    for (let reads = 0; reads <= MAX_BODY_BYTES; reads++) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk === null) {
        cancelBody(reader, logger);
        return { ok: false, status: 408 };
      }
      const { done, value } = chunk;
      if (done) {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
          bytes.subarray(0, size),
        );
        return { ok: true, value: JSON.parse(text) };
      }
      if (value.byteLength > MAX_BODY_BYTES - size) {
        cancelBody(reader, logger);
        return { ok: false, status: 413 };
      }
      if (reads === MAX_BODY_BYTES) {
        cancelBody(reader, logger);
        return { ok: false, status: 400 };
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    reader?.releaseLock();
  }
  return { ok: false, status: 400 };
}

/** Any contract schema: the service parses the body again, so the middleware passes it on as is. */
interface WriteSchema {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

function validateWrite(
  schema: WriteSchema,
  logger: Pick<Logger, "error">,
): MiddlewareHandler<RuntimeEnv> {
  return async (c, next) => {
    const key = ApiIdempotencyKey.safeParse(c.req.header("Idempotency-Key"));
    if (!key.success) return c.json(INVALID, 400);
    const encoding = c.req.header("Content-Encoding");
    if (
      !JSON_CONTENT_TYPE.test(c.req.header("Content-Type") ?? "") ||
      (encoding !== undefined && encoding.toLowerCase() !== "identity")
    ) {
      return c.json(INVALID, 415);
    }
    const body = await readWriteBody(c.req.raw, logger);
    if (!body.ok) return c.json(INVALID, body.status);
    const input = schema.safeParse(body.value);
    if (!input.success) return c.json(INVALID, 400);
    c.set("writeKey", key.data);
    c.set("writeInput", input.data);
    await next();
    return c.res;
  };
}

export function createApiApp(runtime: ApiRuntime): Hono<RuntimeEnv> {
  const app = new Hono<RuntimeEnv>();
  const authenticate = createApiAuthentication<RuntimeEnv>(runtime.verifySession);
  const withDatabase: MiddlewareHandler<RuntimeEnv> = async (c, next) => {
    const handle = await runtime.openDatabase();
    try {
      c.set("db", handle.db);
      const admission = runtime.admission;
      const identity = c.get("session");
      const removal = c.req.path.endsWith("/left") || c.req.path.endsWith("/remove");
      if (
        admission !== undefined &&
        !removal &&
        (identity === undefined ||
          !(await admission.permitsAccount(handle.db, identity, admission.config)))
      )
        return c.json(NOT_FOUND, 404);
      await next();
      return;
    } finally {
      try {
        await handle.close();
      } catch (error) {
        runtime.logger.error("api_database_close_failed", { error: errorLabel(error) });
      }
    }
  };
  app.get("/v1/capabilities", (c) => {
    c.header("cache-control", "no-store");
    if (c.req.method === "HEAD") return c.json(NOT_FOUND, 404);
    return c.json(
      ApiCapabilities.parse(
        runtime.capabilities ?? {
          pilot: false,
          telegram_first: false,
          english_only: false,
          memory: false,
          book: false,
          parent_app: true,
          billing: true,
        },
      ),
      200,
    );
  });

  app.onError(
    withApiErrorNoStore<RuntimeEnv>((error, c) => {
      if (error instanceof ApiIdempotencyError) {
        if (error.code === "invalid") return c.json(INVALID, 400);
        if (error.code === "conflict") return c.json(CONFLICT, 409);
        if (error.code === "rate_limited") return c.json(RATE_LIMITED, 429);
        if (error.code === "unavailable") {
          runtime.logger.error("api_request_failed", { error: errorLabel(error) });
          return c.json(UNAVAILABLE, 503);
        }
      }
      if (error instanceof AlreadyOrganiserError) {
        const running: ApiErrorBody = {
          error: {
            code: "conflict",
            message: "This account already runs a family.",
            details: { reason: "already_organiser" },
          },
        };
        return c.json(running, 409);
      }
      if (error instanceof QuietUsefulRefusedError) {
        const refused: ApiErrorBody = {
          error: {
            code: "conflict",
            message: "This morning is not settled yet.",
            details: { reason: error.reason },
          },
        };
        return c.json(refused, 409);
      }
      if (error instanceof LookInRefusedError || error instanceof NearbyInviteRefusedError) {
        const said = {
          settled: "This morning is already settled.",
          cannot_be_asked: "They have not said yes on Telegram, so they cannot be asked here.",
          already_listed: "They have already said yes.",
        } as const;
        const refused: ApiErrorBody = {
          error: {
            code: "conflict",
            message: said[error.reason],
            details: { reason: error.reason },
          },
        };
        return c.json(refused, 409);
      }
      if (error instanceof ReplyRefusedError) {
        const answer = {
          her_own: {
            code: "forbidden",
            message: "She cannot reply to her own exchange.",
            status: 403,
          },
          not_answered: { code: "conflict", message: "She has not answered yet.", status: 409 },
          // The voice or photo a reply names is gone, or not the replier's own in this family.
          voice_missing: {
            code: "not_found",
            message: "That voice is no longer here.",
            status: 404,
          },
          photo_missing: {
            code: "not_found",
            message: "That photo is no longer here.",
            status: 404,
          },
        } as const;
        const said = answer[error.reason];
        const refused: ApiErrorBody = {
          error: { code: said.code, message: said.message, details: { reason: error.reason } },
        };
        return c.json(refused, said.status);
      }
      if (error instanceof MemberChangeRefusedError) {
        const refused: ApiErrorBody = {
          error: {
            code: "conflict",
            message:
              error.reason === "last_organiser"
                ? "Someone else who organises the family has to be active first."
                : "A kept light is paused from her own chat.",
            details: { reason: error.reason },
          },
        };
        return c.json(refused, 409);
      }
      if (error instanceof NearbyRefusedError) {
        const refused: ApiErrorBody = {
          error: {
            code: "conflict",
            message:
              error.reason === "full"
                ? "Two people nearby is the most."
                : "Leave the number out: it is added with their yes.",
            details: { reason: error.reason },
          },
        };
        return c.json(refused, 409);
      }
      if (error instanceof TrialRefusedError) {
        const refused: ApiErrorBody = {
          error: {
            code: "conflict",
            message:
              error.reason === "not_answered_yet"
                ? "The trial starts after her first answer."
                : "Her light is not on.",
            details: { reason: error.reason },
          },
        };
        return c.json(refused, 409);
      }
      if (error instanceof AskDayTakenError) {
        const taken: ApiErrorBody = {
          error: {
            code: "conflict",
            message: DAY_TAKEN.error.message,
            details: {
              taken_by: error.conflict.taken_by,
              date_alternative: error.conflict.date_alternative,
            },
          },
        };
        return c.json(taken, 409);
      }
      if (error instanceof MediaRefusedError) {
        const refused: ApiErrorBody = {
          error: {
            code:
              error.reason === "photo_limit" || error.reason === "voice_limit"
                ? "rate_limited"
                : "invalid",
            message: PHOTO_REFUSALS[error.reason],
            details: { reason: error.reason },
          },
        };
        return c.json(
          refused,
          error.reason === "jpeg_only" || error.reason === "m4a_only"
            ? 415
            : error.reason === "photo_limit" || error.reason === "voice_limit"
              ? 429
              : 400,
        );
      }
      if (error instanceof WithdrawTooLateError) {
        // Her morning is prepared with this ask, or it was sent (spec §19).
        const refused: ApiErrorBody = {
          error: {
            code: "conflict",
            message: "Her morning already holds this ask.",
            details: { reason: "too_late" },
          },
        };
        return c.json(refused, 409);
      }
      if (error instanceof AwayRefusedError) {
        // A first day before her today, or a day past the 90 days an away may reach (spec §8).
        const refused: ApiErrorBody = {
          error: {
            code: "invalid",
            message: "An away starts today or later, and within 90 days.",
            details: { reason: "away_dates" },
          },
        };
        return c.json(refused, 400);
      }
      if (error instanceof FactMissingError) {
        // The fact is gone, past, not of the family, or about the caller (spec §12).
        const missing: ApiErrorBody = {
          error: {
            code: "not_found",
            message: "That is no longer coming up.",
            details: { reason: "fact_missing" },
          },
        };
        return c.json(missing, 404);
      }
      if (error instanceof AskVoiceMissingError) {
        // The voice hello is not the asker's own recording, or will not last to her morning.
        const missing: ApiErrorBody = {
          error: {
            code: "not_found",
            message: "That voice hello is no longer here.",
            details: { reason: "voice_missing" },
          },
        };
        return c.json(missing, 404);
      }
      if (error instanceof AskPhotoMissingError) {
        // A photo the ask names is gone or not the asker's to ask with (ADR-33): the app offers
        // to choose it again.
        const missing: ApiErrorBody = {
          error: {
            code: "not_found",
            message: "That photo is no longer here.",
            details: { reason: "photo_missing" },
          },
        };
        return c.json(missing, 404);
      }
      if (error instanceof VelaError) {
        if (error.code === "not_found") return c.json(NOT_FOUND, 404);
        if (error.code === "invalid_payload") return c.json(INVALID, 400);
      }
      runtime.logger.error("api_request_failed", { error: errorLabel(error) });
      return error instanceof SessionVerificationUnavailable
        ? c.json(UNAVAILABLE, 503)
        : c.json(INTERNAL, 500);
    }),
  );
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    if (
      c.req.raw.method === "HEAD" ||
      (c.req.raw.method !== "GET" &&
        (!runtime.writes || !["POST", "PATCH"].includes(c.req.raw.method)))
    ) {
      return c.json(NOT_FOUND, 404);
    }
    await next();
    if (c.res.headers.get("content-disposition") === "inline") {
      c.res.headers.set("cache-control", "private, no-store");
    }
    return c.res;
  });

  // Her phone's routes (ADR-35): no Clerk session, her device token instead, which names her.
  const authenticateDevice: MiddlewareHandler<RuntimeEnv> = async (c, next) => {
    const presented = DEVICE_AUTHORIZATION.exec(c.req.header("Authorization") ?? "");
    const member =
      presented === null
        ? null
        : await runtime.services.memberOfDeviceToken(c.get("db"), presented[1] ?? "");
    if (member === null) return c.json(UNAUTHENTICATED, 401);
    c.set("deviceMember", member);
    await next();
    return c.res;
  };
  app.get("/v1/device", withDatabase, authenticateDevice, (c) => {
    const her = c.get("deviceMember");
    return c.json(
      ApiDeviceMember.parse({
        member_id: her.id,
        display_name: her.displayName,
        address_form: her.addressForm ?? her.displayName,
        language: her.language,
        status: her.status,
        arrival_time: her.arrivalTime,
      }),
    );
  });

  // What Vela sent her phone, newest first; her taps and words go to the pilot Worker's
  // /device/messages, beside the Telegram webhook, where the inbound router runs (ADR-35).
  app.get("/v1/device/messages", withDatabase, authenticateDevice, async (c) => {
    const messages = await runtime.services.loadDeviceMessages(c.get("db"), c.get("deviceMember"));
    return c.json(ApiDeviceMessages.parse({ messages }));
  });
  // A photo or voice note of her message, by her device token (ADR-35).
  app.get("/v1/device/media/:mediaId", withDatabase, authenticateDevice, async (c) => {
    const store = runtime.media?.store;
    if (store === undefined || !MEDIA_ID.test(c.req.param("mediaId"))) {
      return c.json(NOT_FOUND, 404);
    }
    const photo = await runtime.services.readDeviceMedia(
      c.get("db"),
      c.get("deviceMember"),
      c.req.param("mediaId"),
      store,
    );
    if (photo === null) return c.json(NOT_FOUND, 404);
    return c.body(photo.body, 200, {
      "content-type": photo.mime,
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    });
  });

  app.get("/v1/me", authenticate, withDatabase, async (c) => {
    const me = await runtime.services.loadApiMe(c.get("db"), c.get("session"));
    return me === null
      ? c.json(NOT_FOUND, 404)
      : c.json(
          ApiMe.parse({ ...me, photos: runtime.media !== undefined, push: runtime.push === true }),
        );
  });
  app.get(
    "/v1/families/:familyId/plan",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const plan = await runtime.services.loadApiFamilyPlan(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
      );
      return plan === null ? c.json(FAMILY_NOT_FOUND, 404) : c.json(ApiFamilyPlan.parse(plan));
    },
  );
  app.get(
    "/v1/families/:familyId/lights",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const lights = await runtime.services.loadApiLights(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
        runtime.now(),
      );
      return lights === null
        ? c.json(FAMILY_NOT_FOUND, 404)
        : c.json(lights.map((light) => MemberLight.parse(light)));
    },
  );
  app.get(
    "/v1/families/:familyId/today",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const day = await runtime.services.loadApiToday(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
        runtime.now(),
      );
      return day === null ? c.json(FAMILY_NOT_FOUND, 404) : c.json(ApiToday.parse(day));
    },
  );
  app.get(
    "/v1/families/:familyId",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const family = await runtime.services.loadApiFamily(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
        runtime.push === true,
      );
      return family === null ? c.json(FAMILY_NOT_FOUND, 404) : c.json(ApiFamily.parse(family));
    },
  );
  app.get(
    "/v1/families/:familyId/exchanges",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const limit = Number(c.req.query("limit"));
      const page = await runtime.services.loadApiExchanges(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
        runtime.now(),
        {
          cursor: c.req.query("cursor"),
          ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
        },
      );
      return page === null ? c.json(FAMILY_NOT_FOUND, 404) : c.json(ApiExchangePage.parse(page));
    },
  );
  // The family book (ADR-39): every live member reads it; reading never needs Vela Light.
  app.get(
    "/v1/families/:familyId/book",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const book = await runtime.services.loadApiBook(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
      );
      return book === null ? c.json(FAMILY_NOT_FOUND, 404) : c.json(ApiBook.parse(book));
    },
  );
  // Reminders to ask her how something went (spec §12): the caller's own, and the family's coming
  // dated facts they could be reminded of. Any live member of the family.
  app.get(
    "/v1/families/:familyId/reminders",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const found = await runtime.services.loadApiReminders(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
        runtime.now(),
      );
      return found === null ? c.json(FAMILY_NOT_FOUND, 404) : c.json(ApiReminders.parse(found));
    },
  );
  // One exchange, for a link or a tapped notice: the service reads its family and answers null for
  // anything the caller may not see, which is 404 without saying whether it exists.
  app.get("/v1/exchanges/:exchangeId", authenticate, withDatabase, async (c) => {
    const exchange = await runtime.services.loadApiExchange(
      c.get("db"),
      c.get("session"),
      c.req.param("exchangeId"),
      runtime.now(),
    );
    return exchange === null ? c.json(NOT_FOUND, 404) : c.json(ApiExchangeSummary.parse(exchange));
  });
  // Organisers only: the read carries her week's counts, which she is never shown (spec §8). A
  // `member` that is not her, or no `member`, is 404.
  app.get(
    "/v1/families/:familyId/weekly-read",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>(
        (identity, familyId, requiredRole) =>
          runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
        "organiser",
      )(c, next),
    async (c) => {
      const read = await runtime.services.loadApiWeeklyRead(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
        c.req.query("member"),
        runtime.now(),
      );
      return read === null ? c.json(NOT_FOUND, 404) : c.json(ApiWeeklyRead.parse(read));
    },
  );
  // Organisers only: the family's own quiet notices are hers (spec §8). Vela's months are the
  // service's to filter, so that no one family can be read out of them.
  app.get(
    "/v1/families/:familyId/precision",
    authenticate,
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>(
        (identity, familyId, requiredRole) =>
          runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
        "organiser",
      )(c, next),
    async (c) => {
      const precision = await runtime.services.loadApiPrecision(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
        runtime.now(),
      );
      return precision === null ? c.json(NOT_FOUND, 404) : c.json(ApiPrecision.parse(precision));
    },
  );
  // The event names its family, so no family middleware: the service answers organisers only.
  app.get("/v1/quiet/:quietEventId", authenticate, withDatabase, async (c) => {
    const notice = await runtime.services.loadApiQuiet(
      c.get("db"),
      c.get("session"),
      c.req.param("quietEventId"),
    );
    return notice === null ? c.json(NOT_FOUND, 404) : c.json(ApiQuietNotice.parse(notice));
  });
  // A photo or stored voice the family may see (ADR-33, ADR-39), proxied from the store: there is no signed or public URL.
  // Without a store, and for an id that is not a uuid, it is 404 before a connection is opened.
  app.get(
    "/v1/families/:familyId/media/:mediaId",
    authenticate,
    async (c, next) => {
      if (runtime.media === undefined || !MEDIA_ID.test(c.req.param("mediaId"))) {
        return c.json(NOT_FOUND, 404);
      }
      await next();
      return c.res;
    },
    withDatabase,
    (c, next) =>
      createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
        runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
      )(c, next),
    async (c) => {
      const media = runtime.media;
      if (media === undefined) return c.json(NOT_FOUND, 404);
      const role = c.req.query("role") ?? "original";
      if (role !== "original") return c.json(NOT_FOUND, 404);
      const photo = await runtime.services.readApiMedia(
        c.get("db"),
        c.get("session"),
        c.req.param("familyId"),
        c.req.param("mediaId"),
        media.store,
        "original",
      );
      if (photo === null) return c.json(NOT_FOUND, 404);
      c.header("cache-control", "private, no-store");
      return c.body(photo.body, 200, {
        "cache-control": "private, no-store",
        "content-type": photo.mime,
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      });
    },
  );
  const writes = runtime.writes;
  if (writes) {
    const checkActivity: MiddlewareHandler<RuntimeEnv> = async (c, next) => {
      if ((await writes.verifyActiveSession(c.get("session"))) !== true) {
        return c.json(UNAUTHENTICATED, 401);
      }
      await next();
      return c.res;
    };
    const routes = [
      ["POST", "/v1/me/provision", ApiAccountProfile, writes.services.provisionApiAccount],
      ["PATCH", "/v1/me", ApiAccountPatch, writes.services.updateApiAccount],
    ] as const;
    for (const [method, path, schema, service] of routes) {
      app.on(
        method,
        path,
        authenticate,
        validateWrite(schema, runtime.logger),
        checkActivity,
        withDatabase,
        async (c) => {
          const input = c.get("writeInput");
          if (
            runtime.admission !== undefined &&
            typeof input === "object" &&
            input !== null &&
            "language" in input &&
            input.language !== "en"
          )
            return c.json(
              {
                error: {
                  code: "invalid",
                  message: "This trial uses English.",
                  details: { reason: "pilot_english_only" },
                },
              },
              400,
            );
          const result = await service(
            { db: c.get("db"), clock: writes.clock },
            c.get("session"),
            c.get("writeKey"),
            c.get("writeInput"),
          );
          if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
            throw new Error("Invalid API mutation response");
          }
          const user = ApiUser.parse(result.response.body);
          c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
          return c.json(user, 200);
        },
      );
    }
    const links = writes.links;
    if (links !== undefined) {
      app.post(
        "/v1/me/link",
        authenticate,
        validateWrite(ApiLinkStartInput, runtime.logger),
        checkActivity,
        withDatabase,
        async (c) => {
          if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(links.telegramBotUsername))
            return c.json(UNAVAILABLE, 503);
          const result = await links.start(
            { db: c.get("db"), clock: writes.clock },
            c.get("session"),
            c.get("writeKey"),
          );
          if (result.response.status !== 201 || typeof result.replayed !== "boolean")
            throw new Error("Invalid account link response");
          const challenge = ApiLinkChallenge.parse(result.response.body);
          const telegramUrl = new URL(`https://t.me/${links.telegramBotUsername}`);
          telegramUrl.searchParams.set("start", `link_${challenge.challenge_id}`);
          c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
          return c.json(
            ApiLinkChallenge.parse({ ...challenge, telegram_url: telegramUrl.toString() }),
            201,
          );
        },
      );
      app.post(
        "/v1/me/link/complete",
        authenticate,
        validateWrite(ApiLinkCompleteInput, runtime.logger),
        checkActivity,
        withDatabase,
        async (c) => {
          const input = ApiLinkCompleteInput.parse(c.get("writeInput"));
          const result = await links.complete(
            {
              db: c.get("db"),
              clock: writes.clock,
              ...(runtime.admission === undefined
                ? {}
                : { pilotAdmission: runtime.admission.config }),
            },
            c.get("session"),
            c.get("writeKey"),
            input.challenge_id,
            input.code,
          );
          if (result.response.status !== 200 || typeof result.replayed !== "boolean")
            throw new Error("Invalid account link response");
          c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
          return c.json(ApiLinkOutcome.parse(result.response.body), 200);
        },
      );
    }
    app.post(
      "/v1/families/:familyId/exchanges",
      authenticate,
      validateWrite(ComposeAsk, runtime.logger),
      checkActivity,
      withDatabase,
      (c, next) =>
        createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
          runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
        )(c, next),
      async (c) => {
        const result = await writes.services.composeApiAsk(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 201 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const ask = ApiComposedAsk.parse(result.response.body);
        // Committed: now the line that tells the family group tomorrow's morning is taken.
        await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
          runtime.logger.error(event, fields),
        );
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ask, 201);
      },
    );
    const familyDeps = writes.families;
    if (familyDeps !== undefined) {
      // No family exists yet, so there is no family middleware: the caller becomes its organiser.
      app.post(
        "/v1/families",
        authenticate,
        validateWrite(CreateFamily, runtime.logger),
        checkActivity,
        withDatabase,
        async (c) => {
          if (runtime.admission !== undefined)
            return c.json(
              {
                error: {
                  code: "forbidden",
                  message: "Start your trial family in Telegram, then link it here.",
                  details: { reason: "pilot_telegram_first" },
                },
              },
              403,
            );
          const result = await writes.services.createApiFamily(
            { db: c.get("db"), clock: writes.clock, ...familyDeps },
            c.get("session"),
            c.get("writeKey"),
            c.get("writeInput"),
          );
          if (result.response.status !== 201 || typeof result.replayed !== "boolean") {
            throw new Error("Invalid API mutation response");
          }
          const created = ApiCreatedFamily.parse(result.response.body);
          c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
          return c.json(created, 201);
        },
      );
    }
    app.post(
      "/v1/families/:familyId/plan/trial",
      authenticate,
      validateWrite(StartTrial, runtime.logger),
      checkActivity,
      withDatabase,
      (c, next) =>
        createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
          runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
        )(c, next),
      async (c) => {
        if (runtime.admission !== undefined) return c.json(NOT_FOUND, 404);
        const result = await writes.services.startApiTrial(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const trial = ApiTrial.parse(result.response.body);
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(trial, 200);
      },
    );
    // Her phone for the parent surface (ADR-35), set up by an organiser signed in on it. The answer
    // is a credential, so it is never kept in a receipt and never replayed: a retry sets up anew.
    const devices = writes.devices;
    if (devices) {
      app.post(
        "/v1/families/:familyId/members/:memberId/device",
        authenticate,
        validateWrite(DeviceWrite, runtime.logger),
        checkActivity,
        withDatabase,
        (c, next) =>
          createFamilyAuthorization<RuntimeEnv>(
            (identity, familyId, requiredRole) =>
              runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
            "organiser",
          )(c, next),
        async (c) => {
          if (runtime.admission !== undefined) return c.json(NOT_FOUND, 404);
          const set = await writes.services.setUpApiDevice(
            {
              db: c.get("db"),
              clock: writes.clock,
              random: devices.random,
              config: devices.config,
            },
            c.get("session"),
            c.req.param("familyId"),
            c.req.param("memberId"),
          );
          // Her consent request, set up before her yes, goes out now; reconcile is the backstop.
          await runAfterCommit(writes.nudges, set.after, writes.clock.now(), (event, fields) =>
            runtime.logger.error(event, fields),
          );
          return c.json(ApiDeviceSetUp.parse(set.body), 201);
        },
      );
      app.post(
        "/v1/families/:familyId/members/:memberId/device/remove",
        authenticate,
        validateWrite(DeviceWrite, runtime.logger),
        checkActivity,
        withDatabase,
        (c, next) =>
          createFamilyAuthorization<RuntimeEnv>(
            (identity, familyId, requiredRole) =>
              runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
            "organiser",
          )(c, next),
        async (c) => {
          const result = await writes.services.removeApiDevice(
            { db: c.get("db"), clock: writes.clock },
            c.get("session"),
            c.get("writeKey"),
            c.req.param("familyId"),
            c.req.param("memberId"),
          );
          if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
            throw new Error("Invalid API mutation response");
          }
          c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
          return c.json(ApiDeviceRemoved.parse(result.response.body), 200);
        },
      );
    }
    // Someone nearby her (spec A3), by name and relation; nobody is contacted (API contract
    // § "People nearby"). Organisers only, which the service decides inside its transaction.
    app.post(
      "/v1/families/:familyId/nearby",
      authenticate,
      validateWrite(AddNearby, runtime.logger),
      checkActivity,
      withDatabase,
      (c, next) =>
        createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
          runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
        )(c, next),
      async (c) => {
        const result = await writes.services.addApiNearby(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          c.get("writeInput"),
        );
        const status = result.response.status;
        if ((status !== 200 && status !== 201) || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const contact = ApiNearbyContact.parse(result.response.body);
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(contact, status);
      },
    );
    app.post(
      "/v1/nearby/:contactId/remove",
      authenticate,
      validateWrite(RemoveNearby, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.removeApiNearby(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("contactId"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const removed = ApiNearbyRemoved.parse(result.response.body);
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(removed, 200);
      },
    );
    app.post(
      "/v1/families/:familyId/members/:memberId/pause",
      authenticate,
      validateWrite(PauseMember, runtime.logger),
      checkActivity,
      withDatabase,
      (c, next) =>
        createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
          runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
        )(c, next),
      async (c) => {
        const result = await writes.services.pauseApiMember(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          c.req.param("memberId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const state = ApiMemberPause.parse(result.response.body);
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(state, 200);
      },
    );
    // Away mode (spec §8): any member of her family sets it or ends it; her schedule decides again
    // after the commit.
    app.post(
      "/v1/families/:familyId/members/:memberId/away",
      authenticate,
      validateWrite(SetAway, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.setApiAway(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          c.req.param("memberId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 201 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
          runtime.logger.error(event, fields),
        );
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiAway.parse(result.response.body), 201);
      },
    );
    // The asker takes an ask back before her morning is prepared (spec §19).
    app.post(
      "/v1/exchanges/:exchangeId/withdraw",
      authenticate,
      validateWrite(WithdrawAsk, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.withdrawApiAsk(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("exchangeId"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiWithdrawn.parse(result.response.body), 200);
      },
    );
    // She has died (spec §19): any member of her family says so, and nothing about her is sent again.
    app.post(
      "/v1/families/:familyId/members/:memberId/deceased",
      authenticate,
      validateWrite(MarkDeceased, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.markApiDeceased(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          c.req.param("memberId"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
          runtime.logger.error(event, fields),
        );
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiDeceased.parse(result.response.body), 200);
      },
    );
    app.post(
      "/v1/away/:awayId/end",
      authenticate,
      validateWrite(EndAway, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.endApiAway(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("awayId"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
          runtime.logger.error(event, fields),
        );
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiAway.parse(result.response.body), 200);
      },
    );
    // Where the founder is told (ADR-34): Leave, which can take a family's last organiser who can
    // be told, and the phone routes below write the alert and hand it over after the commit.
    const alerts = writes.alerts === undefined ? {} : { alerts: writes.alerts };
    // No family middleware: once the caller has left they are no longer a live member, and the
    // replay of the leave itself must still answer. The service checks the membership is theirs.
    app.post(
      "/v1/families/:familyId/members/:memberId/left",
      authenticate,
      validateWrite(LeaveFamily, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.leaveApiFamily(
          { db: c.get("db"), clock: writes.clock, ...alerts },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          c.req.param("memberId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const left = ApiLeft.parse(result.response.body);
        // Committed: now the founder's alert, when the one who left was the last who could be told.
        await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
          runtime.logger.error(event, fields),
        );
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(left, 200);
      },
    );
    for (const action of ["fine", "wait"] as const) {
      app.post(
        `/v1/quiet/:quietEventId/${action}`,
        authenticate,
        validateWrite(QuietAction, runtime.logger),
        checkActivity,
        withDatabase,
        async (c) => {
          const result = await writes.services.resolveApiQuiet(
            { db: c.get("db"), clock: writes.clock },
            c.get("session"),
            c.get("writeKey"),
            c.req.param("quietEventId"),
            action,
            c.get("writeInput"),
          );
          if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
            throw new Error("Invalid API mutation response");
          }
          const state = ApiQuietState.parse(result.response.body);
          // Committed: now the messages to the others who were told, and her scheduler's alarm.
          await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
            runtime.logger.error(event, fields),
          );
          c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
          return c.json(state, 200);
        },
      );
    }
    // The organisers' verdict on a settled quiet morning, for the precision page (spec §18).
    app.post(
      "/v1/quiet/:quietEventId/useful",
      authenticate,
      validateWrite(QuietUseful, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.markApiQuietUseful(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("quietEventId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiQuietState.parse(result.response.body), 200);
      },
    );
    // A visible, unlocked Weekly Read opening; fetching the read above never records an event.
    app.post(
      "/v1/weekly-reads/:weeklyReadId/opened",
      authenticate,
      validateWrite(OpenWeeklyRead, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.openApiWeeklyRead(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("weeklyReadId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiWeeklyReadOpened.parse(result.response.body), 200);
      },
    );
    // An organiser takes a story out of the family book (ADR-39); the service reads its family.
    app.post(
      "/v1/book/:exchangeId/remove",
      authenticate,
      validateWrite(RemoveBookEntry, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.removeApiBookEntry(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("exchangeId"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiBookRemoved.parse(result.response.body), 200);
      },
    );
    // "Remind me to ask" (spec §12): a reminder exists only after this tap.
    app.post(
      "/v1/families/:familyId/reminders",
      authenticate,
      validateWrite(CreateReminder, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.createApiReminder(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 201 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiReminder.parse(result.response.body), 201);
      },
    );
    app.post(
      "/v1/reminders/:reminderId/done",
      authenticate,
      validateWrite(FinishReminder, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.finishApiReminder(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("reminderId"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ApiReminderDone.parse(result.response.body), 200);
      },
    );
    // "Ask them to look in" (ADR-36): the service reads the family from the event under its lock.
    app.post(
      "/v1/quiet/:quietEventId/ask-to-check",
      authenticate,
      validateWrite(AskToLookIn, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.askApiToLookIn(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("quietEventId"),
          c.get("writeInput"),
        );
        if (
          (result.response.status !== 200 && result.response.status !== 201) ||
          typeof result.replayed !== "boolean"
        ) {
          throw new Error("Invalid API mutation response");
        }
        const ask = ApiLookInAsk.parse(result.response.body);
        // Committed: now the message to them, in the organiser's name.
        await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
          runtime.logger.error(event, fields),
        );
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(ask, result.response.status);
      },
    );
    // The link to share with someone nearby (ADR-36). Its answer is a credential, so, like her
    // phone's set-up, it is not kept in a receipt: a retry mints a new link that voids the old.
    const families = writes.families;
    if (families) {
      app.post(
        "/v1/nearby/:contactId/invite",
        authenticate,
        validateWrite(InviteNearby, runtime.logger),
        checkActivity,
        withDatabase,
        async (c) => {
          const invite = await writes.services.inviteApiNearby(
            {
              db: c.get("db"),
              clock: writes.clock,
              random: families.random,
              config: families.config,
            },
            c.get("session"),
            c.req.param("contactId"),
          );
          return c.json(ApiNearbyInvite.parse(invite), 201);
        },
      );
    }
    // The path names an exchange, not a family, so there is no family middleware here: the
    // service reads the family from the exchange under its row lock and answers 404 itself.
    app.post(
      "/v1/exchanges/:exchangeId/replies",
      authenticate,
      validateWrite(ComposeReply, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.replyToApiExchange(
          { db: c.get("db"), clock: writes.clock },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("exchangeId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 201 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const reply = ApiReply.parse(result.response.body);
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(reply, 201);
      },
    );
    // Push (ADR-34): this installation's phone, registered or refreshed for the signed-in account,
    // and taken away at sign-out. Account-scoped: an unknown or deleted account is 404, and there
    // is no 403, since another account's installation answers `removed: false`. A phone leaving a
    // family with nobody to tell writes the founder's alert, handed to the queue after the commit.
    app.post(
      "/v1/me/devices",
      authenticate,
      validateWrite(RegisterPushDevice, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.registerApiPushDevice(
          { db: c.get("db"), clock: writes.clock, ...alerts },
          c.get("session"),
          c.get("writeKey"),
          c.get("writeInput"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const device = ApiPushDevice.parse(result.response.body);
        await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
          runtime.logger.error(event, fields),
        );
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(device, 200);
      },
    );
    app.post(
      "/v1/me/devices/:installationId/remove",
      authenticate,
      async (c, next) => {
        if (!INSTALLATION_ID.test(c.req.param("installationId"))) {
          return c.json(NOT_FOUND, 404);
        }
        await next();
        return c.res;
      },
      validateWrite(RemovePushDevice, runtime.logger),
      checkActivity,
      withDatabase,
      async (c) => {
        const result = await writes.services.removeApiPushDevice(
          { db: c.get("db"), clock: writes.clock, ...alerts },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("installationId"),
          c.get("writeInput"),
        );
        if (result.response.status !== 200 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const removed = ApiPushDeviceRemoved.parse(result.response.body);
        await runAfterCommit(writes.nudges, result.after, writes.clock.now(), (event, fields) =>
          runtime.logger.error(event, fields),
        );
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(removed, 200);
      },
    );
    // A photo for an ask (ADR-33): the JPEG's own bytes, not JSON. Every cheap refusal comes before
    // the body is read: nowhere to keep it (503), the headers (400, 415, 413), the write limit and
    // the live session (429, 401), the family (404). Only then are up to 1 MiB read, for up to
    // 60 seconds, and the service cleans, stores and records it.
    app.post(
      "/v1/families/:familyId/media",
      authenticate,
      async (c, next) => {
        if (runtime.media === undefined) {
          const off: ApiErrorBody = {
            error: {
              code: "unavailable",
              message: "Photos are not switched on here.",
              details: { reason: runtime.mediaOff ?? "media_storage_off" },
            },
          };
          return c.json(off, 503);
        }
        await next();
        return c.res;
      },
      uploadHeaders<RuntimeEnv>(MAX_UPLOAD_BYTES),
      checkActivity,
      withDatabase,
      (c, next) =>
        createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
          runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
        )(c, next),
      async (c) => {
        const media = runtime.media;
        if (media === undefined) throw new Error("photo upload without a store");
        const body = await readUploadBody(
          c.req.raw,
          runtime.logger,
          MAX_UPLOAD_BYTES,
          MAX_UPLOAD_READ_MS,
          MAX_UPLOAD_READS,
        );
        if (!body.ok) return c.json(INVALID, body.status);
        const result = await writes.services.uploadApiMedia(
          {
            db: c.get("db"),
            clock: writes.clock,
            random: media.random,
            store: media.store,
            logger: runtime.logger,
          },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          body.bytes,
        );
        if (result.response.status !== 201 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const uploaded = ApiUploadedMedia.parse(result.response.body);
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(uploaded, 201);
      },
    );
    // A voice for a reply from the app (spec §14.1 A8): an `.m4a` of at most 3 MiB, kept as it is,
    // then named by the reply as `{voice}`; refused as a photo is, with its own reasons.
    app.post(
      "/v1/families/:familyId/voice",
      authenticate,
      async (c, next) => {
        if (runtime.media === undefined) {
          const off: ApiErrorBody = {
            error: {
              code: "unavailable",
              message: "Voices are not switched on here.",
              details: { reason: runtime.mediaOff ?? "media_storage_off" },
            },
          };
          return c.json(off, 503);
        }
        await next();
        return c.res;
      },
      uploadHeaders<RuntimeEnv>(MAX_VOICE_BYTES, M4A_CONTENT_TYPE),
      checkActivity,
      withDatabase,
      (c, next) =>
        createFamilyAuthorization<RuntimeEnv>((identity, familyId, requiredRole) =>
          runtime.services.authorizeFamilyAccess(c.get("db"), identity, familyId, requiredRole),
        )(c, next),
      async (c) => {
        const media = runtime.media;
        if (media === undefined) throw new Error("voice upload without a store");
        const body = await readUploadBody(
          c.req.raw,
          runtime.logger,
          MAX_VOICE_BYTES,
          MAX_UPLOAD_READ_MS,
          MAX_UPLOAD_READS,
        );
        if (!body.ok) return c.json(INVALID, body.status);
        const duration = Number(c.req.header("X-Duration-Ms") ?? "");
        const result = await writes.services.uploadApiVoice(
          {
            db: c.get("db"),
            clock: writes.clock,
            random: media.random,
            store: media.store,
            logger: runtime.logger,
          },
          c.get("session"),
          c.get("writeKey"),
          c.req.param("familyId"),
          body.bytes,
          Number.isFinite(duration) ? duration : null,
        );
        if (result.response.status !== 201 || typeof result.replayed !== "boolean") {
          throw new Error("Invalid API mutation response");
        }
        const uploaded = ApiUploadedVoice.parse(result.response.body);
        c.header("Idempotency-Replayed", result.replayed ? "true" : "false");
        return c.json(uploaded, 201);
      },
    );
  }
  app.notFound((c) => c.json(NOT_FOUND, 404));

  return app;
}
