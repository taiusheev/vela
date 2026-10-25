import { useState } from "react";
import { Image, View } from "react-native";
import { portraitInitials } from "../data/portrait-lamp.ts";
import { usePalette } from "../theme/theme.tsx";
import { type } from "../theme/tokens.ts";
import { Text } from "./scaled-text.tsx";

export function Portrait({
  uri,
  name,
  width,
  height,
  round = false,
}: {
  uri: string | null;
  name: string;
  width: number;
  height: number;
  /** A face in a circle, for small places; otherwise the arched window of a portrait. */
  round?: boolean;
}) {
  const p = usePalette();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return (
    <View
      style={{
        width,
        height,
        borderTopLeftRadius: width / 2,
        borderTopRightRadius: width / 2,
        borderBottomLeftRadius: round ? width / 2 : 12,
        borderBottomRightRadius: round ? width / 2 : 12,
        backgroundColor: p.surface2,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={[
          type.display,
          { color: p.ink2 },
          width < 60 ? { fontSize: width * 0.45, lineHeight: width * 0.6 } : null,
        ]}
      >
        {portraitInitials(name)}
      </Text>
      {uri === null || failedUri === uri ? null : (
        <Image
          source={{ uri }}
          accessibilityIgnoresInvertColors
          accessible={false}
          onError={() => setFailedUri(uri)}
          resizeMode="cover"
          style={{ position: "absolute", width: "100%", height: "100%" }}
        />
      )}
    </View>
  );
}
