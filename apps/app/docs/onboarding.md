# See It First and privacy testing release

19 October 2026. Integrates the founder-approved See It First implementation prepared by Claude in `vela-onboarding`, copied into this separate branch with the founder’s explicit takeover approval. The original checkout is preserved.

Newcomers see four illustrated scenes, answer the setup questions and see a first-week preview before making an account. The versioned privacy screen names the controller and AI recipients and offers Agree and continue or Not now before sign-in/saving. The active English trial still links an already approved Telegram family, rather than opening public app-created families. Its preview explains that the local answers do not replace the family’s current settings. Existing signed-in testers can open You → Settings → Preview family setup and return to Today without duplicating a family.

The organiser’s app permission is validated and fingerprinted server-side when provisioning, with its own timestamp. GET /v1/me exposes only whether the current app text was accepted. A new app user cannot consent for a parent or override the separate health choice. Older trial clients remain compatible; this is not public-admission or global legal clearance.

Setup drafts live only in memory, bind to the intended sign-in when saving and clear on account switches/sign-out. Local portrait previews have replacement/reset cleanup and a dedicated cache directory swept on process startup; signed-in installed portraits retain their existing account isolation. Token/request scope prevents an old session from installing data in another account.

Migrations 0017 (member setup answers) and 0018 (account app-permission evidence) must deploy before the app. No new native permissions/modules, billing, public registration, parent-device activation or provider switch.

Validation: local root check all nine packages; 347 app tests with one existing opt-in skip, 1,561 services tests, 1,222 Worker tests. Complete demo wizard/privacy/completion browser walkthrough plus six narrow light/dark layouts; separate Maestro introduction smoke. Native source doctor retains 10 collected-data and four required-reason categories; a source doctor is not an archive, signed-device or provider test. TestFlight submission waits for final CI, staging/production guards and archive inspection.

## First-question UX refinement — 31 October 2026

Keep the first real question in the existing setup rather than add a mandatory personalization
questionnaire. The first-question editor now has a clear label, the app's writing typeface and an
optional idea picker. Its delivery preview appears when the organiser has entered or chosen actual
words; the previous empty-message placeholder is removed. The first-question contract, ten-question
setup sequence, account/privacy gates and first-week construction are unchanged. Detailed voice
examples and boundaries are contextual options in the separate reviewed-draft flow, not newly
collected during onboarding. This is a scoped UI improvement; it does not claim a shorter total
onboarding or measured conversion improvement.

## Onboarding v2, "One road" — 5 November 2026

The founder chose the Figma design "Onboarding v2 · One road" (Vela · Design, App page). One welcome
replaces the four story scenes: her house at dusk, a lamp coming on in her window like a real bulb,
then the words. It plays once (about three seconds), then the light breathes; with Reduce Motion it
opens lit. The questions are seven light screens with her window's four panes as progress: who,
her mornings (place, language and wake time), where she chats, her world (topics and reply ways),
"How do you and Mom talk?" (only where the server says `talk_setup`), the first question with quiet
mornings, and around her (nearby and photo). Then her first week, then one save screen where the
privacy agreement sits beside the email, the email code, the invitation, and the ready window, which
asks for notifications ("Tell me when Mom says yes").

In the closed test, families set up in the app wait for the founder's approval (`PILOT_APP_SETUP`,
ADR-52 amended). The invitation step then shows "We're checking your family" and opens the
invitation by itself once approved. The setup writes still save while the family waits.

"How do you and Mom talk?" keeps how often they talk and what Vela must never bring up. Code alone
keeps those topics out of her first week, the daily bank pick and anything drafted in the
organiser's name; the topics are never sent to an AI. It is behind `TALK_SETUP`, off in production
until privacy-notice v16 (`plan/materials/pilot/privacy-notice.v16-talk-setup-draft.md`) is approved.
