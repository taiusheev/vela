import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Source-only checks: no accounts, build requests, uploads or private environment files.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
class SourceCheckError extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SourceCheckError(message);
}
try {
  const eas = JSON.parse(readFileSync(resolve(root, "eas.json"), "utf8"));
  const profile = eas.build.trial;
  check(profile.distribution === "store", "Trial must use store distribution");
  check(profile.environment === "production", "Trial must use the production EAS environment");
  check(profile.channel === "production", "Trial must use the production update channel");
  check(profile.autoIncrement === true, "Trial must increment the build number");
  check(profile.env.EXPO_NO_DOTENV === "1", "Trial must disable local dotenv files");
  check(profile.env.EXPO_PUBLIC_DEMO_MODE === "false", "Trial must disable example family mode");
  check(eas.submit.trial.ios !== undefined, "Trial submission profile is missing");
  const childEnv: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["PATH", "TMPDIR", "LANG", "SYSTEMROOT"])
    if (process.env[key]) childEnv[key] = process.env[key];
  Object.assign(childEnv, profile.env, {
    EAS_BUILD_PROFILE: "trial",
    // A synthetic public-key fixture validates config only; it cannot establish live auth.
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_synthetic_release_config",
    CI: "1",
  });
  const result = spawnSync(
    process.execPath,
    [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"],
    { cwd: root, env: childEnv, encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
  );
  check(result.status === 0, "Expo native configuration could not be evaluated");
  const config = JSON.parse(result.stdout);
  check(config.ios.bundleIdentifier === "family.vela.light", "Unexpected iOS bundle identifier");
  check(config.ios.supportsTablet === false, "The trial must be iPhone-only");
  const plist = config._internal.modResults.ios.infoPlist;
  check(typeof plist.NSMicrophoneUsageDescription === "string", "Microphone purpose is missing");
  check(typeof plist.NSPhotoLibraryUsageDescription === "string", "Photo purpose is missing");
  check(plist.NSCameraUsageDescription === undefined, "The trial must not request camera access");
  const manifest = config.ios.privacyManifests;
  check(manifest?.NSPrivacyTracking === false, "Tracking declaration is missing");
  check(manifest.NSPrivacyTrackingDomains?.length === 0, "Tracking domains must be empty");
  check(manifest.NSPrivacyAccessedAPITypes?.length > 0, "Required API reasons are missing");
  check(
    manifest.NSPrivacyCollectedDataTypes?.length > 0,
    "Collected-data declarations are missing",
  );

  const icon = readFileSync(resolve(root, config.icon));
  check(
    icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "Icon must be PNG",
  );
  check(
    icon.readUInt32BE(16) === 1024 && icon.readUInt32BE(20) === 1024,
    "Icon must be 1024 by 1024",
  );
  check(icon[25] === 2 || icon[25] === 0, "App icon must use an opaque RGB or grayscale PNG");
  for (let offset = 8; offset + 12 <= icon.length; ) {
    const length = icon.readUInt32BE(offset);
    check(
      icon.toString("ascii", offset + 4, offset + 8) !== "tRNS",
      "App icon must not include transparency",
    );
    offset += length + 12;
  }
  console.log(
    JSON.stringify(
      {
        scope: "ios-release-source-only",
        status: "passed",
        bundleIdentifier: config.ios.bundleIdentifier,
        iPhoneOnly: true,
        icon: { width: 1024, height: 1024, opaque: true },
        requiredReasonCategories: manifest.NSPrivacyAccessedAPITypes.length,
        collectedDataTypes: manifest.NSPrivacyCollectedDataTypes.length,
        buildProfile: "trial",
        submitProfile: "trial",
        accountAuthenticationVerified: false,
        nativeArchiveVerified: false,
        screenshotsVerified: false,
        storeReady: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  // Only our fixed validation messages reach stdout; native tool output is never replayed.
  const message = error instanceof SourceCheckError ? error.message : "Source validation failed";
  console.error(`iOS source preflight failed: ${message}`);
  process.exitCode = 1;
}
