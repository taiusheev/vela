# Analytics implementation receipt

Candidate base: b855bc1. Scope: manually allowlisted, opt-in usage counts v1; all real configuration remains absent.

Verification on 22 October 2026:
- pnpm check PASS, 9/9 tasks. Final run: 8 valid cached tasks; Worker reran 1297 tests across 36 files. Earlier combined gate reran app: 471 passed, 1 existing skip.
- New Worker tests cover default-off configuration, no outbound request when disabled, strict payload rejection, foreign/missing Origin, 1024-byte bound and downstream failure.
- New app tests cover no send before choice, permitted payload, withdrawal abort, obsolete identity rejection, demo/config suppression, route whitelist and duration bounds.
- Local website at localhost:8796, synthetic PostHog token: consent visible with region; decline/reload persisted; reopen/allow showed random ID; withdraw/reload persisted.
- Local app web at localhost:8096, synthetic key/API, no Clerk account/family data: consent visible; decline/reload persisted; reopen/allow completed; displayed random ID; withdraw/reload persisted.
- Same-origin website CSP remains unchanged. No SDK, new native dependency, replay or automatic capture.
- No PostHog account/project exists yet. Vendor ingestion/dashboards NOT verified. No real keys, family traffic or payments used.
- Native secure storage, foreground/background behavior and iPhone UI NOT device-verified.
- Website Chinese notice is a draft; app notice uses isolated English catalog for current English cohort.
- Source proposed only. No merge, production deploy, app update or runtime analytics activation.

Remaining: founder creates a no-card EU free project, engineering connects public token and prepares dashboard insights, synthetic actual-ingestion proof, reviewed notice/config activation and native release verification. Live website routing belongs to separate PR152 and still needs proxy evidence.

