import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { refreshReads } from "./query-refresh.ts";

describe("overlapping family reads", () => {
  it("shares a cached account refresh across screens instead of cancelling and restarting it", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queries.setQueryData(["me"], { revision: 1 });
    let finish: ((data: { revision: number }) => void) | undefined;
    let requests = 0;
    let cancelled = 0;
    const observer = new QueryObserver(queries, {
      queryKey: ["me"],
      staleTime: Infinity,
      queryFn: ({ signal }) => {
        requests += 1;
        signal.addEventListener("abort", () => {
          cancelled += 1;
        });
        return new Promise<{ revision: number }>((resolve) => {
          finish = resolve;
        });
      },
    });
    const stop = observer.subscribe(() => {});
    const today = refreshReads(observer.refetch);
    const family = refreshReads(observer.refetch);
    expect(requests).toBe(1);
    expect(cancelled).toBe(0);
    finish?.({ revision: 2 });
    await Promise.all([today, family]);
    expect(queries.getQueryData(["me"])).toEqual({ revision: 2 });
    stop();
    queries.clear();
  });

  it("starts independent reads together and waits for both", async () => {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const started: string[] = [];
    const finish: (() => void)[] = [];
    const observers = ["me", "family"].map(
      (name) =>
        new QueryObserver(queries, {
          queryKey: [name],
          enabled: false,
          queryFn: () => {
            started.push(name);
            return new Promise<string>((resolve) => {
              finish.push(() => resolve(name));
            });
          },
        }),
    );
    let settled = false;
    const refresh = refreshReads(...observers.map((observer) => observer.refetch)).then(() => {
      settled = true;
    });
    expect(started).toEqual(["me", "family"]);
    finish[0]?.();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish[1]?.();
    await refresh;
    expect(settled).toBe(true);
    queries.clear();
  });
});
