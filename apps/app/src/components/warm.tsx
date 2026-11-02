import { type ReactNode, useRef } from "react";
import { Animated, type RefreshControlProps, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../theme/theme.tsx";
import { roomShadow, space } from "../theme/tokens.ts";
import { MorningLight, RoomGlow, RoomLightContext, useRoom, useRoomLight } from "./today-hero.tsx";

/** The page's scroll position, for the band behind the phone's clock. */
export function useStatusBand() {
  const y = useRef(new Animated.Value(0)).current;
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y } } }], {
    useNativeDriver: true,
  });
  return { y, onScroll };
}

/**
 * Paper behind the phone's clock and battery, fading in once the page scrolls, so words never
 * slide under the status bar. At rest it is clear and the morning's light shows through.
 */
export function StatusBand({ y }: { y: Animated.Value }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: insets.top,
        backgroundColor: palette.bg,
        borderBottomWidth: 1,
        borderBottomColor: palette.rule,
        opacity: y.interpolate({ inputRange: [0, 24], outputRange: [0, 1], extrapolate: "clamp" }),
      }}
    />
  );
}

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
  const band = useStatusBand();
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <MorningLight />
      <Animated.ScrollView
        keyboardShouldPersistTaps="handled"
        {...(refreshControl === undefined ? {} : { refreshControl })}
        onScroll={band.onScroll}
        scrollEventThrottle={16}
        style={{ backgroundColor: "transparent" }}
        contentContainerStyle={{
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xxxl,
          paddingHorizontal: space.margin,
          gap,
        }}
      >
        {children}
      </Animated.ScrollView>
      <StatusBand y={band.y} />
    </View>
  );
}

/**
 * The lit room: the logo's warm ink with amber light falling from a window. Kept for the one thing
 * on a page that matters most, as Today keeps it for her morning. Wrap her window in RoomWindow and
 * the light comes from it.
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
  const { roomRef, source, slot, onRoomLayout } = useRoomLight();
  return (
    <RoomLightContext.Provider value={slot}>
      <View style={[{ borderRadius: 28, backgroundColor: room.bg }, roomShadow]}>
        <View
          ref={roomRef}
          onLayout={onRoomLayout}
          style={{
            borderRadius: 28,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: room.edge,
            padding: space.xl,
            gap: space.m,
          }}
        >
          <RoomGlow id={id} strong={strong} {...(source === undefined ? {} : { source })} />
          {children}
        </View>
      </View>
    </RoomLightContext.Provider>
  );
}
