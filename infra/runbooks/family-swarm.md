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

## Hosted product follow-up, 18 October 2026

The follow-up uses an isolated deployed Worker, real HTTP routes, Cloudflare queues and Durable Object alarms, and sealed Neon writes through staging Hyperdrive. See [the hosted runner instructions](../../apps/worker/swarm/README.md). Its 42 explicitly qualified synthetic tables, recording messenger and synthetic signed sessions keep real families and real messenger destinations outside the experiment. It shares staging database compute, so this is isolated data and work, not dedicated capacity.

The ten-family, two-day preflight passed. The larger mixed cohort ran **100 families over three virtual dates**. Twenty families were away on day two and answered again on day three; ten organisers switched off signing drafts; ten parents sent two ordered messages per day. Duplicate inbound events, duplicate scheduler wakes and replayed reply writes exercised the existing idempotency paths. Today, Memories and denied cross-family reads/replies were checked through HTTP.

Final persisted reconciliation ([receipt](../load-tests/hosted-swarm-100-3.json)):

| Check | Result |
| --- | ---: |
| Delivered morning exchanges | 300 |
| Unique answers, including follow-ups | 310 |
| Unique organiser replies | 280 |
| Committed next-morning read-backs | 180 |
| Drafts signed with organiser opt-in | 140 |
| Duplicate sends, dead jobs, unfinished outbound rows | 0 |
| False quiet notices or repeat messages | 0 |

The last day's 100 replies await the next morning by design. All seeded scheduler alarms were stopped after testing. This was a checkpointed run, not one uninterrupted green run: the first attempt exposed reversed answer ordering; a fresh cohort verified the fix; a mistaken away expectation was corrected to the specification (away continues mornings and suppresses repeats/quiet); and final reads/replies resumed after HTTP 503 interruptions. Failed receipts remain alongside the final receipt. Recovery reused the original reply keys and finished the same cohort without adding duplicate replies. The narrow recovery switches refuse unrelated checkpoint totals.

Twenty client workers and twenty queue consumers were used for the final mixed cohort. The day-three morning phase completed in 113.4 seconds and inbound processing in 132.0 seconds; these are whole-cohort phase durations with polling, not per-message p95 or production capacity. The final HTTP verification took 62.1 seconds; its per-family combined journey p95 was 13.8 seconds (several sequential HTTP calls per family). Six HTTP 503 responses in that final verification recovered with bounded retries, including an idempotent reply replay. One captured 503 was not a structured Vela API response; its origin was not established during that run; see the later CPU diagnosis below. Earlier failures are preserved in `hosted-swarm-100-3-http-failure.json` and `hosted-swarm-100-3-reconciliation-failure.json`. This does not establish an HTTP reliability SLO, and retries do not erase the raw failures. A subsequent read-only 100-request burst at twenty concurrent clients returned 58 successes, 41 HTML 503 responses and one structured API 500. Four identical follow-up bursts then returned 400/400 HTTP 200 without retries; sanitized real-time traces of the follow-ups reported no failing sampled invocations. The burst instability could not be reproduced under tracing, and the original run left its origin unresolved. The later log-based CPU diagnosis and verification below supersede that uncertainty. This remains a bounded workload check, not evidence of a production capacity or availability target. The app already retries query reads; no new general-purpose app retry loop was added.

### Improvements supported by the experiment

- **Memories reads:** replace per-card child queries with bounded page-level queries. Thirty serial HTTP reads of the same ten-family cohort retained identical normalized response hashes; measured p95 fell from 2,548 ms to 1,643 ms (35.5%). This is a small controlled sample, not an SLA. A regression test keeps the select-query count constant between one and ten cards.
- **Message chronology:** actual Cloudflare processing reversed seven of ten follow-ups before the fix. Preserve the provider's original message time in the existing sealed payload and sort display by it, using ordinary Telegram message IDs to break same-second ties. Receipt timestamps remain unchanged for consent, retention and quiet decisions. The subsequent hosted checks verified original-message-first ordering. No migration or API shape change is needed.
- **AI language and grounding:** separate live synthetic AI evaluations exposed lost ordinary cooking details when health content was withheld, fabricated read receipts for instruction-only replies, untranslated family replies, untranslated internet shorthand, incorrect date attribution and duplicated untranslated quotes in weekly interpretation. New frozen prompt versions clarify those rules; exact supplied date labels correct contradictory source metadata. Date-priority drafts must retain a complete supplied event label or take the existing empty-draft safe fallback. Near-date OpenAI suggestions receive a small additional reasoning budget; ordinary suggestions and pinned model snapshots keep their existing settings. The product service currently supplies no family-date entries, so the birthday case hardens the provider contract rather than adding a new product feature.

The latest full live golden run before the final translation/date changes passed 101 of 102 cases and retained 20/20 safety-flag recall. After the final grounding guard and prompt changes, all nine observed regression cases passed three live repetitions each (27/27), including birthday, translation, injection and consent cases. Targeted repeated checks are recorded separately and do not replace a full safety report or rubric judgment. The live checks here are deterministic contract/language checks of generated outputs, not a human assessment of warmth or usefulness. Test content is synthetic; API keys stay in the existing private Keychain runner.

Local validation after the application fixes: `pnpm check` passed all nine package tasks; the complete PostgreSQL suite passed 122 tests in 44 files, including an integration test that processes the second answer first. CI also checks browser-based demo journeys. Hosted recording evidence does not establish Clerk onboarding, real Telegram/LINE delivery, microphone/photo playback, signed iPhone accessibility, production capacity, or real-family satisfaction. Those need their own provider/device/family checks.

### CPU diagnosis after historical log access

The founder enabled the missing observability permission and the historical query succeeded. All 41 HTML 503 responses in the failed burst have `exceededCpu` outcomes; failing requests exhausted the Free plan's 10 ms CPU budget. The separate 500 correlates with logged `Error <- error:08P01` (PostgreSQL protocol violation); whether that is secondary to interrupted connections is unproven. The compact content-free evidence is [hosted-swarm-cpu-diagnosis.json](../load-tests/hosted-swarm-cpu-diagnosis.json). Request headers, tokens, raw family data and exception messages were neither printed nor retained.

A 100 ms setting for the isolated Worker was rejected by Cloudflare with 400/code 100328: CPU limits require Workers Paid. That rejected attempt changed no setting or subscription. The initial prepared config pinned a bounded 100 ms budget, and the new read-only burst runner checks 100–1,000 raw HTTP requests without retries against the same 100-family cohort. Account billing belongs to the founder; enabling Workers Paid for Vela staging adds a [minimum US$5/month plus usage](https://developers.cloudflare.com/workers/platform/pricing/). This was already the documented conditional staging-account step in `infra/README.md` section 1.7. The verification procedure deploys only the isolated Worker, runs raw bursts without a live tail, inspects persisted CPU/error outcomes, and rechecks unchanged family totals. A successful deployment or warm/retried run alone cannot close the reliability finding.

The founder enabled Workers Paid. The first paid test deployed the 100 ms setting and completed 1,000 Today requests with 1,000 HTTP 200 responses, no retries and unchanged family totals. The persisted query covered 949 of those requests, all successful with zero error events; CPU p95 was 78 ms and the maximum 182 ms. The client receipt covers all 1,000 responses, while persisted telemetry coverage is explicitly incomplete. Cloudflare can apply platform sampling separately from the configured head sampling, so do not treat that telemetry count as an exhaustive request ledger. The final isolated budget is 1,000 ms to give those measured peaks headroom; further raw verification is recorded separately.

Final paid verification (18 October): the isolated Worker was deployed with a 1,000 ms budget. Ten rounds of 100 Today reads at twenty clients completed 1,000/1,000 HTTP 200 responses in 116.2 seconds, with zero retries and no response/family mismatches. Persisted logs covered 957 of those 1,000 invocations: all 957 were successful, CPU p95 64 ms/max 172 ms, and no error events or 08P01 labels were returned for the window. The client ledger covers all 1,000 responses; the server-log sample is explicitly incomplete. Family totals remained 100 families, 300 deliveries, 310 answers, 280 replies, 180 read-backs and 140 signed drafts; pending/dead/duplicate/quiet/repeat counts remained zero. No live tail was active. See [raw client receipt](../load-tests/hosted-swarm-cpu-http-bursts.json) and [persisted-log receipt](../load-tests/hosted-swarm-cpu-paid-observability.json). The initial 100 ms pass and its telemetry remain separate receipts.

This verifies removal of the observed Free-plan CPU failure for the recorded workload. The separate protocol error did not recur in either paid 1,000-request run; its independent cause is not proven. These bounded read bursts do not establish a sustained production capacity limit or provider/native-family evidence. The provisioning-only failure path also now preserves prior cohort receipts instead of overwriting the ten-family preflight record with a deployment failure.

### Today read follow-up

The hosted work prompted a check of the remaining screen reads. Today still read each parent's connection-window sources, conversation details, tomorrow's turn/draft and names separately. A new four-parent regression fixture measured 79 ordinary selects before the change versus 25 for one parent; it failed the intended read budget before the implementation. This is an additional local finding, not a failure observed in the original one-parent hosted cohort.

Today now batches connection-window sources, today's conversation rendering and tomorrow's turns/drafts/names across the family's recipients. Queries match each recipient's own today/tomorrow dates; received timestamps still determine connection windows, while provider timestamps still order displayed messages. Authorization, suggestion eligibility, language rendering and withdrawal rules remain in place. The existing light-status reader still performs per-parent reads; this change does not claim constant total queries.

A disposable PGlite comparison alternated baseline `ebb6c6a` and changed loaders over the same frozen synthetic data. After two warm-up pairs, ten measured pairs per cohort produced identical complete response hashes in every pair. Counts below include `selectDistinctOn`, unlike the ordinary-select-only regression fixture:

| Parents | Selects before | Selects after | Local warm p95 before | Local warm p95 after |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 26 | 24 | 8.03 ms | 6.95 ms |
| 4 | 83 | 39 | 16.80 ms | 10.16 ms |
| 10 | 197 | 69 | 37.05 ms | 16.32 ms |

See [comparison receipt](../load-tests/today-family-read-comparison.json). No network delay was injected. These are local warm timings and database query counts, not hosted latency or capacity measurements. New mixed-zone tests cover Taipei, Los Angeles, Kiritimati and Vietnam, per-parent tomorrow drafts, wrong-date exclusion and denied cross-family access. Existing Today/Lights/Memories tests cover content, translations, media, read-backs, consent and delivery states.
