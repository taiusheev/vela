import { type ReactNode, useState } from "react";
import { Pressable, type StyleProp, Text, TextInput, View, type ViewStyle } from "react-native";
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

/** A tappable chip: the ask types, the reactions, the "when" choices. Chips are 999 radius. */
export function Chip({
  label,
  selected = false,
  disabled = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={{
        borderRadius: radius.chip,
        borderWidth: 1,
        borderColor: selected ? palette.action : palette.rule,
        backgroundColor: selected ? palette.actionSoft : palette.surface,
        paddingVertical: space.m,
        paddingHorizontal: space.l,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={[type.bodyMedium, { color: selected ? palette.action : palette.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Inputs are 56 pt with a rule border, a 2 pt action focus ring, and helper text always visible. */
export function TextField({
  value,
  onChangeText,
  placeholder,
  helper,
  multiline = false,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  helper: string;
  multiline?: boolean;
}) {
  const palette = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.s }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.ink3}
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          type.body,
          {
            color: palette.ink,
            backgroundColor: palette.surface,
            borderRadius: radius.button,
            borderWidth: focused ? 2 : 1,
            borderColor: focused ? palette.action : palette.rule,
            paddingHorizontal: space.l,
            paddingVertical: space.m,
            minHeight: multiline ? 112 : 56,
            textAlignVertical: multiline ? "top" : "center",
          },
        ]}
      />
      <Words variant="caption" tone="ink3">
        {helper}
      </Words>
    </View>
  );
}

export function SecondaryButton({ label, onPress }: { label: string; onPress?: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: palette.surface,
        borderColor: palette.rule,
        borderWidth: 1,
        opacity: pressed ? 0.9 : 1,
        borderRadius: radius.button,
        height: 56,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text style={[type.button, { color: palette.ink }]}>{label}</Text>
    </Pressable>
  );
}
