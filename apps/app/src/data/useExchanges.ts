import { useInfiniteQuery } from "@tanstack/react-query";
import type { ApiExchangeSummary } from "@vela/contracts";
import { apiConfigured, fetchExchanges } from "../api/client.ts";
import { useAccount } from "../auth/clerk.tsx";
import {
  type Exchange,
  type ExchangeReply,
  exchangesFixture,
  type ReactionKind,
} from "./exchanges.ts";
import { dayName, toTodayExchange, useToday } from "./useToday.ts";

const REACTIONS: readonly string[] = ["heart", "laugh", "hug"];

function toReply(exchangeId: string, index: number, reply: ApiExchangeSummary["replies"][number]) {
  const words = reply.text?.trim() ?? "";
  const shaped: ExchangeReply =
    words.length === 0 && REACTIONS.includes(reply.kind)
      ? { id: `${exchangeId}:${index}`, from: reply.from, reaction: reply.kind as ReactionKind }
      : {
          id: `${exchangeId}:${index}`,
          from: reply.from,
          text: words.length > 0 ? words : "replied",
        };
  return shaped;
}

/** One listed exchange in the screen's idiom: the same card Today shows, with its day. */
export function toExchange(summary: ApiExchangeSummary): Exchange {
  const card = toTodayExchange(summary);
  return {
    id: summary.id,
    asker: card.asker ?? "Vela",
    recipient: card.recipient,
    ask: card.ask ?? "A hello from Vela",
    day: summary.scheduled_for === null ? "" : dayName(summary.scheduled_for),
    ...(card.answer === undefined ? {} : { answer: card.answer }),
    replies: summary.replies.map((reply, index) => toReply(summary.id, index, reply)),
    ...(card.receipt === undefined ? {} : { receipt: card.receipt }),
    repliesReachHer: summary.replies_reach_her,
  };
}

export interface ExchangesView {
  exchanges: Exchange[];
  /** True once the real list has arrived; until then, and with no API, the example days show. */
  live: boolean;
  loading: boolean;
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
export function useExchanges(): ExchangesView {
  const account = useAccount();
  const { familyId } = useToday();
  const enabled = apiConfigured() && account.ready && account.signedIn && familyId !== undefined;

  const pages = useInfiniteQuery({
    queryKey: ["exchanges", familyId],
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      fetchExchanges(familyId ?? "", pageParam, await account.token()),
    getNextPageParam: (last) => last.next_cursor,
  });

  if (!enabled) {
    return {
      exchanges: exchangesFixture,
      live: false,
      loading: false,
      trouble: false,
      more: false,
      loadMore: () => {},
    };
  }
  const live = pages.data !== undefined;
  return {
    exchanges: live ? pages.data.pages.flatMap((page) => page.exchanges.map(toExchange)) : [],
    live,
    loading: pages.isPending,
    trouble: pages.isError,
    more: pages.hasNextPage,
    loadMore: () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
    },
  };
}
