# Architecture decision records

Short, dated, append-only. Each record: the decision, why, what we rejected, and what would make us revisit it.

---

## ADR-1 · Backend on Cloudflare Workers, not a container service
**2026-09-12 · accepted**

Decision: the API, scheduler consumers, adapters, and gateway run as one Cloudflare Worker with Cron Triggers, Queues, R2, and Hyperdrive to Postgres.

Why: zero servers to operate; free tier covers phase 0–1; global edge for webhook latency; the phase-0 prototype is already there; one deployable is what a solo builder can maintain.

Rejected: Node on Fly.io or Railway (needs ops, costs from day one, no benefit at our scale); Supabase Edge Functions (weaker scheduling and queues); AWS Lambda (more moving parts, slower to iterate).

Revisit if: we need long-running processes (audio processing over 30 s), or Workers CPU limits bite on transcription cleanup. Then move the AI worker only.

## ADR-2 · Postgres (Neon) as the system of record, per region
**2026-09-12 · accepted**

Decision: Postgres on Neon, one project per data region, accessed via Hyperdrive. The prototype's D1 is not carried into the MVP.

Why: relational model fits (families, members, arrivals, answers); Neon branches give free staging databases; per-region projects make residency a config choice; D1 lacks the size and query features we need.

Rejected: D1 (SQLite; single region; fine for the prototype only); Firestore (weak relational queries, KPI jobs painful); MongoDB (no need for document flexibility).

Revisit if: a market requires in-country hosting that Neon doesn't offer; then run Postgres on a local provider for that region behind the same interface.

## ADR-3 · One mobile codebase with Expo; the parent surface is a mode, not an app
**2026-09-12 · accepted**

Decision: React Native with Expo for iOS, Android, and web. The parent surface and kitchen-table mode are display modes of the same app, chosen per member.

Why: one codebase for a tiny team; EAS handles builds and OTA updates; a separate "parent app" would double store listings, reviews, and support while the parent rarely installs anything anyway.

Rejected: Flutter (fine, but the TypeScript stack stays uniform with the Worker); two apps (doubles work); native (no).

Revisit if: the kitchen-table mode on old Android tablets performs badly; then a minimal native shell for that mode only.

## ADR-4 · Parent side is adapters behind one interface; never one messenger
**2026-09-12 · accepted**

Decision: every parent-facing channel implements the `Channel` contract (technical design §4). The composer and ladder never know which messenger they are talking to.

Why: WhatsApp is blocked in Russia, Telegram is throttled, MAX is state-run, LINE owns Taiwan; the parent must be reached wherever she already is; an adapter is a file, a platform dependency is a company risk.

Rejected: Telegram-only (kills Russia the day Telegram is blocked); WhatsApp-only (already dead in Russia); a Vela-only parent app (adoption cliff).

Revisit: never; add adapters instead.

## ADR-5 · The light lights on the raw answer, before any AI
**2026-09-12 · accepted**

Decision: answer capture, light lighting, and ladder cancellation happen synchronously in the webhook path; AI understanding runs afterwards from a queue.

Why: the safety promise ("you'll know within hours") must not depend on a model or a third-party API; a slow or failed AI call must never produce a false quiet notice.

Rejected: understand-then-light (simpler code, unacceptable dependency).

## ADR-6 · Notification budget enforced in one outbound gateway
**2026-09-12 · accepted**

Decision: all sends pass through one function that enforces per-member-per-day limits by kind and idempotency.

Why: the anti-addiction promise is a product feature; it survives only if it is impossible to bypass in code; also the natural place for retries and delivery logging.

Rejected: per-feature discipline (fails the first time someone adds a "helpful" notification).

## ADR-7 · Data residency by region; Russia handled as a legal review, not a technical bet
**2026-09-12 · accepted, with an open item**

Decision: regions `eu` (default), `apac`, `us`; family region set at creation from the kept-light member's country. For Russian citizens' data, the pilot stores minimal data in `eu`; a legal review of the localisation law precedes any Russian market launch.

Why: minimum data (names, hours, 30 days of answers) reduces exposure; the founder cannot fund in-country infrastructure now; the pilot is small and consented.

Rejected: Russian hosting from day one (cost, sanctions and payment complications, no team on the ground); ignoring the question (no).

Revisit at: the phase-1 exit, with a lawyer's opinion in hand.

## ADR-8 · Claude via the API with structured outputs and a versioned prompt registry
**2026-09-12 · accepted**

Decision: all AI calls use structured (schema-validated) outputs; each prompt is versioned and the version is logged per call; an eval set runs on every prompt change; a speech-to-text provider handles transcription with Claude for cleanup.

Why: every model output must be auditable and comparable across versions; structured outputs prevent free-text parsing bugs; the eval set is the only way to change prompts safely with real families on the line.

Rejected: fine-tuning (premature); an open model self-hosted (ops burden, weaker multilingual quality for elderly speech); unstructured outputs (fragile).

Revisit if: cost at 10,000+ families makes a cheaper model attractive for translation and prompts; then route by call type, keeping the strongest model for understanding and flags.

## ADR-9 · Web checkout first, in-app purchases in phase 2
**2026-09-12 · accepted**

Decision: Light is sold through Stripe web checkout during phase 0–1 (a link from the app to a web page); RevenueCat with App Store and Play billing is added in phase 2 when the app is in the stores at scale.

Why: avoids the 15–30% store cut and store review friction while we are testing prices; pilot payments are manual anyway. Store rules require in-app purchase for digital subscriptions bought inside the app, so phase 2 must add it and follow the "reader app" and external-link rules per platform at that time.

Rejected: IAP from day one (slows pricing tests, costs 30%); never doing IAP (violates store policy once the purchase is offered in-app).

## ADR-10 · No human welfare-check operations inside Vela
**2026-09-11 · accepted (product decision, recorded here because it shapes the system)**

Decision: Vela informs; the family acts. No Vela staff on the ladder, no partner dispatch, no paid checks.

Why: founder's decision; it keeps the company a software company; the research shows the family's own people are the scarce asset and the product's job is to make them one tap away.

Consequence for architecture: no dispatch system, no partner APIs, no on-call rota; the quiet notice is the top of the ladder.

---

## ADR-11 · Per-member Durable Object alarms plus an outbox replace the cron scan
**2026-09-13 · accepted · supersedes the scheduler in ADR-1's design**

Decision: one Durable Object per member who receives arrivals holds the pending wake-ups (arrival, repeat, quiet, turn prompt, weekly read) and re-arms one alarm at a time, recomputing each occurrence from the member's IANA zone. Every fire inserts the gate row (`exchanges` or `outbound`) with `ON CONFLICT DO NOTHING` and enqueues only if the insert happened. A 5-minute Cron Trigger reconciles and pings an external heartbeat.

Why: Cloudflare Cron Triggers neither retry nor alert on a missed tick (degraded incident 2026-09-09); a shared per-minute scan is where double sends come from; the alarm plus a database gate is DST-safe by construction and scales per member.

Rejected: keeping the v1 cron scan (fails constraints 1 and 5 at scale); AWS EventBridge Scheduler one-off schedules (the most correct primitive, but a second cloud and IAM for one builder); pg_cron (same scan pattern).

Revisit if: a duplicate send is ever observed (then SQS FIFO in front of the send path), or Cloudflare adds first-class per-object scheduling with dedup.

## ADR-12 · Drizzle ORM and Drizzle Kit for schema and migrations
**2026-09-13 · accepted**

Decision: the Drizzle schema mirrors `schema.sql`; Drizzle Kit generates SQL migrations into `db/migrations/`, reviewed in PRs, applied to a Neon branch per PR in CI and to production by the release job; pglite runs the schema in CI.

Why: edge-native (no proxy on Workers, unlike Prisma), typed queries, and it already produces the reviewed-SQL flow the design requires.

Rejected: Prisma (needs Accelerate or driver adapters on Workers), Kysely + Atlas (two tools for one job), raw SQL only (no types).

## ADR-13 · Clerk for accounts; Better Auth as the self-hosted fallback
**2026-09-13 · accepted**

Decision: organisers and members with accounts sign in through Clerk (phone OTP without a per-message surcharge, email magic link, Apple, Google; Expo SDK); the Worker verifies Clerk JWTs. Kept-light members never have an account: a channel link or a device-bound parent-surface token is their identity.

Why: free to 50,000 monthly retained users, first-class Expo support, the least integration work for one builder.

Rejected: Supabase Auth (only sensible if the database were Supabase), Firebase (less TypeScript-idiomatic), Auth0/Stytch/Cognito (cost).

Revisit if: the Clerk bill passes ~$500/month (retained-user pricing past 50k); then Better Auth, which has an official Expo plugin.

## ADR-14 · Speech stack: Deepgram by default, the pilot's audio decides; Azure TTS with on-device fallback
**2026-09-13 · accepted, with a measurement gate**

Decision: Deepgram Nova-3 batch (training opt-out set) transcribes by default; gpt-4o-transcribe is the second opinion on low confidence; SenseVoice/FunASR and Whisper on Groq are benchmarked in sprint 2 on 30 consented pilot clips, and the measured word error rate on elderly Taiwanese-accented Mandarin picks the default. Read-back and asks are pre-rendered with Azure Neural voices (zh-TW, en, ja) into R2; `expo-speech` on the device is the fallback so the loop never depends on a speech API. Audio is encoded on the device (AAC/M4A); no server transcoding. No voice cloning.

Why: no vendor publishes accuracy for our speakers; Deepgram is the cheapest mainstream option with code-switching and a documented opt-out; Azure has mature zh-TW voices and the clearest compliance record; DeepL lacks formality control for Chinese and Japanese, so translation stays with the LLM.

Rejected as defaults: ElevenLabs and Fish Audio (upgrade path if Azure sounds robotic), MiniMax (China-hosted; residency caution), Google Chirp 3 (zh-TW support unconfirmed).

## ADR-15 · Model routing by call, with batch and prompt caching
**2026-09-13 · accepted**

Decision: `flag` runs on `claude-opus-5` at low effort; `understand`, `translate`, `readback`, `weekly_read`, `recipe` on `claude-sonnet-5`; `chips`, `suggest`, `hello` on `claude-haiku-4-5`. Every call uses structured outputs with a Zod schema, adaptive thinking where supported, a cached system prompt, the Batch API when not needed within minutes, and `fallbacks: "default"` for classifier refusals. Every call is logged with its prompt version; Promptfoo gates prompt changes in CI.

Why: a missed health or safety signal is the expensive failure, so the strongest model at low effort takes it; judgment calls fit Sonnet 5's price; drafting is templated. Batch and caching roughly halve spend. Estimated AI cost ≈ $0.55 per family-month.

Rejected: one model for everything (either too costly or too weak on flags); fine-tuning (premature); a self-hosted open model (ops burden, weaker multilingual quality).

Revisit if: pilot evals show Sonnet 5 matches Opus 5 on flag recall (then route flags to Sonnet), or volume makes a cheaper translation path worth an eval.

## ADR-16 · Adapter order: LINE, then WhatsApp after the entity, then voice; Telegram for the instrument; MAX dropped
**2026-09-13 · accepted · updates ADR-4 and ADR-7**

Decision: LINE Messaging API direct (unverified Official Account in the founder's name until the entity; paid Standard plan from the first real families); WhatsApp Cloud API direct (no BSP) once Meta Business Verification is possible, with the daily ask as a Utility template; Twilio Studio for the voice line in phase 2 (US first; legal review per country); Telegram only for the phase-0 instrument and families who already use it. MAX is dropped with the Russian market. The parent surface in our own app is the floor under every market.

Why: market order v2 (Taiwan, US, Japan, Europe, India); LINE reaches 99.4% of Taiwanese adults; WhatsApp is the channel in Germany, the UK, and India but needs a legal entity; the voice line is the only path to the offline half of the 70+.

Revisit: never as a principle (adapters are added, not chosen); per market when a channel's rules or costs change (WhatsApp in-window billing from 2026-10-01).

## ADR-17 · A custom admin SPA instead of a low-code tool
**2026-09-13 · accepted**

Decision: `apps/admin` is a small React (Vite) app served by the Worker as static assets, using the same API with an admin role; every admin read is logged and visible to the organiser on request.

Why: the code is written anyway; Retool, Forest Admin, and Appsmith charge per builder seat and route family data through a third party's sub-processor chain.

## ADR-18 · Cron liveness monitored from outside Cloudflare
**2026-09-13 · accepted · how the heartbeat is kept and read is replaced by the update of 2026-09-18; the decision to watch from outside Cloudflare stands**

Decision: the reconciliation tick pings Healthchecks.io (free) and Sentry Crons; a missing ping for 10 minutes pages the founder. SLOs and alerts are in the architecture §15.

Why: Cloudflare Cron Triggers do not alert on their own failure, and the application cannot know it missed its own wake-up.

## ADR-19 · Expo SDK 55 with native widget targets; expo-audio; Lingui; TanStack Query + Zustand
**2026-09-13 · accepted · confirms ADR-3 and fixes its details**

Decision: Expo SDK 55 (New Architecture only); widgets through `expo-widgets` on iOS with a hand-written WidgetKit target budgeted as the fallback, and `react-native-android-widget` on Android; `expo-audio` (not `expo-av`, removed in SDK 55); Lingui for i18n; TanStack Query + Zustand; the parent surface in plain StyleSheet; NativeWind for the family app; Maestro for E2E; PostHog (EU) and Sentry.

Why: React Native inherits the OS accessibility layer that the parent surface depends on; `expo-widgets` is alpha, so the fallback is budgeted now; Lingui's compile-time ICU handles zh/ja plurals at half the runtime size of the alternatives.

Rejected: Flutter (reimplements accessibility), Compose Multiplatform (a second language), PWA-only (no widget, no always-on screen), an offline-first sync engine in v1 (the loop is low-write).

## ADR-20 · Payments only where store rules allow; RevenueCat once the entity exists
**2026-09-13 · accepted · tightens ADR-9**

Decision: no payment in the app until the entity exists. Then RevenueCat for App Store and Play billing; a web checkout link (Stripe from a Singapore entity, or a merchant of record) only in storefronts that allow external links (US, EU under the DMA, Japan under the MSCA), never as an in-app "Buy" in Taiwan or India, where the trial opens from a Settings-level link. Annual is pre-selected; the adult child owns the account.

Why: Apple and Google external-link rules are region-gated in 2026; Taiwan and India have no allowance; RevenueCat is free to $2,500 tracked revenue per month and bridges StoreKit 2, Play Billing, and web billing.

Revisit: when Apple or Google change the allowances for Taiwan or India, or the entity is not Singapore.

## ADR-7 · updated 2026-09-13
Russia is deferred by the founder; the legal review item is closed for now. Regions stay `apac`, `eu`, `us`; Japan may get an in-country database (Supabase Tokyo) behind the same region router if volume requires it; the Cloudflare jurisdiction flags are never described as local hosting.

---

## ADR-21 · The admin conversation carries no family content
**2026-09-14 · accepted**

Decision: messages to the founder's Telegram chat with the bot (`admin.flag`, `admin.weekly_read_draft`, `admin.understand_failed`, `admin.member_left_group`) carry at most the family name, a member's name, and a link to the admin page (`Config.publicBaseUrl` + `/admin/...`), never her words, a quote, a transcript, or a draft's lines. The content is read on the admin page, where every view writes `admin_access_log`. Organisers still receive `flag.notice` with her words verbatim, because they are family and the notice is for them. A copy test holds every `admin.*` key to the parameters `family`, `link`, and `name`.

Why: a message in the founder's chat is a copy of family data outside `admin_access_log` and outside `applyRetention`, kept only as long as the founder remembers to delete it by hand (data map, gap 15). A link keeps one place where content is read, logged, and deleted on schedule.

Rejected: quotes and drafts in the admin chat with a manual deletion routine (unlogged, and deletion depends on a person); email to the founder (another copy and another sub-processor); no admin notice at all (the founder would find flags and failures only by opening the page).

Revisit if: a flag waits noticeably longer to be acted on because opening the page is slower than reading the chat.

## ADR-22 · Admin writes go through a logged page behind Cloudflare Access
**2026-09-14 · accepted · narrows ADR-17 for the pilot · the Access application that covers `/admin` only, and the admin pages' place in the one Worker, are superseded by ADR-26 (2026-09-17); the rest stands**

Decision: in the pilot, the admin surface is server-rendered pages and HTML POST forms under `/admin` in the Worker, behind a Cloudflare Access application that covers `/admin` only (superseded: the pages are the admin Worker `vela-admin`, and Access covers that whole Worker, ADR-26). The Worker verifies the `Cf-Access-Jwt-Assertion` token itself (signature, audience, issuer, expiry) and takes its `email` claim as the admin identity; a POST must also be same-origin. The actions are `ADMIN_ACTIONS` in `@vela/contracts`: `view`, `record_consent`, `record_contact_consent`, `add_contact`, `remove_contact`, `set_away`, `end_away`, `mark_left`, `mark_deceased`, `delete_family`, `send_weekly_read`, implemented in `@vela/services` `admin.ts`. Each one writes an `admin_access_log` row (`action` checked against the tuple, `member_id` without a foreign key so the log outlives members, `what` never holding message content) and a domain event in the same transaction. ADR-17's admin SPA replaces these pages once API v1 exists.

Why: without a write path the founder records consents, nearby contacts' answers, away periods, departures, and deaths in the Neon console and logs each touch by hand (data map, gap 13); a bearer token identifies no person, so `admin_access_log.admin` could not say who acted, and it has no second factor. Access puts the founder's sign-in, with the identity provider's second factor, in front of the page without auth code of our own, and checking its token in the Worker as well keeps the page closed if the Access configuration is ever wrong. The same-origin check stops another site from posting a form through the founder's signed-in browser.

Rejected: the Neon console with a hand-kept log (unlogged writes on real families, easy to get wrong); a shared bearer token (no identity, no MFA); building ADR-17's SPA now (it needs API v1 and Clerk roles, build plan 2.1); trusting Access alone without verifying the token in the Worker.

Revisit when: API v1 and the admin role exist (build plan 2.1), or a second person needs admin access.

## ADR-23 · Deploy credentials live only in GitHub environments; the deploy job migrates first
**2026-09-14 · accepted · updates ADR-12**

Decision: `.github/workflows/deploy.yml` deploys through two GitHub environments, `staging` (merges to `main`) and `production` (tags, with the founder as required reviewer). `CLOUDFLARE_API_TOKEN` and `DATABASE_URL` are environment secrets in each; the repository has no secrets. Each run applies the Drizzle migrations to that environment's database, then runs `wrangler deploy`. Until the job exists, the founder runs migrations by hand from their own terminal (build plan 0.3, `infra/runbooks/release.md`).

Why: a repository secret is readable by a workflow on any pushed branch, which would get around the production approval; an environment secret is released only to a job the environment's rules allow. Migrations expand before they contract, so the schema must be in place before the code that uses it; running both in one job leaves no window where new code meets an old schema.

Rejected: repository secrets (bypass the approval); deploying production from a laptop (no approval, no record); a separate migration workflow (can run after the deploy, or not at all); letting the co-founder hold connection strings (infra rule zero).

Revisit if: a migration ever needs to run long enough to block a deploy, or a second region's database joins the pilot (then the job migrates each region before deploying).

## ADR-24 · Retention clears content in place and deletes by age
**2026-09-14 · accepted · implements architecture §12 for the pilot**

Decision: the nightly `applyRetention` job implements the pilot rules of `plan/materials/pilot/data-map.md`. After 30 days it clears what people wrote while keeping the rows: `exchanges.text` and `options` (30 days after delivery), chips, translations, `replies.text`, the text in `answers.payload`, `answers.transcript`, `mentions`, `mood_words`, `flag_reason`, suggestions' text, `outbound.payload` (30 days after `sent_at`), `ai_calls.output`, and the reply text in `quiet_events.ask_to_check`; a NOT NULL column takes its empty value, and chips and translations rows, which hold nothing else, are deleted. It deletes `message_refs` older than 30 days, invites 30 days after expiry or acceptance, expired onboarding sessions, media per `expires_at` and `kept` (removing the id from `exchanges.media_ids` and `options`, with a `deletions` row for every media deletion), members 30 days after `left_at`, families within 24 hours of `deleted_at`, and `events`, `metrics_daily`, `ai_calls`, and `outbound` rows older than 24 months. A member's Durable Object storage is cleared when they stop, leave, die, or are deleted. Summaries, the `flag` boolean, and away dates stay while the family uses Vela. Each rule has a retention test.

Why: the privacy notice promises 30 days for what the family wrote, and the earlier rules covered only media, transcripts, members, families, and events, so asks, replies, translations, chips, suggestions, outbound payloads, AI outputs, and message refs would have been kept indefinitely (data map, gap 1). Clearing columns keeps the timing, states, and quiet outcomes that answer rate and the precision page are computed from.

Rejected: deleting whole exchanges after 30 days (their quiet events and outcomes cascade away, and the history of answered days with them); keeping content until the family leaves (breaks the notice); field-level encryption with key deletion as the retention mechanism (decided separately before launch, architecture §13).

Revisit if: counsel says consent proof must outlive a member's deletion (data map, gap 4), the family book needs words past 30 days, or events volume makes row deletes slower than dropping partitions.

## ADR-25 · Answers whose understanding failed are re-run from reconciliation
**2026-09-14 · accepted · extends ADR-5 and ADR-8**

Decision: `answers.processing_attempts` counts each start of media ingestion or understanding for an answer, and `understood_at` is set only when `ai.understand` and `ai.flag` both returned ok (a failed translation does not hold it back). Every 5 minutes `reconcile` re-enqueues answers with `understood_at` null, received between 15 minutes and 24 hours ago, with fewer than 3 attempts: a voice answer without a transcript to `ingest_answer_media`, anything else to `understand_answer`. A job that fails at the third attempt or later sends `admin.understand_failed`, keyed by the answer so it goes out once, with a link and no content. The group transcript post, translations, and flag notices are keyed per answer, so a re-run never repeats them.

Timing: nothing spaces the attempts out. The first re-run comes at the first reconciliation after the answer is 15 minutes old, and the next one 5 minutes later, so every attempt falls within about 25 minutes of the answer. A voice answer whose transcription succeeds spends two attempts on its first run (ingestion, then understanding), so its understanding is re-run once. A job still waiting in the queue when reconciliation runs is enqueued again and spends an attempt; the per-answer keys keep that harmless. The 24-hour window does not spread the attempts: it only limits which answers qualify, so an answer that reconciliation missed, for example while cron was down, is still picked up within a day.

Why: `@vela/ai` resolves every provider failure to a safe default, so a failed flag check looks like "no flag" and nothing would ever run it again (data map, gap 16). The light has already lit on the raw answer (ADR-5), so a re-run costs nothing on the safety path. Re-running within about 25 minutes rides out a brief provider error or a single failed request. A longer outage ends in `admin.understand_failed`, and the founder reads the answer by hand (`infra/runbooks/incident.md`). The bound stops an answer that always fails from being paid for forever.

Rejected: queue retries (the job completes, because the port resolves failures instead of throwing, so the queue never retries it); unbounded retries; the founder reading every failed answer by hand as the only safeguard.

Revisit if: provider outages longer than about half an hour turn out to be common, so answers regularly end in `admin.understand_failed` (then space the attempts out, for example with a last-attempt time per answer), or the second speech-to-text provider (ADR-14) is added, which would make a different provider the natural second attempt.

## ADR-7 · updated 2026-09-14
`Config.regions` lists the regions whose database exists; the pilot has `apac` only. A new family's country still picks its preferred region (TW, JP, SG, AU, IN → `apac`; US, CA → `us`; GB, DE, and other European countries → `eu`), and a family whose preferred region does not exist is created in `apac`. So every pilot family is `apac`, which the privacy notice's "Singapore" matches. A region still never changes without export and import, so moving a family out of `apac` once `eu` or `us` exists is a planned migration with a new notice version, never a relabelling.

## ADR-12 · updated 2026-09-14
Migrations run in the deploy job of each GitHub environment before `wrangler deploy` (ADR-23), not in a separate release job. No database has been migrated yet, so until one is, a schema change regenerates `packages/db/migrations/0000_init.sql` (delete the folder, run `drizzle-kit generate --name init`) instead of adding `0001`; `architecture/schema.sql` is always regenerated with `pnpm --filter @vela/db export-sql` and never edited by hand.

## ADR-26 · The pilot runs on workers.dev, with the admin page in its own Worker
**2026-09-17 · accepted · supersedes ADR-22's Access application for `/admin` only · refines ADR-1 (one package, two Workers)**

Context: the founder asked for a free domain. ADR-22 put the admin pages under `/admin` in the one Worker, behind a Cloudflare Access application covering that path, and the Worker answered only on a custom-domain route. That needed a domain Vela owns as an active zone in each Cloudflare account, and so two registered domains, since Cloudflare activates a domain in one account at a time. Without a domain, a Worker's only address is its workers.dev hostname, `https://<Worker name>.<account subdomain>.workers.dev`. Cloudflare's Workers documentation (the Cloudflare Access page, last updated 18 August 2026) says that protecting one Worker "automatically protects every domain associated with the Worker, including its routes, Custom Domains, `workers.dev` hostname, and previews". The same page also describes hostname- and path-based self-hosted applications, with a workers.dev hostname and `example.com/login` as its examples. It gives no example of one path on a workers.dev hostname. Telegram's webhook and the families' privacy notice pages must be reachable without a sign-in, so Access on the whole Worker would close them. The code calls the parts of this decision H1 to H7.

Decision:

- **Hosts (H3).** No domain is bought and no zone exists. Each account's workers.dev subdomain is chosen when the account is set up: `vela-light` for "Vela" (production) and `vela-light-staging` for "Vela staging". If a name is taken, the founder uses `velalight` or `velalight-staging`. The hosts then change in the places the header of `apps/worker/wrangler.jsonc` lists. `src/wrangler-config.test.ts` fails until both wrangler files and the links in `plan/materials/pilot` agree with its `WORKERS_DEV_SUBDOMAINS`. The bots' privacy policy links, the `telegram:setup` `WORKER_URL`, and the documents (`git grep vela-light`) are changed by hand. Production: pilot `https://vela.vela-light.workers.dev`, admin `https://vela-admin.vela-light.workers.dev`. Staging: pilot `https://vela.vela-light-staging.workers.dev`, admin `https://vela-admin.vela-light-staging.workers.dev`. Every deployed Worker has `workers_dev` on, `preview_urls` off, and no routes; the development top level of each file has `workers_dev` off, so a deploy without `--env` publishes no address.
- **The pilot Worker (H1)** is `vela`, configured in `apps/worker/wrangler.jsonc` with entry `src/index.ts` (`vela-dev` locally). It serves `GET /healthz`, `POST /webhooks/telegram`, `GET /privacy`, and `GET /privacy/zh-TW`, and owns the three queue consumers, both crons, and the `MemberScheduler` Durable Object with its migration. Anything under `/admin` gets 404. It holds no Access secret. `ADMIN_CONVERSATION_ID`, the founder's personal Telegram chat id, is its secret, never a var (H5). Outside development it refuses to start without it, because the founder would otherwise never hear of a flag.
- **The admin Worker (H2)** is `vela-admin`, deployed from the same package with `apps/worker/wrangler.admin.jsonc` and entry `src/admin-worker.ts` (`vela-admin-dev` locally). It serves only the admin pages and forms under `/admin`, and redirects `/` to `/admin`. Its bindings reach the pilot Worker's resources: its own Hyperdrive binding to the same configuration, the `MemberScheduler` class of `vela` by `script_name`, and a producer binding on the outbound queue, for a sent weekly read. It builds only the ports the admin reads and actions use (`AdminDeps`: database, clock, logger, outbound queue, scheduler, AI). Every other port in services' `Deps` throws `PortNotGivenError` the moment it is touched. Its secrets are `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ANTHROPIC_API_KEY`.
- **Access.** The founder protects the whole `vela-admin` Worker (Workers & Pages → `vela-admin` → Access → Protect this Worker behind Access → All traffic). As ADR-22 says, the Worker still verifies the `Cf-Access-Jwt-Assertion` token itself, and a POST must come from the origin of `PUBLIC_BASE_URL`, which is now the admin Worker's own origin. The admin pages send `referrer-policy: same-origin`, because under `no-referrer` a browser's form POST carries `Origin: null` and would be refused. Nothing else in either account is behind Access, and account-level "Protect all Workers" is never turned on, because it would cover `vela` too.
- **Links.** `PUBLIC_BASE_URL` is the admin origin in both Workers: the base of admin links in the founder's chat, and the one origin a form may come from. `PRIVACY_NOTICE_URL_EN` and `PRIVACY_NOTICE_URL_ZH_TW` are the pilot origin plus `/privacy` and `/privacy/zh-TW`. The startup refusal of `PLACEHOLDER_` values and non-https URLs stays. The Hyperdrive ids and bot usernames stay placeholders until the founder creates them.
- **Privacy notice pages (H4).** The pilot Worker serves `plan/materials/pilot/privacy-notice.en.md` and `privacy-notice.zh-TW.md` as plain pages in the notice's language, readable on a phone, with no script and no external request. `pnpm --filter @vela/worker notices` renders them, with no new dependency, into the committed module `src/notices.generated.ts`, and a test fails while that module is stale. Outside development the pilot Worker refuses to start while either notice holds a bracketed blank such as `[FOUNDER FULL NAME]`. The refusal goes through the same path and `ConfigError` as a `PLACEHOLDER_` value, with the notice's file name as the code. The quoted `[Name]` and `[名字]` are the notices' own words, not blanks.
- **Telegram setup (H6).** `telegram:setup` registers the pilot origin plus `/webhooks/telegram`. It keeps pending updates unless `--drop-pending-updates` is given, because during a live pilot those updates are real answers, and it refuses any other argument.
- **Deploy (H7).** `.github/workflows/deploy.yml` migrates the environment's database once, then deploys `vela`, then `vela-admin`, whose binding needs the class `vela` exports. The environment secrets and approval rules of ADR-23 are unchanged.

Why: the boundary is a hostname, not a path rule. The Worker Telegram and families reach has no admin route at all, and the Worker that has admin routes has no hostname Access does not cover. So a mistake in the admin Worker's Access application can neither open the admin page, because the Worker checks the token as well, nor close the webhook, because the webhook is another Worker's. It costs nothing: no registrar, renewal, zone, DNS record, or certificate to manage in two accounts, and the notice has a working https address before anything is bought. Each Worker holds fewer secrets. The admin Worker has no bot token, speech key, or heartbeat URL. The pilot Worker has no Access configuration. The token check in the Worker still keeps the page closed if Access is ever switched off.

Rejected: a bought domain with a path-scoped Access application (ADR-22 as written). That means two domains to register and renew, and zones to activate in two accounts before anything deploys. The admin page's protection would also rest on a path rule that one edit can widen or narrow; Cloudflare's own path rules do not match the parent of a wildcard (`/alpha/*` does not cover `/alpha`). Access on the whole pilot Worker closes Telegram's webhook and the notice pages, because neither Telegram nor a family can sign in. No Access at all would put sign-in code of our own, or a shared token with no identity and no second factor, in front of the page, both of which ADR-22 already rejected.

Consequences: two Workers from one package, so the Hyperdrive id and the outbound queue name appear in both config files, and `src/wrangler-config.test.ts` holds them equal. The pilot Worker deploys first, and renaming `vela` or its `MemberScheduler` class breaks the admin Worker's binding. The account's subdomain is part of every link. The privacy notice link in each family group's first message, the bot's privacy policy link, and Telegram's webhook all name it, so it is chosen before the first deploy and never changed while families use Vela. Cloudflare recommends a route or custom domain for production Workers, and says a workers.dev subdomain "is treated as a Free website and is intended for personal or hobby projects that aren't business-critical". That is accepted for a pilot of a few families. Staging, like production, refuses to run until both notices are filled in. `infra/README.md`, the runbooks, the pilot pack, and code design §9 describe the two Workers.

Revisit if: Vela buys a domain (then each Worker gets a custom domain, the notice URLs change, and families are sent the new link), a workers.dev limit or the free-website treatment affects the pilot, a public launch is planned, or ADR-17's admin app replaces these pages.

## ADR-27 · Health words need their own written consent, and understanding keeps less for everyone
**2026-09-17 · accepted · applies decisions L1 to L3 (legal memo C1 to C4) · narrows ADR-21's "organisers still receive `flag.notice` with her words verbatim"**

Context: `plan/materials/pilot/legal-memo.md`, Q1, is research, not legal advice. It finds that most health words in an answer ("my knee hurts", "I fell") are ordinary personal data, but that what a doctor produced and the person repeats ("the doctor says it's diabetes", a test result, a changed medicine) may be medical data under Article 6 of Taiwan's Personal Data Protection Act, as the Enforcement Rules define it (Article 4), with no authority either way (confidence low). If Article 6 applies, the only exception that fits Vela is the person's written consent (Article 6(1)(6)), given separately after the notice (Article 6(2), Article 7(1) and (2), Rules Article 15) and proven by Vela (Article 7(4)). Nobody can give it for her: the organiser cannot (National Development Council letter 發法字第1080010426號). Vela had no such consent, while `understand.v3` stored health mentions and summaries in her words, and `flag.v1` sent organisers her words and a health category kept in `flag_reason`. The code calls the parts of this decision L1 to L3.

Decision:

- **A separate question (L1).** `CONSENT_KINDS` gains `health_words`. Right after her Yes to the light, Vela sends `consent.health_words` in her language as its own message with its own Yes and No buttons: "One more question. If you mention your health, for example a fall or pain, may Vela pass your words on to {organiser} so they can call you? Vela works the same if you say no." Her first tap records a `consents` row, `answer yes` or `no`, with text version `consent.health_words@1` and the evidence ADR-28 describes. Vela never asks again by itself: not after a stop, a start, or either answer. Saying stop withdraws a yes with the light, and start does not give it back; any later change is recorded by the founder by hand. The privacy notice explains health words, cites Article 6(1)(6), gives the lawful basis for each group of people separately, and no longer says "No medical records." without qualification (flows §3.2, §3.13).
- **Without that consent (L2).** Understanding stores no health mentions (`mentions.health` is `[]`) and no `unwell` mood word, and the summary leaves health out. The flag check still runs on every answer, because it is the safety feature, but the organisers' notice is `flag.notice_no_words`, "{name} said something today that may be worth a call.", with no words and no category. `flag_reason` stores only the severity, `ai_calls.output` holds no health mention, category, or quote, and `flag_raised` carries no category. With consent, organisers get her words verbatim as before. `admin.flag` stays content-free either way (ADR-21). Consent counts for an answer when a yes was given at or before the answer arrived and is not withdrawn when it is understood (flows §3.10).
- **Less for everyone (L3).** `understand.v4` and `flag.v2` replace `understand.v3` and `flag.v1`. Summaries and mentions never keep the name of a diagnosis, a test result, or a medicine, and the flag quote leaves them out where the danger shows without them, whatever her answer to the question. `UnderstandInput.healthWordsConsent` tells the model whether she agreed. Eval cases assert both rules in English and Traditional Chinese (code design §7). Services enforce what needs no model: the empty health mentions, the dropped mood word, and the missing category and quote.

Why: a consent message of its own, after the full notice and with its own buttons, is the form the memo says Article 6(2) and Rules Article 15 require, and the tap, made by the person herself and stored with the text version, its parameters, and a hash of the text, is part of what the memo's reading of the Electronic Signatures Act needs for it to count as writing (Q4; confidence medium to low). A "no" must leave Vela working, or the consent risks being 「違反其意願」 (Article 6(1)(6)), and the memo reads words suggesting a fall or pain as ordinary data covered by the light consent (Q1, "What a 'no' does"; confidence medium), so the flag keeps running. A notice without words still gives the organiser a reason to call on the day it matters, which is the promise ADR-5 protects, while carrying nothing that could be Article 6 data. Leaving out diagnosis, test, and medicine names for everyone costs the family nothing it needs to act, and it removes the grey-zone data from the rows kept longest: summaries stay while the family uses Vela (memo C4).

Rejected: making health-words consent a condition of the light (it would tie the light to a special-category consent the person may not want to give; memo lawyer question 2); switching off health flags without consent (the safety feature would go for everyone who says no, which the memo asks only of families under the GDPR or Washington's My Health My Data Act, Q6, and the pilot onboards neither, L12); asking inside `consent.request` (not a separate expression of consent); a services-side keyword filter on summaries (unreliable across languages and code-switching; the prompt and evals carry that rule, and services enforce only what is exact); keeping the category, or the quote in `ai_calls`, without consent (both are health data about her, kept for 30 days or longer); passing the consent to `flag` as well (the flag decision must not depend on it, and without consent its words are discarded anyway).

Consequences: a transcript or a message in her own words still reaches the family group as she sent it and is deleted after 30 days, with or without consent; the memo leaves a relayed diagnosis inside a transcript as a residual risk for a lawyer (Q1). The founder handles any change to her answer by hand until an admin action exists. Health memory facts, planned for sprint 5, may be written only with this consent (memo C5).

Revisit if: a lawyer answers the memo's questions 1 to 3; a family under the GDPR or Washington's law is to be onboarded (then a no also switches off health flags, and consent to collect and consent to share may need to be separate); memory facts ship; or evals show summaries still carrying health words without consent.

## ADR-28 · Consent proofs outlive the person's data, deletion proofs hash no personal value, and a no deletes
**2026-09-17 · accepted · applies decisions L4, L5, and L7 (legal memo C6, C7, C8, C16), with the evidence of L6 (C12 to C15) · updates ADR-24**

Context: `plan/materials/pilot/legal-memo.md`, Q2 and Q4, is research, not legal advice. Vela carries the burden of proving consent (Article 7(4)), and claims and fines can arrive years after data is gone, yet `consents.member_id` and `contact_id` cascaded, so a proof vanished with the person (data map, gap 4; ADR-24's revisit condition). `removeContact` stored a plain SHA-256 of a nearby contact's phone number in `deletions`, kept with no limit: a Taiwan mobile number has about 10^8 values, so the hash gives the number back in seconds, and it is still personal data (preparatory office letter 個資籌法字第1140000771號). A No left her profile and channel link stored with the member `invited` until the family was deleted, while the consent script said "Nothing is created" and Article 11(3) requires deletion once the purpose is gone. `consent.request@1` evidence held only a message id. The code calls the parts of this decision L4 to L7.

Decision:

- **Deletion proofs (L4).** `deletions.content_hash` is the SHA-256 of `<object type>:<object id>` for every row, media and removed contacts alike (`deletionHash`), never of a phone number, a storage key, a provider file id, or any other value. `deletions_content_hash_check` holds it in the database.
- **Consent proofs (L5).** `consents.member_id` and `contact_id` become `ON DELETE SET NULL`. `subject_ref text NOT NULL` (`member:<id>` or `contact:<id>`) is written at insert, `answer` (`yes` or `no`) makes a decline a row of its own, and `subject_deleted_at` records when the subject went. In the transaction of every deletion of a member or contact, before the delete, `forgetConsentSubjects` cuts `evidence` to `chat_id`, `message_id`, `text_sha256`, and `recorded_by`, so only ids, the text version, and the text hash remain, and `consents_subject_deleted_check` makes a deletion that skipped the step fail. Retention deletes a consent no longer in force (a no, a withdrawn yes, or one whose subject was deleted) 5 years after the latest of `given_at`, `withdrawn_at`, and `subject_deleted_at`, and a `deletions` row 5 years after `deleted_at`. The notice and the data map state the 5-year period and why.
- **Evidence (L6).** Every consent recorded from a tap holds `chat_id`, `message_id`, the `params` filled into the text, and `text_sha256`, the SHA-256 of the text rendered from them; with the text version (`consent.request@2`, `consent.health_words@1`, or the notice's version) the exact message can be rebuilt and shown to be the one she saw (flows §3.2, §3.3). Update 2026-09-18: a `privacy_notice` row from an "I've read it" tap holds only `chat_id`, `message_id` and `text_sha256`. The hash is taken when `group.linked` is posted and kept on `family_channels.linked_text_sha256`, because the params name the kept-light member and would outlive her No in other adults' rows, and a hash rebuilt at the tap could name a message the group never received.
- **A no deletes (L7).** Her No to the light deletes her member row and channel link in one transaction, with her invite and nearby contacts, keeping only the forgotten decline row; the organisers are told as before. The organiser invites her again through the founder: `create_invite` on the admin page (a fresh kept-light member and invite for the same family, logged like every admin action, the link sent to the organiser who asked), or the runbook. An invited member who never answers is deleted 30 days after her last invite expires (flows §3.2, §3.15, §3.17).

Why: the memo finds a basis for keeping a minimal proof after deletion in Article 11(3), read with Rules Article 21(3) (confidence medium), and anchors 5 years on the 5-year limit for damages claims (Article 30), the 3-year limit on fines (Administrative Penalty Act Article 27), and the Ministry of Digital Affairs regulation's 5-year records rule, where it applies (Q2; confidence low on the period). The proof must still be pseudonymous and time-limited, since it remains personal data. Ids already tie a proof to the admin log, the events, and the family's request without holding anything the person said or is called, and the ids of a deleted row give nothing back. Counting the 5 years from when a proof stopped covering anything, not from when consent was given, keeps a consent given long before a deletion for the 5 years after it, and never deletes a standing yes Vela still relies on. A CHECK makes forgetting impossible to skip, a by-hand deletion in the Neon console included, where a nightly sweep would leave words behind for a day and hide the mistake. Deleting on a No is what Article 11(3) asks once the purpose is gone, and what the script already promised; the decline row is what Article 7(4) needs from it.

Rejected: a keyed HMAC of the platform user id or phone number as `subject_ref` (memo C7): a secret to create, rotate, and keep in the Worker for a pilot, when member and contact ids are already pseudonymous; a keyed hash of a declined contact's number to avoid asking again (memo Q2, confidence low: it keeps a value that the key turns back into a number); keeping the whole evidence, names and notes included, after deletion; deleting consent rows with their subject, as before; keeping a declined member `invited`, as before; deleting every consent and deletion row 5 years after it was written (it would delete a standing consent in use, and a proof whose subject was deleted the day before); an admin action to reverse a No in place (the profile is gone by design, so inviting again starts fresh).

Consequences: after a No, Vela cannot recognise her Telegram user, so a message she writes to the bot gets `help.private` like anyone's, and the notice's words on a No cannot promise that nothing is ever sent to her afterwards. The family page lists only the consents of members and contacts who still exist; a proof whose subject is gone is found by its `subject_ref`, from the admin log or the events. Re-inviting means re-entering the profile with the organiser. Any by-hand deletion of a member or contact follows the runbook's forgetting step first. The admin Worker gains the bot username and the token port for `create_invite` (ADR-26 update below).

Revisit if: a lawyer answers the memo's question 4 on the basis and the period; a claim, a regulator, or the 2025 amendment's regulations set another period; or accounts in the app (ADR-13) give people an identity that outlives a messenger link.

## ADR-22 · updated 2026-09-17
`ADMIN_ACTIONS` gains `create_invite` (ADR-28): a fresh kept-light member and invite for a family whose kept-light member said No or never answered, recorded as `invite_created`. `record_contact_consent` takes a contact's number with their yes, and `add_contact` takes one only with a yes (decision L8). `add_contact` with a yes is the one action that records two events, `nearby_contact_added` and `consent_given`, still with one `admin_access_log` row.

## ADR-24 · updated 2026-09-17
Consent proof now outlives a member's deletion (ADR-28), on the legal memo's research and before counsel has answered, so this record's first revisit condition no longer waits. The retention job also deletes invited members who never answered, 30 days after their last invite expired (their invites wait for them), forgets the consent rows of every member and contact before deleting them, a family's included, and deletes consents no longer in force and `deletions` rows after 5 years. Deletion proofs hash only the object's type and id.

## ADR-26 · updated 2026-09-17
For `create_invite` (ADR-28), the admin Worker also holds the var `TELEGRAM_BOT_USERNAME`, equal to the pilot Worker's in each environment and held equal by `src/wrangler-config.test.ts`, and `AdminDeps` gains `random` (the same CSPRNG port the pilot Worker builds) and `telegramBotUsername`. Services still receive a `Config` whose every other field throws `PortNotGivenError`. It still holds no bot token: the link reaches the organiser through the outbound queue, which the pilot Worker delivers.

## ADR-23 · updated 2026-09-17
Each environment's first migrations and deploy are not a CI run: the founder runs the setup script (`pnpm --filter @vela/worker run setup -- --env staging`, then `--env production`; `03-code-design.md` §9, "Environment setup"; `infra/README.md`, section 11) once from their own terminal, and production's run happens once, before any family. It uses a custom Cloudflare token limited to that one account, with a TTL ending the next day for production, deleted after the run, and takes every secret only at a prompt that does not echo, passing it to programs on standard input or in their environment, never as an argument, and never writing it to disk except the staging token in the git-ignored `apps/worker/.env`. Every later deploy of either environment goes through `.github/workflows/deploy.yml` and its GitHub environments as decided above, and nobody deploys production from a laptop again. Why: an environment's secrets, Hyperdrive configuration, bot username, and Access secrets do not exist until that first run creates or reads them, so CI cannot be the first deploy, and a short-lived token run by the founder keeps a production credential off the development machine.

## ADR-11 · updated 2026-09-18
The reconciliation Cron Trigger runs every 15 minutes, not 5, and records a heartbeat inside the pilot Worker that an outside watchdog reads, instead of pinging an external heartbeat service (ADR-18 and ADR-25 updates of the same day). The per-member Durable Object alarms remain the primary scheduler.

## ADR-18 · updated 2026-09-18
Decision (W1 to W5, the tech co-founder's, approved by the founder, who asked for a way other than Healthchecks.io): Healthchecks.io and its ping URL secret are removed everywhere. The services `Heartbeat` port stays. The pilot Worker implements it by recording the time of the last successful reconcile in a small singleton Durable Object, `ReconcileHeartbeat` (SQLite-backed, its migration in `wrangler.jsonc`), not in Postgres and not in a new Cloudflare resource. `GET /healthz` never touches the database: it answers 200 with `{"status":"ok","lastReconcileAgeSeconds":n}` while that time is at most 35 minutes old, and 503 with `{"status":"stale"}` or `{"status":"no_reconcile_yet"}` otherwise, with no content and no ids. `.github/workflows/watchdog.yml` runs every 15 minutes and on `workflow_dispatch`, with read-only permissions, no secret, and no GitHub environment; it reads `.github/watchdog.json` and checks each enabled environment's `/healthz` with `curl` (a timeout, three tries 20 seconds apart), failing with a job summary that names the environment and its status. GitHub emails the founder about a failed scheduled run. Both environments start disabled, so nothing fails before a deploy exists, and each is enabled in a commit after its first successful deploy. Sentry Crons is not used: Sentry is not connected to the Workers.

Why: the reason for this record stands. If the Worker, its crons, or the database stop, no arrival and no quiet notice goes out, and a family reads the silence as "all fine", while Cloudflare does not alert on a cron that stops. A heartbeat the Worker writes only when a reconcile has finished is stale whether the cron stopped, the configuration was refused, or the database was unreachable, and keeping it in a Durable Object lets `/healthz` answer without waking Neon, whose Free plan suspends compute once the month's compute hours are used (ADR-25 update). GitHub Actions is already an account the founder owns and sits outside Cloudflare; in a public repository its standard runners cost nothing. 35 minutes is two missed 15-minute runs plus five minutes, so one late run does not alert.

Rejected: keeping Healthchecks.io (the founder asked for another way); a heartbeat row in Postgres (every watchdog request would wake the database); Cloudflare's own notifications (inside the failure domain being watched); another hosted uptime service (a new third-party account for one signal).

Consequences: GitHub's documentation (checked 2026-09-17, `infra/README.md`, section 6) says a scheduled run can be delayed under load, especially at the start of every hour, runs only on the default branch, is disabled after 60 days without activity in a public repository, and notifies the user who last changed its cron line, by email only if that user's Actions notification setting allows it. So the founder turns on email for failed workflows, checks weekly that the watchdog still runs, and expects the email roughly 35 to 50 minutes after the last successful reconcile, later when GitHub is busy. The alert is an email, not a page.

Revisit if: the watchdog misses an outage in a drill or for real, GitHub's schedule delays exceed about half an hour often, the repository becomes private (Actions minutes), or a family grows beyond the pilot, when a paging channel may be worth a paid monitor.

## ADR-25 · updated 2026-09-18
`reconcile` runs every 15 minutes (W3), so the first re-run of an answer comes 15 to 30 minutes after it arrived, and all three attempts of a text answer fall within about 45 minutes, not 25; the 24-hour window, the three attempts, and the 25-to-48-hour window of the founder's note are unchanged. Why: every reconcile wakes the Neon database, and Neon's Free plan (100 compute hours a project a month, compute suspended when they are used, scale to zero after 5 idle minutes; neon.com/pricing, checked 2026-09-17) would be used up by a reconcile every 5 minutes, about 180 compute hours a month at 0.25 compute units, which would suspend production mid-month. The founder watches Neon usage and moves to a paid plan before families beyond the dogfooding week if usage approaches the limit (`infra/README.md`, section 2). Flows §3.15 re-checks every reconcile threshold at 15 minutes.

## ADR-26 · updated 2026-09-18
The pilot Worker also owns the `ReconcileHeartbeat` Durable Object class and its migration, which the admin Worker does not bind, and `GET /healthz` reads it (ADR-18 update). The pilot Worker no longer holds a heartbeat URL secret, so neither Worker holds one. When an account's subdomain changes, the places to change also include the cross-links between the two privacy notices, followed by `pnpm --filter @vela/worker notices`, the organiser agreements' notice links, the `/healthz` URL in `.github/watchdog.json`, and the webhook, registered again with the setup script's `webhook` step (`--from webhook`) rather than a hand-set `WORKER_URL` (`03-code-design.md` §9).
