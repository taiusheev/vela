import Constants from "expo-constants";
import type { ApiCapabilities } from "./client.ts";

/** Fixed at build time for the English-only family trial, before any network request completes. */
export const englishTrialBuild =
  process.env.EXPO_PUBLIC_TRIAL_ENGLISH === "true" || Constants.expoConfig?.extra?.trial === true;

/** Fixed trial scope still applies when a synthetic backend has broader features configured. */
export function trialCapabilities(
  declared: ApiCapabilities | undefined,
  trial = englishTrialBuild,
): ApiCapabilities | undefined {
  if (!trial || declared === undefined) return declared;
  return { ...declared, memory: false, book: false, parent_app: false, billing: false };
}

/** A live connection starts in English until its server explicitly permits another language. */
export function requiresEnglish(
  api: boolean,
  declared: boolean | undefined,
  trial = englishTrialBuild,
): boolean {
  return trial || (api && declared !== false);
}
