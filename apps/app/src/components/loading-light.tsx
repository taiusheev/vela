import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { useReducedMotion } from "../accessibility/use-reduced-motion.ts";
import { usePalette } from "../theme/theme.tsx";
import { space, type } from "../theme/tokens.ts";
import { Light } from "./light.tsx";
import { Text } from "./scaled-text.tsx";

/** One breath of the lamp: switching on, staying warm, settling low, then on again. */
const ON_MS = 1100;
const HOLD_MS = 500;
const SETTLE_MS = 1000;
/** The glow's three circles, as fractions of its full width. */
const GLOW_RINGS = [1, 0.78, 0.56] as const;

/**
 * Vela's loading moment, in its own image (founder, 26 October 2026: "make animation for those"):
 * her window's light coming on. The unlit panes fill with amber, a soft glow swells behind the
 * frame, holds, settles low, and comes on again, slowly, the way a lamp is lit in a window at dusk.
 * With reduced motion the window is simply lit and still. VoiceOver hears the label once, as a
 * progress bar; the drawing itself is hidden from it.
 */
export function LoadingLight({
  label,
  size = "small",
  accessible = true,
}: {
  /** What is opening, shown under or beside the window: "Loading your family…". */
  label: string;
  /** "small" sits in a line of text; "large" stands alone in the middle of a waiting screen. */
  size?: "small" | "large";
  /** False inside a larger progress bar that already says what is loading. */
  accessible?: boolean;
}) {
  const palette = usePalette();
  const reduced = useReducedMotion();
  const glow = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      glow.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: ON_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(HOLD_MS),
        Animated.timing(glow, {
          toValue: 0.2,
          duration: SETTLE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow, reduced]);

  const height = size === "large" ? 56 : 26;
  const halo = height * (size === "large" ? 2.2 : 1.9);
  const window = (
    <View style={{ width: halo, height: halo, alignItems: "center", justifyContent: "center" }}>
      {/* The glow on the wall behind the window, swelling as the light comes on: three faint
          circles, smallest brightest, so the light fades toward its edge instead of ending in one. */}
      {GLOW_RINGS.map((ring) => (
        <Animated.View
          key={ring}
          style={{
            position: "absolute",
            width: halo * ring,
            height: halo * ring,
            borderRadius: (halo * ring) / 2,
            backgroundColor: palette.light,
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.1] }),
            transform: [
              { scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) },
            ],
          }}
        />
      ))}
      <Light state="resting" height={height} />
      <Animated.View style={{ position: "absolute", opacity: glow }}>
        <Light state="lit" height={height} />
      </Animated.View>
    </View>
  );
  const words = (
    <Text
      style={[
        size === "large" ? type.body : type.caption,
        { color: palette.ink2, textAlign: size === "large" ? "center" : "left", flexShrink: 1 },
      ]}
    >
      {label}
    </Text>
  );
  return (
    <View
      accessible={accessible}
      accessibilityRole={accessible ? "progressbar" : undefined}
      accessibilityLabel={accessible ? label : undefined}
      importantForAccessibility={accessible ? "yes" : "no-hide-descendants"}
      accessibilityElementsHidden={!accessible}
      style={
        size === "large"
          ? { alignItems: "center", gap: space.s, paddingVertical: space.xl }
          : { flexDirection: "row", alignItems: "center", gap: space.s }
      }
    >
      {window}
      {words}
    </View>
  );
}
