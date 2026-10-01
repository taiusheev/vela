import { Trans, useLingui } from "@lingui/react/macro";
import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { recordingKey } from "../api/upload.ts";
import { lightPalette as light } from "../theme/tokens.ts";

/** A voice answer is a few sentences; five minutes stops a recording left running in a pocket. */
const LONGEST_MS = 5 * 60 * 1_000;

/**
 * Her voice as both phones record it and Telegram takes it as a voice note: AAC in `.m4a`, one
 * channel at 64 kbit/s, about half a megabyte a minute, well under the 3 MiB the Worker keeps.
 */
const VOICE: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 44_100,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/webm", bitsPerSecond: 64_000 },
};

interface Recorded {
  uri: string;
  key: string;
  durationMs: number;
}

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
  const recorder = useAudioRecorder(VOICE);
  const state = useAudioRecorderState(recorder, 200);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [refused, setRefused] = useState(false);
  const [sending, setSending] = useState(false);
  const player = useAudioPlayer(recorded?.uri ?? null);
  const stopping = useRef(false);

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri !== null) {
        setRecorded({ uri, key: recordingKey(), durationMs: state.durationMillis });
      }
    } finally {
      stopping.current = false;
    }
  };

  // A recording left running stops itself at five minutes.
  useEffect(() => {
    if (state.isRecording && state.durationMillis >= LONGEST_MS) void stop();
  });

  const start = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setRefused(true);
      return;
    }
    setRefused(false);
    setRecorded(null);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const listen = async () => {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    await player.seekTo(0);
    player.play();
  };

  const go = async () => {
    if (recorded === null) return;
    setSending(true);
    try {
      if (await send(recorded)) setRecorded(null);
    } finally {
      setSending(false);
    }
  };

  if (state.isRecording) {
    // Metering is in decibels, -160 for silence up to 0; speech sits around -40 to -10.
    const time = clock(state.durationMillis);
    const level = Math.min(Math.max(((state.metering ?? -160) + 60) / 60, 0.04), 1);
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
          onPress={() => void stop()}
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
        <Text style={styles.secondaryLabel}>
          <Trans>🎙 Answer with your voice</Trans>
        </Text>
      </Pressable>
      {refused ? (
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

/** A length as she reads it on a clock: 0:42, 2:05. */
function clock(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
