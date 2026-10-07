import { Trans } from "@lingui/react/macro";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { space } from "../theme/tokens.ts";
import { Words } from "./ui.tsx";

/** A cold notification/deep link has no previous screen, so Back still takes the family home. */
export function BackButton(): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      style={{ minHeight: 44, justifyContent: "center", paddingRight: space.m }}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    >
      <Words variant="button" tone="action">
        <Trans>Back</Trans>
      </Words>
    </Pressable>
  );
}
