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
**2026-09-13 · accepted**

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
**2026-09-14 · accepted · narrows ADR-17 for the pilot**

Decision: in the pilot, the admin surface is server-rendered pages and HTML POST forms under `/admin` in the Worker, behind a Cloudflare Access application that covers `/admin` only. The Worker verifies the `Cf-Access-Jwt-Assertion` token itself (signature, audience, issuer, expiry) and takes its `email` claim as the admin identity; a POST must also be same-origin. The actions are `ADMIN_ACTIONS` in `@vela/contracts`: `view`, `record_consent`, `record_contact_consent`, `add_contact`, `remove_contact`, `set_away`, `end_away`, `mark_left`, `mark_deceased`, `delete_family`, `send_weekly_read`, implemented in `@vela/services` `admin.ts`. Each one writes an `admin_access_log` row (`action` checked against the tuple, `member_id` without a foreign key so the log outlives members, `what` never holding message content) and a domain event in the same transaction. ADR-17's admin SPA replaces these pages once API v1 exists.

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
