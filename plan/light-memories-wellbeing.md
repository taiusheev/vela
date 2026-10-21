# Light memories and wellbeing delivery

Owner: engineering; product direction approved by founder on 21 October 2026.
Contract: product/06-light-memories-wellbeing.md. Deliver vertical slices with evidence; no estimates
of production capacity from a unit suite. Existing real-family and billing holds stay separate.

## 1. Source policy and product contract

Implemented in this change: six memory categories; source-revision/quote materialisation; rejection
of foreign, expired, deleted, corrected, pre-consent and sensitive sources; deterministic selection
key without content. Pure functions only: no storage, API, extraction, UI or runtime activation.
These functions consume trusted, already authorised inputs, not raw request bodies or model output.
Tests exercise boundaries with synthetic words. Source sensitivity is an upstream obligation, not
a claim that this module detects health language.

## 2. Persistent source-backed memory slice

Next: schema/contract/API/readable review UI together, behind a new RICH_MEMORIES switch off in all
environments until tests and notice text are ready. Do not reuse MEMORY (dated plans).

- Add sealed candidate metadata and explicit keep grants; reference original content and revision.
  No new permanent quote copy by default. Version content hashes without exposing them to logs.
- Index family/person/state/date/ID. Bounded extraction per source and idempotent unique source-span
  keys. Bounded cursor pagination; never fetch every family message to serve a collection page.
- Family-authorised reads; owner-authorised correction/removal; mutation idempotency and real
  PostgreSQL race tests for duplicate extraction, keep/remove and concurrent source deletion.
- New notice and consent version: categories, longer retention after explicit keeping, visibility,
  AI use, cancellation, export, withdrawal. Add messenger keep/remove before calling this complete.
- Update source deletion, membership withdrawal, account/family deletion, media cleanup and search
  removal in the same change. Test no surviving derived content and no re-extraction after dismissal.
- Reviewable collection/detail states: pending, saved, empty, loading, offline, retry, deleted source,
  cancelled subscription. Coordinate with active app owners before claiming UI and locales.

Done: an authorised synthetic member saves a quote, finds its source, corrects/removes it, and sees
the correct state after retry/reload/account change; another family sees nothing. Source deletion
and consent withdrawal win races. Browser, accessibility and signed-device evidence recorded apart.

## 3. Discovery and durable keeping

Process only eligible post-consent source versions. Reuse existing model ports/budgets and screening;
unknown sensitivity fails closed. Model output selects source spans and proposes metadata, never
grants consent. Validate output before storage. Jobs have bounded batches, deduplication, retry caps,
dead letters, privacy-safe metrics and backpressure. Candidate expiry follows source expiry.

Build evals for negation, sarcasm, quoted third-party speech, changed preferences, jokes, mixed
languages, harmful instructions inside chat and uncertain transcription. Dates/IDs/permissions come
from code. Cost per active family/day and queue age must be observable before broad rollout.

Done: agreed pilot accuracy threshold with labelled synthetic evals and reviewed consented pilot
results, plus load receipts at forecast traffic and 10× burst on isolated fake families.

## 4. Wellbeing report slice

Add a versioned report schema, eligible evidence references and reviewed action templates. Keep
existing weekly reports working while new reports are off. Introduce WELLBEING_REPORT separately
from founder-only WEEKLY_INSIGHT; pin production off. Health suggestions wait for purpose-specific
consent, revised notice and qualified clinical review of templates and failure/urgent pathways.

Create reviewable examples for a joyful week, a difficult week, sparse data, refusal and withdrawn
sources. Build report draft/review/send APIs with idempotency and revision-bound approval. Recheck
eligibility when rendering and sending, not only when drafting. A stale approval cannot send.

Done: each observation/action traces to eligible evidence; unsupported claims rejected by evals;
no model health input; sparse weeks say so; withdrawal/deletion remove contributions; parent sees
the report about them; review and immediate concern routes verified independently.

## 5. Polish, export and commercial readiness

Complete calm-notice actions, contact consent and late-answer closure. Build source-respecting PDF
and media export, including partial failures, access expiry and deletion. Retain free data copies.
Finish trial/lapse/cancellation and purchase restoration only after value and company/payment setup.
Add support procedures, operational alerts, capacity/cost receipts and rollback instructions before
phased activation. No silent backfill of historical conversations under new consent.

## Evidence ledger

This initial change supplies domain-policy tests and a product/implementation contract only.
Persistence, APIs, UI, discovery, clinical review, provider/device flows, scale and production are
not proven by it. Record later receipts against each slice rather than marking the whole plan done.
