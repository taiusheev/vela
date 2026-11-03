import {
  focusManager,
  onlineManager,
  type QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { createElement, Fragment, type ReactNode, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchMe } from "../api/client.ts";
import { resetDraft, updateDraft } from "../data/onboarding-draft.ts";
import { createSessionQueries } from "../data/query-client.ts";
import { AppPrivacyGate, QUIET_ACCOUNT_RETRIES_MS } from "./app-privacy.tsx";

const mocks = vi.hoisted(() => ({ read: vi.fn(), provision: vi.fn() }));
vi.mock("../api/client.ts", async (original) => ({
  ...(await original<typeof import("../api/client.ts")>()),
  apiConfigured: () => true,
  fetchMe: (...args: unknown[]) => mocks.read(...args),
  provisionAccount: (...args: unknown[]) => mocks.provision(...args),
}));
vi.mock("./light.tsx", () => ({ Light: () => null }));
vi.mock("../auth/clerk.tsx", () => ({
  useAccount: () => ({
    ready: true,
    signedIn: true,
    userId: "synthetic-user",
    sessionId: "synthetic-session",
    token: async () => "synthetic-token",
    signOut: vi.fn(),
  }),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray) => strings.join(""),
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Linking: { openURL: vi.fn() },
  ScrollView: "scroll-view",
  View: "view",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("../theme/theme.tsx", () => ({ usePalette: () => ({ bg: "white" }) }));
vi.mock("./legal-links.tsx", () => ({ LegalLinks: () => null }));
vi.mock("./loading-light.tsx", () => ({ LoadingLight: "loading-light" }));
vi.mock("./ui.tsx", () => ({
  Card: "card",
  PrimaryButton: "primary-button",
  SecondaryButton: "secondary-button",
  TextButton: "text-button",
  Words: "words",
}));

let renderer: ReactTestRenderer | undefined;
let queries: QueryClient;
let mounts = 0;
let unmounts = 0;

/** As in Root, this account read stays mounted while the gate waits. */
function WarmAccountProbe() {
  useQuery({ queryKey: ["me"], queryFn: () => fetchMe("synthetic-token") });
  return null;
}

function NavigationProbe() {
  useQuery({ queryKey: ["me"], queryFn: () => fetchMe("synthetic-token") });
  useEffect(() => {
    mounts += 1;
    return () => {
      unmounts += 1;
    };
  }, []);
  return createElement("navigator");
}

beforeEach(() => {
  // React requires this flag for concurrent renderer updates inside act().
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  resetDraft();
  mounts = 0;
  unmounts = 0;
  mocks.read.mockReset();
  mocks.provision.mockReset();
  queries = createSessionQueries();
  queries.setDefaultOptions({ queries: { ...queries.getDefaultOptions().queries, retryDelay: 0 } });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queries.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

function nodes(type: string) {
  return renderer?.root.findAll((node) => String(node.type) === type) ?? [];
}

async function open() {
  await act(async () => {
    renderer = create(
      createElement(
        QueryClientProvider,
        { client: queries },
        createElement(
          Fragment,
          null,
          createElement(WarmAccountProbe),
          createElement(AppPrivacyGate, null, createElement(NavigationProbe)),
        ),
      ),
    );
  });
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(20);
    else await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("privacy gate with shared account readers", () => {
  it("keeps a confirmed new-account setup mounted during its background account refresh", async () => {
    mocks.read.mockRejectedValueOnce(new ApiError(404, "not_found"));
    let finish: (value: unknown) => void = () => {};
    mocks.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    updateDraft({ privacyAccepted: true });
    await open();
    expect(nodes("navigator")).toHaveLength(1);
    let refresh: Promise<void> | undefined;
    await act(async () => {
      refresh = queries.invalidateQueries({ queryKey: ["me"] });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(nodes("navigator")).toHaveLength(1);
    expect(unmounts).toBe(0);
    await act(async () => {
      finish({ user: { id: "synthetic-user" }, memberships: [], privacy_accepted: true });
      await refresh;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mounts).toBe(1);
  });

  it("shows only the account screen while waiting, then replaces a stuck first read on retry", async () => {
    vi.useFakeTimers();
    let finishOld: (value: unknown) => void = () => {};
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    mocks.read.mockImplementationOnce(() => new Promise(() => {}));
    const user = { id: "synthetic-user", display_name: "Anna", language: "en", tz: "Asia/Taipei" };
    mocks.read.mockResolvedValue({ user, memberships: [], privacy_accepted: true });
    updateDraft({ privacyAccepted: true });
    await open();
    expect(nodes("loading-light")).toHaveLength(1);
    expect(nodes("navigator")).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      nodes("secondary-button")
        .find((node) => node.props.label === "Try again")
        ?.props.onPress();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(nodes("loading-light")).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      nodes("secondary-button")
        .find((node) => node.props.label === "Try again")
        ?.props.onPress();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(nodes("loading-light")).toHaveLength(0);
    expect(nodes("navigator")).toHaveLength(1);
    await act(async () => {
      finishOld({ user, memberships: [], privacy_accepted: false });
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(queries.getQueryData(["me"])).toMatchObject({ privacy_accepted: true });
    expect(nodes("loading-light")).toHaveLength(0);
    expect(mounts).toBe(1);
  });

  it("settles a new-account read even if sign-in left focus inactive and another screen observes it", async () => {
    focusManager.setFocused(false);
    mocks.read.mockRejectedValue(new ApiError(404, "not_found"));
    updateDraft({ privacyAccepted: true });
    await open();
    expect(queries.getQueryState(["me"])?.status).toBe("error");
    expect(nodes("navigator")).toHaveLength(1);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("tries a failed first read again on its own, even inactive and offline, and opens with no error", async () => {
    focusManager.setFocused(false);
    onlineManager.setOnline(false);
    mocks.read.mockRejectedValueOnce(new ApiError(503, "unavailable"));
    const user = { id: "synthetic-user", display_name: "Anna", language: "en", tz: "Asia/Taipei" };
    mocks.read.mockResolvedValue({ user, memberships: [], privacy_accepted: true });
    updateDraft({ privacyAccepted: true });
    await open();
    expect(queries.getQueryState(["me"])?.status).toBe("error");
    expect(nodes("navigator")).toHaveLength(0);
    // Still loading, not an error, while the quiet retry waits.
    expect(nodes("secondary-button")).toHaveLength(0);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, QUIET_ACCOUNT_RETRIES_MS[0] + 50));
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(nodes("navigator")).toHaveLength(1);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("offers Try again only after every quiet retry failed, and that retry still works", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.read.mockRejectedValue(new ApiError(503, "unavailable"));
      updateDraft({ privacyAccepted: true });
      await open();
      const quiet = QUIET_ACCOUNT_RETRIES_MS.reduce((sum, wait) => sum + wait, 0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(quiet + 500);
      });
      expect(mocks.read).toHaveBeenCalledTimes(QUIET_ACCOUNT_RETRIES_MS.length + 1);
      expect(nodes("navigator")).toHaveLength(0);
      expect(nodes("secondary-button")).toHaveLength(1);
      const user = {
        id: "synthetic-user",
        display_name: "Anna",
        language: "en",
        tz: "Asia/Taipei",
      };
      mocks.read.mockResolvedValue({ user, memberships: [], privacy_accepted: true });
      await act(async () => {
        nodes("secondary-button")[0]?.props.onPress();
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(nodes("navigator")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues into setup after a new account accepts privacy, without restarting its missing-account read", async () => {
    mocks.read.mockRejectedValueOnce(new ApiError(404, "not_found"));
    // A remount would start another read and leave the gate on Loading your account.
    mocks.read.mockImplementation(() => new Promise(() => {}));
    await open();
    expect(nodes("primary-button")).toHaveLength(1);
    await act(async () => {
      nodes("primary-button")[0]?.props.onPress();
    });
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(nodes("navigator")).toHaveLength(1);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("opens navigation only after an existing account's choice is saved", async () => {
    const user = { id: "synthetic-user", display_name: "Anna", language: "en", tz: "Asia/Taipei" };
    mocks.read.mockResolvedValueOnce({ user, memberships: [], privacy_accepted: false });
    mocks.read.mockResolvedValue({ user, memberships: [], privacy_accepted: true });
    mocks.provision.mockResolvedValue(user);
    await open();
    await act(async () => updateDraft({ privacyAccepted: true }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mocks.provision).toHaveBeenCalledTimes(1);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    expect(nodes("navigator")).toHaveLength(1);
  });
});
