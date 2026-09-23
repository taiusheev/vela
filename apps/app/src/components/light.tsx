import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, type StyleProp, View, type ViewStyle } from "react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { usePalette } from "../theme/theme.tsx";
import { motion } from "../theme/tokens.ts";

/** The five states a kept light can be in (design system, The light). */
export type LightState = "lit" | "resting" | "quiet" | "away" | "paused";

interface LightProps {
  state: LightState;
  /** 28, 40 or 120 pt tall in the system; the row uses 40. */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

const WINDOW_WIDTH = 100;
const WINDOW_HEIGHT = 132;
const FRAME = 16;
const TOP_RADIUS = 34;
const BOTTOM_RADIUS = 14;

function windowPath(): string {
  const half = FRAME / 2;
  const left = half;
  const right = WINDOW_WIDTH - half;
  const top = half;
  const bottom = WINDOW_HEIGHT - half;
  return [
    `M ${left} ${top + TOP_RADIUS}`,
    `A ${TOP_RADIUS} ${TOP_RADIUS} 0 0 1 ${left + TOP_RADIUS} ${top}`,
    `L ${right - TOP_RADIUS} ${top}`,
    `A ${TOP_RADIUS} ${TOP_RADIUS} 0 0 1 ${right} ${top + TOP_RADIUS}`,
    `L ${right} ${bottom - BOTTOM_RADIUS}`,
    `A ${BOTTOM_RADIUS} ${BOTTOM_RADIUS} 0 0 1 ${right - BOTTOM_RADIUS} ${bottom}`,
    `L ${left + BOTTOM_RADIUS} ${bottom}`,
    `A ${BOTTOM_RADIUS} ${BOTTOM_RADIUS} 0 0 1 ${left} ${bottom - BOTTOM_RADIUS}`,
    "Z",
  ].join(" ");
}

/**
 * A soft-arch window with a light inside. It blooms once when it lights and never pulses; with
 * Reduce Motion on it simply appears.
 */
export function Light({ state, height = 40, style }: LightProps) {
  const palette = usePalette();
  const [reduceMotion, setReduceMotion] = useState(false);
  const bloom = useRef(new Animated.Value(state === "lit" ? 0 : 1)).current;
  const width = (height * WINDOW_WIDTH) / WINDOW_HEIGHT;

  useEffect(() => {
    let current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (current) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (state !== "lit") {
      bloom.setValue(1);
      return;
    }
    if (reduceMotion) {
      bloom.setValue(1);
      return;
    }
    Animated.timing(bloom, {
      toValue: 1,
      duration: motion.lightBloom,
      useNativeDriver: true,
    }).start();
  }, [bloom, reduceMotion, state]);

  const outline = state === "lit" ? palette.ink : state === "paused" ? palette.rule : palette.ink3;

  return (
    <View style={style}>
      <Svg width={width} height={height} viewBox={`0 0 ${WINDOW_WIDTH} ${WINDOW_HEIGHT}`}>
        {state === "lit" ? (
          <Ellipse
            cx={WINDOW_WIDTH / 2}
            cy={WINDOW_HEIGHT / 2}
            rx={WINDOW_WIDTH / 2 - FRAME}
            ry={WINDOW_HEIGHT / 2 - FRAME}
            fill={palette.lightSoft}
          />
        ) : null}
        <Path
          d={windowPath()}
          stroke={outline}
          strokeWidth={FRAME}
          fill="none"
          strokeDasharray={state === "away" ? "18 14" : undefined}
        />
        {state === "quiet" ? (
          <Circle cx={WINDOW_WIDTH - 12} cy={12} r={11} fill={palette.lightDeep} />
        ) : null}
      </Svg>
      {state === "lit" ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: width * 0.28,
            top: height * 0.3,
            width: width * 0.44,
            height: height * 0.4,
            borderRadius: 999,
            backgroundColor: palette.light,
            opacity: bloom,
            transform: [{ scale: bloom }],
          }}
        />
      ) : null}
    </View>
  );
}
