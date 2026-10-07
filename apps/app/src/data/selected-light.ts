import type { TodayLight } from "./today.ts";

/** An explicit unknown person never becomes a different parent's away dates or nearby contacts. */
export function selectedLight(
  lights: readonly TodayLight[],
  requested?: string,
): TodayLight | undefined {
  return requested === undefined ? lights[0] : lights.find((light) => light.memberId === requested);
}
