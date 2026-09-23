import type { ReactNode } from "react";
import { Pressable, type StyleProp, Text, View, type ViewStyle } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, space, type TextStyle, type } from "../theme/tokens.ts";

type Role = keyof typeof type;
type Tone = "ink" | "ink2" | "ink3" | "action";

export function Words({
  variant = "body",
  tone = "ink",
  children,
}: {
  variant?: Role;
  tone?: Tone;
  children: ReactNode;
}) {
  const palette = usePalette();
  const style: TextStyle = type[variant];
  const colour =
    tone === "ink2"
      ? palette.ink2
      : tone === "ink3"
        ? palette.ink3
        : tone === "action"
          ? palette.action
          : palette.ink;
  return <Text style={[style, { color: colour }]}>{children}</Text>;
}

/** Surface, 16 radius, one hairline: the card the whole app is built from. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: palette.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: palette.rule,
          padding: space.margin,
          gap: space.m,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** At most one primary per screen; 56 pt tall in the app. */
export function PrimaryButton({ label, onPress }: { label: string; onPress?: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: palette.action,
        opacity: pressed ? 0.9 : 1,
        borderRadius: radius.button,
        height: 56,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text style={[type.button, { color: "#FFFFFF" }]}>{label}</Text>
    </Pressable>
  );
}

/** "Mom saw it · 8:12" in light-soft with ink text, never a count. */
export function ReceiptChip({ label }: { label: string }) {
  const palette = usePalette();
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: palette.lightSoft,
        borderRadius: radius.chip,
        paddingVertical: space.xs + 2,
        paddingHorizontal: space.m,
      }}
    >
      <Text style={[type.caption, { color: palette.ink }]}>{label}</Text>
    </View>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return <Text style={[type.label, { color: palette.ink3 }]}>{children}</Text>;
}

export function Hairline() {
  const palette = usePalette();
  return <View style={{ height: 1, backgroundColor: palette.rule }} />;
}
