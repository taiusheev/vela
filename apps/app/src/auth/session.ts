/** Internal cache/storage identity, never a word displayed to a family. */
export function sessionScope(account: {
  ready: boolean;
  signedIn: boolean;
  userId: string | null;
  sessionId?: string | null;
}): string {
  if (!account.ready) return "loading";
  return account.signedIn
    ? `${account.userId ?? "unknown"}:${account.sessionId ?? "session"}`
    : "signed-out";
}

/**
 * The bearer token for a signed-in person. Right after a sign-in, Clerk can answer before its new
 * session has a token; asked once more, skipping its cache, it has one. Without this the app
 * called the API with no token, was refused, and the account read began with a failure.
 */
export async function signedInToken(
  getToken: (options?: { skipCache: true }) => Promise<string | null>,
  signedIn: boolean,
  fresh: boolean,
): Promise<string | null> {
  const token = await getToken(fresh ? { skipCache: true } : undefined);
  return token === null && signedIn && !fresh ? getToken({ skipCache: true }) : token;
}
