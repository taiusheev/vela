# The LINE channel: flows, adapter, and cost

2026-09-26 · proposed design for build plan 2.3, awaiting the founder's decisions in §9; nothing here is built yet. This document covers four things. First, how the phase-0 instrument of `04-instrument-flows.md` runs when the kept-light member, her organisers and the family group use LINE. Second, what the LINE adapter in `@vela/adapters` does. Third, what services, the two Workers, the admin page and the pilot materials must change. Fourth, what it costs.

Read it with:
- `04-instrument-flows.md`. Any flow this document does not change works exactly as written there.
- `03-code-design.md` §6, §8 and §9.
- ADR-16.
- `02-technical-architecture-v2.md` §8. Its LINE row is corrected here (§7).

**Sources.** LINE's facts were read on 26 September 2026 from:
- the Messaging API reference and docs at developers.line.biz;
- LINE's OpenAPI files (github.com/line/line-openapi);
- LINE for Business Taiwan;
- LINE's terms.

No developers.line.biz page shows a last-updated date, so dated facts come from LINE's news pages. Where LINE says nothing, or two readings of it disagree, this document says so and names the test on the founder's test account that settles it (§9, question 15).

**Who decides what.** Technical choices are made in this document. Every product or legal choice is marked **FOUNDER DECISION** with a recommended default. There are fourteen, D1 to D14, and all of them are collected in §9.

**The photo-asks change is taken as given** (build plan 3.4, `feat/photo-asks`):
- `ChannelAdapter.send(message, files?)`, where `files` maps storage keys to bytes;
- a `MediaRef` that may carry a `storageKey`;
- `MediaStore.head(key)`.

The LINE adapter never reads `files` (§5.5).

## 1. LINE facts that shape the flows

1. **LINE has no group privacy mode.** A bot in a group gets a message event for every message anyone posts. LINE documents no setting that limits this to mentions or replies. Three more group rules:
   - The bot can join groups only after "Allow bot to join group chats" is switched on in the Developers Console. It is off by default.
   - Only one Official Account can be in a group.
   - The person who invites the account must have it as a friend.

   Sources: https://developers.line.biz/en/docs/messaging-api/group-chats/ · https://help2.line.me/official_account_tw/web/pc?lang=zh-Hant&contentId=20011847
2. **Group events do not say who acted.**
   - `join` carries only the group id and a reply token.
   - `leave` and `memberLeft` name no one who acted.
   - In a group, `source.userId` is documented only on message events, and only for users of LINE for iOS or Android. Every LINE account created since April 2020 is one.
   - Whether a postback tapped in a group carries `source.userId` is not documented (question 15).

   Sources: https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects · https://github.com/line/line-openapi/blob/main/webhook.yml · https://developers.line.biz/en/docs/messaging-api/user-consent/
3. **An unverified account cannot list a group's members.** The member-id list answers 403 unless the account is verified or premium. The account can still read any member's profile by user id (`GET /v2/bot/group/{groupId}/member/{userId}`, 404 when that user is not in the group), whether or not the member added or blocked the account. Sources: https://developers.line.biz/en/reference/messaging-api/#get-group-member-user-ids · https://developers.line.biz/en/reference/messaging-api/#get-group-member-profile
4. **Adding the account as a friend carries nothing.**
   - The add-friend URL `https://line.me/R/ti/p/%40<basic id>` passes no parameter.
   - The `follow` event carries a reply token and `follow.isUnblocked`, and LINE says that flag is not guaranteed to be accurate.
   - The `oaMessage` URL `https://line.me/R/oaMessage/%40<basic id>/?<text>` opens the account's chat with the text already typed in the input box. The person must tap Send.
   - LINE does not document what `oaMessage` shows someone who is not yet a friend.
   - LINE's URL schemes do not work in LINE for PC.
   - So the invite link `?ref=token` in `02-technical-architecture-v2.md` §8 does not exist.

   Sources: https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/ · https://developers.line.biz/en/faq/ · https://developers.line.biz/en/reference/messaging-api/#follow-event
5. **Webhook signature.** `x-line-signature` is Base64(HMAC-SHA256(key = the channel secret, message = the request body exactly as received, UTF-8)).
   - Verify it before any parsing. Reformatting the body first breaks it.
   - The header's letter case may change without notice.
   - LINE publishes no source IP addresses.

   Sources: https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/ · https://developers.line.biz/en/reference/messaging-api/#webhooks
6. **Webhook delivery.**
   - A response later than 2 seconds is recorded as `request_timeout`.
   - Redelivery of failed webhooks is off by default. LINE does not disclose how often or how long it retries.
   - Duplicates can arrive even with redelivery off.
   - `webhookEventId` (a ULID) identifies an event and stays the same on redelivery.
   - Events can arrive out of order.
   - `events` may be empty. The console's Verify button sends such a body and expects 200.

   Sources: https://developers.line.biz/en/docs/messaging-api/receiving-messages/ · https://developers.line.biz/en/docs/messaging-api/check-webhook-error-statistics/ · https://developers.line.biz/en/docs/messaging-api/verify-webhook-url/
7. **Replies are free; pushes are billed per person.**
   - A reply token works once, within one minute of receipt. On a redelivered event it works within one minute of the redelivery, but never after the original token was used or 20 minutes after the event. LINE says this limit can change without notice.
   - Replies are not counted against the quota.
   - A push counts once per recipient, and a push to a group counts once per person in it.
   - One request carries at most 5 message objects, and costs the same whether it holds one or five.

   Sources: https://developers.line.biz/en/reference/messaging-api/#send-reply-message · https://developers.line.biz/en/docs/messaging-api/pricing/
8. **Pushes can be made idempotent.** The `X-Line-Retry-Key` header takes a UUID in hexadecimal notation.
   - Push accepts it; reply refuses it with 400.
   - LINE remembers a key for 24 hours.
   - Sending a key again returns 409, with the accepted request's `sentMessages` for a push.
   - A retried request must have exactly the same body.

   Sources: https://developers.line.biz/en/docs/messaging-api/retrying-api-request/ · https://developers.line.biz/en/reference/messaging-api/#retry-api-request
9. **A push to someone who blocked the account answers 200.** It is neither delivered nor counted. The `unfollow` event is the only sign of a block. Source: https://developers.line.biz/en/reference/messaging-api/#send-push-message
10. **Buttons.**
    - Quick replies: up to 13 buttons, labels up to 20 characters counted as grapheme clusters, shown on iOS and Android only. They disappear when one is tapped or when anyone sends a new message in the chat. Only the last message object's quick replies are shown.
    - Postback `data` is up to 300 characters.
    - Postback `displayText` is up to 300 characters and appears in the chat as the tapper's own message.
    - Flex Message buttons take labels up to 40 characters.
    - A postback event does not say which message held the button.

    Sources: https://developers.line.biz/en/docs/messaging-api/using-quick-reply/ · https://developers.line.biz/en/reference/messaging-api/#postback-action · https://developers.line.biz/en/reference/messaging-api/#action-object-label-spec · https://github.com/line/line-openapi/blob/main/webhook.yml (`PostbackEvent`)
11. **Nothing Vela sends can be changed afterwards.** A bot cannot edit or delete its own messages. There are no read receipts and no reaction events. Source: https://developers.line.biz/en/faq/
12. **Quoting and message ids.**
    - `quotedMessageId` appears only on text and sticker message events. Audio events carry neither `quoteToken` nor `quotedMessageId`.
    - Push and reply responses return `sentMessages[].id` in the order sent.
    - Those ids exceed 2^53, so they are treated as strings.
    - That a quote of Vela's message carries the id push returned is implied by LINE's docs, not shown (question 15).

    Sources: https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects · https://developers.line.biz/en/docs/messaging-api/get-quote-tokens/
13. **Downloading what people send.** `GET https://api-data.line.me/v2/bot/message/{messageId}/content` works only when `contentProvider.type` is `line`.
    - It answers 202 while a large audio or video is still being prepared; poll `…/content/transcoding`.
    - It answers 404 for an unknown id and 410 once the sender unsent the message.
    - The format comes from `Content-Type`. The FAQ gives `audio/x-m4a` for audio.
    - Content is deleted after a period LINE does not publish.
    - Text cannot be fetched again after the webhook.
    - `…/content/preview` returns a smaller image.

    Sources: https://developers.line.biz/en/reference/messaging-api/#get-content · https://developers.line.biz/en/faq/#how-can-i-find-out-content-file-format
14. **Sending media.** Media goes out only as an HTTPS URL (TLS 1.2 or later).
    - Audio: mp3 or m4a, up to 200 MB, with `duration` in milliseconds required.
    - Images: JPEG or PNG up to 10 MB, plus a preview image up to 1 MB.
    - LINE does not say how long the URL must stay reachable, or whether it copies the file.

    Sources: https://developers.line.biz/en/reference/messaging-api/#audio-message · https://developers.line.biz/en/reference/messaging-api/#image-message
15. **User ids belong to a provider.** Each provider sees a different id for the same person. Channels cannot move between providers, and an Official Account's provider can never change. Sources: https://developers.line.biz/en/docs/messaging-api/getting-user-ids/ · https://developers.line.biz/en/docs/line-developers-console/best-practices-for-provider-and-channel-management/
16. **Quota and Taiwan's plans.**
    - `GET /v2/bot/message/quota` gives this month's limit. `GET /v2/bot/message/quota/consumption` gives usage so far, which LINE calls approximate.
    - Once the limit is reached, a push answers 429 "You have reached your monthly limit."
    - Plans from 1 November 2026:

      | Plan | Monthly fee | Messages | Extra messages |
      |---|---|---|---|
      | 輕用量 (light) | NT$0 | 200 | none |
      | 中用量 (the repository's "Standard") | NT$1,000 (was NT$800) | 3,000 | **none** |
      | 高用量 (high) | NT$1,400 | 6,000 | NT$0.2 each |

    - Plans cannot be bought or changed from 2026-10-28 08:00 to 11-02, or on 11-24 and 11-25.

    Sources: https://developers.line.biz/en/docs/messaging-api/pricing/ · https://developers.line.biz/en/reference/messaging-api/#get-quota · https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/ (2026-09-01)
17. **Unsends and edits.** LINE sends `unsend` events and recommends making unsent content unusable. Since 12 August 2026 it also sends `messageEdited`, in groups only. Sources: https://developers.line.biz/en/docs/messaging-api/development-guidelines/ · https://developers.line.biz/en/news/2026/08/12/messaging-api-edit-event/
18. **Chat off marks her messages read.** With "Chat" off in Response settings, messages people send show as read at once. The mark-as-read endpoint needs Chat on. Source: https://developers.line.biz/en/docs/messaging-api/mark-as-read/
19. **Recent outages lasted longer than Vela's retries.** The Messaging API answered 5xx for about 4½ hours on 28 July 2026 and about 3¾ hours on 15–16 September 2026. Vela's retry schedule is 5, 15 and 30 minutes. Sources: https://developers.line.biz/en/news/2026/07/28/messaging-api-outage/ · https://developers.line.biz/en/news/2026/09/16/messaging-api-outage/

## 2. Identity and onboarding

### 2.1 The gap

On Telegram an invite is `https://t.me/<bot>?start=<token>`. The token arrives as `/start <token>` in her private chat, and `handleInviteStart` links her and sends `consent.request` (04 §3.1, §3.2). LINE has nothing like it (fact 4).

### 2.2 The candidates

| | (a) Add-friend URL or QR | (b) `oaMessage` pre-filled message | (c) Messaging API account link | (d) LIFF or LINE Login | (e) A code she types |
|---|---|---|---|---|---|
| Carries the invite | No | Yes, as text she sends | Only through a login page of Vela's, and she has no login | Yes, in the path or `state` | Yes |
| Her steps | Tap, Add | Tap the link, tap Send | Add friend, tap a button, a web page, a LINE dialog | Tap, Allow on LINE's permission screen, Add friend | Add friend, then type a code |
| Before she is a friend | Makes her one | Documented that users may message an account they have not added, and Vela may then push to them for 7 days. What the link shows is untested | Fails: she must already be a friend | Adds her as a friend on the consent screen (unchecked by default for Vela, since pre-ticking is for certified providers) | After (a) |
| New LINE setup | None | None | A web page of Vela's | A LINE Login channel that must be Published, which cannot be undone; a LIFF app, which LINE now steers towards LINE MINI App; a second Login channel for the test account | None |
| Consent in her chat, as a free reply | — | Yes | Yes | By push, or as a reply to the follow | Yes |
| Against it | Names no invite | She must tap Send and leave the text alone; not on LINE for PC | Her missing login; a 10-minute token across several hops | A permission screen naming the founder as provider; outside ADR-16's "without LINE Login" | Typing on a Zhuyin keyboard at 70+; a short code invites guessing |

### 2.3 The choice: (b), a `/start` message pre-filled by an `oaMessage` link

**The link.** Her invite link on LINE is `https://line.me/R/oaMessage/<basic id, percent-encoded>/?<"/start <token>", percent-encoded>`. The token is `Random.token()` as today (43 base64url characters) and passes through the URL unchanged.

**What happens when she taps it.**
1. LINE opens Vela's chat with `/start <token>` already typed.
2. She taps Send.
3. The adapter parses that private text as `start` with `startParam`, exactly as Telegram's `/start <param>` (§5.4).
4. Every row of 04 §5 from there on is unchanged: `handleInviteStart`, `consent.invalid_link`, refusing a user already linked elsewhere, and `consent.request`.
5. Her message carries a reply token, so `consent.request` goes out as a free reply (§5.5).

**Why this one.**
- It needs no new LINE channel, no permission screen and no web page. ADR-16 already chose "account linking without LINE Login".
- Consent stays in her private chat, where the evidence of 04 §3.2 is built (§2.5).
- It costs nothing against the quota.
- It reuses the invite token, its single use, its 7-day expiry and its retention exactly.
- (c) cannot identify her without a login she does not have. (d) buys stronger binding for a Published channel, a screen with the founder's name on it, and a LIFF surface LINE is folding into MINI Apps. (e) is hard for her.

**Fallback.**
- If she edits the text or sends something else, nothing links. She taps the link again, as the consent script already has the founder guide her (consent script §6).
- A typed code is not built. It would need a short code table, which means a migration and guessing limits.
- If the test (question 15a) shows that `oaMessage` does not open for a non-friend, the invite instructions lead with the add-friend link, `https://line.me/R/ti/p/<basic id>`, then the start link. The consent script has the founder confirm "Vela Light" is in her friends list before the call ends.
- Why this matters: a push to a non-friend more than 7 days after her last message answers 200 and is not received (fact 9). An arrival that never reached her would then open a quiet event instead of `delivery.failed`.

**What the founder sets up for it:** the account's basic id (`@…`), handed over for `LINE_BOT_BASIC_ID` (§5.10). Nothing else.

### 2.4 Organiser onboarding on LINE (04 §3.1)

**Trigger.** A private text `/start` with no parameter, from a user with no link or with an active onboarding session. The organiser reaches it in one of three ways:
- typing `/start`;
- a link on a Vela page, `https://line.me/R/oaMessage/<basic id>/?%2Fstart`;
- the reply to their `follow` (below).

**The steps** are 04 §3.1's, with LINE's shapes:
- Onboarding buttons are quick replies. The largest list, ten countries, fits LINE's 13.
- Each step answers the organiser's own message, so its prompt goes out as a free reply.
- `onboarding.done` carries the LINE invite link of §2.3.
- Quick replies do not show on LINE for PC. So onboarding on LINE needs the phone app; only the wake step (`HH:MM`) and the zone step (an IANA name) also accept typed answers.

**The organiser's name and language.**
- The name comes from `profile()` (§5.8), which reads LINE's `displayName`.
- The language hint comes from LINE's profile `language`, which LINE omits until the user has accepted LY's privacy policy. `zh*` becomes `zh-TW`, as `languageOfSender` does.
- **FOUNDER DECISION D7.** A LINE user with no language hint is greeted in zh-TW, not English. Recommended: yes, because the LINE market is Taiwan and the `language` step asks anyway.

**`follow`** (a new friend, or someone unblocking) becomes the new kind `followed`:
- A linked user: `blocked_at` is cleared, as `unblocked` does today.
- A user Vela does not know gets `help.followed` as a free reply: "Hello, I'm Vela. If someone in your family sent you an invitation, open it now. To set up Vela for your own family, send /start." This is a new copy key.
- A follow never starts onboarding. Otherwise her own follow, made on the way to her invite, would ask her "What do you call them?".

### 2.5 Her invitation and consent (04 §3.2 on LINE)

**The request.** `handleInviteStart` is unchanged. It sends `consent.request` in two message objects in one reply:
1. the rendered request text as a text message, as on Telegram;
2. a Flex bubble holding the Yes and No buttons.

Buttons that must outlast her typing are never quick replies, which vanish on any new message (fact 10). 04 §3.2 ignores her typing before the tap, so the buttons must stay.

**Evidence, `chatConsentEvidence`, with the same keys as Telegram:**

| Key | Telegram | LINE |
|---|---|---|
| `chat_id` | Her chat | Her LINE user id (the private conversation) |
| `message_id` | The message carrying the buttons, from the event | A postback carries no message id (fact 10). Services take the `external_id` of the outbound row that carried the buttons, found by its idempotency key: `request:<invite id>` for the light, `health_words:<member id>` for the health-words question. That id is the text message's `sentMessages` id (§5.5) |
| `params` | Rebuilt at the tap | Same |
| `text_sha256` | SHA-256 of the rendered text | Same |
| `given_at` | The tap | The postback's own timestamp |
| `channel` | `telegram` | `line` |

`CONSENT_PROOF_KEYS` and the `consents` CHECKs are unchanged. So her consent on LINE proves what it proves on Telegram:
- the text version and the parameters rebuild the exact text;
- the hash shows it is the text she saw;
- the message id names the message it came in.

One difference remains. On LINE the buttons sit in a second bubble directly under the text, delivered in the same request, not in the same bubble. The notice and the consent script say so (§3.4).

**After the tap.**
- The buttons cannot be closed (fact 11).
- The postback's `displayText`, the button's label, shows her choice in the chat as her own message. It replaces "close the buttons, keeping the request's text with the chosen label" of 04 §3.2 (see question 15c).
- A later tap is ignored by the rules that already exist: `consent_button_ignored`, and `health_words_button_ignored` with `already_answered`.
- `consent.accepted` goes out as a free reply. The health-words question, delayed 10 seconds, is a push.
- `consent.declined` goes out through `sendOutsideGateway` with the tap's reply token.

### 2.6 Identity rules on LINE

- A LINE user id is linked to at most one member (`channel_links (channel, external_id)`). A private conversation's id is the user id.
- A member's `primary_surface` is set to the channel of the event that linked them: onboarding, her `/start`, or a lazily created group member. It is no longer the constant `telegram`.
- Flows address people by their messenger link, not by constants (§5.11).
- **FOUNDER DECISION D9.** A family lives on one messenger: her chat, the family group and the organisers' notices all on LINE, or all on Telegram. Mixed families are not supported in the pilot, because Telegram's OGG voice notes cannot be played on LINE and a Worker has no transcoder. Recommended: yes.
- Group members created lazily are named from `profile()` (LINE's `displayName`), falling back to `NAMELESS_MEMBER` if the lookup fails. The picture URL is never stored.
- Staging's and production's accounts must never share ids.
  - **FOUNDER DECISION D1.** Each account gets its own provider, named for the service: "Vela Light" and "Vela Light test", not the founder's own name. A provider is permanent and every user id belongs to it (fact 15). Recommended: yes, decided before `infra/README.md` §8 step 3.
  - Whether a provider made now can later pass to the Singapore entity is open (question 1).

### 2.7 What the founder sets up (`infra/README.md` §8, amended)

On each account, test first:

1. **Provider** per D1.
2. **Developers Console → Messaging API:**
   - "Allow bot to join group chats": on.
   - Webhook URL: `https://vela.vela-light-staging.workers.dev/webhooks/line`, or the production origin. Then "Use webhook": on, and **Verify**, which must answer success.
   - "Webhook redelivery": on. Handlers are idempotent, and it turns Vela's 500 into a retry.
   - "Error statistics aggregation": on.
3. **LINE Official Account Manager → Response settings:** Chat off (**FOUNDER DECISION D8**, recommended: off, so nobody reads her chat in Manager), auto-response off, greeting off. Vela answers `follow` itself.
   - The Taiwan help centre says group invitations need manual chat mode. Whether the bot joins groups with Chat off is question 15f.
4. **The account's profile** links the privacy notice. LINE's API terms, Art. 5.4, require a privacy policy reachable at any time.
5. **Hand over** the basic id, for `LINE_BOT_BASIC_ID`.
6. **Put the secrets** `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` on `vela`:
   - through the setup script's `line` step (§5.10), or `wrangler secret put … --env <environment>`;
   - from Git Bash, or piped in, because the hidden prompt of PowerShell 5.1 has stored a garbled value before (ADR-29 update of 2026-09-25);
   - never pasted into a chat.
7. **The plan**, per D10 (§6).

## 3. The family group on LINE

### 3.1 Linking

`join` names nobody (fact 2), so the Telegram rule "`bot_added` by a user linked as an organiser" (04 §3.3) cannot run. Its LINE equivalent works from who is in the group.

**Rule on `join`.**
1. The group is already linked (the same `join` redelivered): nothing happens.
2. A multi-person chat (`R…` id), which is legacy: refused (below).
3. Otherwise the **candidates** are the active organisers who have an unblocked LINE link, in families that:
   - have no `deleted_at`,
   - have not ended (`familyHasEnded` false),
   - and have no group linked on any channel.
4. For each candidate, newest family first and at most 20, Vela asks `profile(userId, groupId)`, which is LINE's group member profile (fact 3).
   - The cap of 20 keeps the queue job inside the Workers Free plan's 50 subrequests.
   - If there are more than 20 candidates, the join is refused and logged as `group_probe_overflow`, which is the signal to add an explicit claim step.
5. **Exactly one family's organisers are in the group:** the group is linked exactly as 04 §3.3 links it:
   - `family_channels (kind group, linked_by_member_id = that organiser, linked_text_sha256)`;
   - `families.language` set to that organiser's language;
   - `group.linked` with the `notice_read` button, sent as a free reply to the join: a text message, then a Flex bubble holding the button.
6. **None, or organisers of two families:** `group.not_linked` as a free reply, then `leaveConversation` (§5.8). The log `group_link_refused` records the reason: `no_organiser`, `several_families`, `room`, `probe_overflow` or `linked_elsewhere`.

No profile is stored, and no id is logged.

This covers Telegram's other cases too. A second group finds no candidate, because the family already has a group, so it is refused and left. `leave` becomes `bot_removed`, which sets `unlinked_at`. A group re-added after removal is probed again. There are no migrations on LINE.

**FOUNDER DECISION D2.** On LINE a group is linked when an organiser of a family without a group is in it, whoever invited Vela. On Telegram it is when the organiser added the bot.
- The difference: a sibling who is Vela's friend can create the family group with the organiser and add Vela.
- The risk: someone adds Vela to a large group the organiser is in, before the family has its own group. That group then sees `group.linked`, including her name.
- Recommended: accept, because only people who have Vela as a friend can invite it. The alternative is a `/connect` command the organiser types in the group, which adds a step and leaves an unclaimed group receiving messages until then.

**The notice button (04 §3.3, L9).**
- A tap is a group postback. It counts only if LINE names the tapper (question 15b). If not, the adapter drops the tap, and the founder records the `privacy_notice` row with `record_consent` for each adult, as 04 §3.3 already provides for adults who never tap.
- Evidence is `groupNoticeEvidence`, with `message_id` the `external_id` of the `group.linked` outbound row (`linked:<family_channels id>`) and the hash kept on `family_channels`.
- The button is a Flex button, so it stays for the next adult.

### 3.2 What Vela reads, what it drops unread, and what it never keeps

LINE sends Vela everything said in the family group (fact 1). Vela's rule on LINE has three parts.

**First, the adapter decides.** A group or multi-person chat event becomes an `InboundEvent` only when it is one of these:
- `join`, `leave` or `memberLeft`;
- `unsend` (its message id only);
- a postback that names its user;
- a **text** message from a named user that starts with `/` or quotes a message (`quotedMessageId`).

Everything else produces nothing. That includes:
- ordinary text;
- images, audio, video, files and locations;
- stickers;
- edits (`messageEdited`);
- `memberJoined`;
- anything from a user LINE does not name.

`parse` drops each of these before it leaves the adapter. They are never queued and never reach services. Nothing about them is logged: not the text, not the sender, not even that they arrived. No media is ever downloaded from a group.

**Second, services decide.** Of what reaches them, the router keeps only what 04 §5 keeps:
- `/ask` and `/later`;
- a quote of a `turn_prompt` or `answer_post` Vela sent (looked up in `message_refs`);
- a tap on `group.notice_read`;
- departures;
- unsends of messages Vela stored.

Everything else is ignored, as the last row of 04 §5 says, and logged as `group_event_ignored` with its kind only. One consequence: a text quoting another family member's message, or a `/` text meant for something else, passes through the inbound queue and the router before it is discarded. The notice says so.

**Third, the webhook body stays in memory.** It is held only for the signature check and parsing. The route logs no body, header, id or reply token.

### 3.3 How asks, replies and taps are recognised

| What | Telegram (04) | LINE |
|---|---|---|
| Ask by reply | Reply to the turn prompt with text, a photo, two photos or a voice note | Quote the turn prompt (long-press → Reply) with **text**. The adapter sets `replyToMessageId` from `quotedMessageId`, and `message_refs` holds every `sentMessages` id of the prompt |
| `/ask`, `/later` | Commands, with `@bot` optional | The same text. LINE has no command menu |
| Photo or voice ask | Reply with media | **Not offered in the first cut** (D3): media carries no quote (fact 12), so it cannot be tied to the prompt. Photo and voice asks come from the app (build plan 3.4) |
| Family reply | Reply to the answer post with text, voice or photo | Quote the answer post with **text** only (D3) |
| Reaction | `message_reaction` (bot an administrator) | None: LINE sends no reaction events |
| Sticker | Ignored as a reply (`replies.ts`) | Dropped in the adapter (**FOUNDER DECISION D4**: stickers mean nothing to Vela in the first cut; recommended: yes. Mapping stickers to hearts would lean on LINE's experimental, randomised `keywords`) |
| Mention of Vela | Addresses a command | Not read: a text that only mentions Vela is ordinary text and is dropped |
| Edit | Edited messages yield nothing | `messageEdited` is dropped (**FOUNDER DECISION D5**: the original ask or reply stands; recommended: yes) |
| Tap | `callback_query` with the message id | Postback with `data`, no message id (§2.5, §5.4) |

The turn prompt on LINE uses new keys that do not invite media: `group.turn_prompt_text` ("Tomorrow is {holder}'s turn with {name}. Reply to this message with a question.") and `group.turn_prompt_open_text`. Services choose them when the adapter reports `mediaReplies: false` (§5.9).

**FOUNDER DECISION D3.** No photo or voice asks, and no voice or photo replies, in LINE groups in the first cut. Her read-back on LINE is therefore text (`summariseReplies`). Recommended: yes, with the media paths from the app.

### 3.4 What the privacy notice and the data map must say

These are the facts the texts must carry. The founder decides the wording and when the new version starts (**FOUNDER DECISION D11**: recommended, `privacy-notice.v2` and the matching zh-TW version before the first real LINE family, with organisers told 14 days ahead as notice line 109 promises).

**Privacy notice.**
- **The group paragraph (line 54), for LINE:**
  - LINE delivers every message in the family's Vela group to Vela, and Vela cannot ask it to deliver less.
  - Vela's software keeps only replies made with LINE's Reply to its own messages, messages starting with `/ask` or `/later`, and taps on its buttons, and notices when someone leaves the group.
  - Everything else (messages, photos, voice notes, stickers, edits) is discarded as it arrives, before anything else in Vela sees it, without being stored or logged.
  - A text that quotes another person's message is read only to see whether it quotes Vela, then discarded.
- **"What we collect" (lines 31 to 33):**
  - On LINE, the name LINE shows, read from LINE for people who take part.
  - No username.
  - A language only when LINE shares it.
  - No reactions.
- **Providers and storage (lines 97 to 113):**
  - LINE (LY Corporation) carries the messages under its own terms.
  - LINE keeps its own copies of voice notes and photos for a period it does not publish.
  - Vela copies them to Cloudflare R2 at once and deletes its copy after 30 days, as today.
- **Unsend** (per D6): Vela deletes its copy of what was unsent, and cannot remove what it already posted to the group, because LINE lets no bot delete its messages.
- **Consent on LINE** (lines 48, 81, 127): the request is a message with its Yes and No buttons directly beneath it, and the record holds that message's id.

**Data map.**

| Row | Change |
|---|---|
| 4 | LINE user, group and multi-person chat ids; LINE message ids; reply tokens, which ride in `outbound.payload`, are useless after a minute, and are cleared with the payload at 30 days |
| 5 | The evidence's message id comes from the outbound row |
| 6 | Numbers in a LINE organiser's quiet notice sit in their LINE chat |
| 7–15 | Sub-processor LINE added |
| New | The inbound queue holds minimised events (which can include her words) for seconds, and in the dead-letter queue until the founder clears it or the queue's retention ends |
| New | Media URLs are capability links to R2 copies, valid until retention deletes the object |
| Gap 6 | Reopened for LINE |
| Gap 14 | Departures come from `memberLeft` |

**Other pilot materials.**
- **Consent script:** the LINE steps are "tap the link, then Send" (§2.3), and "LINE carries the messages".
- **Organiser agreement, step 3 on LINE:** no administrator, no reactions, and "Vela receives everything said in that group, so keep other family conversation elsewhere".

**FOUNDER DECISION D12.** LY's Taiwan Official Account terms, Art. 8.2, forbid giving user information to any third party without LY's prior written consent. The User Data Policy §3.2.3 limits storing "Friend and Group information" to 24 hours, without defining the term. How Anthropic, Deepgram and Azure as processors, and Vela's stored group and member ids, fit these is not settled. Recommended: ask LY support and the memo's counsel before the first real LINE family, and dogfood on staging meanwhile.

## 4. The flows of `04-instrument-flows.md` §3 on LINE

| 04 | Flow | On LINE |
|---|---|---|
| §1 | Two Telegram facts | Replaced by §1 here |
| §3.1 | Organiser onboarding | **Different:** trigger `/start` text, quick replies, free replies, LINE invite link, name and language from `profile()`; `follow` answered with `help.followed` (§2.4) |
| §3.2 | Consent | **Different:** `/start <token>` via `oaMessage`; request as text plus a Flex bubble; evidence `message_id` from the outbound row; `displayText` instead of closing; free replies (§2.5) |
| §3.3 | Linking the group | **Different:** linked by probing on `join`; refused groups are left; `migrated` does not exist (§3.1) |
| §3.4 | Evening turn prompt | **Same**, with `group.turn_prompt_text`; a push counted once per person in the group |
| §3.5 | Composing an ask | **Different:** text quotes and `/ask`, `/later` only; no media asks (D3) |
| §3.6 | Preparing the morning | **Same** |
| §3.7 | The arrival | **Different in the send** (below) |
| §3.8 | The repeat | **Same**, a push with the same quick replies, counted |
| §3.9 | Her answer | **Different:** keys, the post of her voice or photo after ingestion, a free ack (below) |
| §3.10 | Understanding | **Same**, with ingestion from `api-data.line.me`, photos ingested too, and no quoting of the answer post (below) |
| §3.11 | Replies and reactions | **Different:** text quotes only; no reactions |
| §3.12 | Silence | **Mostly same:** the notice is text plus Flex buttons; `quiet_wait` answered with a reply (below) |
| §3.13 | Stop, start, what the family sees | **Same:** plain words; organiser notices by their messenger link |
| §3.14 | Weekly read draft | **Same:** the admin conversation stays on Telegram (ADR-21); a sent read is a LINE push to each organiser |
| §3.15 | Operations | **Same**, plus the quota snapshot (§6); retention deletes a photo's preview object with the photo |
| §3.16 | Departures | **Different:** `memberLeft`, one event per person, who acted unknown (below) |
| §3.17 | Admin actions | **Mostly same:** `create_invite` and `send_weekly_read` by messenger link; quota shown (below) |
| — | Unsend | **New:** D6 (below) |

**§3.7 The arrival on LINE.**

What goes out: one push to her user id.
- Media objects first, then the text message.
- The quick replies sit on the text, the last object: heart, "I'm fine", and the chips, picks or vote options, at most 9 of LINE's 13.
- Each label is cut to 20 grapheme clusters, and its postback `displayText` is the full label.
- The request carries `X-Line-Retry-Key` (§5.5).

Where the media come from:
- Images: an ask's photos, by R2 URL (after build plan 3.4).
- Audio: m4a or mp3 by R2 URL with its duration. Sources are her own voice re-posted to the group, and later app voice hellos (3.4) and TTS read-backs (2.6, which must render m4a or mp3). A family's Telegram voice note never goes to LINE (D9).
- Media the target channel cannot send is left out and logged `media_unsendable`, and the morning still goes out. That covers a row with only another channel's file id, or no stored copy (§5.11).

Effects, D-B1, the stranded-row re-drive and the drops are unchanged.

Failures:
- **She blocked Vela.** LINE would answer 200 and deliver nothing (fact 9). So the gateway fails a send to a private conversation whose link has `blocked_at` set as `blocked`, without calling LINE: `delivery_failed_at`, `delivery.failed` to each organiser, no quiet event. That is what Telegram's 403 produces.
- **The quota is spent.** The refusal is `quota_exhausted`: retried at 5, 15 and 30 minutes, then failed like any failed send, with `admin.line_quota_exhausted` to the founder once a month (§6).
- **A long LINE outage** (fact 19) fails the arrival after 30 minutes as today. The retry key would make later retries safe; widening the schedule for LINE is left for pilot data.

There is no read receipt, so the ladder counts from delivery, as on Telegram. A webhook delay at LINE (the 28 July 2026 outage delayed webhooks) can make her answer late and open a quiet event. The first cut does not consult LINE's status feed.

**§3.9 Her answer.**
- **Kinds:**
  - text → `text`;
  - audio → `voice`;
  - image → `image`;
  - sticker → `sticker`, whose text is the sticker's own `text` when LINE sends one (message stickers only), else none;
  - video, file, location → `other`;
  - a tap → `button`.
- **`answers.external_id`:** `<her user id>:<LINE message id>` for messages. For a tap, `<her user id>:button:<postback data>`, because a postback has no message id (§5.11). The same button tapped twice, or delivered twice, is one answer.
- **The ack** (`ack.thanks`) goes out as a free reply while her token is fresh, else as a push.
- **The answer post to the group:**
  - For text and taps, it is enqueued at once, as today.
  - For voice and photos, LINE cannot re-send its own files (fact 14). The post is enqueued by `ingestAnswerMedia` once the copy is in R2, with its `storageKey`.
  - The same holds for an unattached message.
- **Unsent before it was copied:** a voice or photo she unsent before the copy was made is never posted (the download answers 410; §5.7).

**§3.10 Understanding.**
- **`ingestAnswerMedia` on LINE:**
  - fetches the content;
  - for a photo, also its preview, stored at the storage key plus `.preview`;
  - stores both in R2;
  - sets `duration_ms` for a voice note from the webhook's `duration`, or when LINE gave none from the m4a header of the stored copy (`mvhd`, a pure function in services);
  - enqueues the answer post;
  - then transcribes voice as today.
- **Ingestion now also runs for photos on LINE** (no transcription). The understanding re-run sends a voice or photo answer whose media has no `storage_key`, on a channel that cannot re-send provider files, back to ingestion.
- **`MEDIA_STORAGE` `off` is refused wherever LINE is on** (§5.10).
- **The transcript and translation post** goes as its own push, not as a reply to the answer post: quoting needs a quote token that Vela does not store.
  - **FOUNDER DECISION D14b.** Merge the transcript into a single answer post on LINE, which saves about 15 group messages per adult a month (§6). Recommended: not now; revisit past six LINE families.

**§3.11 Family replies.** A quote of an `answer_post` with text becomes a `replies` row (`external_id` `<group id>:<message id>`), and the exchange moves to `replied`. There are no reactions. Everything else is §3.2.

**§3.12 Silence.**
- **The notice** goes to each LINE organiser by push:
  - the text as a text message, so a nearby contact's number can be tapped;
  - then a Flex bubble with `quiet_fine` and `quiet_wait`. Flex labels allow 40 characters; "She's fine, I know why" is 22, too long for a quick reply.
- **`quiet_fine`** works as in 04. The tapper sees their own `displayText`.
- **`quiet_wait`** has lost its closing text. Services send `quiet.waiting` with the time as a free reply, because `editMessages` is false (§5.11).
- **The buttons stay.**
  - A tap on a resolved event changes nothing, as today.
  - A second "wait" on an open event moves `wait_until` again. **FOUNDER DECISION D13**: recommended, accept, since each tap is an organiser's deliberate choice.
- **"Nobody to tell"** counts organisers with any unblocked messenger link, not only Telegram.

**§3.16 Departures.**
- `memberLeft` carries `left.members[]` and nobody who acted. The adapter makes one `member_left` per person, with `eventId` `line:<webhookEventId>:<user id>`. The sender is the conversation itself, which is how the contract marks "who acted is unknown" (§5.9).
- `handleMemberLeft` records `removed: null` instead of a guess.
- The rules of 04 §3.16 are unchanged.
- `unfollow` becomes `blocked`, and `leave` becomes `bot_removed`.
- `memberJoined` is dropped: rejoining is noticed when the person next acts, as today.
- **Group changes:** a rename sends nothing. A second Official Account in the group makes LINE remove Vela, which arrives as `leave`.

**§3.17 Admin actions.**
- **Unchanged:** `view`, `record_consent` (with channel `line` where the founder records one), `record_contact_consent`, `add_contact`, `remove_contact`, `set_away`, `end_away`, `mark_left`, `mark_deceased`, `delete_family`.
- **`create_invite`:** needs the asking organiser's messenger link, not specifically a Telegram one, and sends `organiser.invite_again` with the link for that channel. The admin Worker gains `LINE_BOT_BASIC_ID` and nothing else. It still calls no channel.
- **`send_weekly_read`:** goes to each active organiser with an unblocked messenger link.
- **The overview** shows LINE's quota (§6).

**Unsend (new).** **FOUNDER DECISION D6.** When someone unsends a message Vela stored (her answer, a family reply, an ask made by quoting), Vela deletes what it kept of it:
- the R2 object and preview, with a `deletions` row;
- the answer's text and transcript;
- its translations.

The answer row, its light, and the exchange state stay: her answer was still a sign she is there. What Vela already posted to the group stays too, because a bot cannot delete. The unsend is recorded as the event `message_unsent`, which needs migration `0003` (§7). Recommended: yes, built before the first real LINE family. Until then the adapter still emits `unsent`, and the router ignores it and logs `unsend_ignored`.

## 5. The adapter

### 5.1 Module layout (mirroring `src/telegram/`)

```
packages/adapters/src/line/
  adapter.ts     createLineAdapter(options): ChannelAdapter; capabilities; the no-op acknowledgeButton and closeButtons
  client.ts      a typed client for api.line.me and api-data.line.me: push, reply, content, transcoding status, preview,
                 profile, group member profile, leave group or room, quota, consumption; lineErrorOf(response) → ChannelSendError
  verify.ts      LINE_SIGNATURE_HEADER; verifyLineSignature(headers, rawBody, channelSecret)
  parse.ts       parseLineWebhook(rawBody, receivedAt): InboundEvent[]
  send.ts        sendLineMessage(client, message, options); planLineRequests (shapes, labels, chunks); fitLabel
  retry-key.ts   lineRetryKey(idempotencyKey, requestIndex): a v5 UUID
  media.ts       fetchLineMedia(client, messageId), fetchLinePreview(client, messageId)
  quota.ts       readLineQuota(client): ChannelQuota
  testing.ts     a recording fake fetch, fixture loaders, signWebhook(body, secret) for tests
  fixtures/      webhook-*.json (bodies) and api-*.json (responses), below
  *.test.ts      one per module, as Telegram has
```

`src/index.ts` also exports `createLineAdapter`, `LineAdapterOptions` and `LINE_SIGNATURE_HEADER`. The adapters package keeps its single dependency, `@vela/contracts`.

**Fixtures.** They are built from the shapes in LINE's reference examples and `webhook.yml` and signed in the test with a test secret, so no LINE account is needed. They include LINE's own worked signature example:
- body `{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}`;
- secret `8c570fa6dd201bb328f1c1eac23a96d8`;
- signature `GhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs=`, which the research recomputed.

Plan step 8 adds real recordings from the test account beside them (`webhook-recorded-*.json`, with ids replaced).

### 5.2 Construction and capabilities

```ts
createLineAdapter({
  channelSecret, channelAccessToken,
  mediaUrl: (ref: { storageKey: string; mime: string }) => Promise<string>,   // the Worker's signed R2 URL (§5.10)
  fetch?, apiBaseUrl?, dataApiBaseUrl?, now?,
}): ChannelAdapter
```

**Refusals at construction.** It throws on an empty secret or token, and on any whitespace or control character in either, because the token goes into a header. LINE documents no shape for either, so nothing more is checked.

**Capabilities:**

| Capability | Value | Why |
|---|---|---|
| `buttons` | true | |
| `voiceIn` | true | |
| `voiceOut` | true | By URL |
| `readReceipts` | false | |
| `reactions` | false | |
| `albums` | false | Images go as separate objects |
| `editMessages` | false | New: fact 11 |
| `resendsProviderFiles` | false | New: fact 14 |
| `mediaByUrl` | true | New: fact 14 |
| `mediaReplies` | false | New: fact 12 |

Telegram sets the four new ones to `true, true, false, true`.

**Stubs.**
- `acknowledgeButton` resolves and never throws. LINE has nothing to acknowledge, and four flows call it without a catch.
- `closeButtons` resolves; services no longer call it when `editMessages` is false.

**`destination` is ignored.** The signature already binds a body to a channel's secret, and each environment has its own channel.

### 5.3 Webhook verification

`verify({ headers, rawBody })`:
1. Read `headers.get("x-line-signature")`. `Headers` is case-insensitive.
2. Strictly Base64-decode it to exactly 32 bytes; anything else is `false`.
3. Compute HMAC-SHA256 with the channel secret, as UTF-8 bytes, over `TextEncoder().encode(rawBody)`, using Web Crypto. The key is imported once per adapter.
4. Compare the 32 bytes in constant time: no early return, the length folded in, as `constantTimeEqual` does.
5. Any throw returns `false`.

The route reads the body once with `c.req.text()`, as the Telegram route does. LINE sends UTF-8, so re-encoding yields the received bytes. A body that is not valid UTF-8 would decode with replacement characters, re-encode differently and fail verification: the safe direction.

**Tests:**
- LINE's worked example;
- a valid fixture;
- one byte of the body changed;
- whitespace reformatted;
- `\n` rewritten as `\r\n`;
- the wrong secret;
- the header missing, empty, not Base64, or 31 bytes;
- the header's name in three letter cases;
- a body of `{"events":[]}` with a valid signature.

### 5.4 Events (`parse`)

Common to every event:

| Field | Value |
|---|---|
| `channel` | `"line"` |
| `eventId` | `line:<webhookEventId>` |
| `at` | `timestamp` (milliseconds) as ISO |
| `conversation` | A user source → `{ externalId: userId, kind: "private" }`; a group → `{ externalId: groupId, kind: "group" }`; a multi-person chat → `{ externalId: roomId, kind: "group" }` |
| `sender.externalUserId` | `source.userId` |
| `reply` | `{ token: replyToken, until }`, where `until` = min(receipt + 50 s, event time + 19 min). Receipt is the adapter's `now()` at parse. Carried when the event has a reply token |

Rules that apply to the whole body:
- An event with `mode: "standby"` yields nothing; Vela uses no module channel.
- An event of any kind that needs a user and has none yields nothing.
- Malformed JSON, or a body without an `events` array, throws.
- A single event object that fails its own shape is skipped, so it cannot sink the others in the same body.

| LINE event | Source | `InboundEvent` |
|---|---|---|
| `message` text | user | `start` with `startParam` when the text is `^/start(?:[ \t]+([A-Za-z0-9_-]{1,64}))?[ \t]*$`; otherwise `text`. `messageId` = `message.id`; `replyToMessageId` = `quotedMessageId` |
| `message` text | group or room | `text`, only when the text starts with `/` or has `quotedMessageId` (§3.2); otherwise nothing. `/start` in a group stays `text` |
| `message` image | user | `image`, `media { kind: "image", providerFileId: message.id }`, `mediaGroupId` = `imageSet.id`; `other` when `contentProvider.type` is not `line` |
| `message` audio | user | `voice`, `media { kind: "audio", providerFileId, durationMs: duration }`; `other` when not `line` |
| `message` video, file, location | user | `other` |
| `message` sticker | user | `sticker`, `text` = `sticker.text` when present |
| `message` of any content other than the text above | group or room | nothing |
| `messageEdited` | any | nothing (D5) |
| `unsend` | any | `unsent`, `messageId` = `unsend.messageId` |
| `follow` | user | `followed` (`isUnblocked` is not relied on) |
| `unfollow` | user | `blocked` |
| `join` | group or room | `bot_added`; sender is the conversation (§5.9) |
| `leave` | group or room | `bot_removed`; sender is the conversation |
| `memberJoined` | group or room | nothing |
| `memberLeft` | group or room | one `member_left` per member that has a `userId`: `subject` that user, sender the conversation, `eventId` `line:<webhookEventId>:<userId>` |
| `postback` | user | `button`, `buttonData` = `postback.data`, no `messageId`; `params` ignored |
| `postback` | group or room | `button` when `source.userId` is present; otherwise nothing |
| `accountLink`, `beacon`, `membership`, `videoPlayComplete`, module events, `delivery`, any unknown type | — | nothing |

Rules the tests prove:
- every row above;
- a body with two users' events yields both, in order;
- an empty `events` array yields `[]`;
- a redelivered event yields the same `eventId`;
- the `until` arithmetic for a fresh event and for one redelivered 25 minutes after it happened (already past);
- no group fixture of ordinary chat, a photo, a sticker, an edit, or a message without a user yields an event;
- every event yielded passes `InboundEvent.parse`.

### 5.5 Sending

`send(message, files?)` validates with `OutboundMessage.safeParse` and refuses a `to.channel` other than `line`. It never reads `files`.

**Local refusals.** These are `invalid_request`, raised before any network call:
- a media ref with only a `providerFileId`, since LINE cannot re-send by id;
- audio without `durationMs`, or with a MIME type other than m4a (`audio/mp4`, `audio/x-m4a`, `audio/m4a`) or mp3 (`audio/mpeg`);
- an image that is not JPEG or PNG;
- text over 5,000 UTF-16 code units. The contract's 4,000 already keeps within it.

**Message objects.**

Media, in order:
- an image is `{ type: "image", originalContentUrl, previewImageUrl }`. The preview is the original when `bytes` ≤ 1,000,000. Otherwise it is the `.preview` object's URL, which §3.10 guarantees for LINE's own photos and build plan 3.4 must guarantee for app photos by resizing to at most 1 MB;
- audio is `{ type: "audio", originalContentUrl, duration }`;
- URLs come from `options.mediaUrl`, or from `MediaRef.url` until photo-asks lands.

Then the text as `{ type: "text", text }`, and the buttons in one of two shapes:
- **Transient buttons**, used for kinds `arrival`, `repeat`, `onboarding` and any other private message: `quickReply.items` on the text, rows flattened in order, at most 13.
- **Persistent buttons**, used for kinds `consent` and `quiet_notice`, and for any message to a group or multi-person chat (a `C…` or `R…` id): a following Flex bubble whose body is the buttons.
  - Its `altText` is the labels joined by " · ", cut to 1,500 characters.
  - The bubble's JSON is checked under 30 KB.

Every button is a postback action:
- `data` = `Button.id` verbatim (at most 64 ASCII characters, within LINE's 300);
- `displayText` = the full label;
- `label` fitted to 20 grapheme clusters (quick reply) or 40 (Flex) by `fitLabel`, which uses `Intl.Segmenter` and adds an ellipsis.

`replyToMessageId` is ignored: LINE quotes by quote token, which Vela does not keep.

**Requests.** The objects are cut into requests of at most 5, in order, with the buttons on the last.
- Each push carries `X-Line-Retry-Key: lineRetryKey(message.idempotencyKey, index)`. That is a v5 UUID over `"<idempotencyKey>#<index>"` under a fixed namespace constant, `LINE_RETRY_KEY_NAMESPACE`, generated once and never changed. It is SHA-1 through Web Crypto, lowercase hex with dashes.
- The key is a pure function of the outbound row's idempotency key. The body is a pure function of the stored payload, and media URLs carry no time. So a retry of the same row re-sends byte-for-byte the same request, as LINE requires (fact 8).
- Whether LINE accepts a version-5 UUID is not documented; the first live push settles it (question 15h).

**Replies.** With `message.replyToken`, and when the message fits one request, the adapter calls reply with no retry key.
- On 400 (an expired, used or invalid token) it pushes at once, in the same call, with the retry key.
- On 5xx or a timeout it throws `unavailable`. The gateway's retry then comes without the token (§5.11), so the message goes as a push. It can repeat only if the timed-out reply was in fact delivered, which is accepted for the kinds that use replies (§5.11).
- A message of more than one request is always pushed.

**Result.**
- `externalMessageIds` are all `sentMessages[].id` in order, as strings.
- `primaryMessageId` is the text message's id, the one a family member quotes.
- The ids come from a 200, or from a 409's `sentMessages`.

### 5.6 Errors (`ChannelSendError`)

| Response | Code | Retryable | Note |
|---|---|---|---|
| 200 (push or reply) | success | — | |
| 409 on push | success | — | The key was already accepted; ids from the body |
| 400 on reply | — | — | Push in the same call (§5.5) |
| 400 on push | `invalid_request` | no | Includes a user id from another provider |
| 401 | `unavailable` | yes | A wrong or revoked token: retrying gives the founder time to fix it; the row's `error` says `line_auth` |
| 403 | `invalid_request` | no | Plan or verification |
| 404 | `not_found` | no | |
| 413, 415 | `invalid_request` | no | |
| 429 "You have reached your monthly limit." | `quota_exhausted` (new) | yes | LINE says this can be temporary while another delivery reserves quota |
| Other 429 | `rate_limited` | yes | LINE sends no `Retry-After` |
| 5xx, network failure, 10-second timeout, a 2xx without readable `sentMessages` | `unavailable` | yes | The retry key makes a retry safe |
| Anything else | `unknown` | no | |

Error text never contains the token, a URL with a token, a body, or a user id.

### 5.7 Content download (`fetchMedia`, `fetchPreview`)

`fetchMedia(providerFileId)` calls `GET https://api-data.line.me/v2/bot/message/{id}/content`:
- **200:** the bytes and the `Content-Type`'s media type. Over 20 MB it is `invalid_request`, checked on `Content-Length` and on the bytes read.
- **202:** poll `…/content/transcoding` up to three times, 2 seconds apart, then fetch again; still processing is `unavailable`.
- **404 or 410:** `not_found`.
- **400, 401, 5xx:** `unavailable`. On 3 February 2026 content returned 400 for about 1½ hours during an outage.

`fetchPreview(id)` calls `…/content/preview`, for images.

Downloads run in the media job enqueued when the answer arrives. The content is deleted at LINE after an unpublished period, so the design never counts on 30 days there. `FetchedMedia` stays an `ArrayBuffer` under the 20 MB cap.

### 5.8 Profiles, leaving, quota

- **`profile(externalUserId, conversationId?)`** returns `{ displayName?, languageCode? }`, or `null` on 404.
  - With a group id it calls `GET /v2/bot/group/{groupId}/member/{userId}`, which gives the name only.
  - Without one it calls `GET /v2/bot/profile/{userId}`, which gives the name and `language`.
  - Multi-person chats are never asked.
  - Other failures throw `ChannelSendError`, and callers treat them as unknown.
  - The picture URL and status message are never returned.
- **`leaveConversation(id)`** calls `POST /v2/bot/group/{id}/leave` for `C…` and `POST /v2/bot/room/{id}/leave` for `R…`. A 404 counts as done.
- **`quota()`** calls `GET /v2/bot/message/quota` and `GET /v2/bot/message/quota/consumption` and returns `{ limit: type === "limited" ? value : null, used: totalUsage, readAt }`.

Every path is written exactly, with no trailing slash (LINE news of 17 August 2026). The client authenticates with `Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>`, the long-lived token of `infra/README.md` §8. Stateless 15-minute tokens, issued from the channel id and secret, are later hardening and not part of this row.

### 5.9 Contract changes (`packages/contracts/src/adapter.ts`)

- **`INBOUND_KINDS`** gains two kinds:
  - `followed`: a person added the account or unblocked it (LINE `follow`);
  - `unsent`: the sender withdrew the message `messageId`.
- **The sender convention.** `sender` stays required. For `bot_added`, `bot_removed` and `member_left` on a platform that does not say who acted, `sender.externalUserId` equals `conversation.externalId`, and services read that as "unknown". A helper in services, `actorOf(event)`, returns null in that case. Group ids never equal user ids on either platform: Telegram's group ids are negative, LINE's start with `C` or `R`.
- **`InboundEvent.reply?: { token: string; until: string }`**: a free reply handle and the time after which it must not be used.
- **`OutboundMessage.replyToken?: string`**: the adapter replies with it when it can and pushes when LINE refuses it.
- **`AdapterCapabilities`** gains `editMessages`, `resendsProviderFiles`, `mediaByUrl` and `mediaReplies`.
- **`CHANNEL_SEND_ERROR_CODES`** gains `quota_exhausted`, which is retryable.
- **Optional methods on `ChannelAdapter`:** `profile?`, `leaveConversation?`, `quota?` and `fetchPreview?`. They come with the types `ChannelProfile { displayName?; languageCode? }` and `ChannelQuota { limit: number | null; used: number; readAt: string }`.
- **The `Button.id` comment** notes LINE's 300-character postback data. The 64 limit stays.
- **From photo-asks:** `MediaRef.storageKey` and `send(message, files?)`. The LINE adapter uses `storageKey` through `mediaUrl`.

### 5.10 Worker wiring

**Route `POST /webhooks/line`** in `app.ts`:
1. Where `LINE_CHANNEL` is `off`, answer 404 and call nothing.
2. Read `c.req.text()`.
3. Call `channels.get("line").verify` before building deps or opening a database connection. A failure is 401, and LINE is told nothing more.
4. `parse`. With no events (the Verify button's body), answer 200.
5. Otherwise send one job `{ type: "handle_inbound", events }` to `INBOUND_QUEUE` and answer 200.

A throw anywhere answers 500, logged as `request_failed` (path, method and label only), and LINE redelivers because redelivery is on. The route opens no database connection, so it answers well inside LINE's 2 seconds whatever Neon's state. This is the "verify, parse, acknowledge within 1 s, do all work from the queue" rule of `api-contract.md` §9, applied first to LINE. The Telegram route is unchanged.

**Queue `vela-inbound`** (`-staging`, `-production` in the deployed environments):
- consumed by the pilot Worker with `max_batch_size` 10, `max_batch_timeout` 1, `max_retries` 3, `retry_delay` 30, and the environment's dead-letter queue;
- `parseJob` accepts `handle_inbound` only when `events` passes `InboundEvent.array()`, then calls `services.handleInbound(deps, events)`;
- one webhook's events are handled in order in one job, and redeliveries and retries are safe because every handler is idempotent (04 §5).

**Route `GET /media/<base64url(storage key)>/<signature>.<ext>`:**
- The signature is the base64url HMAC-SHA256 of the storage key under `MEDIA_URL_SECRET`, compared in constant time.
- The extension is `m4a`, `mp3`, `jpg` or `png`, from the MIME type.
- It streams the R2 object with its stored `Content-Type` and `cache-control: private`, and passes a `Range` header through to R2.
- A bad signature, a malformed key or a missing object all answer the same 404. Nothing is logged but the status.
- The URL carries no expiry: a LINE retry must send the same body (fact 8), and phones fetch it later (fact 14). It stops working when retention deletes the object at 30 days.

**Registry.** `createChannels(env)` builds Telegram as today, since the admin conversation stays on Telegram (ADR-21). It builds LINE on the first `get("line")`, only when `LINE_CHANNEL` is `on`; otherwise `get("line")` throws "LINE is off in this environment". `mediaUrl` is built from `PILOT_PUBLIC_URL` and `MEDIA_URL_SECRET`.

**Env, secrets and vars:**

| Name | Kind | Holder | Notes |
|---|---|---|---|
| `LINE_CHANNEL_SECRET` | Secret | `vela` | Added to `SecretName`, `env.ts` and `.dev.vars.example` |
| `LINE_CHANNEL_ACCESS_TOKEN` | Secret | `vela` | Same |
| `MEDIA_URL_SECRET` | Secret | `vela` | 32 random bytes, generated by the setup script, never typed |
| `LINE_CHANNEL` | Var | Both Workers | `on` or `off` |
| `LINE_BOT_BASIC_ID` | Var | Both Workers | `@…`; absent where LINE is off |
| `PILOT_PUBLIC_URL` | Var | `vela` | The pilot origin; the fourth URL var `wrangler-config.test.ts` checks against `WORKERS_DEV_SUBDOMAINS` |

`Config` gains `lineBasicId: string | null`, and `AdminDeps` passes it.

**Refusals.** `readConfig` and `checkAdminConfig` throw `ConfigError`:
- for an unknown `LINE_CHANNEL`;
- and, where it is `on`:
  - `MEDIA_STORAGE` `off` (`ConfigError:LINE_CHANNEL`, since LINE media needs the R2 copy);
  - a missing LINE secret or `MEDIA_URL_SECRET`;
  - a `PILOT_PUBLIC_URL` that is not https;
  - a `LINE_BOT_BASIC_ID` that is not `@` followed by non-space characters.

The placeholder rule already refuses `PLACEHOLDER_` values.

**Per environment.**
- **Development:** `off`, since it has no bucket. Tests use fixtures.
- **Staging:** `on`, in the commit after the founder has put the secrets and handed over the test account's basic id, and `vela-inbound-staging` exists.
- **Production:** `off`, pinned by `wrangler-config.test.ts` until an update of ADR-31 turns it on, as `API_V1` is pinned.

**Cron.** In the `RECONCILE_CRON` branch, after `reconcile` (and so after the heartbeat), where LINE is on:

```ts
services.recordChannelQuota(deps, "line", await channels.get("line").quota())
```

It runs in its own try/catch that logs `line_quota_failed` with the label, so a LINE outage never fails reconcile. The admin Worker never calls LINE.

**Setup script.**
- `resources` creates `vela-inbound*`.
- A new step, `line`, puts the two LINE secrets at a hidden prompt and generates and puts `MEDIA_URL_SECRET`.

### 5.11 Services changes

- **Channels by member, not by constant.** Eight Telegram constants are replaced:
  - `arrivals.ts`, `consent.ts`, `parent-commands.ts`, `admin.ts`, `quiet-closing.ts`, `quiet.ts`, `api-asks.ts`, and `primarySurface` in `group.ts`, `invites.ts` and `onboarding.ts`;
  - each is replaced by `messengerLinkOf(db, memberId)`: the member's link on their `primary_surface` when that is a messenger, else their one messenger link;
  - the family's group is its linked group on any channel, and `handleBotAdded` refuses a second group on any channel (D9).
  - `ADMIN_CHANNEL` stays `telegram`. `account-linking.ts` stays Telegram-only; app account linking over LINE is later.
- **Invite links:** `inviteLink(config, channel, token)`, t.me or `oaMessage` (§2.3).
- **Taps without a message id:** `inboundExternalId` keys a `button` event without `messageId` as `<conversation>:button:<buttonData>`.
- **Consent evidence:** `message_id` falls back to the outbound row's `external_id` (§2.5), and `groupNoticeEvidence` does the same (§3.1).
- **Closing buttons:** with `editMessages` false, services skip `closeButtons`, and send `quiet.waiting` as a reply (§4).
- **Gateway:**
  - A `payload.reply` is stored from the event and passed as `replyToken` only on a row's first attempt, and only while `now < until`.
  - Replies are used for `ack`, `help.private`, `help.followed`, `consent.invalid_link`, `consent.already_linked`, `consent.request`, `consent.accepted`, `consent.declined`, onboarding prompts, `group.ask_confirmed`, `group.ask_queued`, `group.linked`, `group.not_linked` and `quiet.waiting`. A second message on one token falls back to a push.
  - A private conversation whose link is blocked fails as `blocked` unsent.
  - `quota_exhausted` sends `admin.line_quota_exhausted` once per month.
  - With `mediaByUrl`, no bytes are loaded.
  - Media refs are built for the target channel: `storageKey` when stored; `providerFileId` only when the media row's channel is the target and the adapter re-sends provider files; otherwise dropped with `media_unsendable`.
- **Router:**
  - `followed`;
  - `bot_added` with an unknown actor goes to the probe (§3.1);
  - `unsent`, per D6;
  - the turn prompt copy chosen by `mediaReplies`.
- **Answers and pipeline:** the post after ingestion, photo ingestion with preview, and duration from the m4a header (§4).
- **Names and language:** `profile()` lookups for the organiser at onboarding (name and language) and for lazily created group members (name), with D7's fallback.
- **Copy:** new keys `help.followed`, `group.turn_prompt_text`, `group.turn_prompt_open_text`, `admin.line_quota` `{used, limit, link}` and `admin.line_quota_exhausted` `{link}`. `consent.already_linked` loses "Telegram" ("This account is already connected to another family on Vela."). The zh-TW texts go to the native reviewer of build plan 2.4.

## 6. Cost

**The monthly loop of one LINE family.** A is the number of adults in the family group; she is not in it, per `onboarding.done`. O is the number of organisers on LINE. The assumptions are a 30-day month, 6 repeat days, 15 voice days and 2 quiet events. Counting is per recipient (fact 7).

| Send | Per month | Billed |
|---|---|---|
| Arrival to her | 30 | 30 |
| Repeat | 6 | 6 |
| Ack, ask confirmation, onboarding and consent messages, `group.linked` | — | 0 while the reply token is fresh (up to 30 more if every ack misses its minute) |
| Turn prompt to the group | 30 | 30 × A |
| Answer post to the group | 30 | 30 × A |
| Transcript or translation post | 15 | 15 × A |
| Weekly read | 4.3 | 4.3 × O |
| Quiet notices and closings | 4 | 4 × O |
| **Total** | | **≈ 36 + 75·A + 8.3·O** |

With O = 1:

| Adults in the group | Billed a month | Families on 中用量 (3,000) | Families on 高用量 (6,000), before NT$0.2 each |
|---|---|---|---|
| 2 | about 194 | 15 | 30 |
| 3 | about 269 | 11 | 22 |
| 4 | about 344 | 8 | 17 |

At three adults, a full 中用量 costs about NT$91 per family-month. The "~NT$12 per parent-month" of `02-technical-architecture-v2.md` §8 counted only her 36 sends. The free 輕用量 (200) cannot carry one real family. The founder's staging dogfood with one adult in the test group comes to about 111 a month, which fits it.

**Unknowns, measured in plan step 8** by reading consumption before and after one group push on the test account:
- whether the Official Account itself counts as a person in the group;
- whether members who blocked the account, or never added it, count.

**Quota tracking.**
- The pilot Worker reads LINE's quota every 15 minutes, after reconcile (§5.10).
- `recordChannelQuota` writes the `flags` row `line_quota` with `{ limit, used, readAt }`. That table exists and is unused, so no migration is needed.
- It sends `admin.line_quota` to the admin conversation once per quota month at 70% and once at 90%, keyed `line_quota:<yyyy-mm, Asia/Taipei>:<threshold>`. LINE does not document the time zone its quota month resets in, so an alert near a month's edge may land in the next month's key.
- `quota_exhausted` sends `admin.line_quota_exhausted` once a month.
- The admin overview shows "LINE: used of limit this month, read at …", or "not read yet". It reads only the `flags` row and writes the usual `view` rows.
- When the quota runs out, replies still work, because they are free. Vela degrades to reply-only by itself, which is what `02-technical-architecture-v2.md` §8 asked of `adapters/line/quota.ts`. An adapter never holds state, so that module does not exist.

**FOUNDER DECISION D10 (the plan).**
- Buy 中用量 only when a real LINE family is scheduled. That needs the founder's explicit yes at the time; Vela buys nothing.
- It cannot be bought from 2026-10-28 08:00 to 11-02 or on 11-24 and 11-25, so for a family starting in early November, buy before 10-28.
- Move to 高用量 at the 70% alert, since 中用量 cannot buy extra messages and a spent quota fails her arrivals.
- Staging stays on the free plan.
- Recommended: yes.

**FOUNDER DECISION D14a.** Keep the turn prompt on LINE (30·A a month). Recommended: keep; revisit at the first 70% alert. The deferred degradation policy is at 90%: drop turn prompts, and keep arrivals, repeats, quiet notices and answer posts.

## 7. Migration and ADR

**No migration is needed** for plan steps 1 to 8:
- Every channel CHECK and unique index already accepts `line` (`CHANNELS`, `SURFACES`, `INVITE_CHANNELS`).
- `consents.channel` and `events.surface` are unchecked.
- LINE ids fit the `text` columns.
- Reply tokens ride in `outbound.payload`.
- The quota snapshot lives in `flags`.
- Consent evidence keeps `CONSENT_PROOF_KEYS`.
- LINE media rows leave `provider_unique_id` null, so LINE has no re-forward dedup, and `media_provider_unique_id_channel_check` is untouched.

One migration comes only with D6: **`0003_message_unsent`**, which regenerates `events_name_check` for the event name `message_unsent`, followed by `pnpm --filter @vela/db export-sql`. It is incremental, since staging already holds `0001` and `0002`.

**ADR text to append.** It is ADR-31. ADR-30, the app's languages, is on `build/sprint-0-1`; if another record lands first, use the next free number.

> ## ADR-31 · LINE: invites by a pre-filled start message, groups linked by an organiser's presence, the family's ordinary group messages dropped in the adapter
> **2026-09-26 · proposed · refines ADR-16 · corrects `02-technical-architecture-v2.md` §8 (LINE row)**
>
> Context: LINE passes nothing from an add-friend link to the webhook, its `join` names nobody, a bot in a group receives every message, a bot cannot edit what it sent, pushes are billed per person in a group, and Taiwan's 中用量 plan cannot buy messages beyond its 3,000 (`05-line-flows.md` §1).
>
> Decision:
> - **Invites.** Her invite is `https://line.me/R/oaMessage/<basic id>/?/start <token>`; the message she sends is parsed as `/start <token>` and every flow after it is Telegram's. No LINE Login, LIFF, or Messaging API account link. Consent is a text message with a Flex bubble of buttons under it; the evidence keeps its keys, `message_id` being the outbound row's LINE id.
> - **Groups.** On `join`, Vela probes the group member profile of each organiser of a family without a group, at most 20; exactly one family present links the group, anything else is refused and left.
> - **Minimisation.** The adapter turns group events into events only for `join`, `leave`, `memberLeft`, `unsend`, named postbacks, and text that starts with `/` or quotes a message; everything else is dropped unread, unqueued, and unlogged. No media asks or replies in LINE groups.
> - **Webhook.** `POST /webhooks/line` verifies the HMAC before anything, parses, enqueues to `vela-inbound`, and answers 200 without touching the database; redelivery is on.
> - **Sending.** Push carries `X-Line-Retry-Key`, a v5 UUID of the outbound row's idempotency key and request index, and a 409 is success; replies use the event's token while fresh and fall back to push. Media goes by signed, non-expiring URLs to R2 copies on the pilot Worker, so LINE needs `MEDIA_STORAGE` `r2`; LINE content is copied when it arrives.
> - **Quota.** The pilot Worker snapshots LINE's quota into `flags` every 15 minutes; the admin overview shows it; the founder hears at 70%, 90%, and exhaustion; `quota_exhausted` is its own error code.
> - **Switch.** `LINE_CHANNEL` is `on` in staging and `off` in production until an update of this record; one messenger per family.
>
> Why: it is the only path that needs no new LINE channel, keeps consent and its evidence in her own chat, costs nothing against the quota, and reuses the invite token as it is; the probe gives the organiser rule without a claim step; dropping in the adapter keeps the family's conversation out of the queue, the database, and the logs; queue-first meets LINE's 2 seconds whatever Neon's state; the retry key turns every ambiguous push into a safe retry.
>
> Rejected: `?ref=` on the add-friend link (does not exist); LIFF or LINE Login (a Published channel that cannot be unpublished, a permission screen naming the founder, LIFF being folded into MINI Apps); the account-link API (needs a login she lacks); a typed code (hard at 70+; a code table); a `/connect` command in the group (an extra step, and an unclaimed group receiving messages meanwhile); processing inside the webhook request (Neon's cold start against 2 seconds); expiring media URLs (a retry must re-send the same body, and phones fetch later); quick replies for consent and quiet notices (they vanish on any new message).
>
> Consequences: three new secrets on `vela` and one queue per environment; the adapter contract gains two inbound kinds, reply handles, four capabilities, one error code, and four optional methods; every flow addresses members by their messenger link; the privacy notice needs a new version before a real LINE family; 中用量 carries about 11 families of three adults.
>
> Revisit if: LINE adds a privacy mode, a referral on follow, or group postbacks without users; the probe overflows; quota passes 70% twice; or the entity forms (a new provider means new user ids).

## 8. Implementation plan

Each step lands alone through `build/sprint-0-1`, with `pnpm check` green. Steps 1 to 7 need nothing from the founder.

1. **The contract.**
   - Files:
     - `packages/contracts/src/adapter.ts` and its test (§5.9);
     - `packages/adapters/src/telegram/adapter.ts`, the new capabilities;
     - `packages/services/src/inbound/router.ts`, where `followed` and `unsent` are ignored for now;
     - `03-code-design.md` §6.
   - Tests:
     - schemas accept and refuse `reply`, `replyToken` and the new kinds;
     - `quota_exhausted` is retryable;
     - Telegram's capabilities;
     - the whole suite unchanged.
   - Founder: nothing.
2. **The LINE adapter: verification and events.**
   - Files: `packages/adapters/src/line/{verify,parse,testing}.ts`, `fixtures/webhook-*.json`, tests, `index.ts`.
   - Tests: §5.3 and §5.4, with no LINE account.
   - Founder: nothing.
3. **The LINE adapter: sending, errors, media, profiles, quota.**
   - Files: `line/{client,send,retry-key,media,quota,adapter}.ts`, `fixtures/api-*.json` (push 200 and 409; reply 200 and 400; 400, 401, 403, 404, 413, 429 monthly, 429 rate, 500; content 200, 202→200, 404, 410; profile 200 and 404; quota), tests.
   - Tests, through a recording fake `fetch`:
     - the request shapes per kind and conversation;
     - quick replies only on the last object;
     - labels fitted by grapheme with the full `displayText`;
     - chunks over 5, each with its own key;
     - two sends of one message byte-identical, key included;
     - no retry key on reply, and push after a reply's 400;
     - 409 read as success;
     - every row of §5.6;
     - local refusals made before any call;
     - 202 polling, the 20 MB cap, `profile` returning null on 404.
   - Founder: nothing.
4. **Services: channels by member, Telegram unchanged.**
   - Files: the eight modules of §5.11's first item, `repo.ts`, `invites.ts`, `deps.ts` (`Config.lineBasicId`), `testing/harness.ts` (several channels), and a new `testing/fake-line.ts` with LINE's capabilities, reply and push recorded apart, settable profiles and quota.
   - Tests:
     - the existing suite unchanged;
     - a family whose members all link on the fake LINE channel gets arrivals, repeats, quiet notices, turn prompts, weekly reads and invite links on LINE;
     - a second group on another channel is refused.
   - Founder: nothing.
5. **Services: LINE behaviour.**
   - Files: `format.ts`, `consent.ts`, `group.ts` (the probe and `actorOf`), `quiet.ts`, `gateway.ts`, `gateway-effects.ts`, `arrivals.ts`, `answers.ts`, `pipeline.ts`, `inbound/router.ts`, `packages/copy` (new keys, en and zh-TW drafts).
   - Tests on the fake LINE channel:
     - 04 §6 test 1, the loop, end to end;
     - consent evidence with `message_id` from the outbound row and a hash equal to the rendered request;
     - a double tap is one answer;
     - the probe: one family, none, two families, the cap, a room, the same group again;
     - `followed` for a stranger and for a linked member;
     - a blocked link fails the arrival unsent with one `delivery.failed` and no quiet event;
     - a reply used while fresh, a push after `until`, a push on retry;
     - `quota_exhausted` retried, then failed, with one founder alert;
     - her voice posted only after its copy, with its duration;
     - a photo stored with its preview;
     - `quiet.waiting` sent as a reply;
     - every LINE fixture handled twice changes nothing the second time (04 §6 test 4).
   - Founder: the zh-TW reviewer for the new keys (build plan 2.4).
6. **The Worker.**
   - Files:
     - `apps/worker/src/{app,deps,config,env,pilot-worker,runtime}.ts` and a new `media-route.ts`;
     - `wrangler.jsonc` and `wrangler.admin.jsonc`, with LINE off everywhere in this step;
     - `.dev.vars.example`, `scripts/setup-environment.ts`, `testing/fakes.ts`, `wrangler-config.test.ts`.
   - Tests in workerd:
     - a tampered, missing or wrong-secret signature is 401 with no deps built;
     - LINE off means 404 and no call;
     - Verify's empty body is 200 with nothing queued;
     - events go to `INBOUND_QUEUE`, and the consumer calls `handleInbound`, with an unreadable job acked and logged;
     - the media route: a good signature streams, with `Range`; a bad one, or a missing object, is 404;
     - each config refusal of §5.10;
     - production pinned `off`;
     - the quota cron runs after reconcile, and its failure is logged without failing the run.
   - Founder: nothing.
7. **Quota in admin.**
   - Files: `packages/services/src/quota.ts` (`recordChannelQuota`), `admin.ts` (`loadAdminOverview` reads `line_quota`), `apps/worker/src/admin-pages.ts`.
   - Tests:
     - the snapshot is written;
     - alerts at 70% and 90%, each once a month;
     - the overview shows used, limit and time, or "not read yet";
     - no page shows anything else of LINE.
   - Founder: nothing.
8. **The staging loop: build plan 2.3's definition of done.**
   - Founder:
     - D1;
     - §2.7 steps 1 to 6 on the test account;
     - a 30-minute session with the co-founder to run the tests of question 15 on his phone and in a test group.
   - Co-founder:
     - the commit that turns staging `on`, then the deploy;
     - real fixtures recorded;
     - any adapter correction the answers call for.
   - Proof: the founder's test account completes 04 §6 test 1 on LINE, and the admin overview shows the quota.
9. **Unsend (D6).**
   - Files: migration `0003_message_unsent` and the regenerated `schema.sql`, `packages/contracts/src/events.ts`, a `handleUnsend` in services.
   - Tests:
     - an unsent answer loses its object, text, transcript and translations, and keeps its light;
     - an unsent reply loses its text;
     - an unsent message Vela never stored changes nothing;
     - the `deletions` rows.
   - Founder: the D6 decision.
10. **Pilot materials and docs.**
    - Files:
      - the privacy notice v2 in both languages, the data map, the consent script, the organiser agreement, the pilot README (§3.4), then the regenerated notices;
      - `infra/README.md` §8 (§2.7) and `infra/sub-processors.md`;
      - the LINE row of `02-technical-architecture-v2.md` §8;
      - `api-contract.md` §9 and §12;
      - `architecture/research/channels-and-voice.md`, whose Japan plan names and three-button template are outdated;
      - ADR-31.
    - Founder: D11, D12, and the 14-day notice to organisers.
11. **Production on.**
    - An ADR-31 update.
    - Founder: D10 (the purchase, with an explicit yes); §2.7 on the production account; secrets.
    - Co-founder: the switch commit and a tagged deploy.

## 9. Open questions for the founder

1. **Providers (D1).** Create "Vela Light" and "Vela Light test" as separate providers named for the service, not in your name. Also ask LINE support whether a provider made now can later pass to the Singapore entity. *Recommended: yes to both, before `infra/README.md` §8 step 3.*
2. **Linking a group (D2).** Accept that a group is linked when an organiser of a family without a group is in it, whoever added Vela. *Recommended: yes.*
3. **Media in LINE groups (D3).** No photo or voice asks and no voice or photo replies in the group in the first cut; these come from the app. *Recommended: yes.*
4. **Stickers (D4).** Ignore them, as on Telegram. *Recommended: yes.*
5. **Edits (D5).** Ignore edits in the group; the original stands. *Recommended: yes.*
6. **Unsend (D6).** Delete Vela's copy, keep her light, and accept that the group post cannot be removed. Build it before the first real LINE family. *Recommended: yes.*
7. **Language (D7).** Greet a LINE user without a language hint in zh-TW. *Recommended: yes.*
8. **Chat mode (D8).** Keep "Chat" off. Her messages show as read at once, and nobody reads her chat in Manager. *Recommended: off.*
9. **One messenger per family (D9).** *Recommended: yes for the pilot.*
10. **The plan (D10).** Buy 中用量 only when a real LINE family is scheduled, before 2026-10-28 if they start in early November. Move to 高用量 at the 70% alert. *Recommended: yes. The purchase waits for your explicit yes each time.*
11. **Privacy notice v2 (D11).** Issue it, with the 14-day notice to organisers, before the first real LINE family. *Recommended: yes.*
12. **LY's terms (D12).** Ask LY support and counsel about Art. 8.2 (AI and speech processors) and User Data Policy §3.2.3 (24 hours for "Friend and Group information"). *Recommended: yes, and dogfood on staging meanwhile.*
13. **Quiet notice buttons (D13).** Let a second "Wait 2 hours" tap extend the wait. *Recommended: accept.*
14. **Cost levers (D14).** Keep the turn prompt on LINE, and do not merge the transcript into the answer post yet. *Recommended: keep both as they are; revisit at the first 70% alert.*
15. **Tests on your phone (plan step 8).** Each item has the assumption this design makes until the test settles it:
    - (a) `oaMessage` for someone who is not yet a friend. *Assumed: it opens the chat; if not, invites lead with the add-friend link.*
    - (b) Whether a postback tapped in a group names the tapper. *Assumed: yes; if not, the founder records notice reads.*
    - (c) Whether `displayText` also arrives as a separate message event. *Assumed: no; if yes, `displayText` is dropped.*
    - (d) Whether a quote of Vela's message carries the id push returned. *Assumed: yes.*
    - (e) The `Content-Type` of a voice note, and that it plays back from R2. *Assumed: `audio/x-m4a`.*
    - (f) Whether the bot can join groups with Chat off. *Assumed: yes; if not, D8 is revisited.*
    - (g) Whether a group push counts the account itself, and members who blocked it.
    - (h) Whether LINE accepts a v5 UUID as retry key. *Assumed: yes.*
    - (i) How the Flex buttons show on LINE for PC.
16. **Account linking in build plan 2.3.** Read "account linking" as the invite's start message. LINE's account-link API is not used, and app account linking over LINE comes later with the app. *Recommended: yes.*
17. **When LINE families start.** Build plan 2.9 says "live on LINE by week 4", while `plan/market-order.md` and `02-technical-architecture-v2.md` put LINE after the app families. *Recommended: dogfood on staging now; the first real LINE family after questions 6, 11 and 12 are settled and the plan is bought.*