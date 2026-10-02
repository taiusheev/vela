import { Trans, useLingui } from "@lingui/react/macro";
import { View } from "react-native";
import { clock, type Recorded, useRecording } from "../audio/useRecording.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space } from "../theme/tokens.ts";
import { PrimaryButton, SecondaryButton, Words } from "./ui.tsx";

/**
 * A voice reply on one exchange (spec §14.1 A8): record, then listen, send or record again. What
 * is sent goes up under the recording's own key and is then named by the reply, so a retry is the
 * same voice. Her next morning reads it back to her in the family's own voice.
 */
export function VoiceReply({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (recording: Recorded) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const voice = useRecording();
  const recorded = voice.recorded;

  if (voice.recording) {
    const time = clock(voice.elapsedMs);
    return (
      <View style={{ gap: space.s }}>
        <Words variant="body" tone="ink2">
          <Trans>Recording… {time}</Trans>
        </Words>
        <View
          accessibilityElementsHidden
          style={{
            height: 8,
            borderRadius: radius.chip,
            backgroundColor: palette.surface2,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: "100%",
              width: `${Math.round(voice.level * 100)}%`,
              backgroundColor: palette.action,
            }}
          />
        </View>
        <PrimaryButton label={t`Stop`} onPress={() => void voice.stop()} />
      </View>
    );
  }

  if (recorded !== null) {
    const time = clock(recorded.durationMs);
    return (
      <View style={{ gap: space.s }}>
        <Words variant="body" tone="ink2">
          <Trans>Your voice reply, {time} long.</Trans>
        </Words>
        <PrimaryButton
          label={disabled ? t`Sending…` : t`Send voice reply`}
          disabled={disabled}
          onPress={() => {
            void send(recorded).then((sent) => {
              if (sent) voice.clear();
            });
          }}
        />
        <SecondaryButton label={t`Listen`} onPress={() => void voice.listen()} />
        <SecondaryButton label={t`Record again`} onPress={() => void voice.start()} />
      </View>
    );
  }

  return (
    <View style={{ gap: space.s }}>
      <SecondaryButton label={t`🎙 Reply with your voice`} onPress={() => void voice.start()} />
      {voice.failed ? (
        <Words variant="caption" tone="ink3">
          <Trans>That recording did not save. Try again.</Trans>
        </Words>
      ) : null}
      {voice.refused ? (
        <Words variant="caption" tone="ink3">
          <Trans>Vela needs the microphone for a voice reply. You can allow it in Settings.</Trans>
        </Words>
      ) : null}
    </View>
  );
}
