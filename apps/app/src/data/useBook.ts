import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiBook,
  ApiBookEntry,
  ApiBookKept,
  ApiBookRecipe,
  ApiComingStory,
  ApiKeepSuggestion,
} from "@vela/contracts";
import { useCallback } from "react";
import {
  apiConfigured,
  dismissKeepSuggestion,
  fetchBook,
  keepBookEntry,
  removeBookEntry,
} from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";
import { type Exchange, exchangesFixture } from "./exchanges.ts";
import { demoDataAllowed } from "./live-state.ts";

/** Why "Keep" kept nothing: she said "memories off", the words are private, or she took it out. */
export type KeepRefusal = NonNullable<ApiBookKept["reason"]>;

export interface BookView {
  entries: ApiBookEntry[];
  /** Story asks set for a coming morning, soonest first, with who chose them. */
  coming: ApiComingStory[];
  /** Her kept recipe cards, newest first. */
  recipes: ApiBookRecipe[];
  /** Answers Vela suggests keeping, for organisers only (ADR-50). */
  suggestions: ApiKeepSuggestion[];
  /** Every exchange the book keeps: a story, or an answer someone kept. */
  keptIds: ReadonlySet<string>;
  /** The example family's book, kept only on this device. */
  demo: boolean;
  loading: boolean;
  trouble: boolean;
  refreshing: boolean;
  refresh(): void;
  /** An organiser takes a story out; Sunday and the book read again. */
  remove(exchangeId: string): void;
  removing: boolean;
  removeFailed: boolean;
  /** An organiser keeps one of her answers for good (ADR-50). */
  keep(exchangeId: string): void;
  /** The exchange being kept just now. */
  keepingId: string | undefined;
  /** The last keep that kept nothing, and why. */
  refused: { exchangeId: string; reason: KeepRefusal } | undefined;
  keepFailed: boolean;
  /** "Not this one" on a suggestion. */
  dismiss(exchangeId: string): void;
}

/** One of the example family's answers as a book entry. */
function demoEntry(exchange: Exchange, keptBy: string | null): ApiBookEntry {
  return {
    exchange_id: exchange.id,
    member_id: exchange.recipientId ?? "m1",
    member_name: exchange.recipient,
    asked_by: exchange.asker,
    question: exchange.ask,
    photo_ids: [],
    kept_at: new Date().toISOString(),
    kept_by: keptBy,
    answers:
      exchange.answer === undefined
        ? []
        : [
            {
              kind: "text",
              text: exchange.answer.text,
              media_id: null,
              media_kind: null,
              at: new Date().toISOString(),
            },
          ],
  };
}

/** The example family's book: its story kept, and one ordinary answer suggested to keep. */
function demoBook(exchanges: Exchange[]): ApiBook {
  const suggested = exchanges.find((exchange) => exchange.id === "x2");
  return {
    entries: exchanges
      .filter((exchange) => exchange.type === "story")
      .map((exchange) => demoEntry(exchange, null)),
    recipes: [],
    coming: [],
    suggestions:
      suggested?.answer === undefined
        ? []
        : [
            {
              exchange_id: suggested.id,
              member_id: suggested.recipientId ?? "m1",
              member_name: suggested.recipient,
              question: suggested.ask,
              quote: suggested.answer.text,
              at: new Date().toISOString(),
            },
          ],
  };
}

/**
 * The family book (spec §10, ADR-39, ADR-50): every story she told and every answer the family
 * kept, newest first, read by every member, with Vela's suggestions of what to keep for organisers.
 * Without an API, the example family's book stands in where demo data is allowed, and keeping
 * there changes only this device's copy.
 */
export function useBook(familyId: string | undefined): BookView {
  const account = useAccount();
  const queries = useQueryClient();
  const removeKey = useIdempotencyKey("book-remove");
  const keepKey = useIdempotencyKey("book-keep");
  const dismissKey = useIdempotencyKey("book-dismiss");
  const live = apiConfigured() && account.signedIn && familyId !== undefined;
  const demo = !live && demoDataAllowed(apiConfigured(), accountsConfigured());
  const queryKey = ["book", live ? familyId : "demo"];
  const read = useQuery({
    queryKey,
    enabled: live || demo,
    refetchOnWindowFocus: live ? "always" : false,
    staleTime: demo ? Number.POSITIVE_INFINITY : 0,
    queryFn: async () =>
      live ? fetchBook(familyId ?? "", await account.token()) : demoBook(exchangesFixture()),
  });
  const refetch = read.refetch;
  const refresh = useCallback(() => {
    if (live) void refetch();
  }, [live, refetch]);
  const reread = async () => {
    if (live) await queries.invalidateQueries({ queryKey });
  };
  const removing = useMutation({
    mutationFn: async (exchangeId: string) =>
      removeBookEntry(exchangeId, removeKey({ exchangeId }), await account.token()),
    onSuccess: reread,
  });
  const keeping = useMutation({
    mutationFn: async (exchangeId: string): Promise<ApiBookKept> => {
      if (!live) return { exchange_id: exchangeId, kept: true };
      return keepBookEntry(exchangeId, keepKey({ exchangeId }), await account.token());
    },
    onSuccess: async (kept) => {
      if (!live && kept.kept) {
        queries.setQueryData<ApiBook>(queryKey, (book) => {
          const exchange = exchangesFixture().find((x) => x.id === kept.exchange_id);
          if (book === undefined || exchange === undefined) return book;
          return {
            ...book,
            entries: [demoEntry(exchange, "Mia"), ...book.entries],
            suggestions: book.suggestions.filter((item) => item.exchange_id !== kept.exchange_id),
          };
        });
      }
      await reread();
    },
  });
  const dismissing = useMutation({
    mutationFn: async (exchangeId: string) => {
      if (!live) return;
      await dismissKeepSuggestion(exchangeId, dismissKey({ exchangeId }), await account.token());
    },
    onSuccess: async (_, exchangeId) => {
      if (!live) {
        queries.setQueryData<ApiBook>(queryKey, (book) =>
          book === undefined
            ? book
            : {
                ...book,
                suggestions: book.suggestions.filter((item) => item.exchange_id !== exchangeId),
              },
        );
      }
      await reread();
    },
  });
  const entries = read.data?.entries ?? [];
  const last = keeping.data;
  return {
    entries,
    coming: read.data?.coming ?? [],
    recipes: read.data?.recipes ?? [],
    suggestions: read.data?.suggestions ?? [],
    keptIds: new Set(entries.map((entry) => entry.exchange_id)),
    demo,
    loading: live && read.isPending,
    trouble: read.isError,
    refreshing: read.isRefetching,
    refresh,
    removeFailed: removing.isError,
    remove: (exchangeId) => removing.mutate(exchangeId),
    removing: removing.isPending,
    keep: (exchangeId) => keeping.mutate(exchangeId),
    keepingId: keeping.isPending ? keeping.variables : undefined,
    refused:
      last !== undefined && !last.kept && last.reason !== undefined
        ? { exchangeId: last.exchange_id, reason: last.reason }
        : undefined,
    keepFailed: keeping.isError,
    dismiss: (exchangeId) => dismissing.mutate(exchangeId),
  };
}
