# Build plan

2026-09-14. Sprint-by-sprint, task-level. Built from `architecture/02-technical-architecture-v2.md`, `product/05-product-spec-v2.md`, `plan/market-order.md`, and `plan/pre-build-readiness.md`. Twelve weeks in six sprints; each sprint has a definition of done that a non-technical founder can verify. The co-founder builds; the founder runs accounts, families, and reviews.

Conventions: every task names its spec section; "DoD" is the definition of done; tasks marked **F** are the founder's; a sprint is not done until its DoD is demonstrated on a real device or a real family.

## Sprint 0 · Day 0 (one afternoon, before sprint 1)

| # | Task | Owner | DoD |
|---|---|---|---|
| 0.1 | Monorepo bootstrap: pnpm + Turborepo, Biome, TypeScript strict, `apps/worker` (Hono), `packages/contracts`, `packages/core`, `packages/db` (Drizzle), CI skeleton (typecheck, lint, unit) | co-founder | `pnpm test` green on an empty suite; CI runs on PR |
| 0.2 | Accounts: Cloudflare, Neon (project `vela-apac` in Singapore), Anthropic key, Deepgram key, Sentry, Healthchecks.io, Expo/EAS, Telegram bot (BotFather), LINE Official Account + Messaging API channel (unverified, founder's name); GitHub environments `staging` and `production` (production with the founder as required reviewer) | **F** | Keys pasted by the founder into Worker secrets, and `CLOUDFLARE_API_TOKEN` and `DATABASE_URL` into each GitHub environment's secrets (no repository secrets); `wrangler deploy` to staging succeeds |
| 0.3 | Schema applied with `packages/db/migrations/0000_init.sql` to the `vela-apac` branches `staging`, then `main`; PGlite tests in CI. Until the first database is migrated, a schema change regenerates `0000_init.sql` instead of adding `0001`. Migrations run in the deploy job before `wrangler deploy` (1.15); until that job exists, the founder runs `pnpm --filter @vela/db migrate` from their own terminal (`infra/runbooks/release.md`) | co-founder; the migration run **F** | 34 tables on both branches; the one-per-day and actor tests pass in CI |
| 0.4 | `docs/` runbooks: incident (one page), sub-processor list, OTA policy, restore drill | co-founder | Files exist and are linked from the README |

## Sprint 1 · Weeks 1–2 · The instrument, on the real platform

Goal: the phase-0 loop (spec Appendix A) running for the founder's family and three to five friend families on Telegram, on the production architecture (Worker, Neon, DO scheduler, gateway, events), so nothing is thrown away.

| # | Task | Spec | DoD |
|---|---|---|---|
| 1.1 | Privacy notice and consent script, EN and ZH-TW; `consents` rows written with text version | §9, §17 | Founder reads it to their parent; no objection; stored with version |
| 1.2 | `packages/core`: exchange state machine, composer (priority rules, read-back opening, fallback hello), ladder timings, budget kinds, local-day and DST math; unit tests incl. DST cases | §3, §4, §8 | 100% coverage on core; DST suite green |
| 1.3 | Member Durable Object: alarms for arrival, repeat, quiet, turn prompt; recompute from zone; storage cleared when the member stops, leaves, dies, or is deleted; reconciliation cron; heartbeat ping | arch §6 | Silence drill part 2 passes; Healthchecks shows a live check |
| 1.4 | Outbound gateway with the `outbound` table, budget index, actor CHECK, retries, DLQ; a send refused because the group became a supergroup re-points the family group and is sent again at once without counting an attempt | arch §7 | A second arrival for the same day is rejected in an integration test; a send to an upgraded group reaches the new id |
| 1.5 | Telegram adapter: send with inline buttons and voice; webhook verify + parse (message, callback, voice, reaction, blocked); fixtures | arch §8 | Contract tests pass, tampered fixture fails |
| 1.6 | Family Telegram group flow: 19:00 prompt, "reply to ask", `whenever:` items, "Into her morning" confirmation; her private-chat arrival with buttons; answer capture (light lit synchronously), counting a message sent before the arrival as that day's answer; her messages ignored until she taps yes and after a no; read-back next morning | App. A | Founder's family completes one full loop: ask → answer → replies → read back; a message typed before the consent tap reaches nobody |
| 1.7 | AI service v0: `understand`, `flag`, `chips`, `readback`, `hello` with Zod schemas, structured outputs, prompt registry, `ai_calls` logging; Deepgram STT; Promptfoo golden set v0 (50 synthetic cases) gating in CI | arch §9 | Evals green; a flagged synthetic answer produces an organiser notice |
| 1.8 | Quiet notice to the organiser in Telegram (facts, nearby contacts who said yes as text, buttons "she's fine", "wait 2 h"); learning period logic | §8 | A simulated silent day produces one notice at T_quiet, none on delivery failure; a contact without a recorded yes never appears |
| 1.9 | Event log + `metrics_daily` job + a first admin page behind Cloudflare Access: an overview of every family's day without content (deliveries, answer and quiet states and times, AI call failures), and a page per family with its answers, summaries, and AI outputs; every view writes `admin_access_log`, one row for each family the page shows; flag and draft messages to the founder's chat carry a link, never her words | §18, arch §15 | Founder can see every family's day on one page; opening the overview logs a `view` row for each family listed |
| 1.10 | **F** Own parent live by day 7; three to five friend families by day 14; onboarding calls double as interviews; UCLA-3 at week 0 | App. A | Five families live; founder's parent answered 5 of 7 days |
| 1.11 | Departures: Telegram's `left_chat_member` becomes `member_left`; in a linked group a member who leaves (not an organiser, not the kept-light member) becomes `left` and drops out of the turn rotation; an organiser or the kept-light member leaving changes nothing and sends the founder `admin.member_left_group`; someone with no link stores nothing; a member who left and asks, replies, or reacts in the group again is active again | §2, §7 | In the staging group, a sibling who leaves is not named in the next turn prompt; an organiser who leaves keeps their state and the founder gets one note |
| 1.12 | Admin write actions on the Access-protected page: record a pilot or privacy-notice consent; record a nearby contact's yes or no; add or remove a contact; set or end an away period; mark a member left; mark the kept-light member deceased (light off, schedule cleared, nothing sent, messages already queued dropped, group asks ignored); request family deletion; each a POST form with the Access token and same-origin checks, writing `admin_access_log` and an event | §9, §17, arch §11 | The founder records pilot, privacy-notice, and nearby-contact consents from the page instead of the Neon console; each action appears in `admin_access_log` with its event; a request without a valid Access token or from another origin is refused |
| 1.13 | Understanding re-run: `processing_attempts` counted per answer; `understood_at` only when understand and flag both succeed; `reconcile` re-enqueues answers not understood after 15 minutes and within 24 hours, up to 3 attempts; `admin.understand_failed` once after the third | §5, arch §9 | A voice answer whose transcription fails twice is transcribed on its third ingestion and understood, with one transcript post and one flag notice; a text answer whose flag check fails twice is understood on its third attempt with one flag notice; an answer that ends its third attempt not understood sends the founder one note |
| 1.14 | Weekly read draft and send: the Sunday draft stores the week's counts in `weekly_reads.stats` and gives the AI only the days the parent answered; the founder edits the draft's lines and suggestion on the admin page, sees the count lines but cannot edit them, and taps Send; the sent lines and suggestion are stored, and each organiser gets in Telegram the counts rendered from numbers (`renderWeeklyRead`), then the lines, then the suggestion; a Send that reaches no organiser is refused rather than recorded as sent; "what does the family see" shows the latest sent read's lines after the summaries, never its counts or suggestion, translated into the parent's language when the family's differs | §8, §9, §13, App. A | The founder's family receives its first weekly read from the Send button, opening with the counts; the parent's "what does the family see" includes its lines, in the parent's language, with no count and no suggestion |
| 1.15 | GitHub deploy workflow: environments `staging` (merge to `main`) and `production` (tag, founder's approval); `CLOUDFLARE_API_TOKEN` and `DATABASE_URL` as environment secrets only; migrations, then `wrangler deploy` | arch §16–17 | A merge to `main` migrates and deploys staging with no hand step; a tag waits for the founder's approval, then migrates and deploys production; the repository has no secrets |

DoD for the sprint: five families on the instrument for at least a week; answer rate and latency visible in the admin; no double send, no false quiet notice, consent recorded for every parent.

## Sprint 2 · Weeks 3–4 · Foundation and LINE

Goal: the platform ready for the app and for Taiwan.

| # | Task | Spec | DoD |
|---|---|---|---|
| 2.1 | API v1 per `api-contract.md`: auth (Clerk JWT), families, members, invites, nearby contacts, exchanges (compose, list, answer, replies, read-back), lights, quiet actions, away, media upload URLs; Zod contracts shared | api-contract | Contract tests for every route; Postman/Bruno collection for the founder |
| 2.2 | Region router and Hyperdrive bindings for apac, eu, us; Neon projects for eu and us created but idle | arch §12 | A family created with country DE lands in the eu database |
| 2.3 | LINE adapter: follow via invite link, account linking, arrival with quick replies and audio (m4a via R2), audio download from `api-data.line.me`, postbacks, unfollow, quota tracking on the paid Standard plan | arch §8 | Founder's LINE test account completes the loop; quota shown in admin |
| 2.4 | Traditional Chinese strings for the bot path and the consent text; native reviewer sign-off | §20 | Reviewer approves; Lingui catalog `zh-TW` complete for the messenger path |
| 2.5 | STT benchmark: 30 consented pilot clips through Deepgram, gpt-4o-transcribe, SenseVoice (Groq/Whisper as baseline); WER table in the admin | arch §9.2 | Default chosen on measured WER; ADR-14 updated |
| 2.6 | TTS pipeline: Azure zh-TW/en voices pre-rendered at compose time into R2; `expo-speech` fallback path defined | arch §9.2 | Read-back plays as a file on LINE |
| 2.7 | Weekly read v0 for every live family, LINE included (AI draft, founder edits and sends from the admin page, as in 1.14) | §13 | Every live family's organisers receive a read on Sunday of week 4 |
| 2.8 | Retention job `applyRetention` (nightly, per region) implementing the data map's pilot rules (`plan/materials/pilot/data-map.md`, ADR-24): after 30 days clear `exchanges.text` and `options` (30 days after delivery), chips, translations, `replies.text`, the text in `answers.payload`, `answers.transcript`, `mentions`, `mood_words`, `flag_reason`, suggestions' text, `outbound.payload` (30 days after `sent_at`), `ai_calls.output`, and the reply text in `quiet_events.ask_to_check`; delete `message_refs` older than 30 days, invites 30 days after expiry or acceptance, and expired onboarding sessions; delete media per `expires_at` and `kept`, removing the id from `exchanges.media_ids` and `options`, with a `deletions` row for every media deletion; delete members 30 days after `left_at` and families within 24 hours of `deleted_at`; delete `events`, `metrics_daily`, `ai_calls`, and `outbound` rows older than 24 months; clear the Durable Object storage of deleted members (stop, left, and deceased clear it at once, 1.3); keep summaries, the flag boolean, and away dates while the family uses Vela. Retention tests for every rule; restore drill #1 | §17 | In a test family moved past each window, every cleared column is empty and every deleted row is gone while summaries, flags, and away dates remain; a `deletions` row exists for each deleted media file; restore drill documented |
| 2.9 | **F** Five Taiwanese families recruited; first three live on LINE by week 4; a native reviewer for zh-TW | market order | Three LINE families answering |

DoD: instrument families migrated onto the API-backed platform with no missed arrival; the first LINE family live; STT default decided from real audio.

## Sprint 3 · Weeks 5–7 · The family app

Goal: organisers use the app for asks, exchanges, and the quiet notice.

| # | Task | Spec | DoD |
|---|---|---|---|
| 3.1 | Expo app skeleton: SDK 55, Expo Router, Clerk sign-in (phone OTP, Apple, Google), design tokens (Candle & Ink), Literata/Inter/Noto fonts, Lingui en + zh-TW, TanStack Query + Zustand, Sentry, PostHog | design-system | Dev client on the founder's phone; sign-in works |
| 3.2 | A1–A5 onboarding (who, first ask, nearby, channel, the light is ready) | §14.1 | Founder creates a family from the app end to end |
| 3.3 | A6 Today: lights row, today's exchange card, tomorrow's turn and suggestion, "Ask Mom something" | §14.1 | Matches the prototype; no badge counts anywhere |
| 3.4 | A7 Ask: suggestion, type grid, two-photo picker, voice hello, translation preview, when; 409 handling | §14.1 | An ask composed in the app arrives on LINE next morning |
| 3.5 | A8 Exchanges list and the reply composer (heart, laugh, hug, text, voice, photo) | §14.1 | Replies read back to the parent next morning |
| 3.6 | A11 Quiet notice sheet with Call, Ask to check (actor-stamped), She's fine, Wait 2 h; resolution line; in-app quiet during the learning period | §14.1, §8 | Silence drill part 1 visible in the app; a nearby ask carries the actor |
| 3.7 | A12 You, A13 Vela Light (trial screen, no payment), A14 widget (iOS via expo-widgets with Swift fallback, Android widget) | §14.1 | Widget shows the light and updates on answer |
| 3.8 | Push: Expo push tokens, one-a-day budget, time-sensitive quiet notice on iOS | §15 | Exactly one push per member per day in a test week |
| 3.9 | Maestro flows: onboarding, ask, reply, quiet notice; TestFlight + Play internal builds via EAS | arch §16 | Founder installs from TestFlight |
| 3.10 | **F** Fifteen families across Taiwan and English-speaking countries; UCLA-3 at week 4 for the first cohort; decide the entity | plan | Ten families composing asks in the app |

DoD: ten families use the app for asks; answer rate ≥ 75% across kept-light members; one push per day verified.

## Sprint 4 · Weeks 8–9 · The parent surface

Goal: a parent with no messenger uses the app's parent surface, installed by a visiting child.

| # | Task | Spec | DoD |
|---|---|---|---|
| 4.1 | Parent-surface mode: device-bound token issued by an organiser; light mode only; StyleSheet kit with the accessibility checklist | §14.2, arch §10 | Passes the checklist at the largest accessibility font size |
| 4.2 | P1 consent, P2 question (chips primary, mic below, read-back first), P3 photo choice, P4 recording (expo-audio, meter, playback, send/again), P5 answered (light blooms once, replies read aloud, photos, call) | §14.2 | Two parents complete a week each |
| 4.3 | TTS read-back in English and Chinese with on-device fallback; ask audio pre-rendered | arch §9.2 | Works with the network off (fallback voice) |
| 4.4 | P6 kitchen-table mode: landscape, keep-awake, photo cycling, one chime, tap to answer; tested on a 2019 Android 8 tablet | §14.2 | Runs 24 h on the tablet without jank |
| 4.5 | Voice-line design (Twilio Studio flow, consent capture, legal notes per market) documented, not built | arch §8 | Design reviewed; US listed first |
| 4.6 | **F** Two parents on the parent surface via a visiting child (one abroad, one in Taiwan) | plan | Both answered 5 of 7 days |

DoD: parent surface answered by two parents for a week each; accessibility checklist signed.

## Sprint 5 · Weeks 10–11 · Depth and the second wave

| # | Task | Spec | DoD |
|---|---|---|---|
| 5.1 | Story day and the family book (A10): question bank (52, en + zh-TW), voting, keep/don't keep, in-app reading; PDF export job behind the Light flag | §10 | A story recorded on Sunday appears in the book |
| 5.2 | Weekly read in-app (A9) from the batch AI call with the free/locked state; suggestion; story of the week | §13 | Organisers open the read; Sunday batch job runs |
| 5.3 | Memory facts and reminder suggestions (only after a tap); recipe cards | §12 | A dated fact becomes a suggested reminder |
| 5.4 | Precision page (notices, outcomes, useful verdicts) | §8 | Page live in the app and admin |
| 5.5 | WhatsApp Cloud API adapter in the sandbox (utility template drafted, interactive replies, statuses, opt-in in the app); Meta verification started if the entity exists | arch §8 | Sandbox loop works; template submitted |
| 5.6 | Japanese localisation scoped; `ja` catalog skeleton; Azure ja voice tested | market order | Scope document; a ja read-back plays |
| 5.7 | Field-level encryption decision for transcripts (ADR); restore drill #2; load test at 10× | arch §13, §16 | ADR written; k6 report |
| 5.8 | **F** Ten Taiwanese families on LINE; NT$ pricing test designed; pricing page copy | plan | Ten LINE families answering |

DoD: family book and weekly read live; WhatsApp sandbox sending; precision page public inside the app.

## Sprint 6 · Week 12 · Measure and decide

| # | Task | DoD |
|---|---|---|
| 6.1 | Metrics review against spec §18 targets: answer rate weeks 1–4 and week 12, latency, content share, replies per answer, quiet notices per month and usefulness, stop rate, quiet-day rate, minutes per day | Report in the master plan |
| 6.2 | UCLA-3 at week 12; "if Vela stopped tomorrow" at day 30 for every organiser; willingness to pay asked (billing not open) | Report |
| 6.3 | Trial flow ready; billing provider chosen the moment the entity exists (RevenueCat + web checkout where allowed) | Decision recorded |
| 6.4 | Store readiness: listings in en and zh-TW, health disclaimer, accessibility label, privacy labels, D-U-N-S in hand | Checklist complete |
| 6.5 | Decide: open billing and a public Taiwan launch, or change one variable and rerun | Decision in the master plan |

## Cross-cutting, every sprint

- CI green on every merge; Promptfoo on every prompt change; contract tests on every adapter change.
- The silence drill runs nightly from sprint 1.
- Weekly: cost check across Cloudflare, Neon, Anthropic, Deepgram, LINE; a 30-minute founder review of the admin page; the golden set grows by ten real, consented cases.
- Every decision that changes an ADR is appended to `architecture/decisions.md` the same day.

## Kill signals during the build

Answer rate under 50% by week 4 of any cohort; stop rate over 30% in month 1; fewer than 4% of organisers willing to pay at day 90; a double send or a false quiet notice attributable to us that the tests did not catch (stop and fix before any new family).
