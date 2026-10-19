import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** A private connection is checked only while its screen and the app are active. */
export function useConnectionForeground() {
  const [active, setActive] = useState(
    AppState.currentState !== "background" && AppState.currentState !== "inactive",
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return active;
}
