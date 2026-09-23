import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Words } from "../../src/components/ui.tsx";
import { usePalette } from "../../src/theme/theme.tsx";
import { space } from "../../src/theme/tokens.ts";

export default function YouScreen() {
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
      <Words variant="title">You</Words>
      <Words variant="body" tone="ink2">
        Not built yet.
      </Words>
    </View>
  );
}
