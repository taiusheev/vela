import type {
  ApiAccountProfile,
  ApiAskConflict,
  ApiComposedAsk,
  ApiCreatedFamily,
  ApiExchangePage,
  ApiFamily,
  ApiLeft,
  ApiMe,
  ApiMemberPause,
  ApiQuietNotice,
  ApiQuietState,
  ApiReply,
  ApiToday,
  ApiTrial,
  ApiUser,
  ComposeAsk,
  ComposeReply,
  CreateFamily,
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
}

async function call<T>({ path, token, key, body }: Call): Promise<T> {
  if (!apiConfigured() || apiBaseUrl === undefined) {
    throw new Error("The API is not configured");
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
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

export function createFamily(
  family: CreateFamily,
  key: string,
  token: string | null,
): Promise<ApiCreatedFamily> {
  return call<ApiCreatedFamily>({ path: "/v1/families", token, key, body: family });
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
