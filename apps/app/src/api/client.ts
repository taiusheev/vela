import type { ApiAskConflict, ApiComposedAsk, ApiMe, ApiToday, ComposeAsk } from "@vela/contracts";

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
