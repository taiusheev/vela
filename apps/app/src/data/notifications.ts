import { t } from "@lingui/core/macro";
import type { PushView } from "../push/provider.tsx";

/**
 * What You says about notifications (ADR-34, A1–A3), each a whole sentence in the app's language,
 * and each true: what this phone does with them, what "One moment a day" holds back, and for an
 * organiser nobody can tell, that nobody can.
 */

/** What this phone does with notifications. */
export function phoneLine(push: Pick<PushView, "availability" | "phone" | "trouble">): string {
  const { availability, phone } = push;
  if (!availability.available) {
    return availability.reason === "web"
      ? t`Notifications come to the Vela app on a phone, not to a browser.`
      : t`Notifications are not available in this build of the app.`;
  }
  if (phone === null) return t`Reading what this phone allows…`;
  if (push.trouble) {
    return t`This phone could not be set up for notifications just now. It tries again the next time you open the app.`;
  }
  if (phone.permission !== "granted") {
    return phone.canAskAgain
      ? t`Notifications are off.`
      : t`Notifications are off in this phone's settings.`;
  }
  return phone.quietChannelBlocked
    ? t`Notifications are on, but quiet mornings are switched off for Vela in this phone's settings.`
    : t`Notifications are on.`;
}

/**
 * Whether You may promise the reader that a quiet morning reaches them (A3, principle 7): an
 * organiser who is not paused, and, where the API said how they would be told (`toldIfQuiet`), one
 * whom a Telegram link or a phone of theirs can reach. An organiser nobody can tell is told
 * nothing, and You says so beside it (`nobodyTellsLine`), so the two never contradict each other.
 * The example family says nothing of how, and reads as an organiser who is told.
 */
export function toldOfQuiet(me: {
  organiser: boolean;
  paused: boolean;
  toldIfQuiet?: { telegram: boolean; app: boolean };
}): boolean {
  if (!me.organiser || me.paused) return false;
  return me.toldIfQuiet === undefined || me.toldIfQuiet.telegram || me.toldIfQuiet.app;
}

/**
 * "One moment a day" as it is: what the switch holds back, and for a reader a quiet morning
 * reaches (`told`, `toldOfQuiet`), that the quiet notice comes whatever it says (A3).
 */
export function momentLine(on: boolean, told: boolean, her: string): string {
  if (on) {
    return told
      ? t`At most one of each a day: when ${her} answers what you asked, and the evening before your turn. If a morning goes quiet, you are told whatever this says.`
      : t`At most one of each a day: when ${her} answers what you asked, and the evening before your turn.`;
  }
  return told
    ? t`Off: nothing when ${her} answers or when your turn comes. If a morning goes quiet, you are still told.`
    : t`Off: nothing when ${her} answers or when your turn comes.`;
}

/**
 * For an organiser with neither a Telegram link nor a phone that can be told: plainly, that nobody
 * would tell them of a quiet morning (principle 7), and the one thing to do when this phone can be
 * the answer. Where the API sends no pushes (`pushSent` false, `ApiMe.push`), no phone counts
 * whatever it allows, so the line says that instead, never that their phone's notifications are
 * off. Never a badge.
 */
export function nobodyTellsLine(canTurnOnHere: boolean, pushSent: boolean): string {
  if (!pushSent) {
    return t`If a morning goes quiet, nobody can tell you yet: you have no Telegram link, and Vela does not send notifications to phones yet.`;
  }
  return canTurnOnHere
    ? t`If a morning goes quiet, nobody can tell you yet: you have no Telegram link and no phone with Vela's notifications on. Turn them on for this phone to be told here.`
    : t`If a morning goes quiet, nobody can tell you yet: you have no Telegram link and no phone with Vela's notifications on.`;
}
