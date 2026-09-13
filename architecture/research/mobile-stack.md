# Mobile stack, September 2026 — options checked, recommendation, evidence

Due-diligence check on the mobile stack for one codebase serving the family app, the parent surface, and the kitchen-table tablet mode. Tests ADR-3 (Expo, 2026-09-12) and ADR-9 (web checkout first) in `architecture/decisions.md` against the ecosystem as of this week. Estimates are flagged; nothing here is invented.

## 1. Recommendation, in ten lines

1. **Framework: stay on Expo/React Native.** SDK 55 (React Native 0.83, React 19.2) is New-Architecture-only; RN inherits OS accessibility "for free" by rendering real native views, which Flutter's own-pixel renderer must reimplement.
2. **One codebase, three modes**, as ADR-3 says: family app, parent surface, kitchen-table are navigation/token variants, not three apps.
3. **Widgets are two separate small native builds, not one API.** iOS via `expo-widgets` (alpha) or a bare Swift `WidgetKit` target; Android via `react-native-android-widget`. Budget real native time.
4. **Audio: `expo-audio`, not `expo-av`** (deprecated, removed in SDK 55). AAC/M4A by default; `expo-speech-recognition` as an offline STT fallback; `expo-speech` for instant TTS, pre-rendered cloud audio where zh-TW/ja quality matters for a parent's ears.
5. **State/data: TanStack Query + Zustand.** Skip a full offline-first sync engine (WatermelonDB/PowerSync/ElectricSQL) for v1 — the ask-and-answer loop is low-frequency, not a shared live document.
6. **UI: no heavy kit on the parent surface.** Plain `StyleSheet` for P1–P6 so every font-scale and hit-target number is explicit. NativeWind or Tamagui for the family app; gluestack-ui if one accessible kit everywhere is wanted.
7. **i18n: Lingui** (compile-time ICU, smallest runtime) over `i18next` (needs `i18next-icu`) or FormatJS (heaviest, most complete). `date-fns` v4 + `@date-fns/tz` for time zones; Temporal polyfill not worth ~100KB yet.
8. **Payments: hold ADR-9, tighten execution.** RevenueCat now bridges StoreKit 2, Play Billing v8, and Web Billing, free to $2,500/month tracked revenue — add in phase 2. Until then the Stripe link must sit outside the in-app purchase flow: Taiwan and India have no external-link allowance (only US, EU/DMA, Japan/MSCA do).
9. **Quality: Biome + Jest/RNTL + Maestro + Sentry + PostHog.** Maestro's YAML tests are the one E2E format a non-technical founder can read; PostHog bundles analytics, replay, and flags in one free tier.
10. **Net effect:** no change to the Expo decision; three build-order changes — budget native widget work, keep the parent surface off any UI kit, fix the payment link's legal shape before phase 0/1 pricing tests.

## 2. Comparison tables

### Framework

| Option | Verdict | Evidence | Link |
|---|---|---|---|
| Expo/React Native | Recommended | SDK 55 = RN 0.83/React 19.2, New Arch mandatory; ~83% of SDK 54 EAS builds already New Arch by Jan 2026 | [SDK 55 changelog](https://expo.dev/changelog/sdk-55) |
| Flutter | Rejected | Improving a11y, but reimplements the OS accessibility layer rather than inheriting it | [State of Mobile 2026](https://cheesecakelabs.com/blog/state-of-mobile/) |
| Compose Multiplatform / KMP | Rejected for now | iOS stable since CMP 1.8.0 (May 2025), production users exist (Netflix, Cash App), but trades our shared TS stack (ADR-1) for a second language | [CMP production-ready 2026](https://medium.com/@androidlab/is-compose-multiplatform-ready-for-production-in-2026-a83af5c2f998) |
| Native Swift + Kotlin | Rejected | Two codebases for a one-person build team | — |
| Capacitor/Ionic | Rejected | Good PWA support, but no real path to WidgetKit/AppWidget from one codebase | [Capacitor PWA docs](https://capacitorjs.com/docs/web/progressive-web-apps) |
| PWA-only | Rejected | No home-screen widget, unreliable always-on screen, weak install funnel for a 75-year-old | — |
| Hiring pool | RN wins | ~6x more US job postings than Flutter despite Flutter's higher usage share | [RN vs Flutter jobs 2026](https://techsy.io/en/blog/react-native-vs-flutter) |

### Widgets and Live Activities from Expo

| Piece | State | Limits | Link |
|---|---|---|---|
| `expo-widgets` (iOS) | Alpha; compiles `@expo/ui` components to real SwiftUI | No Expo Go; isolated runtime, no hooks/async; images unsupported; API "may change" | [Expo widgets blog, Mar 2026](https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo) |
| `react-native-android-widget` | Mature, has its own Expo config plugin | Verbose config (`widgetFeatures`); a second, Kotlin-adjacent mental model | [docs](https://saleksovski.github.io/react-native-android-widget/) |
| Push-driven refresh | Server push via APNs can call `updateSnapshot()`/`updateTimeline()`; Live Activities support push-to-start | Needs `NSSupportsLiveActivitiesFrequentUpdates`; OS can still throttle | same as above |
| Vela's "light" widget | Buildable as two small native surfaces sharing one state payload, not one cross-platform API | — | — |

### Audio

| Piece | Verdict | Evidence | Link |
|---|---|---|---|
| `expo-audio` vs `expo-av` | Use `expo-audio` | `expo-av`'s audio API is removed starting SDK 55 | [PR #36020](https://github.com/expo/expo/pull/36020) |
| `react-native-audio-recorder-player` | Fallback only | AAC default; Opus needs iOS 11+/Android API 29+, falls back silently below that | [npm](https://www.npmjs.com/package/react-native-audio-recorder-player) |
| Format | AAC/M4A | Opus's API 29+ floor excludes some Android 8 kitchen-table tablets | — |
| Waveform | `expo-audio`'s `useAudioSampleListener`, or `react-native-audio-waveform` | Real dB metering via `isMeteringEnabled` | [expo-audio docs](https://docs.expo.dev/versions/latest/sdk/audio/) |
| On-device TTS | `expo-speech`, instant fallback only | Wraps OS engines; quality is device-dependent and reported inconsistent for Japanese | [zh-TW TTS notes](https://speechgen.io/en/tts-cmn-TW/) |
| On-device STT | `expo-speech-recognition` (community) | Android offline mode needs a per-locale model download first | [expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition) |

### State, data, and offline

| Option | Verdict | Evidence | Link |
|---|---|---|---|
| TanStack Query + Zustand | Recommended | 2026 default split — server cache vs small client store, no Redux needed | [state mgmt 2026](https://vucense.com/dev-corner/react-state-management-2026/) |
| Legend State | Not recommended | ~210 open issues on ~4K stars — maintenance-risk signal | [comparison](https://addjam.com/blog/2026-03-20/react-native-offline-data-react-query-zustand/) |
| WatermelonDB / PowerSync / ElectricSQL | Not needed for v1 | Real sync engines (PowerSync: free to 2GB synced/mo, then $49/mo); our loop is low-write, not multi-writer live sync | [PowerSync pricing](https://docs.powersync.com/resources/usage-and-billing/pricing-example) |
| `expo-sqlite` + `expo-secure-store` | Recommended | SQLite for local cache; SecureStore (Keychain/Keystore-backed, 2048B/value) for tokens | [SecureStore docs](https://docs.expo.dev/versions/latest/sdk/securestore/) |
| Revisit trigger | — | Add PowerSync only if the parent surface must compose asks offline for hours | — |

### UI system

| Option | Verdict | Evidence | Link |
|---|---|---|---|
| Custom `StyleSheet` (parent surface) | Recommended | Explicit, auditable font-scale and hit-target numbers | — |
| NativeWind | Recommended (family app) | Compiles Tailwind utilities ahead of time; large web-dev pool | [NativeWind vs Tamagui vs Unistyles 2026](https://medium.com/react-native-journal/nativewind-vs-tamagui-vs-unistyles-which-styling-library-should-you-use-in-2026-cf4f4d78b76f) |
| Tamagui | Viable alternative | Compiler-flattened, strong tokens, web+native from one API | same as above |
| gluestack-ui v2 | Fallback | Explicitly "accessibility-first," headless + styled layer | [gluestack vs Paper vs Unistyles](https://www.pkgpulse.com/guides/gluestack-ui-vs-react-native-paper-vs-unistyles-react-2026) |
| React Native Paper | Not recommended | Material-only look fights the Candle & Ink identity | — |
| Typography | Literata + Inter via `@expo-google-fonts`, Noto Sans TC/JP as CJK fallback (list generic Noto Sans before the region variant) | — | [Noto usage](https://notofonts.github.io/noto-docs/website/use/) |

### Localisation and date/time

| Option | Verdict | Evidence | Link |
|---|---|---|---|
| Lingui | Recommended | Compile-time ICU, ~10.4KB combined — about half of `react-i18next`/`react-intl` | [Lingui vs i18next](https://lingui.dev/misc/i18next) |
| i18next | Not alone | Needs separate `i18next-icu` plugin for zh/ja plural/gender rules | [i18n libraries 2026](https://tolgee.io/blog/react-i18n-libraries-comparison) |
| FormatJS/react-intl | Fallback | Most complete ICU, heaviest, runtime-parsed | same as above |
| `date-fns` v4 + `@date-fns/tz` / Luxon | Recommended | Uses `Intl`, no bundled tz data; "practical default for 2026" | [date libraries 2026](https://npm-compare.com/@js-temporal/polyfill,date-fns,date-fns-tz,dayjs,luxon,moment) |
| Temporal polyfill | Not yet | Stage 4/ES2026 but ~100KB, not justified until Hermes ships it natively | same as above |

### Payments and paywalls

| Option | Verdict | Evidence | Link |
|---|---|---|---|
| RevenueCat | Recommended, phase 2 | Free to $2,500/mo tracked revenue then 1%; one SDK covers StoreKit 2, Play Billing v8, Web Billing | [pricing 2026](https://costbench.com/software/subscription-billing/revenuecat/) |
| Adapty | Viable alternative | Dropped its $99/mo minimum Feb 2026; free under $5,000 MTR | [RevenueCat vs Adapty vs Superwall](https://www.buildmvpfast.com/blog/revenuecat-vs-superwall-vs-adapty-in-app-subscription-indie-2026) |
| Qonversion | Cheapest at scale | 0.6–0.8% past free threshold vs 1% for the others | same as above |
| Superwall | Paywall-only | Per-conversion pricing; pairs with an entitlement layer, doesn't replace one | same as above |
| Apple external-purchase links | Region-gated | No entitlement on **US**; **EU** needs the link entitlement (→ DPLA Attachment 14, Oct 1 2026); **Japan** allows a 13+-gated link under MSCA; **Taiwan and India have neither** | [Apple DMA](https://developer.apple.com/support/dma-and-apps-in-the-eu/), [Japan MSCA](https://www.macrumors.com/2025/12/17/japan-app-store-feature-updates/) |
| Google Play external offers | Improving, not universal | From June 30, 2026: US/EEA/UK get expanded billing choice; fee ~10–20% depending on path | [Android Developers Blog](https://android-developers.googleblog.com/2026/06/play-expanded-billing.html) |
| Consequence for ADR-9 | Tighten the plan | Phase-0/1 Stripe link must be a Settings-level link, never an in-app "Subscribe" button, in Taiwan/India | — |

### Quality tooling

| Option | Verdict | Evidence | Link |
|---|---|---|---|
| Biome | Recommended over ESLint+Prettier | One `biome.json`, Rust-native speed, good-enough RN/TS coverage | [Biome vs ESLint 2026](https://reintech.io/blog/eslint-vs-biome-javascript-linting-comparison-2026) |
| Jest + React Native Testing Library | Recommended | Standard pairing; Vitest's RN support is still web-first | — |
| Maestro vs Detox | Maestro for us | YAML, near-zero setup, <1% reported flakiness, readable by a non-technical founder | [Detox vs Maestro](https://maestro.dev/insights/detox-vs-maestro-reducing-flakiness-react-native) |
| Sentry | Recommended | Standard RN crash reporting; correlates with EAS Update releases | — |
| PostHog vs Amplitude | PostHog | Free tier: 1M events + 2,500 replays + 1M flag requests/mo, one bill for analytics+flags+replay | [PostHog comparison](https://posthog.com/blog/best-mobile-app-analytics-tools) |

## 3. Parent-surface accessibility checklist (exact APIs/props)

- **Text scale**: never `allowFontScaling={false}`; set `maxFontSizeMultiplier` deliberately (e.g. 2.0–3.0); read `PixelRatio.getFontScale()` to switch layout (stack vs row) above a threshold.
- **Targets 64–88pt**: explicit `minWidth`/`minHeight` on every tappable element, plus `hitSlop` where the visual mark must stay smaller.
- **Screen reader**: `accessibilityRole`, a human `accessibilityLabel`, `accessibilityHint` where the action isn't obvious; hide decorative wrappers with `accessible={false}` / `importantForAccessibility="no-hide-descendants"`.
- **Detect assistive tech**: `AccessibilityInfo.isScreenReaderEnabled()` + `screenReaderChanged`; `AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged` to cut non-essential motion (Apple's own declarable "Reduced Motion" label item).
- **Voice recording**: one large (88pt) record button on `expo-audio`, `isMeteringEnabled` driving a visible level meter, not a timer alone.
- **Two-photo choice**: equal, large, independently focusable/labelled options for TalkBack/VoiceOver swipe navigation.
- **Read-aloud**: pre-rendered cloud TTS for consistent voice/accent; `expo-speech` as instant offline fallback only — system TTS is documented to switch accent mid-sentence for Japanese.
- **System font scaling**: test at the OS's largest non-accessibility size and again at the largest accessibility size; check any pixel-fixed containers at both.
- **Light mode only**: skip `useColorScheme()` on parent-surface screens; hardcode the light palette.
- **Kitchen-table always-on**: `expo-keep-awake`'s `activateKeepAwakeAsync()` / `<KeepAwake />`, released on exit; this only blocks sleep, so pair with a battery/heat-aware dim strategy.
- **Apple Accessibility Nutrition Label**: voluntary in 2026, becomes required for iOS/iPadOS 26+ submissions later — declare it early (VoiceOver, Larger Text, Sufficient Contrast, Reduced Motion, Differentiate Without Color Alone are all plausibly true here), and it doubles as positioning. [Reference](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/)

## 4. Repo layout and libraries (versions as of September 2026)

```
vela/
  apps/
    mobile/               # Expo app: family + parent-surface + kitchen-table modes
      ios/                # bare Swift widget target (WidgetKit)
      android/             # react-native-android-widget output
      app/                # Expo Router routes
      modes/              # family/, parent-surface/, kitchen-table/
  packages/
    ui/                   # NativeWind family components + raw-StyleSheet parent-surface kit
    i18n/                 # Lingui catalogs: en (source), zh-TW, ja, de, hi
    core/                 # TanStack Query hooks, Zustand stores, API client
    audio/                # expo-audio wrappers, waveform, TTS/STT adapters
```

Indicative versions: Expo SDK 55 (RN 0.83, React 19.2); TypeScript ~5.7 strict; `expo-audio`, `expo-speech`, `expo-speech-recognition`; `expo-widgets` (alpha) + `react-native-android-widget`; `@tanstack/react-query` v5, `zustand` v5; `expo-sqlite`, `expo-secure-store`; NativeWind; Lingui v5; `date-fns` v4 + `@date-fns/tz`; `react-native-purchases` (RevenueCat, phase 2); Biome; Jest + `@testing-library/react-native`; Maestro CLI; `@sentry/react-native`; `posthog-react-native`.

## 5. Store and legal checklist

- **Apple Developer account**: Singapore entity → enroll as an **Organization**, requiring a **D-U-N-S number** (free, 30+ days to obtain — start now). Individual accounts cannot represent a Pte. Ltd.
- **Google Play developer account**: same D-U-N-S plus business registration, proof of address, named authorized representative with ID. From September 2026 even personal accounts require identity verification.
- **Xcode/SDK deadline**: from April 28, 2026, new App Store Connect uploads need Xcode 26 / iOS 26 SDK — confirm the EAS Build image supports this.
- **Age ratings**: Apple's granular questionnaire (13+/16+/18+ bands) had a January 31, 2026 compliance deadline for existing apps — complete it at first submission.
- **Health-adjacent classification (Google Play)**: likely triggers the Health apps declaration form; the required disclaimer ("not a medical device...") must appear in the first paragraph of the store listing or updates are rejected.
- **Privacy nutrition label (Apple) / Data safety form (Google)**: keep in lockstep with ADR-7's per-region data map.
- **Apple Accessibility Nutrition Label**: not mandatory yet, worth completing at first submission (§3).
- **External-link compliance**: never present the Stripe link as an in-app "Buy" action where the storefront is Taiwan or India; Settings-level only, until RevenueCat covers the regions that allow it.

## 6. Risks and what would make us switch

- **`expo-widgets` is alpha.** If its API churns before ship, fall back to a hand-written Swift `WidgetKit` target in the EAS-managed Xcode project — budget this now, not at ship time.
- **Old Android 8 tablets are the real performance unknown.** SDK 55 still targets Android 7+, but New-Arch RN's behavior on 6–8-year-old low-RAM hardware needs real-device testing. If the always-on photo/chime loop janks, use ADR-3's own fallback — a minimal native shell for that mode only.
- **The Taiwan/India external-link gap may move.** Apple and Google are both mid-rollout on alternative billing; re-check before phase 2 pricing tests go live in those two markets.
- **A future web dashboard** would make Tamagui's cross-platform compiler more attractive than NativeWind alone — revisit then.
- **True offline composing** (a parent recording with no connectivity for hours) would justify adding PowerSync for that one sync path, not a rewrite.
- **If Sentry/PostHog free tiers stop covering volume**, re-quote against self-hosted PostHog — already an option without a rewrite.

---

Sources (fetched September 2026): [Expo SDK 55](https://expo.dev/changelog/sdk-55) · [New Architecture guide](https://docs.expo.dev/guides/new-architecture/) · [EAS billing plans](https://docs.expo.dev/billing/plans/) · [EAS Update OTA rules](https://www.72technologies.com/blog/eas-update-ota-rejection-risks-2026) · [State of Mobile 2026](https://cheesecakelabs.com/blog/state-of-mobile/) · [CMP production-readiness](https://medium.com/@androidlab/is-compose-multiplatform-ready-for-production-in-2026-a83af5c2f998) · [Capacitor PWA docs](https://capacitorjs.com/docs/web/progressive-web-apps) · [Expo widgets & Live Activities](https://expo.dev/blog/home-screen-widgets-and-live-activities-in-expo) · [Widgets SDK reference](https://docs.expo.dev/versions/latest/sdk/widgets/) · [react-native-android-widget](https://saleksovski.github.io/react-native-android-widget/) · [expo-av deprecation](https://github.com/expo/expo/pull/36020) · [expo-audio reference](https://docs.expo.dev/versions/latest/sdk/audio/) · [react-native-audio-recorder-player](https://www.npmjs.com/package/react-native-audio-recorder-player) · [zh-TW TTS notes](https://speechgen.io/en/tts-cmn-TW/) · [expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition) · [state management 2026](https://vucense.com/dev-corner/react-state-management-2026/) · [offline-first stack 2026](https://procedure.tech/blogs/react-native-offline-first/) · [PowerSync pricing](https://docs.powersync.com/resources/usage-and-billing/pricing-example) · [SecureStore reference](https://docs.expo.dev/versions/latest/sdk/securestore/) · [NativeWind vs Tamagui vs Unistyles](https://medium.com/react-native-journal/nativewind-vs-tamagui-vs-unistyles-which-styling-library-should-you-use-in-2026-cf4f4d78b76f) · [gluestack vs Paper vs Unistyles](https://www.pkgpulse.com/guides/gluestack-ui-vs-react-native-paper-vs-unistyles-react-2026) · [Noto usage guidance](https://notofonts.github.io/noto-docs/website/use/) · [Lingui vs i18next](https://lingui.dev/misc/i18next) · [i18n libraries 2026](https://tolgee.io/blog/react-i18n-libraries-comparison) · [JS date/timezone libraries 2026](https://npm-compare.com/@js-temporal/polyfill,date-fns,date-fns-tz,dayjs,luxon,moment) · [RevenueCat pricing 2026](https://costbench.com/software/subscription-billing/revenuecat/) · [RevenueCat vs Adapty vs Superwall](https://www.buildmvpfast.com/blog/revenuecat-vs-superwall-vs-adapty-in-app-subscription-indie-2026) · [Apple DMA changes](https://developer.apple.com/support/dma-and-apps-in-the-eu/) · [Japan MSCA changes](https://www.macrumors.com/2025/12/17/japan-app-store-feature-updates/) · [Android Developers Blog, expanded billing](https://android-developers.googleblog.com/2026/06/play-expanded-billing.html) · [Detox vs Maestro](https://maestro.dev/insights/detox-vs-maestro-reducing-flakiness-react-native) · [PostHog mobile analytics](https://posthog.com/blog/best-mobile-app-analytics-tools) · [D-U-N-S for Apple Developer, Singapore](https://globallinkconsulting.sg/en/article/duns-registration/duns-for-apple-developer) · [Google Play developer verification 2026](https://testerbee.com/blog/google-play-developer-verification-2026) · [Play Console health content policy](https://support.google.com/googleplay/android-developer/answer/16679511?hl=en) · [Apple SDK minimum requirements](https://expo.dev/blog/apple-sdk-minimum-requirements) · [Biome vs ESLint 2026](https://reintech.io/blog/eslint-vs-biome-javascript-linting-comparison-2026) · [Apple Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/) · [Apple age-rating deadline coverage](https://appleinsider.com/articles/25/07/25/app-store-developers-must-now-provide-age-rating-details) · [RN vs Flutter hiring 2026](https://techsy.io/en/blog/react-native-vs-flutter)
