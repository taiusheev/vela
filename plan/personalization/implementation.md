# Personal questions implementation

31 October 2026. Implements the reviewed-draft starting mode of the approved research plan.

## Complete in the first change

- Strict request contract with explicit unknown and quiet states; no personality scores.
- Caller–recipient scoped authorization, lifecycle and pilot admission checks before/after drafting.
- Isolated reviewed personalization prompt; no change to existing nightly generation.
- No draft for quiet, literal conflicts, provider failure or flagged unsupported attention/commitments.
- English/Traditional Chinese three-step setup, optional own-writing examples, review and date choice.
- Reviewed AI provenance and actual text language through the existing compose API.
- Request-only setup and counter-only provider usage records; no new database retention category.
- Default-off optional route/capability, test-only activation, production activation refusal.

## Validation evidence

See the change description and the local verification receipt for exact commands, results and gaps.
Mocked provider tests establish routing and data flow, not voice quality. The demo explicitly shows
supplied wording rather than pretending to generate with the live model. Real provider and human
quality evaluation are distinct gates before activation.

## Remaining approved work, in dependency order

1. Provider evaluation and native review of this first flow. Add measured voice/intent/comfort
   baselines rather than a claimed improvement target without data.
2. Separate private parent input and comprehension controls; resolve delivery/no-question behavior
   independently from the existing check-in promise.
3. Private saved choices are implemented in the second slice below. Full account-export assembly
   and field-level historical evidence beyond explicit save lineage remain separate work. No inferred backfill.
4. Add policy before nightly content selection and preserve one signer/one question per parent/day.
   Honor restrictions through every fallback, existing prepared days and enqueued delivery.
5. First-month review windows driven by explicit choices. Never increase intimacy from elapsed
   time, reply length, silence or presumed loneliness.
6. Separately authorized formative pilot and review. Expand automation only after both people's
   comfort and comprehension have been checked; no efficacy claim from a small feasibility study.

These remaining items are not complete. No migration, automatic signer, parent channel, feature pin,
privacy notice version, check-in timing, production deployment, family activation, or provider account
was changed in the first slice. Photo-box work retains its separate migration and notice scope.


## Second slice: explicit private saved choices (31 October 2026)

Implemented behind OFF switches: an encrypted setup for each author-account/parent pair, explicit
30-day save, correction, own-data copy component and immediate forget. The one-time question intent
is excluded. Reads/uses do not extend expiry; a null-content revision after forget blocks old-tab
resurrection. Version checks run before/after model calls and at scheduling. Account, family,
member and light withdrawal guards erase affected profiles. Expired rows and metadata enter the
existing daily retention job; content becomes inaccessible at expiry even before physical cleanup.
The app supports profile reload/conflict handling and clears an expired or forgotten setup/candidate.
Demo profiles live only in memory while the example screen is open and never call a model or API.

Privacy supplement question-profile.1 is a separate **unapproved, unserved draft**, not a replacement
for the live notice. Both switches are pinned OFF in every environment and refuse production ON.
No nightly personalization, inferred intimacy escalation, parental private input or family activation
is included. Parent consent/input and automatic-policy integration remain the next major work.
Native Chinese review and observed comprehension/voice checks with separately authorized participants
remain outstanding. Synthetic tests and coding-assistant checks are not participant research.


## TestFlight test release (31 October 2026)

The founder selected the TestFlight test app for deployment. Staging alone enables
`PERSONAL_QUESTION_DRAFTS` so synthetic test families can reach the reviewed draft flow.
One-time inputs and unsent candidates remain request-only. No private profile is collected:
`PERSONAL_QUESTION_PROFILES` stays OFF everywhere, and the profile notice remains an unapproved,
unserved draft. Both personalization switches stay OFF in production; production ON remains
refused by configuration. This test release does not approve real-family use or automatic
nightly personalization. The new feature requires a signed app build, not an OTA update.
