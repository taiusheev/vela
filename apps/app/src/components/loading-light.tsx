import { useEffect, useId, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useReducedMotion } from "../accessibility/use-reduced-motion.ts";
import { usePalette } from "../theme/theme.tsx";
import { space, type } from "../theme/tokens.ts";
import { Light } from "./light.tsx";
import { Text } from "./scaled-text.tsx";

/** One breath of the lamp: switching on, staying warm, settling low, then on again. */
const ON_MS = 1840;
const HOLD_MS = 1060;
const SETTLE_MS = 1700;
const LOW_LIGHT = 0.28;

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
  const gradientId = `loading-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const glow = useRef(new Animated.Value(reduced ? 1 : LOW_LIGHT)).current;
  useEffect(() => {
    if (reduced) {
      glow.setValue(1);
      return;
    }
    glow.setValue(LOW_LIGHT);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: ON_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.delay(HOLD_MS),
        Animated.timing(glow, {
          toValue: LOW_LIGHT,
          duration: SETTLE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
      // The next breath starts exactly where the last one ends, without resetting to black.
      { resetBeforeIteration: false },
    );
    loop.start();
    return () => loop.stop();
  }, [glow, reduced]);

  const height = size === "large" ? 78 : 26;
  const halo = height * (size === "large" ? 2.3 : 1.9);
  const window = (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: halo, height: halo, alignItems: "center", justifyContent: "center" }}
    >
      {/* A continuous falloff keeps the glow soft, even on a dark room. Only opacity and scale
          animate, so the phone can play the breath without keeping JavaScript busy. */}
      <Animated.View
        style={{
          position: "absolute",
          width: halo,
          height: halo,
          opacity: glow.interpolate({ inputRange: [LOW_LIGHT, 1], outputRange: [0.35, 1] }),
          transform: [
            { scale: glow.interpolate({ inputRange: [LOW_LIGHT, 1], outputRange: [0.8, 1.12] }) },
          ],
        }}
      >
        <Svg width={halo} height={halo} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={palette.light} stopOpacity={0.24} />
              <Stop offset="40%" stopColor={palette.light} stopOpacity={0.12} />
              <Stop offset="100%" stopColor={palette.light} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={50} cy={50} r={50} fill={`url(#${gradientId})`} />
        </Svg>
      </Animated.View>
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
          ? { alignItems: "center", gap: space.m, paddingVertical: space.xl }
          : { flexDirection: "row", alignItems: "center", gap: space.s }
      }
    >
      {window}
      {words}
    </View>
  );
}
