import type { ApiMe, MemberLight } from "@vela/contracts";

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

  constructor(status: number, code: string) {
    super(`The API answered ${status} (${code})`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function read<T>(path: string, token: string | null): Promise<T> {
  if (!apiConfigured() || apiBaseUrl === undefined) {
    throw new Error("The API is not configured");
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      accept: "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const code =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: { code?: unknown } }).error.code ?? "unknown")
        : "unknown";
    throw new ApiError(response.status, code);
  }
  return (await response.json()) as T;
}

export function fetchMe(token: string | null): Promise<ApiMe> {
  return read<ApiMe>("/v1/me", token);
}

export function fetchLights(familyId: string, token: string | null): Promise<MemberLight[]> {
  return read<MemberLight[]>(`/v1/families/${familyId}/lights`, token);
}
