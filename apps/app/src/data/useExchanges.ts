import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ApiExchangeSummary } from "@vela/contracts";
import { useCallback } from "react";
import { apiConfigured, fetchExchanges } from "../api/client.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { localDateIn } from "./chat.ts";
import { type Exchange, type ExchangeReply, exchangesFixture } from "./exchanges.ts";
import { timeOfDay } from "./format.ts";
import { demoDataAllowed } from "./live-state.ts";
import { dayName, toTodayExchange, useToday } from "./useToday.ts";

/** A reply keeps its kind, so one with no words reads as what it was: "Anna sent a photo". */
function toReply(
  exchangeId: string,
  index: number,
  reply: ApiExchangeSummary["replies"][number],
): ExchangeReply {
  const words = reply.text?.trim() ?? "";
  return {
    id: `${exchangeId}:${index}`,
    from: reply.from,
    kind: reply.kind,
    ...(words.length === 0 ? {} : { text: words }),
    ...(reply.photo == null ? {} : { photo: reply.photo }),
    ...(reply.audio == null ? {} : { audio: reply.audio }),
  };
}

/** Her local date of an exchange: the morning it was for, or the day it reached her. */
function herDate(summary: ApiExchangeSummary, timeZone?: string): string | undefined {
  if (summary.scheduled_for !== null) return summary.scheduled_for;
  const at = summary.delivered_at ?? summary.created_at;
  if (at === undefined || at === null) return undefined;
  const instant = Date.parse(at);
  return Number.isFinite(instant)
    ? localDateIn(instant, summary.recipient_tz ?? timeZone)
    : undefined;
}

/** One listed exchange in the screen's idiom: the same card Today shows, with its day. */
export function toExchange(summary: ApiExchangeSummary, timeZone?: string): Exchange {
  const card = toTodayExchange(summary, timeZone);
  const deliveryNotice =
    summary.scheduled_for !== null
      ? card.deliveryNotice
      : summary.delivery_status === "failed"
        ? t`This message could not be delivered. Their daily morning is unchanged.`
        : summary.delivery_status === "pending"
          ? t`Accepted for delivery. This is not a read receipt.`
          : undefined;
  return {
    ...(deliveryNotice === undefined ? {} : { deliveryNotice }),
    id: summary.id,
    recipientId: summary.recipient_id,
    asker: card.asker ?? "Vela",
    ...(card.draftedByVela === undefined ? {} : { draftedByVela: card.draftedByVela }),
    recipient: card.recipient,
    ask: card.ask ?? t`A hello from Vela`,
    type: summary.type,
    ...(herDate(summary, timeZone) === undefined ? {} : { date: herDate(summary, timeZone) }),
    day:
      summary.scheduled_for === null
        ? summary.delivered_at === null
          ? ""
          : timeOfDay(summary.delivered_at, timeZone)
        : dayName(summary.scheduled_for),
    ...(card.answer === undefined ? {} : { answer: card.answer }),
    replies: summary.replies.map((reply, index) => toReply(summary.id, index, reply)),
    ...(card.receipt === undefined ? {} : { receipt: card.receipt }),
    repliesReachHer: summary.replies_reach_her,
    ...(card.photos === undefined ? {} : { photos: card.photos }),
    ...(card.picked === undefined ? {} : { picked: card.picked }),
    ...(card.voiceHello === undefined ? {} : { voiceHello: card.voiceHello }),
  };
}

export interface ExchangesView {
  exchanges: Exchange[];
  /** The same days as the wire carries them, which the conversation is built from. */
  summaries: ApiExchangeSummary[];
  /** True once the real list has arrived; until then live builds carry an empty list. */
  live: boolean;
  loading: boolean;
  refreshing: boolean;
  refresh(): void;
  trouble: boolean;
  /** Another page exists within the thirty days; the list never scrolls past them. */
  more: boolean;
  loadMore(): void;
}

/**
 * The Exchanges list (spec A8) from the API when the app is pointed at one and someone is signed
 * in, and the example days otherwise. Pages arrive on request, never on scroll: the list ends at
 * thirty days in the family book, so there is no feed to keep pulling.
 */
export function useExchanges(watch = false): ExchangesView {
  // The days are worded as they are built, so a change of language builds them again.
  useLingui();
  const account = useAccount();
  const { familyId, today } = useToday();
  const enabled = apiConfigured() && account.ready && account.signedIn && familyId !== undefined;

  const pages = useInfiniteQuery({
    queryKey: ["exchanges", familyId],
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      fetchExchanges(familyId ?? "", pageParam, await account.token()),
    getNextPageParam: (last) => last.next_cursor,
    refetchOnWindowFocus: "always",
    refetchInterval: watch ? 5_000 : false,
  });
  const refetch = pages.refetch;
  const refresh = useCallback(() => {
    if (enabled) void refetch();
  }, [enabled, refetch]);

  if (!enabled) {
    return {
      exchanges: demoDataAllowed(apiConfigured(), accountsConfigured()) ? exchangesFixture() : [],
      summaries: [],
      live: false,
      loading: apiConfigured() && account.ready && account.signedIn && familyId === undefined,
      refreshing: false,
      refresh,
      trouble: false,
      more: false,
      loadMore: () => {},
    };
  }
  const live = pages.data !== undefined;
  const summaries = live ? pages.data.pages.flatMap((page) => page.exchanges) : [];
  return {
    summaries,
    exchanges: live
      ? pages.data.pages.flatMap((page) =>
          page.exchanges.map((summary) =>
            toExchange(
              summary,
              today.lights.find((light) => light.memberId === summary.recipient_id)?.timeZone,
            ),
          ),
        )
      : [],
    live,
    loading: pages.isPending,
    refreshing: pages.isRefetching,
    refresh,
    trouble: pages.isError,
    more: pages.hasNextPage,
    loadMore: () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
    },
  };
}
