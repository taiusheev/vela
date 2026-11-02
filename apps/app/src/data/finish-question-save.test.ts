import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { finishQuestionSave } from "./finish-question-save.ts";

it("finishes an accepted save while all three active readers are still waiting for the network", async () => {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const readers = [
    ["today", "family-a"],
    ["planned-questions", "family-a"],
    ["book", "family-a"],
  ];
  const finishReads: (() => void)[] = [];
  const unsubscribe = readers.map((queryKey) => {
    queries.setQueryData(queryKey, "previous data");
    const observer = new QueryObserver(queries, {
      queryKey,
      staleTime: Infinity,
      queryFn: () =>
        new Promise<string>((resolve) => finishReads.push(() => resolve("fresh data"))),
    });
    return observer.subscribe(() => {});
  });
  let forget: () => void = () => {};
  const clear = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        forget = resolve;
      }),
  );
  let finished = false;
  const save = finishQuestionSave(queries, "family-a", clear).then(() => {
    finished = true;
  });
  try {
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(finishReads).toHaveLength(0);
    forget();
    await save;
    expect(finished).toBe(true);
    expect(finishReads).toHaveLength(3);
    for (const queryKey of readers) {
      expect(queries.getQueryState(queryKey)?.fetchStatus).toBe("fetching");
    }
  } finally {
    for (const finish of finishReads) finish();
    for (const stop of unsubscribe) stop();
    queries.clear();
  }
}, 1000);

it("does not discard an encrypted retry before its draft cleanup completes", async () => {
  const queries = new QueryClient();
  const refresh = vi.spyOn(queries, "invalidateQueries");
  await expect(
    finishQuestionSave(queries, "family-a", async () => {
      throw new Error("synthetic device storage failure");
    }),
  ).rejects.toThrow("synthetic device storage failure");
  expect(refresh).not.toHaveBeenCalled();
  queries.clear();
});
