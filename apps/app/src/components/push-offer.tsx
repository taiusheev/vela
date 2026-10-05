import { useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import { usePush } from "../push/provider.tsx";
import { space } from "../theme/tokens.ts";
import { SecondaryButton, Words } from "./ui.tsx";

/**
 * Notifications offered where their use has just been said (ADR-34, A2): at the end of setting up a
 * family, after a first ask, and on You — never at launch and never as a card on Today. One sentence
 * of what they are for, then the button: the phone's own prompt while it can still ask, its settings
 * once it will not. Nothing shows where this build cannot receive pushes or they are already on.
 */
export function PushOffer({ reason, onAnswered }: { reason: string; onAnswered?: () => void }) {
  const { t } = useLingui();
  const push = usePush();
  const phone = push.phone;
  if (!push.availability.available || phone === null || phone.permission === "granted") {
    return null;
  }
  const settings = !phone.canAskAgain;
  return (
    <View style={{ gap: space.m }}>
      <Words variant="body" tone="ink2">
        {reason}
      </Words>
      <SecondaryButton
        label={settings ? t`Open settings` : push.asking ? t`Asking…` : t`Turn on notifications`}
        onPress={() => {
          if (push.asking) return;
          if (settings) {
            push.openSettings();
            onAnswered?.();
            return;
          }
          void push.ask().then(() => onAnswered?.());
        }}
      />
    </View>
  );
}
