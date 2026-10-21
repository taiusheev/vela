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

### Consent wording review (22 October, awaiting founder approval)

Review-only English wording is in plan/materials/pilot/memory-consent-review.en.md. It separates
optional discovery, per-quote keeping and withdrawal, states current/future family visibility,
longer quote retention, provider/AI disclosures, no historical backfill and free privacy/data-copy
controls. Approval applies to product wording, not notice replacement or activation. The current
privacy-notice.v6, scripts, generated notices, runtime switches and shared app locales are unchanged.
Revised full notice/script approval, native Chinese review, fresh one-use acceptance presentations,
withdrawal invalidation, app/Telegram controls, readable delivery and screening remain prerequisites.

### Personal-copy follow-up (22 October, not activated)

Added a bounded internal read for the authenticated author's own kept quotes. It reuses the
collection's current consent/source/identity checks, applies the author filter in SQL before the
50-row page limit, and remains available with discovery off. It creates no export files, cached
snapshots, routes or mutation receipts. The data-request runbook distinguishes this component from
a complete export and records sealed-value, private delivery and in-progress invalidation gates.
No founder console impersonation or whole-family data copy is introduced. Local root checks passed
all 9 tasks (1,626 service tests, including 9 additional copy cases); 14 existing real PostgreSQL
memory races passed with disposable database cleanup. Removing the author filter made both copy
isolation tests fail, including the 51-other-quotes page case; the guard was restored before commit.
GitHub results, combined-main verification, production delivery and actual consent remain pending.

This initial change supplies domain-policy tests and a product/implementation contract only.
Persistence, APIs, UI, discovery, clinical review, provider/device flows, scale and production are
not proven by it. Record later receipts against each slice rather than marking the whole plan done.

### Persistence follow-up (21 October)

Implemented: source-backed candidate table and migrations; shared bounded response/selection
contracts; an internal ordinary-content review entry point; purpose-specific rich_memories consent
lookup; family-authorised 50-row cursor reads; author-only idempotent dismissal; 30-day expiry and
retention cleanup. At most 12 candidates may be proposed per source, including dismissals; the
source row serialises the count and insertion. Author removal remains available with discovery
disabled. Candidate rows hold offsets and a sealed source fingerprint, not another copy
of the person's words. Live text is rechecked for correction, health/flag changes and withdrawal.
The fingerprint binds the current source words and language; it is not a source edit-history counter.

There is no extraction worker, route, consent acceptance UI, app screen or long-term keep grant
yet. Config.richMemories is absent from Worker configuration, which means off; synthetic harnesses
opt in explicitly. The ingestion review argument is a trusted internal boundary, not a model's
classification and not a safe public request body. No new source screening accuracy is claimed.
Runtime wiring requires the independent environment switch, notice, consent UI and screening work
above. Existing health consent never authorises conversational memory processing.

The final full root run passed all 9 packages, including 1,593 service tests (18 new candidate
cases). Eight package test tasks reused valid cache entries. Both sealing scripts also passed
standalone typechecking and formatting. All 5 real PostgreSQL
duplicates/withdrawal/correction/source-delete/family-delete races pass on disposable PostgreSQL
18.6. Removing ON CONFLICT DO NOTHING makes the duplicate race fail on the unique key; restoring
it makes the suite pass. The runners confirmed temporary database cleanup after each attempt.
The PostgreSQL race waits account for the source lock used to bound candidate counts.
Local PostgreSQL correctness does not prove hosted throughput or thousands of active families.

Foundation PR131 merged as 1b133c3; staging deployment 39624916768 succeeded. That deployment
contains the domain-policy foundation only. The persistence migrations and services are a separate
follow-up; none of their runtime integration or production activation is claimed by that receipt.

### Review UI follow-up (22 October)

Persistence PR132 merged as abbadc6; staging deployment 39628557966 succeeded, including migrations,
both Workers and public smoke. Candidate discovery remains unwired/off. No production activation.

Implemented in the next proposed change: reusable memory review view and a session-scoped
controller, plus a development-only synthetic preview. Exact quotes, original conversations,
explicit keep confirmation, separate removal, author-only decisions, failed-write retry with
stable keys, duplicate-tap prevention, changed-source rejection and account-change cleanup are
covered. The preview does not store data or call an API. Permanent keeping remains unimplemented.
English and Traditional Chinese use a separate feature catalog without changing shared catalogs;
Chinese wording still requires native-language review before activation.

Local pnpm check passed all 9 tasks; app tests passed 376 with 1 existing skip. Fourteen controller
cases and one catalog completeness/compiler case are included. Browser review covered source,
confirmation/cancel, failure/retry, collection/removal, family read-only access, changed sources,
keyboard Enter and Chinese layout. Reviewed 320/390/768px widths; 320px confirmation had no
horizontal overflow and a 64px primary action. Screenshots use synthetic words only.

This is browser evidence, not signed-device, VoiceOver, Dynamic Type, Telegram, persistent consent,
or capacity proof. Next: durable quote/keep-grant transactions with deletion/withdrawal races,
then authenticated app and messenger adapters. The weekly wellbeing slice is still pending.

Clean GitHub typechecking caught a browser-only hovered property that local Expo types accepted.
Removed that dependency; press feedback remains platform-neutral. The subsequent full local
TURBO_FORCE=true pnpm check passed all 9 tasks without cached results, including 1,593 service
tests and 376 app tests (1 existing skip). Candidate GitHub checks must pass before integration.

### Durable keep follow-up (22 October, not activated)

Review UI PR133 merged as 11f4aaa; staging39633973823 succeeded, including both Workers and public
release/protection smoke. Its candidate push/proposal checks passed all 19 existing app journeys.

The next backend change adds internal owner-authenticated keep/read/remove services and an indexed
sealed quote table. A keep copies only the selected words, language, provenance and sealed source
fingerprint; no whole answer, question, audio or photo copy. The choice requires the proposed
memory.keep@1 English explanation fingerprint and creates a content-free memory_keep consent proof.
This is a synthetic service contract, not an implemented or approved consent-acceptance flow.
Other locales and messenger evidence must be implemented before activation.

Only ordinary 30-day cleanup marks source words as expired. That specific database transition
preserves the chosen quote; source correction, manual erasure, health/flag changes, source deletion,
new/withdrawn consent, membership departure and family deletion invalidate saved words. Database
triggers remove copies in the changing transaction. Clearing only non-health analysis does not
invalidate unchanged words. PostgreSQL documentation for the trigger mechanism:
https://www.postgresql.org/docs/18/plpgsql-trigger.html.

Reads recheck current viewer/member/family access, source integrity and both purpose/keep consent,
in 50-row cursor pages. Reading/removal do not depend on paid-processing configuration. API mutation
receipts contain IDs only and recheck author permissions on replay. Previously kept candidate
markers prevent removed/invalidated words from resurfacing or stale receipts claiming success.
Explicit removal blanks quote/digest immediately, retaining an ID-only retry tombstone for 30 days.
Orphaned keep proofs are closed by retention and follow the existing five-year withdrawn-proof rule.

Current privacy notice allows normal 30-day conversation retention, not this new long-term purpose.
No notice is silently amended, no real family consent is fabricated and no historical backfill is
performed. richMemories remains absent from Worker configuration (off); there are no new HTTP routes,
app adapters, messenger actions or runtime keep callers. The preview still simulates saving.
Final checks and candidate delivery evidence are recorded separately; no capacity or device claim.

Verification so far: 24 keep cases plus 18 existing candidate cases pass, including 51 saves read
as 50+1 cursor pages. The database suite passes with a guard/migration/schema drift test. Nine new
keep races and five existing candidate races pass on disposable PostgreSQL18.6. Disabling duplicate
handling makes the real duplicate-keep test fail; restoring it passes. Temporary databases are
removed by the runner. Source fingerprints now also bind exchange, kind and source time. The keep
and proposal lock order includes the exchange before its answer, preventing cascading-delete
deadlocks; transferring an exchange to another family purges saved copies in that transaction.

Final local pnpm check on combined main b3df7fb passed all 9 tasks, including 1,617 service tests.
Eight tasks reused valid cache results. Both sealing inventory scripts also typecheck against the
repository's ES2024 target. No app files or Worker runtime configuration differ from that main.
