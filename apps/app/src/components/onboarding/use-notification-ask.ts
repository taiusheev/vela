import { apiConfigured } from "../../api/client.ts";
import { useCapabilities } from "../../data/useCapabilities.ts";
import { useToday } from "../../data/useToday.ts";
import { usePush } from "../../push/provider.tsx";

/**
 * Whether to ask for notifications here, and how: only where this Vela sends them and the phone has
 * not said yes yet. "Not now" always stays: the phone's own prompt may never be forced.
 */
export function useNotificationAsk() {
  const push = usePush();
  const today = useToday();
  const { capabilities } = useCapabilities();
  const phone = push.phone;
  const offered =
    apiConfigured() &&
    (today.pushSent || capabilities?.push === true) &&
    push.availability.available &&
    phone !== null &&
    phone.permission !== "granted";
  const settings = phone !== null && !phone.canAskAgain;
  const ask = async () => {
    if (settings) {
      push.openSettings();
      return;
    }
    await push.ask();
  };
  return { offered, settings, asking: push.asking, ask, granted: phone?.permission === "granted" };
}
