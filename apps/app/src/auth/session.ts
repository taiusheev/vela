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
