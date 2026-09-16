# Code design

2026-09-17. How the code is organised, the rules every package follows, and the public API of each package. It turns `02-technical-architecture-v2.md` into buildable units and is the contract parallel work is built against. When code and this document disagree, fix one of them in the same change.

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
worker ── wires Cloudflare bindings into services' ports; owns HTTP, the Durable Object, queues, cron;
           deployed as two Workers: the pilot Worker `vela` and the admin Worker `vela-admin` (§9, ADR-26)
```

| Package | Owns | Must not |
|---|---|---|
| `@vela/contracts` | Domain tuples and schemas, the channel adapter contract, event names | Contain logic beyond validation |
| `@vela/copy` | Every user-facing messenger string in `en` and `zh-TW`, and `t()` | Know about channels, the database, or time |
| `@vela/core` | Pure functions: local time, the exchange state machine, the daily schedule decision, ask selection, arrival and weekly read rendering, button codec, idempotency keys, tuning, parent commands, turns | Perform I/O, read the clock, generate ids, or import Node or Workers APIs |
| `@vela/db` | The Drizzle schema (source of truth for the data model), migrations, database clients, the PGlite test helper | Contain business queries (those live in services) |
| `@vela/adapters` | One folder per channel implementing `ChannelAdapter`; recorded fixtures | Touch the database, AI, or scheduler |
| `@vela/ai` | Claude calls with versioned prompts and structured outputs, speech-to-text, cost accounting, fakes | Persist anything, read the clock for business decisions |
| `@vela/services` | Application services: scheduling ticks, the outbound gateway, inbound flows, the AI pipeline, jobs | Import Cloudflare APIs; everything platform-specific arrives through ports |
| `@vela/worker` | Hono routes, the `MemberScheduler` Durable Object, queue consumers, cron, bindings, the privacy notice pages; the two Workers' configurations | Contain business logic |

Dependency direction is enforced by `package.json` dependencies: a package can only import what it declares.

## 2. Rules for all code

**TypeScript.** TypeScript 7, `strict`, `noUncheckedIndexedAccess`, no `any` (use `unknown` and narrow), no non-null assertions, `import type` for types, relative imports with the `.ts` extension, named exports only (default exports only where a platform requires them: the two Workers' entry modules and config files). Exported functions declare their return types.

**Runtime neutrality.** Runtime code in `contracts`, `copy`, `core`, `adapters`, `ai`, and `services` uses only web-standard APIs available in both Cloudflare Workers and Node 24 (`fetch`, `Request`, `Response`, `Headers`, `URL`, `crypto.subtle`, `TextEncoder`, `Intl`). Biome rejects `node:` imports outside tests, test helpers, configs, and scripts.

**Time.** Core never reads the clock; it receives `now: Date`. Services read time only through the `Clock` port. All instants are `Date` in UTC; local calendar values are `LocalDate` (`YYYY-MM-DD`) and `LocalTime` (`HH:MM`) strings interpreted in an IANA zone.

**Ids.** Row ids come from the database (`uuidv7()` defaults, Postgres 18). Code does not invent ids.

**Errors.** Expected domain failures are values or typed errors (`IllegalTransitionError`, `ChannelSendError`, `VelaError` with a `code`). Unexpected failures throw and are logged by the worker. Never swallow an error without logging it.

**Logging.** Services log through the `Logger` port with an event name and flat fields; never log message content, transcripts, phone numbers, or tokens. A caught error is logged as `errorLabel(error)` (§8), never as its message or `String(error)`: a failed query's message lists its parameters, which hold what the family wrote, and a platform's description can repeat what was sent.

**Tests.** Vitest, colocated as `*.test.ts`. Deterministic: fixed clocks, fake adapters, fake AI, PGlite for the database. Each package's `pnpm test` runs in under a minute, except the PGlite-backed suites of `@vela/db` and `@vela/services`, which run with bounded workers and take longer: each test file boots its own PGlite (Postgres compiled to WebAssembly), and each instance reserves a large memory block up front, so `@vela/db` runs its files one at a time (`fileParallelism: false`) and `@vela/services` uses one worker (`maxWorkers: 1`), which keeps the peak at one instance per suite. The root `pnpm test` runs `turbo run test --concurrency=3`, so at most three package suites run at once; do not start a second PGlite-backed suite by hand while one is running. Test names state behaviour ("sends no quiet notice when delivery failed").

**Style.** Biome formats and lints; `pnpm check` must pass before every commit. Comments explain why, not what. No dead code, no commented-out code, no TODO without a linked task.

## 3. `@vela/db`

**Schema source of truth.** `src/schema.ts` defines every table with Drizzle. `architecture/schema.sql` is generated from it by `pnpm --filter @vela/db export-sql` and is never edited by hand. CHECK constraints for enumerated columns are generated from the tuples in `@vela/contracts`, so a value added to a tuple reaches the database through a migration. No database has been migrated yet, so until one is, a schema change regenerates the initial migration (delete `packages/db/migrations`, then run `drizzle-kit generate --name init` through `pnpm --filter @vela/db generate --name init`) instead of adding `0001`, and `architecture/schema.sql` is regenerated in the same change.

**Changes from the reference schema** (`architecture/schema.sql` as first drafted):

1. Primary keys default to Postgres 18's native `uuidv7()`; no custom function.
2. `members.next_arrival_at` becomes `members.next_wake_at` (the reconciliation index).
3. `events` is a plain table with a `bigint` identity key and indexes on `(name, at)` and `(family_id, at)`. Partitioning waits until volume justifies it.
4. `exchanges_one_per_day` becomes `UNIQUE (recipient_id, scheduled_for) WHERE scheduled_for IS NOT NULL AND state <> 'withdrawn'`, so two asks cannot claim the same morning even before scheduling.
5. `exchanges.delivery_failed_at timestamptz`.
6. `families.language` (the family group's language, default `en`).
7. New `family_channels (id, family_id, channel, conversation_id, kind CHECK in ('private','group'), linked_by_member_id NULL, linked_at, unlinked_at)` with a unique index `family_channels_channel_conversation_id_idx` on `(channel, conversation_id) WHERE unlinked_at IS NULL`: the family's group chat on a messenger, re-linkable while history rows stay. Nothing in the schema limits a family to one linked group; services refuse a second.
8. New `message_refs (channel, conversation_id, message_id, family_id, exchange_id NULL, quiet_event_id NULL, purpose, created_at, PRIMARY KEY (channel, conversation_id, message_id))` with `purpose` in `arrival, repeat, turn_prompt, answer_post, quiet_notice, consent, ask_confirmation`: maps a platform message to what it was about, so replies and button taps resolve.
9. New `onboarding_sessions (channel, conversation_id, external_user_id, step, data jsonb, created_at, updated_at, expires_at, PRIMARY KEY (channel, conversation_id))`.
10. `replies.channel`, `replies.external_id` with a unique index on `(channel, external_id) WHERE external_id IS NOT NULL`; reactions unique on `(exchange_id, member_id, kind) WHERE kind IN ('heart','laugh','hug')`. On Telegram, `answers.external_id` and `replies.external_id` are `<conversation_id>:<message_id>`, because Telegram message ids are unique only within one chat.
11. `quiet_events.last_notified_at`, `quiet_events.notify_count integer NOT NULL DEFAULT 0`, `quiet_events.notified_member_ids uuid[] NOT NULL DEFAULT '{}'`.
12. `outbound.exchange_id uuid NULL` (FK, on delete set null) and `outbound.conversation_id text NOT NULL`; the `kind` CHECK and the budget index use `OUTBOUND_KINDS` and `BUDGETED_OUTBOUND_KINDS`.
13. `turns.prompt_message_id text`; `turns.holder_id` nullable (`ON DELETE SET NULL`), because a prompt open to anyone has no holder.
14. `metrics_daily.family_id` and `member_id` are `NOT NULL`.
15. `members.light_starts_on date` (the first local date arrivals may be delivered).
16. `message_refs.member_id uuid NULL` (`ON DELETE CASCADE`) and `message_refs.local_date date NULL` (the recipient and date a turn prompt is about).
17. `media`: `storage_key`, `mime`, and `bytes` nullable (a received file is known by its provider id before download, and Telegram photos carry no MIME type); `channel`, `provider_file_id`, `provider_unique_id`; `CHECK media_storage_key_or_provider_file_id_check` (a row needs a storage key or a provider file id); `CHECK media_provider_unique_id_channel_check` (a provider unique id needs the channel that issued it); a unique index `media_family_id_channel_provider_unique_id_idx` on `(family_id, channel, provider_unique_id) WHERE provider_unique_id IS NOT NULL`, so a file forwarded again inside one family reuses its row and another family records its own.
18. Channel columns carry CHECKs from `CHANNELS`, `events.name` from `EVENT_NAMES`; media references use `ON DELETE SET NULL`. `exchanges.media_ids` and `exchanges.options` hold media ids without a foreign key; retention removes a deleted id from both.
19. Member references say what a row means once the member is deleted (30 days after leaving). `ON DELETE SET NULL` where the row only credits the member with an act: `exchanges.asker_id`, `media.uploaded_by`, `quiet_events.resolved_by`, `away_periods.set_by`, `stories.asked_by`, `turns.holder_id`, `invites.accepted_by`, and the new `family_channels.linked_by_member_id`. `ON DELETE CASCADE` where the row exists only because of the member: `invites.invited_by`, `invites.for_member_id`, `outbound.actor_id` (a `nearby_ask` whose actor was set null would break the actor CHECK). A null `asker_id` means Vela only when the exchange type is `hello`.
20. `answers.processing_attempts smallint NOT NULL DEFAULT 0`: services increment it when media ingestion or understanding starts, so `reconcile` can re-run an answer that was never understood and stop after the third attempt (§8).
21. `weekly_reads.sent_lines jsonb NULL`, `weekly_reads.sent_suggestion text NULL`, and `weekly_reads.sent_at timestamptz NULL`, with `CHECK weekly_reads_sent_lines_sent_suggestion_sent_at_check` (all three null or all three set): the lines and the suggestion as the founder sent them (`sent_suggestion` is `''` when the founder removed it). `weekly_reads.lines` and `sent_lines` hold one string per line (`string[]`, the `ai.weeklyRead` output shape, zero to four lines); `lines` and `suggestion` stay as the model wrote them, so prompt versions can be compared. `weekly_reads.stats` is `{answered_days, counted_days, hello_mornings, family_asks, usual_time, drift_min, topics[], voice_len_drift}`; the first four are the counts `renderWeeklyRead` writes for organisers (§5), never the model.
22. `admin_access_log.member_id uuid NULL` with no foreign key (the log outlives members) and `admin_access_log.action text NOT NULL` with `CHECK admin_access_log_action_check` from `ADMIN_ACTIONS`; `what` names the page or a detail of the action and never holds message content.

Everything else in the reference schema stays, including tables later sprints use.

**Exports.**

```ts
// @vela/db
export * from "./schema.ts";                    // tables and relations
export type VelaDatabase;                        // PgDatabase<…, typeof schema>, accepted by services
export type VelaTransaction;                     // the transaction type passed to db.transaction callbacks
export function connectDatabase(connectionString: string): Promise<{ db: VelaDatabase; close(): Promise<void> }>;  // node-postgres; used by both Workers through Hyperdrive and by scripts
// @vela/db/testing
export function createTestDatabase(): Promise<{ db: VelaDatabase; reset(): Promise<void>; close(): Promise<void> }>;  // in-memory PGlite with migrations applied
```

Row types are `typeof table.$inferSelect` and `$inferInsert`, re-exported with friendly names (`Member`, `NewMember`, …).

**Scripts.** `generate` (Drizzle Kit), `export-sql` (writes `architecture/schema.sql`), `migrate` (applies migrations to `DATABASE_URL`), `dev-db` (a persistent PGlite in `.pglite/` served over the Postgres wire protocol on port 54320 for `wrangler dev`).

**Tests.** Migrations apply cleanly to PGlite; every primary key defaults to `uuidv7()` and is named `<table>_pkey`; each invariant is proven by a failing insert: one exchange per recipient per date, the budget index per kind, the `nearby_ask` actor check, answer and reply webhook dedup (and the same Telegram message id in two chats kept apart), one quiet event per exchange, media dedup per family and channel, one linked row per conversation, a weekly read's sent lines, suggestion, and time written together, an admin log entry without its action, and CHECK constraints rejecting unknown enum values (with a test that every CHECK in the database is covered). Deleting a member who left keeps the family's rows and drops the rows that existed only for them; deleting a media row sets every foreign key to it null.

## 4. `@vela/copy`

```ts
export type MessageKey = keyof typeof en;
export function t(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string;
export const catalogs: Record<"en" | "zh-TW", Record<MessageKey, string>>;
```

Placeholders are `{name}`. Languages without a catalog fall back to English. Tests assert every key exists in every catalog, every placeholder in English exists in each translation and no extra ones do, `t()` throws on a missing parameter, and no string uses a gendered pronoun for the kept-light member (the product never assumes gender; use the name). They also pin the parameters services pass for the keys changed on 2026-09-14, keep every `admin.*` key to the parameters `family`, `link`, and `name` (the admin conversation never carries what the family wrote, ADR-21), set `{link}` and `{notice}` apart with whitespace in every language, and hold the Traditional Chinese spacing rules (Latin text, digits, and Latin placeholders are spaced from Chinese characters; name placeholders are not). They hold each language to the weekly read's name in its privacy notice ("weekly read" in English, 每週小記 in Traditional Chinese) and require the nearby step to tell the organiser to ask the contact themselves, never to say that Vela asks. Each weekly read count has a plural key and a `_one` key: in English the plural key uses the plural noun, the `_one` key the singular ("1 of 1 day", "on 1 morning"), and nothing else differs; in Traditional Chinese, which has one form, the `_one` key repeats the plural key. Traditional Chinese strings carry a file-level note that they await native review.

Services supply values the catalog does not format: `{link}` in `admin.*` keys is `Config.publicBaseUrl` followed by an `/admin/...` path (§9); `{notice}` in `group.linked` is `Config.privacyNoticeUrls[family language]`; `{date}` in `away.confirmed` is "Sunday 21 September" in English and "9月21日（星期日）" in Traditional Chinese, where it takes no spaces around it; `{contacts}` in `quiet.nearby` lists only contacts with `consented_at` set and `declined_at` null, and the line is left out when there are none. `weekly_read.*` keys are rendered only by `renderWeeklyRead` in `@vela/core` (§5), which supplies their values from `weekly_reads.stats`, her name as the family calls her, and the sent suggestion; only organisers receive them, never the kept-light member (spec §8, §13).

Keys, in catalog order (English text is the source; wording follows spec §20: names, no "monitor/check/track", say what happens next):

| Key | English |
|---|---|
| `arrival.greeting` | Good morning, {address}. |
| `arrival.late` | Sorry this is late. |
| `arrival.repeat` | In case you missed it: |
| `arrival.readback_heading` | From yesterday: |
| `arrival.asks` | {asker} asks: |
| `arrival.asks_on_behalf` | {asker} asks, for {child}: |
| `arrival.sent_photo` | {asker} sent you a photo. |
| `arrival.sent_voice` | {asker} sent you a voice message. |
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
| `readback.photo` | {name} sent a photo. |
| `readback.reactions` | {names} sent {emoji} |
| `consent.invalid_link` | This link is no longer valid. Please ask the person who sent it for a new one. |
| `consent.already_linked` | This Telegram account is already connected to another family on Vela. |
| `consent.request` | {organiser} would like to keep a light on for you. Every morning someone in the family will ask you something, and when you answer, they will know you are fine. If a morning goes unanswered, {organiser} will get a quiet note so they can call. You can say stop at any time. |
| `consent.yes` | Yes, that's fine |
| `consent.no` | No, thank you |
| `consent.accepted` | Thank you. Your first morning arrives tomorrow at {time}. |
| `consent.declined` | That's fine. Nothing will arrive. |
| `organiser.consent_given` | {name} said yes. The first morning arrives tomorrow at {time}. |
| `organiser.consent_declined` | {name} said no for now. Nothing will be sent. |
| `parent.stopped` | Everything is paused. Say start whenever you would like it back. |
| `parent.started` | Welcome back. Your next morning arrives at {time}. |
| `organiser.stopped` | {name} asked to pause. Nothing is wrong with the app. |
| `parent.family_sees_heading` | What the family saw from your latest answers: |
| `parent.family_sees_empty` | Nothing yet. When you answer a morning message, the family will see it. |
| `parent.family_sees_weekly_read` | From the latest weekly read sent to the family: |
| `group.linked` | Hello, family. I'm Vela. Each evening I will say whose turn it is to ask {name} something for the morning. How Vela handles your messages: {notice} |
| `group.not_linked` | Only the family organiser can connect Vela to a group. |
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
| `quiet.notice_no_usual` | It's been quiet at {name}'s today. The morning message went out at {sent}. Nothing worrying is known. |
| `quiet.nearby` | Nearby: {contacts} |
| `quiet.fine_button` | {name} is fine, I know why |
| `quiet.wait_button` | Wait 2 hours |
| `quiet.waiting` | I'll look again at {time}. |
| `quiet.resolved_answered` | {name} answered at {time}. Everything is lit again. |
| `quiet.resolved_fine` | {organiser} says {name} is fine. |
| `delivery.failed` | We couldn't reach {name} on {channel} today. Nothing else is known. |
| `flag.notice` | {name} said something you may want to hear: "{quote}" |
| `away.confirmed` | Until {date}, then. Have a lovely time. |
| `away.confirmed_open` | Understood. Have a lovely time. |
| `weekly_read.answered` | {name} answered {answered} of {days} days. |
| `weekly_read.answered_one` | {name} answered {answered} of {days} day. |
| `weekly_read.hello_mornings` | On {mornings} mornings nobody in the family asked, so Vela sent {name} a hello. |
| `weekly_read.hello_mornings_one` | On {mornings} morning nobody in the family asked, so Vela sent {name} a hello. |
| `weekly_read.nobody_asked` | Nobody in the family asked {name} anything this week. |
| `weekly_read.suggestion` | Something to ask next week: {suggestion} |
| `help.private` | Hello. To set up Vela for your family, send /start. |
| `onboarding.welcome` | Hello, I'm Vela. Let's set up a light for someone in your family. It takes two minutes. |
| `onboarding.ask_name` | What do you call them? For example: Mom, Grandma, Dad. |
| `onboarding.ask_address` | How should I greet them each morning? For example: Mrs Chen, Mom. |
| `onboarding.ask_language` | Which language should their messages be in? |
| `onboarding.ask_country` | Which country do they live in? |
| `onboarding.country_tw` | Taiwan |
| `onboarding.country_us` | United States |
| `onboarding.country_gb` | United Kingdom |
| `onboarding.country_ca` | Canada |
| `onboarding.country_au` | Australia |
| `onboarding.country_sg` | Singapore |
| `onboarding.country_jp` | Japan |
| `onboarding.country_de` | Germany |
| `onboarding.country_in` | India |
| `onboarding.country_other` | Other |
| `onboarding.ask_zone` | Which time zone? |
| `onboarding.ask_zone_other` | Which time zone do they live in? Type its name, like Asia/Seoul or Europe/Paris. |
| `onboarding.invalid_zone` | Please send a time zone name like Asia/Seoul or Europe/Paris. |
| `onboarding.ask_wake` | When do they usually wake up? Tap one or type a time like 07:30. |
| `onboarding.ask_nearby` | Who lives nearby and could look in if needed? Send a name and phone number, or tap Skip. Please ask them yourself first: their number appears in a note only after they say yes. |
| `onboarding.skip` | Skip |
| `onboarding.invalid_time` | Please send a time like 07:30. |
| `onboarding.done` | All set. Send this link to {name}: {link} Then start a new group for the family, without {name}, and add me to it, so the family can take turns asking. |
| `admin.weekly_read_draft` | Weekly read draft for {family} is ready: {link} |
| `admin.flag` | Flag in {family}. Open: {link} |
| `admin.understand_failed` | Could not read an answer in {family} after three tries. Open: {link} |
| `admin.member_left_group` | {name} left the family group in {family}. Nothing changed for them. |

There is no `answer.unattached` key: an answer with no delivered exchange to attach to is posted to the group with `group.answer_text` or the voice (§10, "Unattached answer").

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
isValidTimeZone(timeZone: string): boolean          // returns isIanaTimeZone(timeZone) from @vela/contracts (§10, Time zones)
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
    quietAfterMinutes: number;
    startsOn: LocalDate | null;        // the first local date an arrival may be delivered (members.light_starts_on)
    learningUntil: LocalDate | null;
  };
  family: { turnsEnabled: boolean };
  /** The exchange days that can still need action: yesterday's and today's local dates. */
  days: DayState[];
  tomorrow: { prepared: boolean; turnPromptSent: boolean; askScheduled: boolean };  // askScheduled: an exchange is already scheduled_for tomorrow
  awayOn: (date: LocalDate) => boolean;
  weeklyReadDoneFor: (weekEnd: LocalDate) => boolean;
}
interface DayState {
  date: LocalDate;
  prepared: boolean;
  deliveredAt: Date | null;
  deliveryFailed: boolean;
  answeredAt: Date | null;             // the earlier of the exchange's answered_at and her first answer received on this local date, so an answer before the arrival counts (spec §19, flows §3.9)
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
- **Arrival**: for today, if today is on or after `startsOn`, `now ≥ zonedInstant(today, arrivalTime)`, not delivered, not failed, and `now < zonedInstant(today, prepareTime)`: `deliver_arrival` with `late = minutesBetween(arrivalInstant, now) > lateNoteAfterMinutes`. After the prepare time the day is skipped (the reconciliation job logs it as missed). Before `startsOn` no arrival is due, and the arrival wake is the one on `startsOn`.
- **Repeat**: delivered, not answered, no repeat, not away that date, on or after `startsOn`, `now ≥ deliveredAt + repeatAfterMinutes`.
- **Quiet**: delivered, not failed, not answered, not away, on or after `startsOn`, no quiet yet, `now ≥ deliveredAt + quietAfterMinutes` → `open_quiet` with `notify` true unless the date is inside the learning period and `now < deliveredAt + learningNotifyMinutes`.
- **Notify quiet**: quiet open, unresolved, not answered, and either never notified with `now ≥ deliveredAt + learningNotifyMinutes`, or `waitUntil` set, later than `lastNotifiedAt`, and `now ≥ waitUntil`.
- Yesterday's repeat and quiet stop once today's arrival is delivered, and are not emitted when today's arrival is delivered in the same decision (her morning and yesterday's "in case you missed it" would otherwise arrive together).
- **Turn prompt**: `turnsEnabled`, tomorrow not prepared, prompt not sent, no ask already scheduled for tomorrow (`askScheduled`), `zonedInstant(today, turnPromptTime) ≤ now < zonedInstant(today, prepareTime)`.
- **Prepare**: tomorrow not prepared and `now ≥ zonedInstant(today, prepareTime)`.
- **Weekly read**: `weekdayOf(today) === weeklyReadWeekday`, today (the week's last day) on or after `startsOn`, `now ≥ zonedInstant(today, weeklyReadTime)`, not done for today.
- `nextWakeAt` is the earliest future instant among every rule's next threshold, strictly after `now`; `null` only when inactive.
- Every rule holds across DST transitions in `America/New_York`, `Europe/Berlin`, `Australia/Lord_Howe` (30-minute shift), and `Asia/Taipei` (no DST).

Known limitations, accepted for the pilot: a `startsOn` more than a day ahead still prepares and prompts the dates before it (consent always sets tomorrow, so no pilot flow produces one); an on-behalf voice note or photo ask without words renders "sent you a voice message" or "sent you a photo" without the child's name (no pilot flow sets `onBehalfOf`).

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
  // text stays within OutboundMessage's 4000 characters: read-back lines are shortened first (to 100
  // characters each), then the ask text (to 1000), then the read-back lines again; the greeting, who
  // asks, and the hint are never shortened, and no line is dropped

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
  // the parts and suffix each kind takes are OUTBOUND_KEY_SHAPES; weekly_read is the kept-light member, the
  // week's last date, and the reader's conversation; answer_post and flag carry the answer id in the suffix

// tuning.ts — spec §8
quietAfterMinutes(latencies: number[], options?: { sunday?: boolean; sundayLatencies?: number[] }): number   // median + 120, clamped to [240, 600]; 360 with fewer than 14 answered days (spec §8)
learningUntil(consentDate: LocalDate): LocalDate                                                             // consent date + 14 days

// commands.ts — spec §9
parseParentCommand(text: string): "stop" | "start" | "what_family_sees" | null   // PARENT_COMMAND_KEYWORDS in en, zh-TW, ja, de, hi, ru; whole-message match after NFKC, trimming punctuation, and lower-casing
  // zh-TW what_family_sees: 家人看到什麼 and 家人看得到什麼, each with its 甚麼 and simplified forms

// turns.ts — spec §7
nextTurnHolder(holders: { memberId: string; joinedAt: Date }[], previousHolderId: string | null, previousJoinedAt?: Date | null): string | null  // round robin by join order; previousJoinedAt keeps the order when the previous holder has left

// readback.ts
summariseReplies(input: { lang: Lang; replies: { name: string; kind: ReplyKind; text: string | null }[] }): string[]
  // one line per text reply, one per voice, reactions grouped by emoji; no counts of who did not reply

// weekly-read.ts — spec §8, §13
type WeeklyReadAudience = "organiser" | "kept_light_member";
interface WeeklyReadStats { countedDays: number; answeredDays: number; helloMornings: number; familyAsks: number }
  // weekly_reads.stats counted_days, answered_days, hello_mornings, family_asks; countedDays is 7, or in a first week the days on or after light_starts_on
renderWeeklyRead(input: {
  lang: Lang; name: string;            // the reader's language; her name as the reader calls her
  stats: WeeklyReadStats;
  lines: readonly string[];            // the lines as sent, in the reader's language; possibly none
  suggestion: string;                  // the suggestion as sent; '' when there is none
  audience: WeeklyReadAudience;
}): string | null
  // organiser: the counts (weekly_read.answered or _one; then weekly_read.nobody_asked when familyAsks is 0,
  // else weekly_read.hello_mornings or _one when helloMornings > 0), then the non-blank lines, then
  // weekly_read.suggestion (left out when the trimmed suggestion is empty), each part present separated from
  // the next by one blank line; throws RangeError for stats out of range (integers; countedDays 1 to 7;
  // answeredDays and helloMornings 0 to countedDays; familyAsks ≥ 0)
  // kept_light_member: only the non-blank lines, one per line; null when there are none; the stats are
  // neither checked nor shown, and the suggestion never
  // both stay within OutboundMessage's 4000 characters: the lines and the suggestion are shortened, longest
  // first; the counts never are, and nothing is dropped
```

## 6. `@vela/adapters`

Telegram first, in `src/telegram/`. Exports `createTelegramAdapter({ botToken, webhookSecret, botUsername, fetch?, apiBaseUrl?, now? }): ChannelAdapter` plus setup helpers used by scripts (`setWebhook`, `setMyCommands`, `getMe`, and the `TELEGRAM_ALLOWED_UPDATES` tuple, all from the package root). `createTelegramAdapter` throws on a malformed bot token, a webhook secret that is not 1 to 256 characters of `A–Z a–z 0–9 _ -`, or a `botUsername` that is not 1 to 32 characters of `A–Z a–z 0–9 _` (no `@`: a username given as `@VelaLightBot` would silently drop every addressed command).

- **verify**: constant-time comparison of `X-Telegram-Bot-Api-Secret-Token` with the configured secret.
- **parse**: `message` in private chats and groups (text, `/start <param>`, voice, audio as voice, photo using the largest size, sticker, replies, media groups); `callback_query`; `message_reaction`; `my_chat_member` (private: kicked → `blocked`, member → `unblocked`; group: a move into the chat → `bot_added`, out of it → `bot_removed`, so a promotion yields nothing). Voice, audio, the chosen photo size, and each album photo carry `providerUniqueId` from `file_unique_id`. Content without a richer kind (video, video note, animation, document, location, venue, contact, poll, dice, story, checklist, paid media) yields one `other` event with the caption as text. Service messages: a basic group's upgrade to a supergroup (`migrate_to_chat_id` in the old chat, `migrate_from_chat_id` in the new one) yields `migrated` with the old id as the conversation and the new id as `migratedToConversationId`, possibly twice for one move; `left_chat_member` in a group yields `member_left` with `subject` the person who left and `sender` whoever acted (checked before the sender filter, so a removal by an anonymous admin or a moderation bot is reported), except the bot's own departure, which yields nothing (`my_chat_member` reports it). Other service messages (members joining, pins, title changes), edited messages, channel posts, messages from bots, messages sent on behalf of a chat (`sender_chat`, `is_automatic_forward`), and commands addressed to another bot, in text or caption, yield nothing. A command addressed to this bot keeps its raw text, `@mention` included; services strip it. `eventId` is `tg:<update_id>`.
- **send**: one image → `sendPhoto`; two to ten images → `sendMediaGroup`; audio → `sendVoice`; then `sendMessage` with the text and an inline keyboard, `reply_parameters` when replying, link previews disabled, no `parse_mode` (text is never interpreted as markup).
- **Errors**: 403 → `blocked`; 400 "chat not found" → `not_found`; other 400 → `invalid_request`, and a 400 carrying `parameters.migrate_to_chat_id` (the group was upgraded to a supergroup) also sets `ChannelSendError.migratedToConversationId`; 429 → `rate_limited` with `retry_after`; 5xx and network failures → `unavailable`. Error text never contains the bot token.
- **setup**: `TELEGRAM_ALLOWED_UPDATES` is `message`, `callback_query`, `message_reaction`, `my_chat_member`, the default for `setWebhook`, which also refuses a secret outside Telegram's `secret_token` alphabet. `left_chat_member` arrives inside `message` even in privacy mode, so there is no `chat_member` subscription (it would need the bot to be an administrator).
- **Idempotency**: Telegram has no idempotency keys, so the adapter cannot deduplicate; the gateway records every successful send and only retries failures.
- **fetchMedia**: `getFile`, then the file download URL; files over 20 MB are rejected with `invalid_request`.
- **Tests**: every fixture in `src/telegram/fixtures/` (real update shapes, including departures by the person, by removal, of this bot and of another bot, both halves of a group upgrade, and the 400 for an upgraded group) parses to the expected events; verification accepts the right secret and rejects wrong, missing, and differently sized ones; `send` issues the right API calls in order (a recording fake `fetch`); every error mapping, including `migratedToConversationId`.

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
export function createFakeAi(overrides?: Partial<Ai>): FakeAi        // an Ai that also lists its calls
export function createDeepgramStt(options: { apiKey: string; fetch?: typeof fetch }): Stt
export function createFakeStt(result?: Partial<…>): Stt
export const PROMPTS: Record<AiCallName, { version: string; system: string }>
export const MODEL_FOR: Record<AiCallName, string>
export const INPUT_TEXT_LIMITS = { name: 80, familyText: 4000, shortText: 300 }
export const AWAY_HORIZON_DAYS = 90
// Understanding.away: { from: LocalDate; until: LocalDate | null } | null
```

- **Never throws for provider failures.** A failed call returns `ok: false` with a safe default value (`understand`: summary "answered", no mentions; `flag`: `{ flag: false }`; `chips`: generic chips in her language; `translate`: the original text; `readback` and `hello`: `{ lines: [] }`, and services fall back to deterministic copy and `summariseReplies`; `weekly_read`: no lines and a generic suggestion in the reader's language that states nothing about her week). `@vela/ai` does not depend on `@vela/copy` or `@vela/core`. Programming errors still throw.
- **Routing** (ADR-15): `flag` → `claude-opus-5` (low effort); `understand`, `translate`, `readback`, `weekly_read` → `claude-sonnet-5`; `chips`, `suggest`, `hello` → `claude-haiku-4-5`.
- **Calls** use the official SDK, structured outputs validated against Zod schemas, a cached system prompt, and adaptive thinking where the model supports it; a `refusal` stop reason is handled as a failure. The exact SDK surface follows the bundled Claude API reference, not memory. `createClaudeAi` pins the base URL (`https://api.anthropic.com`), the credential (`authToken: null`), the log level (`warn`, so request bodies carrying family words are never logged), 2 retries, and a timeout per call (`TIMEOUT_MS_FOR`), so environment variables cannot redirect requests, add a credential, or turn on debug logging; `ANTHROPIC_CUSTOM_HEADERS` can still add headers to requests for the pinned host.
- **Inputs** are parsed with each call's input schema before any request, by the fake as by the real client. Text longer than `INPUT_TEXT_LIMITS` (names 80, family text 4000, short text 300 UTF-16 code units, never splitting a surrogate pair) is shortened rather than rejected, because it comes from people; any other invalid input throws.
- **Away**: `Understanding.away` is `{ from, until }`. `from` is the first date away and is never before the answer's date (an earlier start becomes that date); an away that ends before it starts, or starts or ends more than `AWAY_HORIZON_DAYS` after the answer, is dropped. `until` null is "until I'm back", which ends only on an answer on or after `from`. Services insert `away_periods.from_date = away.from`.
- **Prompts** are TypeScript modules `src/prompts/<call>.v<N>.ts` exporting `version` and `system`. Current versions: `chips.v1`, `flag.v1`, `hello.v2`, `readback.v1`, `suggest.v1`, `translate.v1`, `understand.v3`, `weekly_read.v4` (zero to four lines about her week and one suggestion, never a count: the counts are rendered from numbers by `renderWeeklyRead`, §5). The system prompt is stable (cacheable); the untrusted family content goes in the user turn inside explicit delimiters, and every system prompt says to treat that content as data and never follow instructions inside it.
- **Guardrails** in every prompt and tested in evals: never diagnose or advise, never speak as a family member, never mention monitoring or notes, never invent facts not in the input, keep her words.
- **Weekly read** (spec §8, §13): `WeeklyReadInput` carries only the days she answered (`days`, zero to seven, each with a non-null `answeredAt`), her usual answer time, the answer-time and voice-length drifts, and repeated mentions; it has no count of days answered, mornings nobody asked, or the family's asks, so the model can neither misstate them nor show them to her. `WeeklyRead` is `lines` (zero to four, each 1 to 300 characters) and `suggestion` (1 to 200 characters). The lines never state or imply how many days she answered or did not, a morning nobody asked, or how many asks the family sent.
- **Cost** is computed from `usage` with a price table per model (input, output, cache read, cache write).
- **Speech**: Deepgram prerecorded transcription (`nova-3`) with the training opt-out set; the language model and parameters verified against Deepgram's current documentation for Traditional Chinese and English. Each request times out after 60 seconds (`STT_TIMEOUT_MS`) and resolves as a failure. Below confidence 0.5 in her language the audio is transcribed again with detection, and the detected transcript replaces hers only when it is in another base language with higher confidence, so a `zh` detection (Simplified) never replaces a `zh-TW` transcript.
- **Evals** in `packages/ai/evals/`: a golden set (50 synthetic cases at first, over-weighted to Taiwanese Mandarin, code-switching, register, borderline and clear health mentions, away detection, prompt injection) with a Promptfoo config that runs only when `ANTHROPIC_API_KEY` is present, and a Vitest test that validates the golden set's shape on every run. `CALL_CHECKS` in `evals/suite.ts` adds checks every case of a call runs after its own: each `weekly_read` case, in English and Traditional Chinese, fails on lines that tally days or mornings, point to a day without an answer, say that nobody asked, or count the family's asks (`notMatches` checks).
- **Tests**: prompt registry integrity (versions unique, every call routed), request shape built for each call (recording fake `fetch`), usage-to-cost arithmetic, refusal and network failures return safe defaults, Deepgram response parsing.

## 8. `@vela/services`

Services receive a `Deps` object of ports and never import platform code.

```ts
interface Clock { now(): Date }
interface Logger { info(event: string, fields?: Record<string, unknown>): void; warn(…): void; error(…): void }
interface JobQueue<J> { send(job: J, options?: { delaySeconds?: number }): Promise<void> }
interface MemberScheduler { wakeAt(memberId: string, at: Date | null): Promise<void> }   // null deletes the alarm and everything the object stores
interface MediaStore { put(key: string, body: ArrayBuffer, mime: string): Promise<void>; get(key: string): Promise<{ body: ArrayBuffer; mime: string } | null>; delete(key: string): Promise<void> }
interface Heartbeat { ping(): Promise<void> }
interface ChannelRegistry { get(channel: Channel): ChannelAdapter }
interface Random { token(bytes?: number): string }                 // base64url; invite tokens
interface Deps {
  db: VelaDatabase; clock: Clock; logger: Logger; random: Random;
  queues: { outbound: JobQueue<OutboundJob>; media: JobQueue<MediaJob>; understand: JobQueue<UnderstandJob> };   // job types in flows §5
  scheduler: MemberScheduler; media: MediaStore; channels: ChannelRegistry;
  ai: Ai; stt: Stt; heartbeat: Heartbeat;
  config: Config;
}
interface Config {
  telegramBotUsername: string;
  adminConversationId: string | null;
  environment: "development" | "staging" | "production";
  /** The regions whose database exists in this environment; the pilot has apac only. */
  regions: readonly Region[];
  /** The admin Worker's origin (§9, ADR-26); admin links are publicBaseUrl + "/admin/...". */
  publicBaseUrl: string;
  /** The privacy notice URL per language; a language without its own notice carries the English URL. */
  privacyNoticeUrls: Record<Lang, string>;
}
```

A new family's region is the country's preferred region (TW, JP, SG, AU, IN → `apac`; US, CA → `us`; GB, DE, and other European countries → `eu`) when `Config.regions` contains it, and `apac` otherwise, so every pilot family is `apac`.

Modules and their entry points. `04-instrument-flows.md` §5 gives every signature; the names here are the same. The package root (`index.ts`) exports what the two Workers wire and nothing else: the admin reads and actions with their input and result types, `AdminContext`, `adminLink`, `ADMIN_OVERVIEW_PATH`, and `familyPagePath`; the port and job types; `VelaError` (the Worker reads its code as `VelaError["code"]`) and `errorLabel`; `deliverOutbound` with `DeliveryResult`; `handleInbound`; `rollupMetrics` and `applyRetention`; `ingestAnswerMedia` and `understandAnswer`; and `tickMember` and `reconcile` with `ReconcileResult`. `recordAdminView` with `AdminView`, `VELA_ERROR_CODES` with `VelaErrorCode`, `draftWeeklyRead`, and `loadScheduleInput` stay exported from their own modules (`admin.ts`, `errors.ts`, `jobs.ts`, `tick.ts`) for the package's code and tests, not from the root. The test harness is `@vela/services/testing`.

| Module | Entry points |
|---|---|
| `tick.ts` | `loadScheduleInput(deps, memberId, now)` · `tickMember(deps, memberId)`: load state, `decideSchedule`, execute each due action idempotently, then store `next_wake_at` in one statement that keeps the sooner of the decision and a stored wake that differs, to the millisecond, from the one the tick read before its decision (a wake another flow marked, or another tick stored, while the tick ran); the wake it read is replaced, and a null decision stores null, arm `scheduler.wakeAt` with the stored value, and return it (flows §3.15) · `reconcile(deps)`: first `applyPendingEffects` and `redriveStrandedOutbound` (`gateway.ts`), because an arrival sent without its effects looks undelivered to the schedule; then active kept-light members of families without `deleted_at` whose `next_wake_at` is null or more than 10 minutes past have their tick re-run, and each late one logs and records `scheduler_missed`, while a member whose tick throws is logged and skipped; then the understanding re-run and the founder's note (below); then the heartbeat ping. It returns `{ ticked, missed, rerun, effects }`, `effects` being the number of sent rows whose effects it applied · `type TickMember = (deps, memberId) => Promise<unknown>`: the flows that tick after a change, `handleConsentButton` and `handleParentCommand`, take `tick: TickMember = tickMember` as their last parameter, so a test can watch the call without running a whole schedule |
| `gateway.ts` | `enqueueOutbound(deps, db, request)`: insert with `ON CONFLICT DO NOTHING` inside the caller's transaction or database, enqueue only if inserted · `deliverOutbound(deps, outboundId)`: drop a row whose family has `deleted_at` or whose kept-light member is `left` or `deceased` (flows §3.7), send, commit the send result in its own transaction, then apply the kind's effects in a second transaction and stamp `outbound.effects_at` (a row already `sent` with `effects_at` null gets its effects only, never a second send), retry policy (the first send plus retries at 5, 15 and 30 minutes; failed on the fourth failed attempt), delivery failure handling. On a `ChannelSendError` with `migratedToConversationId`, re-point the family group exactly as an inbound `migrated` event does (`family_channels.conversation_id`, that conversation's `message_refs`, and its queued outbound rows, in one transaction), then re-enqueue the send at once, addressed to the new id, without counting an attempt · `applyPendingEffects(deps)`: the rows `sent` with `effects_at` null and `sent_at` more than two minutes ago, each logged as the warning `outbound_effects_late` (`outboundId`, `kind`; a log line, not an event) and finished through `deliverOutbound`; returns their number (D-B1) · `redriveStrandedOutbound(deps)`: a queued row's `queued_at` is when its pending delivery is due (the insert, the end of a retry's delay, a re-send to a migrated group, a re-drive); a row still `queued` more than 10 minutes after it (`STRANDED_AFTER_MINUTES`) lost its delivery job, so the lost delivery is counted as a failed attempt in a conditional update that claims the row (`queued_at` = now, `error` `stranded: …`), `outbound_stranded` is logged, and a delivery is enqueued again; at the fourth failed attempt the row fails at once, unsent, with the failure effects of any failed send; a row that throws is logged with `errorLabel` and left for the next sweep |
| `gateway-effects.ts` | The state changes after a send succeeds or fails, by outbound kind (flows §3.4, §3.7, §3.8, §3.12): an arrival's delivery and read-back, `repeated_at`, `turns.prompted_at`, a quiet notice's notification counts, `message_refs`, and a failed arrival's `delivery_failed_at` and `delivery.failed` notice. It imports no flow module |
| `repo.ts` | Shared queries and writes several flows use, each taking the database or the caller's transaction, with no business logic: members by channel user, families by group, organisers with links, kept-light members of a family, exchanges by date or ids, message refs, consented nearby contacts, quiet events, answer times · `familyHasEnded(db, familyId)` (deletion requested, or a kept-light member `left` or `deceased`) · `markWakeDue(db, memberId, at)` · `recordInboundMedia(tx, channel, input)` (one row per family per file, flows §3.5) · `repointFamilyGroup(tx, channel, fromConversationId, toConversationId)`, used by the inbound `migrated` event and the gateway: the linked `family_channels` row, that conversation's `message_refs`, and its queued outbound rows |
| `format.ts` | Values the copy catalog does not format (§4) and the two shapes every flow needs for a platform message: `inboundExternalId(event)` (`<conversation_id>:<message_id>`), `fitMessageText(text)` (within 4000 characters, never splitting a surrogate pair), `formatTime`, `formatAwayDate`, `formatNearbyContacts`, `channelLabel`, and the reaction emoji table with `reactionKindOf` and `reactionKindsOf` (flows §3.11) |
| `errors.ts` | `VelaError` with a `code` from `VELA_ERROR_CODES` (`not_found`, `invalid_outbound`, `invalid_payload`, `no_channel_link`, `illegal_state`) · `errorLabel(error)`: a caught error as a log field, the class name of the error and of up to two causes, each with its code when the code is an identifier or an integer (`DrizzleQueryError <- Error:23505`), never a message · `isErrorCode(value)`, internal, the identifier rule the label and the failed sends list share |
| `arrivals.ts` | `prepareDay(deps, memberId, date)`, `deliverArrival(deps, memberId, date, late)`, `sendRepeat(deps, memberId, date)`, `sendTurnPrompt(deps, recipientId, forDate)` |
| `quiet.ts` | `openQuiet`, `notifyQuiet`, `resolveQuietOnAnswer`, `handleQuietButton(deps, event, action)` (both quiet buttons). `quiet.nearby` lists only contacts with `consented_at` set and `declined_at` null, and is left out when there are none |
| `inbound/router.ts` | `handleInbound(deps, events)`: the routing table in flows §5, to onboarding, consent, parent answers and commands, group asks and replies, group linking, migration and departures, quiet buttons |
| `onboarding.ts`, `consent.ts`, `asks.ts`, `answers.ts`, `replies.ts`, `parent-commands.ts` | The flows of spec Appendix A. Onboarding stores nearby contacts unconsented (`consented_at` null) and sets the region as above. Her private messages reach `answers.ts` and `parent-commands.ts` only once she has consented and while she is `active` or `paused`; before consent, after a No, and once she is `left` or `deceased` they are ignored (flows §3.9). An answer with no delivered exchange in the last 36 hours writes no `answers` row: it is posted to the group with `group.answer_text` (or the voice) as an outbound `system` keyed by the inbound event id. `what_family_sees` returns the summaries of her last seven answered days and, when the most recent sent weekly read has lines, those lines in her language under `parent.family_sees_weekly_read` (`renderWeeklyRead` with audience `kept_light_member`; never the counts or the suggestion, and no heading when it returns null). Group asks, replies, and reactions are ignored once the family has `deleted_at` or its kept-light member is `left` or `deceased` (flows §3.5) |
| `group.ts` | Linking (`group.linked` with `{notice}`), `migrated`, and departures. For `member_left` in a linked group only: a linked member with role `member` who is not the kept-light member becomes `left` with `left_at` and leaves the turn rotation (event `member_left`); an organiser or the kept-light member keeps their state and private chats, and services record `member_left_group` and send the admin conversation `admin.member_left_group`; a subject with no link stores nothing. `resolveGroupSender` makes a `left` member who asks, replies, or reacts in the group again `active` (flows §3.16) |
| `pipeline.ts` | `ingestAnswerMedia(deps, answerId)`, `understandAnswer(deps, answerId)`: transcribe, understand, flag, translate, post to the family group. Each increments `answers.processing_attempts` when it starts. `understood_at` is set only when `ai.understand` and `ai.flag` both returned ok; a failed translation does not hold it back. The group transcript post, translations, and flag notices are keyed by the answer, so a re-run never repeats them. `flag_reason` is stored content-free as `<category>:<severity>`. When her language differs from the family's, the summary, which the model writes in the family language, is translated into her language and stored as the answer's `translations` row in her language, which `what_family_sees` shows (`summariesForHer`). A re-run that rewrites the summary deletes that row in the same transaction as the summary write, so she never reads the translation of a summary the family no longer has, even when the job stops before the new one is translated. `admin.flag` carries the family name and a link, never her words; organisers still receive `flag.notice` with her words verbatim, quoting the model's excerpt when it kept an exact one and everything she said when the AI layer dropped it (flows §3.10) |
| `jobs.ts` | `draftWeeklyRead`: the week's counts into `weekly_reads.stats`, the draft from `ai.weeklyRead` given only the days she answered, then `admin.weekly_read_draft` with a link to it · `rollupMetrics` · `applyRetention`: the rules in §10, "Retention" |
| `admin.ts` | `adminLink(config, familyId)` · `ADMIN_OVERVIEW_PATH` and `familyPagePath(familyId)` · `recordAdminView(deps, ctx, view)` · one function per write action: `recordConsent`, `recordContactConsent`, `addContact`, `removeContact`, `setAway`, `endAway`, `markLeft`, `markDeceased`, `deleteFamily`, `sendWeeklyRead` (below) · the pages' reads, each writing its `view` rows: `loadAdminOverview(deps, ctx)`, `loadFamilyPage(deps, ctx, familyId)`, and `loadFailedOutbound(deps, ctx, options?)` (below) |
| `events.ts` | `recordEvent(db, event, at)`, with `db` the database or the caller's transaction |

**Understanding re-run.** Every 5 minutes, after the late ticks, `reconcile` re-enqueues answers with `understood_at` null, received between 15 minutes and 24 hours ago, and `processing_attempts` below 3: a voice answer without a transcript to `ingest_answer_media`, anything else to `understand_answer`. A voice answer whose transcription succeeds spends two attempts on its first run (ingestion, then understanding). Nothing spaces the attempts out: the re-runs come at the first reconciliations after the answer is 15 minutes old, so all of them fall within about 25 minutes of it (ADR-25). When a job ends without a transcript or without `understood_at` and the answer's `processing_attempts` is 3 or more, the founder gets `admin.understand_failed` at once (no content, a link to the family's admin page), keyed by the answer so it goes out once. `reconcile` enqueues the same note under the same key, as a safety net for a job that crashed after counting its attempt, only for answers received 25 to 48 hours ago: until then an attempt could still be running or queued, and stored state cannot tell it from a crash.

**Admin actions** (flows §3.17 has each action's database effects). The admin Worker calls them with only the ports in `AdminDeps` (§9): the database, the clock, the logger, the outbound queue, the scheduler, and the AI; any other port throws `PortNotGivenError` there, so `admin.ts` must not reach for one. `ctx.admin` is the identity in the verified Cloudflare Access token (§9); `adminLink(config, familyId)` is `<publicBaseUrl>/admin/families/<family id>`, the `{link}` in admin messages. `recordAdminView` writes one `admin_access_log` row with action `view`, and records `admin_page_opened`, for each family whose records the page shows (the overview writes one per family it lists), so a family's copy of the log shows every page that showed its records (§9). `loadFailedOutbound(deps, ctx, { limit })` lists the failed or dropped outbound rows of all families, newest first by `queued_at` then id (the table keeps no failure time, and each retry moves `queued_at` to its due time); `limit` defaults to 20 and must be a whole number from 1 to 100, else `VelaError("invalid_payload")`. Each `FailedOutboundRow` is the row's `id`, `memberId`, `kind`, `status`, `attempts`, `queuedAt`, its `family` (`id`, `name`), and `errorCode`: the part of `outbound.error` before the first colon, cut off in SQL with `split_part` so the platform's description never leaves the database, and `unknown` when the column is null or that part is not an identifier (`not_found`, `family_ended`, `member_deceased`, `stranded`). It never carries the payload, the conversation id, or the raw error. It writes one `view` row and one `admin_page_opened` per family whose rows it returns, `what` = `/admin#failed-outbound`, and none when no row comes back. Each write function (`record_consent` → `recordConsent`, `record_contact_consent` → `recordContactConsent`, `add_contact` → `addContact`, `remove_contact` → `removeContact`, `set_away` → `setAway`, `end_away` → `endAway`, `mark_left` → `markLeft`, `mark_deceased` → `markDeceased`, `delete_family` → `deleteFamily`, `send_weekly_read` → `sendWeeklyRead`) checks that every id belongs to the family, then in one transaction applies the change, writes one `admin_access_log` row (`action`, `family_id`, `member_id` when the action is about a member, and a `what` that never holds message content), and records its event: `consent_given` for a pilot or privacy-notice consent; `consent_given` or `consent_declined` (kind `nearby`) for a contact's answer; `nearby_contact_added` and `nearby_contact_removed`; `away_set` (source `organiser`) and `away_ended`; `member_left`; `member_marked_deceased` (light off, status `deceased`, scheduler cleared, nothing sent to anyone, and the gateway drops rows already queued); `family_deletion_requested` (`families.deleted_at`, with the same drop); `weekly_read_sent` (below).

**Sending a weekly read.** The founder edits the lines and the suggestion; the count lines are fixed. `sendWeeklyRead` enqueues one budgeted `weekly_read` to each active organiser with a Telegram link, its text `renderWeeklyRead` with audience `organiser` (the family language, her name as the family calls her, the counts from `weekly_reads.stats`, the edited lines and suggestion), keyed by the kept-light member, the week's last date, and the organiser's conversation, and writes `weekly_reads.sent_lines`, `sent_suggestion`, and `sent_at` together only when at least one of those rows was inserted; `lines` and `suggestion` keep the draft. When none was (no organiser has a link, or each already received a weekly read that local day), the action is refused: the transaction rolls back, nothing is stored, logged, or sent, and the page says why. After the transaction, lines written in a language other than hers are translated into her language for "what does the family see"; the suggestion is not, since she never sees it (flows §3.13, §3.17).

**Tests** run against PGlite with a fixed clock, the fake AI and STT, an in-memory queue drained by the test, and a recording fake Telegram adapter. They include the full Appendix A loop (organiser onboards, parent consents, turn prompt, ask, arrival, answer, family reply, read-back next morning) and the silence drill: adapter failures produce one delivery-failed notice and no quiet event; a missed wake is caught by reconciliation without a double send; an AI failure never delays the light. They also cover a send refused for an upgraded group reaching the new id without spending an attempt; each departure rule, and a member who left becoming active again on their next ask, reply, or reaction; messages from her before consent, after a No, and after she is marked left or deceased storing and posting nothing; an answer sent before the arrival leaving the arrival delivered with no repeat and no quiet notice; after `mark_deceased` or `delete_family`, a group ask and an already queued send sending nothing; for the understanding re-run, a voice answer whose transcription fails twice being transcribed on its third ingestion and understood with one transcript post and one flag notice, a text answer whose flag call fails twice being understood on its third attempt with one flag notice, and an answer that ends its third attempt not understood producing one `admin.understand_failed`; each admin action writing its log row and event; the weekly read draft (the four counts in `stats`, only the days she answered given to the model) and send, including the count lines reaching organisers unedited and another week's read refused when it would reach the same organisers on the same local day, and what the family sees, which never shows her the counts or the suggestion; every retention rule; a send whose effects failed finished once by `reconcile` without a second message, and a queued arrival whose job was lost re-driven to exactly one send, or failed with one `delivery.failed` once its tries are spent; `tickMember` keeping a sooner wake marked while it ran, even one stamped before the tick started, and replacing the wake it read; and the failed sends list, with a code and no words, and its `view` rows.

## 9. `@vela/worker`

The package is deployed as two Workers (ADR-26), because Cloudflare Access on a Worker covers every hostname of that Worker, and Telegram's webhook and the privacy notices must stay open while the admin pages are closed: the **pilot Worker** `vela` (`wrangler.jsonc`) and the **admin Worker** `vela-admin` (`wrangler.admin.jsonc`). Each answers only on its workers.dev hostname.

- Entry modules. `src/index.ts`, the pilot Worker's, exports only the default handler, `createWorker(pilotRuntime)` (`fetch`, `queue`, `scheduled`), and the `MemberScheduler` Durable Object class. `src/admin-worker.ts`, the admin Worker's, exports only its default handler, `createAdminWorker(adminRuntime)` (`fetch`). workerd reads every export of an entry module as a handler or a class and refuses to start on any other value, so the handlers and their constants live elsewhere: `src/pilot-worker.ts` (`createWorker`, `VelaWorker`, `RECONCILE_CRON`, `NIGHTLY_CRON`) and `src/admin-app.ts` (`createAdminWorker`, `AdminWorker`).
- Seams. The pilot Worker's routes, queue consumer, cron, and Durable Object reach services through `PilotRuntime` (`src/runtime.ts`: `services`, the eight entry points in `PilotServices`; `createDeps(env, options?)`; `createChannels`; `notices`), and `pilotRuntime` is the one place the real services are wired into it. The admin Worker's routes reach them through `AdminRuntime` (`src/admin-runtime.ts`: `services`, the three admin reads and ten write actions in `AdminServices`, typed on `AdminDeps`; `createDeps(env)`; `access`), wired in `adminRuntime`. Tests hand both fakes.
- Ports (`src/deps.ts`). `buildDeps(env, notices, options?)` builds every port in `Deps` for the pilot Worker. `buildAdminDeps(env)` builds `AdminDeps`, the ports `admin.ts` uses and no others: `db`, `clock`, `logger`, `queues.outbound` (a sent weekly read), `scheduler` (away periods, departures, deaths, and deletions wake or clear it), and `ai` (a sent weekly read is translated for her). The admin routes and `AdminServices` are typed on `AdminDeps`, so admin code that reaches for a channel, the media store, or another queue does not compile. Services' functions take a whole `Deps`, so `servicesDeps(ports)` passes the given ports on unchanged, and every other port (`queues.media`, `queues.understand`, `random`, `media`, `channels`, `stt`, `heartbeat`, `config`) throws `PortNotGivenError`, whose `code` is the port's name, the moment it is touched: a change in services that starts using one fails loudly on the admin page (`request_failed` with `PortNotGivenError:<port>`) rather than doing nothing.
- Pilot routes (Hono, `src/app.ts`): `GET /healthz` (builds no deps); `POST /webhooks/telegram` (verify the secret before deps are built, a wrong or missing one is 401; parse; handle; 200); `GET /privacy` and `GET /privacy/zh-TW`, the privacy notices (below). Every other path, `/admin` and everything under it included, is 404 and calls nothing.
- Admin routes (Hono, `src/admin-app.ts`): `GET /` redirects (302) to `/admin`, so the Worker's bare address opens the overview; every other path outside `/admin` (`/webhooks/telegram`, `/healthz`, `/privacy` included) is 404 and builds nothing. The admin pages, server-rendered:
  - `GET /admin`, the overview, shows no family content. It calls `loadAdminOverview` and then `loadFailedOutbound` with the same identity, one after the other on the request's one database connection, and renders a table of every family (the kept-light member's status, time zone, local date, and next wake; today's exchange type and state, delivery, failure, repeat, and answer times; the quiet event; today's answer kinds and whether each was understood or flagged; AI calls and failures over 24 hours), each family linking to its page, and a failed sends section (`#failed-outbound`) with each failed or dropped row's last due time (`queuedAt`), family, kind and outbound id, member id, status, attempts, and `errorCode`, or "No send has failed or been dropped." Never words, summaries, transcripts, flag quotes, or AI outputs.
  - `GET /admin/families/:familyId` shows one family (`loadFamilyPage`) in anchored sections: members (`#members`, with the forms to record a consent, mark a member left, and mark the kept-light member deceased), consents (`#consents`), nearby contacts (`#contacts`), away periods (`#away`), answers with their summaries (`#answers`), the flagged answers (`#flags`, each row `#flag-<answer id>` with its content-free `flag_reason`), the answers the re-run could not read (`#not-understood`), weekly reads (`#weekly-reads`, each `#weekly-read-<weekly read id>`: the count lines as organisers will read them, not editable, and for a draft a Send form with the lines and the suggestion; for a read already sent, the sent lines and suggestion), AI calls with their outputs (`#ai`), and deletion (`#delete`). A family that does not exist is 404, an address that is not a family id is 400, and neither logs a view. Links in `admin.*` messages point to the family page, `${publicBaseUrl}/admin/families/<family id>`.
  - `POST /admin/families/:familyId/:action`, one HTML form per `ADMIN_ACTIONS` value except `view`, calls the matching `admin.ts` function with `ctx = { admin, familyId }`, so every id in the form must belong to that family, and redirects back to the family page (303) with the result (`done`, `sent`, `already_sent`, `no_organiser`, `budget`) shown as a notice. A form value the page does not offer (a consent kind, a language, a contact's answer) or a missing confirmation is 400 and changes nothing; a refusal from services is 404 (`not_found`), 409 (`illegal_state`, `no_channel_link`), or 400, with its code and no stack trace. `delete_family` requires typing `delete`. `mark_left` requires typing `left` for every member, because for the kept-light member it puts her light out for good; the page sets her form, and that of any member who has consented, apart under its own heading saying so. `mark_deceased` is offered only for a member whose light is on.
  - Cloudflare Access protects the whole admin Worker, every hostname Cloudflare associates with it (ADR-26), and every `/admin` request also needs a valid Access token in the Worker (`src/access.ts`): the Worker verifies the `Cf-Access-Jwt-Assertion` header, an RS256 JWT, against the keys at `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` (cached for an hour, fetched again for an unknown `kid`), its `aud` (holding `ACCESS_AUD`), `iss` (`https://<ACCESS_TEAM_DOMAIN>`), expiry, and not-before (60 seconds of skew), and takes the `email` claim as the admin identity. Checking the token in the Worker as well means an Access application switched off or misconfigured cannot open the page. A request without a valid token gets 401. A POST must also be same-origin: its `Origin` header must be present and equal the origin of `PUBLIC_BASE_URL`, the admin Worker's own origin (not whatever hostname the request arrived on), because the Access session cookie would otherwise let another site submit a form from the founder's browser; a POST that fails this gets 403. The admin pages send `referrer-policy: same-origin`, not `no-referrer`: under `no-referrer` the Fetch standard gives a form POST the Origin `null`, which this check refuses. Neither refusal calls services, so neither changes nor logs anything. Only when `ENVIRONMENT` is `development`, where nothing sits in front of `wrangler dev`, a request with no token at all passes as the identity `development`.
- Privacy notices (H4 in ADR-26). The pilot Worker serves `plan/materials/pilot/privacy-notice.en.md` and `privacy-notice.zh-TW.md` at `NOTICE_PATHS` (`src/notices.ts`: `/privacy` and `/privacy/zh-TW`), without a Markdown dependency. `scripts/notice-markdown.ts` understands only what the notices use (`#` to `###` headings, paragraphs, `-` and numbered lists, tables, block quotes, `**strong**` and `*emphasis*`, https and mailto links, code spans), escapes every character of text, and throws with the line number on anything else (indented lines, fences, raw HTML, rules, setext headings, `*` or `+` lists, other link targets). `pnpm --filter @vela/worker notices` (`scripts/generate-notices.ts`) writes the committed module `src/notices.generated.ts` (`PRIVACY_NOTICES`, each notice's `title` and `html`), which is all the Worker serves; `src/notices.test.ts` renders the Markdown again and fails while that module is stale, so CI catches a notice edit that was not regenerated. `noticePage(lang, notice)` (`src/html.ts`) returns a plain page with `lang` set to the notice's language, one narrow column for a phone, no script and no external request (`content-security-policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`), and `cache-control: public, max-age=300`. `unfilledPlaceholders(html)` lists the bracketed text left in a notice, except `[Name]` and `[名字]`, which quote the pause message; any other bracket, new ones included, counts as a blank. Outside development `refuseUnfilledNotices` throws `ConfigError` whose `code` is the notice's file name (`ConfigError:privacy-notice.en.md`) while either notice holds a blank: both pages answer 500, and `createDeps` refuses the same way, so no webhook update, queue job, cron run, or alarm tick runs either. Development serves the notices blanks and all, for the founder to read.
- `MemberScheduler`, exported by the pilot Worker, which alone declares its migration; the admin Worker binds the same class with `script_name` `vela` (`vela-dev` locally), so a wake the admin page asks for lands on the object whose alarm runs the tick. RPC `wakeAt(memberId, at)` stores the member id and sets the alarm no later than `at`: an alarm already set sooner stays, because the tick decides from the data, so an early wake costs one tick that finds nothing due while a later one could lose a wake asked for mid-tick. `wakeAt(memberId, null)` deletes the alarm and all stored state (a member who stopped, left, died, or was deleted keeps nothing in the object). `alarm()` calls `tickMember` with a scheduler port that sets this object's own alarm directly (an RPC to itself would wait on its own lock); a null result deletes the alarm, any other is armed no later than the returned instant. A tick that throws is logged as `scheduler_tick_failed` with `errorLabel` and tried again within a minute. An alarm that fires after the object was cleared does nothing.
- Queues, consumed by the pilot Worker only: `vela-outbound` → `deliverOutbound`; `vela-media` → `ingestAnswerMedia`; `vela-understand` → `understandAnswer` (in staging and production the names end in `-staging` or `-production`). The admin Worker only produces onto the outbound queue. One set of deps per batch; a message is acked when its job returns and retried when it throws, logged as `queue_job_failed` with `errorLabel`, and after its `max_retries` it goes to the environment's one dead-letter queue (`vela-dead-letter`, `vela-dead-letter-staging`, `vela-dead-letter-production`). A body that is not a job is logged and acked.
- Cron, on the pilot Worker only: every 5 minutes (`*/5 * * * *`) `reconcile` (pending send effects, stranded sends, late ticks, the understanding re-run and the founder's note, then the heartbeat); nightly at 03:20 UTC `rollupMetrics`, then `applyRetention`. A run that throws, building its deps included, is logged as `cron_failed` with the cron and `errorLabel(error)`, and fails with an error whose message is only that label.
- Errors: in either Worker, an unexpected failure in a route answers 500 (so Telegram redelivers a webhook) and is logged as `request_failed` with the path, the method, and `errorLabel(error)` (`requestFailed`, `src/request-errors.ts`); every error the Workers log (`request_failed`, `queue_job_failed`, `scheduler_tick_failed`, `cron_failed`) is logged by its label, never its message.
- Configuration: two files, each with local development at its top level and `env.staging` and `env.production` for the deployed Workers, each environment in its own Cloudflare account. Named environments inherit no binding, so each environment repeats its own. `wrangler.jsonc` is the pilot Worker (`vela-dev` locally, `vela` in both deployed environments): the `MemberScheduler` binding and its migration, producers and consumers for `vela-outbound`, `vela-media`, and `vela-understand` with the dead-letter queue `vela-dead-letter`, the R2 bucket `vela-media`, the Hyperdrive id, and both crons (in staging and production every queue and bucket name ends in `-staging` or `-production`). `wrangler.admin.jsonc` is the admin Worker (`vela-admin-dev` locally, `vela-admin` deployed): the `MemberScheduler` binding with `script_name`, one producer onto the pilot Worker's outbound queue, and the pilot Worker's Hyperdrive id; no consumer, cron, bucket, or migration. Every deployed Worker has `workers_dev` on, `preview_urls` off (every hostname a Worker answers on is one more to reason about; Cloudflare generates no preview URL for a Worker with a Durable Object anyway), and no routes, so it answers only on `https://<Worker name>.<account subdomain>.workers.dev`. The development top level of both files has `workers_dev` off: `wrangler deploy` without `--env` deploys it, with the admin Worker's development Access bypass and none of the refusals, and it must get no address. The subdomains are `vela-light` ("Vela", production) and `vela-light-staging` ("Vela staging"), so the hosts are:

  | | Pilot Worker `vela` | Admin Worker `vela-admin` |
  |---|---|---|
  | production | `https://vela.vela-light.workers.dev` | `https://vela-admin.vela-light.workers.dev` |
  | staging | `https://vela.vela-light-staging.workers.dev` | `https://vela-admin.vela-light-staging.workers.dev` |
  | development | `http://localhost:8787` (`pnpm dev`) | `http://localhost:8787` (`pnpm --filter @vela/worker dev:admin`) |

  If an account's subdomain turns out different, the header of `wrangler.jsonc` is the one list of what changes. `src/wrangler-config.test.ts` builds every host from `WORKERS_DEV_SUBDOMAINS` and fails until these agree with it: the three URL vars of that environment in `wrangler.jsonc`, `PUBLIC_BASE_URL` of that environment in `wrangler.admin.jsonc`, and every workers.dev link in the Markdown of `plan/materials/pilot` (the nearby-contact consent texts and the pilot README). No test sees the privacy policy link of that environment's bots in @BotFather, the `WORKER_URL` given to `telegram:setup` (`infra/README.md`, section 7, steps 3 and 6), or the documents that write the hosts out (`git grep vela-light`). The pilot Worker's vars are `ENVIRONMENT`, `TELEGRAM_BOT_USERNAME`, `PUBLIC_BASE_URL` (the admin Worker's origin), `PRIVACY_NOTICE_URL_EN` and `PRIVACY_NOTICE_URL_ZH_TW` (its own origin plus `/privacy` and `/privacy/zh-TW`), and `REGIONS`; its secrets are `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `HEALTHCHECKS_PING_URL`, and `ADMIN_CONVERSATION_ID`, the founder's personal chat id with that environment's bot, which is a secret and never a var in either file. The admin Worker's vars are `ENVIRONMENT` and `PUBLIC_BASE_URL` (its own origin); its secrets are `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ANTHROPIC_API_KEY` (a sent weekly read is translated for her); it does not read `ADMIN_CONVERSATION_ID`. `.dev.vars.example` lists every secret with the Worker that reads it, and both local sessions read one `.dev.vars`. `pnpm dev` runs the pilot Worker; `pnpm --filter @vela/worker dev:admin` runs `wrangler dev -c wrangler.admin.jsonc -c wrangler.jsonc`, both Workers in one session with the admin Worker on port 8787, so its `script_name` binding and its producer resolve to the local pilot Worker. The local database is `@vela/db dev-db` reached through Hyperdrive's local connection string. `readConfig(env, notices)` (`src/config.ts`) builds the pilot Worker's `Config`: `regions` from `REGIONS` (comma separated; the pilot: `apac`), `publicBaseUrl` from `PUBLIC_BASE_URL`, `privacyNoticeUrls` from `PRIVACY_NOTICE_URL_EN` and `PRIVACY_NOTICE_URL_ZH_TW` (other languages take the English URL), and `adminConversationId` from the secret `ADMIN_CONVERSATION_ID` (required outside development; in development empty or missing is null and sends no admin messages). The admin Worker builds no `Config`; `checkAdminConfig(env)` checks its environment. There is no admin bearer token.
- Deployed configuration is checked before anything runs. The hosts and notice URLs are written out (ADR-26); the Hyperdrive ids (in both files) and the bot usernames stay `PLACEHOLDER_` values until the founder creates them, never a guess (`vela.family` belongs to another company, `design/research-identity.md`). Outside development, `readConfig` throws `ConfigError` for the first string on the pilot Worker's environment, var or secret alike, that contains `PLACEHOLDER_`; for `PUBLIC_BASE_URL`, `PRIVACY_NOTICE_URL_EN`, or `PRIVACY_NOTICE_URL_ZH_TW` when it is not an https URL; for a missing secret (`ADMIN_CONVERSATION_ID` included) or required var; and for a privacy notice that still holds a blank (above). `checkAdminConfig` does the same for the admin Worker: no placeholder anywhere, and `PUBLIC_BASE_URL` https. The error's `code` is the variable's name, or the notice's file name, and its message never holds the value, so the failure is logged as, for example, `ConfigError:PUBLIC_BASE_URL`. `buildDeps` and `buildAdminDeps` check before they open any connection, so a pilot Worker deployed with a placeholder, a URL that is not https, a missing secret, or an unfilled notice handles no webhook update that carries something to handle, queue job, cron run, or alarm tick, and an admin Worker so deployed renders no page past its Access check. The notice pages build no deps and check only the notices (`refuseUnfilledNotices`): a pilot Worker with an unfilled notice also refuses both pages, and one with both notices filled serves them even while it refuses everything else. `/healthz` builds no deps and still answers 200, so neither it nor the notice pages prove the configuration.
- `compatibility_date` is pinned, equal in both files, to the newest date the runtime of `@cloudflare/vitest-pool-workers` accepts (2026-08-22), and is raised together with that package, or `pnpm test` cannot start its runtime.
- Telegram setup: `pnpm --filter @vela/worker telegram:setup [--drop-pending-updates]` runs `scripts/telegram-setup.ts`, a thin entry around `scripts/telegram-webhook.ts` (`setUpTelegram`, `parseSetupArguments`, `webhookUrl`, `SetupError`, `DROP_PENDING_UPDATES`), with `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `WORKER_URL` read from the environment. `WORKER_URL` is the pilot Worker's origin, never the admin Worker's, which Access closes to Telegram. Pending updates are kept unless `--drop-pending-updates` is given (H6), because during a live pilot they are real answers, and any other argument is refused before Telegram is called, so a mistyped flag cannot quietly keep or drop them. It refuses a secret outside `A–Z a–z 0–9 _ -` (1 to 256 characters) and a `WORKER_URL` that is not https, registers the origin of `WORKER_URL` plus `/webhooks/telegram` (a path given with it is replaced) with `setWebhook`, `TELEGRAM_ALLOWED_UPDATES` imported from `@vela/adapters` (`message`, `callback_query`, `message_reaction`, `my_chat_member`), and `drop_pending_updates` as the flag says, sets `/ask` and `/later` for group chats and no menu for private chats with `setMyCommands`, and prints the webhook URL, whether pending updates were kept or dropped, the updates, the commands, the bot's username, and whether group privacy is on, never the token or the secret. A failure other than its own refusal is printed as `errorLabel(error)`, never its message.
- Deploy: `.github/workflows/deploy.yml` deploys through the GitHub environments `staging` (on a push to `main`, or a manual run the environment's rule limits to `main`) and `production` (on a `v*` tag, after the founder approves). Each job runs lint, typecheck, and the tests, then `pnpm --filter @vela/db migrate` once against that environment's `DATABASE_URL`, then the pilot Worker (`wrangler deploy --env <environment>`), then the admin Worker (`wrangler deploy -c wrangler.admin.jsonc --env <environment>`), whose `script_name` binding needs the class the pilot Worker exports; one run per environment at a time and never cancelled halfway. It reads three environment secrets in each, never repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `DATABASE_URL`. Until the founder has created an environment's secrets, its migrations are run by hand (`infra/runbooks/release.md`) (ADR-23).
- Tests with `@cloudflare/vitest-pool-workers` (`src/**/*.test.ts` and `scripts/**/*.test.ts`) run inside workerd against the bindings in `wrangler.jsonc`, with fake secrets and fake services; the admin Worker's tests build its environment from those same bindings. They cover the pilot routes: webhook rejection, `/admin` paths answering 404 and calling nothing, and the notice pages (served blanks and all in development, served filled in a deployed environment, refused while a notice holds a blank); the admin Worker's addresses (`/` redirecting to `/admin`, the pilot's paths answering 404); admin requests without a valid Access token (401) or from another origin (403) calling no service; the admin pages served with `referrer-policy: same-origin`; the overview reading both lists with the token's identity; the typed confirmations and the forms' allowed values; escaping; the Access token checks; the ports the admin Worker hands services, each missing one throwing `PortNotGivenError`; the committed notices module matching the Markdown, the Markdown's escaping, and the constructs the generator refuses; the Telegram setup script keeping pending updates unless `--drop-pending-updates` is given, refusing an unknown argument and a `WORKER_URL` that is not https before calling Telegram, and registering the origin plus `/webhooks/telegram`; the Durable Object alarm loop, including a sooner wake asked for mid-tick being kept; queue dispatch and cron, including a failed run logged by its label; configuration refusals naming the variable or notice file and never its value, including a deployed pilot Worker without `ADMIN_CONVERSATION_ID` and an admin Worker without `ANTHROPIC_API_KEY`; errors logged by label, never by message; and both Workers' configurations as wrangler reads them (`src/wrangler-config.test.ts`): the names `vela` and `vela-admin` and their entry modules, workers.dev only with no preview URLs and no routes, and development with `workers_dev` off, every host `https://<Worker name>.<subdomain>.workers.dev`, `PUBLIC_BASE_URL` the admin origin in both Workers and the notice URLs the pilot origin plus their paths, no `ADMIN_CONVERSATION_ID` var anywhere, nothing but the Hyperdrive ids (each its placeholder or a 32-character lowercase hex id) and the pilot Worker's bot username left as placeholders, filled values allowed, the pilot Worker owning the class, the consumers, and the migration, its crons equal to `RECONCILE_CRON` and `NIGHTLY_CRON`, every workers.dev link in the pilot pack a deployed pilot Worker's notice URL and each nearby-contact message linking the production notice in its own language, and the admin Worker binding the class by `script_name`, producing onto the pilot Worker's outbound queue, sharing its Hyperdrive id, and running none of the pilot Worker's consumers, crons, buckets, or migrations.

## 10. Decisions taken during the build

Builders recorded the rows from Schedule to Copy during the foundation build. The rows from Media identity to Initial migration are the sprint 1 contract decisions of 2026-09-14, taken before services and the worker were built; the Time zones row was replaced by one of them. The rows from Outbound recovery to Deployed configuration were taken while services and the worker were built (2026-09-15 and 16). The rows from Hosting to Admin chat id, and the changes to the Admin conversation, Admin actions, Privacy notice link, Telegram setup, Deploy, and Deployed configuration rows, follow the hosting decision of 2026-09-17 (ADR-26). The Her summary on a re-run row came from the review of 2026-09-17. All are part of the contract.

| Area | Decision |
|---|---|
| Schedule | A member's arrivals start on `member.startsOn` (set to the day after consent or start), so the first morning is tomorrow, as the copy promises. A repeat never follows a failed delivery. Notify-quiet has the same away and delivery-failure guards as open-quiet. When a wait is pending, the re-notification waits for it. `nextWakeAt` includes thresholds created by actions due in the same decision. An arrival time at or after 22:00 keeps that day's window open until local midnight. The learning period is `date < learningUntil`. Executing `open_quiet` with `notify` must set `lastNotifiedAt`. Yesterday's repeat and quiet are not emitted when today's arrival is delivered in the same decision. The turn prompt is not due when tomorrow already has a scheduled ask: services pass `tomorrow.askScheduled` when a composed exchange is `scheduled_for` tomorrow. The weekly read is drafted only for a week whose last day is on or after `startsOn`. A day's `answeredAt` is the earlier of its exchange's `answered_at` and her first answer received on that local date, so an answer sent before the arrival counts for that day and no repeat or quiet follows (spec §19, flows §3.9). |
| Tuning | 360 minutes until 14 answered days; the Sunday median needs at least 3 Sunday samples; results round up. |
| Time zones | One rule, `isIanaTimeZone` in `@vela/contracts`: IANA names only, with `UTC` and `Etc/UTC` (and `GMT`, `Etc/GMT`, `Etc/GMT0`) accepted. Fixed offsets (`+08:00`, also with the Unicode minus sign) and signed GMT names (`Etc/GMT-8`, `GMT+0`, in any letter case, including those that mean UTC) are rejected, checked on the name as given and on the name the runtime resolves it to, because a member stored with an offset loses daylight saving. The `TimeZone` schema refines with it and core's `isValidTimeZone` returns it, so the two can never disagree. |
| Buttons and keys | The wire format and per-kind key shapes are defined in `buttons.ts` and `keys.ts` (`OUTBOUND_KEY_SHAPES`); `quiet_notice` keys carry the notify count as suffix; `answer_post` and `flag` keys carry the answer id in the suffix. |
| Rendering | A repeat shows its preface instead of the late note; chips only on questions; vote options at most 7; labels over 64 characters are shortened. Callers guarantee a photo choice has exactly two images. A text over 4000 characters is shortened, read-back lines first, then the ask text, never the greeting, the asker, or the hint (§5). A weekly read over 4000 characters shortens its lines and suggestion, longest first, never the counts (§5). |
| Adapters | `createTelegramAdapter` takes `botUsername` (validated: 1 to 32 of `A–Z a–z 0–9 _`, no `@`; commands addressed to another bot, in text or caption, are ignored) and `now` (callback queries carry no date). Unsupported content (video, video note, animation, document, location, venue, contact, poll, dice, story, checklist, paid media) yields an `other` event, which becomes an `other` answer. Messages sent on behalf of a chat (`sender_chat`, `is_automatic_forward`) yield nothing. A basic group's upgrade yields `migrated`, with the old id as the conversation and the new id as `migratedToConversationId`, possibly twice for one move. A command addressed to this bot keeps its raw text, `@mention` included; services strip it. Only consecutive images are grouped into an album; media keeps its order. Replies set `allow_sending_without_reply`. "Message is not modified" when closing buttons is success. |
| AI | Requests go through the beta namespace with `betaZodOutputFormat`; output is parsed only after `stop_reason` is checked; fallbacks are set only for `claude-opus-5`. Every HTTP error resolves to the safe default. A flag's quote is kept only if it is an exact substring of her words. Services always pass her language to speech-to-text (Deepgram detects Chinese only as Simplified, so a `zh` detection never replaces a `zh-TW` transcript). Weekly read accepts 0 to 4 lines and hello 1 to 2. Batch calls wait for a separate port in a later sprint. Input text over `INPUT_TEXT_LIMITS` is shortened, not rejected; the fake validates input like the real client. `createClaudeAi` pins base URL, credential, log level, 2 retries, and per-call timeouts; Deepgram requests time out after 60 seconds. `Understanding.away` is `{ from, until }` (§7). |
| Database | `outbound.effects_at` marks that a sent row's effects were applied (D-B1, 2026-09-15): a send is committed before its effects so a failed effect can never cause a second message. Channel columns carry CHECKs from `CHANNELS`; `events.name` carries a CHECK from `EVENT_NAMES`; media references use `ON DELETE SET NULL` so retention can delete media (services also remove deleted ids from `exchanges.media_ids` and `exchanges.options`, which no foreign key covers); a group can be re-linked (`family_channels` unique only while linked). Member references are `SET NULL` or `CASCADE` by what the row means without the member (§3, item 19); `turns.holder_id` is nullable for a holderless prompt. `time` columns read as `LocalTime` (`HH:MM`). Most tables carry `created_at`; `ai_calls`, `events`, and `admin_access_log` carry `at`; `answers` (`received_at`), `channel_links` and `family_channels` (`linked_at`), `consents` (`given_at`), `outbound` (`queued_at`), and `quiet_events` (`opened_at`) carry their own time; `turns`, `story_questions`, `metrics_daily`, `flags`, and `deletions` carry no creation time. Primary keys are named `<table>_pkey`, unique constraints `<table>_<columns>_key`, and CHECKs `<table>_<column or rule>_check`. Indexes end in `_idx` and name their columns or their purpose (`family_channels_channel_conversation_id_idx`, `members_due_idx`, `quiet_open_idx`), except the unique index `exchanges_one_per_day`, which keeps the reference schema's name because §3 item 4, the architecture, the runbooks, and the schema tests name it; foreign key names are Drizzle's, because inline references cannot be named. `VelaDatabase` uses a result type whose `execute` returns `{ rows }` on both drivers. |
| Copy | `t()` throws on an unknown key, a missing parameter, or an unused parameter. `admin.*` keys take only `family`, `link`, and `name`. |
| Media identity | `MediaRef.providerUniqueId` is Telegram's `file_unique_id`, set by the adapter for voice, audio, the chosen photo size, and each album photo; it cannot fetch a file, so it does not satisfy the "provider file id or URL" check. Services record media once per family per file on `(family_id, channel, provider_unique_id)`: a file forwarded again inside one family reuses its row. |
| Group migration | `ChannelSendError.migratedToConversationId` carries Telegram's `parameters.migrate_to_chat_id`; the code stays `invalid_request` and not retryable. On it the gateway re-points the family group as an inbound `migrated` event does (`family_channels.conversation_id` and that conversation's `message_refs`, one transaction) and re-enqueues the send at once without counting an attempt. |
| Departures | New inbound kind `member_left` from Telegram's `left_chat_member` service message, which bots receive even in privacy mode. `InboundEvent.subject` (`externalUserId`, optional `displayName`) is the person who left; `sender` is whoever acted. The bot's own departure yields nothing. In a linked group only: a linked `member` who is not the kept-light member becomes `left` with `left_at` and leaves the turn rotation; an organiser or the kept-light member changes no state, services record `member_left_group`, and the admin conversation gets `admin.member_left_group` (no content); a person with no link stores nothing. |
| Nearby contacts | The onboarding nearby step stays, and its contacts are stored with `consented_at` null. `quiet.nearby` lists only contacts with `consented_at` set and `declined_at` null, and is left out when there are none. The founder records each contact's yes or no on the admin page (consent kind `nearby`). `onboarding.ask_nearby` tells the organiser to ask the person themselves first; their number appears in a note only after they say yes (Vela never contacts a nearby contact). |
| Region | `Config.regions` lists the regions that exist (the pilot: `apac`). The country picks the preferred region (TW, JP, SG, AU, IN → `apac`; US, CA → `us`; GB, DE, and other European countries → `eu`), falling back to `apac` when that region does not exist, so every pilot family is `apac` (ADR-7, update of 2026-09-14). |
| Understanding re-run | `answers.processing_attempts` counts starts of media ingestion or understanding; `understood_at` needs `ai.understand` and `ai.flag` both ok, not the translation. `reconcile` re-enqueues answers not understood, received 15 minutes to 24 hours ago, with fewer than 3 attempts; after the third failed attempt the founder gets `admin.understand_failed` once. Re-runs never duplicate the transcript post, translations, or flag notices (§8, ADR-25). |
| Admin conversation | Carries no content: `admin.flag`, `admin.weekly_read_draft`, and `admin.understand_failed` carry the family name and a link to the admin page in the Access-protected admin Worker (`Config.publicBaseUrl`, the admin Worker's origin, + `/admin/...`), never her words. The conversation is the founder's personal chat with the bot, whose id is the pilot Worker's secret `ADMIN_CONVERSATION_ID`. Opening that page writes `admin_access_log`. Organisers still receive `flag.notice` with her words verbatim: they are family (ADR-21). |
| Weekly read | The founder edits the draft on the admin page and taps Send; services store `weekly_reads.sent_lines`, `sent_suggestion`, and `sent_at` and enqueue a budgeted `weekly_read` to each active organiser with a Telegram link. `what_family_sees` adds the lines of the most recent sent read, under `parent.family_sees_weekly_read`, to the summaries of her last seven answered days. From the review: the lines are shown in her language (translated at Send when they were written in another), and a Send that would reach no organiser is refused rather than recorded as sent (§8, "Sending a weekly read"). Decided 2026-09-14, because she is never shown missed days (spec §8): the counts are not AI output. `renderWeeklyRead` (§5) writes them for organisers from `weekly_reads.stats` through `weekly_read.*` copy, then the lines, then the suggestion; the model writes only zero to four lines about her week and the suggestion (`weekly_read.v4`, §7) and is given only the days she answered; the founder edits the lines and the suggestion, never the counts; her copy is the lines alone, never the counts, the nobody-asked line, or the suggestion, and nothing when there are no lines. `lines` and `suggestion` keep the draft so prompt versions can be compared. |
| Admin actions | Services module `admin.ts`, served by the admin Worker `vela-admin` as POST forms under `/admin`, with Cloudflare Access on the whole Worker, a verified Access token, and a same-origin check (§8, §9, ADR-26). `ADMIN_ACTIONS` in `@vela/contracts`: `view`, `record_consent`, `record_contact_consent`, `add_contact`, `remove_contact`, `set_away`, `end_away`, `mark_left`, `mark_deceased`, `delete_family`, `send_weekly_read`. Every action writes `admin_access_log` (its `action` CHECK comes from the tuple; `member_id` has no foreign key; `what` never holds message content) and records a domain event, reusing existing event names where the fact already has one (ADR-22). |
| Retention | `applyRetention` implements the data map's pilot rules (`plan/materials/pilot/data-map.md`; the list is in the header of `packages/db/src/schema.ts`). After 30 days it clears `exchanges.text` and `options` (30 days after delivery), chips, translations, `replies.text`, the text in `answers.payload`, `answers.transcript`, `mentions`, `mood_words`, `flag_reason`, suggestions' text, `outbound.payload` (30 days after `sent_at`), `ai_calls.output`, and the reply text in `quiet_events.ask_to_check`; a cleared NOT NULL column takes its empty value, and chips and translations rows are deleted. It deletes `message_refs` older than 30 days, invites 30 days after expiry or acceptance, expired onboarding sessions, media per `expires_at` and `kept` (removing the id from `exchanges.media_ids` and `options`, and writing a `deletions` row for every media deletion), members 30 days after `left_at`, families within 24 hours of `deleted_at`, and `events`, `metrics_daily`, `ai_calls`, and `outbound` rows older than 24 months. Durable Object storage is cleared on stop, left, deceased, and deletion. Summaries, the `flag` boolean, and away dates stay while the family uses Vela (ADR-24). |
| Privacy notice link | `group.linked` takes `{notice}`, the notice URL in the family's language, from `Config.privacyNoticeUrls` (the pilot Worker's vars `PRIVACY_NOTICE_URL_EN` and `PRIVACY_NOTICE_URL_ZH_TW`, which are its own origin plus `/privacy` and `/privacy/zh-TW`, the pages it serves; §9). |
| Parent commands | `家人看得到什麼` is a `what_family_sees` keyword beside the existing ones, with its 甚麼 and simplified forms, following the keyword list's own rule. |
| Unattached answer | A message from her with no delivered exchange in the last 36 hours is posted to the group with `group.answer_text` (or the voice) as an outbound `system` keyed by the inbound event id, with no `answers` row. There is no `answer.unattached` key. From the review: this applies only once she has consented and while she is `active` or `paused`; before consent, after a No, and once she is `left` or `deceased`, her messages are ignored (flows §3.9). |
| Telegram setup | `allowed_updates` are `message`, `callback_query`, `message_reaction`, `my_chat_member`; `left_chat_member` arrives inside `message`. The webhook secret is 1 to 256 characters of `A–Z a–z 0–9 _ -`. The webhook is the pilot Worker's origin plus `/webhooks/telegram`; pending updates are kept unless `--drop-pending-updates` is given, and any other argument is refused (§9, ADR-26). |
| Deploy | GitHub environments `staging` and `production`, where production requires the founder's approval. `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `DATABASE_URL` are environment secrets, never repository secrets. Migrations run once in the deploy job (`.github/workflows/deploy.yml`) before the pilot Worker is deployed, and the admin Worker is deployed after it; until an environment's secrets exist, the founder runs the migrations (build plan 0.3, ADR-23, ADR-26). |
| Initial migration | No database exists yet, so a schema change regenerates `migrations/0000_init.sql` (delete `packages/db/migrations`, run `drizzle-kit generate --name init`) instead of adding `0001`. `architecture/schema.sql` is always regenerated with `pnpm --filter @vela/db export-sql`, never edited by hand. |
| Outbound recovery | D-B1 (2026-09-15, the column in the Database row): the gateway commits a send (`status sent`, `sent_at`, `external_id`, `message_refs`) in its own transaction before it applies the kind's effects in a second one, stamped with `outbound.effects_at`, so a failed effect can never cause a second message: a row `sent` with `effects_at` null gets its effects only. `reconcile` applies such rows' effects once `sent_at` is two minutes old, before the late ticks, logs each as the warning `outbound_effects_late` (not an event), and reports their number as `effects`. A queued row whose delivery job was lost (more than 10 minutes past its `queued_at`, which is when its pending delivery is due) is re-driven by `reconcile`, the lost delivery counting as a failed attempt, and fails unsent at the fourth, like any send whose retries are spent (flows §3.7, §3.15). |
| Next wake | `tickMember` reads the stored `next_wake_at` before anything its decision reads, then stores `next_wake_at` in one statement that keeps the sooner of the decision and the stored wake when the stored wake differs from the one it read: another flow marked it, or another tick stored it, while the tick ran. A flow stamps its wake with the time it read before its own work, which can be before the tick started, so no comparison with a clock reading can tell such a wake apart. The comparison is to the millisecond, the precision of the `Date` the tick reads the wake into, so a wake written by hand in SQL with microseconds does not look changed to every tick and wake her at once, forever. The wake the tick read is replaced, and a null decision stores null. The tick arms the scheduler with, and returns, the value stored. The Durable Object's `wakeAt` sets the alarm no later than the time given, so the object and the database agree, at the cost of at most one early tick that finds nothing due (flows §3.15, §9). |
| Failed sends on the overview | `loadFailedOutbound` shows failed and dropped outbound rows with only the code in front of `outbound.error`, cut in SQL, or `unknown`; it writes a `view` row per family whose rows it returns, with `what` `/admin#failed-outbound`, so each family's copy of the log names the page (§8). |
| Deployed configuration | The bot usernames and the Hyperdrive ids in staging and production (the ids in both `wrangler.jsonc` and `wrangler.admin.jsonc`) are `PLACEHOLDER_` values until the founder creates them; a guess can belong to someone else (`vela.family` is another company's). The hosts and notice URLs are written out, because the workers.dev subdomains are chosen (ADR-26). Outside development each Worker refuses to run while any var or secret contains `PLACEHOLDER_`, anywhere in the value, or while a URL var is not https (`PUBLIC_BASE_URL` and both notice URLs in the pilot Worker, `PUBLIC_BASE_URL` in the admin Worker); the pilot Worker also refuses without the secret `ADMIN_CONVERSATION_ID` and while a privacy notice holds a bracketed blank. `readConfig` and `checkAdminConfig` throw `ConfigError`, whose `code` is the variable's name or the notice's file name, before any connection opens, and the failure is logged as `ConfigError:<variable>` (§9). Development runs on localhost and is not checked. Every caught error the Workers and services log is logged as `errorLabel(error)`, never its message (§2). |
| Hosting | No domain: each deployed Worker has `workers_dev` on, `preview_urls` off, and no routes, and answers on `https://<Worker name>.<account subdomain>.workers.dev`, with the subdomains `vela-light` (production) and `vela-light-staging` (staging). The admin pages are a second Worker, `vela-admin`, from the same package, because Access on a Worker covers all of its hostnames and would close the pilot Worker to Telegram. The founder turns Access on for the whole `vela-admin` Worker; the Worker still verifies the token. `PUBLIC_BASE_URL` is the admin origin in both Workers (ADR-26, §9). |
| Entry modules | An entry module exports only its default handler and, for the pilot Worker, the `MemberScheduler` class: workerd refused to start on the string exports `RECONCILE_CRON` and `NIGHTLY_CRON` beside the handler, which Vitest, not loading the entry as a Worker, did not catch. Handlers and constants live in `pilot-worker.ts` and `admin-app.ts` (§9). |
| Admin Worker ports | The admin Worker builds `AdminDeps` only (database, clock, logger, outbound queue, scheduler, AI). Services still take a whole `Deps`, so `servicesDeps` hands them one whose other ports throw `PortNotGivenError` when touched, never a stub that does nothing; admin code typed on `AdminDeps` cannot reach them at all (§9). |
| Privacy notice pages | The pilot Worker serves the pack's two notices at `/privacy` and `/privacy/zh-TW` from a committed module generated from the Markdown without a dependency; a test fails while the module is stale. Outside development a notice with a bracketed blank other than the quoted `[Name]` and `[名字]` is refused, and so is every deps build of the pilot Worker, so no family ever reads an unfilled notice (§9). |
| Admin chat id | `ADMIN_CONVERSATION_ID` is the founder's personal chat id: a secret of the pilot Worker, never a var in a committed file, and required outside development, because without it every flag, weekly read draft, and answer the re-run could not read would go unannounced (ADR-26). |
| Her summary on a re-run | When a re-run of `understandAnswer` rewrites an answer's summary, the answer's `translations` row in her language is deleted in the transaction that writes the summary, so a job that stops before the new translation leaves her the new summary as stored, never the old one's translation (§8). |

## 11. Definition of done for code

A change is done when `pnpm check` passes locally and in CI, new behaviour has tests that would fail without it, no rule in §2 is broken, and any change to a contract is reflected here and in the architecture document in the same commit.
