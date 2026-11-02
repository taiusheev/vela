import { View } from "react-native";
import { usePalette } from "../theme/theme.tsx";
import { radius, space } from "../theme/tokens.ts";
import { LoadingLight } from "./loading-light.tsx";

/** Stable keys for a card's text lines; a card never shows more than these. */
const LINE_KEYS = ["first", "second", "third"] as const;

/**
 * Her window lighting up with what is opening, then pale shapes where the cards are about to
 * appear: the page keeps its layout, so nothing jumps when the words arrive. The shapes stay still
 * so the window is the one moving focal point. VoiceOver hears the one label, said once.
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
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ gap: space.m }}
    >
      {/* The window lighting up says what is opening; the shapes keep the page's layout. */}
      <LoadingLight label={label} accessible={false} />
      {shape === "cards" ? card(0, 3) : [card(0, 2), card(1, 2), card(2, 2)]}
    </View>
  );
}
