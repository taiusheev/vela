import type { Lang } from "@vela/contracts";

/**
 * The languages the app's own words come in (build plan 3.1). An organiser whose account reads
 * another language sees English until that language has its catalog; her mornings are a separate
 * choice, made for her in onboarding.
 */
export const APP_LOCALES = ["en", "zh-TW"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

/** The account's language as the app can show it. */
export function fromLang(lang: Lang): AppLocale {
  return lang === "zh-TW" ? "zh-TW" : "en";
}

/** The part of a device locale the choice reads (`expo-localization`'s `Locale`). */
export interface DeviceLocale {
  languageCode: string | null;
  languageScriptCode?: string | null;
  regionCode: string | null;
  languageRegionCode?: string | null;
}

const TRADITIONAL_REGIONS: ReadonlySet<string> = new Set(["TW", "HK", "MO"]);

/**
 * Before there is an account, the device's first language decides, and only that one: a phone set
 * to English with Chinese second is read in English. Chinese is shown in Traditional characters
 * only when the device says so, by its script or, with none given, by a region that writes them
 * (Taiwan, Hong Kong, Macau). Simplified Chinese, and Chinese that says neither, get English rather
 * than a script their reader may not use.
 */
export function fromDevice(locales: readonly DeviceLocale[]): AppLocale {
  const first = locales[0];
  if (first === undefined || first.languageCode !== "zh") return "en";
  const script = first.languageScriptCode ?? null;
  if (script !== null) return script === "Hant" ? "zh-TW" : "en";
  const region = first.languageRegionCode ?? first.regionCode;
  return region !== null && TRADITIONAL_REGIONS.has(region) ? "zh-TW" : "en";
}

/**
 * The language a reader starts in before any account has given one: English while the server allows
 * nothing else; else the one they chose on this phone; else the phone's own, so a Taiwanese organiser
 * with a Chinese iPhone meets Vela in Chinese from the first screen, before signing in.
 */
export function startingLocale(input: {
  englishOnly: boolean;
  remembered: string | null | undefined;
  device: readonly DeviceLocale[];
}): AppLocale {
  if (input.englishOnly) return "en";
  if (isAppLocale(input.remembered)) return input.remembered;
  return fromDevice(input.device);
}
