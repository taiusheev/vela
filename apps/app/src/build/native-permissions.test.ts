import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps the recording permission through all native plugins without enabling the camera", () => {
  const require = createRequire(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        EXPO_NO_DOTENV: "1",
        EAS_BUILD_PROFILE: "trial-staging",
        EXPO_PUBLIC_TRIAL_ENGLISH: "true",
        EXPO_PUBLIC_TRIAL_TARGET: "staging",
        EXPO_PUBLIC_API_URL: "https://vela.vela-light-staging.workers.dev",
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic_config_check",
      },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  // Keep arbitrary CLI output out of failures: only the selected native permission fields matter.
  if (result.status !== 0) throw new Error("Expo native configuration did not resolve");
  let config: {
    ios?: { supportsTablet?: boolean };
    android?: { blockedPermissions?: string[] };
    _internal?: {
      modResults?: { ios?: { infoPlist?: Record<string, unknown> } };
    };
  };
  try {
    config = JSON.parse(result.stdout);
  } catch {
    throw new Error("Expo native configuration was not readable");
  }
  const plist = config._internal?.modResults?.ios?.infoPlist;
  expect(plist?.NSMicrophoneUsageDescription).toBe(
    "Vela uses your microphone when you choose to record a voice message for your family.",
  );
  expect(plist?.NSPhotoLibraryUsageDescription).toBe(
    "Vela uses the photos you choose for an ask or reply to your family.",
  );
  expect(plist?.NSCameraUsageDescription).toBeUndefined();
  expect(config.android?.blockedPermissions ?? []).not.toContain("android.permission.RECORD_AUDIO");
  expect(config.ios?.supportsTablet).toBe(false);
}, 35_000);
