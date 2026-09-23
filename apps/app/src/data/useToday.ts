import { useQuery } from "@tanstack/react-query";
import type { MemberLight } from "@vela/contracts";
import { apiConfigured, fetchLights, fetchMe } from "../api/client.ts";
import { useAccount } from "../auth/clerk.tsx";
import type { LightState } from "../components/light.tsx";
import { type Today, type TodayLight, todayFixture } from "./today.ts";

function timeOfDay(instant: string): string {
  const at = new Date(instant);
  return Number.isFinite(at.getTime())
    ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
}

function dayName(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(day.getTime())
    ? day.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" })
    : date;
}

/** The line under each name: "answered 8:12" · "quiet" · "away · Sunday" · "resting" (spec A6). */
export function stateText(light: MemberLight): string {
  switch (light.state) {
    case "lit":
      return light.answered_at === null ? "answered" : `answered ${timeOfDay(light.answered_at)}`;
    case "quiet":
      return "quiet";
    case "away":
      return light.away_until === null ? "away" : `away · ${dayName(light.away_until)}`;
    case "paused":
      return "paused";
    default:
      return "resting";
  }
}

export function toTodayLight(light: MemberLight): TodayLight {
  return {
    memberId: light.member_id,
    displayName: light.display_name,
    state: light.state as LightState,
    stateText: stateText(light),
  };
}

export interface TodayView {
  today: Today;
  /** True while the real lights are on their way; the fixtures show in the meantime. */
  loading: boolean;
  /** Set when the API is configured but would not answer, so the screen can say so plainly. */
  trouble: boolean;
  live: boolean;
}

/**
 * Today reads the API when the app is pointed at one and someone is signed in, and its fixtures
 * otherwise. Only the lights are live so far: the exchange and tomorrow's turn wait for their
 * routes (API contract §4).
 */
export function useToday(): TodayView {
  const account = useAccount();
  const enabled = apiConfigured() && account.ready && account.signedIn;

  const me = useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => fetchMe(await account.token()),
  });
  const familyId = me.data?.memberships[0]?.family.id;

  const lights = useQuery({
    queryKey: ["lights", familyId],
    enabled: enabled && familyId !== undefined,
    queryFn: async () => fetchLights(familyId ?? "", await account.token()),
  });

  if (!enabled) return { today: todayFixture, loading: false, trouble: false, live: false };
  const live = lights.data !== undefined;
  return {
    today: live ? { ...todayFixture, lights: lights.data.map(toTodayLight) } : todayFixture,
    loading: me.isPending || lights.isPending,
    trouble: me.isError || lights.isError,
    live,
  };
}
