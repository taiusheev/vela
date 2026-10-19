import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, Image, Platform, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import HOUSE from "../../../assets/onboarding/night-home.jpg";
import { useReducedMotion } from "../../accessibility/use-reduced-motion.ts";

/**
 * The colours of the night scenes. They stay the same in light and dark mode: these screens are a
 * house at dusk, like a film's opening, not part of the app's own surfaces.
 */
export const night = {
  ground: "#120F0D",
  cream: "#FBF4E7",
  creamSoft: "rgba(251,244,231,0.82)",
  creamFaint: "rgba(251,244,231,0.12)",
  amber: "#E9A23B",
  onAmber: "#1E1A16",
} as const;

/** Where the lit window sits in the picture, as a share of its width and height. */
const WINDOW_X = 0.72;
const WINDOW_Y = 0.44;
const PICTURE_RATIO = 780 / 1170;

const native = Platform.OS !== "web";

/** Eases a value to its target whenever the target changes: the room dimming, the window glowing. */
function useEased(target: number, duration: number, still: boolean): Animated.Value {
  const value = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    Animated.timing(value, {
      toValue: target,
      duration: still ? 0 : duration,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: native,
    }).start();
  }, [target, duration, still, value]);
  return value;
}

/**
 * The house at dusk with its window, behind the story and the screens after the questions. `dim`
 * darkens the room (1 is night, 0 the full picture); `glow` lights the window from inside;
 * `breathing` lets the glow rise and fall, as a window does that waits for someone.
 */
export function NightScene({
  dim,
  glow,
  breathing = false,
  children,
}: {
  dim: number;
  glow: number;
  breathing?: boolean;
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const pictureWidth = Math.max(width * 1.8, (height * 1.25 + 40) * PICTURE_RATIO);
  const pictureHeight = pictureWidth / PICTURE_RATIO;
  const windowX = width * 0.66;
  const windowY = Math.min(height * 0.32, 300);
  const left = Math.min(0, Math.max(width - pictureWidth, windowX - WINDOW_X * pictureWidth));
  const top = Math.min(0, Math.max(height - pictureHeight, windowY - WINDOW_Y * pictureHeight));
  const glowX = left + WINDOW_X * pictureWidth;
  const glowY = top + WINDOW_Y * pictureHeight;

  const still = useReducedMotion();
  const darkness = useEased(dim, 1400, still);
  const light = useEased(glow, 1600, still);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!breathing || still) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathing, still, pulse]);

  return (
    <View style={{ flex: 1, backgroundColor: night.ground, overflow: "hidden" }}>
      <View
        // Clipped here, not only by the scene: a browser scrolls a clipping ancestor to show
        // whatever has focus, and the picture is wider and taller than the screen.
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <Image
          source={HOUSE}
          resizeMode="cover"
          style={{ position: "absolute", left, top, width: pictureWidth, height: pictureHeight }}
        />
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: night.ground,
            opacity: darkness.interpolate({ inputRange: [0, 1], outputRange: [0, 0.78] }),
          }}
        />
        <Animated.View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width,
            height,
            opacity:
              breathing && !still
                ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] })
                : light,
          }}
        >
          <Svg width={width} height={height}>
            <Defs>
              <RadialGradient
                id="window-glow"
                cx={glowX}
                cy={glowY}
                r={width * 0.55}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0" stopColor="#FFBE5A" stopOpacity={0.6} />
                <Stop offset="0.4" stopColor="#E9A23B" stopOpacity={0.22} />
                <Stop offset="1" stopColor="#E9A23B" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={height} fill="url(#window-glow)" />
          </Svg>
        </Animated.View>
        <Svg
          width={width}
          height={height * 0.72}
          style={{ position: "absolute", left: 0, bottom: 0 }}
        >
          <Defs>
            <LinearGradient id="night-scrim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={night.ground} stopOpacity={0} />
              <Stop offset="0.42" stopColor={night.ground} stopOpacity={0.84} />
              <Stop offset="1" stopColor={night.ground} stopOpacity={0.97} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height * 0.72} fill="url(#night-scrim)" />
        </Svg>
      </View>
      {children}
    </View>
  );
}

/** Brings content up into place once, as the scene changes; still where motion is reduced. */
export function useRise(delay = 0): {
  opacity: Animated.Value;
  transform: { translateY: Animated.AnimatedInterpolation<number> }[];
} {
  const still = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: still ? 0 : 560,
      delay: still ? 0 : delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    }).start();
  }, [delay, still, progress]);
  return {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  };
}
