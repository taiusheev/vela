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

## ADR-5 · The flame lights on the raw answer, before any AI
**2026-09-12 · accepted**

Decision: answer capture, flame lighting, and ladder cancellation happen synchronously in the webhook path; AI understanding runs afterwards from a queue.

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
