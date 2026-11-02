import type { QueryClient } from "@tanstack/react-query";

/** After server acceptance, forget the retry draft before leaving, then refresh independently. */
export async function finishQuestionSave(
  queries: QueryClient,
  familyId: string | undefined,
  clearDraft: () => Promise<void>,
): Promise<void> {
  await clearDraft();
  // A slow/offline read must not keep the accepted question on “Saving…”. These reads
  // retain React Query's normal error/retry states; they cannot turn acceptance into failure.
  void Promise.all([
    queries.invalidateQueries({ queryKey: ["today"] }),
    queries.invalidateQueries({ queryKey: ["planned-questions"] }),
    queries.invalidateQueries({ queryKey: ["book", familyId] }),
  ]).catch(() => {});
}
