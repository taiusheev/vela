# Vela Light: English TestFlight review packet

Prepared 5 October 2026. Copy the public fields below only after the production URL and signed build have passed the release gates. This packet is prepared text, not evidence of Apple enrollment, submission or review approval. The active checklist is [English trial readiness](../../english-trial-readiness.md).

## Reviewer access repair — 2 November 2026

The original English/Telegram packet below is historical preparation, not a current Taiwan submission. App Store Connect was checked on 2 November: production-target build 38 and staging-target build 40 are both Ready to Submit. Build 38 has only Team (Expo), the internal group. The beta review form has a username/password pair, blank review notes, and a homepage in its privacy-policy field. Do not copy those credentials into this document or submit either existing build expecting a password screen: neither contains one.

The app now offers **Use a password instead** beneath the normal email-code action. It asks for an email and an existing password, calls Clerk's standard password authentication, and opens the app only after Clerk completes and activates the session. It does not create accounts, install a special review code, or bypass verification. An unfinished challenge offers the email-code route. Families can continue using the existing code flow.

### Account-owner setup

1. Confirm the live Clerk instance's domain matches the production app's Clerk issuer. Use a dedicated reviewer identity with an inbox the founder controls, separate from every real family and founder account. Do not use Clerk Test mode in production.
2. Keep **Sign-up with password** off: making passwords required would break the existing code-only registration flow. In **User & authentication → Password**, enable only **Add password to account**, if required for assigning the review identity's password. Keep email sign-up and email verification codes enabled. Inspect the resulting policy before saving; do not disable other protections to make a test pass.
3. The founder enters a unique password privately in Clerk, at least its configured 15-character minimum, and stores it in their password manager. Never put it in chat, source, a screenshot, terminal output, an issue, or this packet. Check that the dedicated user has no second factor requiring founder intervention. Enabling optional passwords revealed that Device Trust is enabled: its earlier disabled label reflected passwords being off. Keep Device Trust on globally. The dedicated user's **Settings → Bypass Device Trust** is the narrow exception that can allow independent password sign-in, and needs explicit founder approval before changing it. Do not confuse this exception with disabling global protections.
4. Founder-approved synthetic family: **Apple Review**, organiser **Demo Organiser**, parent **Demo Parent**, locale **English**, timezone **Asia/Taipei**. Approval for these fictional identities was received on 2 November; optional passwords were saved and a separate reviewer Clerk identity was created without a password. Family provisioning and owner password entry remain pending. No real relative, photo, phone number, LINE identity or Telegram identity may be attached. Provision through the normal admission/setup path; use only explicitly approved synthetic content. Confirm the reviewer sees this family and cannot see any real family. An empty account or a pending parent invitation is not evidence that the full review journey works.
5. Deliver this authentication change in a new native production-target build through the normal checked release path. It is a new sign-in capability, not an OTA bug fix. Do not select staging build 40 as the Taiwan families' production app. Record the actual new build number, source, API target and runtime after completion.
6. From a fresh session on that exact installed build, verify: correct password succeeds without founder inbox access; incorrect password stays signed out; normal email-code sign-in still succeeds; the approved synthetic family, available content and deletion/help paths work. Check the parent exchange independently if review notes promise it. A development browser or helper unit test does not satisfy this gate.
7. In **TestFlight → Test Information**, replace the stale username with the tested review email. The founder enters the password directly in Apple's private Password field. Replace the privacy URL with the verified public privacy page. Use the verified notes below, filling their private synthetic route only after that route works. Save the form, add the verified production build to Trial Families without inviting anyone, and leave **Submit for Review** to the founder.

### Private review-note draft

Use this only after the access and synthetic-family checks above pass. Do not paste unverified instructions into Apple's live form.

> Vela Light is the adult organiser's app for a daily family exchange. On the sign-in screen, choose “Use a password instead.” Enter the email and password supplied in the private Sign-In Information fields. This dedicated account opens the Apple Review family; its people and content are fictional. No access to the account's inbox or a real participant is needed for sign-in.
>
> Start on Today, open an available exchange, and inspect its question, answer and replies. Open Questions to prepare a question. You and Settings contain the account controls and Help. The app is not an emergency service or medical monitor. The invited parent normally uses LINE or Telegram; any parent-channel review instructions must describe the separately verified synthetic route supplied here.

Before saving, replace the final parent-channel sentence with exact verified instructions and remove any action not supported by the prepared family. Do not describe untested content, delivery or account deletion as checked. Keep external invitations and final review submission separate from upload/internal testing.

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
