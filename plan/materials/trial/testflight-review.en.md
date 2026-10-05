# Vela Light: English TestFlight review packet

Prepared 5 October 2026. Copy the public fields below only after the production URL and signed build have passed the release gates. This packet is prepared text, not evidence of Apple enrollment, submission or review approval. The active checklist is [English trial readiness](../../english-trial-readiness.md).

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
