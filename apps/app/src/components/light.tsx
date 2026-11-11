import { useId, useState } from "react";
import { Image, type StyleProp, View, type ViewStyle } from "react-native";
import Svg, { ClipPath, Defs, Path, Rect, Image as SvgImage } from "react-native-svg";
import { usePalette } from "../theme/theme.tsx";

export type LightState = "lit" | "resting" | "quiet" | "away" | "paused";
interface LightProps {
  state: LightState;
  photoUri?: string | null;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** On a dark room the frame is drawn in the room's cream and an unlit pane in its shadow. */
  onRoom?: { frame: string; pane: string };
}

/** Original Kept Light window: amber only for an answer; all other states are unlit.
 * The enclosing name and factual state label provide its accessible meaning.
 */
export function Light({ state, height = 44, style, onRoom, photoUri }: LightProps) {
  const p = usePalette();
  const clip = `portrait-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const photo = photoUri && photoUri !== failedUri ? photoUri : null;
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
        {photo === null ? null : (
          <>
            <Defs>
              <ClipPath id={clip}>
                <Path d="M34 0h32a34 34 0 0 1 34 34v84a14 14 0 0 1-14 14H14A14 14 0 0 1 0 118V34A34 34 0 0 1 34 0Z" />
              </ClipPath>
            </Defs>
            <SvgImage
              href={{ uri: photo }}
              x={0}
              y={0}
              width={100}
              height={132}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clip})`}
              opacity={lit ? 1 : 0.16}
            />
            <Path
              d="M34 0h32a34 34 0 0 1 34 34v84a14 14 0 0 1-14 14H14A14 14 0 0 1 0 118V34A34 34 0 0 1 34 0Z"
              fill="none"
              stroke={frame}
              strokeWidth={11}
            />
          </>
        )}
        <Rect x={47} y={5.5} width={6} height={121} fill={frame} />
        <Rect x={5.5} y={49.8} width={89} height={6} fill={frame} />
      </Svg>
      {photo === null ? null : (
        <Image
          source={{ uri: photo }}
          onError={() => setFailedUri(photo)}
          accessible={false}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        />
      )}
    </View>
  );
}
