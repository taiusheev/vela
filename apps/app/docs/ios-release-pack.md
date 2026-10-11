# iOS release pack — product-week X5

Prepared 11 October 2026. This pack makes the source reviewable and the build/submission steps repeatable. X5 remains open until the native archive, screenshots, signing and review access are verified. Source releases do not close the separate native gate.

## Source preflight

From the repository root:

```sh
pnpm --filter @vela/app release:ios:doctor
pnpm check
```

The doctor evaluates native configuration with a synthetic public-key fixture and an allowlisted environment. It does not load private dotenv files, contact an account, request a build or upload anything. Its JSON records `storeReady: false` alongside the checks actually performed. Passing it proves source configuration, not production authentication or Apple approval.

The `trial` profile selects production API/authentication, English trial capabilities, iPhone-only support, the production update channel and an incrementing build number. Local dotenv files and example-family mode are disabled. App configuration rejects example mode in a production trial and rejects a development Clerk key. The real production publishable key must be present in the EAS production environment before a build; the doctor's fixture is never a deployment credential.

## Privacy manifest and permissions

`app.json` supplies `ios.privacyManifests`; Expo writes `PrivacyInfo.xcprivacy` into the generated app target. [Expo's privacy-manifest guidance](https://docs.expo.dev/guides/apple-privacy/) describes this path. React Native also aggregates the manifests from installed Pods during the native build. Inspect that final aggregate rather than treating source configuration as archive evidence.

The required reasons were copied from the installed libraries, not selected from an unrelated example:

An isolated `expo prebuild --platform ios --no-install` generated the audit-simulator project on 11 October. [The source receipt](ios-release-source.json) records a manifest identical to app configuration and referenced in the target's Resources phase, an iPhone-only target, the expected microphone/photo texts, absent camera permission and present icon catalog files. Its app-config digest binds that evidence to the checked source. Pods were not installed and no binary was compiled or signed; this is generated-project evidence only.

| API category | Declared reasons | Installed source |
|---|---|---|
| UserDefaults | CA92.1 | React Native, Expo constants/localization/notifications/EAS client |
| File timestamps | C617.1, 0A2A.1, 3B52.1 | React Native, Expo application/file-system |
| Disk space | E174.1, 85F4.1 | Expo file-system |
| System boot time | 35F9.1 | React Native timing |

The manifest declares ten collected data categories: name, email, optional phone, private messages, photos, audio, other submitted content, account identifier, installation identifier and product interaction. All are conservatively linked; none are used for tracking. Product interaction also declares analytics. This describes supported optional organiser surfaces as well as the narrower English trial; it adds no collection or permissions.

Reconcile the manifest with [the store privacy answers](../../../plan/materials/stores/privacy-answers.md), provider practices and the final binary before entering the App Store fields. Generic content and the separately consented server health understanding remain subject to the existing counsel review. Adding a crash SDK requires another manifest/privacy review; X7 has no provider selected here.

Native permission texts remain specific to chosen photos and user-initiated voice recording. Camera permission remains disabled. Introspection verifies their plugin output. The app icon is an opaque 1024×1024 PNG; the splash is a separate transparent asset with light/dark backgrounds. Prebuild generates the native asset catalog. Native display, permission-denial recovery and final icon/splash appearance still need observation.

`ITSAppUsesNonExemptEncryption` remains false. The implementation uses HTTPS and OS SecureStore. Resolve the final encryption questionnaire against the submitted archive and actual libraries; do not describe the app as using HTTPS alone.

## Build and upload — once owner prerequisites are complete

Engineering checks Apple enrollment, the App Store app record for `family.vela.light`, production API availability, EAS production configuration and the synthetic reviewer route. The founder owns enrollment, agreements and private credential entry. Store only the non-secret App Store numeric app ID in configuration if one is supplied; never commit an Apple password, private API key or review login.

From `apps/app`, with a clean tested source checkout:

```sh
eas build --platform ios --profile trial --wait
eas submit --platform ios --profile trial --id <verified-build-uuid>
```

Record the build UUID, source commit, app version/build number and embedded `releaseCommit`. Select that exact verified build for upload. The existing submission profile can prompt for the app record and private account setup; it is not unattended until the real `ascAppId` and managed signing/submission credentials exist. No placeholder identifier has been committed.

[EAS Submit uploads to App Store Connect/TestFlight](https://docs.expo.dev/submit/ios/). Public App Review submission is a further App Store Connect action. Neither command above grants external beta review approval, invites testers or publishes the app. No cloud build, signing action or submission was performed while preparing this pack.

## Archive verification

On the exact resulting `.ipa`, engineering must inspect:

1. `Payload/*.app/Info.plist`: bundle ID, version/build, iPhone device family and permission purpose strings.
2. `Payload/*.app/PrivacyInfo.xcprivacy`: the collected data declarations, no tracking and the final dependency required-reason aggregate. Confirm the manifest is included in the app bundle, not merely left in a generated source directory.
3. Native resource catalog, splash, notification entitlement and the bundled Opus decoder. Verify voice playback on the installed signed build.
4. Embedded source/update identity, production API/authentication and failure of demo/staging fallback. Test real sign-in using an approved synthetic account.

Archive acceptance and Apple's processing messages are separate receipts. A successful source preflight does not replace them.

## Native screenshot capture

Use the exact release UI with a dedicated synthetic family, never a real family's messages or photos. Capture Today with a genuine synthetic answer, Ask, Reply, Exchanges and a quiet notice; add the weekly read only where the trial capabilities enable it. Keep loading/error text and private account codes out of marketing captures. Use the captions in [the listing pack](../../../plan/materials/stores/listings.md).

The product-week plan asks for 6.7-inch and 6.1-inch captures. Use a 6.7-inch iPhone 14 Pro Max (1290×2796) and a 6.1-inch iPhone 15 (1179×2556), or a documented equivalent. Apple's current [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) require a Dynamic Island medium-display screenshot, accept these dimensions, and prohibit transparency. Recheck the current requirements at upload time.

After simulator setup, engineering selects the actual simulator IDs and boots the matching native build. Capture each device explicitly, for example:

```sh
xcrun simctl io <verified-simulator-uuid> screenshot --type=png <capture-path.png>
```

For each set, save tested commit/build, device model, dimensions, language, fixture name and actual screenshot files. Inspect every image for layout, clipped text and sensitive material. Browser captures in the prior audit are synthetic web evidence only; no native store screenshots exist yet.

## Review access and handoff

The existing [English TestFlight review packet](../../../plan/materials/trial/testflight-review.en.md) supplies beta description, test instructions and private reviewer requirements. The published English trial remains Telegram-first; a LINE test in the product week does not silently change that packet or eligibility. The broader store listing includes later LINE support.

Provision the reviewer through the normal admission roster using synthetic identities and consent. The reviewer must independently complete sign-in/linking and the synthetic exchange on the submitted build. Put tested login details and the parent route only in App Store Connect's private review fields. A one-time Telegram proof code is not durable reviewer access; verify the route immediately before submission.

Account deletion is reached through You → Delete account. Demonstrate it only with disposable synthetic accounts and the normal tested lifecycle. Keep the not-an-emergency-service wording in the listing/review packet.

Remaining X5 evidence: owner enrollment/app record and production configuration, signed build identity, archive manifest/resource inspection, actual native screenshots, installed-device permissions/media/recovery checks and a working independent review account. No App Store submission-readiness claim is made from this source pack.
