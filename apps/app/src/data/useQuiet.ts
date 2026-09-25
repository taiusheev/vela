import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiQuietNotice, ApiQuietState } from "@vela/contracts";
import { useState } from "react";
import { fetchQuiet, settleQuiet } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";
import { timeOfDay, weekday } from "./format.ts";
import type { QuietNotice } from "./quiet.ts";

/** Whether an instant fell today or yesterday on this device, or on a day before. */
function dayOf(instant: string): "today" | "yesterday" | "earlier" {
  const at = new Date(instant);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1_000);
  if (at.toDateString() === today.toDateString()) return "today";
  if (at.toDateString() === yesterday.toDateString()) return "yesterday";
  return "earlier";
}

/** When she last answered, as one whole sentence for each kind of day. */
function lastAnswered(name: string, instant: string): string {
  const time = timeOfDay(instant);
  switch (dayOf(instant)) {
    case "today":
      return t`${name} last answered today at ${time}.`;
    case "yesterday":
      return t`${name} last answered yesterday at ${time}.`;
    default: {
      const day = weekday(instant);
      return t`${name} last answered ${day} at ${time}.`;
    }
  }
}

/** When today's ask reached her, and when it was asked again, if it was. */
function reached(name: string, delivered: string, repeated: string | null): string {
  const time = timeOfDay(delivered);
  if (repeated === null) return t`Today's ask reached ${name} at ${time}.`;
  const timeAgain = timeOfDay(repeated);
  return t`Today's ask reached ${name} at ${time}, and again at ${timeAgain}.`;
}

/**
 * The facts, in her name and never a pronoun, and nothing she said: when the ask reached her, when
 * it was asked again, and when she last answered (spec §8: facts, not guesses).
 */
function factsOf(notice: ApiQuietNotice | ApiQuietState): string[] {
  const name = notice.member_name;
  const facts: string[] = [];
  if (notice.delivered_at !== null) {
    facts.push(reached(name, notice.delivered_at, notice.repeated_at));
  }
  if (notice.last_answered_at !== null) {
    facts.push(lastAnswered(name, notice.last_answered_at));
  }
  return facts;
}

function resolutionOf(state: ApiQuietNotice | ApiQuietState): string | undefined {
  const name = state.member_name;
  if (state.resolved !== null) {
    const by = state.resolved.by_name;
    if (state.resolved.outcome !== "fine_known") {
      return t`${name} answered. The light is lit again.`;
    }
    return by === null
      ? t`Someone said ${name} is fine. Everyone who was told has heard.`
      : t`${by} said ${name} is fine. Everyone who was told has heard.`;
  }
  if (state.wait_until !== null && new Date(state.wait_until).getTime() > Date.now()) {
    const time = timeOfDay(state.wait_until);
    return t`Waiting until ${time}. You will hear again then if it is still quiet.`;
  }
  return undefined;
}

export function toQuietNotice(notice: ApiQuietNotice): QuietNotice {
  const resolution = resolutionOf(notice);
  return {
    memberName: notice.member_name,
    ...(notice.usual_time === null ? {} : { usualTime: notice.usual_time }),
    ...(notice.delivered_at === null ? {} : { sentAt: timeOfDay(notice.delivered_at) }),
    facts: factsOf(notice),
    contacts: notice.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      relation: contact.relation ?? t({ context: "relation", message: "nearby" }),
      consented: true,
      phone: contact.phone,
    })),
    canAskToCheck: false,
    ...(resolution === undefined ? {} : { resolution }),
  };
}

export interface QuietView {
  notice: QuietNotice | undefined;
  settle(action: "fine" | "wait"): void;
  settling: boolean;
  trouble: boolean;
}

/**
 * The live quiet notice for one event, read only when there is one and the reader organises the
 * family. Settling it answers with the event's new state, which the sheet shows at once; Today is
 * then read again, since the light may have changed.
 */
export function useQuiet(quietEventId: string | undefined, enabled: boolean): QuietView {
  // Read so a change of language renders the notice again with its facts in the new one.
  useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const fineKey = useIdempotencyKey("quiet-fine");
  const waitKey = useIdempotencyKey("quiet-wait");
  const [settled, setSettled] = useState<ApiQuietState | null>(null);

  const read = useQuery({
    queryKey: ["quiet", quietEventId],
    enabled: enabled && quietEventId !== undefined,
    queryFn: async () => fetchQuiet(quietEventId ?? "", await account.token()),
  });

  const settle = useMutation({
    mutationFn: async (action: "fine" | "wait") =>
      settleQuiet(
        quietEventId ?? "",
        action,
        (action === "fine" ? fineKey : waitKey)({ quietEventId, action }),
        await account.token(),
      ),
    onSuccess: async (state) => {
      setSettled(state);
      await queries.invalidateQueries({ queryKey: ["today"] });
    },
  });

  const base = read.data === undefined ? undefined : toQuietNotice(read.data);
  const afterSettle = settled === null ? undefined : resolutionOf(settled);
  return {
    notice:
      base === undefined
        ? undefined
        : afterSettle === undefined
          ? base
          : { ...base, resolution: afterSettle },
    settle: (action) => settle.mutate(action),
    settling: settle.isPending,
    trouble: read.isError || settle.isError,
  };
}
