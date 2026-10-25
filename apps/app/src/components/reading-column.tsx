import type { ReactNode } from "react";
import { View } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { readingColumn } from "../theme/tokens.ts";

/**
 * Wraps each page in a centred column of `readingColumn` points. The page colour fills the space
 * either side, so on an iPad the page looks like a phone page set on the table, not a stretched one.
 */
export function ReadingColumn({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      {/* A page's morning glow stays inside its column instead of ending in a hard edge beside it. */}
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: readingColumn,
          alignSelf: "center",
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}
