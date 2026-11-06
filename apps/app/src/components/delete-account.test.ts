import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteAccountBody } from "./delete-account.tsx";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  token: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("expo-router", () => ({ router: { replace: mocks.replace } }));
vi.mock("../api/client.ts", async (original) => ({
  ...(await original<typeof import("../api/client.ts")>()),
  apiConfigured: () => true,
  deleteAccount: (...args: unknown[]) => mocks.remove(...args),
}));
vi.mock("../api/idempotency.ts", () => ({ useIdempotencyKey: () => () => "synthetic-delete-key" }));
vi.mock("../auth/clerk.tsx", () => ({
  useAccount: () => ({ signedIn: true, token: mocks.token }),
}));
vi.mock("../push/provider.tsx", () => ({ usePush: () => ({ signOut: mocks.signOut }) }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Pressable: "pressable",
  ScrollView: "scroll-view",
  View: "view",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("../theme/theme.tsx", () => ({ usePalette: () => ({ bg: "white" }) }));
vi.mock("./ui.tsx", () => ({
  Card: "card",
  SecondaryButton: "secondary-button",
  TextButton: "text-button",
  Words: "words",
}));
vi.mock("./confirmation-dialog.tsx", () => ({
  ConfirmationDialog: ({ children }: { children: ReactNode }) =>
    createElement("dialog", null, children),
}));

let renderer: ReactTestRenderer | undefined;
let queries: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.token.mockResolvedValue("synthetic-token");
  mocks.remove.mockResolvedValue({ deleted: true, left: 0, kept: 0 });
  mocks.signOut.mockResolvedValue(undefined);
  queries = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queries.clear();
});

async function open(navigateAfterDeletion = true) {
  await act(async () => {
    renderer = create(
      createElement(
        QueryClientProvider,
        { client: queries },
        createElement(DeleteAccountBody, { navigateAfterDeletion }),
      ),
    );
  });
  await act(async () =>
    renderer?.root.find((node) => String(node.type) === "secondary-button").props.onPress(),
  );
}

it("requires the final confirmation and lets Keep my account cancel without a write", async () => {
  await open(false);
  expect(renderer?.root.findAllByType("dialog")).toHaveLength(1);
  expect(mocks.remove).not.toHaveBeenCalled();
  await act(async () =>
    renderer?.root.find((node) => String(node.type) === "pressable").props.onPress(),
  );
  expect(renderer?.root.findAllByType("dialog")).toHaveLength(0);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it.each([false, true])(
  "deletes and signs out with navigateAfterDeletion=%s",
  async (navigateAfterDeletion) => {
    const clear = vi.spyOn(queries, "clear");
    await open(navigateAfterDeletion);
    await act(async () => {
      renderer?.root
        .findByType("dialog")
        .find((node) => String(node.type) === "secondary-button")
        .props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mocks.token).toHaveBeenCalledExactlyOnceWith({ fresh: true });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("synthetic-delete-key", "synthetic-token");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    if (navigateAfterDeletion) expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/");
    else expect(mocks.replace).not.toHaveBeenCalled();
    expect(renderer?.root.findAllByType("dialog")).toHaveLength(0);
  },
);
