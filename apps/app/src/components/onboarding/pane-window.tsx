import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

/** The window's four panes, top left first, inside the mark's frame (brand guidelines, Logo). */
const PANES = [
  "M5.5 49.8V34A28.5 28.5 0 0 1 34 5.5H47V49.8Z",
  "M53 5.5H66A28.5 28.5 0 0 1 94.5 34V49.8H53Z",
  "M5.5 55.8H47V126.5H14A8.5 8.5 0 0 1 5.5 118Z",
  "M53 55.8H94.5V118A8.5 8.5 0 0 1 86 126.5H53Z",
] as const;
const FRAME =
  "M34 -5.5H66A39.5 39.5 0 0 1 105.5 34V118A19.5 19.5 0 0 1 86 137.5H14A19.5 19.5 0 0 1 -5.5 118V34A39.5 39.5 0 0 1 34 -5.5ZM34 5.5H66A28.5 28.5 0 0 1 94.5 34V118A8.5 8.5 0 0 1 86 126.5H14A8.5 8.5 0 0 1 5.5 118V34A28.5 28.5 0 0 1 34 5.5Z";

/**
 * The Vela window as onboarding's progress: one pane lights per part done (the story, then each
 * chapter of questions). Decorative: the words beside it say how far setup has come.
 */
export function PaneWindow({
  lit,
  width,
  frame,
  unlit,
  light = "#E9A23B",
}: {
  lit: number;
  width: number;
  frame: string;
  unlit: string;
  light?: string;
}) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={(width * 159) / 127} viewBox="-13.5 -13.5 127 159">
        {PANES.map((pane, index) => (
          <Path key={pane} d={pane} fill={index < lit ? light : unlit} />
        ))}
        <Path d={FRAME} fill={frame} fillRule="evenodd" />
        <Rect x={47} y={5.5} width={6} height={121} fill={frame} />
        <Rect x={5.5} y={49.8} width={89} height={6} fill={frame} />
      </Svg>
    </View>
  );
}
