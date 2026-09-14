# The Telegram instrument: flows and services design

2026-09-14. The exact behaviour of the phase-0 instrument (spec Appendix A) on the production platform, and the `@vela/services` modules that implement it. Read with `03-code-design.md` (package rules and APIs), `product/05-product-spec-v2.md` (the product), and `plan/materials/pilot/data-map.md` (what is stored, for how long). Every flow names its database effects, the messages it sends, and the events it records; admin flows also name their `admin_access_log` rows.

## 1. Two facts about Telegram that shape the flows

1. **Group privacy mode.** By default a bot in a group receives only commands, replies to its own messages, and messages that mention it. The family's ordinary conversation never reaches Vela, which is the right default. So a family member makes an ask by **replying to the evening prompt** (text, a photo, two photos, or a voice note) or with **`/ask <text>`** for tomorrow and **`/later <text>`** for a whenever ask. Free-text prefixes like `ask:` are not used. Service messages reach every bot whatever its privacy mode (core.telegram.org/bots/features, "Privacy mode"), so Vela sees a group upgrade (§3.3) and someone leaving the group (`left_chat_member`, §3.16) without subscribing to `chat_member`, which would also need the bot to be an administrator.
2. **Reactions need an administrator.** Telegram delivers `message_reaction` updates only when the bot is an administrator of the group. Organisers are told that making Vela an admin lets reactions count; replies always work.

The webhook subscribes to `message`, `callback_query`, `message_reaction`, and `my_chat_member` (`TELEGRAM_ALLOWED_UPDATES`; `left_chat_member` arrives inside `message`). Its secret is 1 to 256 characters of `A-Z a-z 0-9 _ -`, the set Telegram's `setWebhook` accepts.

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
| `zone` | `onboarding.ask_zone`, only for countries with several zones (buttons) or Other (type an IANA name, validated by `isIanaTimeZone`: `UTC` and `Etc/UTC` are accepted; fixed offsets such as `+08:00` and the signed `Etc/GMT±N` and `GMT±N` names are refused) | button or text | `timeZone` |
| `wake` | `onboarding.ask_wake` with buttons 06:00 to 09:00 by half hours | button or `HH:MM` text | `wakeTime` |
| `nearby` | `onboarding.ask_nearby` (tells the organiser to ask the contact themselves first; the number appears in a note only after they say yes) with Skip | "Name +phone" text (up to two), or Skip | `nearby[]` |

The organiser's language comes from Telegram's `language_code` (`zh*` → `zh-TW`, else `en`) and can differ from the kept-light member's. On completion, in one transaction: create `families` (the country picks the preferred region: TW, JP, SG, AU, IN → `apac`; US, CA → `us`; GB, DE and other European countries → `eu`; when the preferred region is not in `Config.regions`, the region is `apac`. The pilot configures only `apac`, so every pilot family is `apac`), the organiser member and link, the kept-light member (`status = invited`, `light_on = false`, `arrival_time = wake + 30 min`, `primary_surface = telegram`), `nearby_contacts` stored unconsented (`consented_at` null: the founder records each contact's yes or no on the admin page, §3.17, and only a contact with a yes is listed in a quiet notice, §3.12), and a single-use `invites` row (token from `Random`, 7-day expiry, `for_member_id` = the kept-light member). Delete the session. Send `onboarding.done` with `https://t.me/<bot>?start=<token>`. Event `family_created`.

A session expires after 24 hours; any unexpected input repeats the current step's prompt. Onboarding buttons use `ButtonAction { type: "onboarding" }`.

### 3.2 Consent (private chat, the kept-light member)

Trigger: `/start <token>`.

- Unknown, expired, or used token: a short "this link is no longer valid, ask the person who sent it" message (new copy key `consent.invalid_link`).
- Otherwise: link the Telegram user to the invite's member (refuse if the user is already linked elsewhere), mark the invite accepted, and send `consent.request` in the member's language with Yes and No buttons (`ButtonAction { type: "consent" }`). `message_refs` purpose `consent`.
- **Yes**: in one transaction insert `consents (kind light, text_version "consent.request@1", lang, channel, evidence {message_id})`, set `light_on`, `light_consented_at`, `status = active`, `light_starts_on = tomorrow (her local date)`, `learning_until = learningUntil(today)`. Close the buttons with the chosen label, send `consent.accepted`, tell each organiser `organiser.consent_given`. Event `consent_given`. Tick the member.
- **No**: record `consent_declined`, send `consent.declined`, tell organisers `organiser.consent_declined`. The member stays `invited` with the light off.
- Only the buttons answer the request. While she is `invited`, before a tap and after a No, anything she writes in the chat, a command included, is ignored: nothing is stored, sent, or posted to the family group (§3.9). The privacy notice promises that nothing is sent if she says no, and the consent script that nothing starts until she taps yes. She opens the link at the end of the founder's call (pilot pack README, step 6), and the consent script has the founder, or the organiser straight after the call, help her tap a button.

### 3.3 Linking the family group

- `bot_added` by a user linked as an organiser whose family has no active group: insert `family_channels (kind group)`, set `families.language` to the organiser's language, post `group.linked` with `{name}` the kept-light member and `{notice}` the privacy notice URL in the family language (`Config.privacyNoticeUrls[families.language]`). The organiser is a turn holder.
- `bot_added` by anyone else, or to a second group: post `group.not_linked` ("Only the family organiser can connect Vela to a group") and do nothing else.
- `bot_removed`: set `unlinked_at`.
- `migrated` (a basic group upgraded to a supergroup, which Telegram does when the bot is made an administrator): update the linked `family_channels.conversation_id` to `migratedToConversationId` and move that conversation's `message_refs` to the new id, in one transaction (`repointFamilyGroup` in `repo.ts`). Without this the family group silently stops working. Telegram posts a notice in both chats, so one move can arrive twice; the second finds the link already moved and changes nothing. A send refused because of the move re-points the group the same way (§3.7).
- `member_left` (someone left the group or was removed): §3.16.

### 3.4 The evening turn prompt (scheduled)

Action `send_turn_prompt(forDate)` from the kept-light member's tick, at 19:00 her local time. It is not due when tomorrow already has an ask: `loadScheduleInput` sets `tomorrow.askScheduled` when a composed exchange is `scheduled_for` tomorrow (a `/ask`), because a prompted holder's ask would only be queued for whenever.

- No linked group: insert the `turns` row with the organiser as holder and `prompted_at`, send nothing (so the schedule does not ask again).
- Otherwise the holder is `nextTurnHolder(active non-kept-light members by join order, previous holder)`. Insert `turns (family, local_day = forDate, recipient, holder) ON CONFLICT DO NOTHING`; enqueue `turn_prompt` to the group (`member_id` = holder, `local_date` = holder's today) with `group.turn_prompt`, or `group.turn_prompt_open` when there is no holder. On send the gateway sets `turns.prompted_at` and `prompt_message_id`, and records `message_refs (purpose turn_prompt, member_id = recipient, local_date = forDate)`. Event `turn_prompt_sent`.

### 3.5 Composing an ask (group)

Triggers: a reply to a `turn_prompt` message (recipient and date from `message_refs`), `/ask <text>` (the family's kept-light member, tomorrow), `/later <text>` (whenever).

When the family has `deleted_at` set, or its kept-light member is `left` or `deceased`, an ask is ignored: nothing is stored and nothing is sent, not even a confirmation. The same holds for replies and reactions (§3.11). Spec §19 promises no automated message of any kind after a death, and a reply to an old turn prompt can arrive for 30 days, while its `message_refs` row lives.

| Content | Exchange |
|---|---|
| text | `question`, `text` |
| voice | `voice_note`, the voice as media |
| one photo, with or without caption | `question` with one image, `text` = caption or null |
| two photos in one album | `photo_choice` with both images, `text` = caption; the second album message joins the exchange created by the first (`options.media_group_id`) |
| more than two photos | the first two |

Media from Telegram is recorded immediately as `media (family, uploaded_by = sender, channel telegram, provider_file_id, provider_unique_id, kind, storage_key null, mime and bytes when Telegram gives them, expires_at = now + 30 days)`; the media queue copies it to R2 later. `provider_unique_id` is Telegram's `file_unique_id`, which the adapter sets for a voice, an audio file, the chosen (largest) photo size, and each album photo. It deduplicates media per family: the insert does nothing on the unique index `(family_id, channel, provider_unique_id)` and the existing row is used, so a file re-forwarded inside one family reuses its row, while another family records its own.

Insert the exchange (`when_rule`, `scheduled_for`, `state composed`, `asker_id` = sender). If the date is taken (the one-per-day index), store it as `whenever` and reply `group.ask_queued`; otherwise reply `group.ask_confirmed`. Set `turns.acted_at`. Event `ask_composed`.

### 3.6 Preparing the morning (scheduled)

Action `prepare(forDate)` at 22:00 her local time. In one transaction: a composed exchange scheduled for that date moves to `scheduled`; otherwise `selectAsk` over her whenever asks moves the oldest to that date; otherwise a `hello` exchange is created (asker null). For a `question`, `ai.chips` drafts three chips into `chips` (failure: no chips, the ask still goes out). Event `exchange_prepared`. The same preparation runs on demand if an arrival is due and nothing was prepared (for example after an outage that skipped the 22:00 wake).

### 3.7 Delivering the arrival (scheduled)

Action `deliver_arrival(date, late)`.

1. Ensure the date is prepared.
2. Read-back: the previous exchange's replies with `to_recipient` and no `read_back_at`, summarised by `summariseReplies` in her language; family voice replies are attached as media before the text.
3. `renderArrival` with her address form, the ask (asker name, on-behalf-of, text, chips, vote options, image count), read-back lines, `late`. The text stays within 4000 characters: read-back lines are shortened first, then the ask text, never the greeting, the asker, or the hint.
4. `enqueueOutbound(kind arrival, member, date, conversation = her chat, exchange, ref purpose arrival)` with the ask's images or voice and the read-back voices as media.

On send, the gateway moves the exchange to `delivered` (`delivered_at` = the send time, `delivery_late`), stamps `read_back_at` on the included replies and moves the previous exchange to `read_back`, records `message_refs`, and wakes her scheduler. Events `arrival_delivered`, `readback_delivered`.

On a permanent failure (or three failed attempts at 5, 15, and 30 minutes), the gateway sets `delivery_failed_at`, sets `channel_links.blocked_at` when Telegram reports a block, tells each organiser `delivery.failed` once, and wakes her scheduler. No quiet event can open for that date. Event `arrival_delivery_failed`.

Before any send, `deliverOutbound` marks a queued row `dropped` without sending it, and records `gateway_dropped`, when the row's family has `deleted_at` set or the family's kept-light member is `left` or `deceased`. A row enqueued before `mark_left` or `mark_deceased` for her, or before `delete_family` (§3.17), or waiting for a retry at 5, 15, or 30 minutes, therefore never goes out afterwards.

A send to the family group (a turn prompt, an answer post, a transcript, a confirmation) can fail because the group became a supergroup: Telegram answers 400 with `parameters.migrate_to_chat_id`, which the adapter reports as `ChannelSendError.migratedToConversationId` (code `invalid_request`). The gateway then re-points the family group exactly as the inbound `migrated` event does (§3.3: `family_channels.conversation_id` and that conversation's `message_refs`, through `repointFamilyGroup`), sets the outbound row's `conversation_id` to the new id in the same transaction, and re-enqueues the send at once without counting an attempt. If the row already addresses the id the error names, the error is a permanent failure, so a send cannot loop.

### 3.8 The repeat (scheduled)

Action `send_repeat(date)`: the same rendering with `repeat = true` and no read-back, `kind repeat`. On send the gateway sets `repeated_at`. Event `repeat_sent`.

### 3.9 Her answer (private chat)

Who reaches this flow: the kept-light member once she has consented (`light_consented_at` set) and while her status is `active` or `paused`. The same gate holds for her commands (§3.13) and her taps on an arrival's buttons; a tap that fails it is acknowledged and otherwise ignored. A message from her in any other state is ignored, whatever it holds: while she is `invited` (before she taps Yes, or after No, §3.2) and once she is `left` or `deceased`, nothing is stored, nothing is sent to her, and nothing is posted to the family group.

Target: her most recent delivered exchange within the last 36 hours that is not archived. If there is none, the message is posted to the group as `group.answer_text` (or her voice) in one `system` outbound keyed by the group conversation with the inbound event id as suffix. No `answers` row is written and nothing lights; event `answer_recorded` carries `unattached: true`. There is no separate copy key for this case.

An answer before the arrival counts for that day (spec §19). A message she sends on a local date before that date's arrival is delivered attaches to the previous exchange, by the rule above, and still counts as that date's answer: `loadScheduleInput` sets each day's `answeredAt` to the earlier of the day's exchange's `answered_at` and her first `answers.received_at` on that local date. The arrival still goes out, and no repeat or quiet notice follows it. A message posted unattached has no `answers` row, so it does not count; that happens only when nothing was delivered in the last 36 hours, such as on her first morning.

Commands come first: `parseParentCommand` (§3.13).

The light path, in one transaction and before anything else:

1. Insert the `answers` row (`kind` from the event; `external_id` = `<conversation_id>:<message_id>`, because Telegram message ids are unique only within a chat, and for a button tap the message that carries the buttons; `payload` with chip, pick, vote, or text; media recorded as in §3.5). A duplicate `(channel, external_id)` ends the flow.
2. Move the exchange to `answered` and set `answered_at` on the first answer.
3. Resolve an open quiet event for that exchange (`outcome answered_late`) and enqueue `quiet_resolved` to everyone who was told.
4. End her open-ended away periods (`to_date` null) whose `from_date` is on or before her local date: `ended_at`, event `away_ended`. An open-ended away lasts until her first answer on or after its start.
5. Event `answer_recorded` (`kind`, latency minutes, type).

Then, outside the transaction:

- Buttons: close them on her message with the chosen label; acknowledge the tap.
- One `ack` per day (`ack.thanks`) through the budget.
- Post to the group, as one `answer_post` outbound keyed by the exchange with the answer id as suffix (one exchange can take several answers, and each is posted): `group.answer_light` (or `group.answer_hello` for a hello or "I'm fine"), followed by the content line (`group.answer_chip`, `group.answer_pick`, `group.answer_vote`, `group.answer_text`), with her voice or photo attached. `message_refs` purpose `answer_post`.
- Voice: enqueue `ingest_answer_media`. Any other kind: enqueue `understand_answer`.
- Tick her schedule.

### 3.10 Understanding (queues)

Both jobs add one to `answers.processing_attempts` when they start for an answer, so a re-run (§3.15) stops after the third attempt. A voice answer whose transcription succeeds spends two attempts on its first run: ingestion, then understanding. A failed transcription ends the run after one, and the re-run goes back to ingestion.

`ingestAnswerMedia(answerId)`: fetch from Telegram, store in R2 at `families/<family>/answers/<answer>.<ext>`, set `media.storage_key`, `mime`, `bytes` (a row already stored, such as a re-forwarded file, is not fetched again); transcribe with `stt` (her language as the hint); store `transcript`, `transcript_lang`; log `ai_calls`; enqueue `understand_answer`. A transcription failure is logged and ends the attempt without a transcript; the voice is still in the group.

`understandAnswer(answerId)`: `ai.understand` (text or transcript, the ask, her last three summaries, her address form, language, and local date) → `summary`, `mood_words`, `mentions`, `away`; `ai.flag` → `flag`, `flag_reason`; translation into the family language when it differs (`translations`, one row per answer and language). `understood_at` is set only when `ai.understand` and `ai.flag` both returned ok; a translation failure does not block it. Post the transcript (and translation) to the group as a reply to the answer post (`group.answer_transcript`, an `answer_post` outbound keyed by the exchange with suffix `<answer id>:transcript`).

A flag sends `flag.notice` with her words verbatim to each organiser (they are family), and `admin.flag` to the admin conversation when configured. `admin.flag` carries only `{family}` (the family name) and `{link}` (the family's admin page, `Config.publicBaseUrl` + `/admin/families/<family id>`), never her words: the admin conversation sits outside `admin_access_log` and retention, and opening the page is logged (§3.17). Both are `kind flag` (the budget's one exception), keyed by the exchange and the reader's conversation with the answer id as suffix. Event `flag_raised`.

A detected `away` inserts `away_periods (source answer, from_date = away.from, to_date = away.until)`, unless an unended period from an answer with the same `from_date` exists, and replies once to her with `away.confirmed` (or `away.confirmed_open` when `until` is null) as a `system` outbound keyed by her conversation with suffix `away:<answer id>`. Services format `{date}` in her language: en "Sunday 21 September"; zh-TW "9月21日（星期日）", with no spaces around it in the sentence. `away.from` is never before her answer's date. Event `away_set`.

Every AI call is logged. Re-runs never duplicate the transcript post, a translation, a flag notice, or the away reply: each is keyed per answer.

### 3.11 Family replies and reactions (group)

- A reply to an `answer_post` message: insert `replies` (`kind` text, voice, or photo; `to_recipient = true`; dedup on `(channel, external_id)`, with `external_id` = `<conversation_id>:<message_id>` as for answers), move the exchange to `replied`. Event `reply_posted`.
- A `message_reaction` on an `answer_post` message: Telegram sends the member's full reaction set; map emoji to `heart` (❤️ ❤ 🥰 😍 👍 🙏), `laugh` (😂 🤣 😄 😆), `hug` (🤗 🫂), and make the member's reaction rows for that exchange equal to the mapped set. Unmapped emoji are ignored.
- Replies and reactions are ignored, as asks are (§3.5), when the family has `deleted_at` set or its kept-light member is `left` or `deceased`.
- Everything else in the group is ignored.

### 3.12 Silence (scheduled and buttons)

- `open_quiet(date, notify)`: insert `quiet_events` for the day's exchange; if `notify`, notify.
- `notify_quiet(date)`: for each active organiser with a Telegram link, enqueue `quiet_notice` (`quiet.notice`, or `quiet.notice_no_usual` when there are fewer answered days than `TUNING.minSamples` (14); times in her local time; `quiet.nearby` listing, as plain text, the names and numbers of her nearby contacts with `consented_at` set and `declined_at` null, and no `quiet.nearby` line when there are none; buttons `quiet_fine` and `quiet_wait`). The idempotency key includes the notify count, so a re-notification after "wait" is a new message. The gateway updates `last_notified_at`, `notify_count`, and `notified_member_ids`. Event `quiet_notice_sent`.
- `quiet_fine`: resolve with `outcome fine_known` and `resolved_by`, close the buttons, tell the other notified organisers `quiet.resolved_fine`. Event `quiet_notice_resolved`.
- `quiet_wait`: set `wait_until = now + 120 min`, close the buttons with `quiet.waiting`, tick her schedule.
- Nothing is ever sent to a nearby contact in the instrument; the organiser calls them.

### 3.13 Stop, start, and what the family sees

- `stop`: `status = paused`, clear the scheduler (its alarm and Durable Object storage, §3.15), send `parent.stopped`, tell organisers `organiser.stopped`. Event `stop_said`.
- `start` (only when paused by her): `status = active`, send `parent.started` with the next arrival time, tick. Event `start_said`.
- `what_family_sees` (the keywords in `PARENT_COMMAND_KEYWORDS`, including 家人看到什麼 and 家人看得到什麼 with their 甚麼 and simplified forms): `parent.family_sees_heading` and the summaries of her last seven answered days, dated, in her language, or `parent.family_sees_empty` in their place when there are none; then, when a weekly read has been sent, the most recent one under `parent.family_sees_weekly_read`, in her language: its `translations` row (`object_type weekly_read`, her language), written when the read was sent (§3.17), or `weekly_reads.sent_lines` as sent when the read was written in her language or no translation exists (the translation failed, or retention deleted it after 30 days). She sees the lines the organisers received, including how many days she answered: spec §13 lets her read the weekly read, and spec §1, principle 5, says she can always see what the family sees about her. `weekly_reads.suggestion` is not part of `sent_lines` and is not shown to her.

### 3.14 The weekly read draft (scheduled)

Action `draft_weekly_read(weekEnd)`: the days of that week on or after `light_starts_on` (a first week counts only the days since the start) with their answers (summaries, answered or not, latency), `ai.weeklyRead` in the family language (`families.language`, set from the linking organiser's language, §3.3) → `weekly_reads` (the fallback read on failure, so the week is still marked done), then a `system` outbound to the admin conversation when configured: `admin.weekly_read_draft` with `{family}` and `{link}` to the family's admin page, never the lines (keyed by the admin conversation with suffix `weekly_read_draft:<weekly read id>`). Event `weekly_read_drafted`. The founder edits the draft on the admin page and taps Send (`send_weekly_read`, §3.17): Vela stores the lines as sent and sends them to each active organiser. The draft page tells the founder that the kept-light member can read the sent lines, in her language, by asking what the family sees (§3.13).

### 3.15 Operations (cron)

- Every 5 minutes, `reconcile`:
  1. Active kept-light members of families without `deleted_at` whose `next_wake_at` is null or more than 10 minutes in the past are ticked; each late one logs `scheduler_missed`.
  2. Answers not yet understood are re-run: those with `understood_at` null, `received_at` between 15 minutes and 24 hours ago, and `processing_attempts` below 3 are re-enqueued, a voice answer without a transcript to `ingest_answer_media` and any other to `understand_answer`. A re-run sends nothing twice (§3.10).
  3. The heartbeat is pinged at the end.
- After the third failed attempt the founder is told once: when `ingestAnswerMedia` ends without a transcript, or `understandAnswer` ends without setting `understood_at`, and `processing_attempts` is 3 or more, the job enqueues `admin.understand_failed` (`{family}` and `{link}` to the family's admin page, no content) as a `system` outbound to the admin conversation keyed with suffix `understand_failed:<answer id>`, so it goes out once however many attempts follow.
- Nightly, `rollupMetrics` writes yesterday's `metrics_daily` row per kept-light member (her local yesterday).
- Nightly, `applyRetention` implements the pilot rules in `plan/materials/pilot/data-map.md` and records event `retention_deleted` with a count per rule:
  - **Cleared at 30 days.** `exchanges.text` and `exchanges.options` 30 days after `delivered_at`; `outbound.payload` 30 days after `sent_at`; and 30 days after the row's own time (`created_at`, `received_at`, `at`, or `opened_at`): `chips` and `translations` (deleted, since those rows hold only text), `replies.text`, the text inside `answers.payload`, `answers.transcript`, `mentions`, `mood_words`, `flag_reason`, `suggestions.text`, `ai_calls.output`, and the reply text inside each `quiet_events.ask_to_check` entry. A cleared NOT NULL column takes its empty value (`''`, `'{}'`, `'[]'`).
  - **Deleted at 30 days.** `message_refs` older than 30 days; `invites` 30 days after `expires_at` or `accepted_at`; `onboarding_sessions` whose `expires_at` has passed.
  - **Media** whose `expires_at` has passed and `kept` is false: the R2 object and the row are deleted, a `deletions` row holds a SHA-256 of the storage key (or of the provider file id when the file was never stored), and the id is removed from `exchanges.media_ids` and `exchanges.options`, which no foreign key covers; the other references are set null by their foreign keys. Every media deletion, including those below, writes a `deletions` row.
  - **Members** 30 days after `left_at`. Rows that only credit them with an act keep the reference set null; rows that exist only because of them (invites they sent or that were meant for them, outbound messages sent on their tap) are deleted with them (`03-code-design.md` §10).
  - **Families** whose `deleted_at` is set, so within 24 hours of the request: the family's media is deleted first as above, so no R2 object outlives its row, then the family and everything that cascades from it.
  - **After 24 months.** `events` (`at`), `metrics_daily` (`day`), `ai_calls` (`at`), and `outbound` (`queued_at`).
  - **Kept** while the family uses Vela: `answers.summary`, the `answers.flag` boolean, and away periods' dates.
- A kept-light member's Durable Object storage is cleared, with its alarm, when she stops (§3.13), is marked left or deceased (§3.17), or is deleted, and when her family's deletion is requested (§3.17). Only kept-light members have a scheduler, so a member who leaves the group (§3.16) has nothing to clear.

### 3.16 Departures (group)

Trigger: `member_left` from a linked group. `subject` is the person who left; `sender` is whoever acted, the same person when they left by themself. The bot's own departure never arrives as `member_left` (it is `bot_removed`, §3.3). In a group that is not linked, nothing happens.

Find the member of that family linked to `subject.externalUserId` on the channel:

- **No link** (someone who never replied in the group, or another bot): nothing is stored or sent.
- **A member with `role = member` who is not the kept-light member**: in one transaction set `status = left`, `left_at` = the event's time, and `turns_in = false`, so the next turn prompt names the next holder. Event `member_left`. Nothing is sent. Retention deletes the member 30 days later (§3.15).
- **An organiser or the kept-light member**: no state changes, and their private chats keep working (arrivals, quiet notices, consent). Event `member_left_group`, and `admin.member_left_group` (`{name}` the member's display name, `{family}` the family name, no content) to the admin conversation when configured, as a `system` outbound keyed with the inbound event id as suffix. If anything should change, the founder does it on the admin page (§3.17).
- **Already `left`**: nothing changes, so a redelivered update or a second report is harmless.

No `admin_access_log` row: nobody opened anything.

**Rejoining.** Vela reads no join messages (the adapter ignores them, `03-code-design.md` §6), so a member who is added back is noticed when they next act. When a linked member with `role = member` who is not the kept-light member, and whose status is `left`, asks, replies, or reacts in the linked group, `resolveGroupSender` sets `status = active`, `left_at` null, and `turns_in = true` in one transaction and records `member_joined` (props `rejoined: true`); the message is then handled as usual. The same applies to a member the founder marked left (§3.17) who takes part again. A member added back who never acts stays `left`, and retention deletes them 30 days after `left_at`; after that, their next message in the group creates a new member (§2).

### 3.17 Admin actions (the admin page)

The founder's admin page is served by the worker under `/admin`, behind Cloudflare Access. Every write is a POST form accepted only with a valid Access JWT and a same-origin request. Each write action is one function in `admin.ts` that checks every id in the form belongs to the family, then in one transaction applies the change, writes one `admin_access_log` row, and records one domain event; a page view writes a `view` row for each family the page shows (table below):

- `admin_access_log`: `admin` = the identity in the Access JWT, `family_id`, `member_id` when the action is about a member (no foreign key: the log is kept 24 months and outlives members), `action` from `ADMIN_ACTIONS`, and `what` = the page path or a detail such as a consent kind or dates. `what` never holds message content, names, or phone numbers.
- Links in admin messages (`admin.flag`, `admin.weekly_read_draft`, `admin.understand_failed`) point to `Config.publicBaseUrl` + `/admin/families/<family id>`, so reading what the message is about always writes a `view` row.

| Action | Database effects | Messages | Event |
|---|---|---|---|
| `view` | Opening a page writes one log row for each family whose records it shows (`what` = the path): the family page one, the overview (which shows states and counts, never content) one per family it lists, so a family asking for its log sees every page that showed its records | none | `admin_page_opened`, one per row |
| `record_consent` | `consents (member_id, kind pilot or privacy_notice, text_version, lang, channel, given_at, evidence)`, with `evidence.recorded_by = founder`; nothing when that member already has that kind and text version | none | `consent_given` (props `kind`) |
| `record_contact_consent` | Yes: `nearby_contacts.consented_at` = the time they said yes, `declined_at` null, and `consents (contact_id, kind nearby, …)`. No: `declined_at`, and `withdrawn_at` on the contact's unwithdrawn `nearby` consents | none | `consent_given` or `consent_declined` (props `kind nearby`) |
| `add_contact` | `nearby_contacts` row, unconsented (`consented_at` null); at most two per kept-light member | none | `nearby_contact_added` |
| `remove_contact` | Delete the contact (its consents cascade) and write a `deletions` row (`object_type nearby_contact`) | none | `nearby_contact_removed` |
| `set_away` | `away_periods (source organiser, set_by = the organiser who asked, from_date, to_date or null)`; tick her schedule | none | `away_set` (props `source organiser`) |
| `end_away` | `ended_at` on that period; tick her schedule | none | `away_ended` |
| `mark_left` | `status = left`, `left_at`, `turns_in = false`; for the kept-light member, her scheduler is cleared | none | `member_left` |
| `mark_deceased` | The kept-light member: `light_on = false`, `status = deceased`, `next_wake_at` null, scheduler cleared; from then the gateway drops the family's queued rows (§3.7), the group's asks, replies, and reactions are ignored (§3.5, §3.11), and her own messages are ignored (§3.9) | none, to anyone | `member_marked_deceased` |
| `delete_family` | `families.deleted_at`; each kept-light member's scheduler cleared; from then `loadScheduleInput` and `reconcile` skip the family, the gateway drops its queued rows (§3.7), the group's asks, replies, and reactions are ignored (§3.5, §3.11), and retention deletes it within 24 hours (§3.15) | none | `family_deletion_requested` |
| `send_weekly_read` | On a read not yet sent, when at least one organiser's outbound row was inserted: `weekly_reads.sent_lines` (the lines as edited) and `sent_at`, written together; otherwise the action is refused and writes nothing (below) | a `weekly_read` outbound (a budgeted kind) to each active organiser with a Telegram link | `weekly_read_sent` |

`send_weekly_read` addresses each outbound row to the organiser (`member_id`, their local day) with the sent lines as its text, keyed by the kept-light member, the week's last date, and the organiser's conversation. A read already sent is not sent again, so a repeated POST changes nothing.

`enqueueOutbound` reports a row the budget index refused as a duplicate, like a repeated key, so a second weekly read for the same organiser on the same local day (the founder catching up a missed week) is not inserted. `sendWeeklyRead` therefore writes `sent_lines` and `sent_at` only when at least one organiser's row was inserted. When none was, because no active organiser has a Telegram link or each already received a weekly read that local day, the transaction is rolled back: nothing is stored, logged, or sent, and the page says why, so the founder can send the read the next day. A read recorded as sent always reached at least one organiser, and "what does the family see" never shows her a read nobody received.

After the transaction, when the family language differs from her language, `sendWeeklyRead` translates the sent lines into her language (`ai.translate`, logged in `ai_calls`) and stores one `translations` row (`object_type weekly_read`, the read's id, her language, the lines joined by line breaks) for §3.13. A failed translation stores nothing, and she sees the lines as sent.

## 4. Foundation amendments this design needs

### 4.1 First round (2026-09-13, done)

| Package | Change |
|---|---|
| `@vela/db` | Migration: `members.light_starts_on date`; `message_refs.member_id uuid NULL` and `message_refs.local_date date NULL`; `media.storage_key`, `mime`, and `bytes` nullable, `media.channel text NULL`, `media.provider_file_id text NULL`, `media.provider_unique_id text NULL`, `CHECK (storage_key IS NOT NULL OR provider_file_id IS NOT NULL)`, unique `(family_id, channel, provider_unique_id)` where `provider_unique_id` is not null, and `media_provider_unique_id_channel_check` (a provider unique id needs its channel, or a null channel would escape the unique index) |
| `@vela/core` | `ScheduleInput.member.startsOn: LocalDate \| null`; no arrival (and so no repeat or quiet) for dates before it; `tuning` uses 14 answered days; no repeat on a failed delivery; `render` uses `arrival.sent_photo` and `arrival.sent_voice` for an ask without text; `summariseReplies` uses `readback.photo` |
| `@vela/copy` | Keys `consent.invalid_link`, `consent.already_linked`, `group.not_linked`, `arrival.sent_photo`, `arrival.sent_voice`, `readback.photo`, `quiet.notice_no_usual`, `away.confirmed`, `help.private`, `admin.flag`; `consent.request` says a quiet note goes to the organiser when a morning goes unanswered (not "by evening") |
| `@vela/adapters` | `botUsername` option; `other` events for unsupported content |
| `@vela/contracts` | `other` in `INBOUND_KINDS` and `ANSWER_KINDS`; `TimeZone` rejects fixed offsets (done) |
| `product/05` | Appendix A: asks by replying to the prompt or with `/ask` and `/later`; reactions need the bot to be an admin (done). The organiser's button is "Ask them to look in" |

### 4.2 Second round (2026-09-14: the foundation review and the sprint 1 contract decisions, done)

| Package | Change |
|---|---|
| `@vela/contracts` | `isIanaTimeZone(name)`, the one time zone rule: IANA names including `UTC` and `Etc/UTC`; fixed offsets and signed `Etc/GMT±N` and `GMT±N` names (N = 0 too) are refused, checked on the name as given and as the runtime resolves it. `TimeZone` refines with it. `INBOUND_KINDS` gains `member_left`, and `InboundEvent.subject?: { externalUserId, displayName? }` names the person who left. `MediaRef.providerUniqueId?`. `ChannelSendError.migratedToConversationId` (and the constructor option). `ADMIN_ACTIONS` and `AdminAction`: `view`, `record_consent`, `record_contact_consent`, `add_contact`, `remove_contact`, `set_away`, `end_away`, `mark_left`, `mark_deceased`, `delete_family`, `send_weekly_read`. `EVENT_NAMES` gains `member_left`, `member_left_group`, `family_deletion_requested`, `nearby_contact_added`, `nearby_contact_removed`, `weekly_read_sent`, `admin_page_opened` |
| `@vela/adapters` | `left_chat_member` in a group or supergroup yields `member_left` (subject = who left, sender = `from`), read before the sender filter so a removal by an anonymous admin or a moderation bot still counts; the bot's own departure yields nothing (matched by username, any letter case). `providerUniqueId` from `file_unique_id` for a voice, an audio file, the largest photo size, and each album photo. An error response carrying `parameters.migrate_to_chat_id` sets `migratedToConversationId` (the code stays `invalid_request`). From the review: a basic group's upgrade yields `migrated`, possibly twice for one move; messages sent on behalf of a chat yield nothing |
| `@vela/copy` | `group.linked` takes `{name, notice}`; `onboarding.ask_nearby` tells the organiser to ask the contact first; `admin.flag` and `admin.weekly_read_draft` take `{family, link}` and carry no content; new `admin.understand_failed` `{family, link}`, `admin.member_left_group` `{family, name}`, and `parent.family_sees_weekly_read`; `parent.family_sees_heading` and `parent.family_sees_empty` no longer say "this week". No key for an unattached answer (§3.9) |
| `@vela/core` | `isValidTimeZone` returns `isIanaTimeZone`; `PARENT_COMMAND_KEYWORDS.what_family_sees` gains 家人看得到什麼, 家人看得到甚麼, and 家人看得到什么. From the review: `ScheduleInput.tomorrow.askScheduled` (no turn prompt when tomorrow already has an ask); `answer_post` keys carry the answer id as suffix; `renderArrival` keeps the text within 4000 characters; yesterday's repeat and quiet are not emitted when today's arrival is delivered in the same decision; the weekly read is drafted only for weeks on or after `startsOn` |
| `@vela/db` | `migrations/0000_init.sql` regenerated (no database exists yet): `answers.processing_attempts smallint NOT NULL DEFAULT 0`; `weekly_reads.sent_lines jsonb` and `sent_at timestamptz` with `weekly_reads_sent_lines_sent_at_check` (both null or both set); `admin_access_log.action text NOT NULL` with `admin_access_log_action_check` over `ADMIN_ACTIONS`, and `admin_access_log.member_id uuid NULL` without a foreign key; `events_name_check` follows `EVENT_NAMES`. From the review: member references are set null or cascade so members who left can be deleted; `turns.holder_id` nullable; `time` columns read as `HH:MM` |
| `product/05` | Appendix A: the founder sends the weekly read from the admin page, and the founder's chat with the bot carries only links; quiet notices list only nearby contacts who said yes |

## 5. `@vela/services` modules

All functions take `deps: Deps` first. Database work that must be atomic runs in `deps.db.transaction`.

```ts
// deps.ts — Deps, its ports (ChannelRegistry and Random included), and Config are defined once, in 03-code-design §8; this file adds the job types:
type OutboundJob = { type: "deliver"; outboundId: string };
type MediaJob = { type: "ingest_answer_media"; answerId: string } | { type: "ingest_exchange_media"; mediaId: string };
type UnderstandJob = { type: "understand_answer"; answerId: string };

// events.ts
recordEvent(db: VelaDatabase | VelaTransaction, event: DomainEvent, at: Date): Promise<void>

// gateway.ts — the only code that calls ChannelAdapter.send
enqueueOutbound(deps, db: VelaDatabase | VelaTransaction, request: OutboundRequest): Promise<{ outboundId: string } | { duplicate: true }>
deliverOutbound(deps, outboundId: string): Promise<"sent" | "retry" | "failed" | "skipped">
  // a send refused with migratedToConversationId re-points the group and re-enqueues at once, attempts unchanged (§3.7)
  // a row whose family has deleted_at, or whose family's kept-light member is left or deceased, is marked dropped unsent: "skipped" (§3.7)
// gateway-effects.ts — the state changes after a send succeeds or fails, by outbound kind (no imports from flow modules)

// repo.ts — shared queries (members by channel user, families by group, organisers with links, exchanges by date, message refs)
repointFamilyGroup(tx: VelaTransaction, channel: Channel, fromConversationId: string, toConversationId: string): Promise<void>  // §3.3 and §3.7
// quiet.ts
openQuiet(deps, memberId, date, notify): Promise<void>
notifyQuiet(deps, memberId, date): Promise<void>
resolveQuietOnAnswer(deps, tx, exchangeId): Promise<void>
handleQuietButton(deps, event, action): Promise<void>

// tick.ts
loadScheduleInput(deps, memberId, now): Promise<ScheduleInput | null>   // a day's answeredAt counts an answer sent before its arrival (§3.9)
tickMember(deps, memberId): Promise<Date | null>     // runs due actions until none remain (bounded), stores next_wake_at, calls scheduler.wakeAt
reconcile(deps): Promise<{ ticked: number; missed: number; rerun: number }>   // late ticks, then the understanding re-run (§3.15)
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
handleMemberLeft(deps, familyId, event): Promise<void>   // group.ts, §3.16
resolveGroupSender(deps, familyId, event): Promise<MemberRow | null>   // creates a member lazily (§2); makes a left member who acts again active (§3.16)
handleGroupAsk(deps, event, target: { familyId: string; recipientId: string; senderId: string; date: LocalDate | null }): Promise<void>
handleAskCommand(deps, event, familyId, senderId): Promise<void>
handleParentCommand(deps, member, command, event): Promise<void>

// answers.ts, replies.ts, pipeline.ts
handleParentMessage(deps, member, event): Promise<void>
handleAnswerButton(deps, member, event, action): Promise<void>
handleGroupReply(deps, familyId, senderId, event, ref): Promise<void>
handleReaction(deps, familyId, senderId, event, ref): Promise<void>
ingestAnswerMedia(deps, answerId): Promise<void>     // both count an attempt; the attempt that fails at 3 or more tells the admin conversation (§3.15)
understandAnswer(deps, answerId): Promise<void>

// admin.ts — one function per ADMIN_ACTIONS entry (§3.17); each write action runs in one transaction, writes one admin_access_log row, and records its event
type AdminContext = { admin: string };               // the identity in the verified Cloudflare Access JWT
adminLink(config: Config, familyId: string): string  // <publicBaseUrl>/admin/families/<family id>, the {link} in admin messages
recordAdminView(deps, ctx: AdminContext, view: { familyIds: string[]; memberId: string | null; what: string }): Promise<void>   // action view: one row and one event per family whose records the page shows; what = the page path
recordConsent(deps, ctx, input: { memberId: string; kind: "pilot" | "privacy_notice"; textVersion: string; lang: Lang; channel: string; givenAt: Date; evidence: Record<string, string> }): Promise<void>
recordContactConsent(deps, ctx, input: { contactId: string; answer: "yes" | "no"; at: Date; textVersion: string; lang: Lang; channel: string; evidence: Record<string, string> }): Promise<void>
addContact(deps, ctx, input: { memberId: string; name: string; phone: string; relation: string | null; channel: (typeof NEARBY_CONTACT_CHANNELS)[number] | null }): Promise<void>
removeContact(deps, ctx, contactId: string): Promise<void>
setAway(deps, ctx, input: { memberId: string; setBy: string; from: LocalDate; until: LocalDate | null }): Promise<void>
endAway(deps, ctx, awayPeriodId: string): Promise<void>
markLeft(deps, ctx, memberId: string): Promise<void>
markDeceased(deps, ctx, memberId: string): Promise<void>
deleteFamily(deps, ctx, familyId: string): Promise<void>
sendWeeklyRead(deps, ctx, input: { weeklyReadId: string; lines: string[] }): Promise<"sent" | "already_sent" | "no_organiser" | "budget">   // the last two refuse the send: nothing stored, logged, or sent, and the page says why (§3.17)

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
| private | `button` | decode: `consent` → `handleConsentButton`; `answer`, `chip`, `pick`, `vote` → `handleAnswerButton` when the sender passes the §3.9 gate, else acknowledge and ignore; `quiet_*` → `handleQuietButton`; `onboarding` → `handleOnboarding`; invalid → acknowledge and ignore |
| private | sender linked to a kept-light member with `light_consented_at` set and status `active` or `paused` | `parseParentCommand` → `handleParentCommand`, else `handleParentMessage` |
| private | sender linked to a kept-light member in any other status (`invited` before consent or after No, `left`, `deceased`) | ignore: nothing stored, sent, or posted (§3.9) |
| private | anything else | `help.private` |
| group | `bot_added` / `bot_removed` | `handleBotAdded` / `handleBotRemoved` |
| group | `migrated` | `handleGroupMigrated` (update the link and message refs) |
| group | not a linked group | ignore |
| group | `member_left` | `handleMemberLeft` (§3.16) |
| group | the family has `deleted_at` set, or its kept-light member is `left` or `deceased` | ignore (§3.5, §3.11) |
| group | `/ask` or `/later` (with or without `@bot`; the adapter keeps the raw text, services strip the mention) | `handleAskCommand` |
| group | reply to a `turn_prompt` message | `handleGroupAsk` |
| group | reply to an `answer_post` message | `handleGroupReply` |
| group | `reaction` on an `answer_post` message | `handleReaction` |
| group | anything else | ignore |

Every handler is idempotent under webhook redelivery: inbound rows dedup on the platform ids, outbound rows on idempotency keys.

The admin actions do not pass through `handleInbound`. The worker serves `/admin` behind Cloudflare Access: each `GET` of a page calls `recordAdminView` before rendering, and each action is a `POST` form that the worker accepts only with a valid Access JWT and a same-origin request, then calls the matching `admin.ts` function.

## 6. Tests that prove the instrument

In `@vela/services`, against the harness:

1. **The loop**: an organiser onboards; the parent consents; the organiser adds the bot to the group; at 19:00 the prompt names the holder; the holder replies with a question; at 22:00 chips are drafted; at 08:00 the arrival goes out with chips; she taps a chip; the group sees her answer; a sibling replies; the next morning's arrival opens with the reply and the reply is marked read back.
2. **Silence**: no answer → the repeat at +150 minutes → the quiet event at T_quiet with the learning period respected → organisers notified with the nearby contacts who said yes → "wait 2 hours" re-notifies once → her late answer resolves it and tells everyone. Answer before the arrival: she writes an hour before her arrival time, the message attaches to the previous day's exchange, the arrival is still delivered, and no repeat and no quiet notice follow that day.
3. **Silence drill**: arrival sends fail three times → one `delivery.failed` notice, no repeat, no quiet event; a blocked chat marks the link; a missed wake (no tick for 3 hours) is caught by `reconcile` and delivered late with the note, exactly once; the AI and STT failing never delays the light or the group post.
4. **Idempotency**: every webhook fixture processed twice changes nothing the second time; two concurrent ticks for one member produce one arrival.
5. **Commands**: stop pauses and clears the schedule; start resumes; "what does the family see" (in English, 家人看到什麼, and 家人看得到什麼) lists the summaries and, once one has been sent, the latest sent weekly read, never a draft; a read written in the family language reaches a kept-light member with another language through its `translations` row, and as sent when the translation failed.
6. **Flags and away**: a flagged answer notifies organisers with her words, and the admin conversation with only the family name and a link; "going to my sister's until Sunday" sets away from `away.from`, suppresses repeats and quiet, and confirms once; an open-ended away ends on her first answer on or after its start.
7. **Retention**: one proof per rule in §3.15, each with a row just inside its window that stays and a row just past it that is cleared or deleted: exchange text and options, chips, translations, reply text, answer payload text, transcripts, mentions, mood words, flag reasons, suggestion text, outbound payloads, AI call output, ask-to-check reply text, message refs, invites, onboarding sessions, media (the R2 object gone, a `deletions` row written, the id gone from `media_ids` and `options`, kept media untouched), members 30 days after leaving, families after `deleted_at` (their media first), and events, daily metrics, AI calls, and outbound rows after 24 months. Summaries, the flag boolean, and away dates stay.
8. **Departures**: a member who leaves the group becomes `left` with `left_at`, and the next turn prompt names the next holder; an organiser or the kept-light member leaving changes no state, keeps their private chat working, records `member_left_group`, and sends `admin.member_left_group` once, with no content; an unlinked user or another bot leaving stores nothing; the same update twice changes nothing; a departure from an unlinked group does nothing; a member who left and then replies in the group is `active` again with `left_at` null and `turns_in` true, and is named in a later turn prompt.
9. **Admin actions**: each of the ten write actions writes exactly one `admin_access_log` row with its `action` and records its event, a page view writes one `view` row per family whose records it shows (the overview one per family listed), and no `what` holds message content, names, or phone numbers; a contact added by onboarding or `add_contact` stays unlisted until `record_contact_consent` records a yes; `mark_deceased` sends nothing to anyone and no further arrival, repeat, quiet notice, or turn prompt follows, and afterwards a reply to an old turn prompt, `/ask`, and an arrival already queued store and send nothing (the queued row is `dropped`); `set_away` suppresses the repeat and the quiet notice and `end_away` restores them; `delete_family` stops ticks and reconcile for the family and drops its queued rows; `send_weekly_read` stores `sent_lines` and `sent_at` and sends one `weekly_read` to each active organiser, a second Send changes nothing, and another week's read sent to the same organisers on the same local day is refused with no `sent_lines`, no log row, and no outbound row.
10. **Understanding re-run**: the fake AI fails `flag` once → `understood_at` stays null → `reconcile` re-runs the answer after 15 minutes → `understood_at` is set; the transcript post, translations, and flag notices each exist once; a voice answer whose transcription failed goes back to ingestion, and one whose transcription fails twice is transcribed on its third ingestion and understood (`processing_attempts` 4) with one transcript post; a text answer whose `flag` fails twice is understood on its third attempt with one flag notice; a voice answer whose understanding fails twice ends at 3 attempts, because its first run counted two, and gets `admin.understand_failed`; an answer that fails three attempts is not re-enqueued again and `admin.understand_failed` goes out once, with no content; a failed translation alone still sets `understood_at`; answers older than 24 hours are left alone.
11. **Nearby consent**: onboarding stores contacts with `consented_at` null; the quiet notice lists only contacts with a yes and without `declined_at`, and has no `quiet.nearby` line when none qualify.
12. **Outbound migration**: a group send answered with 400 and `migrate_to_chat_id` re-points `family_channels` and the group's `message_refs` in one transaction, re-sends to the new id at once with `attempts` unchanged, and a reply to the re-sent message resolves; a second migration error for the same row is a permanent failure; the inbound `migrated` event arriving before or after changes nothing more.
13. **Her messages before consent and after the end**: with the family group linked, a text, a voice message, and "stop" from the kept-light member before she taps Yes, and after she taps No, create no `answers` row, no new outbound row (to her or to the group), and no status change; the same holds once she is marked `left` or `deceased`, and a tap on an old arrival's button then lights nothing.

In `@vela/worker`: the webhook rejects a wrong secret with 401 and hands parsed events to the router; the Durable Object alarm calls the tick and re-arms at the returned time, and clearing the scheduler clears its storage; queue batches dispatch by job type and retry on thrown errors; cron calls reconcile, metrics, and retention; `/admin` refuses a request without a valid Access JWT and a `POST` from another origin, and each page view calls `recordAdminView` with every family whose records it shows.
