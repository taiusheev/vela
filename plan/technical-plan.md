# Technical plan: from staging to daily use

Written 8 October 2026 by Claude (tech co-founder). This plan covers engineering only. Launch gates and founder decisions stay in the [launch plan](https://claude.ai/code/artifact/578a4d88-808c-4529-9fc8-f1b36c7c51d1), and the trial's evidence stays in [`english-trial-readiness.md`](english-trial-readiness.md). Update the Status column as steps land.

## What "ready for daily use" means

Vela is ready for daily use when it meets these targets in production for 30 days with real families. Each one is measured, not assumed.

| Target | Measure | Where it is read |
|---|---|---|
| Her morning arrives on time | ≥ 99.5% of scheduled arrivals delivered within 5 minutes of her time | `arrival_delivered` vs prepared exchanges |
| Nothing is sent twice | 0 duplicate arrivals, read-backs or quiet notices | outbound idempotency keys, race drill |
| No false alarm from our own failure | 0 quiet notices caused by a delivery, scheduler or provider failure | quiet outcomes, `scheduler_missed` |
| Her answer lights the light fast | p95 answer → light under 30 s, even with AI down | events latency |
| Data survives | restore within 1 hour, at most 1 hour of data lost | restore drill on production |
| The app does not crash | ≥ 99.5% crash-free sessions | crash reporting (step 5.3) |
| AI stays safe | flag recall 100% on the golden set at every prompt change; live flag cases pass | evals, `ai_calls` |
| Someone is told when Vela breaks | an alert reaches the founder within 15 minutes | external monitor + ops alerts |

## Where we are (8 October 2026)

The code for the v1 loop is built and tested: about 4,300 automated tests, a PostgreSQL race drill, Maestro app journeys and AI evals. It runs on staging with OpenAI, Telegram and LINE, with synthetic families only. Production is configured but never deployed (`API_V1`, `PUSH_SEND`, `BOOK`, `MEMORY` off). Push to phones is built but off everywhere. The app has no crash reporting. Our Cloudflare token cannot read Worker logs. There is no external uptime monitor yet (founder task), and the 10× load report and the production restore drill are not done.

## Workstreams

Steps are ordered within each workstream. "F" marks a step that needs the founder: a purchase, an account, a key or an approval.

### 1. Production foundation

| # | Step | Done when | Needs | Status |
|---|---|---|---|---|
| 1.1 | Production preflight command | `pnpm --filter @vela/worker preflight -- --env production`, or the manual `preflight` workflow: placeholders, the Workers' own config readers on real secret names, queues, Hyperdrive, bucket lifecycle; PASS or what is missing, no values printed (migrations are applied by the deploy job) | — | Done: staging passes 18/18 |
| 1.2 | Domain to the Vela Cloudflare account | vela-light.com in the Workers account; routes, Full-strict SSL, HSTS, DNSSEC | F (17 Oct) | Waiting |
| 1.3 | Clerk production instance on the domain | `sk_live_` on production; webhook signed; `user.deleted` proven | F | — |
| 1.4 | Production secrets and storage | content key, OpenAI key, Telegram/LINE secrets, R2 bucket with 32-day lifecycle on asks/replies/device | F (keys at hidden prompts) | — |
| 1.5 | First tagged release `v0.1.0` | tag from main, CI green on that commit, migrations, both Workers, smoke | F (approval) | — |
| 1.6 | Production restore drill | restore under 1 hour, counts and sampled files match; decide how much Neon history to keep (it sets how far back a restore can go) | F (plan cost) | — |

### 2. Reliability and observability

| # | Step | Done when | Needs | Status |
|---|---|---|---|---|
| 2.1 | Ops alerts to the founder | the founder's admin chat gets one message when arrivals fail, sends drop, the scheduler misses, AI fails over 20% in an hour, or LINE quota passes 80%; never content | — | Done (`packages/services/src/ops.ts`; LINE quota alert already existed) |
| 2.2 | Daily ops digest | after the nightly run (03:20 UTC, 11:20 Taipei): mornings delivered/failed, answers, quiet notices and outcomes, AI failures and cost, per environment; content-free | — | Done (`opsDigest`) |
| 2.3 | External uptime monitor | free monitor on `/healthz` keyword `"status":"ok"` every 5 min for staging and production | F (account) | Waiting |
| 2.4 | Log access | Cloudflare token with Workers Observability read, or Logpush to R2, so failures can be investigated without the dashboard | F (token scope) | — |
| 2.5 | Silence drill parts A, B, D | each run once on staging, receipts saved | F (2nd Telegram) | — |
| 2.6 | 10× load report | 10× expected morning peak through queues and Postgres; p95, errors and duplicates recorded | — | — |
| 2.7 | Queue dead-letter review | a failed message is visible on the admin page and replayable once, never silently lost | — | Done: dead jobs kept sealed 14 days, hourly alert, admin replay-once |

### 3. Channels

| # | Step | Done when | Needs | Status |
|---|---|---|---|---|
| 3.1 | Telegram loop on staging | test-week checklist (admin) all green, 7 mornings | F (test accounts) | In progress |
| 3.2 | LINE full loop including the family group | group linked, replies read back, unsend handled, on staging | F (LINE test group) | In progress |
| 3.3 | LINE plan and quota | paid Official Account before the first LINE family; quota alert from 2.1 | F (plan) | — |
| 3.4 | Media on every channel | photos and voice both ways on Telegram and LINE, iPhone plays every format | signed build | — |

### 4. AI quality and safety

| # | Step | Done when | Needs | Status |
|---|---|---|---|---|
| 4.1 | Rubric judge and OpenAI reminders | judged golden set without Promptfoo; reminders v3 | — | Done (PR #34, #36) |
| 4.2 | Eval on every prompt change | CI runs the golden set (with the founder's key as a GitHub secret) when `packages/ai/src/prompts` or OpenAI routing changes; weekly judged run | F (key as secret, ~US$1/run) | — |
| 4.3 | Live safety scenarios | synthetic fall with and without health-words consent, scam call, weekly read draft: each with a receipt | F (test parent sends scripted words) | — |
| 4.4 | AI cost and failure watch | `ai_calls` cost/day, failure rate and latency by call on the admin overview; per-family daily cost cap | — | — |
| 4.5 | Model pinning | dated snapshot pinned (`gpt-5-2025-08-07`), upgrade only through 4.2 | — | Done: `OPENAI_SNAPSHOT_FOR` (gpt-5-2025-08-07, gpt-5-mini-2025-08-07), live-checked |

### 5. The app

| # | Step | Done when | Needs | Status |
|---|---|---|---|---|
| 5.1 | In-app account deletion | You → Delete account; Clerk and Vela; families safe | — | Done (PR #38) |
| 5.2 | Signed iPhone build and TestFlight | build on a real iPhone; voice plays; VoiceOver pass; TestFlight review passed | F (Apple US$99) | — |
| 5.3 | Crash reporting | crash-free rate visible; no family content, names or tokens in reports; notice names the processor | F (provider choice, notice) | — |
| 5.4 | Push on | Expo + APNs + FCM; quiet notice and flags reach app-only organisers; "one moment a day" respected | F (Expo/Firebase/Apple) | — |
| 5.5 | Fast fixes without a store review | EAS Update channel per environment, JS-only fixes, policy in `infra/runbooks/ota-policy.md` | — | — |
| 5.6 | Android | Play internal track; same journeys | F (Play US$25) | — |
| 5.7 | Store and privacy pack | listings en/zh-TW, Apple privacy answers, Google data safety, review notes, checked against the code | — | Done: `plan/materials/stores/` (zh-TW to native review; Health answer for counsel) |

### 6. Data, privacy and security

| # | Step | Done when | Needs | Status |
|---|---|---|---|---|
| 6.1 | Content sealing on production | ADR-38 key on production before the first family; rotation rehearsed | F (key) | Built |
| 6.2 | Deletion end to end | account, family and data-request deletion proven on production with synthetic data | — | Partly |
| 6.3 | Dependency and secret scanning | Dependabot + CodeQL + secret scanning on the repo; weekly review | — | — |
| 6.4 | Notice and consent updates | notice says what deletion keeps, names push/crash processors; Taiwan zh-TW notice | F (counsel) | — |
| 6.5 | Security review before launch | auth, admin access, webhooks, media URLs, rate limits reviewed; findings fixed | — | First pass done: `infra/security-review-2026-10.md`, 3 fixes; repeat before launch |

### 7. Product gaps for daily use

| # | Step | Done when | Needs | Status |
|---|---|---|---|---|
| 7.1 | Test-week checklist | admin page ticks gate 1 from events | — | PR #39 |
| 7.2 | App-only organisers are told everything | flags, stop, failed delivery and consent answers reach app organisers (today Telegram only) | 5.4 | — |
| 7.3 | Change her morning time and language from the app | organiser edits; schedule moves without a double or missed morning | — | — |
| 7.4 | Help and support | in-app help, support inbox, status line when Vela has a problem | In-app help from You/sign-in; existing support inbox; bounded public heartbeat status without family credentials. | Native iPhone navigation/status and email handoff, inbox receipt, native zh-TW copy review remain open. |
| 7.5 | Weekly read in the app with a push | read opens from a notification | 5.4 | — |

### 8. Engineering process

| # | Step | Done when | Status |
|---|---|---|---|
| 8.1 | Release train | weekly production release from a tag after 24 h on staging; hotfix path documented | — |
| 8.2 | Migration safety | expand/contract rule and a check that fails a migration dropping or renaming a column in one step | Done: `packages/db/src/migration-safety.test.ts` |
| 8.3 | Incident practice | `infra/runbooks/incident.md` drilled once on staging; who is woken and how | — |
| 8.4 | Two-agent coordination | Claude and Codex claim files in `AGENT-CLAIMS.md`, one deploy at a time | Running |

## Order

1. **Now → 17 Oct:** 7.1, 1.1, 5.7, 2.1, 2.2, 4.4, 6.3. Engineering only, no purchases.
2. **17 Oct → production:** 1.2–1.6 with the founder; 2.3, 2.4.
3. **Before the Vietnam week:** 5.2, 3.1 green, 4.3, 2.5, 2.6; Apple paid 5–7 days before.
4. **During the English trial:** 5.3, 5.4, 7.2, 5.5, 8.1; fix what the family week shows.
5. **Before the Taiwan LINE pilot:** 3.2, 3.3, 3.4, 6.4 (zh-TW), 7.3, 7.4.
6. **Before public launch:** 4.2, 5.6, 6.5, 7.5, 8.2, 8.3; 30 days on the targets above.

## Founder dependencies and costs

| When | What | Cost |
|---|---|---|
| 17 Oct | Move vela-light.com to the Vela Cloudflare account | — |
| Before production | Clerk production keys, production secrets at hidden prompts, approve `v0.1.0` | — |
| Before production | Uptime monitor account; Cloudflare token with log read | free |
| Production restore | Neon history retention decision | free or paid plan |
| 5–7 days before Vietnam | Apple Developer | US$99/yr |
| During trial | Expo/Firebase for push; crash-reporting provider choice | free tiers |
| Before LINE families | LINE paid Official Account plan | monthly |
| Ongoing | OpenAI usage: about US$1 per judged eval run plus live calls | usage |
