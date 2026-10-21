import { Children, isValidElement, type ReactNode } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { radius, softShadow, space, type } from "../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "./brand/icon.tsx";

/**
 * Settings as phones draw them: a short name above each group, the group's rows on one card, and a
 * sentence below it for whatever needs saying (Apple's inset grouped lists, Android's settings
 * guidelines: one row per setting, its current value visible without opening it).
 */
export function SettingsSection({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const palette = usePalette();
  // Rows a condition left out leave no rule behind them.
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ gap: space.s }}>
      {title === undefined ? null : (
        <Text
          accessibilityRole="header"
          style={[type.button, { color: palette.ink2, paddingHorizontal: space.xs }]}
        >
          {title}
        </Text>
      )}
      {rows.length === 0 ? null : (
        <View
          style={[
            {
              backgroundColor: palette.surface,
              borderColor: palette.rule,
              borderWidth: 1,
              borderRadius: radius.panel,
              overflow: "hidden",
            },
            softShadow,
          ]}
        >
          {rows.map((row, index) => (
            <View key={row.key ?? index}>
              {index === 0 ? null : (
                <View
                  style={{
                    height: 1,
                    marginLeft: space.l,
                    backgroundColor: palette.rule,
                  }}
                />
              )}
              {row}
            </View>
          ))}
        </View>
      )}
      {footer === undefined ? null : (
        <View style={{ gap: space.s, paddingHorizontal: space.xs }}>{footer}</View>
      )}
    </View>
  );
}

/**
 * One setting: an icon, its name, what it is set to now, and what tapping does at the end (a
 * chevron to open it, a switch, or a word such as "Turn on"). `careful` marks steps that are hard
 * to undo, in the error colour, and they belong at the bottom of the page.
 */
export function SettingsRow({
  icon,
  title,
  detail,
  trailing,
  onPress,
  careful = false,
  disabled = false,
  expanded,
  testID,
}: {
  icon?: BrandIconName;
  title: string;
  detail?: string;
  /** Replaces the chevron; leave it out for a row that opens something. */
  trailing?: ReactNode;
  onPress?: () => void;
  careful?: boolean;
  disabled?: boolean;
  /** For a row that shows more below itself rather than opening a screen. */
  expanded?: boolean;
  testID?: string;
}) {
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.3;
  const end =
    trailing ??
    (onPress === undefined ? null : (
      <View style={{ transform: [{ rotate: expanded === true ? "90deg" : "0deg" }] }}>
        <BrandIcon name="chevron" color={palette.ink3} size={16} strokeWidth={2} />
      </View>
    ));
  const body = (
    <>
      {icon === undefined ? null : (
        <BrandIcon
          name={icon}
          color={careful ? palette.error : palette.action}
          size={20}
          strokeWidth={2}
        />
      )}
      <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.bodyMedium, { color: careful ? palette.error : palette.ink }]}>
          {title}
        </Text>
        {detail === undefined ? null : (
          <Text style={[type.caption, { color: palette.ink2 }]}>{detail}</Text>
        )}
      </View>
      {end}
    </>
  );
  const layout = {
    minHeight: 56,
    flexDirection: stacked ? ("column" as const) : ("row" as const),
    alignItems: stacked ? ("flex-start" as const) : ("center" as const),
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
  };
  if (onPress === undefined) {
    return (
      <View style={layout} {...(testID === undefined ? {} : { testID })}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      {...(testID === undefined ? {} : { testID })}
      style={({ pressed }) => ({
        ...layout,
        backgroundColor: pressed ? palette.surface2 : "transparent",
        opacity: disabled ? 0.45 : 1,
      })}
    >
      {body}
    </Pressable>
  );
}

/** A row's end when it is a word to tap rather than a page to open ("Turn on"). */
export function RowAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => ({
        paddingVertical: space.xs,
        paddingHorizontal: space.m,
        borderRadius: radius.chip,
        backgroundColor: palette.actionSoft,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={[type.button, { color: palette.action }]}>{label}</Text>
    </Pressable>
  );
}

/** The small print under a group. */
export function SettingsNote({
  children,
  tone = "ink3",
}: {
  children: ReactNode;
  tone?: "ink2" | "ink3";
}) {
  const palette = usePalette();
  return (
    <Text style={[type.caption, { color: tone === "ink2" ? palette.ink2 : palette.ink3 }]}>
      {children}
    </Text>
  );
}
