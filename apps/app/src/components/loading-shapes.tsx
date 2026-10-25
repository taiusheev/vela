import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { useReducedMotion } from "../accessibility/use-reduced-motion.ts";
import { usePalette } from "../theme/theme.tsx";
import { radius, space } from "../theme/tokens.ts";

/** Stable keys for a card's text lines; a card never shows more than these. */
const LINE_KEYS = ["first", "second", "third"] as const;

/**
 * Pale shapes where the cards are about to appear, breathing slowly, instead of a "Loading…"
 * sentence: the page keeps its layout, so nothing jumps when the words arrive. With reduced motion
 * they stay still. VoiceOver hears the one label, said once.
 */
export function LoadingShapes({
  label,
  shape = "cards",
}: {
  /** What is being opened, read by VoiceOver ("Loading your family’s morning"). */
  label: string;
  /** "cards" for Today's answer card, "list" for a run of memory cards. */
  shape?: "cards" | "list";
}) {
  const palette = usePalette();
  const reduced = useReducedMotion();
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduced]);
  const opacity = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });
  const bar = (width: `${number}%`, height: number) => (
    <View style={{ width, height, borderRadius: height / 2, backgroundColor: palette.surface2 }} />
  );
  const card = (key: number, lines: number) => (
    <View
      key={key}
      style={{
        gap: space.m,
        padding: space.l,
        borderRadius: radius.panel,
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.rule,
      }}
    >
      {bar("40%", 12)}
      {LINE_KEYS.slice(0, lines).map((key, index) => (
        <View key={key}>{bar(index === lines - 1 ? "60%" : "100%", 18)}</View>
      ))}
    </View>
  );
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ gap: space.m, opacity: reduced ? 1 : opacity }}
    >
      {shape === "cards" ? card(0, 3) : [card(0, 2), card(1, 2), card(2, 2)]}
    </Animated.View>
  );
}
