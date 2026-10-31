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
3. Explicit profile persistence/retention contract, scoped correction/export/deletion and evidence
   lineage. No inferred backfill. The first request-only prototype creates none of this data.
4. Add policy before nightly content selection and preserve one signer/one question per parent/day.
   Honor restrictions through every fallback, existing prepared days and enqueued delivery.
5. First-month review windows driven by explicit choices. Never increase intimacy from elapsed
   time, reply length, silence or presumed loneliness.
6. Separately authorized formative pilot and review. Expand automation only after both people's
   comfort and comprehension have been checked; no efficacy claim from a small feasibility study.

These remaining items are not complete. No migration, automatic signer, parent channel, feature pin,
privacy notice version, check-in timing, production deployment, family activation, or provider account
was changed in the first slice. Photo-box work retains its separate migration and notice scope.
