# The voice line: a morning call for a parent with a landline

2026-10-02 · proposed design for build plan 4.5, documented and not built. It awaits the founder's decisions in §10 and, before any market launches it, counsel in that market (§8). The voice line is phase 2 (`plan/pre-build-readiness.md`, item 2). It is listed here because it is the only way Vela reaches the offline half of the over-70s: a parent with no smartphone, no messenger and no app, only a phone that rings.

This document covers six things:
- what the call is, for her;
- how it fits the exchange, the gateway and the quiet ladder that already exist;
- how her yes is captured;
- what the adapter and the two Workers do;
- what it costs;
- what the law asks, market by market, with the US first.

Read it with:
- `02-technical-architecture-v2.md` §8. Its voice-line row is changed by this document in two places, marked in §11.
- `05-line-flows.md`, the template for a new channel. Any flow this document does not change works as there and in `04-instrument-flows.md`.
- ADR-35. Her phone as a channel (`device`) is the closest precedent: a channel with no messenger whose deliveries still go through the gateway.
- Spec §4 (the arrival), §8 (the quiet ladder), §9 (consent and stop) and §15 (the notifications budget).

**Sources.** Read on 2 October 2026:
- Twilio's TwiML `<Play>` reference. It plays only `audio/mpeg`, WAV, AIFF, GSM and µ-law; neither Ogg/Opus nor M4A/AAC is on its list.
- Twilio's webhook security page. `X-Twilio-Signature` is HMAC-SHA1, keyed by the account's auth token, over the full URL followed by the POST parameters sorted by name.
- The FCC's December 2020 TCPA exemptions order (FCC 20-186), as amended in 47 CFR 64.1200(a)(3). An informational prerecorded call to a residential line made without consent is exempt for at most three calls in any 30 days, and an exempted call must offer an automated opt-out.
- The prices and the per-market legal notes come from `architecture/research/channels-and-voice.md` §3.4 and §5 (13 September 2026). Where that file marks a number **[est.]**, so does this one.

Nothing here is legal advice. §8 says where counsel is needed.

---

## 1. The call, for her

At her arrival hour her phone rings. The caller ID is Vela's number, which the family saved on her phone as "Vela · Anna", using the organiser's name. She picks up and hears:

1. **The greeting**, in her address form and her language: "Good morning, Mom. This is Vela, with a message from your family."
2. **From yesterday**, if yesterday had replies: each reply's voice, or its text read aloud, named: "Mia said: …".
3. **The ask**, named: "Mia asks: what did you cook today?" If the asker recorded a voice hello (spec §4.4), it plays first.
4. **Her choices**, said slowly, at most four:
   - "To answer in your own voice, press 1, then speak after the tone."
   - "If you're fine and just want to say hello, press 2."
   - "To hear this again, press 9."
   - When the ask has chips or a vote: "If you … , press 3. If you … , press 4." There are at most three chips, and a vote has at most five options here (digits 3 to 7).
5. **Her answer.** She records up to 60 seconds, which ends on silence, on the hash key, or when she hangs up. Or she presses a digit.
6. **The thanks**, once: "Thank you. Anna knows you're fine." Then the call ends.

At the end of every call: "If you'd like these calls to stop, press 8." Pressing 8 asks once, "Press 8 again to stop the calls", and then stops them as her own "stop" (spec §9). The FCC's opt-out rule requires a key to stop, and it is also simply right.

When she presses nothing for 8 seconds, the choices play once more. After a second silence the call says "I'll call again later. Goodbye." Her silence on the call is not an answer: the light stays as it was, and the ladder runs (§3).

**What the call never does:**
- no menus deeper than one level;
- no "press 1 for English" (her language is known);
- no music;
- no advertising;
- no mention of Vela Light or of a price;
- no words "monitor", "check on" or "track" (spec §9);
- no voice that pretends to be a family member (the synthetic voice always speaks as Vela, spec §14.4);
- no voice cloning (arch §9.2).

**Types that cannot be called.**
- A photo choice and a memory photo need a screen. For a member whose surface is the voice line, Ask switches the photo types off with a line saying why, as it already does where the API keeps no photos (build plan 3.4).
- A "whenever" photo ask is never composed into her call.
- A word to teach, a story and a recipe work as they are: each is answered in her voice.

**She calls Vela.** If she missed the call, or wants to hear it again, she dials the same number (§5.4). Vela does not answer with family content on a number alone. It hangs up and calls her back within a minute: "You called Vela. Here is this morning's message." Caller ID can be faked, but a call back can only reach the real line, so only her own phone hears what the family said.

## 2. Her identity on the line

`voice` is already one of `CHANNELS` (`packages/contracts/src/domain.ts`), and every `channel` check allows it, so no migration adds the channel.

| Field | What it holds |
|---|---|
| `channel_links` row, `channel` `voice` | Her link. `external_id` is her number in E.164 (`+12065550123`), as Vela must dial it. Unlike `device` (ADR-35), it cannot be a hash. |
| `members.primary_surface` | `voice`, already one of `SURFACES`. `arrivalChannelOf` (ADR-35, phase 2) answers channel `voice` for it. |
| `consents` | Her yes, with channel `voice`, text version `voice-consent.v1`, and as evidence the call's SID, her digits and the time (§4). |

The number is personal data that did not exist before. The data map gets a row for it: kept while the link lives, deleted with the member, and never shown in the app or the admin overview (the family page shows its last four digits). Twilio receives it, which means a new sub-processor (§8.1).

**One number for every family in a market.** A US local number costs $1.15 a month. Every US family's calls come from the one Vela number, so the family saves it once. A second number is added only when per-number limits require it (§10, decision D4).

## 3. The call in the exchange, the gateway and the ladder

The voice line adds no second loop. The call is the arrival, delivered by the gateway like every other, and her digit or her recording is an answer through the inbound router, the same way her phone's taps are (ADR-35, phase 3).

| Step | Telegram today | The voice line |
|---|---|---|
| Arrival composed | `loadArrivalContext`, composer | Unchanged. The arrival's `OutboundMessage` is the same; the adapter turns it into a call. |
| Sent | `sendMessage` | `POST /2010-04-01/Accounts/{sid}/Calls.json`, with `Url` set to the Worker's call script for this outbound row (§5.2) and `StatusCallback` set to the Worker. |
| `delivered_at` | Telegram accepted the message | **Twilio accepted the call** (it answered with a Call SID). This matches Telegram, where "sent" is not "read". The ladder measures from it unchanged. |
| Not delivered | Platform error | Twilio refused the call (`ChannelSendError`), or its status callback reports `failed` (a bad number, a number out of service). This takes the existing `delivery_failed_at` path, and the founder hears about it as for any failed send. |
| She did not pick up | — | The call's status is `no-answer` or `busy`, or it reached a machine. This is **silence, not failure**: nothing is recorded beyond the call's status event, and the ladder runs. |
| Repeat (+2.5 h) | Same message, "in case you missed it" | A second call, opening "Calling again in case you missed this morning's call." It is the one repeat (spec §4.6), so at most two calls go out a day. |
| Quiet notice (+T_quiet) | To organisers | Unchanged. The organisers' notice adds one fact: "Vela called at 09:00 and 11:30; nobody picked up", or "picked up and hung up". The two differ, and the organiser should know which. |
| Her answer | Message, button | A recording becomes a `voice` `InboundEvent`. A digit becomes the `button` event, with the same button id, that the arrival's button would have made on Telegram: 2 is "I'm fine", and 3–7 are the chips or vote options in order. Both go through `handleInbound`, which therefore needs no change. The light lights synchronously and understanding is queued. |
| Stop | "stop" | Digit 8 pressed twice, or saying "stop" in a recording (understanding already detects it). Either one pauses arrivals at once. |

**A machine.** Twilio's answering-machine detection costs extra per call and is wrong some of the time. The design does not rely on it. A call that reaches voicemail plays the greeting and the ask and asks her to press a key, which a machine never does, so it ends as silence, and silence is what it is. Leaving the family's voice on a machine is fine: the machine belongs to her. The only cost is the minutes the message takes to play (§7).

**Calling hours.** The TCPA's 08:00–21:00 rule binds telemarketing, which this is not. The design keeps to it anyway, because a phone ringing before 8 is alarming to an 80-year-old. A voice-line member's arrival time is limited to 08:00–20:00 local time, and the repeat call is skipped when it would ring after 21:00. A skipped repeat leaves her silence to the ladder as usual.

**The budget** (spec §15) is unchanged. The arrival and the repeat are two sends on one exchange. The call back after her own call (§1) is exempt from the budget, like an ack, because she asked for it.

## 4. Her yes

US law decides this design (§8.2): daily prerecorded calls to her line need her **prior express consent**, and it must be hers, not her child's. So Vela never makes the first call. The first call is hers.

1. **The organiser sets her line up**, in the app on You > Her phone > "She has a landline". They enter her number. The app shows the Vela number and a six-digit code, which is valid for seven days. The number is stored on an invite, not on a link: no link exists until she says yes.
2. **She calls the Vela number** from that line, usually with the organiser sitting beside her. Vela matches the caller ID against open voice invites, then asks for the code: "Please type the six numbers Anna gave you." The code ties the call to the invite. The caller ID matching ties it, weakly, to her line.
3. **Vela reads the consent text** in her language (`voice-consent.v1`, below). Then: "If that's alright, press 1. If not, press 2." With a 1 she says yes. With a 2 the invite is closed and the organiser is told, as with a No on Telegram (spec §9, ADR-27).
4. **The health-words question** follows, as on every channel (spec §9, `consent.health_words@1`), answered with 1 or 2.
5. **Evidence.** The consent row stores: the Call SID; the caller ID; the digits pressed, with their times; the text version; and the language. The call is not recorded: the digits and the text version are the evidence, as a tap and a text version are on Telegram.

**`voice-consent.v1` (en), draft for counsel:**

> "Anna would like Vela to call you every morning at about nine with a question from your family. You can answer in your own voice, and Vela records your answer so the family can hear it. If a morning goes unanswered, Anna gets a quiet note so they can call you. You can stop the calls at any time by pressing 8 during a call, or by telling Anna. Vela is run by Timur Aiusheev. The privacy notice is on the website, and Anna can send it to you."

It names the recording on purpose. Some US states, California among them, require every party's consent to record a call. Her answers are recorded with notice, and only after she presses 1 to speak.

## 5. The adapter and the Workers

### 5.1 `packages/adapters/src/voice`

The adapter is shaped like the others: `send.ts`, `webhook.ts`, `identity.ts`, `fixtures/` and a contract test.
- `send(message)` places the call (§3). It is idempotent on the outbound row's key: before calling, it lists calls with that key in the call script's URL, so a retry after a lost response finds the first call instead of making a second. This is the same guarantee Telegram's adapter keeps through the outbound row.
- `verify(req)` checks `X-Twilio-Signature`. That is HMAC-SHA1 keyed by the auth token, over the public URL as Twilio saw it followed by the sorted POST parameters, compared in constant time. A tampered fixture must fail it, like every other adapter's (arch §8).
- `parse(req)` turns a gather's digit into the `button` event of the arrival button it stands for (§3), a recording's callback into `voice` (with its `RecordingUrl` and duration), and a status callback into a status event that the quiet notice reads. The built `INBOUND_KINDS` have no `dtmf` (the API contract's sketch did), and none is needed: the digits map onto the buttons.
- `capabilities`: `buttons` false, `voiceIn` true, `voiceOut` true, `images` false, `readReceipts` false.

### 5.2 The call script: TwiML from the pilot Worker, not Twilio Studio

Arch §8 named Twilio Studio. This design changes that (§11). The call is TwiML served by the pilot Worker (`GET /voice/call/:outboundId`, signed like any webhook), for four reasons:
- The script lives in the repository, reviewed and tested with fixtures. A Studio flow lives in Twilio's console, outside version control.
- Its words come from `@vela/copy` in both languages, like every other message Vela sends.
- It reads the arrival as the composer built it, so a call says exactly what Telegram would have said.
- It is free. Studio charges per flow execution beyond its free allowance.

The call script uses four TwiML verbs: `<Play>` for each audio file, `<Gather numDigits="1" timeout="8">` for each choice, `<Record maxLength="60" finishOnKey="#" playBeep="true">` for her voice, and `<Hangup>`.

### 5.3 What she hears is files, and the files must be MP3

`<Play>` plays MP3 and WAV, and neither Ogg (Telegram's voice notes) nor M4A (the app's recordings). Two things follow:
- **The synthetic speech** (greeting, names, the ask's text, the choices, the thanks) is TTS pre-rendered when the arrival is composed: build plan 2.6's Azure voices, rendered to MP3 into R2 under `calls/`. Twilio's own `<Say>` is the fallback when a rendering is missing, so a call is never silent. Its voice differs from the Azure one, which is acceptable for a fallback.
- **The family's voices** must be transcoded to MP3. **This is the same transcoding the iPhone needs for Telegram's Ogg voice notes** (build plan 4.1, "Not yet"), so one transcoding step serves both. A Worker cannot run ffmpeg. The options are already a founder decision for the iPhone (Workers Paid for a transcoding Worker, or an external transcoder). The voice line adds no new option, only a second reason to take one. Until that decision, a call reads a voice reply's transcript aloud ("Mia said: …") instead of playing it. That is worse, but it works.

Twilio fetches each file from the Worker by a signed, short-lived URL (`GET /voice/media/:key?exp&sig`), which is the media route's own pattern with an expiry. Nothing in R2 is public.

### 5.4 Inbound calls and the call back

`POST /voice/inbound` is Twilio's webhook for calls to the Vela number. It answers in one of four ways:
- Caller ID matches an open voice invite: the consent flow (§4).
- Caller ID matches a linked member: `<Reject reason="busy">`, and a call back is queued within a minute. The call back is an outbound row of kind `ack` with today's exchange's script.
- Caller ID is unknown: one sentence, "This is Vela. If your family set this up for you, please ask them to call us from the app." Then it hangs up. Nothing is recorded.
- More than three calls back to one number in a day: no further call back. This guards against a faked caller ID being used to make Vela ring someone's phone.

### 5.5 Her recording

On the recording callback, the pilot Worker fetches the recording from Twilio with the account's credentials and stores it in R2 under `device/`, the 32-day prefix where her phone's recordings already live. It then **deletes Twilio's copy** (`DELETE …/Recordings/{sid}`), so the only copy is Vela's and the 30-day promise holds. Understanding then runs on it like any voice answer (spec §5.2). If the deletion fails, the delete is retried from `reconcile`, and the founder hears about any recording older than a day still at Twilio.

## 6. What changes, by package

| Where | Change |
|---|---|
| `@vela/contracts` | Nothing: channel `voice` and surface `voice` exist, `OutboundMessage` is unchanged, and digits arrive as `button` events. |
| `@vela/db` | One migration: `voice` in `INVITE_CHANNELS`; `invites.voice_number` and `invites.code_hash` for §4. |
| `@vela/adapters` | The `voice` adapter (§5.1), with recorded Twilio fixtures, valid and tampered. |
| `@vela/services` | `arrivalChannelOf` answers `voice`. The composer leaves photo asks out for `voice` (§1). TTS rendering to MP3 for `voice` members. The quiet notice's call facts. The call-back limit. |
| `@vela/copy` | The call's lines and `voice-consent.v1`, in en and zh-TW. |
| Pilot Worker | `/voice/call/:id`, `/voice/inbound`, `/voice/status`, `/voice/recording`, `/voice/media/:key`. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `VOICE_NUMBER_US` are secrets, and `VOICE_LINE` is `off` everywhere until §10's decisions, like `LINE_CHANNEL` and `PUSH_SEND`. |
| App | You > Her phone > "She has a landline": number, code, and the Vela number to save. Ask: photo types off for her. |
| Admin | The family page shows her line's last four digits, its consent and the last call's status. The overview counts calls per day and minutes this month. |
| Race tests | Two: the call script requested twice for one outbound row (two ringing calls must not become two answers), and an answer by call racing her repeat call. Both are proven failing on a `proof/` branch with the guard removed, per the working rules. |

## 7. Cost

These are per kept-light member per month: 30 arrivals plus about 8 repeats is 38 calls, at about 1.5 minutes each (the greeting, one or two replies, the ask and her answer), so about 57 minutes. Twilio bills per started minute, so 2 minutes per call is the planning figure: about 76 billed minutes.

| Market | Rate per minute (outbound) | Calls | TTS (Azure) | Recording | Per member-month | Share of US$9.99 |
|---|---|---|---|---|---|---|
| **US**, landline | ~$0.014 | ~$1.06 | ~$0.20 | ~$0.04 | **~$1.30** + number $1.15 shared | ~13% |
| UK, landline | $0.0158 | ~$1.20 | ~$0.20 | ~$0.04 | ~$1.45 | ~15% |
| Japan, landline | $0.0746 | ~$5.67 | ~$0.20 | ~$0.04 | ~$5.90 | ~59% |
| Taiwan, landline | $0.1196 | ~$9.09 | ~$0.20 | ~$0.04 | **~$9.33** | ~93% |
| Taiwan, mobile | $0.1985 | ~$15.09 | ~$0.20 | ~$0.04 | ~$15.33 | > 150% |

Recording is billed at about $0.0025 a minute while a recording is kept. Vela deletes Twilio's copy at once (§5.5), so storage is close to nothing.

**The US works on Twilio's prices. Taiwan does not.** A Taiwan voice line at Twilio's rates eats the whole plan price. Taiwan's option is a local carrier or SIP trunk (Chunghwa Telecom and others), which needs research before a Taiwan launch and probably the entity. This matches the research's own ranking, which puts the US first for voice. Telnyx and Plivo are cited at less than half of Twilio's US rate **[est.]**. That is worth one comparison at volume, not now.

## 8. The law, market by market

### 8.1 Everywhere

- **A new sub-processor.** Twilio processes her number, her voice and the call's metadata. The privacy notice names it, its data processing terms are added to `legal-memo.md`'s status table (C9), and the data map gains the rows in §2 and §5.5. No family is called before the notice they agreed to names Twilio.
- **Her own yes, by her own action** (§4), recorded with its text version.
- **A key to stop in every call**, honoured at once (§1).
- **Recording with notice.** The consent text says her answers are recorded, and recording starts only after she presses 1 and hears the tone.

### 8.2 United States: first

- **TCPA.** A prerecorded call to a residential line needs the called party's prior express consent. The exemption for informational calls made without consent is capped at three calls in any 30 days (FCC 20-186, 47 CFR 64.1200(a)(3)), so a daily call cannot use it. The design therefore takes her consent before any call (§4). Damages are $500 to $1,500 per call under strict liability, which is why the first call is hers.
- **Telemarketing rules** (calling hours, the Do-Not-Call list) bind calls that sell. These calls sell nothing and never mention a price. The design keeps the hours anyway (§3).
- **Call recording.** Notice and her action before every recording (§4, §8.1) are meant to satisfy all-party-consent states such as California. **Counsel to confirm.**
- **Caller ID.** STIR/SHAKEN attestation comes from Twilio for a number Vela owns. The number shows as itself, never as a family member's.
- **For counsel:** whether one recorded yes on her own inbound call is "prior express consent" for daily calls; whether the call back (§1) needs anything beyond her own call; how long consent evidence is kept.

### 8.3 Taiwan

No automated-call statute separate from the telecom rules was found: **a research gap**. The PDPA governs her number and her voice. Cost (§7) blocks Taiwan before the law does. Not before a local carrier and local counsel.

### 8.4 Japan

No informational-call carve-out was found. Treat any automated call as needing clear opt-in, which §4 provides. **Counsel to confirm before launch.** The cost is about 59% of the plan price.

### 8.5 UK and Germany

- **UK:** PECR requires specific prior consent for automated calls, which §4 gives, and caller ID must show, which it does.
- **Germany:** expected to be at least as strict under ePrivacy, but **not confirmed from a German source**.
- Both are WhatsApp markets first, so voice comes later in both.

### 8.6 India

DLT registration is likely needed even for a welfare call, through a registered local aggregator, with DND honoured and inferred consent time-limited. This is the strictest regime of the six. Last.

### 8.7 Russia

Not in scope. The market is deferred (`plan/market-order.md`).

## 9. What it does not do

- No conversation and no voice AI. It is a fixed script with one level of digits (research §1, item 7; Vapi, Retell and Bland were rejected for markup on a script that needs none).
- No SMS. That is a separate phase-2 adapter with its own 10DLC registration.
- No inbound content without a call back (§5.4).
- No calls to anyone but her: nearby contacts stay on Telegram (ADR-36).
- No emergency service, and no promise of one. The call is information, and the quiet notice says so (spec §8).

## 10. The founder's decisions

| # | Decision | Proposed |
|---|---|---|
| D1 | Accept this design as the plan for phase 2, with the US first. | Yes. |
| D2 | TwiML from the Worker instead of Twilio Studio (§5.2). | Yes. |
| D3 | The audio transcoding route (§5.3), shared with the iPhone's Ogg problem. | Decide once for both. Until then, transcripts are read aloud. |
| D4 | One shared Vela number per market (§2). | Yes. |
| D5 | Open a Twilio account, in the founder's name or the entity's, with a payment method. | **Only when phase 2 starts.** Nothing is bought for this document. |
| D6 | US counsel on §8.2's three questions before the first US family is called. | Yes, before launch, not before building. |
| D7 | Taiwan: research a local carrier instead of Twilio (§7). | Later. Taiwan stays on LINE and the parent surface. |

## 11. Changes to other documents when this is accepted

- `02-technical-architecture-v2.md` §8, the voice-line row: "Twilio Studio + `<Play>`/`<Gather>`" becomes "TwiML from the pilot Worker (`<Play>`/`<Gather>`/`<Record>`)". "a separate `VoiceCallAdapter` composes the day's audio into a Studio flow" becomes "the `voice` adapter places the call; the Worker's call script reads the composed arrival (06-voice-line.md)".
- `api-contract.md` §9: the five `/voice/*` routes.
- `plan/materials/pilot/data-map.md`: her number, call metadata and recordings at Twilio until deleted.
- The privacy notices: Twilio as a sub-processor.
