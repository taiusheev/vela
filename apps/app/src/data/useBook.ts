import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiBookEntry, ApiBookRecipe, ApiComingStory } from "@vela/contracts";
import { apiConfigured, fetchBook, removeBookEntry } from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { useAccount } from "../auth/clerk.tsx";

export interface BookView {
  entries: ApiBookEntry[];
  /** Story asks set for a coming morning, soonest first, with who chose them. */
  coming: ApiComingStory[];
  /** Her kept recipe cards, newest first. */
  recipes: ApiBookRecipe[];
  loading: boolean;
  trouble: boolean;
  /** An organiser takes a story out; Sunday and the book read again. */
  remove(exchangeId: string): void;
  removing: boolean;
}

/**
 * The family book (spec §10, ADR-39): every story she told that the family keeps, newest first,
 * read by every member. Without an API there is no book to show.
 */
export function useBook(familyId: string | undefined): BookView {
  const account = useAccount();
  const queries = useQueryClient();
  const removeKey = useIdempotencyKey("book-remove");
  const live = apiConfigured() && account.signedIn && familyId !== undefined;
  const read = useQuery({
    queryKey: ["book", familyId],
    enabled: live,
    queryFn: async () => fetchBook(familyId ?? "", await account.token()),
  });
  const removing = useMutation({
    mutationFn: async (exchangeId: string) =>
      removeBookEntry(exchangeId, removeKey({ exchangeId }), await account.token()),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["book", familyId] });
    },
  });
  return {
    entries: read.data?.entries ?? [],
    coming: read.data?.coming ?? [],
    recipes: read.data?.recipes ?? [],
    loading: live && read.isPending,
    trouble: read.isError,
    remove: (exchangeId) => removing.mutate(exchangeId),
    removing: removing.isPending,
  };
}
