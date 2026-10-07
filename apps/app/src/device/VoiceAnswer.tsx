import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { clock, type Recorded, useRecording } from "../audio/useRecording.ts";
import { BrandIcon } from "../components/brand/icon.tsx";
import { lightPalette as light } from "../theme/tokens.ts";

/**
 * P4 (spec §14.2): her answer in her own voice. One large button starts it; while it records she
 * sees the time and a level that moves with her voice, and one large Stop; then she can listen,
 * send it, or record again. The microphone is asked for on her first tap, not before. A recording
 * keeps its key until it goes, so sending again after trouble is the same recording, never two.
 */
export function VoiceAnswer({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (recording: Recorded) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const voice = useRecording();
  const [sending, setSending] = useState(false);
  const recorded = voice.recorded;
  const start = voice.start;
  const listen = voice.listen;

  const go = async () => {
    if (recorded === null) return;
    setSending(true);
    try {
      if (await send(recorded)) voice.clear();
    } finally {
      setSending(false);
    }
  };

  if (voice.recording) {
    const time = clock(voice.elapsedMs);
    const level = voice.level;
    return (
      <View style={styles.box}>
        <Text style={styles.body} accessibilityLiveRegion="polite">
          <Trans>Recording… {time}</Trans>
        </Text>
        <View style={styles.meter} accessibilityElementsHidden>
          <View style={[styles.meterLevel, { width: `${Math.round(level * 100)}%` }]} />
        </View>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
          onPress={() => void voice.stop()}
        >
          <Text style={styles.primaryLabel}>
            <Trans>Stop</Trans>
          </Text>
        </Pressable>
      </View>
    );
  }

  if (recorded !== null) {
    const time = clock(recorded.durationMs);
    return (
      <View style={styles.box}>
        <Text style={styles.body}>
          <Trans>Your answer, {time} long.</Trans>
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={sending || disabled}
          style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
          onPress={() => void go()}
        >
          <Text style={styles.primaryLabel}>{sending ? t`Sending…` : t`Send my answer`}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={sending}
          style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
          onPress={() => void listen()}
        >
          <Text style={styles.secondaryLabel}>
            <Trans>Listen</Trans>
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={sending}
          style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
          onPress={() => void start()}
        >
          <Text style={styles.secondaryLabel}>
            <Trans>Record again</Trans>
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        style={({ pressed }) => [styles.secondary, pressed ? styles.pressed : null]}
        onPress={() => void start()}
      >
        <BrandIcon name="mic" color={light.action} size={24} />
        <Text style={styles.secondaryLabel}>
          <Trans>Answer with your voice</Trans>
        </Text>
      </Pressable>
      {voice.failed ? (
        <Text style={styles.body}>
          <Trans>That recording did not save. Try again.</Trans>
        </Text>
      ) : null}
      {voice.refused ? (
        <Text style={styles.body}>
          <Trans>
            To answer with your voice, Vela needs the microphone. Ask your family to turn it on in
            Settings.
          </Trans>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 16 },
  body: { fontFamily: "Inter_400Regular", fontSize: 22, lineHeight: 32, color: light.ink },
  meter: {
    height: 16,
    borderRadius: 8,
    backgroundColor: light.surface2,
    overflow: "hidden",
  },
  meterLevel: { height: "100%", backgroundColor: light.action },
  primary: {
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: light.action,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  primaryLabel: { fontFamily: "Inter_600SemiBold", fontSize: 22, color: light.surface },
  secondary: {
    minHeight: 64,
    flexDirection: "row",
    gap: 12,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: light.action,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  secondaryLabel: { fontFamily: "Inter_600SemiBold", fontSize: 22, color: light.action },
  pressed: { opacity: 0.85 },
});
