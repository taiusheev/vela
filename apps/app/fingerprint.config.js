/**
 * The runtime version is the fingerprint of the native app (`runtimeVersion.policy` "fingerprint").
 * EAS computes it twice, on the machine that starts the build and on its builder after prebuild, and
 * fails the build when the two differ (14 October 2026, build 81c179ea). Only what decides the
 * native binary may count, so this leaves out what differs between the two by construction:
 *
 * - `extra`, which carries `releaseCommit` (set from `EAS_BUILD_GIT_COMMIT_HASH` on the builder
 *   only) and `trial`: JavaScript reads them, and no native code depends on them.
 * - The Opus sources `modules/vela-opus/scripts/prepare-codecs.mjs` downloads at prebuild: they
 *   are pinned by `codec-pins.json`, which still counts.
 * - `convert-source-map`, which the builder loads while it reads `app.config.ts` and a warm local
 *   cache does not: a JavaScript helper of the config loader, not part of the app.
 *
 * The default skip (package.json `ios`/`android` scripts without "run") is kept.
 */
module.exports = {
  sourceSkips: ["ExpoConfigExtraSection", "PackageJsonAndroidAndIosScriptsIfNotContainRun"],
  ignorePaths: [
    "modules/vela-opus/vendor/**/*",
    "modules/vela-opus/generated/**/*",
    "modules/vela-opus/.archives/**/*",
    "modules/vela-opus/.host-build/**/*",
    "../../node_modules/convert-source-map/**/*",
  ],
};
