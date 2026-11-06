import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.ts";
import { FAMILY_WAITING_RECHECK_MS } from "../api/family-waiting.ts";
import { useFamilyApproval } from "./useFamilyApproval.ts";

const mocks = vi.hoisted(() => {
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  return { read: vi.fn(), configured: true };
});
vi.mock("../api/client.ts", async (original) => ({
  ...(await original<typeof import("../api/client.ts")>()),
  apiConfigured: () => mocks.configured,
}));
vi.mock("../api/read-me.ts", () => ({ readMe: () => mocks.read() }));
vi.mock("../auth/clerk.tsx", () => ({ useAccount: () => ({ userId: "synthetic-user" }) }));
let queries: QueryClient;
let renderer: ReactTestRenderer | undefined;
let current: string;
function Probe({ live = true }: { live?: boolean }) {
  current = useFamilyApproval("synthetic-family", live);
  return null;
}
async function mount(live = true) {
  await act(async () => {
    renderer = create(
      createElement(QueryClientProvider, { client: queries }, createElement(Probe, { live })),
    );
  });
}
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  mocks.configured = true;
  mocks.read.mockReset();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  queries.clear();
  vi.useRealTimers();
});

describe("family approval on the invitation screen", () => {
  it("holds the invitation while the first approval check is pending", async () => {
    let approve: (() => void) | undefined;
    mocks.read.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        }),
    );
    await mount();
    expect(current).toBe("waiting");
    await act(async () => {
      approve?.();
    });
    await settle();
    expect(current).toBe("approved");
  });
  it("holds the invitation through a network error and checks again", async () => {
    mocks.read.mockRejectedValue(new Error("synthetic network failure"));
    await mount();
    await settle();
    expect(current).toBe("waiting");
    mocks.read.mockResolvedValue({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAMILY_WAITING_RECHECK_MS + 1);
    });
    await settle();
    expect(current).toBe("approved");
  });
  it("holds a family waiting for the founder, then opens after approval", async () => {
    mocks.read.mockRejectedValue(new ApiError(403, "forbidden", { reason: "family_waiting" }));
    await mount();
    await settle();
    expect(current).toBe("waiting");
    mocks.read.mockResolvedValue({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAMILY_WAITING_RECHECK_MS + 1);
    });
    await settle();
    expect(current).toBe("approved");
  });
  it("keeps the example journey usable without live approval", async () => {
    await mount(false);
    expect(current).toBe("approved");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
