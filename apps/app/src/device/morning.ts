import { DAILY_CHANNEL, loadNotifications } from "../push/notifications.ts";

/** One notification, replaced whenever it is scheduled again, so her phone never holds two. */
const IDENTIFIER = "vela-morning";
const LOCAL_TIME = /^(\d{2}):(\d{2})$/;

/**
 * Her morning on her phone (ADR-35, phase 5): a notification at her arrival time every day,
 * scheduled on the phone itself, so no push service is involved and nothing about her leaves it.
 * Permission is asked for when her phone is set up, while the organiser who set it up is there to
 * say yes. Where notifications cannot be used (the web, Expo Go) or are refused, nothing happens:
 * her morning is still there whenever she opens the app.
 */
export async function scheduleHerMorning(time: string, body: string): Promise<void> {
  const match = LOCAL_TIME.exec(time);
  const notifications = await loadNotifications();
  if (match === null || notifications === null) return;
  try {
    const current = await notifications.getPermissionsAsync();
    const granted =
      current.granted ||
      (current.canAskAgain && (await notifications.requestPermissionsAsync()).granted);
    if (!granted) return;
    await notifications.cancelScheduledNotificationAsync(IDENTIFIER).catch(() => undefined);
    await notifications.scheduleNotificationAsync({
      identifier: IDENTIFIER,
      content: { body, data: { kind: "morning" } },
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Number(match[1]),
        minute: Number(match[2]),
        channelId: DAILY_CHANNEL,
      },
    });
  } catch (error) {
    console.warn("[parent] her morning could not be scheduled", error);
  }
}
