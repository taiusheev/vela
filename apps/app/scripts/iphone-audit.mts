import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// No dotenv, sign-in, network API, or production update channel in the experience audit.
const env = {
  ...process.env,
  EXPO_NO_DOTENV: "1",
  EAS_BUILD_PROFILE: "audit-simulator",
  EXPO_PUBLIC_DEMO_MODE: "true",
  EXPO_PUBLIC_API_URL: "",
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  EXPO_PUBLIC_TRIAL_ENGLISH: "false",
  EXPO_PUBLIC_TRIAL_TARGET: "",
};
if (process.platform !== "darwin") {
  process.stderr.write("iPhone audit needs macOS with Xcode and an iOS simulator runtime.\n");
  process.exit(1);
}
const tools = spawnSync("xcrun", ["--find", "simctl"], { encoding: "utf8" });
if (tools.status !== 0) {
  process.stderr.write(
    "iPhone simulator unavailable. Install Xcode, open it once, and install an iOS simulator runtime in Xcode Settings > Components. Then run pnpm audit:doctor again.\n",
  );
  process.exit(1);
}
const runtimes = spawnSync("xcrun", ["simctl", "list", "runtimes", "--json"], { encoding: "utf8" });
let available = false;
try {
  const result = JSON.parse(runtimes.stdout) as {
    runtimes?: { identifier?: string; isAvailable?: boolean }[];
  };
  available =
    result.runtimes?.some(
      (runtime) => runtime.isAvailable === true && runtime.identifier?.includes("SimRuntime.iOS"),
    ) ?? false;
} catch {
  /* Report fixed text, never arbitrary command output. */
}
if (runtimes.status !== 0 || !available) {
  process.stderr.write(
    "No available iOS simulator runtime. Open Xcode Settings > Components and install one, then run pnpm audit:doctor again.\n",
  );
  process.exit(1);
}
process.stdout.write(
  "iPhone simulator tools and iOS runtime available. Native journeys are not yet verified.\n",
);
if (process.argv.includes("--check")) process.exit(0);
const require = createRequire(import.meta.url);
const launched = spawnSync(
  process.execPath,
  [require.resolve("expo/bin/cli"), "start", "--ios", "--go", "--clear"],
  { cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: "inherit" },
);
process.exit(launched.status ?? 1);
