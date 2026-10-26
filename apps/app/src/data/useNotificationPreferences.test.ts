import { type MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationPreferences } from "./useNotificationPreferences.ts";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  refetch: vi.fn(async () => {}),
  refs: [] as { current: unknown }[],
  cursor: 0,
  readFailed: false,
}));
let queries: QueryClient;
let mutation:
  | MutationObserver<unknown, Error, { choice: "replies" | "turns"; on: boolean }>
  | undefined;
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
      options: ConstructorParameters<
        typeof MutationObserver<unknown, Error, { choice: "replies" | "turns"; on: boolean }>
      >[1],
    ) => {
      mutation ??= new actual.MutationObserver(queries, options);
      mutation.setOptions(options);
      return {
        ...mutation.getCurrentResult(),
        mutate: (on: { choice: "replies" | "turns"; on: boolean }) => {
          void mutation?.mutate(on).catch(() => {});
        },
      };
    },
  };
});
function render() {
  mocks.cursor = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: React hooks are replaced with the deterministic state harness above.
  return useNotificationPreferences();
}
beforeEach(() => {
  queries = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mutation = undefined;
  mocks.refs = [];
  mocks.readFailed = false;
  mocks.write.mockReset();
  mocks.refetch.mockClear();
});

describe("individual notification choices", () => {
  function seed() {
    queries.setQueryData(["me"], {
      one_moment_a_day: true,
      notification_preferences: { replies: true, turns: true },
    });
  }

  it("uses the existing combined control on an older server or before the account loads", () => {
    expect(render().available).toBe(false);
    queries.setQueryData(["me"], { one_moment_a_day: true });
    const view = render();
    expect(view.available).toBe(false);
    view.set("replies", false);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("serializes both switches while saving and preserves the other value", async () => {
    seed();
    let finish: (() => void) | undefined;
    mocks.write.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render();
    view.set("turns", false);
    view.set("replies", false);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(render()).toMatchObject({ status: "saving", values: { replies: true, turns: false } });
    expect(mocks.write.mock.calls[0]?.[0]).toEqual({ turn_reminders: false });
    finish?.();
    await vi.waitFor(() => expect(render().status).toBe("saved"));
    expect(queries.getQueryData(["me"])).toMatchObject({
      one_moment_a_day: true,
      notification_preferences: { replies: true, turns: false },
    });
  });

  it("restores the confirmed value after failure and retries the same write key", async () => {
    seed();
    mocks.write.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    render().set("replies", false);
    await vi.waitFor(() =>
      expect(render()).toMatchObject({
        status: "failed",
        refused: true,
        values: { replies: true, turns: true },
      }),
    );
    const key = mocks.write.mock.calls[0]?.[1];
    render().set("replies", false);
    await vi.waitFor(() => expect(render().status).toBe("saved"));
    expect(mocks.write.mock.calls[1]?.[1]).toBe(key);
    expect(render().values).toEqual({ replies: false, turns: true });
  });

  it("does not write unchanged choices", () => {
    seed();
    render().set("turns", true);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
