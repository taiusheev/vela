import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { BrandIcon } from "../components/brand/icon.tsx";
import { Words } from "../components/ui.tsx";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, space } from "../theme/tokens.ts";
import { clock } from "./useRecording.ts";

/** The speeds a voice cycles through, as messengers offer them. */
export const RATES = [1, 1.5, 2] as const;
export type Rate = (typeof RATES)[number];

export function nextRate(rate: Rate): Rate {
  return RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
}

/** How many bars a voice is drawn with. */
export const BARS = 28;

/**
 * A recording's levels (0 to 1, one per meter reading) as `BARS` bars: each bar the loudest reading
 * of its stretch, so a word stands up and a pause lies low. Without readings, a level line.
 */
export function barsOf(levels: readonly number[] | undefined): number[] {
  if (levels === undefined || levels.length === 0) return Array.from({ length: BARS }, () => 0.18);
  return Array.from({ length: BARS }, (_, index) => {
    const from = Math.floor((index * levels.length) / BARS);
    const to = Math.max(from + 1, Math.floor(((index + 1) * levels.length) / BARS));
    const loudest = Math.max(...levels.slice(from, to));
    return Math.min(Math.max(loudest, 0.12), 1);
  });
}

/**
 * One voice as people know it from their messengers: a round play button, the voice as bars that
 * fill as it plays (a tap on them jumps there), the time, and 1×, 1.5× or 2×.
 */
export function VoiceBar({
  playing,
  loading = false,
  disabled = false,
  progress,
  elapsedMs,
  totalMs,
  levels,
  rate,
  label,
  onToggle,
  onSeek,
  onRate,
}: {
  playing: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** How far it has played, 0 to 1. */
  progress: number;
  elapsedMs: number;
  totalMs: number | null;
  levels?: readonly number[];
  rate: Rate;
  /** What the play button says to a screen reader: "Play Mom's voice". */
  label: string;
  onToggle: () => void;
  onSeek?: (fraction: number) => void;
  onRate?: (rate: Rate) => void;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  const bars = barsOf(levels);
  const shown = playing || elapsedMs > 0 ? elapsedMs : (totalMs ?? 0);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        paddingVertical: space.s,
        paddingLeft: space.s,
        paddingRight: space.m,
        borderRadius: radius.chip,
        backgroundColor: palette.actionSoft,
        alignSelf: "stretch",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? t`Pause` : label}
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={onToggle}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: disabled ? palette.surface2 : palette.action,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {loading ? (
          <ActivityIndicator color={palette.onAction} />
        ) : (
          <BrandIcon
            name={playing ? "pause" : "play"}
            color={disabled ? palette.ink3 : palette.onAction}
            size={20}
            strokeWidth={2.2}
          />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Pressable
          accessible={false}
          disabled={onSeek === undefined || disabled}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            if (width > 0) onSeek?.(Math.min(Math.max(event.nativeEvent.locationX / width, 0), 1));
          }}
          style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 2 }}
        >
          {bars.map((level, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: The bars are a fixed row by position.
              key={index}
              style={{
                flex: 1,
                height: Math.max(3, Math.round(level * 26)),
                borderRadius: 2,
                backgroundColor: (index + 0.5) / BARS <= progress ? palette.action : palette.ink3,
                opacity: (index + 0.5) / BARS <= progress ? 1 : 0.45,
              }}
            />
          ))}
        </Pressable>
        <Words variant="caption" tone="ink2">
          {clock(shown)}
        </Words>
      </View>
      {onRate === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Playback speed ${rate} times`}
          hitSlop={hitSlop}
          onPress={() => onRate(nextRate(rate))}
          style={{
            minWidth: 40,
            paddingVertical: 4,
            paddingHorizontal: space.s,
            borderRadius: radius.chip,
            backgroundColor: palette.surface,
            alignItems: "center",
          }}
        >
          <Words variant="caption" tone="ink">{`${rate}×`}</Words>
        </Pressable>
      )}
    </View>
  );
}
