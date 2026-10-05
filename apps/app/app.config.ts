import type { ConfigContext, ExpoConfig } from "expo/config";

/** Fail closed if a production trial build would contain staging authentication. */
export default function configureApp({ config }: ConfigContext): ExpoConfig {
  const trial =
    process.env.EAS_BUILD_PROFILE === "trial" || process.env.EXPO_PUBLIC_TRIAL_ENGLISH === "true";
  const trialTarget = process.env.EXPO_PUBLIC_TRIAL_TARGET ?? "production";
  if (trial) {
    if (trialTarget === "staging" && process.env.EAS_BUILD_PROFILE !== "trial") {
      if (process.env.EXPO_PUBLIC_API_URL !== "https://vela.vela-light-staging.workers.dev") {
        throw new Error("The synthetic trial build requires Vela's staging API URL");
      }
      if (!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
        throw new Error("The synthetic trial build requires the development Clerk publishable key");
      }
    } else {
      if (trialTarget !== "production") throw new Error("Invalid production trial target");
      if (process.env.EXPO_PUBLIC_API_URL !== "https://vela.vela-light.workers.dev") {
        throw new Error("The trial build requires Vela's production API URL");
      }
      if (!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_")) {
        throw new Error("The trial build requires the production Clerk publishable key");
      }
    }
  }
  return {
    ...config,
    name: config.name ?? "Vela Light",
    slug: config.slug ?? "vela-light",
    ios: { ...config.ios, supportsTablet: trial ? false : config.ios?.supportsTablet },
    extra: {
      ...config.extra,
      releaseCommit:
        process.env.EAS_BUILD_GIT_COMMIT_HASH ?? process.env.EXPO_PUBLIC_RELEASE_COMMIT ?? null,
      trial,
      ...(trial ? { trialTarget } : {}),
    },
  };
}
