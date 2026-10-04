import type {
  ApiAccountPatch,
  ApiAccountProfile,
  ApiAskConflict,
  ApiAway,
  ApiBook,
  ApiBookRemoved,
  ApiComposedAsk,
  ApiCreatedFamily,
  ApiDeviceMember,
  ApiDeviceMessages,
  ApiDeviceSetUp,
  ApiExchangePage,
  ApiExchangeSummary,
  ApiFamily,
  ApiLeft,
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
  ApiUser,
  ApiWeeklyRead,
  ApiWithdrawn,
  ComposeAsk,
  ComposeReply,
  CreateFamily,
  RegisterPushDevice,
  SetAway,
} from "@vela/contracts";

/**
 * The worker the app talks to. Without it the screens read their fixtures, so a checkout with no
 * backend still runs; with it every call carries the Clerk session as a bearer token.
 */
export const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL;

export function apiConfigured(): boolean {
  return typeof apiBaseUrl === "string" && apiBaseUrl.length > 0;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** What the error carries beyond its code: who holds a morning, and the one to offer instead. */
  readonly details: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(`The API answered ${status} (${code})`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The 409 the compose route answers when that morning is already someone else’s (spec A7). */
export function askConflict(error: unknown): ApiAskConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const details = error.details;
  if (typeof details !== "object" || details === null) return null;
  const taken = "taken_by" in details ? details.taken_by : undefined;
  const alternative = "date_alternative" in details ? details.date_alternative : null;
  if (typeof taken !== "string") return null;
  return {
    taken_by: taken,
    date_alternative: typeof alternative === "string" ? alternative : null,
  };
}

interface Call {
  path: string;
  token: string | null;
  /** Present on a write; the same key twice is the same write, answered from its receipt. */
  key?: string;
  body?: unknown;
  /** A write is a POST unless it changes part of something that already exists. */
  method?: "POST" | "PATCH";
}

async function call<T>({ path, token, key, body, method }: Call): Promise<T> {
  if (!apiConfigured() || apiBaseUrl === undefined) {
    throw new Error("The API is not configured");
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: body === undefined ? "GET" : (method ?? "POST"),
    headers: {
      accept: "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined
        ? {}
        : {
            "content-type": "application/json",
            ...(key === undefined ? {} : { "idempotency-key": key }),
          }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const failure: unknown = await response.json().catch(() => undefined);
    const error =
      typeof failure === "object" && failure !== null && "error" in failure
        ? (failure as { error: { code?: unknown; details?: unknown } }).error
        : undefined;
    throw new ApiError(response.status, String(error?.code ?? "unknown"), error?.details);
  }
  return (await response.json()) as T;
}

function read<T>(path: string, token: string | null): Promise<T> {
  return call<T>({ path, token });
}

export function fetchMe(token: string | null): Promise<ApiMe> {
  return read<ApiMe>("/v1/me", token);
}

/** The family behind You: members, their lights and plans, and for organisers the people nearby. */
export function fetchFamily(familyId: string, token: string | null): Promise<ApiFamily> {
  return read<ApiFamily>(`/v1/families/${familyId}`, token);
}

export function fetchToday(familyId: string, token: string | null): Promise<ApiToday> {
  return read<ApiToday>(`/v1/families/${familyId}/today`, token);
}

export function composeAsk(
  familyId: string,
  key: string,
  ask: ComposeAsk,
  token: string | null,
): Promise<ApiComposedAsk> {
  return call<ApiComposedAsk>({
    path: `/v1/families/${familyId}/exchanges`,
    token,
    key,
    body: ask,
  });
}

/** The family book (`GET /v1/families/:familyId/book`, ADR-39): every kept story, newest first. */
export function fetchBook(familyId: string, token: string | null): Promise<ApiBook> {
  return read<ApiBook>(`/v1/families/${familyId}/book`, token);
}

/** An organiser takes a story out of the book. */
export function removeBookEntry(
  exchangeId: string,
  key: string,
  token: string | null,
): Promise<ApiBookRemoved> {
  return call<ApiBookRemoved>({ path: `/v1/book/${exchangeId}/remove`, token, key, body: {} });
}

/** The caller's reminders and the family's coming plans (`GET /v1/families/:familyId/reminders`, spec §12). */
export function fetchReminders(familyId: string, token: string | null): Promise<ApiReminders> {
  return read<ApiReminders>(`/v1/families/${familyId}/reminders`, token);
}

/** "Remind me to ask": a reminder exists only after this tap. */
export function createReminder(
  familyId: string,
  factId: string,
  key: string,
  token: string | null,
): Promise<ApiReminder> {
  return call<ApiReminder>({
    path: `/v1/families/${familyId}/reminders`,
    token,
    key,
    body: { fact_id: factId },
  });
}

/** Takes an ask back before her morning is prepared (spec §19); only its asker may. */
export function withdrawAsk(
  exchangeId: string,
  key: string,
  token: string | null,
): Promise<ApiWithdrawn> {
  return call<ApiWithdrawn>({ path: `/v1/exchanges/${exchangeId}/withdraw`, token, key, body: {} });
}

/** Away mode (spec §8): any member sets her away, from a day until a day or until she is back. */
export function setAway(
  familyId: string,
  memberId: string,
  away: SetAway,
  key: string,
  token: string | null,
): Promise<ApiAway> {
  return call<ApiAway>({
    path: `/v1/families/${familyId}/members/${memberId}/away`,
    token,
    key,
    body: away,
  });
}

/** "She's back": ends an away period, whoever set it. */
export function endAway(awayId: string, key: string, token: string | null): Promise<ApiAway> {
  return call<ApiAway>({ path: `/v1/away/${awayId}/end`, token, key, body: {} });
}

/** "Done": the caller's own reminder, finished. */
export function finishReminder(
  reminderId: string,
  key: string,
  token: string | null,
): Promise<ApiReminderDone> {
  return call<ApiReminderDone>({ path: `/v1/reminders/${reminderId}/done`, token, key, body: {} });
}

/** One exchange, for a link that names it (`GET /v1/exchanges/:exchangeId`); 404 when it is not hers to see. */
export function fetchExchange(
  exchangeId: string,
  token: string | null,
): Promise<ApiExchangeSummary> {
  return read<ApiExchangeSummary>(`/v1/exchanges/${exchangeId}`, token);
}

export function fetchExchanges(
  familyId: string,
  cursor: string | null,
  token: string | null,
): Promise<ApiExchangePage> {
  const query = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  return read<ApiExchangePage>(`/v1/families/${familyId}/exchanges${query}`, token);
}

export function replyTo(
  exchangeId: string,
  key: string,
  reply: ComposeReply,
  token: string | null,
): Promise<ApiReply> {
  return call<ApiReply>({ path: `/v1/exchanges/${exchangeId}/replies`, token, key, body: reply });
}

/** The reason a 403 or 409 names in its details, when it names one. */
function refusalReason(error: unknown): string | null {
  if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 403)) return null;
  const details = error.details;
  const reason =
    typeof details === "object" && details !== null && "reason" in details ? details.reason : null;
  return typeof reason === "string" ? reason : null;
}

/** Why a reply was refused, when it was: she has not answered yet, or it is her own exchange. */
export function replyRefusal(error: unknown): "not_answered" | "her_own" | null {
  const reason = refusalReason(error);
  return reason === "not_answered" || reason === "her_own" ? reason : null;
}

/** Why pausing or leaving was refused: nobody else organising is active, or a kept light's own. */
export function memberChangeRefusal(error: unknown): "last_organiser" | "kept_light" | null {
  const reason = refusalReason(error);
  return reason === "last_organiser" || reason === "kept_light" ? reason : null;
}

/** Pause or resume one's own membership (spec A12). */
export function pauseSelf(
  familyId: string,
  memberId: string,
  paused: boolean,
  key: string,
  token: string | null,
): Promise<ApiMemberPause> {
  return call<ApiMemberPause>({
    path: `/v1/families/${familyId}/members/${memberId}/pause`,
    token,
    key,
    body: { paused },
  });
}

/** Leave the family: the membership is closed, and deleted thirty days on (spec A12). */
export function leaveFamily(
  familyId: string,
  memberId: string,
  key: string,
  token: string | null,
): Promise<ApiLeft> {
  return call<ApiLeft>({
    path: `/v1/families/${familyId}/members/${memberId}/left`,
    token,
    key,
    body: {},
  });
}

/** "Start the 30 days" of Vela Light for one kept-light member (spec A13). */
export function startTrial(
  familyId: string,
  memberId: string,
  key: string,
  token: string | null,
): Promise<ApiTrial> {
  return call<ApiTrial>({
    path: `/v1/families/${familyId}/plan/trial`,
    token,
    key,
    body: { member_id: memberId },
  });
}

/** Why the trial was refused: she has not answered yet, or her light is not on. */
export function trialRefusal(error: unknown): "not_answered_yet" | "light_off" | null {
  const reason = refusalReason(error);
  return reason === "not_answered_yet" || reason === "light_off" ? reason : null;
}

/** Someone nearby her, by name and how they know her; never a number (spec A3). */
export function addNearby(
  familyId: string,
  input: { member_id: string; name: string; relation: string | null },
  key: string,
  token: string | null,
): Promise<ApiNearbyContact> {
  return call<ApiNearbyContact>({
    path: `/v1/families/${familyId}/nearby`,
    token,
    key,
    body: input,
  });
}

export function removeNearby(
  contactId: string,
  key: string,
  token: string | null,
): Promise<ApiNearbyRemoved> {
  return call<ApiNearbyRemoved>({ path: `/v1/nearby/${contactId}/remove`, token, key, body: {} });
}

/** Why someone nearby was not added: she has two already, or the words held a number. */
export function nearbyRefusal(error: unknown): "full" | "number" | null {
  const reason = refusalReason(error);
  return reason === "full" || reason === "number" ? reason : null;
}

/**
 * "Set up this phone for Mom" (ADR-35): an organiser, signed in on her phone, makes it hers. The
 * token it answers is kept on this phone alone (`src/device/token.ts`).
 */
export function setUpDevice(
  familyId: string,
  memberId: string,
  key: string,
  token: string | null,
): Promise<ApiDeviceSetUp> {
  return call<ApiDeviceSetUp>({
    path: `/v1/families/${familyId}/members/${memberId}/device`,
    token,
    key,
    body: {},
  });
}

/** Her phone's own requests carry its device token, never a session. */
async function deviceCall<T>(path: string, deviceToken: string, body?: unknown): Promise<T> {
  if (!apiConfigured() || apiBaseUrl === undefined) {
    throw new Error("The API is not configured");
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      accept: "application/json",
      authorization: `Device ${deviceToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new ApiError(response.status, "device", undefined);
  return (await response.json()) as T;
}

/** Who this phone is for, by its token: a 401 means it was set up again elsewhere or removed. */
export function fetchDeviceMember(deviceToken: string): Promise<ApiDeviceMember> {
  return deviceCall<ApiDeviceMember>("/v1/device", deviceToken);
}

/** What Vela sent her phone, newest first. */
export function fetchDeviceMessages(deviceToken: string): Promise<ApiDeviceMessages> {
  return deviceCall<ApiDeviceMessages>("/v1/device/messages", deviceToken);
}

/** Her tap under a message, her own words, or her uploaded voice; the pilot Worker hands them to the router. */
export function sendDeviceMessage(
  deviceToken: string,
  input: { button: string; message_id: string } | { text: string } | { voice: string },
): Promise<{ ok: true }> {
  return deviceCall<{ ok: true }>("/device/messages", deviceToken, input);
}

/** Whether creating a family was refused because this account already runs one. */
export function alreadyOrganiser(error: unknown): boolean {
  return refusalReason(error) === "already_organiser";
}

/** The account the organiser's name, language and time zone live on; made once, on first run. */
export function provisionAccount(
  profile: ApiAccountProfile,
  key: string,
  token: string | null,
): Promise<ApiUser> {
  return call<ApiUser>({ path: "/v1/me/provision", token, key, body: profile });
}

/** A change to the organiser's language, name or zone: PATCH /v1/me (API contract §2). */
export function updateAccount(
  patch: ApiAccountPatch,
  key: string,
  token: string | null,
): Promise<ApiUser> {
  return call<ApiUser>({ path: "/v1/me", token, key, body: patch, method: "PATCH" });
}

export function createFamily(
  family: CreateFamily,
  key: string,
  token: string | null,
): Promise<ApiCreatedFamily> {
  return call<ApiCreatedFamily>({ path: "/v1/families", token, key, body: family });
}

export function fetchWeeklyRead(
  familyId: string,
  memberId: string,
  token: string | null,
): Promise<ApiWeeklyRead> {
  return read<ApiWeeklyRead>(
    `/v1/families/${familyId}/weekly-read?member=${encodeURIComponent(memberId)}`,
    token,
  );
}

/** How Vela is doing: the family's quiet notices and Vela's, by month (spec §8). Organisers only. */
export function fetchPrecision(familyId: string, token: string | null): Promise<ApiPrecision> {
  return read<ApiPrecision>(`/v1/families/${familyId}/precision`, token);
}

export function fetchQuiet(quietEventId: string, token: string | null): Promise<ApiQuietNotice> {
  return read<ApiQuietNotice>(`/v1/quiet/${quietEventId}`, token);
}

/** "She's fine" or "wait 2 hours": the body is empty, the event is in the path. */
export function settleQuiet(
  quietEventId: string,
  action: "fine" | "wait",
  key: string,
  token: string | null,
): Promise<ApiQuietState> {
  return call<ApiQuietState>({ path: `/v1/quiet/${quietEventId}/${action}`, token, key, body: {} });
}

/** Whether a settled quiet notice was useful, for the precision page (spec §18). */
export function markQuietUseful(
  quietEventId: string,
  useful: boolean,
  key: string,
  token: string | null,
): Promise<ApiQuietState> {
  return call<ApiQuietState>({
    path: `/v1/quiet/${quietEventId}/useful`,
    token,
    key,
    body: { useful },
  });
}

/** "Ask them to look in" (ADR-36): one contact on one quiet morning; a repeat answers the same ask. */
export function askToLookIn(
  quietEventId: string,
  contactId: string,
  key: string,
  token: string | null,
): Promise<ApiLookInAsk> {
  return call<ApiLookInAsk>({
    path: `/v1/quiet/${quietEventId}/ask-to-check`,
    token,
    key,
    body: { contact_id: contactId },
  });
}

/**
 * The link to share with someone nearby so they can say yes on Telegram (ADR-36). Each call mints a
 * new link that voids the one before, so it is asked for when the organiser taps, not ahead.
 */
export function inviteNearby(
  contactId: string,
  key: string,
  token: string | null,
): Promise<ApiNearbyInvite> {
  return call<ApiNearbyInvite>({ path: `/v1/nearby/${contactId}/invite`, token, key, body: {} });
}

/**
 * This phone, registered or refreshed for the signed-in account (ADR-34): its installation, its push
 * token, and what the phone allows, so an organiser whose notifications are off stops counting as
 * someone who can be told. Each attempt carries a fresh key: a replay must never answer for a phone
 * that has since moved to another account.
 */
export function registerPushDevice(
  device: RegisterPushDevice,
  key: string,
  token: string | null,
): Promise<ApiPushDevice> {
  return call<ApiPushDevice>({ path: "/v1/me/devices", token, key, body: device });
}

/** This phone taken off the account, at sign-out; an installation the account lacks answers false. */
export function removePushDevice(
  installationId: string,
  key: string,
  token: string | null,
): Promise<ApiPushDeviceRemoved> {
  return call<ApiPushDeviceRemoved>({
    path: `/v1/me/devices/${installationId}/remove`,
    token,
    key,
    body: {},
  });
}
