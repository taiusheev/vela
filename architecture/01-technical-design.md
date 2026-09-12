# Vela technical design

v1, 2026-09-12. How the product in `product/02-app-plan.md` and `product/03-product-spec.md` is built. Decisions and rejected alternatives are in `architecture/decisions.md`. Diagrams: `design/diagrams/architecture.drawio`, `database.drawio`, `daily-loop.drawio`.

Guiding constraints: one non-technical founder and an AI co-founder; near-zero budget until revenue; must run for 100 families on free tiers and for 100,000 without a rewrite; the parent side must work with nothing installed; every AI output must be auditable.

---

## 1. Components

| Component | Responsibility | Technology |
|---|---|---|
| **Family app** | Member surfaces: home, thread, queue, turns, settings, parent surface, kitchen-table mode | React Native with Expo (one codebase, iOS + Android), Expo Router for the web build |
| **API** | All reads and writes for the app and web; webhooks from channels; auth | TypeScript on Cloudflare Workers (Hono router), one deployable |
| **Scheduler** | Decides, every 5 minutes, what is due: arrivals, repeats, quiet notices, turn prompts, weekly reads | Cloudflare Cron Trigger → Queue → Worker consumers |
| **Outbound gateway** | The only place that sends anything to a person; enforces the notification budget and idempotency | Worker + Queue |
| **Channel adapters** | Telegram, WhatsApp, LINE, MAX, Viber, voice/SMS, in-app push; one interface | Modules inside the API/gateway; each with its own webhook route |
| **AI service** | Transcription, understanding, flags, prompts, fallback composition, translation, weekly read, drift | Claude via the Anthropic API; prompt registry; structured outputs; every call logged |
| **Database** | System of record | Postgres (Neon), one project per data region, reached from Workers through Hyperdrive |
| **Media store** | Voice notes, photos, drawings | Cloudflare R2, per-region bucket, signed URLs |
| **Event log** | Append-only record of sends, answers, AI calls, decisions | Postgres table `events` (partitioned monthly) |
| **Admin** | Internal view for the first months: who's quiet, what got flagged, what the model said | Web page behind auth in the same Worker |
| **Billing** | Free vs Light, trials, second member | Stripe (web checkout) first; RevenueCat for in-app purchases in phase 2 |
| **Auth** | Members sign in; kept-light members on messengers never have an account | Supabase Auth (magic link, phone OTP); JWT verified in the Worker |
| **Observability** | Errors, latency, KPI jobs | Sentry (free tier), Workers analytics, a nightly KPI job writing `metrics_daily` |

Why this shape: one Worker deployable, one Postgres, one queue. A single engineer can hold the whole system in their head, the free tiers cover phase 0 and 1, and every piece scales horizontally without redesign.

## 2. Data flow, end to end

```
Member queues an item (app)  ──▶ API: items.insert  ──▶ events
                                        │
Cron (every 5 min) ──▶ Scheduler: SELECT members WHERE next_arrival_at <= now() AND NOT sent(today)
                                        │
                                        ▼
                         Composer: pick items → story? → fallback? → render per channel
                                        │
                                        ▼
                         Outbound gateway: budget check → adapter.send() → arrivals.sent_at → events
                                        │
Channel webhook (answer) ──▶ API: adapter.parse() → answers.insert → Queue: understand(answer_id)
                                        │
                                        ▼
                         AI worker: transcribe → understand → translate → light.light → thread.post
                                        │                        │
                                        │                        └──▶ flag? → notice to organiser
                                        ▼
                         Ladder: cancel repeat/quiet for that member+day; resolve open quiet_event
```

Every arrow writes an event. The KPI job reads events, never the live tables.

## 3. Scheduler design

**Principle:** no long-lived timers. A cron fires every 5 minutes; a single query finds what is due; each due action is enqueued with an idempotency key; consumers do the work.

- `members.next_arrival_at` is stored in UTC, recomputed after each send from the member's `arrival_hour` and IANA time zone (DST-safe via the tz database in Workers).
- Due arrivals: `next_arrival_at <= now()` and no `arrivals` row for `(member_id, local_day)`. The `UNIQUE(member_id, day)` constraint makes double sends impossible even if two crons overlap.
- Repeats: `arrivals` with `sent_at <= now() - 2.5h`, `repeated_at IS NULL`, no answer, light on, not away.
- Quiet notices: `arrivals` with `sent_at <= now() - T_quiet(member)`, no answer, light on, not away, no open `quiet_events` row.
- Turn prompts: members whose turn is tomorrow and local time is 19:00 ± 5 min.
- Weekly reads: kept-light members whose local time is Sunday 18:00 ± 5 min and no read for this week.
- Queue messages carry `{type, member_id, day}`; consumers re-check state before acting (the world may have changed in the 5 minutes since enqueue).

Scale: 100,000 members means ~14 due arrivals per 5-minute tick on average, peaking at a few thousand at popular hours. One Postgres query and a queue absorb that.

## 4. Channel adapter contract

```ts
interface Channel {
  id: "telegram" | "whatsapp" | "line" | "max" | "viber" | "voice" | "app";
  capabilities: { buttons: boolean; voiceOut: boolean; voiceIn: boolean; readReceipts: boolean; media: boolean };
  send(link: ChannelLink, msg: OutboundMessage): Promise<{ externalId: string }>;
  parseWebhook(req: Request): Promise<InboundEvent[]>;   // answers, reactions, joins, blocks
  verifyWebhook(req: Request): boolean;                   // secret token / signature
}
type OutboundMessage = { text: string; media?: MediaRef[]; voice?: MediaRef; buttons?: Button[]; idempotencyKey: string };
type InboundEvent = { link: ChannelLink; kind: "tap" | "reaction" | "text" | "voice" | "photo" | "join" | "blocked"; payload: unknown; at: string };
```

Rules:
- The composer renders one `OutboundMessage` per member per day and hands it to the gateway; the adapter decides how to express buttons and voice given its capabilities.
- Webhooks are verified, parsed into `InboundEvent`s, and acknowledged within 1 s; all work happens off the request via the queue.
- Adapters never talk to the AI service or the database beyond `channel_links`; they are pure translation layers, so a new messenger is a new file.
- Per-channel notes: Telegram (free, buttons, voice both ways; throttled in Russia); MAX (official bot API, buttons; state-run); WhatsApp Cloud API (template messages outside the 24-hour window, per-message cost, business verification, no bots in groups); LINE (rich messages, Taiwan/Japan); Viber (bot API); voice/SMS via Twilio-class provider (TTS for text, play voice notes, DTMF or speech for the answer).

## 5. Outbound gateway and the notification budget

Every message to a person passes through one function that:
1. Checks the budget table for `(member_id, local_day, kind)`; kinds are `arrival`, `repeat`, `turn_prompt`, `quiet_notice`, `weekly_read`, `ack`, `system`. Limits per §13 of the product spec. Over budget → dropped and logged, never sent.
2. Checks `idempotencyKey` against `outbound` (unique); a duplicate is a no-op.
3. Calls the adapter; records `outbound.sent_at` and the external id; on adapter failure retries 3× with backoff, then marks failed and opens an admin alert.

This is the one place the anti-addiction promise is enforced in code.

## 6. AI pipeline

**Calls, in order of volume.**

| Call | Input | Output (structured) | Model | Notes |
|---|---|---|---|---|
| transcribe | audio, language hint | text, detected language | speech-to-text provider (Whisper-class); Claude for cleanup | Cheapest path; cached by media id |
| understand | answer text/transcript, last 3 summaries, member profile (address form, language) | summary, mood_words[], mentions{people, places, plans, health, dates}, flag, flag_reason, away_detected{until} | Claude, effort low | One call per answer |
| acknowledge | understand output, member profile | one warm reply (≤2 sentences, ≤1 question) | Claude, effort low | Only for kept-light members, once a day |
| translate | text, from, to, speaker→listener relationship | translation | Claude, effort low | Register-preserving |
| prompt | member's recent mentions, family dates, contributor's last item | one sentence | Claude, effort low | Evening before a turn |
| fallback | yesterday's summary, weather, address form | two lines | Claude, effort low | Only when nothing queued |
| weekly_read | 7 days of summaries, timing stats, mentions | 3–5 lines + one suggestion | Claude, effort medium | Sunday |
| drift (phase 3) | 21 days of stats | signals[] with confidence | model + rules | Conservative thresholds |

**Prompt registry.** Each call has a versioned system prompt in `ai/prompts/<name>.v<N>.md`; the version is stored on every log row, so we can compare v3 against v4 on the same inputs.

**Structured outputs.** Every call uses a JSON schema (Zod) and the API's structured output mode; parse failures are logged and fall back to a safe default (no flag, generic summary "answered").

**Logging.** `ai_calls(id, member_id, call, prompt_version, input_hash, input_ref, output, tokens_in, tokens_out, latency_ms, at)`. Inputs are stored by reference to the answer, not copied, so retention rules apply once.

**Evaluation.** A held-out set of real answers (with consent, anonymised) labelled by hand for summary quality, flag correctness, and away detection; run on every prompt change; flag recall must not drop; flag precision tracked. Quiet-notice precision comes from `quiet_events.outcome`, not from the model.

**Cost.** Per kept-light member per day: ~1 understand (≈1.5k tokens in, 200 out), ~1 acknowledge, occasional translate. At $5/$25 per million tokens: about $0.01–0.02 per member per day; $0.30–0.60 per month. Ordinary members cost a fraction. Weekly read adds ~$0.05 per week. Comfortably under 10% of a $9.99 subscription even with a generous model.

**Guardrails (in the prompts, tested).** Never medical, legal, or financial advice; never pretend to be a family member; never mention monitoring, data, or that the family receives notes; escalate on the defined signals; keep the acknowledgement to two sentences; reply in the member's language and address form.

## 7. Data model

The schema is drawn in `design/diagrams/database.drawio`. Points that matter beyond the diagram:

- **`members` carries the scheduling fields** (`arrival_hour`, `tz`, `next_arrival_at`, `quiet_after_min`, `usual_answer_window`) so the scheduler query touches one table.
- **`arrivals(member_id, day)` is unique.** The day is the member's local date. This is the idempotency backbone.
- **`answers` are rolling 30 days**; a nightly job deletes older rows and their media, except answers that were kept as stories.
- **`quiet_events.outcome`** is the precision dataset. It is never null after resolution.
- **`events`** is partitioned by month and never updated. The KPI job and the admin view read it.
- **`channel_links.external_id`** is the parent's identity on a messenger; there is no account for her.
- Soft deletes nowhere; a `left` member is a status; deletion is a real delete after the retention window.

## 8. Security and privacy architecture

- **Data residency.** One Postgres project and one R2 bucket per region: `eu` (default), `apac` (Taiwan, later Japan/Korea), `us`. A family's region is chosen at creation from the kept-light member's country and cannot move without export/import. Russia's localisation law is a legal question, not a technical one; the pilot stores minimal data in `eu` and a review precedes any Russian launch (`decisions.md` ADR-7).
- **Encryption.** TLS everywhere; Postgres and R2 encrypted at rest by the providers; media URLs are signed and expire in 15 minutes.
- **Secrets.** Worker secrets only; no keys in the repo; adapters verify webhook signatures or secret tokens.
- **Minimum data.** No health records, no location, no contact scraping. The AI sees the answer, the last three summaries, and the profile; it never sees the whole thread.
- **Consent records.** `members.light_consented_at`, `nearby_contacts.consented_at`, and the event that carried the consent text.
- **Deletion.** Family deletion cascades within 24 h; member `left` after 30 days; answers after 30 days; the archive only if kept. A deletion is an event with a hash of what was deleted, so we can prove it happened without keeping it.
- **Access.** Admin view gated by a short allow-list; every admin read of a family is logged as an event visible to the organiser on request.
- **What we never build.** Location tracking, camera or microphone monitoring, contact-list upload, advertising identifiers.

## 9. Failure modes and what happens

| Failure | Effect | Handling |
|---|---|---|
| Messenger API down (Telegram throttled, WhatsApp outage) | Arrival not delivered | Gateway retries 3× over 30 min; if still failing, the arrival is marked undelivered, the organiser is told once ("we couldn't reach Mom on Telegram today"), the ladder does not fire (no false quiet notice from our own outage) |
| Our Worker down at the arrival minute | Arrival late | Cron catches up on the next tick; `UNIQUE(member_id, day)` prevents doubles; arrivals more than 3 h late are sent with a note ("sorry this is late") |
| Postgres unreachable | Everything pauses | Workers return 503 to webhooks (channels retry); cron ticks skip; alert to admin |
| AI provider down | Answers not understood | Answer still lights the light immediately (light lighting never depends on the AI); understanding runs when the queue drains; the family sees "Mom answered" with the media |
| Duplicate webhook delivery | Duplicate answer | `answers.external_id` unique per channel |
| Member's phone changes number | Channel link dead | Detected on `blocked`/`unreachable` events; organiser told; re-invite flow |
| Quiet notice fires while member is asleep (wrong tz) | False notice | Tz is set from the city at onboarding and confirmed by the first three answer times; a mismatch > 3 h triggers a check with the organiser |

Rule that follows from the table: **the light lights on the raw answer, before any AI runs.** Nothing on the safety path depends on the model.

## 10. Environments and delivery

- `dev` (local `wrangler dev` + a Neon branch), `staging` (a Worker + Neon branch, real Telegram test bot), `prod`. Migrations by SQL files applied in order (`db/migrations/`), reviewed in the PR.
- CI on every PR: type check, unit tests for the composer, ladder, and budget; contract tests for each adapter against recorded webhooks; the AI eval set on prompt changes.
- Mobile: Expo EAS builds; TestFlight and Play internal track for the pilot families; over-the-air updates for JS-only changes.
- Feature flags in a `flags` table read by the Worker, so phase-2 features can ship dark.

## 11. Cost at scale (monthly, order of magnitude)

| Families | Members | Workers | Postgres | R2 | AI | Messaging | Total |
|---|---|---|---|---|---|---|---|
| 100 | 600 | $0 | $0 | $0 | ~$40 | $0 (Telegram) to ~$5 (WhatsApp) | under $50 |
| 1,000 | 6,000 | $5 | $19 | $5 | ~$400 | ~$50 | ~$500 |
| 10,000 | 60,000 | $50 | $70 | $50 | ~$4,000 | ~$500 | ~$5,000 |
| 100,000 | 600,000 | $500 | $700 | $500 | ~$40,000 | ~$5,000 | ~$47,000 |

At 10,000 families with 40% on Light at $9.99, revenue is ~$40,000 per month against ~$5,000 of infrastructure. AI is the dominant cost and is the first thing to optimise (cheaper model for transcription cleanup and translation, caching the system prompt, batching weekly reads).

## 12. What the phase-0 prototype already gives us

The Telegram bot in `bot/` implements: onboarding for the organiser, the invite link, the morning arrival with a button, answer capture, AI understanding with flags, the repeat and the notice ladder, and a founder admin chat. In the MVP it becomes the Telegram adapter plus the first version of the composer and ladder; the D1 database is replaced by Postgres and the schema in `database.drawio`.

## 13. Open technical questions

1. Speech-to-text provider: Whisper-class API vs on-device on the parent surface. Decide in phase 1 on accuracy for elderly Russian and Mandarin speech.
2. WhatsApp template approval: our daily arrival may be classified as marketing; test with Meta before the Philippines launch.
3. MAX bot API maturity and terms: verify what data the platform retains.
4. Voice line provider for landlines in Russia and Taiwan: Twilio coverage vs local carriers.
5. Whether Expo's web build is good enough for the kitchen-table mode on old tablets, or whether that needs a lightweight native shell.
