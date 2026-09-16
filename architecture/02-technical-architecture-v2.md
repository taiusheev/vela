# Vela technical architecture, v2

2026-09-17. **This is the build blueprint.** It replaces the v1 technical design (`archive/architecture/01-technical-design.md`). Every tool choice in it was checked against the alternatives in September 2026 by five due-diligence sweeps (`architecture/research/`); the ten records that changed are appended to `decisions.md` (ADR-11 to ADR-20). The product it builds is `product/05-product-spec-v2.md`; the markets and their order are `plan/market-order.md`; the data model is `schema.sql` (validated in a real Postgres engine); the interface is `api-contract.md`; the sprint order is `plan/build-plan.md`.

Reading order for someone new: §1 constraints → §2 overview → §6 scheduling → §7 gateway → §8 adapters → §9 AI → §10 app. The rest is reference.

---

## 1. Constraints that shape everything

| # | Constraint | Where it comes from | What it forbids |
|---|---|---|---|
| 1 | **One arrival per member per local day, within 5 minutes of her hour, never twice** | Spec §4.1 | Any design where two schedulers can race; any send path that bypasses the database gate |
| 2 | **The light lights on the raw answer, before any AI, transcription, or third-party call** | Spec §5.2, ADR-5 | AI on the safety path; synchronous calls to providers in the answer webhook |
| 3 | **Every message to a third person is sent by a person's tap** | Spec §8 | Automatic escalation; any outbound to a nearby contact without an actor id |
| 4 | **One notification per member per day, enforced in code** | Spec §15, ADR-6 | Multiple send paths; per-feature discipline |
| 5 | **A quarter of days will be silent even when everything works; our own outage must never produce a quiet notice** | research/08, /14 | Timers that fire on wall-clock alone; quiet logic that cannot distinguish "not delivered" from "not answered" |
| 6 | **Data stays in the family's region; minimum data; deletion provable** | Spec §17, ADR-7 | Cross-region joins; copying inputs into logs; soft-delete-forever |
| 7 | **Nothing to install for her; the app is the floor** | Spec §0, market order | Channel-specific logic above the adapter line |
| 8 | **Near-zero cost until revenue; one builder** | Founder | Always-on servers, seat-priced tools, a second language in the stack |
| 9 | **Every AI output auditable and comparable across prompt versions** | ADR-8 | Free-text parsing; unversioned prompts; unlogged calls |
| 10 | **Runs for 100 families on free tiers and for 100,000 without a rewrite** | Founder | Single-region assumptions; per-minute cron scans that do not scale; per-seat licences |

---

## 2. System overview

```
                       ┌───────────────────────────── Family side ─────────────────────────────┐
                       │  Expo app (iOS · Android · web)                                        │
                       │  modes: family · parent surface · kitchen table    widgets (iOS/Android)│
                       └───────────────┬───────────────────────────────────────┬────────────────┘
                                       │ HTTPS (Clerk session)                  │ push (Expo → APNs/FCM)
┌──────────────────────────────────────▼───────────────────────────────────────▼──────────────────────┐
│  Cloudflare Workers "vela" and "vela-admin" (Hono, TypeScript; on workers.dev in the pilot, ADR-26) │
│  ├─ /v1/* API (api-contract.md)            ├─ /webhooks/{line,whatsapp,telegram,voice,billing}     │
│  ├─ Member Durable Objects  (one per member with arrivals: alarms for arrival · repeat · quiet ·   │
│  │   turn prompt · weekly read; recomputed from the IANA zone on every fire)                        │
│  ├─ Queues: "outbound" (gateway sends) · "understand" (AI) · "media" · dead-letter                  │
│  ├─ Cron Triggers (housekeeping only): reconciliation every 5 min · retention nightly · metrics    │
│  └─ Admin: pages in the Worker "vela-admin", behind Cloudflare Access; later the admin SPA          │
│      bindings: Hyperdrive ×3 (apac · eu · us) · R2 ×3 · Queues · DO · Rate Limiting · secrets      │
└──────┬────────────────┬───────────────────┬─────────────────────┬───────────────────────────────────┘
       │                │                   │                     │
┌──────▼──────┐  ┌──────▼──────┐   ┌────────▼────────┐   ┌────────▼─────────────────────────────────┐
│ Neon Postgres│  │ Cloudflare  │   │ Channel providers│   │ AI providers                             │
│ per region   │  │ R2 per      │   │ LINE Messaging   │   │ Anthropic Claude (Opus 5 · Sonnet 5 ·    │
│ apac·eu·us   │  │ region      │   │ WhatsApp Cloud   │   │ Haiku 4.5): structured outputs, batch,   │
│ (schema.sql) │  │ (media)     │   │ Telegram Bot     │   │ prompt caching                           │
│              │  │             │   │ Twilio voice/SMS │   │ Deepgram Nova-3 (STT) · Azure TTS        │
└──────────────┘  └─────────────┘   └──────────────────┘   └──────────────────────────────────────────┘
       ▲
       │ read-only
┌──────┴───────────────────────────────────────────────────────────────────────────────────────────────┐
│ Ops: Sentry (errors, cron monitor) · Healthchecks.io heartbeat (outside Cloudflare) · Workers Logs   │
│ PostHog Cloud EU (app funnels, flags) · founder dashboard reads metrics_daily · GitHub Actions + EAS  │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Technology (2026 pick) | Alternatives checked |
|---|---|---|---|
| Worker | API, webhooks, scheduler, gateway, adapters, AI orchestration, admin assets. In the pilot, two Workers from one package, each on its workers.dev hostname only: `vela` (webhooks, privacy notice pages, scheduler, queues, cron) and `vela-admin` (the admin pages, with Cloudflare Access on the whole Worker) (ADR-26) | Cloudflare Workers, Hono 4, TypeScript 7 strict | Vercel, AWS Lambda + EventBridge Scheduler, Cloud Run, Fly.io, Railway, Render, Supabase Edge (research/platform-and-data §2a) |
| Per-member scheduler | Precise wake-ups per member in her time zone | Durable Objects with alarms | Per-minute cron scan (v1), EventBridge one-off schedules, pg_cron |
| Queues | Decouple sends and AI from webhooks; retries; dead-letter | Cloudflare Queues (at-least-once, no dedup: the outbox gates) | SQS FIFO (dedup, but a second cloud), Cloud Tasks |
| Database | System of record, one per region | Neon Postgres 18 (native `uuidv7()`), projects in Singapore, Frankfurt, US-East; Hyperdrive pooling with query caching off | Supabase (Tokyo region; fallback for Japan), PlanetScale Postgres, Crunchy, Aurora v2, Cloud SQL, D1 (ruled out: free-tier row caps enforced 2026-09-01) |
| Media | Voice notes, photos; signed URLs; 30-day lifecycle | R2, one bucket per region, jurisdiction flag where available | S3 (egress), B2 (archive tier later), Supabase Storage |
| Mobile | Family app, parent surface, kitchen table, widgets | Expo SDK 55 (RN 0.83, React 19.2, New Architecture) | Flutter, Compose Multiplatform, native, Capacitor, PWA (research/mobile-stack §2) |
| Auth | Organisers and members with accounts | Clerk (phone OTP, email, Apple, Google; Expo SDK); Better Auth as the self-hosted fallback | Supabase Auth, Firebase, Auth0, Cognito, Stytch |
| AI | Understanding, flags, chips, suggestions, translation, weekly read, hello | Anthropic Claude via the Messages API, structured outputs, batch, caching | OpenAI GPT-5.6 family, Gemini 3.x (as fallback providers) |
| Speech | STT and TTS | Deepgram Nova-3 batch (STT), gpt-4o-transcribe as second opinion, SenseVoice/Groq Whisper benchmarked in the pilot; Azure Neural TTS (zh-TW, en, ja) with on-device `expo-speech` fallback | AssemblyAI, Google Chirp 3, ElevenLabs, Fish Audio, MiniMax (residency caution) |
| Channels | LINE, WhatsApp, Telegram, voice/SMS, push | LINE Messaging API direct; WhatsApp Cloud API direct (after the entity); Telegram Bot API; Twilio Studio + Gather for the voice line; Expo Push | BSPs (markup), Vapi/Retell/Bland (not needed for a fixed script), OneSignal (not needed) |
| Admin | Founder's daily ops view, evals browser, flags | Small React SPA (Vite) served by the Worker, same API with an admin role; in the pilot, server-rendered pages in the admin Worker `vela-admin` behind Cloudflare Access (ADR-22, ADR-26) | Retool, Forest Admin, Appsmith (seat pricing, third-party data path) |
| Observability | Errors, traces, cron liveness, alerts | Sentry free tier (+ Crons), Workers Logs, Healthchecks.io heartbeat | Grafana Cloud, Honeycomb, Axiom, Better Stack |
| Analytics | Product funnels, flags, replay | PostHog Cloud EU (free tier); the founder's KPIs come from `metrics_daily` | Amplitude, Mixpanel, Segment |
| CI/CD | Tests, migrations, deploys, mobile builds | GitHub Actions; Wrangler; Drizzle migrations; Neon branch per PR; EAS Build/Submit/Update | macOS runners (10× Linux cost), Prisma (needs a proxy on Workers) |

---

## 3. Platform decision, with the alternatives

**Chosen: Cloudflare Workers + Durable Objects + Queues + R2 + Hyperdrive, with Neon Postgres per region.**

Why, in the sweep's numbers: the cheapest platform at every scale (about $5 a month at 1,000 families, under $100 at 100,000); zero cold starts; one bill and one dashboard; and the only surveyed platform with a native per-object precise wake-up (Durable Object alarms) instead of a cron scan. Neon is real Postgres (row-level security, logical replication, built-in pooling) with projects physically pinned to Singapore, Frankfurt, and the US, and scale-to-zero pricing that makes an idle region cost cents.

What was checked and why it lost:

| Option | Why not now | When it would win |
|---|---|---|
| AWS Lambda + EventBridge Scheduler + SQS FIFO | The most correct scheduling primitive (native one-off, IANA-aware, DST-safe schedules) and the only queue with dedup, but three services, IAM, and per-region deployments are more surface than one builder should carry | If we ever need broker-level dedup or a no-Cloudflare requirement |
| Fly.io / Railway / Render | Simpler mental model (one always-on process) but pay from day one, bring-your-own scheduling and queues, and Render has no Tokyo or Sydney | If Workers CPU limits bite on media work |
| Vercel Functions + Cron | No per-user scheduling, seat pricing, no queue | Never for this workload |
| Supabase (Edge Functions + pg_cron + Auth + Storage) | Cron-scan pattern, colder starts, three projects cost ~$75/month baseline; but it has a **Tokyo** region Neon lacks | For Japan in-country residency, as the apac-jp database behind the same Hyperdrive interface |
| Cloudflare D1 | SQLite semantics, single region, free-tier daily row caps enforced since 2026-09-01 (already an outage cause elsewhere) | Prototype only (the phase-0 bot); never the system of record |

Known limits we accept and watch: Cloudflare Regional Services pins execution, not deployment, and excludes Queues and Cron; the R2 "EU jurisdiction" flag pins storage location but Cloudflare is a US corporation (CLOUD Act reach), so we never describe hosting as "local"; Workers cannot run ffmpeg, so audio is encoded on the device (AAC/M4A) and never transcoded server-side; Durable Object SQLite storage and Workflows pricing changed in 2026 and are re-checked after three months of real usage.

---

## 4. Repository layout

One monorepo, pnpm workspaces + Turborepo, TypeScript strict everywhere, Biome for lint and format, Renovate for dependencies.

```
vela/
  apps/
    worker/                 # Cloudflare Worker: Hono routes, DOs, queue consumers, cron
      src/routes/           # /v1/*, /webhooks/*, /admin/*, /internal/*
      src/do/               # MemberScheduler Durable Object
      src/queues/           # outbound, understand, media consumers
      src/cron/             # reconcile, retention, metrics, heartbeat
      wrangler.jsonc        # the pilot Worker "vela": bindings per environment (dev, staging, production)
      wrangler.admin.jsonc  # the admin Worker "vela-admin", from the same package (ADR-26)
    mobile/                 # Expo SDK 55 app; Expo Router; modes family/, parent-surface/, kitchen-table/
      ios/                  # WidgetKit target (Swift) — the fallback if expo-widgets churns
      android/              # react-native-android-widget output
    admin/                  # Vite + React SPA; served by the Worker as static assets
  packages/
    contracts/              # Zod schemas: API request/response, events, adapter types (api-contract.md §11–12)
    core/                   # pure domain logic: composer, ladder, budget, time math, state machine — no I/O
    db/                     # Drizzle schema (source of truth), migrations/, clients, PGlite test helper
    adapters/               # line/, whatsapp/, telegram/, voice/, app/ — one folder per channel, fixtures/
    ai/                     # prompts/<call>.v<N>.ts, schemas, client, speech, cost accounting, evals/
    copy/                   # messenger strings in en and zh-TW, t()
    services/               # application services behind ports: tick, gateway, flows, pipeline, jobs
    i18n/                   # Lingui catalogs: en (source), zh-TW, ja, de, hi
    ui/                     # NativeWind components (family) + StyleSheet kit (parent surface)
    audio/                  # expo-audio wrappers, waveform, TTS/STT adapters
  evals/                    # Promptfoo config + golden set (anonymised, consented)
  infra/                    # environments, account checklist, sub-processors, runbooks/
```

Rules: `packages/core` has no imports from I/O packages and is 100% unit-tested; adapters import only `contracts`; the app imports only `contracts` and `ui`/`audio`; every AI call goes through `packages/ai` (no direct SDK use elsewhere).

---

## 5. Domain model

The schema is defined in `packages/db/src/schema.ts` (34 tables) and exported to `schema.sql`. The invariants the code relies on:

- **`exchanges_one_per_day`**: a partial unique index on `(recipient_id, scheduled_for)` for every state from scheduled onward. This is the idempotency backbone: two Durable Object fires, two queue deliveries, or a replayed cron cannot create a second delivery for the same local day.
- **`outbound_budget_idx`**: a partial unique index on `(member_id, local_day, kind)` for the budgeted kinds. The budget is a database constraint, not a check in code.
- **`outbound.actor_id` CHECK** for `nearby_ask`: a message to a third person cannot exist without a person's id.
- **`answers (channel, external_id)` unique**: duplicate webhooks are no-ops.
- **`quiet_events.exchange_id` unique**: one quiet event per exchange; its `outcome` is never null after resolution and feeds the precision page.
- **`members.next_wake_at`** is the reconciliation index (§6.4), not the primary scheduler.
- Media rows carry `expires_at`; the retention job deletes and writes a `deletions` row with a content hash, so deletion is provable without keeping the content.
- `events` is append-only (a plain table until volume justifies partitioning); it carries kinds and durations, never content.

The exchange state machine (spec §3) is implemented as a pure function in `packages/core/exchange.ts`: `transition(exchange, event) → exchange | Error`. Illegal transitions throw; the API and the consumers call the same function.

---

## 6. Scheduling

### 6.1 The primitive

One **Durable Object per member who receives arrivals** (every kept-light member; ordinary members while they have scheduled content), id = member id, living in the family's jurisdiction where the platform allows. The object stores: `memberId`, `tz`, `arrivalTime`, `pending: {kind, at}[]` sorted, and re-arms one alarm at the earliest pending time (a DO holds one alarm; the rest wait in storage).

Kinds and how each is computed, always from the member's IANA zone via `Temporal`/`@date-fns/tz`, never by adding 24 h:

| Kind | Fires at | Guard before acting |
|---|---|---|
| arrival | next local `arrival_time` | member active, not paused; no exchange delivered for that local day (index) |
| repeat | delivery + 150 min | kept-light; no answer; not away |
| quiet | delivery + `quiet_after_min` (learning period: in-app only until 480 min) | kept-light; no answer; not away; delivery succeeded (never on our failure) |
| turn_prompt | 19:00 local of the turn holder, the evening before | turns enabled; no ask scheduled for tomorrow |
| weekly_read | Sunday 18:00 local (or `story_day` + 1) | kept-light; Light plan or trial; not already written |

On `alarm()`: read state, pick every pending item whose time has passed, and for each: insert the gate row (`exchanges` transition to scheduled/delivered, or `outbound` row) with `ON CONFLICT DO NOTHING`; **enqueue only if the insert happened**; recompute the next occurrence from the zone; re-arm. DST is handled by construction: "tomorrow at 08:00 Asia/Taipei" is 23 or 25 hours away on transition days because it is derived from wall-clock time. A nonexistent local time (spring-forward gap) resolves to the next valid minute; a repeated local time (fall-back) fires once because the local-day gate is a date.

### 6.2 Why not the v1 cron scan

A per-minute scan of `members.next_wake_at` is fine at 100 families and increasingly wrong at 100,000: Cloudflare Cron Triggers neither retry nor alert on a missed tick (and had a degraded incident on 2026-09-09), UTC-only cron granularity makes the 5-minute promise a coin toss, and a shared scan is where double sends come from. The DO alarm is per member, retried by the platform, and cheap.

### 6.3 Composition at arrival time

The `arrival` consumer runs `compose(member, day)` from `packages/core`: pick the scheduled ask, else the oldest "whenever", else the story question on story day, else the fallback hello; prepend yesterday's replies (read-back); render one `OutboundMessage` per the spec's composition rules; hand it to the gateway. Chips for a question are drafted **the evening before** (batch AI call, §9) so the morning path makes no AI call at all.

### 6.4 Reconciliation (the safety net)

A Cron Trigger every 5 minutes runs one query per region: members whose `next_wake_at < now() − 10 min` with no exchange delivered for today's local date. For each: log `scheduler.missed` to Sentry, re-arm the DO, deliver with the "sorry this is late" line if more than 3 h late. The same tick pings the Healthchecks.io heartbeat; if the ping stops, the founder is paged from outside Cloudflare (the application cannot know it missed its own wake-up).

### 6.5 Tuning

Weekly, per kept-light member: `quiet_after_min = clamp(median(latency of last 14 answered days) + 120, 240, 600)`; Sunday median used on Sundays and her country's holidays if it differs by more than 60 min. `learning_until = light_consented_at + 14 days`. `arrival_time` learned from the first 14 answer times if the organiser never set a wake time.

---

## 7. The outbound gateway

Every message to a person passes through `gateway.send(kind, member, message, actor?)`:

1. Compute `local_day` from the member's zone.
2. `INSERT INTO outbound (…) ON CONFLICT DO NOTHING` with the idempotency key `${kind}:${member}:${day}` (nearby asks: `${quiet}:${contact}`). If nothing was inserted, return `duplicate`. The budget index rejects a second `arrival`, `repeat`, `turn_prompt`, `weekly_read`, `ack`, or `answer_receipt` for the same day; the CHECK rejects a `nearby_ask` without an actor.
3. Enqueue `{outbound_id}` to the `outbound` queue. The consumer loads the row, calls `adapter.send()`, sets `sent_at` and `external_id`; on failure retries 3× with backoff (5, 15, 30 min); then `failed`, the organiser is told once ("we couldn't reach Mom on LINE today"), and the quiet ladder is **not** armed for that day (constraint 5).
4. Every outcome writes an event.

Flags (`kind = flag`) are the single exception to the budget and are logged as such. Nothing else in the codebase calls an adapter.

---

## 8. Channel adapters

Contract: `api-contract.md` §12. Each adapter is a folder with `send.ts`, `webhook.ts`, `identity.ts`, `fixtures/` (real recorded payloads, valid and tampered) and a contract test that runs every fixture through `verify` and `parse`.

| Adapter | Order | Buttons | Voice in / out | Read receipt | Daily-message rule and cost (per parent-month, 36 sends) | Identity and consent | Deviations from the contract |
|---|---|---|---|---|---|---|---|
| **LINE** (Taiwan, Japan) | 1 | Quick replies ≤13, template buttons ≤3, Flex cards | In: audio via `api-data.line.me` (m4a); out: HTTPS URL + duration, m4a ≤200 MB | **None**; "seen" is unknown on LINE | Push messages count against the plan; replies are free; Light free/200, Standard NT$1,000/3,000 (from 2026-11-01), High NT$1,400/6,000; ~NT$12 per parent-month at Standard scale | Follow the Official Account via the invite link (`?ref=token`); account linking without LINE Login; `unfollow` = blocked | No read receipts, so the ladder counts from delivery; quota tracked in `adapters/line/quota.ts` and degrades to reply-only when exhausted; an unverified OA runs in the founder's name pre-entity |
| **WhatsApp Cloud API** (Germany, UK, India, US as available) | 2, after the entity | Reply buttons ≤3, lists ≤10; only in-window or in an approved template | In: OGG/Opus ≤16 MB; out: same, in-window or template | Yes (`read` status, unless the user disabled it) | The daily ask is a **Utility template** outside the 24 h window ($0.004–0.046 per message by country); in-window replies free until 2026-10-01, billed after; ~$0.35–1.80 per parent-month | Phone number is identity; opt-in collected in the app before the first message; STOP honoured immediately | Two wire shapes for one `Arrival` (template vs free-form) chosen at send time by window state; Meta Business Verification needs the legal entity; messaging tiers cap unique recipients per day |
| **Telegram** (instrument; families who already use it) | 0 | Inline keyboards | OGG/Opus ≤50 MB both ways | None; reactions are a bonus signal | Free; ~30 msg/s global soft cap | `/start <token>` deep link | Kept trivial to retire; never a market's primary channel |
| **Voice line** (Twilio Studio + `<Play>`/`<Gather>`) | phase 2 | DTMF digits | Out: plays the family's voice notes; in: recording (extra cost) or keypress | Call events only | Per-minute: Taiwan $0.12–0.20, US landline ~$0.014, Japan $0.07–0.19; number rental $1.15/month | Phone number; explicit consent captured at onboarding (US TCPA informational calls still need prior express consent) | Does not fit `Arrival`; a separate `VoiceCallAdapter` composes the day's audio into a Studio flow; legal review per country before launch (Japan, Germany, India have open gaps) |
| **SMS** (US fallback) | phase 2 | "reply 1 or 2" | None | Delivery only | 10DLC brand $4.50–46 one-off + campaign; ~$0.0083 per segment + carrier fees | Phone number; STOP/UNSUBSCRIBE mandatory | Buttons flattened to numbered replies |
| **App / push** | 1 | Native | Native | App reports `seen` | Expo Push, free; iOS time-sensitive entitlement for the quiet notice | Clerk session | Push is delivery-only; the app's `seen`/`answer` calls are the inbound path; a reconciliation job, not push delivery, is the failure signal |

Webhook security, enforced by a CI contract test, not a checklist: LINE HMAC-SHA256 of the raw body with the channel secret (`x-line-signature`); WhatsApp HMAC-SHA256 with the app secret (`X-Hub-Signature-256`, timing-safe compare, plus the `hub.challenge` handshake); Telegram secret-token header; Twilio request signature. A tampered fixture must fail every adapter.

Inbound path for a kept-light member's answer: verify → parse → `resolveIdentity` → **synchronous single write** (answer row, exchange → answered, light lit, cancel repeat, resolve quiet) → 200 within 1 s → enqueue `understand`. Everything else (transcription, AI, translation, receipts, replies) is asynchronous.

---

## 9. AI service

### 9.1 Calls, models, and effort

All calls go through `packages/ai`, use the Anthropic SDK (`@anthropic-ai/sdk`), structured outputs (`output_config.format` with the Zod schema), adaptive thinking, and the effort level below. Prompt caching on the system prompt for every call; the Batch API (50% off) for every call that is not needed within minutes.

| Call | Input | Output schema | Model | Effort | Sync or batch | Why this model |
|---|---|---|---|---|---|---|
| `understand` | transcript or text, last 3 summaries, profile (address form, language) | `{summary, mood_words[], mentions{people,places,plans,health,dates}, away_until?, language}` | `claude-sonnet-5` | low | sync (needed for the organiser's day note) | Judgment at $2/$10 per MTok; 1M context irrelevant here |
| `flag` | same as understand | `{flag: bool, category?, severity?, evidence_quote?}` | `claude-opus-5` | low | sync | A missed health or safety signal is the expensive failure; run the strongest model at low effort rather than a cheaper model at high effort |
| `chips` | question, her last 20 answers | `{chips: string[3]}` | `claude-haiku-4-5` | (budget_tokens n/a; no thinking) | batch, evening before | Templated drafting |
| `suggest` | recent mentions, family dates, holder's last ask, rotation | `{type, text, source}` | `claude-haiku-4-5` | — | batch, 18:30 local | Same |
| `translate` | text, from, to, who speaks to whom | `{text}` | `claude-sonnet-5` | low | sync for same-day, batch otherwise | Register-preserving; DeepL has no formality control for Chinese or Japanese |
| `readback` | yesterday's replies | `{lines: string[]}` | `claude-sonnet-5` | low | batch, before her arrival | Summarises reactions as words, no counts |
| `weekly_read` | 7 days of summaries, timing stats, mentions | `{lines[], suggestion}` | `claude-sonnet-5` | medium | batch, Sunday | Longer reasoning over a week |
| `hello` | yesterday's replies, address form | `{lines[2]}` | `claude-haiku-4-5` | — | batch | Only when nothing was queued |
| `recipe` | the recipe exchanges | `{title, ingredients[], steps[], remarks[]}` | `claude-sonnet-5` | low | batch | Occasional |

Requests to `claude-opus-5` set `betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"` (the reference documents fallbacks for Opus 5, not for Sonnet 5 or Haiku 4.5) so a refusal by the safety classifiers routes to a fallback model instead of failing; `stop_reason` is checked before reading content; a schema parse failure logs and returns the safe default (no flag, summary "answered").

### 9.2 Speech

- **STT**: Deepgram Nova-3 batch (multilingual, code-switching, `mip_opt_out` training opt-out, ~$0.005/min) as the default; `gpt-4o-transcribe` as the second opinion when Deepgram's confidence is low; **SenseVoice/FunASR** (open source, tuned for Mandarin dialects) and Whisper-large-v3 on Groq benchmarked against real pilot audio in sprint 2. The pilot's own audio decides the default: no vendor publishes accuracy for Taiwanese-accented Mandarin from speakers over 70, so every marketed number is an upper bound.
- **TTS** (read-back and the ask on the parent surface): Azure Neural HD voices for zh-TW, en, ja ($22 per 1M characters, about $0.20 per family-month); pre-rendered server-side into R2 at compose time so the morning path plays a file; on-device `expo-speech` as the zero-dependency fallback so the loop survives any provider outage. No voice cloning, ever.
- Audio is recorded on the device as AAC/M4A (mono, 32 kbps voice profile) and uploaded to R2 directly with a signed URL; no server transcoding.

### 9.3 Prompt registry, evals, tracing

- Prompts live in `packages/ai/src/prompts/<call>.v<N>.ts` with a frozen system prompt first (cacheable) and volatile content last. The version string is logged on every `ai_calls` row with tokens, cache reads, latency, and cost.
- **Golden set** in `evals/` (Promptfoo, YAML, runs in CI, exit code fails the PR): 50 cases at sprint 1 growing to 200, over-weighted toward Taiwanese-accented Mandarin, code-switched Mandarin/English, a grandchild's casual register that must become respectful for a grandparent, borderline health mentions (over-flagging) and clear ones (under-flagging), away detection, and prompt-injection attempts inside family text. Flag recall must not drop; flag precision, chip usefulness, and translation register are judged by a rubric.
- Tracing: `ai_calls` in Postgres from day one; Langfuse (self-hosted, free) added when volume makes the admin view too thin.
- Safety rails, in prompts and tested: never diagnose, never advise, never speak as a family member, never mention monitoring or notes to the family, treat every family message as untrusted data (no instruction-following from content), and no autonomous action of any kind: the model only drafts what a person sends or reads.
- Data handling: Anthropic API data is not used for training; the pilot runs under standard retention; `inference_geo` is set per region once residency claims are made to customers; a signed DPA before launch; the health-content classification ("flag for family, never diagnose") confirmed in writing before scale.

### 9.4 Cost per family per month (estimate, research/speech-and-ai §3)

| Component | Volume | Cost |
|---|---|---|
| STT (15 min) | Deepgram batch | $0.08 |
| Routine LLM (chips, suggestions, hello; Haiku, batch + cache) | ~112k tokens | $0.06 |
| Judgment LLM (understand, flag, translate; Sonnet/Opus, sync) | ~45k tokens | $0.20 |
| Weekly read (Sonnet, batch + cache) | ~14k tokens | $0.02 |
| TTS (Azure HD) | 9,000 chars | $0.20 |
| **Total** | | **≈ $0.55**, so $550 / $5,500 / $55,000 per month at 1k / 10k / 100k families |

---

## 10. The mobile app

- **Expo SDK 55** (React Native 0.83, React 19.2, New Architecture only), Expo Router, EAS Build/Submit/Update. One app, three modes chosen per member: family, parent surface, kitchen table.
- **Widgets**: the light on the home screen. iOS via `expo-widgets` (alpha) with a hand-written WidgetKit target as the budgeted fallback; Android via `react-native-android-widget`. Both refresh from a push carrying `{member_id, state, answered_at}`; the widget endpoint `/families/:id/lights` is cacheable for 60 s.
- **Audio**: `expo-audio` (not `expo-av`, removed in SDK 55); AAC/M4A; `isMeteringEnabled` drives the visible level meter; `expo-speech-recognition` as an offline dictation fallback; pre-rendered TTS files with `expo-speech` fallback.
- **State**: TanStack Query for server state, Zustand for the little client state, `expo-sqlite` cache, `expo-secure-store` for tokens. No offline-first sync engine in v1 (revisit only if the parent must compose offline for hours).
- **UI**: the parent surface in plain `StyleSheet` so every size is explicit (22 pt body, 64 pt targets, 88 pt primary, 7:1 contrast, light mode only, `maxFontSizeMultiplier` set deliberately, `AccessibilityInfo` for screen reader and reduced motion); the family app in NativeWind with the Candle & Ink tokens; Literata and Inter via `@expo-google-fonts`, Noto Sans TC/JP as CJK fallbacks.
- **i18n**: Lingui (compile-time ICU; zh/ja plural rules), English as source, `zh-TW` at MVP, `ja`, `de`, `hi` in phase 2. `date-fns` v4 + `@date-fns/tz` for zones.
- **Push**: Expo Push Service; the quiet notice uses the iOS time-sensitive interruption level (not critical alerts); Android channel "Vela" with one importance level.
- **Kitchen-table mode**: landscape route, `expo-keep-awake`, photos cycling from the family book, one chime, tested on a 2019 Android 8 tablet before phase 2.
- **Payments**: none in the app until the entity exists. When it does: RevenueCat (`react-native-purchases`, free to $2,500 tracked revenue/month) for App Store and Play billing; a web checkout link may appear only where store rules allow external links (US, EU, Japan), never in Taiwan or India; in those storefronts the trial is opened from a Settings-level link, not an in-app "Buy".
- **Quality**: Biome; Jest + React Native Testing Library; Maestro CLI flows (readable by the founder); Sentry; PostHog (EU); Apple accessibility label and Google health-app disclaimer completed at first submission.

---

## 11. Auth and identity

- **Clerk** for organisers and members with accounts: phone OTP (no per-message surcharge), email magic link, Sign in with Apple and Google; Expo SDK; free to 50,000 monthly retained users. The Worker verifies Clerk session JWTs (JWKS cached in the Worker). Better Auth (MIT, self-hosted, Expo plugin) is the fallback if Clerk's retained-user pricing bites past 50k.
- **Kept-light members have no account.** Their identity is a `channel_links` row (LINE userId, WhatsApp number, Telegram id, phone) or, on the parent surface, a device-bound token issued when a visiting child signs in and hands over the phone (`primary_surface = parent-surface`; no password, no email; re-issued by any organiser).
- **Roles** are per membership (organiser, member) plus a global admin allow-list read by the admin routes; every admin read of a family writes `admin_access_log` and an event visible to the organiser on request. In the pilot, before accounts exist, the admin identity is the founder's Cloudflare Access sign-in: Access covers the whole admin Worker `vela-admin`, and the Worker verifies the Access token itself (ADR-22, ADR-26).

---

## 12. Data residency and privacy engineering

- **Regions**: `apac` (Neon Singapore, R2 APAC), `eu` (Neon Frankfurt, R2 with EU jurisdiction), `us` (Neon US-East, R2 US). A family's region is fixed at creation and never moves without export and import: the kept-light member's country picks the preferred region, and a family whose preferred region does not exist yet is created in `apac` (in the pilot only `apac` exists, so every family is `apac`; ADR-7, update of 2026-09-14). Japan volume that requires in-country hosting gets a Supabase Tokyo project behind the same region router.
- **Region router**: `packages/db/region.ts` resolves `family_id → region` from a small global lookup (family id → region) kept in a Durable Object/KV so a request never touches the wrong database; every query is scoped by family.
- **What the AI sees**: the answer, the ask, the family's replies, the member list with roles and languages, memory facts. Never billing, never nearby contacts' numbers, never the whole archive.
- **Minimum data and retention**: names, address forms, cities, hours, 30 days of answers and media, the family book by choice, summaries, weekly reads, precision outcomes. Retention jobs (nightly cron per region, ADR-24): after 30 days, the text of asks, replies, translations, chips, and suggestions, answers' text, transcripts, mentions, mood words, and flag reasons, outbound payloads, AI outputs, and nearby-ask replies are cleared, and message refs are deleted; media past `expires_at` unless kept; invites 30 days after expiry or acceptance, and expired onboarding sessions; members `left` past 30 days; families within 24 hours of `deleted_at`; `events`, `metrics_daily`, `ai_calls`, and `outbound` rows past 24 months; a member's Durable Object storage when they stop, leave, die, or are deleted. Summaries, the flag boolean, and away dates stay while the family uses Vela. Every media deletion writes a `deletions` row with a content hash.
- **Consent records**: `consents` rows with the exact text version, language, channel, and evidence; light consent, nearby-contact consent, the privacy notice, and the pilot agreement. The silence notice to another family member is itself a disclosure and is named in her consent text.
- **Legal minimums by market** (research/platform-and-data §4): GDPR (DPA with every sub-processor, sub-processor list with 30 days' notice, data map, breach notice within 72 h, deletion windows); Taiwan PDPA as amended November 2025 (privacy notice updated within 90 days, breach notification rules, DPO where warranted); Japan APPI as amended January 2026 (prior consent and a 3-year transfer record for data leaving Japan; no small-business exemption); India DPDP (cross-border allowed by default; 48-hour pre-deletion notice to data principals). Sub-processors at launch: Cloudflare, Neon, Anthropic, Deepgram, Microsoft (Azure TTS), Clerk, LINE, Meta, Twilio, Sentry, PostHog, Expo.
- **Never built**: location tracking, camera or microphone monitoring, contact-list upload, advertising identifiers, voice cloning.

---

## 13. Security

- Webhook signatures verified on the raw body before parsing, in every adapter, enforced by contract tests (§8).
- Cloudflare Rate Limiting binding on invite redemption, auth, and media upload URLs; invite tokens single-use and expiring; media URLs signed for 15 minutes.
- Secrets only in Worker secrets, `.dev.vars`, and GitHub environment secrets for deploys (`CLOUDFLARE_API_TOKEN`, `DATABASE_URL`; never repository secrets, ADR-23); Infisical when a second environment or person needs synced secrets; no keys in the repo; Renovate for dependency updates.
- TLS everywhere; provider encryption at rest for Neon and R2 during the pilot; field-level envelope encryption (AES-256-GCM, keys in Worker secrets) for transcripts decided before launch, not retrofitted at scale.
- Backups: Neon point-in-time restore (plan-dependent history) plus a **quarterly restore drill** (restore to a timestamp, verify counts, discard); R2 versioning on the family-book prefix.
- Admin reads logged and visible to organisers; in the pilot the admin pages are a Worker of their own, `vela-admin`, so Cloudflare Access covers every hostname they answer on while Telegram's webhook stays on the public Worker `vela` (ADR-26); MFA on every provider account; a one-page incident runbook (notify, rotate, status update) and a one-page sub-processor list written in sprint 1.
- Status page: Instatus free tier at pilot; alerts in §15.

---

## 14. Failure modes

| Failure | Effect | Handling |
|---|---|---|
| Channel API down or account throttled | Arrival undelivered | Gateway retries 3× over 50 min; then `failed`; organiser told once; **no quiet ladder that day**; the app offers the next channel |
| Durable Object alarm missed or Cloudflare cron degraded | Late arrival | Reconciliation cron re-arms and delivers with the late note; Healthchecks.io pages the founder if ticks stop; `exchanges_one_per_day` prevents doubles |
| Postgres unreachable in one region | That region pauses | Webhooks return 503 (providers retry); alarms re-arm with backoff; Sentry critical alert; other regions unaffected |
| AI provider down or slow | Answers not understood | The light lit already (constraint 2); `understand` queue drains later; the family sees "Mom answered" with the media |
| STT fails on her audio | No transcript | Answer still counts; the family hears the voice; transcript retried with the second provider; logged for the pilot benchmark |
| Duplicate webhook | Duplicate answer | `answers (channel, external_id)` unique |
| Her phone number or LINE account changes | Link dead | `unfollow`/blocked events; organiser told; re-invite flow; the light pauses without a quiet notice |
| Wrong time zone | Arrival at the wrong hour | Zone set from city at onboarding, checked against the first three answer times; a mismatch over 3 h prompts the organiser |
| Push undelivered but reported delivered | Organiser misses a quiet notice | The quiet notice also lives in the app and the widget; reconciliation compares `outbound.sent_at` with app `seen` events and re-sends in-app |
| A kept-light member dies | Any message would be cruel | Any member marks it; every DO cancels its alarms within the hour; no automated message of any kind afterwards; the family book offered for export |

---

## 15. Observability, SLOs, alerts

SLOs: arrival sent P95 ≤ 5 min and P99 ≤ 15 min after her hour; a scheduler tick recorded at least every 10 minutes per region; duplicate sends zero (constraint, alert as backstop); quiet notices attributable to our own outage zero (silence drill, §16); webhook ack P95 ≤ 1 s.

| Signal | Threshold | Where | Severity |
|---|---|---|---|
| Heartbeat missing | > 10 min | Healthchecks.io (outside Cloudflare) | Page |
| Arrival unsent past hour + 5 min | any | reconciliation cron → Sentry | High |
| Budget index rejection for `arrival`/`quiet_notice` | any | Sentry log alert | Medium (should never happen) |
| Adapter send failure rate | > 5% in 15 min on one channel | Sentry | High |
| Dead-letter queue growth | any | Queues DLQ → Sentry | High |
| Quiet notice fired | every | `quiet_events`, reviewed daily in the admin | Informational |
| Provider spend | 50/80/100% of tier | Cloudflare, Neon (hard cap), Anthropic, Twilio budget alerts | Medium |
| Postgres unreachable | 5xx spike | Sentry + synthetic `/readyz` | Critical |

The founder's daily view reads `metrics_daily` and `quiet_events` in the admin SPA: answer rate, latency, quiet notices and outcomes, stop rate, families per market, AI cost. PostHog (EU) carries app funnels, flags, and replay; it never receives content.

---

## 16. Testing and CI

```
   AI evals (Promptfoo golden set; flag recall gate)          ← every prompt change
   E2E (Maestro CLI: onboarding, invite, first ask, first answer, quiet notice)   ← nightly
   Integration (pglite in CI; Neon branch per PR for migrations): scheduler DO, gateway budget, adapters with fixtures
   Unit (Vitest): composer, ladder, budget, time math, state machine, adapter rendering
```

DST cases in Vitest with fake timers: spring-forward gap (exactly one arrival), fall-back repeat (no double), a half-hour-offset zone, a zone without DST. **Silence drill** (runs in CI on a schedule): adapter throws for a cohort → organiser told once, `quiet_events` empty; missed tick → next tick respects the one-per-day gate and the heartbeat would have paged; Postgres down during the tick → clean skip, admin alert, no quiet event; AI down → light lit, no quiet event. Contract tests: every adapter's fixtures, valid and tampered. Load: k6 locally against staging at 10× expected peak.

CI (GitHub Actions, Linux): typecheck → Biome → unit → integration (pglite) → contract → Promptfoo (on prompt changes) → Wrangler deploy to staging on main → production on tag. Migrations: Drizzle Kit generates SQL into `packages/db/migrations/`, reviewed in the PR, and applied by each environment's deploy job before `wrangler deploy` (ADR-23); until that job exists, the founder runs them. Mobile: EAS Build (Linux CI never runs macOS), EAS Submit to TestFlight and Play internal testing, EAS Update for JS-only fixes under a written OTA policy (bug fixes, copy, layout; never features or entitlements outside review).

---

## 17. Environments and delivery

| Env | Worker | Databases | Channels | Mobile |
|---|---|---|---|---|
| dev | `wrangler dev` (`vela-dev`; `vela-admin-dev` beside it with `pnpm --filter @vela/worker dev:admin`) | pglite locally; a personal Neon branch | Telegram test bot; LINE test OA | Expo dev client on the founder's phone |
| staging | `vela` (`https://vela.vela-light-staging.workers.dev`) and `vela-admin` (`https://vela-admin.vela-light-staging.workers.dev`), in the "Vela staging" Cloudflare account | Neon branches of each region | Telegram test bot; LINE test OA; WhatsApp sandbox | TestFlight / Play internal (dev client) |
| prod | `vela` (`https://vela.vela-light.workers.dev`) and `vela-admin` (`https://vela-admin.vela-light.workers.dev`), in the "Vela" Cloudflare account | Neon main branches (apac, eu, us) | Real accounts | Store builds; EAS Update channel `production` |

Release: trunk-based; PRs run the full CI; `main` deploys to staging; a tag deploys to production after the founder's approval, its deploy job migrating once, then deploying `vela`, then `vela-admin` (ADR-26); mobile releases weekly during the pilot, with EAS Update for JS-only fixes.

---

## 18. Cost model (monthly, order of magnitude, before volume discounts)

| Families | Cloudflare | Neon ×3 | R2 | AI + speech | Channels (LINE/WhatsApp mix) | Tools (Sentry, PostHog, Healthchecks, Clerk, Expo) | Total |
|---|---|---|---|---|---|---|---|
| 100 | $5 | $0 | $0 | ~$55 | ~$40 | $0 (free tiers) | **≈ $100** |
| 1,000 | $5–10 | ~$60 | ~$5 | ~$550 | ~$400 | ~$50 | **≈ $1,100** |
| 10,000 | ~$15 | ~$300 | ~$50 | ~$5,500 | ~$4,000 | ~$300 | **≈ $10,000** |
| 100,000 | ~$70 | ~$2,000 | ~$500 | ~$55,000 | ~$40,000 | ~$3,000 (Clerk ~$1,000) | **≈ $100,000** |

At 10,000 families with 10% on Light at $79/year the gross margin is thin; at 20% it is healthy. AI and channel costs dominate and are the first optimisation targets (batch and cache discipline, LINE reply-message accounting, WhatsApp utility categorisation, self-hosted STT once volume justifies it). Infrastructure itself stays under 3% of cost throughout.

---

## 19. Risks and what would make us switch

| Risk | Signal | Switch |
|---|---|---|
| Cloudflare is a US corporation; jurisdiction flags do not remove CLOUD Act reach | A regulator or enterprise customer requires no-US-nexus storage | Storage to an EU provider, compute to Fly.io or Render; Neon unchanged |
| Neon has no Tokyo region | Japan becomes a primary market with in-country expectations | Supabase Tokyo project behind the same region router |
| `expo-widgets` is alpha | API churn before ship | Hand-written WidgetKit target (already in the repo layout) |
| WhatsApp pricing moving (in-window utility billed from 2026-10-01) | Cost per parent-month above $2 | Prefer LINE and the app where possible; re-price Light in India |
| LINE has no read receipts | Ladder timing on LINE noisier than on WhatsApp | Longer T_quiet floor on LINE (300 min) after pilot data |
| Cloudflare cron degraded (2026-09-09 incident) | Heartbeat pages | Reconciliation and the DO alarms already carry the load; EventBridge Scheduler is the fallback design |
| Clerk pricing is per retained user, not MAU | Bill above $500/month | Better Auth (Expo plugin, self-hosted) |
| Old Android 8 tablets and the New Architecture | Jank in kitchen-table mode | A minimal native shell for that mode only (ADR-3 fallback) |
| No published STT accuracy for elderly Taiwanese Mandarin | Pilot WER above 20% | Self-hosted SenseVoice or fine-tuning on consented pilot audio |
| Cloudflare Queues have no dedup | A duplicate send ever observed | The outbox already gates; SQS FIFO in front of the send path if broker dedup is required |

---

## 20. What only the founder can do

1. Legal entity (Singapore likely): gates WhatsApp Business verification, Apple and Google organisation accounts (D-U-N-S number takes 30+ days; start now), payments.
2. Accounts in the founder's name now: Cloudflare, Neon, Anthropic, Deepgram, Azure (TTS), Clerk, Sentry, PostHog, Healthchecks.io, Expo, a LINE Official Account (unverified is allowed for individuals), Telegram bot, Twilio (later).
3. The name decision (ship as "Vela Light" until clearance). No domain is needed for the pilot: each Cloudflare account's workers.dev subdomain (`vela-light`, `vela-light-staging`) is chosen when the account is set up (ADR-26).
4. Native reviewers for Traditional Chinese now, Japanese in phase 2.
5. The first families: own parent, three to five friend families, five Taiwanese families.

---

## 21. Decision records added

ADR-11 Durable Object alarms plus outbox replace the cron scan · ADR-12 Drizzle for schema and migrations · ADR-13 Clerk for auth, Better Auth as fallback · ADR-14 Speech stack (Deepgram default, pilot benchmark decides; Azure TTS with on-device fallback) · ADR-15 Model routing by call (Opus 5 for flags, Sonnet 5 for judgment, Haiku 4.5 for drafting; batch and cache) · ADR-16 Adapter order LINE → WhatsApp → voice; Telegram instrument only; MAX dropped · ADR-17 Custom admin SPA · ADR-18 Heartbeat monitoring outside Cloudflare · ADR-19 Expo SDK 55 with native widget targets · ADR-20 External payment links only where store rules allow; RevenueCat when the entity exists. Later records that change what this document names: ADR-22 and ADR-26 (the pilot's admin pages in their own Worker `vela-admin` behind Cloudflare Access, both Workers on workers.dev). See `decisions.md`.
