# Product-week iPhone audit — 10 October 2026

Plan: PR #60, `plan/product-week.md`, source 0c7975d. Owner: Codex for app paths.

## Evidence and current limit

X1 is **in progress**, not complete. This is a source review and a native-audit setup receipt, not an observed iPhone audit. No native screenshots, measured taps, VoiceOver results, Dynamic Type results, real account loop, or TestFlight evidence have been collected.

This Mac currently selects `/Library/Developer/CommandLineTools`; `xcrun --find simctl` fails. Spotlight found no Xcode application. `pnpm --filter @vela/app audit:doctor` reports the missing simulator and exits unsuccessfully without launching an app.

[Simulator setup reference](https://docs.expo.dev/workflow/ios-simulator/). Install Xcode from the Mac App Store, open it once to finish setup, choose Xcode’s tools in Settings → Locations → Command Line Tools, and install an iOS simulator runtime in Xcode Settings → Components. Then engineering can resume the native walkthrough. Apple Developer paid membership is needed for the later signed/TestFlight work, not for this simulator setup.

## Repeatable setup

From the repository root:

```sh
pnpm --filter @vela/app audit:doctor
pnpm --filter @vela/app audit:ios
```

The launcher disables dotenv loading, removes API/authentication/trial settings from its child environment, enables explicit demo fixtures, clears Metro's cache, and opens Expo Go on iOS. Existing local staging settings cannot turn this audit into a live family session.

For a custom native simulator build, use the `audit-simulator` EAS profile. It is internal, iPhone-only, explicitly demo, and uses its own `audit` update channel. It does not extend a staging or store profile. Build only after the Expo account/build capacity is confirmed; no cloud build has been requested here.

Expo Go checks the basic experience. A custom build is still needed to exercise Vela's bundled Opus decoder; microphone, selected-photo access, background/resume, notifications and messenger media need separate native/device evidence. The configuration checks do not establish Apple acceptance.

## Preliminary friction, ranked

These findings come from code inspection; native reproduction is pending.

| Priority | Finding | Customer effect | Next step |
|---|---|---|---|
| P1 | Today offers an exchange link for an arrival with `delivery_status: pending`; single-exchange API accepts only delivered, retained exchanges | Opens a failure screen before the morning arrives | X2: draft now suppresses the unavailable link while pending; native screenshot verification is still required. Ask Claude C8 for an explicit openability field for wholly failed vs partly delivered arrivals |
| P2 | Today has a reply link but no heart control | A quick acknowledgement requires opening the exchange | X3: add a heart action using the existing reply API and request-identity behavior; confirm recipient and sending/result feedback |
| P2 | Reply controls appear below the ask, media and prior replies | Long exchanges can require substantial scrolling | X2/X3: measure actual keyboard/scroll friction before changing layout |
| P1 release gate | No app-level privacy manifest configuration found in `app.json` | X5 remains unproven for store submission | Review actual native dependency manifests and collected-data declarations; generate and inspect the final archive before claiming completion |

Already present in source: pending/failed delivery wording (PR #59), pull/focus refresh on Today, reply draft preservation/retry, family-scoped selection, visible pause/leave/delete confirmations, Help and bounded service status. These need native verification, not replacement merely because an audit is starting.

## Five core journeys: measure on the device

Count action taps from the stated starting screen to visible success. Record keyboard focus, text entry, scroll gestures, account/OTP steps, permission prompts and confirmations separately; do not silently exclude them to make a journey meet the target. Test from a fresh state and from an established family.

| Journey | Start and success | Source hypothesis, not a measured count | Observed taps / receipt |
|---|---|---|---|
| Onboarding/linking | Signed out → approved synthetic family on Today | Multiple branches: sign-in, OTP, challenge/linking; external actions must be recorded | Pending |
| Ask | Today → accepted ask naming parent and date | Ask action, text focus, Send: at least 3 taps with default options; recipient/date changes add steps | Pending |
| Reply/heart | Answer on Today → visible accepted reply | Heart: open exchange then Heart (2); text: open, focus, Send (3), excluding typing | Pending |
| Quiet notice | Quiet sheet → settled fine/wait outcome | Sheet auto-opens for the authorised organiser; settlement is 1 action; closed sheet must be reopened | Pending |
| Away | Today → saved away state for the named parent | You, parent Away, Save: at least 3; changing dates adds actions | Pending |

## Screen checklist

For every screen record: loading, empty, offline, error and retry; cancel/back; keyboard/focus; largest accessibility text; VoiceOver order/names/hints; 44 pt targets; dark mode; reduced motion; screenshot filename and tested commit. Mark genuinely unavailable future surfaces as deferred instead of counting them as passed.

| Screens | Native status |
|---|---|
| Sign-in, onboarding/linking | Pending; real account flow requires approved synthetic staging account |
| Today, Ask | Pending |
| Exchanges, exchange detail/reactions/text/voice/photo | Pending |
| You, morning settings, Away | Pending |
| Quiet sheet and nearby contacts | Pending; nearby is outside English trial where capabilities disable it |
| Help, precision, Delete account | Pending; irreversible live deletion remains a founder action |
| Sunday, story/day flows | Pending only where enabled for this week's v1; family-book/memory features remain out of scope |
| Parent/tablet, Book, billing/Light, kitchen table | Deferred when capabilities disable them; do not activate for this audit |

## Local validation

`pnpm check` passes all nine package tasks (300 app tests, one existing future gate skipped). `audit:doctor` correctly fails on this Mac’s missing simulator. The app configuration introspection resolves iPhone-only support, the microphone/photo purpose text and disabled camera access. This is generated configuration evidence, not a built archive or a permission prompt observed on iOS.

## Completion gates

X1 closes only after both simulator and Expo Go walkthrough receipts exist and measured tap counts are filled. X2 fixes need native screenshots per the week plan. X4 needs native accessibility evidence. X5 needs the actual manifest/archive, store screenshots, signed build and review account path. X6/X7 depend on account/provider choices; they are not enabled by this audit setup.

Privacy manifest references for X5: [Expo guide](https://docs.expo.dev/guides/apple-privacy/), [Apple manifest documentation](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files). Permission prompts in Expo Go differ from a standalone app: [Expo permissions guide](https://docs.expo.dev/guides/permissions/).
