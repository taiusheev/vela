import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { PrivateStore } from "./private-store.ts";

export interface PrivateDraft {
  text: string;
  attempt?: { body: string; key: string };
}
export const devicePrivateStore = new PrivateStore(
  Platform.OS === "web"
    ? null
    : {
        get: SecureStore.getItemAsync,
        set: (key, value) =>
          SecureStore.setItemAsync(key, value, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
        remove: SecureStore.deleteItemAsync,
      },
  "vela.private",
);
export function activatePrivateSession(scope: string): void {
  devicePrivateStore.activate(scope);
}
export async function readDraft(scope: string, name: string): Promise<PrivateDraft | null> {
  try {
    const raw = await devicePrivateStore.read(scope, name);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("text" in value) ||
      typeof value.text !== "string"
    )
      return null;
    return value as PrivateDraft;
  } catch {
    return null;
  }
}
export function saveDraft(scope: string, name: string, draft: PrivateDraft): Promise<void> {
  return devicePrivateStore.write(scope, name, JSON.stringify(draft));
}
export function clearDraft(scope: string, name: string): Promise<void> {
  return devicePrivateStore.remove(scope, name);
}
/** Includes encrypted drafts and optional calling numbers; web values live in session memory only. */
export function clearSessionDrafts(scope: string): Promise<void> {
  return devicePrivateStore.clear(scope).catch(() => {});
}
