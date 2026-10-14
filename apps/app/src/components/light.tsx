import { type StyleProp, View, type ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { usePalette } from "../theme/theme.tsx";

export type LightState = "lit" | "resting" | "quiet" | "away" | "paused";
interface LightProps {
  state: LightState;
  height?: number;
  /** An answer today and an away/paused choice can coexist. */
  answered?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Original Kept Light window: amber only for an answer; all other states are unlit.
 * The enclosing name and factual state label provide its accessible meaning.
 */
export function Light({ state, height = 44, answered = false, style }: LightProps) {
  const p = usePalette();
  const width = (height * 100) / 132;
  const lit = state === "lit" || answered;
  const frame = lit ? p.ink : p.ink3;
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
          fill={lit ? p.light : "none"}
          stroke={frame}
          strokeWidth={height >= 32 ? 11 : 16}
          strokeDasharray={state === "away" ? "12 9" : undefined}
        />
        {height >= 32 && state !== "away" && state !== "paused" ? (
          <>
            <Rect x={47} y={5.5} width={6} height={121} fill={frame} />
            <Rect x={5.5} y={49.8} width={89} height={6} fill={frame} />
          </>
        ) : null}
        {state === "quiet" ? <Circle cx={94} cy={8} r={8} fill={frame} /> : null}
        {state === "paused" ? (
          <>
            <Rect x={35} y={45} width={8} height={38} fill={frame} />
            <Rect x={57} y={45} width={8} height={38} fill={frame} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}
