# English trial: synthetic staging acceptance script

This script tests the invitation-only, free English iPhone organiser and Telegram parent experience. Use synthetic content and the staging bot **@VelaLightstagingbot**. Record each result in [the active readiness checklist](english-trial-readiness.md); engineering owns running checks and collecting evidence. Completed account and provider setup is reused. Repeat a setup step only when its configuration changed or a specific check failed.

A web demo proves only its example interactions. Expo Go cannot load Vela’s native Telegram Ogg/Opus decoder. Voice acceptance requires a signed iPhone build containing that module. Parent app screens, tablets, kitchen-table mode, billing, memory automation and book export are outside this trial.

Build the synthetic iPhone with EAS profile `trial-staging`, or use `trial-simulator` for compiler/simulator checks. These profiles keep English and the trial’s hidden-feature rules fixed while targeting staging development authentication. The production profile `trial` requires production API/authentication and cannot use the staging exception. An old parent-device token/route must not reopen a parent screen in any trial organiser build. A simulator result is not signed-device playback proof.

## Record the run

| Field | Record |
|---|---|
| Source | Full tested commit SHA and its wholly green CI run |
| App | Signed iOS build ID/number and embedded `releaseCommit` |
| Backend | Staging Worker versions, capability response and migration revision |
| Devices | iPhone model/iOS version, Telegram devices, network and accessibility settings |
| Fixture | Approved synthetic family/account identifiers; never tokens, private phone numbers or real content |
| Operator | Date, verifier and evidence links |
| Outcome | Pass/fail/blocked for every numbered case, with exact counts and remaining defects |

Do not count skipped or blocked cases as passing. Keep failed deliveries and failed attempts visible. Engineering verifies trial capabilities before this run: `pilot`, `telegram_first` and `english_only` are true; `memory`, `book`, `parent_app` and `billing` are false. Use an approved synthetic Telegram roster, private media storage and the already configured account services. Live AI checks require the actual enabled provider; off/fake-provider tests are separate evidence.

## 1. Connect the existing Telegram family

1. Use the existing founder-approved synthetic organiser account. Resume interrupted Telegram onboarding if necessary. Set the organiser, parent and family group language to English; select Vietnam and **Asia/Ho_Chi_Minh** for the parent while the organiser is in Taiwan.
2. Verify a private organiser notification was actually delivered before activating the parent. A queued message or group message alone does not pass this check.
3. In the parent’s private Telegram chat, review the English consent text and the separate health-word choice. Run Yes and No as separate cases. No must not start the daily schedule; Yes must activate only after the organiser notification check succeeds.
4. Sign into the iPhone app with the approved organiser’s app account. With no connected membership, see **Connect your Telegram family**, with no app-first family-creation form.
5. Tap **Connect existing family**. Open Vela on Telegram using the identity that already belongs to that family. Tap Start, then paste the private connection code into the app and tap **Finish connecting**.
6. Confirm Today opens the existing family, with the organiser’s existing permissions and no duplicate family. Repeat for an approved contributor: they may ask and reply but cannot perform organiser-only actions.
7. Separately test a wrong code, wrong Telegram account, expired connection, replayed code and unapproved participant. They must not grant access. Create a new connection after expiry and verify it works. Closing Telegram or failing to open its link must leave a usable retry/link path.

Record proof-code outcomes without recording the codes themselves.

## 2. One complete scheduled exchange

1. In the app, write an English ask for the synthetic parent’s next morning. Check the date follows the parent’s Vietnam day. The ask remains as written; no translation preview or translation promise appears.
2. Let the scheduled arrival reach the parent’s Telegram chat. Verify exactly one arrival, the English buttons and the intended local time. Telegram accepting delivery does not prove the parent read or listened.
3. Answer with text in Telegram. With Today visible, verify genuine answer words and a lit light appear within the 30-second refresh interval. Leave and return to Today, then background/foreground the app and verify it refreshes.
4. Open Exchanges and the exchange directly. Check the original answer, parent-local answer/read-receipt times and photo-choice context. No fixture household may appear while loading or after a failed request.
5. Reply with text from the app and from an approved relative in the Telegram group. Verify both genuine replies appear in the app.
6. On the next scheduled morning, verify the parent receives those human replies as the read-back. Record arrival, answer, reply and read-back counts separately.
7. Repeat the loop with a two-photo ask and **photo 2**, a Telegram answer photo, a Telegram Ogg/Opus voice answer, and app/group voice/photo replies. Verify originals appear in Today and Exchanges and voice plays inside the signed iPhone app.
8. Test M4A/MP3 playback, unavailable/pending media, expired media, cancellation and a failed download. Neither credentials nor provider/storage URLs may be displayed to participants. Expired originals remain unavailable even when cleanup has not yet run.
9. Deliberately fail AI on synthetic content: the raw answer still lights the light. With the real provider enabled, separately verify English transcription, summary, flag wording and reviewed weekly reads.

## 3. Retry, authentication and account isolation

1. Interrupt the network during an ask/reply save. Show an actionable error and preserve unsent text. Retry unchanged content using the same mutation identifier; verify there is only one saved write. Repeated taps while saving must not create duplicates.
2. Interrupt a photo or voice upload. Show progress/failure, stop the request after its timeout, and retry the same selected attachment without creating duplicate media. Unsent recordings and photos are screen-local; do not promise they survive restarting the app.
3. Sign out during a pending read, write, local file read, photo upload and voice playback/download. Switch to a second synthetic account. The previous family, calling number, drafts, pending work and media must not appear or resume in the new account. A delayed successful response must not redirect or repopulate that account.
4. Expire authentication and test a refused membership. The app must show a recoverable failure without borrowing example content. Test an ordinary failed sign-out separately: the still-active identity can retry, but cancelled old requests do not resume.
5. Deny microphone/photo permission; retry after changing the permission. Cancel recording/sharing. Test interrupted onboarding and a failed Telegram prompt delivery, then resume without a duplicate family, invite or arrival.

## 4. Consent, quiet mornings and rights

Use only synthetic content for deliberately silent days, health words and flags.

1. Withdraw health-word permission while AI is processing and while a quoted notice is queued. Derived sensitive content must not be committed or delivered after withdrawal. Repeat Stop during processing. A message already accepted by Telegram is recorded separately.
2. Test consent No, health permission both ways, symmetry, Stop/Start, away/back, expired invites and failed delivery. Check all parent confirmations, buttons, notices and help are English. Removed participants must still be able to stop, withdraw permissions and request deletion.
3. Rehearse an unanswered scheduled morning. Verify the quiet notice reaches the verified organiser route at the intended parent-local time; a failed delivery or paused/away parent must not manufacture a quiet alert.
4. Test **She’s fine**, **Wait two hours**, later resolution and any consented nearby route actually enabled for the cohort. Failed quiet actions must show failure, and successful ones must show their real outcome.
5. Without a permitted saved calling number, Call is absent. With an optional, consented valid international number configured on the organiser’s device, Call has that destination. Sign-out removes it. Privacy, support and data-request links have usable destinations.
6. Request deletion during media ingestion and playback, then verify access is revoked and no newly written orphan is retained. Exercise delayed cleanup and expired reads. Use the engineering concurrency and deletion checks as supporting evidence, alongside the live result.
7. Delete a synthetic Clerk account through the configured provider. Verify the signed lifecycle delivery, denied API access and replay/link refusal. This account-access check is separate from family-content deletion.

## 5. Weekly read and iPhone usability

1. Open the weekly read throughout the free pilot, including after day 30 in synthetic time. It remains accessible without payment details. Check the week follows the parent’s timezone and unavailable AI is described honestly.
2. Verify unavailable parent-phone, language/translation, memory, billing and export features are hidden. Existing genuine story records may be readable; new long-term saving is not promised.
3. Run VoiceOver through sign-in, linking, Today, Exchanges, playback, ask/reply, quiet actions and help. Repeat with large text on the smallest supported iPhone. Controls must remain reachable, named and readable; errors must be perceivable.
4. Record a signed-device result for the native decoder, permission denial, app resume, poor network and account switching. Web checks or host C-decoder tests do not substitute for these cases.

## 6. Seven synthetic mornings and release evidence

Complete seven scheduled staging mornings and the exchange loop before real content. Record each ask’s origin (family-written/fallback), arrival attempts/successes, answers and latency, contentful answers, human replies, read-back delivery, quiet outcomes, stop reasons and assistance required. Deliberate silence and flags use synthetic content. Preserve exact per-family denominators.

Open **Trial counts** from the Access-protected founder family page. Check the seven/30-day report against the synthetic exchange register: Vietnam complete-date boundaries with a Taiwan organiser, multiple answers, retry attempts, failed/dropped/pending arrivals, a deleted asker, reactions and late next-morning read-backs. Failures must remain in the recorded-day counts. Reconcile unobserved days with consent/away/scheduling evidence before using the eligible-day denominator. Confirm the report includes no family words or media and warns when retained send metadata is incomplete. Contentful assessment and assistance/stop notes remain manual, authorised observations.

Engineering records the under-hour restore, production recovery rehearsal, external alert receipt, silence drills and continuous load result separately. Tie the final deployment and TestFlight build to the wholly tested source commit. The readiness checklist retains every remaining production, device, distribution, eligibility and actual Vietnam-network gate; this script does not approve activation by itself.

For a defect, record the numbered case, expected/observed outcome, commit/build, synthetic evidence and retry count. Engineering reproduces and fixes it. Cross-family disclosure, invented answers, ignored Stop, duplicate arrivals or Vela-caused false quiet notices pause expansion until corrected and reverified.
