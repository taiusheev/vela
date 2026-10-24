import { focusManager, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { type AppStateSource, followAppFocus, inFront } from "./app-focus.ts";

function fakeAppState(initial: string): AppStateSource & { emit(state: string): void } {
  const listeners = new Set<(state: string) => void>();
  return {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(state) {
      for (const listener of listeners) listener(state);
    },
  };
}

afterEach(() => {
  focusManager.setFocused(undefined);
});

describe("the app's focus", () => {
  it("counts only a phone that says it went away as away", () => {
    expect(inFront("active")).toBe(true);
    expect(inFront(null)).toBe(true);
    expect(inFront("unknown")).toBe(true);
    expect(inFront("background")).toBe(false);
    expect(inFront("inactive")).toBe(false);
  });

  it("follows the phone for the whole app, whatever the sessions do", () => {
    const appState = fakeAppState("active");
    followAppFocus(appState);
    expect(focusManager.isFocused()).toBe(true);
    appState.emit("inactive");
    expect(focusManager.isFocused()).toBe(false);
    appState.emit("active");
    expect(focusManager.isFocused()).toBe(true);
  });

  it("lets a failed first account read try again once the app is back in front", async () => {
    const appState = fakeAppState("active");
    followAppFocus(appState);
    const client = new QueryClient();
    // As QueryClientProvider does: the client then hears focus come back.
    client.mount();
    let calls = 0;
    // The sign-in sheet has just taken the app away; the first read fails (no token yet).
    appState.emit("inactive");
    const read = client.fetchQuery({
      queryKey: ["me"],
      retry: 1,
      retryDelay: 0,
      queryFn: async () => {
        calls += 1;
        if (calls === 1) throw new Error("401");
        return { user: "me" };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Held while the app is away, as react-query holds every retry.
    expect(calls).toBe(1);
    appState.emit("active");
    await expect(read).resolves.toEqual({ user: "me" });
    expect(calls).toBe(2);
    client.unmount();
  });
});
