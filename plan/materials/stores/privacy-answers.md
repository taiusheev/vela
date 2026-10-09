# App privacy answers: App Store and Google Play

Prepared 8 October 2026 (technical plan step 5.7) from the code as built, for the founder to enter in App Store Connect and the Play Console. Every answer names the code it rests on. Re-check this file whenever the app gains an SDK, a permission or a new kind of upload. Counsel's review of the privacy notice (launch gate 12) covers these answers too.

**Scope.** These answers describe the organiser app, Vela Light (`family.vela.light`). The parent does not use the app: her answers come through Telegram or LINE and are covered by the privacy notice, not by the store label. The app shows her words to her family, but it does not collect them from her.

## What the app sends to Vela, and why

| Data | When | Where in the code | Stored | Linked to the person |
|---|---|---|---|---|
| Email address | Sign-in (Clerk, email code) | `apps/app/src/auth/clerk.tsx` | Clerk | Yes |
| Display name | Profile, family member name | `PATCH /v1/me`, `POST /v1/me/provision` | Vela database | Yes |
| Account id | Every API call (Clerk subject) | `apps/worker/src/session.ts` | Vela database | Yes |
| Asks and replies (text) | When they write them | `POST /v1/families/:id/exchanges`, `POST /v1/exchanges/:id/replies` | Vela database, sealed (ADR-38) | Yes |
| Photos they choose | Ask or reply with a photo | `POST /v1/families/:id/media` | R2, deleted after 30 days unless kept by the family | Yes |
| Voice messages they record | Voice reply or voice hello | `POST /v1/families/:id/voice` | R2, deleted after 30 days; transcribed by Deepgram | Yes |
| Nearby contact name and phone | Only if an organiser adds one (off in the English trial) | `POST /v1/families/:id/members/:mid/nearby` | Vela database, 14 days unless they say yes | Yes (the organiser's family) |
| App update checks (Expo, `expo-updates`) | Each launch | `apps/app/app.json` `updates` | Expo, request logs only | No (a random install id, not the account) |
| Push installation id and Expo push token | When notifications are allowed (push is off until step 5.4) | `apps/app/src/push/device.ts`, `POST /v1/me/devices` | Vela database until sign-out | Yes |
| What they did in the app (sent a reply, opened a weekly read) | As events, no content | `events` table, `surface: "app"` | Vela database | Yes |

**Not collected:** location, contacts from the phone's address book, browsing history, purchases (no billing yet), advertising identifiers, crash or performance data (no crash SDK yet, step 5.3), and health data entered in the app. A calling number saved on the phone stays on the phone, in the app's private storage (`apps/app/src/storage/`) and is never sent. No data is used for tracking or advertising, and no data is sold.

## App Store Connect: App Privacy

**Do you or your third-party partners collect data from this app?** Yes.

| Apple data type | Collected | Linked to user | Used for tracking | Purposes |
|---|---|---|---|---|
| Contact Info → Name | Yes | Yes | No | App Functionality |
| Contact Info → Email Address | Yes | Yes | No | App Functionality |
| Contact Info → Phone Number | Yes, only when a nearby contact is added | Yes | No | App Functionality |
| User Content → Photos or Videos | Yes (photos only) | Yes | No | App Functionality |
| User Content → Audio Data | Yes | Yes | No | App Functionality |
| User Content → Other User Content | Yes (asks and replies) | Yes | No | App Functionality |
| Identifiers → User ID | Yes | Yes | No | App Functionality |
| Identifiers → Device ID | Yes, once push is on (installation id and push token) | Yes | No | App Functionality |
| Usage Data → Product Interaction | Yes (content-free events) | Yes | No | App Functionality, Analytics |
| Health & Fitness | No (see the decision below) | — | — | — |
| Location, Contacts, Browsing History, Search History, Purchases, Financial Info, Sensitive Info, Diagnostics | No | — | — | — |

**Tracking:** No. The app does not link its data with other companies' data for advertising, and has no advertising SDK. So no App Tracking Transparency prompt is needed.

**Decision for the founder and counsel:**
- **Health.** Vela can understand health words in the parent's answers, with her separate consent. Those answers arrive by Telegram or LINE, not from the app, so we answer No to Health & Fitness. If counsel prefers the cautious answer, choose Health & Fitness → Health, Linked, App Functionality. Over-declaring does not risk rejection, but under-declaring does.
- **Diagnostics.** When crash reporting is added (step 5.3), add Diagnostics → Crash Data, Not linked, App Functionality, and update this file the same day.

**Other App Review items this answers:**
- **Account deletion (5.1.1(v)):** You → Delete account, in the app (ADR-43, PR #38).
- **Sign in with Apple (4.8):** not required, because Vela offers no third-party or social sign-in, only an email code.
- **Privacy policy URL:** `https://<production host>/privacy`. It must answer 200 publicly on production first.
- **Encryption export:** `ITSAppUsesNonExemptEncryption` is false in `app.json`, because the app uses only standard HTTPS.
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
| Personal info → Phone number | Yes (a nearby contact's) | Optional | App functionality |
| Photos and videos → Photos | Yes | Optional | App functionality |
| Audio → Voice or sound recordings | Yes | Optional | App functionality |
| Messages → Other in-app messages | Yes | Required | App functionality |
| App activity → App interactions | Yes | Required | App functionality, Analytics |
| Device or other IDs | Yes (push installation id, token) | Optional | App functionality |
| Health and fitness | No (same decision as Apple's) | — | — |
| Location, Financial info, Contacts, Calendar, Web browsing, App info and performance | No | — | — |

## Found while preparing this

- `infra/sub-processors.md` still lists Clerk under "planned (Sprint 3)", though the app signs in through it and notice v3 names it. Move it to "In use" with its DPA date when counsel reviews (gate 12).
- Sentry is listed as a processor "not connected to the Workers yet". Either connect it (step 5.3) or move it to planned, so the list matches what runs.
