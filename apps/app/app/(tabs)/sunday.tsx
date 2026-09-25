import { Trans } from "@lingui/react/macro";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Words } from "../../src/components/ui.tsx";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

export default function SundayScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.bg,
        paddingTop: insets.top + space.xl,
        paddingHorizontal: space.margin,
        gap: space.m,
      }}
    >
      {/* The tab's own name: Chinese calls the tab 週日, and a weekday 星期日. */}
      <Words variant="title">
        <Trans context="tab">Sunday</Trans>
      </Words>
      <Words variant="body" tone="ink2">
        <Trans>Not built yet.</Trans>
      </Words>
    </View>
  );
}
