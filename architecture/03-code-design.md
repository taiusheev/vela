# Code design

2026-09-13. How the code is organised, the rules every package follows, and the public API of each package. It turns `02-technical-architecture-v2.md` into buildable units and is the contract parallel work is built against. When code and this document disagree, fix one of them in the same change.

## 1. Package map

```
contracts ◄── copy ◄── core ◄──────────────┐
    ▲                                       │
    ├── db                                  │
    ├── adapters                            │
    └── ai                                  │
                                            │
services ── depends on ── contracts · copy · core · db · adapters · ai (through ports)
    ▲
worker ── wires Cloudflare bindings into services' ports; owns HTTP, the Durable Object, queues, cron
```

| Package | Owns | Must not |
|---|---|---|
| `@vela/contracts` | Domain tuples and schemas, the channel adapter contract, event names | Contain logic beyond validation |
| `@vela/copy` | Every user-facing messenger string in `en` and `zh-TW`, and `t()` | Know about channels, the database, or time |
| `@vela/core` | Pure functions: local time, the exchange state machine, the daily schedule decision, ask selection, arrival rendering, button codec, idempotency keys, tuning, parent commands, turns | Perform I/O, read the clock, generate ids, or import Node or Workers APIs |
| `@vela/db` | The Drizzle schema (source of truth for the data model), migrations, database clients, the PGlite test helper | Contain business queries (those live in services) |
| `@vela/adapters` | One folder per channel implementing `ChannelAdapter`; recorded fixtures | Touch the database, AI, or scheduler |
| `@vela/ai` | Claude calls with versioned prompts and structured outputs, speech-to-text, cost accounting, fakes | Persist anything, read the clock for business decisions |
| `@vela/services` | Application services: scheduling ticks, the outbound gateway, inbound flows, the AI pipeline, jobs | Import Cloudflare APIs; everything platform-specific arrives through ports |
| `@vela/worker` | Hono routes, the `MemberScheduler` Durable Object, queue consumers, cron, bindings | Contain business logic |

Dependency direction is enforced by `package.json` dependencies: a package can only import what it declares.

## 2. Rules for all code

**TypeScript.** TypeScript 7, `strict`, `noUncheckedIndexedAccess`, no `any` (use `unknown` and narrow), no non-null assertions, `import type` for types, relative imports with the `.ts` extension, named exports only (default exports only where a platform requires them: the Worker entry and config files). Exported functions declare their return types.

**Runtime neutrality.** Runtime code in `contracts`, `copy`, `core`, `adapters`, `ai`, and `services` uses only web-standard APIs available in both Cloudflare Workers and Node 24 (`fetch`, `Request`, `Response`, `Headers`, `URL`, `crypto.subtle`, `TextEncoder`, `Intl`). Biome rejects `node:` imports outside tests, test helpers, configs, and scripts.

**Time.** Core never reads the clock; it receives `now: Date`. Services read time only through the `Clock` port. All instants are `Date` in UTC; local calendar values are `LocalDate` (`YYYY-MM-DD`) and `LocalTime` (`HH:MM`) strings interpreted in an IANA zone.

**Ids.** Row ids come from the database (`uuidv7()` defaults, Postgres 18). Code does not invent ids.

**Errors.** Expected domain failures are values or typed errors (`IllegalTransitionError`, `ChannelSendError`, `VelaError` with a `code`). Unexpected failures throw and are logged by the worker. Never swallow an error without logging it.

**Logging.** Services log through the `Logger` port with an event name and flat fields; never log message content, transcripts, phone numbers, or tokens.

**Tests.** Vitest, colocated as `*.test.ts`. Deterministic: fixed clocks, fake adapters, fake AI, PGlite for the database. Each package's `pnpm test` runs in under a minute. Test names state behaviour ("sends no quiet notice when delivery failed").

**Style.** Biome formats and lints; `pnpm check` must pass before every commit. Comments explain why, not what. No dead code, no commented-out code, no TODO without a linked task.

## 3. `@vela/db`

**Schema source of truth.** `src/schema.ts` defines every table with Drizzle. `architecture/schema.sql` is generated from it by `pnpm --filter @vela/db export-sql` and is never edited by hand. CHECK constraints for enumerated columns are generated from the tuples in `@vela/contracts`, so a value added to a tuple reaches the database through a migration.

**Changes from the reference schema** (`architecture/schema.sql` as first drafted):

1. Primary keys default to Postgres 18's native `uuidv7()`; no custom function.
2. `members.next_arrival_at` becomes `members.next_wake_at` (the reconciliation index).
3. `events` is a plain table with a `bigint` identity key and indexes on `(name, at)` and `(family_id, at)`. Partitioning waits until volume justifies it.
4. `exchanges_one_per_day` becomes `UNIQUE (recipient_id, scheduled_for) WHERE scheduled_for IS NOT NULL AND state <> 'withdrawn'`, so two asks cannot claim the same morning even before scheduling.
5. `exchanges.delivery_failed_at timestamptz`.
6. `families.language` (the family group's language, default `en`).
7. New `family_channels (id, family_id, channel, conversation_id, kind CHECK in ('private','group'), linked_by_member_id, linked_at, unlinked_at, UNIQUE (channel, conversation_id))`: the family's group chat on a messenger.
8. New `message_refs (channel, conversation_id, message_id, family_id, exchange_id NULL, quiet_event_id NULL, purpose, created_at, PRIMARY KEY (channel, conversation_id, message_id))` with `purpose` in `arrival, repeat, turn_prompt, answer_post, quiet_notice, consent, ask_confirmation`: maps a platform message to what it was about, so replies and button taps resolve.
9. New `onboarding_sessions (channel, conversation_id, external_user_id, step, data jsonb, updated_at, expires_at, PRIMARY KEY (channel, conversation_id))`.
10. `replies.channel`, `replies.external_id` with a partial unique index on `(channel, external_id)`; reactions unique on `(exchange_id, member_id, kind) WHERE kind IN ('heart','laugh','hug')`.
11. `quiet_events.last_notified_at`, `quiet_events.notify_count integer NOT NULL DEFAULT 0`, `quiet_events.notified_member_ids uuid[] NOT NULL DEFAULT '{}'`.
12. `outbound.exchange_id uuid NULL` (FK, on delete set null) and `outbound.conversation_id text NOT NULL`; the `kind` CHECK and the budget index use `OUTBOUND_KINDS` and `BUDGETED_OUTBOUND_KINDS`.
13. `turns.prompt_message_id text`.
14. `metrics_daily.family_id` and `member_id` are `NOT NULL`.

Everything else in the reference schema stays, including tables later sprints use.

**Exports.**

```ts
// @vela/db
export * from "./schema.ts";                    // tables and relations
export type VelaDatabase;                        // PgDatabase<…, typeof schema>, accepted by services
export type VelaTransaction;                     // the transaction type passed to db.transaction callbacks
export function connectDatabase(connectionString: string): Promise<{ db: VelaDatabase; close(): Promise<void> }>;  // node-postgres; used by the Worker through Hyperdrive and by scripts
// @vela/db/testing
export function createTestDatabase(): Promise<{ db: VelaDatabase; reset(): Promise<void>; close(): Promise<void> }>;  // in-memory PGlite with migrations applied
```

Row types are `typeof table.$inferSelect` and `$inferInsert`, re-exported with friendly names (`Member`, `NewMember`, …).

**Scripts.** `generate` (Drizzle Kit), `export-sql` (writes `architecture/schema.sql`), `migrate` (applies migrations to `DATABASE_URL`), `dev-db` (a persistent PGlite in `.pglite/` served over the Postgres wire protocol on port 54320 for `wrangler dev`).

**Tests.** Migrations apply cleanly to PGlite; each invariant is proven by a failing insert: one exchange per recipient per date, the budget index per kind, the `nearby_ask` actor check, answer and reply webhook dedup, one quiet event per exchange, CHECK constraints reject unknown enum values.

## 4. `@vela/copy`

```ts
export type MessageKey = keyof typeof en;
export function t(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string;
export const catalogs: Record<"en" | "zh-TW", Record<MessageKey, string>>;
```

Placeholders are `{name}`. Languages without a catalog fall back to English. Tests assert every key exists in every catalog, every placeholder in English exists in each translation and no extra ones do, `t()` throws on a missing parameter, and no string uses a gendered pronoun for the kept-light member (the product never assumes gender; use the name). Traditional Chinese strings carry a file-level note that they await native review.

Initial keys (English text is the source; wording follows spec §20: names, no "monitor/check/track", say what happens next):

| Key | English |
|---|---|
| `arrival.greeting` | Good morning, {address}. |
| `arrival.late` | Sorry this is late. |
| `arrival.repeat` | In case you missed it: |
| `arrival.readback_heading` | From yesterday: |
| `arrival.asks` | {asker} asks: |
| `arrival.asks_on_behalf` | {asker} asks, for {child}: |
| `arrival.photo_choice` | Which one? Tap 1 or 2. |
| `arrival.vote` | Tap one. |
| `arrival.hello` | Nothing new from the family today. How are you this morning? |
| `arrival.hello_signature` | Vela, from your family |
| `arrival.hint` | Reply with a voice message, or tap a button. |
| `button.fine` | I'm fine |
| `button.heart` | ❤️ |
| `button.choice` | {n} |
| `ack.thanks` | Thank you, {address}. The family will hear it. |
| `readback.replied` | {name}: {text} |
| `readback.voice` | {name} sent a voice message. |
| `readback.reactions` | {names} sent {emoji} |
| `consent.request` | {organiser} would like to keep a light on for you. Every morning someone in the family will ask you something, and when you answer, they will know you are fine. If there is no answer by evening, {organiser} will know to call. You can say stop at any time. |
| `consent.yes` | Yes, that's fine |
| `consent.no` | No, thank you |
| `consent.accepted` | Thank you. Your first morning arrives tomorrow at {time}. |
| `consent.declined` | That's fine. Nothing will arrive. |
| `organiser.consent_given` | {name} said yes. The first morning arrives tomorrow at {time}. |
| `organiser.consent_declined` | {name} said no for now. Nothing will be sent. |
| `parent.stopped` | Everything is paused. Say start whenever you would like it back. |
| `parent.started` | Welcome back. Your next morning arrives at {time}. |
| `organiser.stopped` | {name} asked to pause. Nothing is wrong with the app. |
| `parent.family_sees_heading` | This is what the family saw from you this week: |
| `parent.family_sees_empty` | Nothing yet this week. |
| `group.linked` | Hello, family. I'm Vela. Each evening I will say whose turn it is to ask {name} something for the morning. |
| `group.turn_prompt` | Tomorrow is {holder}'s turn with {name}. Reply to this message with a question, a photo, or a voice note. |
| `group.turn_prompt_open` | Tomorrow, anyone can ask {name} something. Reply to this message with a question, a photo, or a voice note. |
| `group.ask_confirmed` | Into {name}'s morning. |
| `group.ask_queued` | Tomorrow already has {asker}'s ask. This one is saved for another morning. |
| `group.answer_light` | ☀️ {name} answered {asker} · {time} |
| `group.answer_hello` | ☀️ {name} is fine · {time} |
| `group.answer_chip` | {name} chose: {choice} |
| `group.answer_pick` | {name} picked photo {n}. |
| `group.answer_vote` | {name} voted: {choice} |
| `group.answer_text` | {name}: {text} |
| `group.answer_transcript` | {name} (voice): {text} |
| `quiet.notice` | It's been quiet at {name}'s today. The morning message went out at {sent}; {name} usually answers by {usual}. Nothing worrying is known. |
| `quiet.nearby` | Nearby: {contacts} |
| `quiet.fine_button` | {name} is fine, I know why |
| `quiet.wait_button` | Wait 2 hours |
| `quiet.waiting` | I'll look again at {time}. |
| `quiet.resolved_answered` | {name} answered at {time}. Everything is lit again. |
| `quiet.resolved_fine` | {organiser} says {name} is fine. |
| `delivery.failed` | We couldn't reach {name} on {channel} today. Nothing else is known. |
| `flag.notice` | {name} said something you may want to hear: "{quote}" |
| `onboarding.welcome` | Hello, I'm Vela. Let's set up a light for someone in your family. It takes two minutes. |
| `onboarding.ask_name` | What do you call them? For example: Mom, Grandma, Dad. |
| `onboarding.ask_address` | How should I greet them each morning? For example: Mrs Chen, Mom. |
| `onboarding.ask_language` | Which language should their messages be in? |
| `onboarding.ask_country` | Which country do they live in? |
| `onboarding.ask_zone` | Which time zone? |
| `onboarding.ask_wake` | When do they usually wake up? Tap one or type a time like 07:30. |
| `onboarding.ask_nearby` | Who lives nearby and could look in if needed? Send a name and phone number, or tap Skip. |
| `onboarding.skip` | Skip |
| `onboarding.invalid_time` | Please send a time like 07:30. |
| `onboarding.done` | All set. Send this link to {name}: {link} Then add me to your family group chat, so the family can take turns asking. |
| `admin.weekly_read_draft` | Weekly read draft for {family}: |

## 5. `@vela/core`

All functions pure and synchronous.

```ts
// time.ts
localDateOf(instant: Date, timeZone: string): LocalDate
localTimeOf(instant: Date, timeZone: string): LocalTime
zonedInstant(date: LocalDate, time: LocalTime, timeZone: string): Date
  // nonexistent local time (spring-forward gap): the first valid minute after the gap
  // repeated local time (fall-back): the earlier instant
addDays(date: LocalDate, days: number): LocalDate
weekdayOf(date: LocalDate): number                 // 0 = Sunday … 6 = Saturday
addMinutes(instant: Date, minutes: number): Date
minutesBetween(from: Date, to: Date): number       // floor of (to - from) in minutes; negative if to < from
isValidTimeZone(timeZone: string): boolean
formatLocalTime(instant: Date, timeZone: string): LocalTime

// exchange.ts — spec §3
type ExchangeEvent = "schedule" | "deliver" | "see" | "answer" | "reply" | "read_back" | "archive" | "withdraw";
nextExchangeState(state: ExchangeState, event: ExchangeEvent): ExchangeState   // throws IllegalTransitionError
canApply(state: ExchangeState, event: ExchangeEvent): boolean
```

Transition table (rows: current state; a dash is illegal; `=` keeps the state):

| | schedule | deliver | see | answer | reply | read_back | archive | withdraw |
|---|---|---|---|---|---|---|---|---|
| composed | scheduled | – | – | – | – | – | – | withdrawn |
| scheduled | = | delivered | – | – | – | – | – | withdrawn |
| delivered | – | = | seen | answered | – | – | archived | – |
| seen | – | – | = | answered | – | – | archived | – |
| answered | – | – | = | = | replied | read_back | archived | – |
| replied | – | – | = | = | = | read_back | archived | – |
| read_back | – | – | = | = | = | = | archived | – |
| archived | – | – | = | = | = | = | = | – |
| withdrawn | – | – | – | – | – | – | – | = |

```ts
// schedule.ts — the daily decision for one kept-light member (architecture §6)
export const SCHEDULE = {
  repeatAfterMinutes: 150,
  lateNoteAfterMinutes: 180,
  learningNotifyMinutes: 480,
  waitMinutes: 120,
  turnPromptTime: "19:00",
  prepareTime: "22:00",
  weeklyReadTime: "18:00",
  weeklyReadWeekday: 0,
} as const;

interface ScheduleInput {
  now: Date;
  member: {
    timeZone: string; arrivalTime: LocalTime; status: MemberStatus; lightOn: boolean;
    quietAfterMinutes: number; learningUntil: LocalDate | null;
  };
  family: { turnsEnabled: boolean };
  /** The exchange days that can still need action: yesterday's and today's local dates. */
  days: DayState[];
  tomorrow: { prepared: boolean; turnPromptSent: boolean };
  awayOn: (date: LocalDate) => boolean;
  weeklyReadDoneFor: (weekEnd: LocalDate) => boolean;
}
interface DayState {
  date: LocalDate;
  prepared: boolean;
  deliveredAt: Date | null;
  deliveryFailed: boolean;
  answeredAt: Date | null;
  repeatSentAt: Date | null;
  quiet: null | { openedAt: Date; lastNotifiedAt: Date | null; waitUntil: Date | null; resolvedAt: Date | null };
}
type DueAction =
  | { kind: "deliver_arrival"; date: LocalDate; late: boolean }
  | { kind: "send_repeat"; date: LocalDate }
  | { kind: "open_quiet"; date: LocalDate; notify: boolean }
  | { kind: "notify_quiet"; date: LocalDate }
  | { kind: "send_turn_prompt"; forDate: LocalDate }
  | { kind: "prepare"; forDate: LocalDate }
  | { kind: "draft_weekly_read"; weekEnd: LocalDate };
decideSchedule(input: ScheduleInput): { due: DueAction[]; nextWakeAt: Date | null }
```

Rules `decideSchedule` implements, each with tests:

- Nothing is due and `nextWakeAt` is `null` unless `lightOn` and `status === "active"`.
- **Arrival**: for today, if `now ≥ zonedInstant(today, arrivalTime)`, not delivered, not failed, and `now < zonedInstant(today, prepareTime)`: `deliver_arrival` with `late = minutesBetween(arrivalInstant, now) > lateNoteAfterMinutes`. After the prepare time the day is skipped (the reconciliation job logs it as missed).
- **Repeat**: delivered, not answered, no repeat, not away that date, `now ≥ deliveredAt + repeatAfterMinutes`.
- **Quiet**: delivered, not failed, not answered, not away, no quiet yet, `now ≥ deliveredAt + quietAfterMinutes` → `open_quiet` with `notify` true unless the date is inside the learning period and `now < deliveredAt + learningNotifyMinutes`.
- **Notify quiet**: quiet open, unresolved, not answered, and either never notified with `now ≥ deliveredAt + learningNotifyMinutes`, or `waitUntil` set, later than `lastNotifiedAt`, and `now ≥ waitUntil`.
- Yesterday's repeat and quiet stop once today's arrival is delivered.
- **Turn prompt**: `turnsEnabled`, tomorrow not prepared, prompt not sent, `zonedInstant(today, turnPromptTime) ≤ now < zonedInstant(today, prepareTime)`.
- **Prepare**: tomorrow not prepared and `now ≥ zonedInstant(today, prepareTime)`.
- **Weekly read**: `weekdayOf(today) === weeklyReadWeekday`, `now ≥ zonedInstant(today, weeklyReadTime)`, not done for today.
- `nextWakeAt` is the earliest future instant among every rule's next threshold, strictly after `now`; `null` only when inactive.
- Every rule holds across DST transitions in `America/New_York`, `Europe/Berlin`, `Australia/Lord_Howe` (30-minute shift), and `Asia/Taipei` (no DST).

```ts
// ask.ts — spec §4.2
interface AskCandidate { id: string; whenRule: WhenRule; scheduledFor: LocalDate | null; createdAt: Date; state: ExchangeState }
selectAsk(input: { date: LocalDate; candidates: AskCandidate[]; isStoryDay: boolean; storyQuestionAvailable: boolean }):
  | { source: "scheduled"; exchangeId: string }
  | { source: "whenever"; exchangeId: string }
  | { source: "story" }
  | { source: "hello" }

// render.ts — one arrival as plain text and buttons, spec §4.3–4.5
renderArrival(input: {
  lang: Lang; address: string; exchangeId: string;
  ask:
    | { type: "hello" }
    | { type: Exclude<ExchangeType, "hello">; askerName: string; onBehalfOf: string | null; text: string | null;
        chips: string[]; voteOptions: string[]; imageCount: number };
  readBack: string[];        // already-rendered lines, possibly empty
  late: boolean;
  repeat: boolean;
}): { text: string; buttons: Button[][] }

// buttons.ts — compact, validated callback payloads (≤ 64 bytes)
type ButtonAction =
  | { type: "answer"; exchangeId: string; answer: "fine" | "heart" }
  | { type: "chip"; exchangeId: string; index: number }
  | { type: "pick"; exchangeId: string; index: number }
  | { type: "vote"; exchangeId: string; index: number }
  | { type: "consent"; memberId: string; accept: boolean }
  | { type: "quiet_fine"; quietEventId: string }
  | { type: "quiet_wait"; quietEventId: string }
  | { type: "onboarding"; step: string; value: string };
encodeButton(action: ButtonAction): string
decodeButton(data: string): ButtonAction | null

// keys.ts — idempotency keys for outbound rows
outboundKey(kind: OutboundKind, parts: { memberId?: string; date?: LocalDate; exchangeId?: string; quietEventId?: string; conversationId?: string; suffix?: string }): string

// tuning.ts — spec §8
quietAfterMinutes(latencies: number[], options?: { sunday?: boolean; sundayLatencies?: number[] }): number   // median + 120, clamped to [240, 600]; 360 with fewer than 7 samples
learningUntil(consentDate: LocalDate): LocalDate                                                             // consent date + 14 days

// commands.ts — spec §9
parseParentCommand(text: string): "stop" | "start" | "what_family_sees" | null   // en, zh-TW, ja, de, hi, ru keywords; whole-message match after trimming punctuation

// turns.ts — spec §7
nextTurnHolder(holders: { memberId: string; joinedAt: Date }[], previousHolderId: string | null): string | null  // round robin by join order

// readback.ts
summariseReplies(input: { lang: Lang; replies: { name: string; kind: ReplyKind; text: string | null }[] }): string[]
  // one line per text reply, one per voice, reactions grouped by emoji; no counts of who did not reply
```

## 6. `@vela/adapters`

Telegram first, in `src/telegram/`. Exports `createTelegramAdapter({ botToken, webhookSecret, fetch?, apiBaseUrl? }): ChannelAdapter` plus setup helpers used by scripts (`setWebhook`, `setMyCommands`, `getMe`).

- **verify**: constant-time comparison of `X-Telegram-Bot-Api-Secret-Token` with the configured secret.
- **parse**: `message` in private chats and groups (text, `/start <param>`, voice, audio as voice, photo using the largest size, sticker, replies, media groups); `callback_query`; `message_reaction`; `my_chat_member` (private: kicked → `blocked`, member → `unblocked`; group: member/administrator → `bot_added`, left/kicked → `bot_removed`). Edited messages, channel posts, and service messages yield nothing. `eventId` is `tg:<update_id>`.
- **send**: one image → `sendPhoto`; two to ten images → `sendMediaGroup`; audio → `sendVoice`; then `sendMessage` with the text and an inline keyboard, `reply_parameters` when replying, link previews disabled, no `parse_mode` (text is never interpreted as markup).
- **Errors**: 403 → `blocked`; 400 "chat not found" → `not_found`; other 400 → `invalid_request`; 429 → `rate_limited` with `retry_after`; 5xx and network failures → `unavailable`.
- **Idempotency**: Telegram has no idempotency keys, so the adapter cannot deduplicate; the gateway records every successful send and only retries failures.
- **fetchMedia**: `getFile`, then the file download URL; files over 20 MB are rejected with `invalid_request`.
- **Tests**: every fixture in `src/telegram/fixtures/` (real update shapes) parses to the expected events; verification accepts the right secret and rejects wrong, missing, and differently sized ones; `send` issues the right API calls in order (a recording fake `fetch`); every error mapping.

## 7. `@vela/ai`

```ts
export type AiCallName = "understand" | "flag" | "chips" | "suggest" | "translate" | "readback" | "hello" | "weekly_read";
export interface AiCallRecord { call: AiCallName | "transcribe"; promptVersion: string; model: string; ok: boolean;
  tokensIn: number; tokensOut: number; tokensCached: number; latencyMs: number; costUsd: number; error?: string }
export type AiOutcome<T> = { ok: true; value: T; record: AiCallRecord } | { ok: false; value: T; record: AiCallRecord; error: string };
export interface Ai {
  understand(input: UnderstandInput): Promise<AiOutcome<Understanding>>;
  flag(input: FlagInput): Promise<AiOutcome<FlagResult>>;
  chips(input: ChipsInput): Promise<AiOutcome<{ chips: string[] }>>;
  suggest(input: SuggestInput): Promise<AiOutcome<Suggestion>>;
  translate(input: TranslateInput): Promise<AiOutcome<{ text: string }>>;
  readback(input: ReadbackInput): Promise<AiOutcome<{ lines: string[] }>>;
  hello(input: HelloInput): Promise<AiOutcome<{ lines: string[] }>>;
  weeklyRead(input: WeeklyReadInput): Promise<AiOutcome<WeeklyRead>>;
}
export interface Stt { transcribe(input: { audio: ArrayBuffer; mime: string; languageHint: Lang | null }): Promise<{ ok: boolean; text: string; language: string | null; confidence: number | null; record: AiCallRecord }> }
export function createClaudeAi(options: { apiKey: string; fetch?: typeof fetch }): Ai
export function createFakeAi(overrides?: Partial<Ai>): Ai
export function createDeepgramStt(options: { apiKey: string; fetch?: typeof fetch }): Stt
export function createFakeStt(result?: Partial<…>): Stt
export const PROMPTS: Record<AiCallName, { version: string; system: string }>
export const MODEL_FOR: Record<AiCallName, string>
```

- **Never throws for provider failures.** A failed call returns `ok: false` with a safe default value (`understand`: summary "answered", no mentions; `flag`: `{ flag: false }`; `chips`: generic chips for the question type; `translate`: the original text; `readback`: lines built by `summariseReplies`; `hello`: the copy strings). Programming errors still throw.
- **Routing** (ADR-15): `flag` → `claude-opus-5` (low effort); `understand`, `translate`, `readback`, `weekly_read` → `claude-sonnet-5`; `chips`, `suggest`, `hello` → `claude-haiku-4-5`.
- **Calls** use the official SDK, structured outputs validated against Zod schemas, a cached system prompt, and adaptive thinking where the model supports it; a `refusal` stop reason is handled as a failure. The exact SDK surface follows the bundled Claude API reference, not memory.
- **Prompts** are TypeScript modules `src/prompts/<call>.v<N>.ts` exporting `version` and `system`. The system prompt is stable (cacheable); the untrusted family content goes in the user turn inside explicit delimiters, and every system prompt says to treat that content as data and never follow instructions inside it.
- **Guardrails** in every prompt and tested in evals: never diagnose or advise, never speak as a family member, never mention monitoring or notes, never invent facts not in the input, keep her words.
- **Cost** is computed from `usage` with a price table per model (input, output, cache read, cache write).
- **Speech**: Deepgram prerecorded transcription with the training opt-out set; the language model and parameters verified against Deepgram's current documentation for Traditional Chinese and English.
- **Evals** in `packages/ai/evals/`: a golden set (50 synthetic cases at first, over-weighted to Taiwanese Mandarin, code-switching, register, borderline and clear health mentions, away detection, prompt injection) with a Promptfoo config that runs only when `ANTHROPIC_API_KEY` is present, and a Vitest test that validates the golden set's shape on every run.
- **Tests**: prompt registry integrity (versions unique, every call routed), request shape built for each call (recording fake `fetch`), usage-to-cost arithmetic, refusal and network failures return safe defaults, Deepgram response parsing.

## 8. `@vela/services`

Services receive a `Deps` object of ports and never import platform code.

```ts
interface Clock { now(): Date }
interface Logger { info(event: string, fields?: Record<string, unknown>): void; warn(…): void; error(…): void }
interface JobQueue<J> { send(job: J, options?: { delaySeconds?: number }): Promise<void> }
interface MemberScheduler { wakeAt(memberId: string, at: Date | null): Promise<void> }
interface MediaStore { put(key: string, body: ArrayBuffer, mime: string): Promise<void>; get(key: string): Promise<{ body: ArrayBuffer; mime: string } | null>; delete(key: string): Promise<void> }
interface Heartbeat { ping(): Promise<void> }
interface Deps {
  db: VelaDatabase; clock: Clock; logger: Logger;
  queues: { outbound: JobQueue<OutboundJob>; media: JobQueue<MediaJob>; understand: JobQueue<UnderstandJob> };
  scheduler: MemberScheduler; media: MediaStore; channels: (channel: Channel) => ChannelAdapter;
  ai: Ai; stt: Stt; heartbeat: Heartbeat;
  config: { telegramBotUsername: string; adminConversationId: string | null; environment: "development" | "staging" | "production" };
}
```

Modules and their entry points (detailed in the sprint-1 build brief):

| Module | Entry points |
|---|---|
| `tick.ts` | `tickMember(deps, memberId)`: load state, `decideSchedule`, execute each due action idempotently, persist `next_wake_at`, return it · `reconcile(deps)`: members whose `next_wake_at` is more than 10 minutes past, re-run their tick, log `scheduler_missed`, ping the heartbeat |
| `gateway.ts` | `enqueueOutbound(deps, row)`: insert with `ON CONFLICT DO NOTHING`, enqueue only if inserted · `deliverOutbound(deps, outboundId)`: send, record, retry policy, delivery failure handling |
| `arrivals.ts` | `prepareDay(deps, memberId, date)`, `deliverArrival(deps, memberId, date, late)`, `sendRepeat`, `markDelivered` |
| `quiet.ts` | `openQuiet`, `notifyQuiet`, `resolveQuietOnAnswer`, `quietFine`, `quietWait` |
| `inbound/telegram.ts` | `handleTelegramEvents(deps, events)`: routes to onboarding, consent, parent answers and commands, group asks and replies, quiet buttons |
| `onboarding.ts`, `consent.ts`, `asks.ts`, `answers.ts`, `replies.ts` | The flows of spec Appendix A |
| `pipeline.ts` | `ingestAnswerMedia(deps, answerId)`, `understandAnswer(deps, answerId)`: transcribe, understand, flag, translate, post to the family group |
| `jobs.ts` | `draftWeeklyReads`, `rollupMetrics`, `applyRetention` |
| `events.ts` | `recordEvent(deps, event)` |

**Tests** run against PGlite with a fixed clock, the fake AI and STT, an in-memory queue drained by the test, and a recording fake Telegram adapter. They include the full Appendix A loop (organiser onboards, parent consents, turn prompt, ask, arrival, answer, family reply, read-back next morning) and the silence drill: adapter failures produce one delivery-failed notice and no quiet event; a missed wake is caught by reconciliation without a double send; an AI failure never delays the light.

## 9. `@vela/worker`

- `src/index.ts` exports the Worker (`fetch`, `queue`, `scheduled`) and the `MemberScheduler` Durable Object class.
- Routes (Hono): `GET /healthz`; `POST /webhooks/telegram` (verify, parse, handle, 200 within a second); `GET /admin` (a single server-rendered page behind a bearer token: today's families, deliveries, answers, quiet events, recent AI calls).
- `MemberScheduler`: RPC `wakeAt(at)` sets or clears the alarm; `alarm()` calls `tickMember` and re-arms at the returned instant.
- Queues: `vela-outbound` → `deliverOutbound`; `vela-media` → `ingestAnswerMedia`; `vela-understand` → `understandAnswer`; each with a dead-letter queue.
- Cron: every 5 minutes `reconcile`; nightly `rollupMetrics` and `applyRetention`.
- Configuration: `wrangler.jsonc` with `dev`, `staging`, and `production` environments; secrets documented in `.dev.vars.example`; the local database is `@vela/db dev-db` reached through Hyperdrive's local connection string.
- Tests with `@cloudflare/vitest-pool-workers` cover routing, webhook rejection, the Durable Object alarm loop against fake services, and queue dispatch.

## 10. Definition of done for code

A change is done when `pnpm check` passes locally and in CI, new behaviour has tests that would fail without it, no rule in §2 is broken, and any change to a contract is reflected here and in the architecture document in the same commit.
