import type { ReactNode } from "react";
import { type RefreshControlProps, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../theme/theme.tsx";
import { roomShadow, space } from "../theme/tokens.ts";
import { MorningLight, RoomGlow, useRoom } from "./today-hero.tsx";

/**
 * A tab's page as Today draws it: warm paper with the morning's light behind the heading, so every
 * tab reads as the same lit house (founder, 22 Oct 2026: "carry the same style").
 */
export function WarmPage({
  children,
  refreshControl,
  gap = space.xl,
}: {
  children: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  gap?: number;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <MorningLight />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        {...(refreshControl === undefined ? {} : { refreshControl })}
        style={{ backgroundColor: "transparent" }}
        contentContainerStyle={{
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap,
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * The lit room: the logo's warm ink with amber light falling from a window. Kept for the one thing
 * on a page that matters most, as Today keeps it for her morning.
 */
export function RoomCard({
  id,
  children,
  strong = true,
}: {
  id: string;
  children: ReactNode;
  strong?: boolean;
}) {
  const room = useRoom();
  return (
    <View style={[{ borderRadius: 28, backgroundColor: room.bg }, roomShadow]}>
      <View
        style={{
          borderRadius: 28,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: room.edge,
          padding: space.xl,
          gap: space.m,
        }}
      >
        <RoomGlow id={id} strong={strong} />
        {children}
      </View>
    </View>
  );
}
