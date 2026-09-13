# Engineering operations and quality: options as of September 2026

Due-diligence pass on the ops/quality tooling for the stack already chosen in `architecture/01-technical-design.md` and `architecture/decisions.md` (Cloudflare Workers + Hono, Cron Triggers + Queues, Neon Postgres via Hyperdrive, R2, Expo, channel adapters, Claude API). Goal: confirm or correct the existing picks (Sentry free tier, Workers analytics, a nightly KPI job) against what exists today, and fill the gaps — cron-failure alerting, analytics, CI/CD, migrations, testing, security, cost control, workflow tooling — with dated evidence. Estimates are flagged.

## 1. Recommendation, ten lines

1. **Observability:** keep Sentry (free Developer tier) for errors/performance, but don't rely on Cloudflare Cron Triggers for failure alerting — they retry nothing and alert nothing on their own ([runhooks.app](https://runhooks.app/blog/cloudflare-workers-cron-triggers-limits/); Cloudflare had a "Cron Triggers degraded" incident on [2026-09-09](https://community.cloudflare.com/t/workers-cron-triggers-degraded/957364)) — add an independent free heartbeat monitor pinged by every scheduler tick.
2. **Analytics:** run the founder's daily numbers (answer rate, latency, quiet notices, stop rate) off the `events`/`metrics_daily` Postgres tables already planned — zero cost, no family data leaves the region; add PostHog Cloud EU (free to 1M events + 5,000 replays/month, Frankfurt-hosted, [2026](https://posthog.com/blog/posthog-cloud-eu)) only for in-app funnels, flags, and mobile replay.
3. **CI/CD:** GitHub Actions for type-check/unit/contract tests (2,000 free Linux min/month; macOS runners now $0.062/min, ~10x Linux, since [Jan 1 2026](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)) — push iOS/Android builds to EAS Build instead of GH macOS runners, and use a Neon branch per PR for a real disposable Postgres.
4. **Migrations:** Drizzle ORM + drizzle-kit fits the edge-Postgres shape best — no proxy needed on Workers, where Prisma needs Accelerate or driver adapters plus `node_compat` workarounds ([makerkit.dev](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma); [pkgpulse.com](https://www.pkgpulse.com/guides/drizzle-orm-v1-vs-prisma-6-vs-kysely-2026)); skip Atlas/golang-migrate/dbmate, Drizzle already emits the reviewed-SQL-file flow the tech design specifies.
5. **Testing:** Vitest (built on `@sinonjs/fake-timers`, fakes `Date`, timers, and `Temporal` together) for scheduler/DST tests; Testcontainers (or pglite) for integration, a reserved Neon branch for control-plane smoke tests; fixture-based contract tests per adapter; k6 open-source (free, unlimited local) for load; Maestro CLI local/CI (free forever, vs. Maestro Cloud at [$250/device/month](https://testingbot.com/maestro-cloud-alternative)); Promptfoo (free, CI exit-code gate) for AI evals, matching ADR-8.
6. **Security posture:** Cloudflare Worker secrets are enough through the pilot; graduate to Infisical's free tier (open-source, self-hostable) only once secrets must sync across more than one environment or person. Verify every adapter's webhook signature on the raw body before parsing — non-negotiable, not optional.
7. **Workflow tooling:** pnpm workspaces + Turborepo (the 2026 default for a small TS monorepo — Nx/Bazel solve problems this team doesn't have) and Biome over ESLint+Prettier (one Rust binary, reported [10–25x faster](https://reintech.io/blog/typescript-biome-vs-eslint-linting-formatting-comparison-2026)), piloted against Expo/React Native rule coverage first.

## 2. Comparison tables

### Observability and cron/uptime monitoring

| Option | Free tier | Cost at scale | Verdict | Link |
|---|---|---|---|---|
| Cloudflare Workers Logs/Traces | ~6M events/mo free (3-day); 20M/mo paid (7-day) | $0.60/M beyond quota; tracing shares the quota from Oct 2026 | Raw log substrate; not sufficient alone for alerting | [docs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) |
| Sentry | Free Developer plan; 1 free cron monitor | Team ~$26/mo, Business ~$80/mo; extra cron monitors $0.78/mo | Already the right pick — add its Crons product for the tick | [pricing](https://last9.io/blog/sentry-pricing/), [Crons](https://sentry.zendesk.com/hc/en-us/articles/23058282687259) |
| Healthchecks.io | 20 checks free | $20/mo for 100 checks | Cheapest independent heartbeat — recommended | [pricing](https://healthchecks.io/pricing/) |
| Cronitor | 5 monitors free | $2/monitor + $5/user | Fine, pricier per-monitor than Healthchecks.io | [pricing](https://cronitor.io/pricing) |
| Better Stack | 10 monitors, 3-min checks | $24–29/mo per product | Good all-in-one later; modular pricing adds up now | [pricing](https://betterstack.com/pricing) |
| Grafana Cloud (Loki/Tempo/Mimir) | 10k series, 50GB logs+traces, 14-day retention | $0.45/GB, $6.50/1k series beyond | Production-capable free tier; only worth it if OTel adopted broadly | [pricing](https://grafana.com/pricing/) |
| Honeycomb | 20M events/mo free forever | Pro $130/100M events | Excellent UX; redundant with Sentry+Workers at pilot scale | [summary](https://costbench.com/software/apm-monitoring/honeycomb/) |
| Axiom | 500GB/mo free, 30-day retention | Usage-based from $25/mo | Log sink if Logpush volume outgrows Cloudflare's quota | [pricing](https://pricingsaas.com/companies/axiom) |

### Product analytics / event pipeline

| Option | Free tier | Cost at scale | Verdict | Link |
|---|---|---|---|---|
| Postgres + Metabase/Grafana on existing tables | $0 | Already-budgeted Neon compute | **Recommended** for the founder's ops view — no third party sees family data | tech design §7 |
| PostHog Cloud EU | 1M events + 5,000 replays/mo | Replay $0.005→$0.0015/recording; flags from $0.0001/request | Recommended add-on for funnels, flags, replay | [EU hosting](https://posthog.com/blog/posthog-cloud-eu) |
| Amplitude | Up to 10M events/mo, limited features | MTU-based, scales fast | Free tier restricts cohorts/experiments vs. PostHog | [comparison](https://mcgaw.io/blog/mixpanel-vs-amplitude/) |
| Mixpanel | Reported 1M–20M events/mo *(sources disagree — confirm at signup)* | Event-based | Plausible alternative; lacks flags/replay in one tool | [comparison](https://mcgaw.io/blog/mixpanel-vs-amplitude/) |
| Segment | $120/mo for 10k MTU | $10–12/extra 1k MTU | MTU billing is a bad fit for a low-MAU family app | [roundup](https://aboutmartech.com/blog/best-segment-alternatives/) |
| RudderStack / Jitsu | 1M events/mo free managed; unlimited self-hosted (both open source) | Per-event or infra only | Only worth it if a warehouse-native CDP is needed later | [comparison](https://improvado.io/blog/open-source-segment-alternative) |

### CI/CD, migrations, secrets

| Option | Free tier | Cost at scale | Verdict | Link |
|---|---|---|---|---|
| GitHub Actions | 2,000 Linux min/mo | Linux $0.006/min, macOS $0.062/min (2026) | Everything except mobile native builds | [2026 pricing](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) |
| EAS Build | 15 Android + 15 iOS builds/mo | Starter $19/mo, Production $199/mo incl. $225 credit *(per-build $ is an estimate)* | Cheaper/simpler than macOS GH runners | [usage pricing](https://docs.expo.dev/billing/usage-based-pricing/) |
| Neon branch-per-PR | 10 branches/project free | $1.50/branch-month beyond; autosuspend after 5 min idle | Recommended — idle PR branches cost ~nothing | [explainer](https://getautonoma.com/blog/does-neon-charge-per-branch) |
| Drizzle ORM + drizzle-kit | Free, open source | Free | Recommended — edge-native, reviewable SQL | [comparison](https://www.pkgpulse.com/guides/drizzle-orm-v1-vs-prisma-6-vs-kysely-2026) |
| Atlas / golang-migrate / dbmate | Free, open source | Free | Skip — duplicates drizzle-kit's SQL-file flow | [tool survey](https://www.bytebase.com/blog/top-database-schema-change-tool-evolution/) |
| Cloudflare Worker secrets | Free (native) | Free | Sufficient through the pilot | tech design §8 |
| Infisical | 5 identities/3 projects free; self-hostable | Pro $20/identity/mo | Graduate here once secrets must sync across environments | [pricing](https://infisical.com/blog/secrets-manager-pricing) |
| Doppler | 3 users free | $8/user beyond | Same role as Infisical, seat pricing bites sooner | [comparison](https://guptadeepak.com/infisical-vs-doppler-which-secrets-manager-is-right-for-your-team/) |
| Renovate | Free (AGPL / Mend-hosted app) | Free | Recommended over Dependabot for the monorepo | [renovatebot](https://github.com/renovatebot) |

### Testing and AI evals

| Option | Free tier | Cost at scale | Verdict | Link |
|---|---|---|---|---|
| Vitest + `@sinonjs/fake-timers` | Free | Free | Fakes `Date`/timers/`Temporal` together — fits scheduler DST tests | [Vitest config](https://vitest.dev/config/faketimers) |
| Testcontainers / pglite | Free | Free | Disposable Postgres per run / fastest pure-logic tests | [guide](https://oneuptime.com/blog/post/2026-01-25-integration-testing-testcontainers/view) |
| Neon branch (test) | 10 free | $1.50/branch-month beyond | Reserve for control-plane-specific smoke tests | [blog](https://neon.com/blog/docker-compose-neon-branches-testing) |
| k6 (open source) | Free, unlimited local | Cloud: 500 VUh free, then $0.15/VUh | Local k6 is enough pre-revenue | [pricing](https://toolradar.com/tools/k6/pricing) |
| Maestro CLI vs. Cloud | Free forever (local/CI) | Cloud $250/device/mo | Use local/CI; Cloud too expensive pre-revenue | [Maestro](https://github.com/mobile-dev-inc/maestro) |
| Promptfoo | Free, 10k red-team probes/mo | Enterprise custom | Recommended CI gate (exit code 100 on regression) | [comparison](https://www.braintrust.dev/articles/braintrust-vs-promptfoo) |
| Braintrust | Starter free (1GB, 10k scores) | Pro $249/mo flat | Add later for production AI-call tracing, not the CI gate | same |

## 3. Alerts and SLOs for the arrival pipeline

Two facts drive this list: **Cloudflare Cron Triggers neither retry nor alert on failure** ([runhooks.app](https://runhooks.app/blog/cloudflare-workers-cron-triggers-limits/)), and Cloudflare had a "Workers Cron Triggers degraded" incident on [2026-09-09](https://community.cloudflare.com/t/workers-cron-triggers-degraded/957364) — so tick-liveness must be watched from outside Cloudflare.

**SLOs:** arrival send P95 ≤ 5 min after `arrival_hour`, P99 ≤ 15 min (5-minute cron granularity is the practical floor); scheduler tick completes at least once every 10 minutes per region; duplicate sends zero (DB constraint is the real guarantee, alert is a backstop); zero quiet notices attributable to our own outage (§4 silence drill); webhook ack P95 ≤ 1 s.

| Signal | Threshold | Where | Severity |
|---|---|---|---|
| No scheduler tick recorded | > 10 min since last heartbeat | Independent monitor (Healthchecks.io / Sentry Crons), not Cloudflare | Page immediately |
| Arrival unsent | Past T+5 min | KPI-job check / Queue-depth alert | High |
| Arrival unsent | Past T+3 h (per existing escalation) | Application event, organiser told once | High, product-visible |
| Budget-table drop of `arrival`/`quiet_notice` | Any occurrence | Sentry log alert | Medium (should never happen) |
| Adapter send failure rate | >5% on one channel in 15 min | Sentry performance alert | High |
| Dead-letter queue growth | Any message | Cloudflare Queues DLQ + Sentry | High |
| Quiet notice fired | Every occurrence | Logged to `quiet_events`, reviewed daily | Informational — feeds precision metric |
| Cloudflare/Neon/Anthropic/Twilio spend | 50/80/100% of tier | Native budget alerts (§6) | Medium |
| Postgres unreachable | 5xx spike via Hyperdrive | Sentry + synthetic `/health` check | Critical |

## 4. Test pyramid, with DST and the silence drill

```
        AI evals (Promptfoo — gate every prompt change; flag recall must not drop)
       /                                                                        \
  E2E (Maestro CLI): onboarding, invite, first arrival, first answer
     /                                                                  \
  Integration (Testcontainers/pglite + a reserved Neon branch): scheduler query,
  gateway budget+idempotency, adapter parseWebhook against fixtures
     /                                                                            \
  Unit (Vitest): composer, ladder, budget table, time math, adapter render logic
```

**DST cases** (Vitest + `@sinonjs/fake-timers`, which fakes `Date`, timers, and `Temporal` in one call): spring-forward (a member's `arrival_hour` inside the skipped hour must get exactly one arrival, not zero or two); fall-back (the repeated local hour must not double-send — `UNIQUE(member_id, day)` plus a test that `next_arrival_at` recomputation is idempotent across it); a non-DST zone (Russia, no DST since 2014) run alongside a DST zone in the same suite, to catch single-offset assumptions; a half-hour-offset zone (`Australia/Lord_Howe`) to catch offset-math bugs whole-hour cases miss.

**Silence drill** — the test proving our own outage never triggers a quiet notice:
1. Adapter `send()` throws for a cohort; assert the organiser gets the one-time "we couldn't reach Mom" notice and `quiet_events` stays empty (already named in the tech design's failure table — the drill makes it executable).
2. Simulate a missed cron tick entirely; assert the next tick still respects `UNIQUE(member_id, day)`, and assert the *external* heartbeat monitor would have paged the founder — the application itself cannot know it missed its own wake-up.
3. Postgres unreachable during the tick window; assert ticks skip cleanly with no false-positive quiet event, and an admin alert fires.
4. AI provider down; assert the light still lights on the raw answer (ADR-5) and no quiet notice fires because "understanding" is merely delayed.
5. Run the drill on a schedule in CI, not only at review time, so a refactor regression is caught before it reaches a real family.

**Contract tests** for adapters use recorded webhook fixtures, valid and tampered, through `verifyWebhook()`/`parseWebhook()`: LINE (HMAC-SHA256 over the raw body with the channel secret, `x-line-signature` header — [LINE docs](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)); WhatsApp Cloud API (HMAC-SHA256 over raw body with the app secret, `X-Hub-Signature-256`, timing-safe compare, plus the `hub.challenge` handshake — [Hookdeck](https://hookdeck.com/webhooks/skills/whatsapp-webhooks)); Telegram (secret-token header match). A tampered-body fixture must fail every adapter, every time.

## 5. Security and privacy checklist

**Pilot (phase 0–1, near-zero budget)**
- Every adapter verifies its signature/secret token against the raw body before parsing — CI-enforced contract test, not a review checklist item.
- Cloudflare's native Rate Limiting binding (free) on invite-link redemption and any auth endpoint, against brute-force and scraping ([docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)).
- Secrets only in Worker secrets / `.dev.vars`, never in the repo (already an ADR).
- TLS everywhere; Neon/R2 provider-level encryption at rest is sufficient for the pilot; defer field-level transcript encryption to launch (pgcrypto pushes key management onto the app — [Sahaj Software](https://www.sahaj.ai/a-practical-guide-to-implementing-sensitive-data-encryption-using-postgres-pgcrypto/)).
- A quarterly restore drill against Neon's point-in-time restore (1–30 day history by plan — [docs](https://neon.com/docs/manage/backups)): restore to a timestamp, verify row counts, discard. PITR existing is not the same as a proven restore.
- Admin reads of family data logged as visible-to-organiser events (already an ADR) — verify it is actually wired.
- Budget alerts on: Cloudflare (default $10 threshold, informational — [changelog](https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/)), Neon (80%/100% of org limit, checked ~every 15 min — [docs](https://neon.com/docs/introduction/spending-notifications)), Anthropic (spend-limit notifications in billing settings).
- A one-page incident runbook (notify, rotate a leaked secret, post a status update) and a one-page DPA/sub-processor list (Anthropic, Cloudflare, Neon, the messaging providers, Supabase Auth) — cheap to write now, expected before any paying customer asks.

**Launch (paying customers, more jurisdictions)**
- Decide field-level encryption for voice transcripts (pgcrypto vs. app-layer envelope encryption, AES-256-GCM) before retrofitting gets expensive at scale.
- Explicit retention-tag + deletion job per table; for India's DPDP, add a **48-hour pre-deletion notice** step where Indian data principals are in scope — distinctive vs. GDPR/APPI — and confirm sub-processors also delete, since DPDP holds the fiduciary responsible ([handbook](https://www.levo.ai/resources/blogs/the-dpdp-india-2026-handbook---the-complete-guide-to-indias-new-data-protection-era)).
- Treat any Japan launch as its own legal-review pass — APPI is reported as one of the more actively enforced regimes in the region, not a GDPR-equivalent to assume away.
- A public status page: Instatus free Starter (15 monitors, 1 page, 5 members) covers pilot scale; Better Stack's modular pricing pays off once uptime+incident+logs are all needed together.
- Re-evaluate SOC2-lite tooling (Vanta, Drata, or open-source Comp AI) only once a paying institutional customer requires an audit trail; until then, a written security policy, MFA everywhere, and the access-log ADR substitute for it.
- A written OTA policy for EAS Update — bug fixes, copy, layout only, nothing that changes features or entitlements outside store review (Guideline 2.5.2/3.3.2); misuse risks account suspension, not just rejection.

## 6. Risks

- **Cron reliability is the biggest structural gap.** Cloudflare Cron Triggers retry and alert on nothing themselves, and Cloudflare's status page recorded a degraded-Cron-Triggers incident on 2026-09-09. Skipping the independent heartbeat monitor could let a missed tick silently blow the 5-minute promise.
- **WhatsApp pricing is moving under us.** Per-message billing replaced conversation-based billing on 1 July 2025; service replies inside the 24-hour window, free today, become chargeable from 1 October 2026 (rates due ~1 September 2026). Revisit the cost model in tech design §11 against those rates before WhatsApp volume grows.
- **Only Neon offers a hard spend cap** (per-project quotas that suspend compute); Cloudflare's and Anthropic's budget alerts are informational only. A retry storm could still produce a surprise bill on either.
- **Expo Go's sharing model changed on 2026-05-12** — it now only loads projects the signed-in account can access, so it can't hand a build to pilot families via public QR code anymore. Dev-client + TestFlight/Play internal testing is now required for external testers.
- **Field-level encryption and DPDP's 48-hour notice are open design questions**, not yet ADRs; they should be decided once a launch jurisdiction is confirmed, not under deadline pressure.
- **Reported free-tier figures for Mixpanel are inconsistent across sources** in this research pass — confirm directly at signup before planning against a specific number.
- **Data residency for AI calls isn't closed by database region alone.** Confirm Anthropic API data-handling terms match each region's expectations (EU/APAC/US) before treating "Postgres per region" as sufficient for AI-adjacent residency claims.
