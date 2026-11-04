import type { AppStateStatus } from "react-native";

/**
 * An update Vela downloaded while open is applied as soon as the app goes to the background, so
 * the next time someone opens Vela they see it. expo-updates alone waits for a second cold start,
 * which reads as "nothing changed". Never while the app is in front: nobody loses what they typed.
 */
export function applyPendingWhenLeaving(
  appState: {
    addEventListener(
      type: "change",
      listener: (state: AppStateStatus) => void,
    ): {
      remove(): void;
    };
  },
  reload: () => Promise<void>,
): () => void {
  let reloading = false;
  const subscription = appState.addEventListener("change", (state) => {
    if (state !== "background" || reloading) return;
    reloading = true;
    // A reload that fails leaves the old version running; the next launch applies the update.
    reload().catch(() => {
      reloading = false;
    });
  });
  return () => subscription.remove();
}

/** What Settings shows support: "update d02decdd", or "built in" before any update arrived. */
export function runningUpdateLabel(updateId: string | null | undefined, embedded: boolean) {
  if (embedded || updateId == null || updateId === "") return null;
  return updateId.slice(0, 8);
}
