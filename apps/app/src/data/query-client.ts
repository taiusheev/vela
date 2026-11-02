import { QueryClient } from "@tanstack/react-query";

/** One cache per sign-in, shared by the account gate, language, push and family screens. */
export function createSessionQueries(): QueryClient {
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
  });
  // Every observer of ["me"] must agree. A screen using the general retry default can otherwise
  // override the privacy gate's retry:false and leave a failed first read pending while focus is
  // inactive after sign-in. A 404 means setup, and other failures offer an explicit retry.
  // Keep that 404 settled when setup mounts its own account reader after the gate opens.
  // Attempt even when the network is reported offline: sessionRequests bounds the actual read,
  // so the gate can show recovery instead of waiting for an online/focus event indefinitely.
  queries.setQueryDefaults(["me"], {
    retry: false,
    retryOnMount: false,
    networkMode: "always",
  });
  return queries;
}

/** An explicit retry must replace even a first read that has never returned data. */
export async function retryAccountRead(queries: QueryClient): Promise<void> {
  const account = { queryKey: ["me"], exact: true };
  // refetch({cancelRefetch:true}) reuses an initial pending read with no cached data. Cancel it
  // explicitly first; its late result then cannot replace the response from the new attempt.
  await queries.cancelQueries(account);
  await queries.refetchQueries(account);
}
