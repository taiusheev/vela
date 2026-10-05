import { Platform } from "react-native";
import { loadNotifications } from "../push/notifications.ts";

/** Her morning's own Android channel: one chime a day, unlike the family's silent daily channel. */
export const MORNING_CHANNEL = "morning";

/** One notification, replaced whenever it is scheduled again, so her phone never holds two. */
const IDENTIFIER = "vela-morning";
const LOCAL_TIME = /^(\d{2}):(\d{2})$/;

/**
 * Her morning on her phone (ADR-35, phase 5): a notification at her arrival time every day, with
 * one chime (spec §14.2 P6, opt-in by the permission her family said yes to at set-up),
 * scheduled on the phone itself, so no push service is involved and nothing about her leaves it.
 * Permission is asked for when her phone is set up, while the organiser who set it up is there to
 * say yes. Where notifications cannot be used (the web, Expo Go) or are refused, nothing happens:
 * her morning is still there whenever she opens the app.
 */
export async function scheduleHerMorning(
  time: string,
  words: { body: string; channel: string },
): Promise<void> {
  const match = LOCAL_TIME.exec(time);
  const notifications = await loadNotifications();
  if (match === null || notifications === null) return;
  try {
    const current = await notifications.getPermissionsAsync();
    const granted =
      current.granted ||
      (current.canAskAgain && (await notifications.requestPermissionsAsync()).granted);
    if (!granted) return;
    if (Platform.OS === "android") {
      await notifications.setNotificationChannelAsync(MORNING_CHANNEL, {
        name: words.channel,
        importance: notifications.AndroidImportance.DEFAULT,
        sound: "default",
        showBadge: false,
      });
    }
    await notifications.cancelScheduledNotificationAsync(IDENTIFIER).catch(() => undefined);
    await notifications.scheduleNotificationAsync({
      identifier: IDENTIFIER,
      content: { body: words.body, sound: true, data: { kind: "morning" } },
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Number(match[1]),
        minute: Number(match[2]),
        channelId: MORNING_CHANNEL,
      },
    });
  } catch (error) {
    console.warn("[parent] her morning could not be scheduled", error);
  }
}
