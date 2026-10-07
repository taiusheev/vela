import { Trans } from "@lingui/react/macro";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { space } from "../theme/tokens.ts";
import { BrandIcon } from "./brand/icon.tsx";
import { Words } from "./ui.tsx";

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
      <Words variant="button" tone="action">
        <Trans>Back</Trans>
      </Words>
    </Pressable>
  );
}
