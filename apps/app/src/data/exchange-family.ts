import type { TodayLight } from "./today.ts";
/** A cold link can read an exchange independently; attachments must use its own family. */
export function exchangeFamily(
  familyId: string | undefined,
  lights: readonly TodayLight[],
  recipientId: string | undefined,
): string | undefined {
  return recipientId !== undefined && lights.some((light) => light.memberId === recipientId)
    ? familyId
    : undefined;
}
