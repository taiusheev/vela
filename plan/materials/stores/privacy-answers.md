# App privacy answers: App Store and Google Play

Prepared 8 October 2026 (technical plan step 5.7) from the code as built, for the founder to enter in App Store Connect and the Play Console. Every answer names the code it rests on. Re-check this file whenever the app gains an SDK, a permission or a new kind of upload. Counsel's review of the privacy notice (launch gate 12) covers these answers too.

Updated 11 October for product-week X5. The app-level manifest in `apps/app/app.json` covers the supported organiser surfaces, including optional features disabled in the English trial. It declares ten data types, linked conservatively, with no advertising/tracking. These prepared answers still need reconciliation with the exact submitted binary and providers' actual practices.

**Scope.** These answers describe the organiser app, Vela Light (`family.vela.light`). The parent does not use the app: her answers come through Telegram or LINE and are covered by the privacy notice, not by the store label. The app shows her words to her family, but it does not collect them from her.

## What the app sends to Vela, and why

| Data | When | Where in the code | Stored | Linked to the person |
|---|---|---|---|---|
| Email address | Sign-in (Clerk, email code) | `apps/app/src/auth/clerk.tsx` | Clerk | Yes |
| Phone number for sign-in | Only where phone-code sign-in is enabled; the English trial uses email | `apps/app/app/sign-in.tsx` | Clerk | Yes |
| Display name | Profile, family member name | `PATCH /v1/me`, `POST /v1/me/provision` | Vela database | Yes |
| Account id | Every API call (Clerk subject) | `apps/worker/src/session.ts` | Vela database | Yes |
| Asks and replies (text) | When they write them | `POST /v1/families/:id/exchanges`, `POST /v1/exchanges/:id/replies` | Vela database, sealed (ADR-38) | Yes |
| Photos they choose | Ask or reply with a photo | `POST /v1/families/:id/media` | R2, deleted after 30 days unless kept by the family | Yes |
| Voice messages they record | Voice reply or voice hello | `POST /v1/families/:id/voice` | R2, deleted after 30 days; transcribed by Deepgram | Yes |
| Nearby contact name and phone | Only if an organiser adds one (off in the English trial) | `POST /v1/families/:id/members/:mid/nearby` | Vela database, 14 days unless they say yes | Yes (the organiser's family) |
| App update installation identifier (Expo, `expo-updates`) | Update requests on launch | `expo-updates/ios/EXUpdates/AppLoader/FileDownloader.swift` sends `EAS-Client-ID`; `expo-eas-client` persists it in UserDefaults | Identifier persists on device and reaches Expo; verify provider retention before submission | Declared linked conservatively; push registration can associate an installation with the account |
| Push installation id and Expo push token | When notifications are allowed (push is off until step 5.4) | `apps/app/src/push/device.ts`, `POST /v1/me/devices` | Vela database until sign-out | Yes |
| What they did in the app (sent a reply, opened a weekly read) | As events, no content | `events` table, `surface: "app"` | Vela database | Yes |

**No dedicated collection:** location, contacts from the phone's address book, browsing history, purchases (no billing yet), advertising identifiers or crash reports (no crash SDK yet, step 5.3). Generic messages may contain personal details; see the health classification below. A calling number saved on the phone stays on the phone, in the app's private storage (`apps/app/src/storage/`) and is never sent. This is distinct from a nearby contact uploaded to the family API. No data is used for tracking or advertising, and no data is sold.

## App Store Connect: App Privacy

**Do you or your third-party partners collect data from this app?** Yes.

| Apple data type | Collected | Linked to user | Used for tracking | Purposes |
|---|---|---|---|---|
| Contact Info → Name | Yes | Yes | No | App Functionality |
| Contact Info → Email Address | Yes | Yes | No | App Functionality |
| Contact Info → Phone Number | Yes, optional phone sign-in or uploaded nearby contact | Yes | No | App Functionality |
| User Content → Emails or Text Messages | Yes (private family messages) | Yes | No | App Functionality |
| User Content → Photos or Videos | Yes (photos only) | Yes | No | App Functionality |
| User Content → Audio Data | Yes | Yes | No | App Functionality |
| User Content → Other User Content | Yes (other submitted questions, options and family content) | Yes | No | App Functionality |
| Identifiers → User ID | Yes | Yes | No | App Functionality |
| Identifiers → Device ID | Yes (Expo update installation identifier; push id/token when enabled) | Yes, conservatively | No | App Functionality |
| Usage Data → Product Interaction | Yes (content-free events) | Yes | No | App Functionality, Analytics |
| Health & Fitness | No (see the decision below) | — | — | — |
| Location, Contacts, Browsing History, Search History, Purchases, Financial Info, Sensitive Info, Diagnostics | No | — | — | — |

**Tracking:** No. The app does not link its data with other companies' data for advertising, and has no advertising SDK. So no App Tracking Transparency prompt is needed.

**Decision for the founder and counsel:**
- **Health.** The current manifest does not declare a dedicated health input in the organiser app. Apple's [free-form-content guidance](https://developer.apple.com/app-store/app-privacy-details/) distinguishes generic messages/audio from specifically requested health data. This is the basis for the current app classification, rather than an assertion that messenger origin alone exempts health processing. Counsel must reconcile the separately consented server health understanding with the exact shipped flows before submission; if Health is required, add it to both this table and the manifest.
- **Diagnostics.** When crash reporting is added (step 5.3), add Diagnostics → Crash Data, Not linked, App Functionality, and update this file the same day.

**Other App Review items this answers:**
- **Account deletion (5.1.1(v)):** You → Delete account, in the app (ADR-43, PR #38).
- **Sign in with Apple (4.8):** not required, because Vela offers no third-party or social sign-in, only an email code.
- **Privacy policy URL:** `https://vela.vela-light.workers.dev/privacy`. It must answer 200 publicly on production first.
- **Encryption export:** `ITSAppUsesNonExemptEncryption` is false in `app.json`. The native app uses HTTPS plus OS-provided SecureStore for session credentials, draft text and optional calling numbers. Complete Apple's encryption questionnaire against the final archive; the older statement that the app uses only HTTPS was incomplete.
- **Age rating:** no objectionable content, and the user-generated content stays private within a family. Expected 4+. Answer "No" to unrestricted web access and to public user-generated content.

## Google Play: Data safety

| Section | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all collected data encrypted in transit? | Yes (every build profile in `apps/app/eas.json` points the app at an https API) |
| Do you provide a way for users to request that their data is deleted? | Yes: in the app (You → Delete account), and by email to the support address |
| Data shared with third parties | None. Processors acting for Vela (Cloudflare, Neon, Clerk, OpenAI, Deepgram, Expo) count as service providers, not sharing. |

| Play data type | Collected | Optional? | Purpose |
|---|---|---|---|
| Personal info → Name | Yes | Required | App functionality, Account management |
| Personal info → Email address | Yes | Required | App functionality, Account management |
| Personal info → User IDs | Yes | Required | App functionality, Account management |
| Personal info → Phone number | Yes (optional phone sign-in or uploaded nearby contact) | Optional | App functionality |
| Photos and videos → Photos | Yes | Optional | App functionality |
| Audio → Voice or sound recordings | Yes | Optional | App functionality |
| Messages → Other in-app messages | Yes | Required | App functionality |
| App activity → App interactions | Yes | Required | App functionality, Analytics |
| Device or other IDs | Yes (Expo update installation identifier, plus push installation id/token when enabled) | Update identifier required; push optional | App functionality |
| Health and fitness | No (same decision as Apple's) | — | — |
| Location, Financial info, Contacts, Calendar, Web browsing, App info and performance | No | — | — |

## Found while preparing this

- `infra/sub-processors.md` still lists Clerk under "planned (Sprint 3)", though the app signs in through it and notice v3 names it. Move it to "In use" with its DPA date when counsel reviews (gate 12).
- Sentry is listed as a processor "not connected to the Workers yet". Either connect it (step 5.3) or move it to planned, so the list matches what runs.
