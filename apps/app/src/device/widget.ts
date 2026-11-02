import { t } from "@lingui/core/macro";
import { Platform } from "react-native";
import type { TodayLight } from "../data/today.ts";

/** The App Group the app and its widget share (app.json, targets/widget). */
export const WIDGET_APP_GROUP = "group.family.vela.light";
/** The one key the widget reads: `WidgetSnapshot` as JSON. */
export const WIDGET_KEY = "lights";

/**
 * What the home and lock screen widget shows for each parent: her name, whether her window is lit
 * today, and the line under it, already in the reader's language. Never her words: a lock screen
 * can be seen by anyone near the phone. `date` is her local day the line belongs to, so the widget
 * falls back to `waiting` once her next day has begun and the app has not been opened since.
 */
export interface WidgetLight {
  name: string;
  lit: boolean;
  line: string;
  date: string;
  tz: string;
}

export interface WidgetSnapshot {
  lights: WidgetLight[];
  /** The line for a day the app has not seen yet: "No word yet today". */
  waiting: string;
  /** When the app wrote this, for "as of" and for tests. */
  at: string;
}

/** Today's lights as the widget shows them: parents who said yes, at most two (the medium size). */
export function widgetSnapshot(lights: readonly TodayLight[], now: Date): WidgetSnapshot {
  return {
    lights: lights
      .filter((light) => light.invited !== true && light.localDate !== undefined)
      .slice(0, 2)
      .map((light) => ({
        name: light.displayName,
        lit: light.state === "lit" && light.notOkayAt === undefined,
        // Her "Not okay" never shows on a lock screen: it says only to open Vela, as its push does.
        line: light.notOkayAt === undefined ? light.stateText : t`Open Vela`,
        date: light.localDate ?? "",
        tz: light.timeZone ?? "UTC",
      })),
    waiting: t`No word yet today`,
    at: now.toISOString(),
  };
}

interface Storage {
  set(key: string, value: string | undefined): void;
}
interface StorageModule {
  ExtensionStorage: { new (group: string): Storage; reloadWidget(name?: string): void };
}

let storage: { module: StorageModule; group: Storage } | null | undefined;

/** The native shared storage, on an iPhone build that has it; null in Expo Go, on web and in tests. */
function sharedStorage(): { module: StorageModule; group: Storage } | null {
  if (storage !== undefined) return storage;
  storage = null;
  if (Platform.OS !== "ios") return storage;
  try {
    const module = require("@bacons/apple-targets") as StorageModule;
    storage = { module, group: new module.ExtensionStorage(WIDGET_APP_GROUP) };
  } catch {
    storage = null;
  }
  return storage;
}

/** Hands the widget the newest lights and asks it to redraw; a missing widget is not an error. */
export function writeWidget(snapshot: WidgetSnapshot | null): void {
  const shared = sharedStorage();
  if (shared === null) return;
  try {
    shared.group.set(WIDGET_KEY, snapshot === null ? undefined : JSON.stringify(snapshot));
    shared.module.ExtensionStorage.reloadWidget();
  } catch {
    // The widget keeps its last picture; the app itself is unaffected.
  }
}
