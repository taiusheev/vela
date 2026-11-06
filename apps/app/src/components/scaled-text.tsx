import type { ComponentProps } from "react";
import { Text as NativeText, StyleSheet, useWindowDimensions } from "react-native";
import { maxTextScale } from "../theme/text-scale.ts";

/**
 * The app's one text element: the phone's own, with a ceiling on how far the reader's text size
 * may grow it. Body text may double; a title stops near 48 points, so "Memories" never breaks in
 * the middle of the word at the largest accessibility sizes. A screen may still pass its own
 * `maxFontSizeMultiplier`.
 */
export function Text(props: ComponentProps<typeof NativeText>) {
  const { fontScale } = useWindowDimensions();
  const size = StyleSheet.flatten(props.style)?.fontSize;
  // iOS can redraw larger glyphs inside stale bounds after a live text-size change. Recreate
  // only this native text node so layout is measured again; the screen and its drafts stay put.
  return <NativeText key={fontScale} maxFontSizeMultiplier={maxTextScale(size)} {...props} />;
}
