import type { TodayLight } from "./today.ts";

export function canAsk(light: TodayLight): boolean {
  return light.state !== "paused" && light.invited !== true;
}

/** An explicit choice stays that person's, even when their light cannot be asked yet. */
export function askRecipient(
  lights: readonly TodayLight[],
  requested?: string,
): TodayLight | undefined {
  if (requested !== undefined) return lights.find((light) => light.memberId === requested);
  return lights.find(canAsk) ?? lights[0];
}
