/** Copied spaces are harmless; letters and extra digits remain invalid, never truncated. */
export function verificationCode(value: string): string {
  return value.replace(/\s/g, "");
}

export function validVerificationCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** Only an unknown identity starts registration; outages and refused logins never do. */
export function unknownIdentity(error: unknown): boolean {
  const errors = (error as { errors?: { code?: unknown }[] } | null)?.errors;
  return (
    Array.isArray(errors) && errors.some((entry) => entry?.code === "form_identifier_not_found")
  );
}

export function preferredCodeFactor<T extends { strategy: string }>(
  factors: readonly T[],
  mode: "email" | "phone",
): T | undefined {
  return (
    factors.find((factor) => factor.strategy === `${mode}_code`) ??
    factors.find((factor) => factor.strategy === "email_code" || factor.strategy === "phone_code")
  );
}

export function resendDelay(sentAt: number, now: number): number {
  return Math.max(0, Math.ceil((sentAt + 30_000 - now) / 1000));
}

/** Catch common email typos locally; Clerk remains the authority for supported addresses. */
export function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function verificationFailure(
  error: unknown,
): "expired" | "rate_limited" | "network" | "wrong_code" {
  const errors = (error as { errors?: { code?: unknown }[] } | null)?.errors;
  const codes = Array.isArray(errors)
    ? errors.map((entry) => (typeof entry?.code === "string" ? entry.code : "")).join(" ")
    : "";
  if (/expired/.test(codes)) return "expired";
  if (/rate_limit|too_many/.test(codes)) return "rate_limited";
  if (/network|offline|fetch/.test(codes) || error instanceof TypeError) return "network";
  return "wrong_code";
}

/** Only public machine codes are useful for support, never provider messages or account values. */
export function clerkErrorCodes(error: unknown): string[] {
  const errors = (error as { errors?: { code?: unknown }[] } | null)?.errors;
  return Array.isArray(errors)
    ? errors
        .map((entry) => entry?.code)
        .filter(
          (code): code is string => typeof code === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(code),
        )
    : [];
}
