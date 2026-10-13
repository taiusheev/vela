import { Trans } from "@lingui/react/macro";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";
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
        gap: space.s,
        paddingRight: space.m,
      }}
      onPress={backToFamily}
    >
      <BrandIcon name="back" color={palette.action} size={20} />
      {/* The native navigation bar is fixed-height; keep its label inside the 44 pt target. */}
      <Text maxFontSizeMultiplier={1.5} style={[typography.button, { color: palette.action }]}>
        <Trans>Back</Trans>
      </Text>
    </Pressable>
  );
}
