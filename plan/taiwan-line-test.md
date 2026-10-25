# Ten Taiwan families on LINE, in Chinese: the plan

Written 25 October 2026. Founder decisions that day: test with about 10 families before any public launch; the families are in Taiwan, the parents on LINE, in Traditional Chinese; payments come later (draft PR #196 waits); the founder accepts the legal risk of starting before counsel's review, as for the Vietnam week, with counsel reviewing in parallel.

## Where things stand

- **Production is a closed English pilot.** `PILOT_ADMISSION=on` admits only Telegram ids on the roster (ADR-42, ADR-45), and every admission check requires `language = 'en'` and a Telegram link (`packages/services/src/pilot-admission.ts`). Capabilities answer `pilot`, `telegram_first` and `english_only`; billing is off, the weekly read is free (`pilotFree`), and the app shows "The pilot is free" with no prices.
- **LINE is built but off.** Steps 1 to 7 of `architecture/05-line-flows.md` §8 are done: the adapter, services by messenger, the Worker's webhook and inbound queue, and the quota in admin. One LINE parent got her morning on staging on 7 October; the group loop with human replies was never run (step 8). Production has `LINE_CHANNEL=off`, pinned by `wrangler-config.test.ts`.
- **The notice says no.** `privacy-notice.v6` says the trial "operates entirely in English" and that "LINE and multilingual translation are outside this trial". `privacy-notice.zh-TW.md` currently holds the English v6 text, and `consent-script.zh-TW.md` is still v1.
- **The iPhone app is locked to English** in the `trial` profile (`EXPO_PUBLIC_TRIAL_ENGLISH=true`, `src/api/trial.ts`).

## The work, in order

| # | What | Who | Size |
|---|---|---|---|
| 1 | **Admission by approved family** (ADR-52, below): the founder approves a family on the admin page, and everyone who joins it by its invite takes part, on Telegram or LINE, in English or Chinese. The Telegram roster keeps working for the Vietnam family. | Claude | 2–3 days |
| 2 | **Notice v10 and consent script v5**, English and Traditional Chinese: LINE (LY Corporation) as the messenger, Chinese allowed, translation between family members. | Claude drafts; founder approves; native reader checks the Chinese | 1 day + review |
| 3 | **LINE on staging, full loop** (05 §8 step 8): the founder's phone as the parent, a test group with two adults, a morning, an answer, a reply, a quiet notice. | Founder's phone, Claude watches | 1 morning |
| 4 | **The app for Chinese testers**: a `taiwan-test` build profile, production target, no English lock; pilot screens in Chinese; "Connect your family" offers LINE. Rides the 1 November build. | Claude | 1 day |
| 5 | **Production LINE account**: a "Vela Light" provider and Messaging API channel in LINE Developers, its secret and token put through a launcher (nobody sees them), the 中用量 plan bought. | Founder | 30 minutes + purchase |
| 6 | **Production on**: `LINE_CHANNEL=on`, the inbound queue, the bot's basic id, the pinning test changed in the same commit; release by tag with the founder's yes. | Claude, founder's yes | half a day |
| 7 | **Invite kit**: a message in Chinese to each organiser, the TestFlight invite, what to expect in week 1, how to reach the founder. | Claude | half a day |

Earliest first family: about **4 November**, if the founder's steps 2, 3 and 5 land by 1 November.

## ADR-52: the closed test admits approved families

Accepted and built on `feat/testing-families` (see `architecture/decisions.md`). The founder approves a whole family on `/admin/roster`; `PILOT_FAMILY_APPROVAL` and `PILOT_LANGUAGES` stay `off` and `en` in production until notice v10 is live.

Still open from step 4: linking the iPhone app to a LINE identity (today the app links Telegram only, `telegram_first`).

## Costs

- LINE: the free 輕用量 (200 messages a month) cannot carry one real family. 中用量 is about NT$800 a month; at three adults a family uses about NT$91 a month of it (05 §7), so 10 families may need 高用量 later. The founder's explicit yes before each purchase (D10).
- OpenAI: about the same per family as the Vietnam week.

## Not in this plan

Payments (PR #196), the App Store listing, the parent app, memories and the family book stay as they are.
