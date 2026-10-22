# Light memories and wellbeing delivery

Owner: engineering; product direction approved by founder on 21 October 2026.
Contract: product/06-light-memories-wellbeing.md. Deliver vertical slices with evidence; no estimates
of production capacity from a unit suite. Existing real-family and billing holds stay separate.

Current status (22 October): private-first reads and the read-only confirmation foundation are
merged but disabled. Persisted named permissions/revocation are the next proposed change, with
synthetic database evidence below. Recipient reads, connected app/Telegram acceptance and the
non-medical weekly support engine remain pending. No real-family activation is complete.

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
- Author-private reads; separate explicit audience grants before sharing; owner correction/removal;
  mutation idempotency and real
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
from founder-only WEEKLY_INSIGHT; pin production off. First release: non-medical everyday support
only, from eligible ordinary interests/stories/practical requests, with fixed reviewed templates.
No symptom-driven suggestions, health inference, disease claims, exercise/diet/sleep prescriptions
or generated advice. Purpose-specific permission/notice, audience checks and safety review still
apply; this is not a consent or regulatory workaround. Personalised health advice remains deferred
behind separate permission, clinical review and legal/safety assessment. Existing urgent notices
must not be suppressed by this flow's source exclusions.

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

### Approved private-first and everyday-support refinement (22 October, not activated)

Founder approved the benchmark recommendation and asked for useful non-medical suggestions instead
of medical advice. Candidate and default-kept reads now filter to the authenticated author before
pagination. Current organisers and later joiners receive no quotes or cursor. Explicit named-audience
sharing is still unimplemented; no fallback family-wide access is allowed until grants exist.
New proposed purpose/keep versions reject the old family-wide consent assumptions; no historical
proof is silently converted. The existing synthetic UI preview still uses its old review text and
must not be wired to the new backend contract unchanged. Product examples narrow the first report
to calls, interests, stories and practical offers; they do not implement or validate a live report.

Local pnpm check passed all 9 tasks, including 1,635 service tests (3 new private/version cases).
Focused memory tests passed 60/60 and existing real PostgreSQL races passed 16/16 with disposable
cleanup. Removing both private-read filters made the two historical-access tests fail; restoring
them made all 60 focused cases pass. No new mutation operation or schema migration was added. Explicit sharing,
the revised real consent/preview flow, report generation, native/provider/capacity proof and
production activation remain unimplemented/unverified. Current notices/scripts and Worker pins
are unchanged; source/contract version changes cannot record real acceptance on their own.

### Initial consent wording review (22 October, superseded)

Review-only English wording is in plan/materials/pilot/memory-consent-review.en.md. It separates
optional discovery, per-quote keeping and withdrawal. Its original current/future-family visibility
proposal is superseded by the approved private-first direction above. The revised draft retains
longer quote retention, provider/AI disclosures, no historical backfill and free privacy/data-copy
controls. Approval applies to product wording, not notice replacement or activation. The current
privacy-notice.v6, scripts, generated notices, runtime switches and shared app locales are unchanged.
Revised full notice/script approval, native Chinese review, fresh one-use acceptance presentations,
withdrawal invalidation, app/Telegram controls, readable delivery and screening remain prerequisites.

### Author withdrawal follow-up (22 October, not activated)

Added an internal author-derived withdrawal operation. It withdraws only that member's existing
rich_memories and memory_keep yes proofs, deletes pending candidates and sealed kept copies in the
same transaction, and preserves original messages and unrelated consent purposes. No new yes/no
proof is invented. Processing configuration and payment do not gate withdrawal. An organiser can
withdraw only the organiser's own memories, not another adult's. Every retry rechecks membership;
an old successful receipt never withdraws a later, separately recorded consent.

The family/member/user lock order is shared with keep/remove; withdrawal takes an exclusive member
lock. A compatible proposal may finish while that lock is waiting, but its candidate must be gone
when withdrawal commits. Further proposals are refused. PostgreSQL tests assert that observable
promise, not lock-queue ordering. Old keep retries cannot restore words after withdrawal.

No acceptance route, app/messenger action or revised notice is activated here. Before adding
acceptance, bind it to a fresh, versioned presentation and invalidate outstanding acceptance
challenges on withdrawal: a late tap from an old screen must not silently restart processing.
Future clients must refresh current state after a replay rather than treating a receipt as status.
Final local pnpm check passed all 9 tasks, including 1,632 service tests (6 additional withdrawal
cases); 8 unchanged tasks reused valid caches. All 16 real PostgreSQL memory races passed,
including 2 new withdrawal races. A negative control that skipped proof withdrawal failed on
re-extraction after the apparent stop; restoring it made all 16 pass again. Temporary databases
were removed. Initial race-test ordering was corrected to allow a valid pre-withdrawal proposal
while still requiring no surviving selections after commit. GitHub checks, actual app/messenger
actions, capacity and real consent are not proven by these local results.

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

### Named-sharing confirmation foundation (22 October, not activated)

Private-first PR139 requires purpose/keep @2; older family-wide wording must not be wired.
The next slice builds an owner-only, read-only confirmation from trusted server state:
one exact kept quote, explicit named recipients, and a five-minute presentation fingerprint.
The explanation says later joiners receive no historical access and warns that already-read
words or screenshots cannot be recalled. This is proposed English copy, not a live notice.

The fingerprint binds quote/language, source, purpose/keep proof IDs, owner/account bindings,
selected recipients' names/accounts/membership generations, sharing revision and expiry.
Changing any of these invalidates the old confirmation. The audience is bounded at 50, with
no family-wide wildcard, duplicate account, self, cross-family or ambiguous display name.
Identical names require disambiguated server-generated labels before presentation.
The content-free record holds only IDs, fingerprint and timestamps; previews must not be logged,
cached durably or persisted as a second quote/name copy. The fingerprint is not a signature.

There is deliberately no loader, grant writer, share table, route, app action or runtime caller.
Membership/sharing generations are required design inputs, NOT existing persisted guarantees.
The future database slice must establish these generations, load current authenticated state,
lock/consume a server-owned single-use presentation and persist per-recipient grants atomically
through runApiMutation. It must purge grants on quote removal, source changes, purpose/keep
withdrawal, member departure/account rebind and family erasure. A replay must never recreate a
revoked grant; returning members need a fresh owner choice. Personal exports stay author-only.
Required real PostgreSQL negative-control races include revoke/share, leave/rejoin/share,
withdraw/share, source correction/share and duplicate/replayed confirmation. Only after that
slice may a recipient read path be connected. These unit checks alone prove none of those races.

Current notice/scripts, generated notices, Worker switches and production remain unchanged.
No clinical suggestions, model calls or health inputs are introduced. The weekly support engine
and real app/Telegram consent acceptance remain separate pending work.

Verification: all 31 synthetic confirmation cases passed; local pnpm check passed all 9 tasks,
including 1,666 service tests (7 unchanged test tasks reused valid caches). Removing the current
fingerprint comparison made 11 stale-state tests fail; restoring it returned all 31 to passing.
This proves the comparison tests, not persisted permission or device/consent behavior.

### Persisted named permissions (22 October, internal and disabled)

Private-first PR139 merged as 67a410d after both current-head GitHub runs passed source,
PostgreSQL and app journeys. Its automatic staging deployment is tracked separately.
Confirmation PR140 merged as af7f5de after latest GitHub source, database and app checks passed;
its automatic test deployment is tracked separately. This persistence slice does not widen readers.

Internal create/load/confirm/stop services now load authenticated live owner/source/consent state.
A single-row owner lookup reuses the existing private keep checks rather than scanning pages.
Create and confirm require richMemories=true; author preview and stop-sharing do not require payment
or processing. Each write uses runApiMutation. Mutation receipts contain IDs only, never previews.
Preview loading rechecks the server-owned five-minute record and never accepts a client snapshot.
The confirmation applies the COMPLETE named audience; it does not silently preserve other recipients.
Other pending choices are invalidated, and a consumed choice cannot be submitted with a new key.
An identical successful receipt is replayable only while its current grant set is still intact.

Two content-free tables hold presentations and per-person permissions. Neither copies quote or name
text. Permissions bind current member/account and membership generation, kept-memory sharing revision,
confirmation version, fingerprint and time. Only the chosen quote remains in the sealed keep table.
New membership and sharing generations are persisted, not supplied by the client. Membership guards
rotate generations; membership/account guards purge permissions/pending choices on departure/rejoin, account rebind/deletion,
quote removal or source/consent invalidation. A replacement account also loses the old private keep.
Recipient rename invalidates pending choices, not an already granted permission. The existing source
guards and foreign keys cascade kept-quote correction, health changes, withdrawal and family erasure.
Ordinary 30-day source cleanup remains the narrow exception that preserves chosen words/permissions.

Stop-sharing rotates the sharing revision, clearing pending choices and permissions immediately.
Old choices and old successful share receipts cannot restore them. A fresh author choice can share
again. Replaying an older stop action acknowledges that original action; it does not revoke a later
fresh choice. Future clients must refresh state after replay, as with consent withdrawal.
Expired presentations are cleared by retention; grant fingerprint/version metadata remains with its
active permission, while the expired presentation reference becomes null. No extra quote copy survives.

The bounded internal workflow locks selected accounts in ID order before family, members and source/
keep rows. It does no network/model work in the transaction. Membership changes rotate the persisted
generation; account-subject/deletion changes purge old permissions/choices/keeps under the user lock.
The user trigger must not update memberships before account deletion's ordered organiser locks.
Synthetic PostgreSQL races cover stop/share, withdrawal/share, leave/rejoin/share, source correction,
departure behind an in-flight share and duplicate confirmations. Disabling the member guard made the
last-departure test fail on a surviving permission; restored guards passed all 22 memory race cases.
Two more races prove account-subject changes invalidate choices before sharing and purge grants
when queued behind sharing. Full disposable PostgreSQL suite: all 148 tests across 47 files passed.
The initial user-trigger/member-lock inversion broke two existing account-deletion races; the new
guard/lock-order fix restored both without changing deletion production code or weakening assertions.
Broader root results and candidate delivery are recorded in the implementation receipt.

Final local pnpm check passed all 9 tasks, including all 1,690 service tests (24 new persisted
sharing cases). The service test task actually ran; 8 unchanged test tasks reused valid caches.
The combined verification also has 238 database tests, 1,235 Worker tests and 377 app tests with
1 existing skip. Original full-row account-binding assertions were preserved except for explicitly
requiring the new membership revision to rotate on bind/unbind. No live notice/config changes.

No Worker/app/messenger calls these services. Existing family readers and personal exports remain
author-only even when a synthetic permission exists. A recipient read path still needs fresh grant,
membership-generation, keep/source/consent and session checks before connection. There are no HTTP
routes, live consent acceptance, shared UI, real-family activation or production tags in this slice.
Live notice/scripts/generated notice and Worker configuration remain unchanged; no health/model
processing or weekly report engine is added. Actual notice/translation/legal review remains required.

### Recipient reading and sharing screen (22 October, internal/synthetic only)

Permission PR142 merged as f2439fb after all newest-head source, PostgreSQL and app checks passed.
Its automatic staging deployment is tracked separately. The earlier PR140 queue-configuration
failure (Cloudflare internal error10500) was superseded by successful descendant deployment
39659759659 at main88fa0c2; both Workers and public protection smoke passed. No old deployment
was rerun over newer code and no provider credentials were changed.

The separate internal shared-keeps reader now matches a current recipient account/membership
generation and current keep-sharing revision before pagination. It also checks grant version/time
and reuses all source/consent/health/retention checks. Only selected words are returned: no source
answer ID or conversation-access hint. Default/private reads and personal copies remain author-only.
Read access is not paid-gated. Later joiners/organisers cannot inherit historical permissions.

A reusable sharing screen and session-scoped controller now support explicit named selection,
exact-quote review, cancel, stable-key retry, expiry, refresh and stop-sharing. The controller
rejects incomplete audiences and inconsistent server previews, clears words on reload/disposal,
ignores late requests and reloads after writes instead of claiming optimistic success. The only
adapter is an in-memory synthetic example under a guarded development route. There is no live
author-state loader, authenticated transport, HTTP route or app/messenger connection in this slice.

Removing recipient query predicates made the historical-access test fail on leaked synthetic
words; restoring them passed all 71 focused service cases. 20 controller tests cover state/error/
session behavior. Browser review verified review/cancel, keyboard Enter/Space, failed confirm/retry,
quote-only recipient view and access removal after stop. 320/390/768px confirmation layouts had
no horizontal overflow and 64px actions. Existing Kept Light tokens were retained. Copy is an
English draft; shared locale files are untouched. Native accessibility/language/device/provider,
revised notice acceptance, live consent and activation remain gated. See apps/app/docs/memory-sharing.md.

The normal root translation guard rejected the first unwrapped English draft. All new preview
text now uses real Lingui macros and an isolated catalog; shared catalogs stay byte-identical.
Only English is loaded; generated Chinese/Japanese entries are untranslated, not reviewed copy.
24 focused app cases passed (20 controller, 3 existing scanner, 1 new catalog). A production-mode
web export rendered the new preview blank without console errors; the same export's home rendered
normally as the positive control. Full independent PostgreSQL suite passed 148/148 across 47 files,
including positive recipient reads and no access after a queued stop; disposable database removed.

Final local pnpm check passed all 9 tasks: 1,697 service tests and 400 app tests with 1 existing
skip actually ran; 7 unchanged tasks reused valid caches. No live notice/generated notice,
shared locale or Worker enablement changes. Browser preview servers were stopped after review.

### Authenticated author sharing state (22 October, internal only)

The internal author-state loader now joins the real private keep, current revision and complete
eligible audience in a repeatable-read/read-only transaction. It is an observation, not a saved
confirmation or later-write authority. It performs no writes and creates no quote/name copies.
It remains usable when rich-memory processing is off; no payment gate is added.

Only current active/paused members with live bound accounts appear; no author/self, departed,
invited, deceased, unbound or deleted account is a new sharing option. Current permission account/
membership generation, sharing revision, confirmation version and time determine the displayed
audience. New joiners/organisers are not preselected. Normalized ambiguous names, invalid names or
more than 50 eligible people return unavailable, never an incomplete replacement audience.
Before live connection, unsupported/failed audience loading needs an independent free stop/
remove/withdraw path; revocation must not depend on successful loading of all eligible people.

Synthetic tests cover exact private words, author isolation, complete/current audiences, free
reads after processing stops, stale grants, departure/account/name changes, invalidation and
ordinary-retention survival. A real PostgreSQL snapshot test commits a stop from another
connection, verifies the coherent earlier snapshot and then refreshes to the new private state.
Deliberately weakening isolation to read-committed failed on the audience mismatch; the restored
read-only repeatable snapshot passed. This is database evidence, not live account/provider proof.

Permission PR142 staging39662523929 succeeded, including both Workers and public protection
smoke (auth401/no-admin404/Access302/capabilities200). Screen PR143's original candidate passed
all GitHub source/database/app checks, then was normally updated to main9bf0275 (settings144)
as eda77d4; newest-head checks are tracked separately. Settings/locale work is preserved.
No new HTTP route, service-barrel export, app/messenger transport, live notice/consent acceptance,
shared locale change, model processing, production tag or real-family activation is included.

Final author-state local pnpm check passed all 9 tasks: 1,716 service tests and 400 app tests
with 1 existing skip actually ran; 7 unchanged tasks reused valid caches. All 90 focused keep/
sharing cases passed. Full independent PostgreSQL suite passed 149/149 across 47 files, and the
disposable database was removed. Snapshot-isolation negative control failed as intended; restored
source passed. No live UI or new production notice was used to obtain these results.

### Independent sharing recovery (22 October, synthetic UI only)

Screen PR143 merged24136472 after the newest updated-head source, PostgreSQL and app journeys
passed (nightly silence skipped by workflow). Its automatic staging run39717769719 is tracked
separately. Author-state145 updated normally to f7e346f after143; newest-head checks are pending.

The sharing controller is now bound to explicit immutable author/memory IDs rather than trusting
the ID returned in a detail response. Wrong-memory responses are hidden, malformed scopes make
no calls, and a stop always targets the original memory. These IDs are locators, not authorization;
the future server adapter must still authenticate and authorize every action.

Stop-sharing now remains available after detail-load failure/unavailability, even before a first
successful read. Words are cleared; Stop sharing and Check again remain visible with busy/error/
retry behavior. Failed stop retries keep their key, duplicate taps are ignored, and read failure
after a write does not produce a success claim. Disposal rejects new actions and late responses.
Phase changes reset the preview scroll so the failure heading stays visible. English draft copy
explicitly warns sharing may still be on; isolated catalogs are synchronized, shared ones untouched.

28 controller tests cover the original20 plus8 recovery/scope/session cases. Reintroducing the
loaded-view dependency failed the first-read revocation regression; restoring independent scope
passed. No new domain writes, migrations, model processing, live transport, consent/notice,
production tag or real-family activation are added. Native/device/provider/language gates remain.

Recovery final local pnpm check passed all 9 tasks: 408 app tests with 1 existing skip actually ran,
and 8 unchanged test tasks reused valid caches (including 1,716 services). Browser synthetic flow
verified failed detail read, hidden words, failed stop, keyboard retry, refreshed private status
and a recipient with no quote. At 320/390/768px there was no horizontal overflow; Stop sharing
and Check again measured 64px high. No signed-device or live-family proof is claimed.
The final production-mode export kept the updated preview blank without console errors even
with explicit demo mode on; its synthetic home rendered normally as positive control.

### Optional sharing HTTP boundary (22 October, built but unconfigured)

Author-state145 merged b5716359 after current f7e346f source, PostgreSQL and app journeys passed
in push39717773214/PR39717776388 (silence skipped by policy). Its automatic test deployment is
tracked separately. Recovery147 updated normally to c1a8995; current-head checks are pending.

A trusted optional ApiRuntime.memorySharing group now defines author state, prepare-ID, separate
ephemeral preview, confirm, stop and recipient-page routes. All actual runtimes leave it absent:
development/staging/production tests pin that even with legacy MEMORY on. No environment setting,
Worker runtime wiring, app transport/navigation, notice change or real-family activation is added.

Configured routes reuse verified sessions, active write-session checks, bounded strict JSON,
idempotency and safe generic errors. UUIDs are canonicalized before domain calls. Prepare/confirm
require new processing enabled at both route and domain boundaries; reading/stop are not paid or
processing-gated. Stop bypasses closed-trial admission only, retaining domain author/source checks.
Receipts carry IDs/booleans; quotes/names are only in separately authenticated no-store reads.
Other authors/resources are404, not an existence-revealing403; stale confirmation/replay conflicts409.
Recipient responses forbid original-conversation IDs or hints. Full protocol is in api-contract.md.

HTTP tests inject synthetic domain ports; the existing service/real PostgreSQL tests prove data
authorization and write races separately. Removing author-read authentication made the401 boundary
test fail; restored authentication passes. No integrated live HTTP/database/app or native/provider
proof is claimed. Revised notices/fresh purpose/keep acceptance and reviewed runtime wiring remain
required, as do translation, native-device, provider and capacity gates. Weekly report stays separate.

Final HTTP local pnpm check passed all 9 tasks: 1,716 service tests, 1,277 Worker tests and 408 app
tests with 1 existing skip actually ran; 6 unchanged test tasks reused valid caches. The Worker
total includes 39 new HTTP cases and 3 runtime-pinning cases. Full independent PostgreSQL suite
passed 149/149 across 47 files; disposable database removed. No live records or runtime were used.
