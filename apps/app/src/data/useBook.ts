import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiBook,
  ApiBookEntry,
  ApiBookKept,
  ApiBookRecipe,
  ApiComingStory,
  ApiKeepSuggestion,
  ApiMemoryStory,
  ApiMoment,
} from "@vela/contracts";
import { useCallback, useState } from "react";
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
import { demoBookEntry, demoMemories } from "./memories.ts";

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
  /** Her memories (ADR-51); undefined from a server that does not send them yet. */
  moments: ApiMoment[] | undefined;
  /** Stories gathered from her memories, in her words. */
  stories: ApiMemoryStory[];
  /** Every exchange the book keeps: a story, or an answer someone kept. */
  keptIds: ReadonlySet<string>;
  /** The example family's book, kept only on this device. */
  demo: boolean;
  loading: boolean;
  trouble: boolean;
  refreshing: boolean;
  refresh(): Promise<void>;
  /** An organiser takes a story out; Sunday and the book read again. */
  remove(exchangeId: string): void;
  removing: boolean;
  removeFailed: boolean;
  /** An organiser keeps one of her answers for good (ADR-50). */
  keep(exchangeId: string): void;
  /** The exchange being kept just now. */
  keepingId: string | undefined;
  /** Keeps several of her answers, one after another: a story is kept by keeping its memories. */
  keepAll(exchangeIds: string[]): void;
  /** The exchanges a keep or keepAll is keeping just now. */
  keepingIds: ReadonlySet<string>;
  /** The last keep that kept nothing, and why. */
  refused: { exchangeId: string; reason: KeepRefusal } | undefined;
  keepFailed: boolean;
  /** The exchange whose keep failed, to say so beside it. */
  failedId: string | undefined;
  /** "Not this one" on a suggestion. */
  dismiss(exchangeId: string): void;
}

/** A keep in the example family: the memory is marked kept, and the book gains its page. */
function keptInDemo(book: ApiBook, exchangeId: string): ApiBook {
  const moment = book.moments?.find((item) => item.exchange_id === exchangeId);
  if (moment === undefined || moment.kept) return book;
  const moments = (book.moments ?? []).map((item) =>
    item.exchange_id === exchangeId
      ? { ...item, kept: true, kept_by: "Mia", fades_at: null }
      : item,
  );
  return {
    ...book,
    moments,
    stories: (book.stories ?? []).map((story) => ({
      ...story,
      kept: story.moment_ids.every(
        (id) => moments.find((item) => item.exchange_id === id)?.kept === true,
      ),
    })),
    entries: [demoBookEntry({ ...moment, kept: true }, "Mia"), ...book.entries],
    suggestions: book.suggestions.filter((item) => item.exchange_id !== exchangeId),
  };
}

/**
 * The example family's book: empty until something is kept here, so story day and the weekly read
 * promise nothing the example cannot show, with one ordinary answer suggested to keep.
 */
function demoBook(exchanges: Exchange[]): ApiBook {
  const suggested = exchanges.find((exchange) => exchange.id === "x2");
  return {
    ...demoMemories(exchanges),
    entries: [],
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
  const refresh = useCallback(async () => {
    if (live) await refetch({ cancelRefetch: false });
  }, [live, refetch]);
  const reread = async () => {
    if (live) await queries.invalidateQueries({ queryKey });
  };
  const removing = useMutation({
    mutationFn: async (exchangeId: string) =>
      removeBookEntry(exchangeId, removeKey({ exchangeId }), await account.token()),
    onSuccess: reread,
  });
  // What this reader kept just now, lit at once rather than after the book is read again.
  const [keptNow, setKeptNow] = useState<ReadonlySet<string>>(new Set());
  const keeping = useMutation({
    mutationFn: async (exchangeId: string): Promise<ApiBookKept> => {
      if (!live) return { exchange_id: exchangeId, kept: true };
      return keepBookEntry(exchangeId, keepKey({ exchangeId }), await account.token());
    },
    onSuccess: async (kept) => {
      if (kept.kept) setKeptNow((now) => new Set(now).add(kept.exchange_id));
      if (!live && kept.kept) {
        queries.setQueryData<ApiBook>(queryKey, (book) =>
          book === undefined ? book : keptInDemo(book, kept.exchange_id),
        );
      }
      await reread();
    },
  });
  // A story's memories, kept one after another with one key each, so a retry keeps none twice.
  const [keepingAll, setKeepingAll] = useState<ReadonlySet<string>>(new Set());
  const keepAll = (exchangeIds: string[]) => {
    if (keepingAll.size > 0) return;
    setKeepingAll(new Set(exchangeIds));
    void (async () => {
      try {
        for (const exchangeId of exchangeIds) {
          await keeping.mutateAsync(exchangeId);
        }
      } catch {
        // keepFailed says so; what was kept stays kept.
      } finally {
        setKeepingAll(new Set());
      }
    })();
  };
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
    moments: read.data?.moments,
    stories: read.data?.stories ?? [],
    keptIds: new Set([
      ...entries.map((entry) => entry.exchange_id),
      ...(read.data?.moments ?? []).filter((item) => item.kept).map((item) => item.exchange_id),
      ...keptNow,
    ]),
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
    keepAll,
    keepingIds:
      keepingAll.size > 0
        ? keepingAll
        : new Set(keeping.isPending && keeping.variables !== undefined ? [keeping.variables] : []),
    refused:
      last !== undefined && !last.kept && last.reason !== undefined
        ? { exchangeId: last.exchange_id, reason: last.reason }
        : undefined,
    keepFailed: keeping.isError,
    failedId: keeping.isError ? keeping.variables : undefined,
    dismiss: (exchangeId) => dismissing.mutate(exchangeId),
  };
}
