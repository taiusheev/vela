import type { TodayLight } from "./today.ts";
/** The server's parent-local-day answer evidence; reading a conversation never changes it. */
export function portraitLightOn(light: TodayLight): boolean {
  return light.state === "lit" || light.answerReceived === true;
}
export function portraitInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}
