import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../theme/theme.tsx";
import { space } from "../../theme/tokens.ts";
import { BrandIcon, type BrandIconName } from "../brand/icon.tsx";
import { Words } from "../ui.tsx";

/** A focused task canvas: the writing stays first, with room for the keyboard and larger type. */
export function QuestionPage({
  title,
  onBack,
  resetKey,
  children,
}: {
  title: string;
  onBack(): void;
  resetKey?: string;
  children: ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const [backFocused, setBackFocused] = useState(false);
  useEffect(() => {
    if (resetKey !== undefined) scroll.current?.scrollTo({ y: 0, animated: false });
  }, [resetKey]);
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + space.m,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.margin,
        }}
      >
        <View style={{ width: "100%", maxWidth: 560, alignSelf: "center", gap: space.xl }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={onBack}
            onFocus={() => setBackFocused(true)}
            onBlur={() => setBackFocused(false)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.m,
              minHeight: 56,
              paddingBottom: space.m,
              borderBottomWidth: 1,
              borderBottomColor: backFocused ? p.action : p.rule,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <BrandIcon name="back" color={p.ink} size={22} />
            <Words variant="bodyMedium">{title}</Words>
          </Pressable>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

/** Progress names tasks, so moving from writing to approval to scheduling is predictable. */
export function QuestionProgress({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useLingui();
  const p = usePalette();
  const labels = [t`Your idea`, t`Your words`, t`A morning`];
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t`Step ${step} of 3`}
      accessibilityValue={{ min: 1, max: 3, now: step }}
      style={{ flexDirection: "row", gap: space.m }}
    >
      {labels.map((label, index) => (
        <View key={label} style={{ flex: 1, gap: space.s }}>
          <View
            style={{
              height: 3,
              borderRadius: 2,
              backgroundColor: index < step ? p.action : p.rule,
            }}
          />
          <Words variant="caption" tone={index + 1 === step ? "ink" : "ink2"}>
            {label}
          </Words>
        </View>
      ))}
    </View>
  );
}

/** A plain disclosure row avoids a second competing call to action or a wall of setup fields. */
export function QuestionDisclosure({
  title,
  detail,
  expanded,
  onPress,
  disabled = false,
  icon = "settings",
}: {
  title: string;
  detail?: string;
  expanded?: boolean;
  onPress(): void;
  disabled?: boolean;
  icon?: BrandIconName;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ expanded, disabled }}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        paddingVertical: space.l,
        minHeight: 56,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: focused ? p.action : p.rule,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <BrandIcon name={icon} color={p.ink2} size={21} />
      <View style={{ flex: 1, gap: space.xs }}>
        <Words variant="bodyMedium">{title}</Words>
        {detail ? (
          <Words variant="caption" tone="ink2">
            {detail}
          </Words>
        ) : null}
      </View>
      <View style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}>
        <BrandIcon name="chevron" color={p.ink2} size={18} />
      </View>
    </Pressable>
  );
}

/** A single writing surface; other controls stay outside it. */
export function QuestionPaper({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View
      style={{
        backgroundColor: p.surface,
        borderWidth: 1,
        borderColor: p.rule,
        borderRadius: 16,
        padding: space.xl,
        gap: space.l,
      }}
    >
      {children}
    </View>
  );
}
