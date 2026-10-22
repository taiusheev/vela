/** A provider result is never enough on its own: only a complete Clerk session can enter Vela. */
export type SocialResult = {
  createdSessionId: string | null;
  setActive?: (params: { session: string }) => Promise<unknown>;
  signIn?: { status: string | null };
  signUp?: { status: string | null };
  authSessionResult?: { type: string } | null;
};

export type SocialOutcome = "complete" | "cancelled" | "needs_more" | "unavailable";

export async function completeSocialSignIn(
  result: SocialResult,
  current: () => boolean,
): Promise<SocialOutcome> {
  if (!current()) return "cancelled";
  if (result.authSessionResult && result.authSessionResult.type !== "success") {
    return result.authSessionResult.type === "cancel" || result.authSessionResult.type === "dismiss"
      ? "cancelled"
      : "unavailable";
  }
  if (result.createdSessionId && !result.setActive) return "unavailable";
  if (result.createdSessionId && result.setActive) {
    await result.setActive({ session: result.createdSessionId });
    return current() ? "complete" : "cancelled";
  }
  if (
    result.signUp?.status === "missing_requirements" ||
    result.signIn?.status === "needs_second_factor" ||
    result.signIn?.status === "needs_new_password"
  )
    return "needs_more";
  return "cancelled";
}

export function socialEnabled(provider: "google" | "apple"): boolean {
  return provider === "google"
    ? process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN === "on"
    : process.env.EXPO_PUBLIC_APPLE_SIGN_IN === "on";
}
