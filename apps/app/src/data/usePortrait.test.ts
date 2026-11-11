import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { PortraitStore } from "../storage/portrait-store.ts";

const state = vi.hoisted(() => ({
  scope: "account:session",
  values: new Map<string, string>(),
  pick: vi.fn(),
}));
vi.mock("../auth/clerk.tsx", () => ({ useAccount: () => ({ scope: state.scope }) }));
vi.mock("./live-state.ts", () => ({ sessionScope: (account: { scope: string }) => account.scope }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: state.pick }));
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: (uri: string) => ({
      resize: () => ({
        renderAsync: async () => ({
          saveAsync: async () => ({ base64: uri }),
          release: () => {},
        }),
      }),
      release: () => {},
    }),
  },
}));
vi.mock("../storage/portraits.ts", () => ({
  portraits: new PortraitStore({
    read: (scope, person) => state.values.get(`${scope}:${person}`) ?? null,
    save: (scope, person, uri) => {
      state.values.set(`${scope}:${person}`, uri);
      return uri;
    },
    remove: (scope, person) => {
      state.values.delete(`${scope}:${person}`);
    },
    clear: () => {
      state.values.clear();
    },
  }),
}));

import { usePortrait } from "./usePortrait.ts";

let renderer: ReactTestRenderer | undefined;
let client: QueryClient | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client?.clear();
  state.values.clear();
  state.pick.mockReset();
});

it("keeps Settings and an existing Today window in sync when photos are added later", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client = queryClient;
  const photos = new Map<string, ReturnType<typeof usePortrait>>();
  function Surface({
    id,
    family = "family",
    member = "mom",
  }: {
    id: string;
    family?: string;
    member?: string;
  }) {
    photos.set(id, usePortrait(family, member));
    return null;
  }
  await act(async () => {
    renderer = create(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Surface, { id: "settings" }),
        createElement(Surface, { id: "today" }),
        createElement(Surface, { id: "dad", member: "dad" }),
        createElement(Surface, { id: "other-family", family: "other" }),
      ),
    );
  });
  for (const id of ["settings", "today", "dad", "other-family"])
    expect(photos.get(id)?.uri).toBeNull();
  for (const uri of ["first-photo", "replacement-photo"]) {
    state.pick.mockResolvedValueOnce({ canceled: false, assets: [{ uri }] });
    await act(async () => {
      await photos.get("settings")?.choose();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(photos.get("settings")?.uri).toBe(`data:image/jpeg;base64,${uri}`);
    expect(photos.get("today")?.uri).toBe(photos.get("settings")?.uri);
    expect(photos.get("dad")?.uri).toBeNull();
    expect(photos.get("other-family")?.uri).toBeNull();
  }
  state.pick.mockResolvedValueOnce({ canceled: true, assets: null });
  await act(async () => {
    await photos.get("settings")?.choose();
  });
  expect(photos.get("today")?.uri).toBe("data:image/jpeg;base64,replacement-photo");
  await act(async () => {
    photos.get("settings")?.remove();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(photos.get("settings")?.uri).toBeNull();
  expect(photos.get("today")?.uri).toBeNull();
});
