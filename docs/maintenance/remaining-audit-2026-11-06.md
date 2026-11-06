# Remaining audit repairs — 6 November 2026

The active workspace audit now reports **0 known advisories**, down from the 11 remaining after the first repair. No advisory is ignored or suppressed. This is a registry inventory, not a guarantee that every security issue is eliminated. The archived prototype's earlier 0-vulnerability receipt is separate.

## Dependency changes

- Expo remains on SDK 57 / React Native 0.86.3. Expo 57.0.32 and its compatible patches replace the old CLI's vulnerable Zod and configuration dependencies. `expo install --check` passes.
- Migrate the deprecated `@clerk/clerk-expo` to `@clerk/expo` 4.15.1, whose peer range includes SDK 57. The existing custom sign-in/sign-up flow uses the supported `/legacy` entry point. The provider still passes its publishable key explicitly and uses SecureStore's token cache. The removed wallet graph accounted for the three stream-json advisories. See [Clerk's migration guide](https://clerk.com/articles/migrating-from-clerk-clerk-expo-to-clerk-expo-breaking-changes-native-components).
- Router keeps query-string 7's API. A one-line package patch reads the ESM default export of decode-uri-component 0.5.1. The override applies only to this query-string version. Unicode, arrays, fragments, plus signs, invalid encoding and a large malformed query exercise the actual consumer. See the [decoder advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f).
- Apple targets imports only prebuild's `AssetContents` module and calls `writeContentsJsonAsync`. The scoped upgrade to SDK 57's prebuild package preserves that function and removes the old SDK 55 configuration graph, including deepmerge. Native project generation and the actual asset writer are checked.
- Xcode's legacy UUID dependency moves to 11.1.1, retaining a CommonJS entry point and enforcing buffer bounds. Reviewed glob 10/13 consumers move to CommonJS-compatible 14.0.3; fingerprint's minimatch moves to 11.0.4. Asset discovery, cancellation and fingerprint ignore rules have compatibility checks.
- The deprecated Drizzle loader uses esbuild 0.25.12 through a scoped override. Its actual TypeScript transform works, and Drizzle's exported SQL is byte-for-byte identical before and after the upgrade. There is no schema migration in this change.
- Pin Reanimated 4.5.1, Worklets 0.10.1 and the React Native Metro configuration 0.86.3 to this SDK's supported versions, rather than allowing auto-installed peers to select incompatible newer versions. `pnpm peers check` reports no issues.
- Make the one-day package-age rule explicit and strict. Pnpm previously added exceptions automatically during updates; future fresh versions now require review. The version-specific exceptions in the workspace file cover the reviewed Expo security patches and Clerk migration, with lockfile integrity and consumer/native checks. Unrelated fresh packages are not exempt.

The Workers test-pool, old Drizzle loader and crypto-js still have deprecation notices. A clean advisory audit does not erase those maintenance warnings.

## Evidence and release boundary

- Full local lint/types/tests: **6,233 passed, 1 intentionally skipped**, including 7 new dependency-consumer regressions and the live-text-size regression. The old decoder fails the bounded malformed-query case under a 128 MB child-process heap; the patched consumer completes within the 3-second deadline. UUID's short-buffer regression fails against the old version and passes against the new one.
- PostgreSQL 18: **170 tests pass** on disposable local databases.
- Frozen installation, Expo compatibility, peer checks, web export, native project generation and CocoaPods resolution pass. The arm64 Release simulator app compiles and all 27 local web walkthroughs pass. The compiled app reproduced live Dynamic Type clipping; its shared text component now refreshes only native text measurements. Largest-size live bounds match a cold start, and the Questions screen stays selected. The regression preserves an unsaved draft across repeated size changes. Signed-phone/provider proof remains separate.
- All test words, identities and assets are synthetic. The isolated simulator build uses `audit-simulator`: demo mode, no API or Clerk key, and online updates disabled. It cannot prove provider authentication or live delivery.

No collection, processor, recipient, AI input, privacy notice, production switch or provider-account setting changes. Clerk remains the existing authentication processor. No production deployment, signed-phone distribution or OTA is performed by this maintenance work. Native changes need a compatible new binary.

## Checks still requiring live access

1. A dedicated test iPhone: provider sign-in, restart/session recovery, sign-out, and deletion of a synthetic waiting account. Also microphone interruption/discard/retry, offline recovery, permissions, VoiceOver and live text-size changes.
2. Dedicated test messaging/device routes: real LINE delivery and APNs/FCM delivery, with explicit recipients and test messages. No real family or founder account is used as a deletion fixture.
3. Backup evidence: current restore-window and branch inventory, then an isolated rehearsal with the saved environment key. A successful local deletion test does not establish production or backup erasure. Follow the [restore acceptance gates](../../infra/runbooks/restore-drill.md#before-any-real-restore).

Live checks stay open until their own receipts exist. Production records, backup copies and owner credentials require the scoped access described in the repository's data and account rules.
