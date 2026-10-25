import { type ReactNode, type Ref, useState } from "react";
import { Pressable, type StyleProp, TextInput, View, type ViewStyle } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { hitSlop, radius, space, type TextStyle, type } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";
import { Text } from "./scaled-text.tsx";

type Role = keyof typeof type;
type Tone = "ink" | "ink2" | "ink3" | "action" | "error";

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
          : tone === "error"
            ? palette.error
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

/**
 * At most one primary per screen; 56 pt tall in the app. With an icon, the label sits left beside a
 * tile, as every action in the app reads (button option 5, founder's choice, 21 Oct 2026).
 */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  hint,
  icon,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Read by VoiceOver: why the button is waiting, when it is. */
  hint?: string;
  icon?: BrandIconName;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
      hitSlop={hitSlop}
      disabled={disabled}
      onPress={onPress}
      // Waiting reads as "not yet", a calm paper button, never as a faded dark one that looks broken.
      style={({ pressed }) => ({
        backgroundColor: disabled ? palette.surface2 : palette.action,
        opacity: pressed && !disabled ? 0.82 : 1,
        borderRadius: 12,
        minHeight: 46,
        paddingVertical: icon === undefined ? space.m : space.s,
        paddingHorizontal: space.l,
        flexDirection: "row",
        gap: space.m,
        alignItems: "center",
        justifyContent: icon === undefined ? "center" : "flex-start",
      })}
    >
      {icon === undefined ? null : <IconTile name={icon} tone={disabled ? "quiet" : "onAction"} />}
      <Text
        style={[
          type.button,
          {
            color: disabled ? palette.ink3 : palette.onAction,
            textAlign: icon === undefined ? "center" : "left",
            flexShrink: 1,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** An action's icon, drawn plain beside its label (no tile behind it, founder 21 Oct 2026). */
export function IconTile({
  name,
  tone = "soft",
}: {
  name: BrandIconName;
  tone?: "onAction" | "soft" | "error" | "quiet";
}) {
  const palette = usePalette();
  const ink =
    tone === "onAction"
      ? palette.onAction
      : tone === "error"
        ? palette.error
        : tone === "quiet"
          ? palette.ink2
          : palette.action;
  return <BrandIcon name={name} color={ink} size={20} strokeWidth={2} />;
}

/** Actions that sit together (Story day's choices, Pause and Leave): rows in one card. */
export function ActionGroup({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.rule,
        borderRadius: radius.card + 6,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

/** One row of an ActionGroup: icon tile, label, chevron; `first` leaves out the dividing rule. */
export function ActionRow({
  icon,
  label,
  onPress,
  first = false,
  careful = false,
  disabled = false,
  testID,
}: {
  icon: BrandIconName;
  label: string;
  onPress?: () => void;
  first?: boolean;
  /** Leaving and other steps that are hard to undo: red label and tile. */
  careful?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      {...(testID === undefined ? {} : { testID })}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        paddingHorizontal: space.l,
        paddingVertical: space.s,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.rule,
        backgroundColor: pressed ? palette.surface2 : "transparent",
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <IconTile name={icon} tone={careful ? "error" : "soft"} />
      <Text style={[type.button, { color: careful ? palette.error : palette.ink, flex: 1 }]}>
        {label}
      </Text>
      {/* A step that is hard to undo asks first rather than opening a page: no chevron. */}
      {careful ? null : <BrandIcon name="chevron" color={palette.ink3} size={16} strokeWidth={2} />}
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
  initials,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  /** A person's chip shows their initial, as a messenger shows a face; "Both" shows two. */
  initials?: readonly { key: string; initial: string }[];
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
        minHeight: 44,
        maxWidth: "100%",
        flexShrink: 1,
        justifyContent: "center",
        borderWidth: 1,
        borderColor: selected ? palette.action : palette.control,
        backgroundColor: selected ? palette.actionSoft : palette.surface,
        paddingVertical: initials === undefined ? space.m : space.xs,
        paddingLeft: initials === undefined ? space.l : space.xs + 2,
        paddingRight: space.l,
        flexDirection: "row",
        alignItems: "center",
        gap: space.s,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      {initials === undefined ? null : (
        <View style={{ flexDirection: "row" }}>
          {initials.map(({ key, initial }, index) => (
            <View
              key={key}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                marginLeft: index === 0 ? 0 : -10,
                borderWidth: 2,
                borderColor: selected ? palette.actionSoft : palette.surface,
                backgroundColor: palette.surface2,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={[type.bodyMedium, { fontFamily: type.title.fontFamily, color: palette.ink }]}
              >
                {initial}
              </Text>
            </View>
          ))}
        </View>
      )}
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
  hint,
  icon,
  waiting,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Read by VoiceOver: why the button is waiting, when it is. */
  hint?: string;
  icon?: BrandIconName;
  /**
   * Said under the label while the button waits ("Waiting for Mom to say yes"): drawn calm and
   * dashed with a clock, never as a faded button nobody can explain.
   */
  waiting?: string;
}) {
  const palette = usePalette();
  const held = disabled && waiting !== undefined;
  const tile = held ? "time" : icon;
  return (
    <Pressable
      accessibilityRole="button"
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
      hitSlop={hitSlop}
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      // The second level is a soft filled button with no outline: outlines belong to choices (chips),
      // so a button and a choice never look alike. Three levels in all: filled, soft, plain text.
      style={({ pressed }) => ({
        backgroundColor: held ? palette.surface2 : palette.actionSoft,
        borderColor: palette.control,
        borderWidth: held ? 1 : 0,
        borderStyle: "dashed",
        opacity: disabled && !held ? 0.45 : pressed ? 0.82 : 1,
        borderRadius: 12,
        minHeight: 46,
        paddingVertical: tile === undefined ? space.m : space.s,
        paddingHorizontal: space.l,
        flexDirection: "row",
        gap: space.m,
        alignItems: "center",
        justifyContent: tile === undefined ? "center" : "flex-start",
      })}
    >
      {tile === undefined ? null : <IconTile name={tile} tone={held ? "quiet" : "soft"} />}
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text
          style={[
            type.button,
            {
              color: held ? palette.ink2 : palette.ink,
              textAlign: tile === undefined ? "center" : "left",
            },
          ]}
        >
          {label}
        </Text>
        {held ? <Text style={[type.caption, { color: palette.ink2 }]}>{waiting}</Text> : null}
      </View>
    </Pressable>
  );
}
