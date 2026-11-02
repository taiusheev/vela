import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * A gentle tap once something the family sent has landed: a heart, a reply, a question, a saved
 * question (next native build, item 2). Only after the server took it, so a failed send never feels
 * like a success. Nothing on the web, and a phone that cannot tap simply stays still.
 */
export function tapLanded(): void {
  if (Platform.OS === "web") return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** A lighter tap for a small choice, such as a reaction on a message. */
export function tapLight(): void {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
