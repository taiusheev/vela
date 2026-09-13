# Backend platform and data layer — recommendation and evidence

Researched September 13, 2026, from vendor pricing/docs pages (secondary sources marked). Scale assumption: **~40 requests + 3 scheduled jobs per family per day** → ~1.29M events/month at 1k families, ~12.9M at 10k, ~129M at 100k.

## 1. Recommendation (ten lines)

1. **Platform: Cloudflare Workers (Hono) + Queues + Durable Objects + R2 + Hyperdrive.** Cheapest at all three scales ($5/mo minimum; still under ~$100/mo at 100k families), and one bill/dashboard for a solo founder whose AI co-founder writes the ops code.
2. It is the only surveyed platform with a **native per-object precise wake-up primitive** (Durable Object alarms) instead of a per-minute cron scan — the safest base for "one message per family per day."
3. **Database: Neon Postgres, one project per region** (Singapore/APAC, Frankfurt/EU, US-East). Real Postgres (RLS, pgvector, logical replication, built-in pooling), each project physically pinned to one region.
4. Neon's **scale-to-zero, per-CU-hour billing** fits a near-zero pilot budget — an idle region costs only ~$0.35/GB-month storage between bursts of activity.
5. **Storage: Cloudflare R2** — zero egress fees matter for repeated cross-region fetches of photos/voice notes; an EU-jurisdiction bucket flag exists for GDPR-labelled storage.
6. **Scheduling pattern:** one Durable Object per family, alarm-based, with the next run **recomputed from the family's IANA timezone on every fire** — never a fixed 24h offset, which is what makes it DST-safe.
7. **Idempotency:** outbox pattern with a Postgres unique constraint on `(family_id, send_date)`, because Cloudflare Queues — like nearly everything surveyed except SQS FIFO — is at-least-once only with no built-in dedup.
8. **Auth: Clerk** (free to 50,000 monthly retained users, covering the 1k/10k scale for free), with **Better Auth** as the zero-cost self-hosted fallback; both have first-class Expo/React Native support.
9. **Admin: a small Next.js/Remix admin**, not a low-code tool — Retool/Forest Admin/Appsmith charge $40–65 per builder-seat monthly for what a few purpose-built TypeScript screens replace at near-zero cost.
10. **Biggest flagged risk:** Cloudflare is a US corporation; the CLOUD Act reaches R2/Durable Object data regardless of the "EU jurisdiction" flag. If a regulator ever requires no-US-nexus storage, fall back to Neon/Supabase (unchanged) behind Fly.io or Render compute.

## 2. Comparison tables

### 2a. Serverless / edge compute + scheduling

| Platform | Free tier | Cost @1k/10k/100k families (est.) | Cold starts | Cron precision | Queue guarantee | Max exec | Regional control |
|---|---|---|---|---|---|---|---|
| **Cloudflare Workers** | $5/mo incl. 10M req + 30M CPU-ms [1] | ~$5 / ~$10–15 / ~$60–70 [1] | None (V8 isolates) | Minute-granularity, UTC; config changes ≤15min to propagate [2] | Queues: at-least-once, **no dedup**, retries+DLQ [3] | 15 min [1] | Regional Services pins *execution*, not deployment; excludes Queues/Cron [10] |
| **Vercel Functions + Cron** | Hobby: 2 jobs, 1×/day [4] | Pro $20/mo/seat + usage, no bundled invocations [4] | Yes | Pro: 100 jobs/project, per-minute [4] | No native queue | Runtime-dependent | No per-user region pinning |
| **AWS Lambda + EventBridge Scheduler + SQS** | Lambda 1M req free forever; Scheduler 14M invocations free; SQS 1M req free [5] | ~$0 / ~$5–10 / ~$40–60 [5] | Yes unless provisioned | **True one-off per-user schedules**, 60s window, **native IANA DST handling** [6] | SQS FIFO: dedup via 5-min window; Standard: at-least-once | 15 min | Full — deploy per AWS region |
| **Google Cloud Run + Scheduler + Tasks** | 2M req free; 3 Scheduler jobs/mo free [7] | ~$5 / ~$15–25 / ~$80–120 (per-job pricing costly per-user) [7] | Yes | Project-level jobs, not naturally per-user | Cloud Tasks: at-least-once, dedup via task-name reuse | 60 min | Full |
| **Fly.io Machines** | Trial credit only (secondary) [8] | Always-on VM/sec; ~$92/mo for 3 regions (secondary) [8] | None if warm | Bring your own | Bring your own | Unbounded | Named regions incl. Singapore/Tokyo/Frankfurt [8] |
| **Railway** | $5 Hobby incl. $5 credit [9] | ~$5 / ~$20–40, no per-request billing (secondary) [9] | None if warm | Bring your own | Bring your own | Unbounded | 4 regions, US/EU/Asia (secondary) [9] |
| **Render** | Free web (sleeps); cron from $1/mo [11] | Worker from $7/mo + cron [11] | None on paid tier | Managed cron, one config per job [11] | Bring your own | Unbounded | Oregon, Ohio, Frankfurt, Singapore — **no Tokyo/Sydney** [11] |
| **Supabase Edge Fn + pg_cron** | 500K invocations free [12] | Bundled + $2/M over | 200–800ms (secondary) [12] | pg_cron: minute-granularity, same cron-scan pattern | No native queue semantics | 150s typical | One region per project (2b) |

**Verdict:** Cloudflare wins on cost and gives a genuine per-user scheduling primitive. EventBridge Scheduler is the most theoretically correct DST-safe primitive, but ~100k live one-off schedules plus Lambda/SQS/IAM is more operational surface than a solo team needs. Fly.io/Railway/Render are simpler (an always-on process) but lose the pay-per-use edge at low volume and lack managed scheduling/queues.

### 2b. Postgres providers

| Provider | Regions (relevant) | Pricing 2026 | PITR | RLS | pgvector | Logical repl. | Serverless pooling | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Neon** (chosen) | Singapore, Sydney, Frankfurt, London, 3 US — **no Tokyo** [13] | Free (100 CU-h+0.5GB); Launch $0.106/CU-hr; Scale $0.222/CU-hr; storage $0.35/GB-mo [14] | Yes | Yes (off by default) | Yes | Yes, needs **unpooled** conn string [15] | Built-in PgBouncer, ≤10,000 conns [15] | Best cost-to-residency ratio; gap is Tokyo |
| **Supabase** | 16 AWS regions incl. Singapore, **Tokyo**, Sydney, Frankfurt, US [16] | Free; Pro $25/mo/org + compute add-on ($10–$3,730) [17]; PITR $100/mo per 7-day window [18] | Yes | Yes | Yes | Yes | Supavisor built-in | Runner-up for Japan residency; ×3 regions ≈$75+/mo baseline |
| **PlanetScale (Postgres)** | 24+ regions, single primary/DB [19] | From $5/mo; storage $0.50/GB after 10GB; egress $0.06/GB after 100GB [19] | Unconfirmed | Unconfirmed | Unconfirmed | Unconfirmed | Unconfirmed | Attractive price, parity unverified here |
| **Crunchy Bridge** | Any AWS/Azure/GCP region [20] | $9–35/mo Hobby; $140/mo Standard-8; storage $0.10–0.23/GB [20] | Yes | Yes | Yes (v0.7+) | Yes, incl. CDC | PgBouncer add-on | Solid, pricier than Neon for 3 regions |
| **AWS Aurora Serverless v2** | Any AWS region | $0.12/ACU-hr (0.5 min ≈$43.80/mo/region); storage $0.10/GB [21] | Yes | Yes | Yes | Yes | Needs RDS Proxy (extra cost) | "Enterprise correct," ~3× Neon's floor |
| **Google Cloud SQL** | Singapore, Tokyo, EU, US [22] | Per-vCPU/GB-hr; HA ≈2× Zonal; 25–52% w/ commit [22] | Yes | Yes | Yes | Yes | No built-in pooler | Full control, full ops burden pre-revenue |
| **Xata** | Managed: us-east-1, eu-central-1 only (BYOC elsewhere) [23] | ~$9/mo micro + $0.28/GB; EU ×1.15 [23] | Not a focus | Yes | Yes | Unconfirmed | Built-in | Ruled out — no APAC without BYOC |
| **Turso/libSQL** | 35+ edge regions (secondary) [24] | Free 5GB/500M row-reads; $4.99–$24.92/mo [24] | Limited | No (not PG) | No | N/A | N/A | Ruled out — SQLite semantics don't fit RLS-dependent compliance data |
| **Cloudflare D1** | Bound to Worker, single region | Rows read $0.001/M; written $1.00/M; storage $0.75/GB [1] | No PG parity | No | No | No | N/A | **Ruled out** — free-tier daily row caps enforced Sept 1, 2026, already an outage cause elsewhere [25][26] |

### 2c. Object storage

| Option | Storage | Egress | Free tier | Notes |
|---|---|---|---|---|
| **Cloudflare R2** (chosen) | $0.015/GB-mo [27] | **$0** [27] | 10GB + 1M/10M ops [27] | EU-jurisdiction flag pins objects to EU DCs but doesn't remove US CLOUD Act reach — Cloudflare Inc. is US-incorporated [28][29]; a labelling control, not a legal firewall |
| **AWS S3** | ~$0.023/GB-mo | $0.09/GB [27] | 5GB/12mo | Egress dominates for media-heavy apps; ruled out as primary |
| **Backblaze B2** | $0.006/GB-mo | Free to 3× stored data, then $0.01/GB via Bandwidth Alliance [27] | 10GB | Viable cold-archive tier once volume grows |
| **Supabase Storage** | Bundled in project cost | Not free | Included allowance | Only sensible if already all-in on Supabase |

Signed URLs and 30-day lifecycle deletion are native to R2 and Supabase Storage. No edge platform does native audio transcoding — Workers can't run ffmpeg; Cloud Run/Lambda containers can. **Recommendation: encode client-side in Expo**, skipping server-side transcoding.

## 3. Scheduling design (Cloudflare)

**Primitive:** one Durable Object per family, storing `next_ask_at` (UTC epoch) and the family's IANA timezone.

1. On creation or preference change, compute "today at HH:00 in tz" → UTC (via Temporal/Luxon) and call `setAlarm()`.
2. On fire, the `alarm()` handler: (a) `INSERT INTO daily_sends (family_id, send_date, …) VALUES (…) ON CONFLICT (family_id, send_date) DO NOTHING` — a unique constraint on the family's **local** calendar date is the idempotency key; (b) enqueues a Cloudflare Queues message only if the row was actually inserted; (c) recomputes tomorrow's time from the IANA zone (never `+24h`) and re-arms the alarm — this is what survives DST, since "tomorrow at 9am Asia/Taipei" is correctly 23 or 25 hours away on transition days because it's derived from wall-clock time, not a fixed duration.
3. **Consumer side:** the Queue consumer sends via LINE/WhatsApp/Telegram, then sets `sent_at`. Since Cloudflare Queues is at-least-once with no documented dedup [3], a redelivered message re-reads the row, sees `sent_at` set, and no-ops — the standard **outbox pattern**: neither a duplicate alarm fire nor a duplicate queue delivery can cause a second send, because the actual gate is a database row.
4. Silence detection reuses the same DO by arming a second, later alarm for the "quiet notice" cutoff (a DO holds one active alarm at a time, so pending timestamps are queued in storage and the handler re-arms for the next one) [30].
5. Cron Triggers are reserved for account-wide housekeeping only — never per-family sends, since a shared per-minute scan doesn't cleanly scale to 100k independently-timed families and reopens the double-send risk the alarm+outbox design avoids by construction.

This rebuilds, on a cheaper platform, what AWS EventBridge Scheduler gives natively (one-off, IANA-aware, DST-correct schedules [6]) — Cloudflare has no first-class equivalent, so correctness is reconstructed at the application layer.

## 4. Data residency and legal minimum checklist

- **Physical residency:** one Postgres project per region — Neon regions are fixed at creation; migration needs a new project [13].
- **Jurisdiction flags** (R2/DO `eu`/`us`) constrain storage location and execution, not Cloudflare Inc.'s own legal exposure — never represent this as "hosted by a local entity" [10][28][29].
- **Japan (APPI, amended Jan 1 2026):** moving a Japanese user's data outside Japan needs prior consent plus a transfer record (date, recipient, categories) kept **3 years**; no small-business exemption exists [31]. If Japan volume grows, prefer a Tokyo Supabase project over routing through Singapore.
- **India (DPDP):** cross-border transfer allowed by default (negative-list, not a whitelist) unless the destination is specifically restricted; stricter localization applies mainly to Significant Data Fiduciaries — unlikely at pilot scale, recheck before launch [32].
- **Taiwan (PDPA, amended Nov 2025, new PDPC regulator):** transfer generally permitted, restrictable if the destination lacks adequate protection; 2026 brings tougher breach notification and fines to ~NT$15M (~US$470k). Update privacy notices within 90 days of operating; appoint a DPO within 180 days where warranted [33].
- **GDPR minimums regardless of size:** a signed DPA with every sub-processor, a sub-processor list with ~30 days' notice before adding one, a data map, breach notice to the controller within ~24–48h (inside the 72h deadline), and defined deletion windows (~30 days live, ~90 days backups) [34].
- **Vela-specific gap:** silence-triggering-a-notice-to-another-family-member is itself a third-party disclosure — the consent flow must cover it explicitly; no vendor DPA does this for us.

## 5. Auth comparison

| Provider | Free tier | Cost @10k/100k MAU | Phone OTP | Expo/RN | Verdict |
|---|---|---|---|---|---|
| **Clerk** (chosen) | Free to 50,000 MRU (retained, not MAU) [35] | Free at 10k; ~$1,025/mo at 100k MRU ($25+$0.02×50k over) [35] | Included, no per-message surcharge [35] | First-class plugin | Best DX; watch the MRU-vs-MAU gap past 50k |
| **Better Auth** (fallback) | Free, MIT, self-hosted [36] | $0 infra beyond own compute | Bring your own SMS provider | Official Expo plugin [36] | Zero recurring cost, more integration work |
| **Supabase Auth** | 100,000 MAU incl. on paid plans, then $0.00325/MAU [37] | ~$0 at both scales (within included band) | Phone MFA add-on $75/mo +$10/mo/extra project [37] | Supported | Worth it only if already on Supabase for the DB |
| **Auth0** | Limited free | 2–3× Stytch's per-user cost (secondary) [38] | Provider-dependent | Supported | Not cost-competitive |
| **Firebase Auth** | 50,000 MAU free [37] | $0.0055/MAU beyond | Provider rates | Supported | Cheap, less TS-idiomatic |
| **Cognito** | Cut to 10K MAU free in 2026; ~3× pricier past 60K (secondary) [38] | Notably worse value than before | Via SNS/Pinpoint | Supported | Recent changes make this weaker than it was |
| **Stytch** | Free to 25 MAU, then $0.05/MAU (secondary) [38] | ~$500/mo at 10k; ~$5,000/mo at 100k | Included | Supported | Priced for funded startups |
| **Twilio Verify** (reference) | — | — | $0.05/verification + SMS (~$0.058 US total; near-floor in India) [39] | — | What "phone OTP" costs regardless of wrapper |

## 6. Admin/back-office

| Option | Cost for one founder | Verdict |
|---|---|---|
| **Retool** | Free: 5 users, 500 workflow runs/mo; Team ~$10–12/builder; Business ~$50–65/builder [40] | Free tier may suffice at pilot scale, becomes a real per-seat cost with a second operator |
| **Forest Admin** | Sales-quote only [41] | Opaque pricing is itself a reason to avoid |
| **Appsmith** | Free self-hosted; Business cloud ~$40/user/mo [42] | Free tier viable but adds hosting burden for a team of one |
| **Refine.dev** | Open-source, no vendor fee | Closer in spirit to the recommended custom admin |
| **Custom Next.js/Remix admin** (chosen) | ~$0 marginal — same Cloudflare account/Postgres/API | Cheapest to build *and* operate given the code is written either way; avoids routing family data through a third-party admin tool's sub-processor chain |

## 7. Risks and what would make us switch

- **US-corporation exposure:** Cloudflare's jurisdiction flags don't remove CLOUD Act reach. A no-US-nexus requirement would push storage to Backblaze B2/EU provider and compute to Fly.io/Render [28][29].
- **No Tokyo on Neon:** re-run this analysis against Supabase or Cloud SQL if Japan becomes a primary market before EU/US [13][16][22].
- **No native queue dedup:** the outbox pattern in §3 covers this today but depends on disciplined code; SQS FIFO in front of the send path is the fallback if broker-level dedup is ever required.
- **Very recent Cloudflare billing additions** (DO SQLite storage, Jan 2026; Workflows steps, Aug 2026) are more likely to shift again than decade-old AWS pricing — recheck after 3–6 months of real usage.
- **D1's Sept 1, 2026 free-tier enforcement**, which has already caused outages elsewhere [25][26], confirms it should stay excluded from the system of record.
- **Clerk's MRU (not MAU) pricing:** likely does not give free coverage at the 100k-family milestone; budget ~$1,000/mo at that scale or move to Better Auth earlier.
- **Audio transcoding:** no clean serverless-edge answer exists; if server-side normalization proves necessary, a Cloud Run/Lambda-container job enters an otherwise Cloudflare-centric stack — prototype client-side encoding first to avoid this.

## Sources

1. [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)  2. [Cron Triggers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/)  3. [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)  4. [Vercel Cron Jobs pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)  5. [Amazon EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/)  6. [EventBridge Scheduler DST](https://www.repost.aws/knowledge-center/eventbridge-scheduler-adjust-dst) / [schedule types](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html)  7. [Cloud Run pricing](https://cloud.google.com/run/pricing) / [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing)  8. [Fly.io Resource Pricing](https://fly.io/docs/about/pricing/)  9. [Railway pricing (secondary)](https://makerkit.dev/pricing-calculator/railway)  10. [Workers · Data Localization Suite](https://developers.cloudflare.com/data-localization/how-to/workers/)  11. [Render Pricing](https://render.com/pricing)  12. [Supabase pricing breakdown (secondary)](https://flexprice.io/blog/supabase-pricing-breakdown)  13. [Neon supported regions](https://neon.com/docs/introduction/regions)  14. [Neon Pricing](https://neon.com/pricing)  15. [Neon connection pooling docs](https://neon.com/docs/connect/connection-pooling)  16. [Supabase project regions](https://supabase.com/docs/guides/platform/regions)  17. [Supabase compute pricing (secondary)](https://dev.to/nayankyada/supabase-pricing-2026-free-tier-limits-compute-costs-when-to-upgrade-52af)  18. [Supabase PITR cost (secondary)](https://revivedb.dev/blog/supabase-pitr-cost)  19. [PlanetScale Postgres pricing](https://planetscale.com/docs/postgres/pricing)  20. [Crunchy Bridge plans and pricing](https://docs.crunchybridge.com/concepts/plans-pricing)  21. [Aurora Serverless v2 guide (secondary)](https://www.usage.ai/blogs/aws/rds/aurora-serverless-v2/)  22. [Cloud SQL pricing](https://cloud.google.com/sql/pricing)  23. [Xata Pricing](https://xata.io/pricing)  24. [Turso pricing (secondary)](https://comparetiers.com/tools/turso)  25. [D1 free-tier limit enforcement](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)  26. [D1 quota production outage — GitHub](https://github.com/Alajmah/MW-Dashboard/issues/52)  27. [R2 vs S3 vs B2 cost comparison (secondary)](https://www.budgetforge.dev/tools/cloudflare-r2-pricing-2026)  28. [R2 · Data Localization Suite](https://developers.cloudflare.com/data-localization/how-to/r2/)  29. [R2 EU jurisdiction / CLOUD Act analysis (secondary)](https://sota.io/blog/cloudflare-r2-eu-alternative-gdpr-cloud-act-object-storage-2026)  30. [Durable Objects alarms API docs](https://developers.cloudflare.com/durable-objects/api/alarms/)  31. [Japan APPI cross-border transfer](https://gvalaw.jp/en/blog/p20260514/)  32. [India DPDP cross-border transfers](https://www.mondaq.com/india/data-protection/1764976/from-localisation-debates-to-a-negative-list-making-cross-border-data-transfers-work-under-indias-dpdp-act)  33. [Taiwan PDPA 2026 changes](https://taiwan.acclime.com/news/personal-data-protection-act-2026-changes-investors/)  34. [GDPR Compliance 2026](https://secureprivacy.ai/blog/gdpr-compliance-2026)  35. [Clerk Pricing Explained](https://clerk.com/articles/clerk-pricing-explained)  36. [Better Auth Expo integration docs](https://better-auth.com/docs/integrations/expo)  37. [Auth pricing comparison — Zuplo](https://zuplo.com/learning-center/api-authentication-pricing)  38. [Auth0 vs Stytch pricing](https://stytch.com/blog/why-stytch-over-auth0/)  39. [Twilio Verify Pricing](https://www.twilio.com/en-us/verify/pricing)  40. [Retool Pricing 2026 (secondary)](https://uibakery.io/blog/retool-pricing)  41. [Forest Admin Pricing — G2](https://g2.com/products/forest-admin/pricing)  42. [Appsmith/low-code pricing comparison (secondary)](https://www.buildmvpfast.com/alternatives/cloudflare-r2)
