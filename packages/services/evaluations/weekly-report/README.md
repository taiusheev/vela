# Weekly report: 100 synthetic service personas

This opt-in evaluation deliberately challenges product expectations. It is separate from the regular
regression suite: an expected exclusion admitting sensitive text must fail, rather than becoming an
approved expectation to make CI green. It uses the actual report services and real migrated PGlite
database. It does not contact an AI provider, send messages, enrol families or install an app.

The fixed cohort has 40 distinct content scenarios and 20 permission/lifecycle scenarios across
three language/input/time-zone profiles (60 independently seeded families). This is 100 automated
persona scenarios, not 100 people, usability interviews, model roleplays or a representative sample.

Content scenarios intentionally mark understanding complete with no upstream health mention or flag.
Some deliberately contain a wrong English language label. This tests the residual screening boundary
when an upstream annotation misses something. Eligible sources are then deliberately approved as
ordinary, testing what a mistaken human confirmation can admit. No suggestion exists before review.
For each wrongly admitted sensitive source, a separate explicit health-marker control verifies that
both the review source and saved suggestion disappear. These control passes do not erase the failure.

Run from the repository root (set an absolute output path outside the repository):

```sh
WEEKLY_PERSONA_RESULTS=/absolute/path/results.json \
WEEKLY_PERSONA_HEAD=$(git rev-parse HEAD) \
pnpm --filter @vela/services exec vitest run --config vitest.weekly-personas.config.ts
pnpm --filter @vela/services exec tsc -p evaluations/weekly-report/tsconfig.json
```

The evaluation returns a nonzero exit status when expectations fail and still writes all 100 results.
Every fixture is invented. The valid baseline and repeat on `384ecb68` (report sources unchanged
from `c7ed2add`) both met 82/100 expected
outcomes: 60/60 lifecycle, 10/20 ordinary content accepted, 12/20 sensitive content excluded. All eight
wrong admissions disappeared with an explicit health marker. No AI or outbound messages occurred.

Ordinary false exclusions include birthday parties, coming back from a walk, baking sugar, a photo
tablet, cold weather, autumn/fall colours, the name Bill, needle eyes and figurative language. Sensitive
misses include Latin-script non-English input, zero-width/typo variants, vomiting, abuse and self-harm
wording. See case IDs in `personas.ts`. Expected outcomes remain unchanged after the run.

These results do not establish real-parent usefulness, prevalence of failures, signed-iPhone
behaviour, offline UI recovery, accessibility, clinical safety or exhaustive language coverage.
Existing HTTP, PostgreSQL concurrency and web UI suites are complementary evidence, not 100 device
sessions. Do not widen the cohort on this result. Keep report gates off while addressing screening
and language policy, then rerun this unchanged cohort plus new cases and signed-device acceptance.
