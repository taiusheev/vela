import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiMe } from "@vela/contracts";
import { useState } from "react";
import { apiConfigured, fetchMe, updateAccount } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";

export interface OneMomentView {
  /** Whether the account's ordinary notifications are on, as last asked for or as the API says. */
  on: boolean;
  set(on: boolean): void;
  changing: boolean;
  /** The last change did not go through, so the switch shows what the account still has. */
  refused: boolean;
}

/**
 * "One moment a day" (spec A12, ADR-34): the account's switch for its ordinary notifications, when
 * she answers what you asked and the evening before your turn, written with `PATCH /v1/me`. It
 * never stops the quiet notice or its close. On by default, and there is nothing above one. With no
 * account, the example switch moves and nothing is sent.
 */
export function useOneMoment(): OneMomentView {
  const account = useAccount();
  const queries = useQueryClient();
  const keyFor = useIdempotencyKey("one-moment");
  const [example, setExample] = useState(true);
  const enabled = apiConfigured() && account.ready && account.signedIn;
  // The same query as Today's, so react-query makes one request for both.
  const me = useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => fetchMe(await account.token()),
  });
  const change = useMutation({
    mutationFn: async (on: boolean) =>
      updateAccount(
        { one_moment_a_day: on },
        keyFor({ one_moment_a_day: on }),
        await account.token(),
      ),
    // The switch stays where it was moved while the account is read again, rather than flicking back.
    onSuccess: (_, on) => {
      queries.setQueryData<ApiMe>(["me"], (known) =>
        known === undefined ? known : { ...known, one_moment_a_day: on },
      );
    },
    onSettled: async () => {
      await queries.invalidateQueries({ queryKey: ["me"] });
    },
  });
  if (!enabled) {
    return { on: example, set: setExample, changing: false, refused: false };
  }
  if (me.data === undefined) {
    // Not read yet, or not readable: shown at its default and held still until it is known.
    return { on: true, set: () => {}, changing: true, refused: false };
  }
  const asked = change.isPending ? change.variables : undefined;
  return {
    on: asked ?? me.data.one_moment_a_day,
    set: (on) => change.mutate(on),
    changing: change.isPending,
    refused: change.isError,
  };
}
