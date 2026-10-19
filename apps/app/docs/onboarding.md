# See It First and privacy testing release

19 October 2026. Integrates the founder-approved See It First implementation prepared by Claude in `vela-onboarding`, copied into this separate branch with the founder’s explicit takeover approval. The original checkout is preserved.

Newcomers see four illustrated scenes, answer the setup questions and see a first-week preview before making an account. The versioned privacy screen names the controller and AI recipients and offers Agree and continue or Not now before sign-in/saving. The active English trial still links an already approved Telegram family, rather than opening public app-created families. Its preview explains that the local answers do not replace the family’s current settings. Existing signed-in testers can open You → Settings → Preview family setup and return to Today without duplicating a family.

The organiser’s app permission is validated and fingerprinted server-side when provisioning, with its own timestamp. GET /v1/me exposes only whether the current app text was accepted. A new app user cannot consent for a parent or override the separate health choice. Older trial clients remain compatible; this is not public-admission or global legal clearance.

Setup drafts live only in memory, bind to the intended sign-in when saving and clear on account switches/sign-out. Local portrait previews have replacement/reset cleanup and a dedicated cache directory swept on process startup; signed-in installed portraits retain their existing account isolation. Token/request scope prevents an old session from installing data in another account.

Migrations 0017 (member setup answers) and 0018 (account app-permission evidence) must deploy before the app. No new native permissions/modules, billing, public registration, parent-device activation or provider switch.

Validation: local root check all nine packages; 347 app tests with one existing opt-in skip, 1,561 services tests, 1,222 Worker tests. Complete demo wizard/privacy/completion browser walkthrough plus six narrow light/dark layouts; separate Maestro introduction smoke. Native source doctor retains 10 collected-data and four required-reason categories; a source doctor is not an archive, signed-device or provider test. TestFlight submission waits for final CI, staging/production guards and archive inspection.
