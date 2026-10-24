import { type StyleProp, View, type ViewStyle } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { usePalette } from "../theme/theme.tsx";

export type LightState = "lit" | "resting" | "quiet" | "away" | "paused";
interface LightProps {
  state: LightState;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** On a dark room the frame is drawn in the room's cream and an unlit pane in its shadow. */
  onRoom?: { frame: string; pane: string };
}

/** Original Kept Light window: amber only for an answer; all other states are unlit.
 * The enclosing name and factual state label provide its accessible meaning.
 */
export function Light({ state, height = 44, style, onRoom }: LightProps) {
  const p = usePalette();
  const width = (height * 100) / 132;
  const lit = state === "lit";
  const frame = onRoom?.frame ?? p.ink;
  return (
    <View
      style={style}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={height} viewBox="-5.5 -5.5 111 143">
        <Path
          d="M34 0h32a34 34 0 0 1 34 34v84a14 14 0 0 1-14 14H14A14 14 0 0 1 0 118V34A34 34 0 0 1 34 0Z"
          fill={lit ? p.light : (onRoom?.pane ?? p.surface2)}
          stroke={frame}
          strokeWidth={11}
        />
        <Rect x={47} y={5.5} width={6} height={121} fill={frame} />
        <Rect x={5.5} y={49.8} width={89} height={6} fill={frame} />
      </Svg>
    </View>
  );
}
