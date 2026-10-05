import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiReminder, ApiReminderSuggestion } from "@vela/contracts";
import { apiConfigured, createReminder, fetchReminders, finishReminder } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";

export interface RemindersView {
  /** Her coming plans this member could be reminded of. */
  suggestions: ApiReminderSuggestion[];
  /** This member's reminders not yet done, soonest first. */
  reminders: ApiReminder[];
  remind(factId: string): void;
  finish(reminderId: string): void;
  busy: boolean;
}

/**
 * Memory and reminders (spec §12): what she said will happen, offered as "Remind me to ask", and
 * the reminders this member asked for. Without an API there is nothing to remind anyone of.
 */
export function useReminders(familyId: string | undefined): RemindersView {
  const account = useAccount();
  const queries = useQueryClient();
  const remindKey = useIdempotencyKey("reminder");
  const doneKey = useIdempotencyKey("reminder-done");
  const live = apiConfigured() && account.signedIn && familyId !== undefined;
  const read = useQuery({
    queryKey: ["reminders", familyId],
    enabled: live,
    queryFn: async () => fetchReminders(familyId ?? "", await account.token()),
  });
  const again = async () => {
    await queries.invalidateQueries({ queryKey: ["reminders", familyId] });
  };
  const remind = useMutation({
    mutationFn: async (factId: string) =>
      createReminder(familyId ?? "", factId, remindKey({ factId }), await account.token()),
    onSuccess: again,
  });
  const finish = useMutation({
    mutationFn: async (reminderId: string) =>
      finishReminder(reminderId, doneKey({ reminderId }), await account.token()),
    onSuccess: again,
  });
  return {
    suggestions: read.data?.suggestions ?? [],
    reminders: read.data?.reminders ?? [],
    remind: (factId) => remind.mutate(factId),
    finish: (reminderId) => finish.mutate(reminderId),
    busy: remind.isPending || finish.isPending,
  };
}
