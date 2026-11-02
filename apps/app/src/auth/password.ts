type PasswordAttempt = { status: string | null; createdSessionId: string | null };

/** Clerk alone verifies the password; an unfinished challenge never opens the app. */
export async function completePasswordSignIn(
  create: (params: { identifier: string; password: string }) => Promise<PasswordAttempt>,
  activate: (params: { session: string }) => Promise<unknown>,
  identifier: string,
  password: string,
): Promise<"complete" | "verification_required"> {
  const attempt = await create({ identifier: identifier.trim(), password });
  if (attempt.status !== "complete" || attempt.createdSessionId === null) {
    return "verification_required";
  }
  await activate({ session: attempt.createdSessionId });
  return "complete";
}
