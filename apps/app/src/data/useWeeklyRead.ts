import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { apiConfigured, fetchWeeklyRead } from "../api/client.ts";
import { useAccount } from "../auth/clerk.tsx";
import { useToday } from "./useToday.ts";
import { toWeeklyRead, type WeeklyRead, weeklyFixture } from "./weekly.ts";

export interface WeeklyReadView {
  /** The example week until a real one arrives, and with no API. */
  read: WeeklyRead;
  live: boolean;
  loading: boolean;
  trouble: boolean;
  /** The read is for organisers (spec §13): anyone else is told so, and nothing is fetched. */
  organiser: boolean;
  /** Nobody in the family has said yes yet, so there is no week to read. */
  nobody: boolean;
  /** Whose read it is, for "Start the 30 days" when it is locked. */
  memberId?: string;
}

/**
 * The Sunday tab's read: the first kept-light member who has said yes, as Today orders them; a
 * second one waits for the same switcher as the family. Without an API, the example week.
 */
export function useWeeklyRead(): WeeklyReadView {
  useLingui();
  const account = useAccount();
  const day = useToday();
  const her = day.live
    ? day.today.lights.find((light) => light.invited !== true)?.memberId
    : undefined;
  const enabled =
    apiConfigured() &&
    account.signedIn &&
    day.organiser &&
    day.familyId !== undefined &&
    her !== undefined;

  const query = useQuery({
    queryKey: ["weekly-read", day.familyId, her],
    enabled,
    queryFn: async () => fetchWeeklyRead(day.familyId ?? "", her ?? "", await account.token()),
  });

  if (!apiConfigured()) {
    return {
      read: weeklyFixture(),
      live: false,
      loading: false,
      trouble: false,
      organiser: true,
      nobody: false,
    };
  }
  const live = query.data !== undefined;
  return {
    read: live ? toWeeklyRead(query.data) : weeklyFixture(),
    live,
    loading: day.loading || (enabled && query.isPending),
    trouble: day.trouble || query.isError,
    organiser: day.organiser,
    nobody: day.live && her === undefined,
    ...(her === undefined ? {} : { memberId: her }),
  };
}
