# The Telegram instrument: flows and services design

2026-09-13. The exact behaviour of the phase-0 instrument (spec Appendix A) on the production platform, and the `@vela/services` modules that implement it. Read with `03-code-design.md` (package rules and APIs) and `product/05-product-spec-v2.md` (the product). Every flow names its database effects, the messages it sends, and the events it records.

## 1. Two facts about Telegram that shape the flows

1. **Group privacy mode.** By default a bot in a group receives only commands, replies to its own messages, and messages that mention it. The family's ordinary conversation never reaches Vela, which is the right default. So a family member makes an ask by **replying to the evening prompt** (text, a photo, two photos, or a voice note) or with **`/ask <text>`** for tomorrow and **`/later <text>`** for a whenever ask. Free-text prefixes like `ask:` are not used.
2. **Reactions need an administrator.** Telegram delivers `message_reaction` updates only when the bot is an administrator of the group. Organisers are told that making Vela an admin lets reactions count; replies always work.

## 2. Identity

- A Telegram user is linked to at most one member (`channel_links (channel, external_id)` is unique). A person in two families is out of scope for the pilot; the second family's link attempt is refused with a clear message and logged.
- In a private chat the conversation id equals the user id.
- The organiser is a member with `role = organiser`, `billing = true`, and a Telegram link; the kept-light member is a member with a Telegram link and, after consent, `light_on = true`. Neither has a `users` row.
- A group is linked to a family through `family_channels`. Anyone who replies in a linked group is lazily created as a member (`role = member`, name from Telegram, the family's language, the kept-light member's time zone).

## 3. Flows

### 3.1 Organiser onboarding (private chat)

Trigger: `/start` without a parameter from a user with no link, or with an active `onboarding_sessions` row.

| Step | Prompt (copy key) | Accepts | Stores in `data` |
|---|---|---|---|
| `name` | `onboarding.welcome` then `onboarding.ask_name` | text, 1–40 chars | `name` |
| `address` | `onboarding.ask_address` | text, 1–60 chars | `address` |
| `language` | `onboarding.ask_language` with buttons English · 繁體中文 | button | `language` |
| `country` | `onboarding.ask_country` with buttons Taiwan · United States · United Kingdom · Canada · Australia · Singapore · Japan · Germany · India · Other | button | `country` |
| `zone` | `onboarding.ask_zone`, only for countries with several zones (buttons) or Other (type an IANA name, validated) | button or text | `timeZone` |
| `wake` | `onboarding.ask_wake` with buttons 06:00 to 09:00 by half hours | button or `HH:MM` text | `wakeTime` |
| `nearby` | `onboarding.ask_nearby` with Skip | "Name +phone" text (up to two), or Skip | `nearby[]` |

The organiser's language comes from Telegram's `language_code` (`zh*` → `zh-TW`, else `en`) and can differ from the kept-light member's. On completion, in one transaction: create `families` (region from the country: TW, JP, SG, AU, IN → `apac`; US, CA → `us`; GB, DE and other European countries → `eu`), the organiser member and link, the kept-light member (`status = invited`, `light_on = false`, `arrival_time = wake + 30 min`, `primary_surface = telegram`), `nearby_contacts`, and a single-use `invites` row (token from `Random`, 7-day expiry, `for_member_id` = the kept-light member). Delete the session. Send `onboarding.done` with `https://t.me/<bot>?start=<token>`. Event `family_created`.

A session expires after 24 hours; any unexpected input repeats the current step's prompt. Onboarding buttons use `ButtonAction { type: "onboarding" }`.

### 3.2 Consent (private chat, the kept-light member)

Trigger: `/start <token>`.

- Unknown, expired, or used token: a short "this link is no longer valid, ask the person who sent it" message (new copy key `consent.invalid_link`).
- Otherwise: link the Telegram user to the invite's member (refuse if the user is already linked elsewhere), mark the invite accepted, and send `consent.request` in the member's language with Yes and No buttons (`ButtonAction { type: "consent" }`). `message_refs` purpose `consent`.
- **Yes**: in one transaction insert `consents (kind light, text_version "consent.request@1", lang, channel, evidence {message_id})`, set `light_on`, `light_consented_at`, `status = active`, `light_starts_on = tomorrow (her local date)`, `learning_until = learningUntil(today)`. Close the buttons with the chosen label, send `consent.accepted`, tell each organiser `organiser.consent_given`. Event `consent_given`. Tick the member.
- **No**: record `consent_declined`, send `consent.declined`, tell organisers `organiser.consent_declined`. The member stays `invited` with the light off.

### 3.3 Linking the family group

- `bot_added` by a user linked as an organiser whose family has no active group: insert `family_channels (kind group)`, set `families.language` to the organiser's language, post `group.linked` naming the kept-light member. The organiser is a turn holder.
- `bot_added` by anyone else, or to a second group: post `group.not_linked` ("Only the family organiser can connect Vela to a group") and do nothing else.
- `bot_removed`: set `unlinked_at`.
- `migrated` (a basic group upgraded to a supergroup, which Telegram does when the bot is made an administrator): update the linked `family_channels.conversation_id` to `migratedToConversationId` and move that conversation's `message_refs` to the new id, in one transaction. Without this the family group silently stops working.

### 3.4 The evening turn prompt (scheduled)

Action `send_turn_prompt(forDate)` from the kept-light member's tick, at 19:00 her local time.

- No linked group: insert the `turns` row with the organiser as holder and `prompted_at`, send nothing (so the schedule does not ask again).
- Otherwise the holder is `nextTurnHolder(active non-kept-light members by join order, previous holder)`. Insert `turns (family, local_day = forDate, recipient, holder) ON CONFLICT DO NOTHING`; enqueue `turn_prompt` to the group (`member_id` = holder, `local_date` = holder's today) with `group.turn_prompt`, or `group.turn_prompt_open` when there is no holder. On send the gateway sets `turns.prompted_at` and `prompt_message_id`, and records `message_refs (purpose turn_prompt, member_id = recipient, local_date = forDate)`. Event `turn_prompt_sent`.

### 3.5 Composing an ask (group)

Triggers: a reply to a `turn_prompt` message (recipient and date from `message_refs`), `/ask <text>` (the family's kept-light member, tomorrow), `/later <text>` (whenever).

| Content | Exchange |
|---|---|
| text | `question`, `text` |
| voice | `voice_note`, the voice as media |
| one photo, with or without caption | `question` with one image, `text` = caption or null |
| two photos in one album | `photo_choice` with both images, `text` = caption; the second album message joins the exchange created by the first (`options.media_group_id`) |
| more than two photos | the first two |

Media from Telegram is recorded immediately as `media (channel telegram, provider_file_id, provider_unique_id, kind, storage_key null)`; the media queue copies it to R2 later.

Insert the exchange (`when_rule`, `scheduled_for`, `state composed`, `asker_id` = sender). If the date is taken (the one-per-day index), store it as `whenever` and reply `group.ask_queued`; otherwise reply `group.ask_confirmed`. Set `turns.acted_at`. Event `ask_composed`.

### 3.6 Preparing the morning (scheduled)

Action `prepare(forDate)` at 22:00 her local time. In one transaction: a composed exchange scheduled for that date moves to `scheduled`; otherwise `selectAsk` over her whenever asks moves the oldest to that date; otherwise a `hello` exchange is created (asker null). For a `question`, `ai.chips` drafts three chips into `chips` (failure: no chips, the ask still goes out). Event `exchange_prepared`. The same preparation runs on demand if an arrival is due and nothing was prepared (for example after an outage that skipped the 22:00 wake).

### 3.7 Delivering the arrival (scheduled)

Action `deliver_arrival(date, late)`.

1. Ensure the date is prepared.
2. Read-back: the previous exchange's replies with `to_recipient` and no `read_back_at`, summarised by `summariseReplies` in her language; family voice replies are attached as media before the text.
3. `renderArrival` with her address form, the ask (asker name, on-behalf-of, text, chips, vote options, image count), read-back lines, `late`.
4. `enqueueOutbound(kind arrival, member, date, conversation = her chat, exchange, ref purpose arrival)` with the ask's images or voice and the read-back voices as media.

On send, the gateway moves the exchange to `delivered` (`delivered_at` = the send time, `delivery_late`), stamps `read_back_at` on the included replies and moves the previous exchange to `read_back`, records `message_refs`, and wakes her scheduler. Events `arrival_delivered`, `readback_delivered`.

On a permanent failure (or three failed attempts at 5, 15, and 30 minutes), the gateway sets `delivery_failed_at`, sets `channel_links.blocked_at` when Telegram reports a block, tells each organiser `delivery.failed` once, and wakes her scheduler. No quiet event can open for that date. Event `arrival_delivery_failed`.

### 3.8 The repeat (scheduled)

Action `send_repeat(date)`: the same rendering with `repeat = true` and no read-back, `kind repeat`. On send the gateway sets `repeated_at`. Event `repeat_sent`.

### 3.9 Her answer (private chat)

Target: her most recent delivered exchange within the last 36 hours that is not archived. If there is none, the message is posted to the group as `group.answer_text` (or the voice) without lighting anything, and event `answer_recorded` carries `unattached: true`.

Commands come first: `parseParentCommand` (§3.13).

The light path, in one transaction and before anything else:

1. Insert the `answers` row (`kind` from the event; `payload` with chip, pick, vote, or text; media recorded as in §3.5). A duplicate `(channel, external_id)` ends the flow.
2. Move the exchange to `answered` and set `answered_at` on the first answer.
3. Resolve an open quiet event for that exchange (`outcome answered_late`) and enqueue `quiet_resolved` to everyone who was told.
4. Event `answer_recorded` (`kind`, latency minutes, type).

Then, outside the transaction:

- Buttons: close them on her message with the chosen label; acknowledge the tap.
- One `ack` per day (`ack.thanks`) through the budget.
- Post to the group, as one `answer_post` outbound: `group.answer_light` (or `group.answer_hello` for a hello or "I'm fine"), followed by the content line (`group.answer_chip`, `group.answer_pick`, `group.answer_vote`, `group.answer_text`), with her voice or photo attached. `message_refs` purpose `answer_post`.
- Voice: enqueue `ingest_answer_media`. Text: enqueue `understand_answer`.
- Tick her schedule.

### 3.10 Understanding (queues)

`ingestAnswerMedia(answerId)`: fetch from Telegram, store in R2 at `families/<family>/answers/<answer>.<ext>`, set `media.storage_key`, `bytes`, `expires_at` (30 days); transcribe with `stt` (her language as the hint); store `transcript`, `transcript_lang`; log `ai_calls`; enqueue `understand_answer`. A transcription failure is logged; the voice is still in the group.

`understandAnswer(answerId)`: `ai.understand` (text or transcript, her last three summaries, her address form and language) → `summary`, `mood_words`, `mentions`, `away_until`; `ai.flag` → `flag`, `flag_reason`; translation into the family language when it differs (`translations`). Post the transcript (and translation) to the group as a reply to the answer post (`group.answer_transcript`). A flag sends `flag.notice` with her words verbatim to each organiser and the admin conversation (`kind flag`, the budget's one exception). A detected `away_until` inserts `away_periods (source answer)` and replies once to her with `away.confirmed`. Every AI call is logged. Events `flag_raised`, `away_set`.

### 3.11 Family replies and reactions (group)

- A reply to an `answer_post` message: insert `replies` (`kind` text, voice, or photo; `to_recipient = true`; dedup on `(channel, external_id)`), move the exchange to `replied`. Event `reply_posted`.
- A `message_reaction` on an `answer_post` message: Telegram sends the member's full reaction set; map emoji to `heart` (❤️ ❤ 🥰 😍 👍 🙏), `laugh` (😂 🤣 😄 😆), `hug` (🤗 🫂), and make the member's reaction rows for that exchange equal to the mapped set. Unmapped emoji are ignored.
- Everything else in the group is ignored.

### 3.12 Silence (scheduled and buttons)

- `open_quiet(date, notify)`: insert `quiet_events` for the day's exchange; if `notify`, notify.
- `notify_quiet(date)`: for each active organiser with a Telegram link, enqueue `quiet_notice` (`quiet.notice`, or `quiet.notice_no_usual` when there are fewer answered days than `TUNING.minSamples` (14); times in her local time; `quiet.nearby` listing the nearby contacts' names and numbers as plain text; buttons `quiet_fine` and `quiet_wait`). The idempotency key includes the notify count, so a re-notification after "wait" is a new message. The gateway updates `last_notified_at`, `notify_count`, and `notified_member_ids`. Event `quiet_notice_sent`.
- `quiet_fine`: resolve with `outcome fine_known` and `resolved_by`, close the buttons, tell the other notified organisers `quiet.resolved_fine`. Event `quiet_notice_resolved`.
- `quiet_wait`: set `wait_until = now + 120 min`, close the buttons with `quiet.waiting`, tick her schedule.
- Nothing is ever sent to a nearby contact in the instrument; the organiser calls them.

### 3.13 Stop, start, and what the family sees

- `stop`: `status = paused`, clear the scheduler, send `parent.stopped`, tell organisers `organiser.stopped`. Event `stop_said`.
- `start` (only when paused by her): `status = active`, send `parent.started` with the next arrival time, tick. Event `start_said`.
- `what_family_sees`: the summaries of her last seven answered days, dated, in her language; `parent.family_sees_empty` when there are none.

### 3.14 The weekly read draft (scheduled)

Action `draft_weekly_read(weekEnd)`: the days of that week on or after `light_starts_on` (a first week counts only the days since the start) with their answers (summaries, answered or not, latency), `ai.weeklyRead` → `weekly_reads` (the fallback read on failure, so the week is still marked done), then a `system` outbound to the admin conversation (`admin.weekly_read_draft` and the lines) when configured. The founder edits and sends it by hand in the instrument. Event `weekly_read_drafted`.

### 3.15 Operations (cron)

- Every 5 minutes, `reconcile`: active kept-light members whose `next_wake_at` is null or more than 10 minutes in the past are ticked; each late one logs `scheduler_missed`; the heartbeat is pinged at the end.
- Nightly, `rollupMetrics` writes yesterday's `metrics_daily` row per kept-light member (her local yesterday), and `applyRetention` deletes expired media (R2 object and row, with a `deletions` row holding a SHA-256 of the storage key), clears transcripts and text payloads of answers older than 30 days, deletes members who left more than 30 days ago, expired onboarding sessions and invites, and events older than 24 months. Event `retention_deleted` with counts.

## 4. Foundation amendments this design needs

| Package | Change |
|---|---|
| `@vela/db` | Migration: `members.light_starts_on date`; `message_refs.member_id uuid NULL` and `message_refs.local_date date NULL`; `media.storage_key` nullable, `media.channel text NULL`, `media.provider_file_id text NULL`, `media.provider_unique_id text NULL`, `CHECK (storage_key IS NOT NULL OR provider_file_id IS NOT NULL)`, unique `(channel, provider_unique_id)` where not null |
| `@vela/core` | `ScheduleInput.member.startsOn: LocalDate \| null`; no arrival (and so no repeat or quiet) for dates before it; `tuning` uses 14 answered days; no repeat on a failed delivery; `render` uses `arrival.sent_photo` and `arrival.sent_voice` for an ask without text; `summariseReplies` uses `readback.photo` |
| `@vela/copy` | Keys `consent.invalid_link`, `consent.already_linked`, `group.not_linked`, `arrival.sent_photo`, `arrival.sent_voice`, `readback.photo`, `quiet.notice_no_usual`, `away.confirmed`, `help.private`, `admin.flag`; `consent.request` says a quiet note goes to the organiser when a morning goes unanswered (not "by evening") |
| `@vela/adapters` | `botUsername` option; `other` events for unsupported content |
| `@vela/contracts` | `other` in `INBOUND_KINDS` and `ANSWER_KINDS`; `TimeZone` rejects fixed offsets (done) |
| `product/05` | Appendix A: asks by replying to the prompt or with `/ask` and `/later`; reactions need the bot to be an admin (done). The organiser's button is "Ask them to look in" |

## 5. `@vela/services` modules

All functions take `deps: Deps` first. Database work that must be atomic runs in `deps.db.transaction`.

```ts
// deps.ts — ports (see 03-code-design §8) plus:
interface Random { token(bytes?: number): string }                 // base64url
interface ChannelRegistry { get(channel: Channel): ChannelAdapter }
type OutboundJob = { type: "deliver"; outboundId: string };
type MediaJob = { type: "ingest_answer_media"; answerId: string } | { type: "ingest_exchange_media"; mediaId: string };
type UnderstandJob = { type: "understand_answer"; answerId: string };

// events.ts
recordEvent(db: VelaDatabase | VelaTransaction, event: DomainEvent, at: Date): Promise<void>

// gateway.ts — the only code that calls ChannelAdapter.send
enqueueOutbound(deps, db: VelaDatabase | VelaTransaction, request: OutboundRequest): Promise<{ outboundId: string } | { duplicate: true }>
deliverOutbound(deps, outboundId: string): Promise<"sent" | "retry" | "failed" | "skipped">
// gateway-effects.ts — the state changes after a send succeeds or fails, by outbound kind (no imports from flow modules)

// repo.ts — shared queries (members by channel user, families by group, organisers with links, exchanges by date, message refs)
// quiet.ts
openQuiet(deps, memberId, date, notify): Promise<void>
notifyQuiet(deps, memberId, date): Promise<void>
resolveQuietOnAnswer(deps, tx, exchangeId): Promise<void>
handleQuietButton(deps, event, action): Promise<void>

// tick.ts
loadScheduleInput(deps, memberId, now): Promise<ScheduleInput | null>
tickMember(deps, memberId): Promise<Date | null>     // runs due actions until none remain (bounded), stores next_wake_at, calls scheduler.wakeAt
reconcile(deps): Promise<{ ticked: number; missed: number }>
// arrivals.ts
prepareDay(deps, memberId, date): Promise<string>    // exchange id
deliverArrival(deps, memberId, date, late): Promise<void>
sendRepeat(deps, memberId, date): Promise<void>
sendTurnPrompt(deps, recipientId, forDate): Promise<void>
// jobs.ts
draftWeeklyRead(deps, memberId, weekEnd): Promise<void>
rollupMetrics(deps): Promise<number>
applyRetention(deps): Promise<Record<string, number>>

// onboarding.ts, consent.ts, group.ts, asks.ts, parent-commands.ts
handleOnboarding(deps, event): Promise<boolean>
handleInviteStart(deps, event): Promise<void>
handleConsentButton(deps, event, action): Promise<void>
handleBotAdded(deps, event): Promise<void>; handleBotRemoved(deps, event): Promise<void>; handleGroupMigrated(deps, event): Promise<void>
resolveGroupSender(deps, familyId, event): Promise<MemberRow | null>
handleGroupAsk(deps, event, target: { familyId: string; recipientId: string; senderId: string; date: LocalDate | null }): Promise<void>
handleAskCommand(deps, event, familyId, senderId): Promise<void>
handleParentCommand(deps, member, command, event): Promise<void>

// answers.ts, replies.ts, pipeline.ts
handleParentMessage(deps, member, event): Promise<void>
handleAnswerButton(deps, member, event, action): Promise<void>
handleGroupReply(deps, familyId, senderId, event, ref): Promise<void>
handleReaction(deps, familyId, senderId, event, ref): Promise<void>
ingestAnswerMedia(deps, answerId): Promise<void>
understandAnswer(deps, answerId): Promise<void>

// inbound/router.ts
handleInbound(deps, events: InboundEvent[]): Promise<void>   // the routing table below

// testing/harness.ts
createHarness(): Promise<Harness>   // PGlite, a movable clock, in-memory queues, a recording Telegram adapter with failure injection, fake AI and STT, a scheduler that records wake times, an in-memory media store, and run helpers that drain queues and advance time through scheduled wakes
```

Routing table for `handleInbound`:

| Conversation | Condition | Handler |
|---|---|---|
| private | `blocked` / `unblocked` | set or clear `channel_links.blocked_at` |
| private | `start` with a parameter | `handleInviteStart` |
| private | `start` without a parameter, or an active onboarding session | `handleOnboarding` |
| private | `button` | decode: `consent` → `handleConsentButton`; `answer`, `chip`, `pick`, `vote` → `handleAnswerButton`; `quiet_*` → `handleQuietButton`; `onboarding` → `handleOnboarding`; invalid → acknowledge and ignore |
| private | sender linked to a kept-light member | `parseParentCommand` → `handleParentCommand`, else `handleParentMessage` |
| private | anything else | `help.private` |
| group | `bot_added` / `bot_removed` | `handleBotAdded` / `handleBotRemoved` |
| group | `migrated` | `handleGroupMigrated` (update the link and message refs) |
| group | not a linked group | ignore |
| group | `/ask` or `/later` (with or without `@bot`) | `handleAskCommand` |
| group | reply to a `turn_prompt` message | `handleGroupAsk` |
| group | reply to an `answer_post` message | `handleGroupReply` |
| group | `reaction` on an `answer_post` message | `handleReaction` |
| group | anything else | ignore |

Every handler is idempotent under webhook redelivery: inbound rows dedup on the platform ids, outbound rows on idempotency keys.

## 6. Tests that prove the instrument

In `@vela/services`, against the harness:

1. **The loop**: an organiser onboards; the parent consents; the organiser adds the bot to the group; at 19:00 the prompt names the holder; the holder replies with a question; at 22:00 chips are drafted; at 08:00 the arrival goes out with chips; she taps a chip; the group sees her answer; a sibling replies; the next morning's arrival opens with the reply and the reply is marked read back.
2. **Silence**: no answer → the repeat at +150 minutes → the quiet event at T_quiet with the learning period respected → organisers notified with nearby contacts → "wait 2 hours" re-notifies once → her late answer resolves it and tells everyone.
3. **Silence drill**: arrival sends fail three times → one `delivery.failed` notice, no repeat, no quiet event; a blocked chat marks the link; a missed wake (no tick for 3 hours) is caught by `reconcile` and delivered late with the note, exactly once; the AI and STT failing never delays the light or the group post.
4. **Idempotency**: every webhook fixture processed twice changes nothing the second time; two concurrent ticks for one member produce one arrival.
5. **Commands**: stop pauses and clears the schedule; start resumes; "what does the family see" lists summaries only.
6. **Flags and away**: a flagged answer notifies organisers with her words; "going to my sister's until Sunday" sets away, suppresses repeats and quiet, and confirms once.
7. **Retention**: expired media and old transcripts are deleted with proof rows.

In `@vela/worker`: the webhook rejects a wrong secret with 401 and hands parsed events to the router; the Durable Object alarm calls the tick and re-arms at the returned time; queue batches dispatch by job type and retry on thrown errors; cron calls reconcile, metrics, and retention.
