# Analytics implementation receipt

Candidate base: b855bc1. Scope: manually allowlisted, opt-in usage counts v1. Public EU project configuration is recorded in infra/analytics-project.json; runtime collection remains off.

Verification on 22 October 2026:
- pnpm check PASS, 9/9 tasks. Final run: 8 valid cached tasks; Worker reran 1297 tests across 36 files. Earlier combined gate reran app: 471 passed, 1 existing skip.
- New Worker tests cover default-off configuration, no outbound request when disabled, strict payload rejection, foreign/missing Origin, 1024-byte bound and downstream failure.
- New app tests cover no send before choice, permitted payload, withdrawal abort, obsolete identity rejection, demo/config suppression, route whitelist and duration bounds.
- Local website at localhost:8796, synthetic PostHog token: consent visible with region; decline/reload persisted; reopen/allow showed random ID; withdraw/reload persisted.
- Local app web at localhost:8096, synthetic key/API, no Clerk account/family data: consent visible; decline/reload persisted; reopen/allow completed; displayed random ID; withdraw/reload persisted.
- Same-origin website CSP remains unchanged. No SDK, new native dependency, replay or automatic capture.
- Founder created EU PostHog project 315862. Only its public capture token is stored; no personal API key or password was requested.
- Actual vendor ingestion verified: all 8 website event types passed through the local Worker relay with HTTP 204. The real app client sent its 3 allowed event types with HTTP 200. PostHog Activity displayed all 17 synthetic events (8 website plus 3 app batches). Website events were environment=development, app events environment=staging; no family data, real signup or payment was used.
- Created and opened dashboard https://eu.posthog.com/project/315862/dashboard/1045170 with 10 saved charts. Queries filter environment=production and exclude these synthetic events. Production charts correctly contain no data before activation. Test queries showed 1 synthetic website visitor and 15 observed seconds; those are not customer metrics.
- Dashboard covers consented website audience/source/sections/time/waitlist response funnel and app active devices/screen visits/foreground time/return use. Unique saved emails, authoritative activation, Apple downloads and sales are not inferred from these events.
- Existing project settings reported session recording disabled and anonymize_ips enabled. Billing/card status and at-most-one-year retention still need verification before activation.
- Native secure storage, foreground/background behavior and iPhone UI NOT device-verified.
- Website Chinese notice is a draft; app notice uses isolated English catalog for current English cohort.
- Source proposed only. No merge, production deploy, app update or runtime analytics activation.

Remaining: verify no-card free billing and retention, reviewed notice/config activation and native release verification. Live website routing belongs to separate PR152 and still needs proxy evidence. Current candidate edd2608 passed all GitHub source, PostgreSQL and app journey checks on push and PR; later integration changes need fresh checks.

