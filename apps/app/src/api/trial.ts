import Constants from "expo-constants";

/** Fixed at build time for the English-only family trial, before any network request completes. */
export const englishTrialBuild =
  process.env.EXPO_PUBLIC_TRIAL_ENGLISH === "true" || Constants.expoConfig?.extra?.trial === true;

/** A live connection starts in English until its server explicitly permits another language. */
export function requiresEnglish(
  api: boolean,
  declared: boolean | undefined,
  trial = englishTrialBuild,
): boolean {
  return trial || (api && declared !== false);
}
