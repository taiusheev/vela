import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Small facts this device remembers for its reader, such as "the Vela Light screen was shown for
 * Mom": the secure store on a phone, the browser's storage on the web. A flag that cannot be read
 * is treated as unset and one that cannot be written is dropped, so a device that keeps nothing
 * only shows a screen again; it never stops one from working.
 */
function keyOf(name: string): string {
  // The secure store accepts letters, digits, ".", "-" and "_" only.
  return `vela.${name}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function readFlag(name: string): Promise<boolean> {
  const key = keyOf(name);
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) === "1";
    return (await SecureStore.getItemAsync(key)) === "1";
  } catch {
    return false;
  }
}

export async function writeFlag(name: string): Promise<void> {
  const key = keyOf(name);
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key, "1");
    else await SecureStore.setItemAsync(key, "1");
  } catch {
    // Nothing to do: the screen is shown again next time, which is the harmless way to fail.
  }
}
