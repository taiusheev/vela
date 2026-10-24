import { focusManager } from "@tanstack/react-query";

/** The part of React Native's AppState this needs, so a test can stand in for it. */
export interface AppStateSource {
  readonly currentState: string | null;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
}

/** In front, or not yet known: only a phone that says it went away counts as away. */
export function inFront(state: string | null): boolean {
  return state !== "background" && state !== "inactive";
}

/**
 * Tells react-query whether the app is in front, once for the whole app and for as long as it
 * runs. It used to be told by each signed-in session, which stopped listening when a sign-in
 * replaced the session: the phone's "back in front" after the sign-in sheet could fall between the
 * two, leaving react-query sure the app was away. Then it held every retry, and a first account
 * read that had failed waited for ever on "Loading your account…" (24 Oct 2026).
 */
export function followAppFocus(appState: AppStateSource): void {
  focusManager.setEventListener((setFocused) => {
    setFocused(inFront(appState.currentState));
    const subscription = appState.addEventListener("change", (state) => setFocused(inFront(state)));
    return () => subscription.remove();
  });
}
