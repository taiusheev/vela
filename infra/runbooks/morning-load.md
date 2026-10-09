# Morning peak load (technical plan 2.6)

The first measurement exercises Vela's actual scheduling and outbound services on a disposable PostgreSQL 18 database. It is a local baseline; plan 2.6 stays open until hosted staging queues and Neon are measured.

## Workload and pass criteria

The planning assumption is ten kept-light members due in the same minute, one per pilot family. At ten times this assumption, 100 synthetic parents become due together at 08:00 Taipei. Revisit this assumption if the pilot cohort grows or has more than one kept-light member per family.

The test runs three independent bursts, each on freshly cleared synthetic data and ten independent database connections. Each parent gets two scheduler wakes and each resulting outbound job gets two delivery attempts, including overlapping copies. The queue and Telegram adapter are in memory. Each simulated provider send waits 25 ms; this is an input to the experiment, not measured Telegram latency. Time advances with elapsed wall time after the burst starts. Seeding, connection establishment, and final verification queries are outside the measured burst.

Every burst must have exactly 100 queued arrivals, 100 distinct adapter sends, 100 delivered exchanges with committed effects, no duplicate sends, no service errors, no pending jobs, no quiet events, and all work finished within five minutes. The report records nearest-rank p95 scheduler duration and p95 completion from the common burst start. Completion is recorded once per outbound row after a successful delivery return; it includes scheduler work, waiting behind other jobs, simulated send latency, and delivery effects. Errors count rejected service operations; dropped or failed rows also fail the row checks. The five-minute limit matches the plan's arrival target, but is not a hosted-service guarantee.

## Run locally

From the repository root, using Docker:

```sh
VELA_PEAK_REPORT="$PWD/infra/load-tests/morning-peak-local.json" \
  pnpm --filter @vela/services exec node scripts/test-postgres.ts \
  -- postgres-tests/morning-peak-load.test.ts
```

With PostgreSQL 18 binaries, add `--pg-bin /absolute/path/to/bin` before `--`. The existing runner creates and removes a dedicated loopback database, refuses ambient database credentials, applies all migrations, and verifies its run marker before any test can reset data. Do not point this test at staging or production. The runner disables durability writes for test speed, so these timings do not estimate production write capacity or restore performance.

The test also runs in the existing PostgreSQL contention CI job on every push and pull request. CI prints a content-free report; an optional `VELA_PEAK_REPORT` path saves JSON locally. A failed assertion keeps the failing measurements in that report. Receipts contain aggregate counts and timings, not identifiers, messages, credentials or URLs.

The recorded baseline is [`morning-peak-local-2026-10-09.json`](../load-tests/morning-peak-local-2026-10-09.json). It covers text fallback arrivals only. It does not cover media, AI calls, read-backs, quiet-notice throughput, hosted Durable Objects, Cloudflare queue timing, Neon/Hyperdrive latency, or real provider delivery.

## Hosted staging evidence still required

1. Use a dedicated synthetic cohort and an isolated load environment with the staging Worker version, queue consumer settings, database size, Hyperdrive configuration and sealing enabled. Keep the cohort and queue isolated from existing staging families. Use a recording test-channel adapter in this environment so a load burst cannot message real accounts; a real-provider end-to-end loop is a separate check.
2. Record the exact source revision and infrastructure settings, the expected pilot peak, the multiplier, concurrency, test duration and adapter delay. Exercise the actual deployed scheduler and Cloudflare outbound queue, with at-least-once redelivery, against the isolated Neon database. Do not use a read-only API load test as morning-delivery evidence.
3. Measure scheduled time to committed delivery, queue wait, service/provider failures, delivered exchanges, distinct sends, duplicates, pending/dead jobs and any unintended quiet notices. Require p95 delivery within five minutes, under 1% failures, zero duplicates and zero false quiet notices; reconcile the whole cohort so lost jobs cannot disappear from the denominator. Retain failing attempts and content-free receipts.
4. Repeat with media and read-back workloads before claiming those paths are covered. Keep real-provider reliability, signed-iPhone playback and production capacity as separate gates.

No hosted run or production readiness is claimed by the local receipt. Provisioning the isolated hosted environment and establishing its configuration remains engineering work.
