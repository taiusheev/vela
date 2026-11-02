import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiMe } from "@vela/contracts";
import { useRef, useState } from "react";
import { apiConfigured, fetchMe, updateAccount } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";

type Choices = NonNullable<ApiMe["notification_preferences"]>;
type Choice = keyof Choices;
interface Change {
  choice: Choice;
  on: boolean;
}

/** One shared mutation serializes both controls; older servers keep the combined setting. */
export function useNotificationPreferences() {
  const account = useAccount();
  const queries = useQueryClient();
  const keyFor = useIdempotencyKey("notification-choice");
  const saving = useRef(false);
  const [example, setExample] = useState<Choices>({ replies: true, turns: true });
  const enabled = apiConfigured() && account.ready && account.signedIn;
  const me = useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => fetchMe(await account.token()),
  });
  const change = useMutation({
    mutationFn: async ({ choice, on }: Change) => {
      const body = choice === "replies" ? { reply_notifications: on } : { turn_reminders: on };
      return updateAccount(body, keyFor(body), await account.token());
    },
    onSuccess: (_, { choice, on }) => {
      queries.setQueryData<ApiMe>(["me"], (known) => {
        if (known?.notification_preferences === undefined) return known;
        const prefs = { ...known.notification_preferences, [choice]: on };
        return {
          ...known,
          notification_preferences: prefs,
          one_moment_a_day: prefs.replies || prefs.turns,
        };
      });
    },
    onSettled: async () => {
      try {
        await queries.invalidateQueries({ queryKey: ["me"] });
      } finally {
        saving.current = false;
      }
    },
  });
  const known = enabled ? me.data?.notification_preferences : example;
  const pending = change.isPending ? change.variables : undefined;
  const values = {
    ...(known ?? { replies: false, turns: false }),
    ...(pending === undefined ? {} : { [pending.choice]: pending.on }),
  };
  return {
    available: known !== undefined,
    values,
    changing: change.isPending || (enabled && known === undefined),
    refused: change.isError,
    status: !enabled
      ? "example"
      : change.isPending
        ? "saving"
        : change.isError
          ? "failed"
          : change.isSuccess
            ? "saved"
            : "ready",
    set: (choice: Choice, on: boolean) => {
      if (!enabled) {
        setExample((current) => ({ ...current, [choice]: on }));
        return;
      }
      if (saving.current || known === undefined || known[choice] === on) return;
      saving.current = true;
      change.mutate({ choice, on });
    },
  };
}
