import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { apiBaseUrl, apiConfigured } from "../api/client.ts";
import { readServiceStatus } from "../api/service-status.ts";
import { accountsConfigured } from "../auth/clerk.tsx";
import { demoDataAllowed } from "./live-state.ts";

export function useServiceStatus() {
  const configured = apiConfigured();
  const query = useQuery({
    queryKey: ["public-service-status", apiBaseUrl],
    enabled: configured,
    queryFn: ({ signal }) => readServiceStatus(apiBaseUrl, signal),
    staleTime: 30_000,
    retry: false,
  });
  useFocusEffect(
    useCallback(() => {
      if (configured && Date.now() - query.dataUpdatedAt > 30_000) void query.refetch();
    }, [configured, query.refetch, query.dataUpdatedAt]),
  );
  return {
    status: demoDataAllowed(configured, accountsConfigured())
      ? ("example" as const)
      : !configured
        ? ("unconfigured" as const)
        : query.isFetching || query.isPending
          ? ("checking" as const)
          : query.isError
            ? ("unreachable" as const)
            : query.data,
    check: () => void query.refetch(),
  };
}
