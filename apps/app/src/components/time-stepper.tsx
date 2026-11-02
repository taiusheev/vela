import { useLingui } from "@lingui/react/macro";
import { Pressable, View } from "react-native";
import { stepTime } from "../data/time-step.ts";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, space, type } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Text } from "./scaled-text.tsx";

/**
 * A morning time chosen with two buttons a quarter hour apart, the time large between them, instead
 * of a typed "HH:MM". VoiceOver can tap either button, or swipe up or down on the time itself.
 */
export function TimeStepper({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange(next: string): void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const palette = usePalette();
  const move = (direction: 1 | -1) => {
    if (!disabled) onChange(stepTime(value, direction));
  };
  const button = (direction: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === 1 ? t`15 minutes later` : t`15 minutes earlier`}
      accessibilityState={{ disabled }}
      hitSlop={hitSlop}
      disabled={disabled}
      onPress={() => move(direction)}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.actionSoft,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <BrandIcon
        name={direction === 1 ? "plus" : "minus"}
        color={palette.action}
        size={22}
        strokeWidth={2.2}
      />
    </Pressable>
  );
  return (
    <View style={{ gap: space.s }}>
      <Text style={[type.heading, { color: palette.ink }]}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.l,
          paddingVertical: space.m,
          paddingHorizontal: space.m,
          borderRadius: radius.panel,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.rule,
        }}
      >
        {button(-1)}
        <Text
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: value }}
          accessibilityHint={t`Swipe up or down to move it by 15 minutes.`}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "increment") move(1);
            if (event.nativeEvent.actionName === "decrement") move(-1);
          }}
          style={[
            type.display,
            { color: palette.ink, fontVariant: ["tabular-nums"], textAlign: "center", flex: 1 },
          ]}
        >
          {value}
        </Text>
        {button(1)}
      </View>
    </View>
  );
}
