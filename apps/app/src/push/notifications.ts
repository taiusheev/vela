import Constants from "expo-constants";
import { Platform } from "react-native";
import { type PushAvailability, pushAvailability } from "./availability.ts";
import { foregroundBehaviour } from "./taps.ts";

/**
 * The one door to expo-notifications (ADR-34, A1). It is loaded lazily and only where the build can
 * receive pushes (`pushAvailability`): Expo Go on Android reports an error as soon as the module is
 * imported, and the web has nothing to load. Every caller gets null where it cannot be used.
 */

export type NotificationsModule = typeof import("expo-notifications");

/**
 * The Android notification channels, by id, which is never renamed (the API picks them by kind in
 * packages/services/src/push-messages.ts): on Android 8 and later the channel, not the message,
 * decides sound and importance. `quiet` is loud and carries the quiet notice and its close; `daily`
 * is silent and carries everything else.
 */
export const QUIET_CHANNEL = "quiet";
export const DAILY_CHANNEL = "daily";

let availability: PushAvailability | undefined;

/** This build's answer, read once: the platform, Expo Go or not, and the EAS project id. */
export function currentAvailability(): PushAvailability {
  availability ??= pushAvailability({
    os: Platform.OS,
    executionEnvironment: Constants.executionEnvironment,
    projectId: Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId,
  });
  return availability;
}

let loading: Promise<NotificationsModule | null> | undefined;

/** expo-notifications where this build can use it, and null anywhere else or if it will not load. */
export function loadNotifications(): Promise<NotificationsModule | null> {
  loading ??= currentAvailability().available
    ? import("expo-notifications").catch((error: unknown) => {
        console.warn("[push] expo-notifications did not load", error);
        return null;
      })
    : Promise.resolve(null);
  return loading;
}

// At module scope, as expo-notifications asks, so a notification arriving while the app is open is
// shown from the first moment: a quiet notice and its close as a banner with their sound, anything
// else quietly in the list, never a badge.
void loadNotifications().then((notifications) => {
  notifications?.setNotificationHandler({
    handleNotification: async (notification) =>
      foregroundBehaviour(notification.request.content.data),
  });
});

/** What the phone's settings call each channel, in the app's language (built with Lingui). */
export interface ChannelWords {
  quiet: { name: string; description: string };
  daily: { name: string; description: string };
}

/**
 * Both Android channels, named in the app's language. They are made before permission is asked and
 * before a token is asked for — on Android 13 the prompt needs a channel, and a push to a channel the
 * phone does not have is not shown — and set again when the language changes, since their names are
 * what the phone's settings show. Setting a channel again changes its words only: once made, its
 * sound and importance are the reader's to change, not the app's.
 */
export async function ensureChannels(
  notifications: NotificationsModule,
  words: ChannelWords,
): Promise<void> {
  if (Platform.OS !== "android") return;
  await notifications.setNotificationChannelAsync(QUIET_CHANNEL, {
    name: words.quiet.name,
    description: words.quiet.description,
    importance: notifications.AndroidImportance.HIGH,
    sound: "default",
    showBadge: false,
  });
  await notifications.setNotificationChannelAsync(DAILY_CHANNEL, {
    name: words.daily.name,
    description: words.daily.description,
    importance: notifications.AndroidImportance.DEFAULT,
    sound: null,
    enableVibrate: false,
    showBadge: false,
  });
}

/** Whether the reader has blocked the quiet channel in the phone's settings (Android only). */
export async function quietChannelBlocked(notifications: NotificationsModule): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const channel = await notifications.getNotificationChannelAsync(QUIET_CHANNEL);
  return channel !== null && channel.importance === notifications.AndroidImportance.NONE;
}
