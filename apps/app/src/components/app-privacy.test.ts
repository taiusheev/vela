import {
  focusManager,
  onlineManager,
  type QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { createElement, type ReactNode, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchMe } from "../api/client.ts";
import { resetDraft, updateDraft } from "../data/onboarding-draft.ts";
import { createSessionQueries } from "../data/query-client.ts";
import { AppPrivacyGate } from "./app-privacy.tsx";

const mocks = vi.hoisted(() => ({ read: vi.fn(), provision: vi.fn() }));
vi.mock("../api/client.ts", async (original) => ({
  ...(await original<typeof import("../api/client.ts")>()),
  apiConfigured: () => true,
  fetchMe: (...args: unknown[]) => mocks.read(...args),
  provisionAccount: (...args: unknown[]) => mocks.provision(...args),
}));
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
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Linking: { openURL: vi.fn() },
  Modal: "modal",
  ScrollView: "scroll-view",
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
  Words: "words",
}));

let renderer: ReactTestRenderer | undefined;
let queries: QueryClient;
let mounts = 0;
let unmounts = 0;

/** The navigator's screens observe the same account read as the privacy gate. */
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
        createElement(AppPrivacyGate, null, createElement(NavigationProbe)),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("privacy gate with shared account readers", () => {
  it("settles a new-account read even if sign-in left focus inactive and another screen observes it", async () => {
    focusManager.setFocused(false);
    mocks.read.mockRejectedValue(new ApiError(404, "not_found"));
    updateDraft({ privacyAccepted: true });
    await open();
    expect(queries.getQueryState(["me"])?.status).toBe("error");
    expect(nodes("modal")).toHaveLength(0);
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("offers retry for a failed read while inactive and retries even when reported offline", async () => {
    focusManager.setFocused(false);
    onlineManager.setOnline(false);
    mocks.read.mockRejectedValueOnce(new ApiError(503, "unavailable"));
    const user = { id: "synthetic-user", display_name: "Anna", language: "en", tz: "Asia/Taipei" };
    mocks.read.mockResolvedValue({ user, memberships: [], privacy_accepted: true });
    updateDraft({ privacyAccepted: true });
    await open();
    expect(queries.getQueryState(["me"])?.status).toBe("error");
    expect(nodes("modal")).toHaveLength(1);
    expect(nodes("primary-button")).toHaveLength(0);
    await act(async () => {
      nodes("secondary-button")[0]?.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(nodes("modal")).toHaveLength(0);
    expect(mocks.provision).not.toHaveBeenCalled();
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
    expect(nodes("modal")).toHaveLength(0);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("keeps navigation and its state while an existing account's choice is saved", async () => {
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
    expect(nodes("modal")).toHaveLength(0);
  });
});
