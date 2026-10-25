import { Trans } from "@lingui/react/macro";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { space, type as typography } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";

export function backToFamily(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** A cold notification/deep link has no previous screen, so Back still takes the family home. */
export function BackButton(): ReactNode {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingRight: space.m,
      }}
      onPress={backToFamily}
    >
      {/* The phone's own back mark: a chevron pointing left, then the word. */}
      <View style={{ transform: [{ rotate: "180deg" }] }}>
        <BrandIcon name="chevron" color={palette.action} size={22} strokeWidth={2.2} />
      </View>
      {/* The native navigation bar is fixed-height; keep its label inside the 44 pt target. */}
      <Text maxFontSizeMultiplier={1.5} style={[typography.body, { color: palette.action }]}>
        <Trans>Back</Trans>
      </Text>
    </Pressable>
  );
}

/**
 * A short task (ask, away, morning time, your name) slides up as a sheet and closes with Cancel at
 * its top left, as the phone's own sheets do; swiping it down does the same. Nothing is saved.
 */
export function CancelButton(): ReactNode {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      // The web's header gives its left slot no margin; a phone's own header does.
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingLeft: Platform.OS === "web" ? space.l : 0,
        paddingRight: space.m,
      }}
      onPress={backToFamily}
    >
      <Text maxFontSizeMultiplier={1.5} style={[typography.body, { color: palette.action }]}>
        <Trans>Cancel</Trans>
      </Text>
    </Pressable>
  );
}

/** The options a sheet-shaped task screen passes to its `Stack.Screen`. */
export const SHEET = { presentation: "modal", headerShown: true } as const;
