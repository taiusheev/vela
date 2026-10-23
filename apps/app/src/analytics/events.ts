/** Fixed navigation names only; no route parameters or family identifiers. */
export const SCREENS = [
  "today",
  "onboarding",
  "sign-in",
  "ask",
  "exchanges",
  "sunday",
  "you",
  "memories",
  "conversation",
  "help",
] as const;
export type AnalyticsScreen = (typeof SCREENS)[number];
export type UsageEvent = "app_usage_started" | "screen_viewed" | "screen_active_time";
export function screenName(segments: readonly string[]): AnalyticsScreen | null {
  const route = segments.filter((segment) => !segment.startsWith("("))[0] ?? "today";
  return (SCREENS as readonly string[]).includes(route) ? (route as AnalyticsScreen) : null;
}
/** Reconstruct properties rather than forwarding caller objects. */
export function usagePayload(
  id: string,
  event: UsageEvent,
  screen?: AnalyticsScreen,
  seconds?: number,
) {
  if (
    !/^[a-f0-9-]{36}$/.test(id) ||
    !["app_usage_started", "screen_viewed", "screen_active_time"].includes(event)
  )
    return null;
  if (screen !== undefined && !(SCREENS as readonly string[]).includes(screen)) return null;
  return {
    distinct_id: id,
    event,
    properties: {
      surface: "app",
      $process_person_profile: false,
      $geoip_disable: true,
      $ip: null,
      ...(screen ? { screen } : {}),
      ...(Number.isFinite(seconds)
        ? { seconds: Math.max(0, Math.min(1800, Math.round(seconds ?? 0))) }
        : {}),
    },
  };
}
