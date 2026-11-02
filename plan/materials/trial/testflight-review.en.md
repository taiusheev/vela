# Vela Light: English TestFlight review packet

Prepared 5 October 2026. Copy the public fields below only after the production URL and signed build have passed the release gates. This packet is prepared text, not evidence of Apple enrollment, submission or review approval. The active checklist is [English trial readiness](../../english-trial-readiness.md).

## Reviewer access repair — 2 November 2026

The original English/Telegram packet below is historical preparation, not a current Taiwan submission. App Store Connect was checked on 2 November: production-target build 38 and staging-target build 40 are both Ready to Submit. Build 38 has only Team (Expo), the internal group. The beta review form has a username/password pair, blank review notes, and a homepage in its privacy-policy field. Do not copy those credentials into this document or submit either existing build expecting a password screen: neither contains one.

The main app now detects the sign-in methods Clerk permits for the entered account (merged change #242). Enter the reviewer email and press **Send me a code**; an account with a password then sees **Enter your password**. The label of the first button has not changed, but no email code is required for this dedicated password account. Other accounts retain email codes and code-only registration. Clerk verifies the password; an unfinished challenge stays signed out. This packet's earlier alternate-button prototype is superseded, and this PR preserves main's app source.

### Account-owner setup

1. Confirm the live Clerk instance's domain matches the production app's Clerk issuer. Use a dedicated reviewer identity with an inbox the founder controls, separate from every real family and founder account. Do not use Clerk Test mode in production.
2. Keep **Sign-up with password** off: making passwords required would break the existing code-only registration flow. In **User & authentication → Password**, enable only **Add password to account**, if required for assigning the review identity's password. Keep email sign-up and email verification codes enabled. Inspect the resulting policy before saving; do not disable other protections to make a test pass.
3. The founder enters a unique password privately in Clerk, at least its configured 15-character minimum, and stores it in their password manager. Never put it in chat, source, a screenshot, terminal output, an issue, or this packet. Check that the dedicated user has no second factor requiring founder intervention. Enabling optional passwords revealed that Device Trust is enabled: its earlier disabled label reflected passwords being off. Keep Device Trust on globally. The dedicated user's **Settings → Bypass Device Trust** is the narrow exception that can allow independent password sign-in, and needs explicit founder approval before changing it. The founder approved this exception and saved the password privately on 2 November; the account-specific exception is now saved. Global Device Trust remains on.
4. Founder-approved synthetic family: **Apple Review**, organiser **Demo Organiser**, parent **Demo Parent**, locale **English**, timezone **Asia/Taipei**. Approval for these fictional identities was received on 2 November; optional passwords and a separate reviewer Clerk identity are prepared, and the owner has saved its password privately. Family provisioning remains pending. No real relative, photo, phone number, LINE identity or Telegram identity is attached by setup. The private helper below inserts only this fixed fictional family and its labelled sample content, with Demo Parent invited, light off, no consent and no scheduled wake. A reviewer may later choose the normal LINE invitation flow using their own test account; the setup never impersonates a parent or assumes consent. Confirm the reviewer sees this family and cannot see any real family. An empty account or a pending parent invitation is not evidence that the full review journey works.
5. Deliver this authentication change in a new native production-target build through the normal checked release path. It is a new sign-in capability, not an OTA bug fix. Do not select staging build 40 as the Taiwan families' production app. The earlier build 41 (`3e59a3b0-f130-4ffe-9fd8-bff4f3099ed8`, source `76e8849`) was uploaded internally but uses the superseded alternate-button prototype. Do not select it for the final external review. Build and verify a replacement whose app source matches merged #242; record its actual number, source, production API/auth target and runtime in the release receipt.
6. From a fresh session on that exact installed build, verify: correct password succeeds without founder inbox access; incorrect password stays signed out; normal email-code sign-in still succeeds; the approved synthetic family, available content and deletion/help paths work. Check the parent exchange independently if review notes promise it. A development browser or helper unit test does not satisfy this gate.
7. In **TestFlight → Test Information**, replace the stale username with the tested review email. The founder enters the password directly in Apple's private Password field. Replace the privacy URL with the verified public privacy page. Use the verified notes below, filling their private synthetic route only after that route works. Save the form, add the verified production build to Trial Families without inviting anyone, and leave **Submit for Review** to the founder.

### Private fictional-family helper

Engineering prepares `apps/worker/scripts/seed-reviewer-family.ts --production` in a private owner terminal. The founder supplies the verified Neon production **direct** connection and the saved production `CONTENT_KEY_V1` through hidden TTY prompts. No credentials are accepted from arguments, env files or chat, printed, or saved. Cancel with Ctrl+C before supplying them if either saved value is unavailable; do not guess a content key.

The helper validates the direct production host through the existing mutation-target guard. It accepts only the dedicated synthetic Clerk subject already created for this task, and refuses an identity attached to another family. It uses the ordinary account write lock and a fixed idempotency receipt; a retry does not overwrite messages or recreate the family. It writes one audited family approval, one fictional organiser, one invited fictional parent and one labelled sample exchange. The sample question, answer and reply use the production encryption codec and normal retention. Their timestamps are fictional UI examples, not proof of messenger delivery. No consent, real channel, invitation, contact, queue job, scheduler wake or real delivery metric event is inserted.

Tests check the app's normal read services can open the sample and reject another account. They also check the normal LINE invitation and pending-first-question services, with no delivery before the parent's own consent. The helper also works before the optional weekly-feedback migration; it does not require an unrelated production upgrade. A PostgreSQL race checks simultaneous retries and account-lock coordination, including an actor-lock removal negative control. These local checks do not verify a production key or native sign-in; read the actual prepared sample on the final native build before claiming readiness. The helper saves only a content-free receipt outside the repository.

### Private review-note draft

Use this only after the access and synthetic-family checks above pass. Do not paste unverified instructions into Apple's live form.

> Vela Light is the adult organiser's app for a daily family exchange. On the sign-in screen, enter the email from the private Sign-In Information fields and tap “Send me a code.” This account then shows “Enter your password”; enter the private review password and tap Continue. No email code is needed for this account. This dedicated account opens the Apple Review family; its people and content are fictional. No access to the account's inbox or a real participant is needed for sign-in.
>
> Open Memories to inspect the labelled fictional question and answer. Open Questions to prepare a first question; it waits for Demo Parent to agree. You and Settings contain account controls and Help. Vela is not an emergency service. No real parent or participant is connected to this account. To try the parent flow with your own LINE test account, open You → Demo Parent → Photo and parent link → Send their invitation, open that invitation in LINE and follow its consent steps. Opening an invitation does not give consent. The preloaded sample is fictional and is not evidence of LINE delivery.

Before saving, verify these paths on the final replacement build and remove any action not supported by the prepared family. The parent-route wording above is a source-checked draft until independently exercised; do not call it live-verified from service tests. Do not describe untested content, delivery or account deletion as checked. Keep external invitations and final review submission separate from upload/internal testing.

References: [Clerk password authentication](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up), [Clerk test-mode production warning](https://clerk.com/docs/guides/development/testing/test-emails-and-phones), [Apple TestFlight review requirements](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/).

## Beta app description

Vela Light helps a family exchange one daily question, an answer and personal replies. The organiser uses the iPhone app to write asks, see the family's answers and send replies. One invited adult receives the asks and answers in Telegram, using text, a photo or a voice message. A family light shows when an answer has arrived.

This is a free, invitation-only research trial in English. There are no payment details or subscriptions. All participants must be comfortable using English. The initial trial runs for seven days with one family, followed by 30 days with a small number of invited families.

The app is not an emergency service or medical monitor. Family members continue to use their normal ways of contacting one another.

## What to test

Sign in with the invited account and connect the existing Telegram family. Write an ask and check that it reaches the invited adult at their configured morning time. After they answer in Telegram, check the genuine answer and light in Today and Exchanges. Play a voice answer in the app and send a text, photo or voice reply. Check that the adult receives the replies with the next morning's arrival.

Please test a failed connection and retry, microphone or photo permission denial, larger text and VoiceOver. Report when a screen is unclear, an action fails, an answer is delayed or playback does not work. Include the app build number and approximate time; avoid sending private family words, photos, voice recordings or health details in feedback.

## Review notes

Vela Light is the organiser's iPhone app. The adult receiving the daily ask uses Telegram, rather than a parent app. Setup is Telegram-first so the app opens the existing family. App-first family creation is unavailable in this trial. The build is English-only and iPhone-only.

The reviewer must have a dedicated, founder-approved synthetic account and family. Provide working sign-in details through App Store Connect's private review fields, never in this file or a public description. Confirm those details on the exact submitted build before submission. The reviewer must be able to finish the flow without contacting a real participant or accessing any real family's content.

For account linking, open **Connect your Telegram family**, follow the private Telegram challenge and enter its proof code in the app before it expires. Provision and verify the synthetic review identity in the private admission roster in advance. Never publish a proof code or reuse an expired challenge as reviewer credentials.

The complete scheduled exchange requires the synthetic parent to use Telegram, consent and answer. In the private review notes, supply the tested bot username, scheduled arrival time and timezone, and explain how the reviewer can use the synthetic parent route. Verify the organiser notification route and synthetic consent before relying on that route. Do not claim that an unsent demo represents Telegram delivery. If the reviewer cannot independently complete the tested route, resolve reviewer access before submitting.

Voice notes from Telegram are downloaded through the authenticated family API. Ogg/Opus is decoded locally by the bundled native module. Microphone access is requested when the user chooses to record a voice message; photo access is used for the images they choose for an ask or reply. Denying either permission must leave text actions usable. Family media is private and retained under the published privacy notice.

Weekly reads remain available throughout the free pilot. Language selection, translation promises, payments, memory automation, book export and parent app screens are outside this trial.

## Fields to complete privately before submission

| App Store Connect field or release evidence | Prepared value or required verification |
|---|---|
| App name | Vela Light |
| Bundle identifier | `family.vela.light` |
| Beta description | Text above |
| What to test | Text above |
| Feedback/contact email | `t.aiusheev@gmail.com`; confirm monitored |
| Privacy policy URL | `https://vela.vela-light.workers.dev/privacy`; require public 200 on production |
| Support contact | The monitored email above; confirm the app's support action works |
| Review contact name and phone | Founder enters actual details privately |
| Sign-in required / reviewer credentials | Founder provides the tested synthetic sign-in privately |
| Telegram reviewer route | Verified test bot, approved synthetic identities, arrival time/timezone and private review instructions |
| Build identity | Completed EAS ID, TestFlight version/build and embedded `releaseCommit` matching tested source |
| Beta review status | Actual App Store Connect status; external review approval required before inviting external testers |
| Distribution | Invitation-only approved tester group; no public recruitment link |

Use the reviewer family only for synthetic content. Keep account deletion, roster removal and media cleanup in the normal tested lifecycle. This packet does not grant participant approval or change consent, retention, eligibility or production deployment requirements.
