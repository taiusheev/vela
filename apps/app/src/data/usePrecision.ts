import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { apiConfigured, fetchPrecision } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { demoDataAllowed } from "./live-state.ts";
import { type Precision, precisionFixture, toPrecision } from "./precision.ts";
import { useToday } from "./useToday.ts";

export interface PrecisionView {
  /** The real page, or an empty page while a live read is pending. */
  precision: Precision;
  live: boolean;
  loading: boolean;
  trouble: boolean;
  /** The page is for organisers, who are told of quiet mornings: anyone else is told so. */
  organiser: boolean;
}

/** How Vela is doing, for the family Today shows. Without an API, the example page. */
export function usePrecision(): PrecisionView {
  useLingui();
  const account = useAccount();
  const day = useToday();
  const enabled =
    apiConfigured() && account.signedIn && day.organiser && day.familyId !== undefined;

  const query = useQuery({
    queryKey: ["precision", day.familyId],
    enabled,
    queryFn: async () => fetchPrecision(day.familyId ?? "", await account.token()),
  });

  if (demoDataAllowed(apiConfigured(), accountsConfigured())) {
    return {
      precision: precisionFixture(),
      live: false,
      loading: false,
      trouble: false,
      organiser: true,
    };
  }
  const live = query.data !== undefined;
  return {
    precision: live ? toPrecision(query.data) : { family: [], vela: [], velaRule: "" },
    live,
    loading: day.loading || (enabled && query.isPending),
    trouble: day.trouble || query.isError,
    organiser: day.organiser,
  };
}
