import { QueryClient } from "@tanstack/react-query";

/** One cache per sign-in, shared by the account gate, language, push and family screens. */
export function createSessionQueries(): QueryClient {
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
  });
  // Every observer of ["me"] must agree. A screen using the general retry default can otherwise
  // override the privacy gate's retry:false and leave a failed first read pending while focus is
  // inactive after sign-in. A 404 means setup, and other failures offer an explicit retry.
  // Attempt even when the network is reported offline: sessionRequests bounds the actual read,
  // so the gate can show recovery instead of waiting for an online/focus event indefinitely.
  queries.setQueryDefaults(["me"], { retry: false, networkMode: "always" });
  return queries;
}
