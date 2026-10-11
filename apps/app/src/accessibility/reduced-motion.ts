export interface MotionPreferences {
  isReduceMotionEnabled(): Promise<boolean>;
  addEventListener(
    event: "reduceMotionChanged",
    listener: (enabled: boolean) => void,
  ): {
    remove(): void;
  };
}

/** A live change takes precedence over the older, asynchronous startup snapshot. */
export function watchReducedMotion(
  preferences: MotionPreferences,
  update: (enabled: boolean) => void,
): () => void {
  let active = true;
  let changed = false;
  const subscription = preferences.addEventListener("reduceMotionChanged", (enabled) => {
    changed = true;
    if (active) update(enabled);
  });
  void preferences.isReduceMotionEnabled().then(
    (enabled) => {
      if (active && !changed) update(enabled);
    },
    () => {
      // Keep the initial no-motion setting when the platform cannot report its preference.
    },
  );
  return () => {
    active = false;
    subscription.remove();
  };
}
