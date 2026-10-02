import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { clock, type Recorded, useRecording } from "../audio/useRecording.ts";
import { hitSlop, space } from "../theme/tokens.ts";
import { SecondaryButton, Words } from "./ui.tsx";

/** A voice hello is about ten seconds (spec §4); the recorder stops itself there. */
const HELLO_MS = 10_000;

/**
 * The voice hello on Ask (spec §4, A7): about ten seconds of the asker's own voice, which plays to
 * her before the ask. Recorded here, kept by the caller until the ask is sent, and uploaded then.
 */
export function VoiceHello({ onChange }: { onChange(recorded: Recorded | null): void }) {
  const { t } = useLingui();
  const voice = useRecording({ maxMs: HELLO_MS });
  const recorded = voice.recorded;
  useEffect(() => {
    onChange(recorded);
  }, [recorded, onChange]);

  if (voice.recording) {
    const time = clock(voice.elapsedMs);
    return (
      <View style={{ gap: space.s }}>
        <Words variant="body" tone="ink2">
          <Trans>Recording your hello… {time} of 0:10</Trans>
        </Words>
        <SecondaryButton label={t`Stop`} onPress={() => void voice.stop()} />
      </View>
    );
  }
  if (recorded !== null) {
    const time = clock(recorded.durationMs);
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.l }}>
        <Words variant="body" tone="ink2">
          <Trans>Voice hello, {time}. It plays before your ask.</Trans>
        </Words>
        <Pressable accessibilityRole="button" hitSlop={hitSlop} onPress={() => void voice.listen()}>
          <Words variant="button" tone="action">
            <Trans>Listen</Trans>
          </Words>
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={hitSlop} onPress={() => voice.clear()}>
          <Words variant="button" tone="action">
            <Trans>Remove</Trans>
          </Words>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={{ gap: space.s }}>
      <SecondaryButton
        label={t`🎙 Add a voice hello (10 seconds)`}
        onPress={() => void voice.start()}
      />
      {voice.failed ? (
        <Words variant="caption" tone="ink3">
          <Trans>That recording did not save. Try again.</Trans>
        </Words>
      ) : null}
      {voice.refused ? (
        <Words variant="caption" tone="ink3">
          <Trans>Vela needs the microphone for a voice hello. You can allow it in Settings.</Trans>
        </Words>
      ) : null}
    </View>
  );
}
