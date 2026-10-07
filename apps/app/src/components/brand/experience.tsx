import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { usePalette } from "../../theme/theme.tsx";
import { hitSlop, radius, space } from "../../theme/tokens.ts";
import { Words } from "../ui.tsx";
import { BrandIcon, type BrandIconName } from "./icon.tsx";
import { FamilyScene, type SceneKind } from "./scene.tsx";

export function ChoiceTile({
  label,
  icon,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: BrandIconName;
  selected: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 90,
        minHeight: 80,
        gap: space.s,
        padding: space.m,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.button,
        borderWidth: 1,
        borderColor: selected ? p.action : p.control,
        backgroundColor: selected ? p.actionSoft : p.surface,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      <BrandIcon name={icon} size={22} color={selected ? p.action : p.ink2} />
      <Words variant="caption" tone={selected ? "action" : "ink"}>
        {label}
      </Words>
    </Pressable>
  );
}

export function ScreenHeading({
  title,
  subtitle,
  trailing,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <View style={{ gap: space.s }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.l,
        }}
      >
        <View style={{ flex: 1 }}>
          <Words variant="display">{title}</Words>
        </View>
        {trailing}
      </View>
      {subtitle === undefined ? null : (
        <Words variant="body" tone="ink2">
          {subtitle}
        </Words>
      )}
    </View>
  );
}

export function AnswerPanel({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View
      style={{
        borderLeftWidth: 3,
        borderLeftColor: p.light,
        paddingLeft: space.l,
        paddingVertical: space.s,
        gap: space.m,
      }}
    >
      {children}
    </View>
  );
}

export function FamilyAction({
  title,
  detail,
  icon,
  onPress,
  disabled = false,
}: {
  title: string;
  detail?: string;
  icon: BrandIconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.l,
        paddingVertical: space.l,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.button,
          backgroundColor: p.actionSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BrandIcon name={icon} color={p.action} />
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Words variant="heading">{title}</Words>
        {detail === undefined ? null : (
          <Words variant="caption" tone="ink2">
            {detail}
          </Words>
        )}
      </View>
      <BrandIcon name="chevron" color={p.ink3} size={20} />
    </Pressable>
  );
}

export function EmptyMoment({
  title,
  detail,
  kind = "window",
  children,
}: {
  title: ReactNode;
  detail: ReactNode;
  kind?: SceneKind;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", gap: space.xl, paddingVertical: space.xxl }}>
      <FamilyScene kind={kind} width={184} />
      <View style={{ alignSelf: "stretch", gap: space.m }}>
        <Words variant="title">{title}</Words>
        <Words variant="body" tone="ink2">
          {detail}
        </Words>
        {children}
      </View>
    </View>
  );
}
