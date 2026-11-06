# Dependency repair receipt — 5 November 2026

Follow-up: [6 November remaining-audit repairs](remaining-audit-2026-11-06.md) replaces the remaining dependency inventory below. This file preserves the first repair snapshot.

This is a maintenance change, following the whole-app audit. The counts below are the active pnpm workspace. GitHub separately reported 13 alerts in the archived phase-0 prototype’s lockfile. Its supported dependency refresh is included too: npm audit goes from 5 vulnerable package entries to 0; its local typecheck and build-only dry run pass. No archived Worker or database was deployed. It adds no collection, recipients, permissions, feature switches, or production release.

The active workspace registry audit fell from **55 advisories (26 high, 24 moderate, 5 low)** to **11 (2 high, 8 moderate, 1 low)**. These counts describe dependency advisories, not demonstrated Vela exploits. The audit still exits nonzero; this change does not suppress its remaining findings.

## Changes

- Align the 12 packages reported by Expo's compatibility checker with SDK **57.0.31**, preserving React Native 0.86.3 and Expo Audio 57.0.5. `expo install --check` passes. This is the existing SDK's patch line.
- Update Vitest 4.1.11 to 4.1.12 and pin vulnerable Vite 8.3 releases to 8.3.3. These address the [Vitest mock registration advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8) and its Vite advisories.
- Update the development Node server adapter from 2.1.1 to 2.1.6, above the maintainer's [2.1.3 fix](https://github.com/honojs/node-server/security/advisories/GHSA-rmxm-3fg6-px4f).
- Update Undici within major 7 to 7.30.1 and node-forge within major 1 to 1.4.3, including the maintainer’s 3 November security fixes. Keep Wrangler on its existing release.
- Pin only the Workers test pool's Zod 4 dependency to the application's existing 4.6.6. Do not replace Zod 3 consumers with a different major API.
- Pin only `@expo/plist`'s XML parser dependency to xmldom 0.8.15. Its DOM parser/serializer API remains compatible with this consumer; Expo native project generation exercises the plist/Xcode target path successfully. This removes the [XML serialization advisory](https://github.com/xmldom/xmldom/security/advisories/GHSA-wh4c-j3r5-mjhp) and other xmldom alerts.

## Remaining findings

| Dependency | Why it remains / follow-up |
|---|---|
| Zod 3 (high) | Nested Expo CLI dependency. The patched version is Zod 4, a different major API. Vela's application schemas and Workers test pool use patched 4.6.6. Upgrade the owning Expo toolchain through its supported migration; do not force-replace its schema library. |
| decode-uri-component (high and moderate) | Nested in query-string through Expo Router. The available 0.5.1 package is ESM while this consumer uses CommonJS. A blind override breaks its import. Needs a compatible parent upgrade or a reviewed backport, including malformed deep-link tests. |
| stream-json (3 moderate) | Nested through Clerk's Solana/Web3 dependencies. Version 3 is ESM with different exports from installed version 1. Vela has no wallet feature configured in its source. Migrate the deprecated Clerk Expo package separately and test signed-in sessions. |
| uuid (moderate) | Nested Xcode/build and Clerk dependencies. Do not replace old CommonJS consumers with UUID 11 without their supported upgrade. |
| glob / minimatch (2 moderate) | Build tooling dependencies whose fixes cross major versions. Review with the owning Expo/Apple-target tooling. No family-supplied glob patterns were found. |
| esbuild (moderate) | Drizzle Kit's legacy loader. The advisory concerns its development server. Vela's scripts generate/export schema; they do not start that server. The current parent still carries the loader. |
| deepmerge (low) | The registry reports no patched version. Remains in Expo configuration tooling. |

The legacy `@clerk/clerk-expo` and Workers test-pool packages also emit deprecation notices. This change does not hide those warnings or perform an authentication migration.

## Release boundary

Native dependency patches change the app fingerprint. A new compatible iPhone binary is needed before those native changes can reach existing phones; do not publish them as an update to an older runtime. See [Expo's build/update guidance](https://docs.expo.dev/tutorial/cicd/introduction/). No binary, OTA update, production tag, or production deployment is created by this change.

Verification receipts are recorded in the pull request. Native project generation and Hermes bundle export are build checks, not signed-phone, microphone, provider sign-in, push-delivery, or real-family validation.
