import { type ReactNode, type Ref, useState } from "react";
import { Pressable, type StyleProp, Text, TextInput, View, type ViewStyle } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, space, type TextStyle, type } from "../theme/tokens.ts";

type Role = keyof typeof type;
type Tone = "ink" | "ink2" | "ink3" | "action" | "onAction";

export function Words({
  variant = "body",
  tone = "ink",
  selectable = false,
  numberOfLines,
  accessibilityRole,
  children,
}: {
  variant?: Role;
  /** Only use for list previews; full content remains available in the detail screen. */
  numberOfLines?: number;
  tone?: Tone;
  /** For the few strings a person has to copy rather than read, such as an account id. */
  selectable?: boolean;
  accessibilityRole?: "header";
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
          : tone === "onAction"
            ? palette.onAction
            : palette.ink;
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      selectable={selectable}
      style={[style, { color: colour }]}
    >
      {children}
    </Text>
  );
}

/** A quiet ruled section. Explicit tinted notices may add their own inset and surface. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: "transparent",
          borderTopWidth: 1,
          borderColor: palette.rule,
          paddingVertical: space.xl,
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
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      hitSlop={hitSlop}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: palette.action,
        opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
        borderRadius: radius.button,
        minHeight: 54,
        paddingVertical: space.m,
        paddingHorizontal: space.l,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text style={[type.button, { color: palette.onAction, textAlign: "center", flexShrink: 1 }]}>
        {label}
      </Text>
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
        paddingVertical: space.xs,
      }}
    >
      <Text style={[type.caption, { color: palette.ink }]}>{label}</Text>
    </View>
  );
}

/** A quiet sentence-case context label, readable in both languages. */
export function Eyebrow({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return (
    <Text style={[type.label, { letterSpacing: 0 }, { color: palette.ink2 }]}>{children}</Text>
  );
}

export function Hairline() {
  const palette = usePalette();
  return <View style={{ height: 1, backgroundColor: palette.rule }} />;
}

/** A quiet guide through setup, with the current task named rather than a row of badges. */
export function SetupProgress({
  steps,
  current,
}: {
  steps: readonly string[];
  current: number;
}): ReactNode {
  const palette = usePalette();
  return (
    <View
      style={{ gap: space.m }}
      accessibilityRole="progressbar"
      accessibilityLabel={steps[current]}
      accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}
    >
      <Eyebrow>{steps[current]}</Eyebrow>
      <View style={{ flexDirection: "row", gap: space.s }}>
        {steps.map((step, index) => (
          <View
            key={step}
            style={{
              flex: 1,
              height: 2,
              borderRadius: 2,
              backgroundColor: index <= current ? palette.action : palette.rule,
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** A tappable chip: the ask types, the reactions, the "when" choices. Chips have a compact rounded rectangle. */
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
      style={({ pressed }) => ({
        borderRadius: radius.chip,
        minHeight: 48,
        maxWidth: "100%",
        flexShrink: 1,
        justifyContent: "center",
        borderWidth: 1,
        borderColor: selected ? palette.action : palette.control,
        backgroundColor: selected ? palette.actionSoft : palette.surface,
        paddingVertical: space.m,
        paddingHorizontal: space.l,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={[
          type.bodyMedium,
          { color: selected ? palette.action : palette.ink, textAlign: "center" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Inputs are 56 pt with a rule border, a 2 pt action focus ring, and helper text always visible. A
 * field in a list, such as a vote's options, may share one helper written under the list instead.
 */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  helper,
  multiline = false,
  editorial = false,
  keyboardType,
  autoComplete,
  autoCapitalize,
  autoCorrect,
  autoFocus = false,
  maxLength,
  disabled = false,
  onSubmit,
  inputRef,
  onContentSizeChange,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  helper?: string;
  multiline?: boolean;
  /** The composer gives the person’s own words the family-reading typeface. */
  editorial?: boolean;
  /** The keyboard she gets: a number pad for a phone or a code, words for an ask. */
  keyboardType?: "phone-pad" | "number-pad" | "email-address";
  /** Lets the phone offer her own number, and fill a code from the message that carries it. */
  autoComplete?: "tel" | "tel-national" | "one-time-code" | "email";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  /** For the one field a screen exists to fill, so it is ready without hunting for it. */
  autoFocus?: boolean;
  maxLength?: number;
  disabled?: boolean;
  /** Enter, or the keyboard's own go key, rather than reaching for the button. */
  onSubmit?: () => void;
  inputRef?: Ref<TextInput>;
  onContentSizeChange?: () => void;
}) {
  const palette = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.s }}>
      {label === undefined ? null : <Words variant="bodyMedium">{label}</Words>}
      <TextInput
        ref={inputRef}
        editable={!disabled}
        accessibilityLabel={label ?? placeholder ?? helper}
        accessibilityHint={helper}
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={onContentSizeChange}
        placeholder={placeholder}
        placeholderTextColor={palette.ink3}
        multiline={multiline}
        {...(keyboardType === undefined ? {} : { keyboardType })}
        {...(autoComplete === undefined ? {} : { autoComplete })}
        {...(autoCapitalize === undefined ? {} : { autoCapitalize })}
        {...(autoCorrect === undefined ? {} : { autoCorrect })}
        {...(maxLength === undefined ? {} : { maxLength })}
        {...(onSubmit === undefined ? {} : { onSubmitEditing: onSubmit, returnKeyType: "go" })}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          editorial ? type.voice : type.body,
          {
            color: palette.ink,
            backgroundColor: editorial ? "transparent" : palette.bg,
            borderRadius: editorial ? 0 : radius.button,
            borderWidth: editorial ? 0 : 2,
            borderBottomWidth: editorial ? 2 : undefined,
            borderColor: focused ? palette.action : palette.control,
            paddingHorizontal: editorial ? 0 : space.l,
            paddingVertical: editorial ? space.xl : space.m,
            minHeight: editorial ? 200 : multiline ? 112 : 56,
            textAlignVertical: multiline ? "top" : "center",
          },
        ]}
      />
      {helper === undefined ? null : (
        <Words variant="caption" tone="ink3">
          {helper}
        </Words>
      )}
    </View>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={hitSlop}
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: palette.bg,
        borderColor: palette.control,
        borderWidth: 1,
        opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
        borderRadius: radius.button,
        minHeight: 54,
        paddingVertical: space.m,
        paddingHorizontal: space.l,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text style={[type.button, { color: palette.ink, textAlign: "center", flexShrink: 1 }]}>
        {label}
      </Text>
    </Pressable>
  );
}
