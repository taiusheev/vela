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
