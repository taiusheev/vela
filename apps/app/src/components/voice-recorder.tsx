import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { clock, type Recorded, useRecording } from "../audio/useRecording.ts";
import { BARS, barsOf, VoiceBar } from "../audio/voice-bar.tsx";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, space } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";
import { Words } from "./ui.tsx";

/**
 * A voice recorded the way messengers do it now: one tap on the microphone and it records at once,
 * the voice drawn as it is said, a bin to throw it away, a stop to hear it back, and — where it
 * goes straight out — a send that stops and sends in one tap. The finished recording plays back as
 * its own bars, with the same speeds as every other voice.
 */
export function VoiceRecorder({
  label,
  maxMs,
  disabled = false,
  sending = false,
  refusedText,
  onRecorded,
  onSend,
  compact = false,
  onRecordingChange,
}: {
  /** The microphone button's words before anything is recorded. */
  label: string;
  compact?: boolean;
  onRecordingChange?: (recording: boolean) => void;
  maxMs?: number;
  disabled?: boolean;
  sending?: boolean;
  refusedText: string;
  /** Told of each finished recording, and of null when it is thrown away. */
  onRecorded?: (recorded: Recorded | null) => void;
  /** Sends a recording; true once it went, so the recorder empties. */
  onSend?: (recorded: Recorded) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const voice = useRecording(maxMs === undefined ? {} : { maxMs });
  const recorded = voice.recorded;
  useEffect(() => {
    onRecordingChange?.(voice.recording);
  }, [voice.recording, onRecordingChange]);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);

  useEffect(() => {
    onRecorded?.(recorded);
  }, [recorded, onRecorded]);

  const send = async (take: Recorded | null) => {
    if (take === null || onSend === undefined) return;
    if (await onSend(take)) voice.clear();
  };

  if (voice.recording) {
    const time = clock(voice.elapsedMs);
    const limit = maxMs === undefined ? null : clock(maxMs);
    const recent = voice.levels.slice(-BARS);
    return (
      <View style={{ gap: space.s }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.m,
            paddingVertical: space.s,
            paddingHorizontal: space.s,
            borderRadius: radius.chip,
            backgroundColor: palette.actionSoft,
          }}
        >
          <RoundButton
            icon="trash"
            label={t`Throw this recording away`}
            tone="quiet"
            onPress={() => void voice.cancel()}
          />
          <View style={{ flex: 1, gap: 2 }} accessibilityLiveRegion="polite">
            <View
              accessibilityElementsHidden
              style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 2 }}
            >
              {barsOf([...Array(Math.max(0, BARS - recent.length)).fill(0.04), ...recent]).map(
                (level, index) => (
                  <View
                    // biome-ignore lint/suspicious/noArrayIndexKey: The bars are a fixed row by position.
                    key={index}
                    style={{
                      flex: 1,
                      height: Math.max(3, Math.round(level * 26)),
                      borderRadius: 2,
                      backgroundColor: palette.action,
                    }}
                  />
                ),
              )}
            </View>
            <Words variant="caption" tone="ink2">
              {limit === null ? (
                <Trans>Recording · {time}</Trans>
              ) : (
                <Trans>
                  Recording · {time} of {limit}
                </Trans>
              )}
            </Words>
          </View>
          {onSend === undefined ? (
            <RoundButton icon="stop" label={t`Stop recording`} onPress={() => void voice.stop()} />
          ) : (
            <>
              <RoundButton
                icon="stop"
                label={t`Stop and listen first`}
                tone="quiet"
                onPress={() => void voice.stop()}
              />
              <RoundButton
                icon="send"
                label={t`Send now`}
                disabled={disabled || sending}
                onPress={() => void voice.stop().then(send)}
              />
            </>
          )}
        </View>
      </View>
    );
  }

  if (recorded !== null) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.s }}>
        <RoundButton
          icon="trash"
          label={t`Throw this recording away`}
          tone="quiet"
          disabled={sending}
          onPress={() => voice.clear()}
        />
        <View style={{ flex: 1 }}>
          <VoiceBar
            playing={voice.playing}
            progress={recorded.durationMs > 0 ? voice.playedMs / recorded.durationMs : 0}
            elapsedMs={voice.playedMs}
            totalMs={recorded.durationMs}
            levels={recorded.levels}
            rate={rate}
            label={t`Listen to your recording`}
            onToggle={() => void voice.listen()}
            onSeek={voice.seek}
            onRate={setRate}
          />
        </View>
        {onSend === undefined ? null : (
          <RoundButton
            icon="send"
            label={sending ? t`Sending…` : t`Send`}
            disabled={disabled || sending}
            onPress={() => void send(recorded)}
          />
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: space.s, alignSelf: compact ? "flex-start" : undefined }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={() => void voice.start()}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.m,
          minHeight: 52,
          paddingHorizontal: compact ? space.m : space.l,
          borderRadius: radius.chip,
          borderWidth: 1,
          borderColor: palette.control,
          backgroundColor: pressed ? palette.surface2 : palette.surface,
          opacity: disabled ? 0.5 : 1,
        })}
      >
        <BrandIcon name="mic" color={palette.action} size={22} strokeWidth={2} />
        {compact ? null : (
          <Words variant="button" tone="action">
            {label}
          </Words>
        )}
      </Pressable>
      {voice.failed ? (
        <Words variant="caption" tone="ink3">
          <Trans>That recording did not save. Try again.</Trans>
        </Words>
      ) : null}
      {voice.refused ? (
        <Words variant="caption" tone="ink3">
          {refusedText}
        </Words>
      ) : null}
    </View>
  );
}

function RoundButton({
  icon,
  label,
  tone = "action",
  disabled = false,
  onPress,
}: {
  icon: BrandIconName;
  label: string;
  tone?: "action" | "quiet";
  disabled?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const filled = tone === "action";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: filled ? palette.action : palette.surface,
        opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <BrandIcon
        name={icon}
        color={filled ? palette.onAction : palette.ink2}
        size={20}
        strokeWidth={2.2}
      />
    </Pressable>
  );
}
