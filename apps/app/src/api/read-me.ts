import type { ApiMe } from "@vela/contracts";
import { ApiError, fetchMe } from "./client.ts";

/**
 * The signed-in account (`GET /v1/me`), asked once more with a fresh token when the first answer is
 * "not signed in". Just after sign-in the token Clerk has at hand can still belong to the session
 * before it became active, and the server refuses it; a fresh one is active (founder, build 42: the
 * account screen said it could not be reached after every sign-in, then went in a moment later).
 */
export async function readMe(account: {
  token(options?: { fresh?: boolean }): Promise<string | null>;
}): Promise<ApiMe> {
  try {
    return await fetchMe(await account.token());
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    return fetchMe(await account.token({ fresh: true }));
  }
}
