import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { apiConfigured, fetchWeeklyRead } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { demoDataAllowed } from "./live-state.ts";
import { selectedLight } from "./selected-light.ts";
import { useToday } from "./useToday.ts";
import { toWeeklyRead, type WeeklyRead, weeklyFixture } from "./weekly.ts";

export interface WeeklyReadView {
  /** A real week once loaded; live builds carry no example week. */
  read: WeeklyRead;
  live: boolean;
  loading: boolean;
  trouble: boolean;
  refreshing: boolean;
  refresh(): void;
  /** The read is for organisers (spec §13): anyone else is told so, and nothing is fetched. */
  organiser: boolean;
  /** Nobody in the family has said yes yet, so there is no week to read. */
  nobody: boolean;
  /** Whose read it is, for "Start the 30 days" when it is locked. */
  memberId?: string;
  /** Only a live read has an identity; examples and disabled queries cannot record an opening. */
  readId?: string;
}

/**
 * The Sunday tab follows its chosen parent, including their paused or waiting-for-consent state.
 */
export function useWeeklyRead(requested?: string): WeeklyReadView {
  useLingui();
  const account = useAccount();
  const day = useToday();
  const parent =
    requested === undefined
      ? (day.today.lights.find((light) => light.invited !== true) ?? day.today.lights[0])
      : selectedLight(day.today.lights, requested);
  const her = parent?.memberId;
  const enabled =
    apiConfigured() &&
    account.signedIn &&
    day.organiser &&
    day.familyId !== undefined &&
    her !== undefined &&
    parent?.invited !== true;

  const query = useQuery({
    queryKey: ["weekly-read", account.userId, day.familyId, her],
    enabled,
    refetchOnWindowFocus: "always",
    queryFn: async () => fetchWeeklyRead(day.familyId ?? "", her ?? "", await account.token()),
  });

  const refetch = query.refetch;
  const refresh = useCallback(() => {
    day.refresh();
    if (enabled) void refetch();
  }, [day.refresh, enabled, refetch]);

  if (demoDataAllowed(apiConfigured(), accountsConfigured())) {
    return {
      read:
        her === undefined || her === "m1"
          ? weeklyFixture()
          : { name: parent?.displayName ?? "", locked: false, week: null },
      live: false,
      loading: false,
      trouble: false,
      refreshing: false,
      refresh,
      organiser: true,
      nobody: parent?.invited === true,
      ...(her === undefined ? {} : { memberId: her }),
    };
  }
  const live = enabled && query.data !== undefined;
  return {
    read: live
      ? toWeeklyRead(query.data)
      : { name: parent?.displayName ?? "", locked: false, week: null },
    live,
    loading: day.loading || (enabled && query.isPending),
    trouble: day.trouble || query.isError,
    refreshing: query.isRefetching,
    refresh,
    organiser: day.organiser,
    nobody: day.live && (her === undefined || parent?.invited === true),
    ...(her === undefined ? {} : { memberId: her }),
    ...(!live || query.data.read === null ? {} : { readId: query.data.read.id }),
  };
}
