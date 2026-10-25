import type { ComponentProps } from "react";
import { Text as NativeText, StyleSheet } from "react-native";
import { maxTextScale } from "../theme/text-scale.ts";

/**
 * The app's one text element: the phone's own, with a ceiling on how far the reader's text size
 * may grow it. Body text may double; a title stops near 48 points, so "Memories" never breaks in
 * the middle of the word at the largest accessibility sizes. A screen may still pass its own
 * `maxFontSizeMultiplier`.
 */
export function Text(props: ComponentProps<typeof NativeText>) {
  const size = StyleSheet.flatten(props.style)?.fontSize;
  return <NativeText maxFontSizeMultiplier={maxTextScale(size)} {...props} />;
}
