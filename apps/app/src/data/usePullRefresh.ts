import { useCallback, useRef, useState } from "react";

/** Background polling stays silent; only a deliberate pull owns the refresh indicator. */
export function usePullRefresh(read: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setRefreshing(true);
    try {
      await read();
    } finally {
      running.current = false;
      setRefreshing(false);
    }
  }, [read]);
  return { refreshing, refresh };
}
