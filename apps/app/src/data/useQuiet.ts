import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiQuietNotice, ApiQuietState } from "@vela/contracts";
import { useEffect, useState } from "react";
import { askToLookIn, fetchQuiet, markQuietUseful, settleQuiet } from "../api/client.ts";
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
      ...(contact.phone === null ? {} : { phone: contact.phone }),
      canAsk: contact.can_ask,
      ...(contact.asked === null
        ? {}
        : {
            asked: {
              at: timeOfDay(contact.asked.at),
              ...(contact.asked.by_name === null ? {} : { byName: contact.asked.by_name }),
              reply: contact.asked.reply,
            },
          }),
    })),
    ...(resolution === undefined ? {} : { resolution }),
    useful: notice.useful,
  };
}

export interface QuietView {
  notice: QuietNotice | undefined;
  memberId?: string;
  settle(action: "fine" | "wait"): void;
  /** Ask one contact to look in; the sheet then shows the ask, and later their answer. */
  askToLookIn(contactId: string): void;
  asking: boolean;
  /** The organiser's verdict on the settled notice. */
  markUseful(useful: boolean): void;
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
    // Their answer to "could you look in?" arrives on its own: the sheet looks again each half minute.
    refetchInterval: 30_000,
  });

  const usefulKey = useIdempotencyKey("quiet-useful");
  const [verdict, setVerdict] = useState<{ eventId: string; value: boolean | null } | null>(null);
  useEffect(() => {
    if (quietEventId !== undefined) {
      setSettled(null);
      setVerdict(null);
    }
  }, [quietEventId]);
  const useful = useMutation({
    mutationFn: async (value: boolean) =>
      markQuietUseful(
        quietEventId ?? "",
        value,
        usefulKey({ quietEventId, value }),
        await account.token(),
      ),
    onSuccess: (state) => setVerdict({ eventId: state.quiet_event_id, value: state.useful }),
  });
  const lookInKey = useIdempotencyKey("look-in");
  const lookIn = useMutation({
    mutationFn: async (contactId: string) =>
      askToLookIn(
        quietEventId ?? "",
        contactId,
        lookInKey({ quietEventId, contactId }),
        await account.token(),
      ),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["quiet", quietEventId] });
    },
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

  const read0 = read.data === undefined ? undefined : toQuietNotice(read.data);
  const base =
    read0 === undefined || verdict === null || verdict.eventId !== quietEventId
      ? read0
      : { ...read0, useful: verdict.value };
  const afterSettle =
    settled === null || settled.quiet_event_id !== quietEventId ? undefined : resolutionOf(settled);
  return {
    ...(read.data === undefined ? {} : { memberId: read.data.member_id }),
    notice:
      base === undefined
        ? undefined
        : afterSettle === undefined
          ? base
          : { ...base, resolution: afterSettle },
    settle: (action) => settle.mutate(action),
    settling: settle.isPending || useful.isPending,
    askToLookIn: (contactId) => lookIn.mutate(contactId),
    markUseful: (value) => useful.mutate(value),
    asking: lookIn.isPending,
    trouble: read.isError || settle.isError || lookIn.isError || useful.isError,
  };
}
