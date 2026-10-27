import { portraitLightOn } from "./portrait-lamp.ts";
import type { TodayLight } from "./today.ts";

/**
 * The moment her light comes on plays once for each parent on each of her days, on this device:
 * the first time the reader opens Today after she answered. Keyed on her own local day, so a reader
 * in another time zone sees it once for her morning, not twice or never.
 */
export function lightOnKey(familyId: string, light: TodayLight, today = new Date()) {
  const day = light.localDate ?? today.toISOString().slice(0, 10);
  return `light-on.${familyId}.${light.memberId}.${day}`;
}

/**
 * The lit lights the reader has not yet seen come on today. Only the server's answer evidence lights
 * a window; invited parents and paused ones are never shown, as on Today.
 */
export function lightsToWelcome(
  lights: readonly TodayLight[],
  familyId: string,
  seen: ReadonlySet<string>,
  today = new Date(),
): TodayLight[] {
  return lights.filter(
    (light) =>
      light.invited !== true &&
      light.state !== "paused" &&
      portraitLightOn(light) &&
      !seen.has(lightOnKey(familyId, light, today)),
  );
}
