import { t } from "@lingui/core/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiReminder, ApiReminderSuggestion } from "@vela/contracts";
import { useState } from "react";
import { apiConfigured, createReminder, fetchReminders, finishReminder } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { demoDataAllowed } from "./live-state.ts";

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
 * the reminders this member asked for. Without an API there is nothing to remind anyone of, except
 * in the example family, where Mom's check-up shows what the card does (26 October 2026).
 */
export function useReminders(familyId: string | undefined): RemindersView {
  const example = useExampleReminders();
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
  if (demoDataAllowed(apiConfigured(), accountsConfigured())) return example;
  return {
    suggestions: read.data?.suggestions ?? [],
    reminders: read.data?.reminders ?? [],
    remind: (factId) => remind.mutate(factId),
    finish: (reminderId) => finish.mutate(reminderId),
    busy: remind.isPending || finish.isPending,
  };
}

/** The phone's date `days` from today, as the API writes dates. */
function dateIn(days: number): string {
  const day = new Date(Date.now() + days * 86_400_000);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/** The example family's one plan, kept on this screen only: nothing is sent or saved. */
function useExampleReminders(): RemindersView {
  const [asked, setAsked] = useState<"offered" | "set" | "done">("offered");
  const plan = {
    id: "example-checkup",
    about_member_id: "m1",
    about_name: t`Mom`,
    what: t`her check-up at the clinic`,
  };
  const on = dateIn(3);
  return {
    suggestions: asked === "offered" ? [{ ...plan, fact_id: plan.id, on }] : [],
    reminders: asked === "set" ? [{ ...plan, due_date: on, done: false }] : [],
    remind: () => setAsked("set"),
    finish: () => setAsked("done"),
    busy: false,
  };
}
