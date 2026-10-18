# Concurrent synthetic family week (build 5)

This harness speeds up service testing by running many consenting synthetic families through seven dates on independent PostgreSQL connections. Each day's families compete concurrently; days advance only after the previous day's work settles. It uses the consumer-flow application revision `f08b5a2` (release `v2026.10.18`, delivered as an update for build 5), plus the test harness in this branch.

## Run

From the repository root, with PostgreSQL 18 binaries installed:

```sh
VELA_SWARM_FAMILIES=100 VELA_SWARM_DAYS=7 VELA_SWARM_WORKERS=20 \
VELA_SWARM_REPORT="$PWD/infra/load-tests/build5-family-swarm-100.json" \
pnpm --filter @vela/services exec node scripts/test-postgres.ts \
  --pg-bin /opt/homebrew/opt/postgresql@18/bin -- postgres-tests/family-swarm.test.ts
```

The default is 100 families, seven days, twenty connections. Use 500 and then 1,000 families to increase the cohort; the upper bounds are 1,000 families, seven days and forty connections. The existing PostgreSQL runner refuses ambient database credentials, creates its own loopback database with a run marker, applies all migrations and removes the instance after the test. Never use a live database. Without `--pg-bin`, the runner uses Docker.

## Workload and analysis

Taipei and Vietnam families share one due instant at their respective local arrival times. One third use Traditional Chinese; the rest use English. Half have explicitly enabled signing Vela's seeded draft in their organiser's name. Others receive the normal fallback morning. Families are seeded as active and consenting; this does not exercise onboarding.

Each morning receives overlapping duplicate scheduler wakes. Every queued send receives duplicate delivery attempts against a recording Telegram adapter with an artificial 25 ms delay. Every parent's text answer arrives twice with the same event ID. Every organiser's reply arrives twice with the same idempotency key. After each day, the Today and Memories service reads must contain the right parent's answer and the exact cumulative exchange count, and both reads must deny access to the next family's data. The following morning must commit the previous reply's read-back.

Every phase prints operation count, errors, nearest-rank p95 operation time and total phase duration while the run continues. The final content-free JSON reconciles the entire cohort: exactly families × days exchanges, answers and replies; all arrivals delivered; the expected signed-draft count; families × (days − 1) read-back replies; zero duplicate adapter sends, unfinished outbound rows, pending jobs or quiet notices. Failures identify phase and synthetic item index. Final-day replies remain pending their next morning by design; they are persisted replies, not lost queue work.

The workload checks correctness under concurrency. Phase p95 values are local service-operation timings; a whole app-read phase includes Today, Memories and two denied cross-family reads. Seeding, daily draft insertion and final reconciliation are outside phase timings but daily draft insertion is included in overall elapsed time. Comparing timings while other checks run measures local contention too. The existing morning peak test provides separate arrival-completion timing against a five-minute budget.

## Evidence boundaries

This is a virtual week with phase barriers and frozen time during each phase. It is not a seven-day soak or a mixed arrival-rate capacity test. PostgreSQL durability is disabled by the disposable runner. Queue, scheduler, AI and Telegram are test doubles. Drafts and answers are synthetic. No tokens are purchased and no real accounts are messaged.

These results do not establish hosted Cloudflare/Neon throughput, provider latency or reliability, LLM wording quality, onboarding conversion, media playback, signed-device UI/accessibility or real-family satisfaction. Existing service/unit and PostgreSQL contention suites provide additional failure, media, withdrawal and race checks; passing them does not remove these boundaries. Hosted load needs the isolated environment described in [morning-load.md](morning-load.md).

## Measured 18 October 2026

Application revision `f08b5a2`; seven simulated days per cohort. The 100 and 500 family runs used twenty connections; the 1,000 family run used forty. Other local checks ran concurrently, so timings include contention from this machine.

| Families | Family-days | Workload time | Worst daily app-read p95 | Result |
| ---: | ---: | ---: | ---: | :--- |
| 100 | 700 | 12.7 s | 108 ms | Pass |
| 500 | 3,500 | 80.2 s | 329 ms | Pass |
| 1,000 | 7,000 | 213.0 s | 392 ms | Pass |

Across these three cohorts: 11,200 delivered exchanges, 11,200 unique answers, 11,200 unique app replies, and 9,600 committed next-morning read-backs. The expected signed-draft count matched. No duplicate adapter sends, unfinished outbound rows, pending jobs or quiet notices occurred. All per-family Today answer checks, Memories counts and cross-family read denials passed. The last day's 1,600 replies await the next simulated morning.

Validation: lint and all nine package typechecks passed; all nine package unit suites passed (one existing skipped app test); the complete PostgreSQL suite passed 122 tests in 44 files. The initial composite check stopped on formatting in this new test; the formatter was corrected and lint, typecheck and tests then passed separately. No application behavior was changed or deployed.

The larger cohort took longer and its read timings increased. This run does not isolate history size, concurrency, database workload and competing local checks, so it cannot identify a production bottleneck. The next measurement should use an isolated hosted recording environment and varied arrival times; real-family observation remains necessary for product conclusions.
