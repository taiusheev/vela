import { type MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOneMoment } from "./useOneMoment.ts";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  refetch: vi.fn(async () => {}),
  refs: [] as { current: unknown }[],
  cursor: 0,
  readFailed: false,
}));
let queries: QueryClient;
let mutation: MutationObserver<unknown, Error, boolean> | undefined;
vi.mock("react", () => ({
  useRef: (value: unknown) => {
    const index = mocks.cursor++;
    mocks.refs[index] ??= { current: value };
    return mocks.refs[index];
  },
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("../auth/clerk.tsx", () => ({
  useAccount: () => ({ ready: true, signedIn: true, token: async () => "test-session" }),
}));
vi.mock("../api/client.ts", () => ({
  apiConfigured: () => true,
  fetchMe: vi.fn(),
  updateAccount: (...args: unknown[]) => mocks.write(...args),
}));
vi.mock("@tanstack/react-query", async (original) => {
  const actual = await original<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => queries,
    useQuery: () => ({
      data: queries.getQueryData(["me"]),
      isError: mocks.readFailed,
      refetch: mocks.refetch,
    }),
    useMutation: (
      options: ConstructorParameters<typeof MutationObserver<unknown, Error, boolean>>[1],
    ) => {
      mutation ??= new actual.MutationObserver(queries, options);
      mutation.setOptions(options);
      return {
        ...mutation.getCurrentResult(),
        mutate: (on: boolean) => {
          void mutation?.mutate(on).catch(() => {});
        },
      };
    },
  };
});
function render() {
  mocks.cursor = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: React hooks are replaced with the deterministic state harness above.
  return useOneMoment();
}
beforeEach(() => {
  queries = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mutation = undefined;
  mocks.refs = [];
  mocks.readFailed = false;
  mocks.write.mockReset();
  mocks.refetch.mockClear();
});

describe("notification preference", () => {
  it("does not present an unread preference as confirmed, and offers recovery after read failure", () => {
    expect(render()).toMatchObject({ status: "loading", changing: true });
    mocks.readFailed = true;
    const view = render();
    expect(view).toMatchObject({ status: "unavailable", changing: true });
    view.set(false);
    expect(mocks.write).not.toHaveBeenCalled();
    view.retry();
    expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false });
  });

  it("accepts only one rapid toggle while the first save is pending", async () => {
    queries.setQueryData(["me"], { one_moment_a_day: true });
    let finish: (() => void) | undefined;
    mocks.write.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render();
    view.set(false);
    view.set(false);
    view.set(true);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(render()).toMatchObject({ status: "saving", on: false, changing: true });
    finish?.();
    await vi.waitFor(() => expect(render()).toMatchObject({ status: "saved", on: false }));
    expect(queries.getQueryData(["me"])).toEqual({ one_moment_a_day: false });
  });

  it("restores the server value after a refused save and retries with the same key", async () => {
    queries.setQueryData(["me"], { one_moment_a_day: true });
    mocks.write.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    render().set(false);
    await vi.waitFor(() =>
      expect(render()).toMatchObject({ status: "failed", on: true, refused: true }),
    );
    const firstKey = mocks.write.mock.calls[0]?.[1];
    render().set(false);
    await vi.waitFor(() => expect(render()).toMatchObject({ status: "saved", on: false }));
    expect(mocks.write.mock.calls[1]?.[1]).toBe(firstKey);
  });

  it("does not write an unchanged setting", () => {
    queries.setQueryData(["me"], { one_moment_a_day: true });
    render().set(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
