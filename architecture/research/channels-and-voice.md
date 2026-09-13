# Channels and voice: due-diligence on every adapter Vela needs

Researched 2026-09-13 via official docs (developers.line.biz, developers.facebook.com, core.telegram.org, twilio.com pricing, expo.dev) plus secondary sources where an official page didn't expose a number directly — those are flagged **[est.]**. USD conversions are the secondary sources' own, not verified spot rates.

## 1. Recommendation (ten lines)

1. One internal `ChannelAdapter` interface (§4) now; ship Telegram first (cheap, fast), LINE second (Taiwan), WhatsApp Cloud API third (US/DE/UK/IN), SMS+voice last (US fallback + landline).
2. **Telegram**: raw Bot API, no BSP — free, but phase-0 only; no read receipts, not a real acquisition channel anywhere on the market list.
3. **LINE**: go direct with LY Corporation. Individuals can register a free **unverified** Official Account today with no business registration; budget Standard (NT$1,000/mo Taiwan, 3,000 free msgs) or Light (¥5,000/mo Japan) past pilot scale. The Verified blue badge needs Taiwan business documents — gate that on entity formation, not engineering.
4. **WhatsApp**: direct Cloud API, not a BSP (avoids the 10–30% markup). Meta Business Verification needs a real legal entity — this blocks launch until Vela incorporates.
5. Classify the daily "ask" as a **Utility template** sent outside the 24h window. In-window replies are free today but **Meta starts charging for utility templates and service messages inside the window from October 1, 2026** — model that cost now.
6. **SMS/voice fallback (US + landline)**: Twilio — priced 40–80% above Telnyx/Plivo but the only vendor with 10DLC + toll-free + Studio compliance tooling in one console at pilot scale.
7. Build the scripted landline call (play family voice notes, take DTMF/speech) on **Twilio Studio + `<Gather>`**, not a voice-AI platform (Vapi/Retell/Bland) — it's a fixed script, not a conversation, so skip their $0.05–$0.33/min markup.
8. **Push**: Expo Push Service (free, thin proxy over FCM/APNs). `expo-widgets` went stable in SDK 56 (June 2026) — Live Activities/widgets are now realistic without ejecting.
9. **Email** (organiser digest): Resend now (3,000 free/mo); Amazon SES once volume rises (~30–150x cheaper than SendGrid/Postmark at scale, more manual deliverability setup).
10. A welfare-check call is informational, not marketing, in every market — that lowers the US consent bar, but Japan, Germany, and India each have open legal gaps (§5) that need country counsel before the voice line ships.

## 2. Capability matrix

| Capability | LINE | WhatsApp Cloud API | Telegram | SMS (Twilio) | Voice call (Twilio) | Push (Expo) |
|---|---|---|---|---|---|---|
| Buttons | Quick replies (max 13), template buttons (max 3), Flex Message | Reply buttons (max 3) or list (max 10), only in-window or via template | Inline keyboards, no hard cap | Keyword/number reply only | DTMF only | OS action buttons |
| Voice in | Yes, `getContent`/api-data.line.me; deleted after retention window | Yes, native voice note needs OGG/Opus, ≤16MB (~10–15 min) | Yes, OGG/Opus, ≤50MB | No | Call recording (extra cost) | N/A |
| Voice out | Yes, HTTPS URL + duration, ≤200MB, .m4a | Yes, same constraints, in-window/template only | Yes | No | `<Play>` in TwiML | N/A |
| Read receipt | No documented per-message read event | Yes (`read` status), unless user disabled it | None | Delivery only, no read | Call-connect events only | Delivery only, no "opened" |
| Daily-message rule | Counts vs. monthly push quota; replies are free | No cap concept; template category + window governs cost; messaging tier caps unique recipients/day (250→1k→10k→100k→unlimited) | ~30 msg/sec bot-wide soft cap | No platform cap | N/A | No cap |
| Identity linking | LINE Login link-token flow, no LINE Login channel required | Phone number is identity; opt-in collected outside WhatsApp | Telegram user ID via `/start` deep link | Phone number is identity | Phone number is identity | Push token mapped server-side |
| Stop | `unfollow` webhook on block; no universal keyword | Must honor STOP/opt-out on any channel immediately | `/stop` convention only | STOP/UNSUBSCRIBE/CANCEL mandatory (CTIA); FCC now requires any reasonable opt-out method | Consent revocation honored operationally | OS notification toggle |
| Cost/parent-month (36 msgs) | Taiwan: ~NT$12 [est.] at Standard-plan scale | ~$0.35–$1.80 [est.], country-dependent — needs live rate-card confirmation | ~$0 (hosting only) | N/A, fallback only | N/A, fallback only | ~$0 marginal |

## 3. Per-channel rules and costs

### 3.1 LINE Messaging API
Official pricing ([developers.line.biz/en/docs/messaging-api/pricing](https://developers.line.biz/en/docs/messaging-api/pricing/)): Light free/200 msgs, Standard ¥5,000/5,000 msgs, Premium ¥15,000/30,000 msgs (Japan). **Taiwan restructure effective Nov 1, 2026** ([tw.linebiz.com/column/LINEOA-2026-Price-Plan](https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/)): Light NT$0/200 free (unchanged), Standard NT$800→**NT$1,000**/3,000 free, High NT$1,200→**NT$1,400**/6,000 free, with High-plan overage becoming two tiers: NT$0.2/msg up to 50,000, NT$0.15/msg beyond. Push/multicast/broadcast/narrowcast count against quota; **reply messages are free and unlimited**; counting is per-recipient.

Message types ([developers.line.biz/en/docs/messaging-api/message-types](https://developers.line.biz/en/docs/messaging-api/message-types/)): quick replies max 13 buttons; template buttons max 3 (carousel: 10 columns × 3 buttons); Flex Message for custom cards; audio message via HTTPS URL + explicit duration, ≤200MB, `.m4a`; rich menu ≤20 tap areas.

Webhooks confirmed: message, postback, follow/unfollow, join/leave, member-join/leave ([developers.line.biz/en/docs/messaging-api/receiving-messages](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)) — **no "read" event found**. Voice notes are fetched via `api-data.line.me` (not `api.line.me`) using the webhook message ID; content with `contentProvider.type: external` can't be downloaded, only a URL. User content auto-deletes after an unspecified window.

Account linking doesn't need a LINE Login channel: bot issues a link token → LINE returns it → bot sends a linking URL → user completes in-app ([developers.line.biz/en/docs/messaging-api/linking-accounts](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)). Rate limits: most endpoints 2,000 req/s, multicast 200 req/s, broadcast/narrowcast 60/hour ([developers.line.biz/en/news/2021/11/04/rate-limit](https://developers.line.biz/en/news/2021/11/04/rate-limit/)).

Verification: Verified/Premium badge applications accepted only in Japan, Taiwan, Thailand. **Individuals can create a free unverified account today, no business registration needed**; Verified status needs company documents ([help2.line.me/official_account_tw](https://help2.line.me/official_account_tw/web/pc?lang=en&contentId=20013137)). LINE's developer terms make the OA operator responsible for user data received via the API; LINE retains account data post-closure only as legally necessary ([terms2.line.me/LINE_Developers_Messaging_API](https://terms2.line.me/LINE_Developers_Messaging_API)). No numeric daily-message cap beyond the monthly quota was found.

### 3.2 WhatsApp Business Platform
Meta switched to per-message billing July 1, 2025, across four categories: **Marketing, Utility, Authentication, Service** ([developers.facebook.com/.../send-messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages); country rates below are secondary-sourced **[est.]**, not fetched from Meta's live table — reconfirm before budgeting):

| Country | Marketing/msg | Authentication/msg |
|---|---|---|
| US | ~$0.025 | ~$0.004 |
| Germany | ~$0.12 | ~$0.050 |
| UK | ~$0.048 | ~$0.020 |
| India | ~$0.010 | n/f |

Marketing is billed on every delivered message, no free tier. Utility/Authentication are free inside an open 24-hour window — **but from October 1, 2026 Meta begins charging for Utility templates and Service messages inside that window too**. Vela's daily ask is a **Utility template** (relationship-based, business-initiated, outside the window); in-window replies are free-form Service messages, unbilled until Oct 2026.

Interactive messages: Reply Buttons (max 3) and Lists (max 10 items), generally sendable only inside an open window or as approved template buttons. Voice notes need `voice:true` + `audio/ogg`/OPUS specifically; other formats deliver as a plain attachment; audio max 16MB (~10–15 min). Status webhooks cover `sent → delivered → read`, with `read` suppressed if the user disabled receipts; failed webhooks retry up to 8x over ~21 hours with a stable event ID.

Business Verification requires a legal entity (tax ID, incorporation docs, matching business name/address/phone), review 10 minutes to 14 business days — **hard blocker until Vela incorporates**. Direct Cloud API has no markup; BSPs add $0–$1,000 setup, $50–$500/mo, seat fees, and 10–30% per-message markup — go direct given Vela's tiny per-parent volume. Messaging tiers: unverified 250 contacts/day, verified progresses 1,000→10,000→100,000→unlimited on quality signals, checked every 6 hours. Opt-in must be collected outside WhatsApp; STOP/blocks honored immediately.

### 3.3 Telegram Bot API (phase-0 only)
[core.telegram.org/bots/faq](https://core.telegram.org/bots/faq): ~1 msg/sec per chat, ~20/min per group, ~30/sec global soft cap before 429s (a paid-Stars broadcast tier exists at ≥100k Stars/MAU, irrelevant here). Voice: native OGG/Opus, ≤50MB. `setMessageReaction`/`message_reaction` updates are the closest thing to an ack signal — user-opt-in only, not a real read receipt. No delivery/read confirmation otherwise. Free API; only cost is hosting. Governance/availability risk in some jurisdictions reinforces its phase-0-only role already decided on.

### 3.4 SMS and voice (US + landline)
Twilio official rates, fetched 2026-09-13, USD pay-as-you-go:

| Country | Outbound SMS/seg | Outbound voice landline/mobile per min |
|---|---|---|
| US | ~$0.0083 + 10DLC carrier surcharge | — |
| Taiwan | $0.0842 | $0.1196 / $0.1985 |
| Japan | $0.0890 | $0.0746 / $0.1850 |
| Germany | $0.112 | ~$0.015 / ~$0.025 [est.] |
| UK | ~$0.04 [est.] | $0.0158 / $0.0305 |
| India | $0.0832 | ~$0.0035 / ~$0.0085 [est.] |

Sources: [twilio.com/en-us/sms/pricing/tw](https://www.twilio.com/en-us/sms/pricing/tw), [/jp](https://www.twilio.com/en-us/sms/pricing/jp), [/de](https://www.twilio.com/en-us/sms/pricing/de), [/in](https://www.twilio.com/en-us/sms/pricing/in), [/voice/pricing/tw](https://www.twilio.com/en-us/voice/pricing/tw), [/jp](https://www.twilio.com/en-us/voice/pricing/jp), [/gb](https://www.twilio.com/en-us/voice/pricing/gb). Number rental: long code $1.15/mo, toll-free $2.15/mo.

10DLC (US only): Sole Proprietor/Low-Volume brand $4.50 one-time; Standard brand $46 one-time; campaign $15 one-time + ~$1.50/mo recurring **[est., confirm in console]**. Toll-free skips 10DLC but needs separate Toll-Free Verification (fee unclear, approval 24h–2wk across sources — plan for the slow end).

Alternatives **[est., not independently fetched]**: Telnyx (~$0.004/segment, ~$0.005–0.007/min) and Plivo (~$0.0055–0.0077/segment, ~$0.0085/min) are consistently cited cheapest; Bandwidth ~$0.004/min with FedRAMP/native-911; Vonage ~$0.0075/segment, $0.00798/min; Sinch custom pricing only. Re-verify against each vendor's own pricing page before switching off Twilio.

Voice-AI platforms **[est.]**: Vapi ~$0.05/min platform fee (all-in $0.13–$0.33/min with STT/LLM/TTS); Retell from $0.07/min (all-in $0.08–$0.15/min); Bland cheapest at scale, $0.09–$0.12/min. Twilio Studio + `<Gather>`/`<Play>` covers Vela's fixed-script call at base per-minute rate with no platform fee, which is why it's the pick over a voice-AI vendor for now.

### 3.5 Push (Expo)
Expo Push Service is free with no per-notification charge, proxying to FCM/APNs under one API ([courier.com/blog/expo-notifications](https://www.courier.com/blog/expo-notifications)). Comparative error rates were close to raw FCM (~0.03% vs ~0.02%) but Expo's worst-day spike (2.21%) exceeded FCM's (0.45%). OneSignal/Braze/Knock-class managed platforms start ~$99+/mo — not justified at "one push a day per parent." iOS "critical" alerts need a specific Apple entitlement grant (health/safety-reserved); "time-sensitive" is the realistic target. `expo-widgets` reached stable in SDK 56 (~June 2026) per [expo.dev/blog/ios-widgets-and-live-activities-in-expo](https://expo.dev/blog/ios-widgets-and-live-activities-in-expo) — Live Activities/widgets are now buildable as React components without ejecting.

### 3.6 Email (organiser fallback)
Resend: 3,000/mo free, $20/mo for 50,000. Postmark: $15/mo for 10,000, $55/mo for 50,000 (best deliverability reputation). SendGrid: $19.95/mo for 50,000, $89.95/mo for 100,000. Amazon SES: $0.10 per 1,000 emails, no monthly fee — ~30x+ cheaper than SendGrid at 100,000/mo but you own DNS/DKIM/warmup yourself. (Figures via [buildmvpfast.com/api-costs/email](https://www.buildmvpfast.com/api-costs/email), secondary-sourced; reconfirm on each vendor's pricing page.) Resend now, SES once organiser volume justifies the ops overhead.

## 4. The adapter contract

```typescript
interface Arrival {
  id: string;
  recipientId: string;
  text: string;
  media?: { kind: "voice" | "image"; url: string; durationSec?: number };
  buttons?: { label: string; value: string }[];   // adapter clamps to channel max
  requiresTemplate?: boolean;   // true if outside WhatsApp's 24h window
}

interface InboundAnswer {
  recipientId: string;
  kind: "text" | "voice" | "button" | "reaction" | "unknown";
  text?: string; mediaUrl?: string; buttonValue?: string;
  receivedAt: Date;
}

interface DeliveryReceipt {
  arrivalId: string;
  status: "sent" | "delivered" | "read" | "failed"; // not every channel can populate every value
  observedAt: Date;
}

interface ChannelAdapter {
  readonly channel: "line" | "whatsapp" | "telegram" | "sms" | "voice" | "push";
  sendArrival(a: Arrival): Promise<{ providerMessageId: string }>;
  onInboundEvent(rawWebhookPayload: unknown): InboundAnswer | DeliveryReceipt | StopEvent | null;
  resolveIdentity(providerUserRef: string): Promise<string | null>;
  handleStop(providerUserRef: string): Promise<void>;
  handleStart(providerUserRef: string): Promise<void>;
}
interface StopEvent { recipientId: string; reason: "unfollow" | "block" | "keyword" | "carrier-opt-out"; }
```

Deviations per channel: **LINE** — `sendArrival` must self-track the monthly push quota and degrade to reply-only once exhausted; `DeliveryReceipt` never reaches `"read"` (no such webhook exists), so UI must treat LINE as "read unknown." **WhatsApp** — `sendArrival` must check the recipient's 24h window at call time and substitute a template when closed (same `Arrival`, two different wire shapes); `"read"` may be silently suppressed by user setting. **Telegram** — only `"sent"/"failed"` are real; a `message_reaction` update is bonus signal, not a contract field. **SMS** — no `buttons`; adapter flattens them into "reply 1/2" text and parses keywords itself; `media.kind:"voice"` is unsendable. **Voice call** — doesn't fit `Arrival` at all; a separate `VoiceCallAdapter` composes the day's family voice notes into a Studio/TwiML flow. **Push** — no real inbound channel; answer capture always defers to the app UI, not `onInboundEvent`.

## 5. Legal and consent per market

**US (TCPA)**: informational autodialed/prerecorded calls need prior express consent; marketing needs prior express *written* consent. Vela's ask/call are informational, but the parent must still have given explicit consent — capture it at onboarding, don't imply it from the adult child's signup. Damages: $500–$1,500/violation, strict liability. SMS must support STOP/UNSUBSCRIBE/CANCEL (CTIA) and honor opt-out via any reasonable method (FCC, April 2025).

**Taiwan**: no Taiwan-specific automated-call statute surfaced distinct from general telecom rules — **research gap**; PDPA governs data handling regardless. Confirm with local counsel before a Taiwan voice launch (lower priority since Taiwan's primary channel is LINE).

**Japan**: Telecommunications Business Act and the anti-spam/unsolicited-communications framework require consent-based handling; no informational-vs-marketing call carve-out was found — **treat as requiring clear opt-in for any automated call** until counsel confirms otherwise.

**Germany/UK**: UK PECR requires specific prior consent for automated/prerecorded marketing calls (general marketing consent isn't enough), caller ID must show, and TPS screening applies to live calls. Germany, as an EU/ePrivacy jurisdiction, is expected to require at least equivalent consent — **not independently confirmed with a German-specific source; research gap**, lower priority since Germany's channel is WhatsApp.

**India (TRAI)**: DLT registration mandatory for commercial calls/SMS; promotional from 140-series numbers (capped ~3/day, 8/week/customer), transactional/service from 160-series; DND/NCPR must be honored; consent must be informed and revocable, with inferred consent time-limited (as little as 7 days). A pure welfare-check call isn't clearly exempt from DLT routing — the strictest regime here; needs a dedicated compliance pass, likely via a DLT-registered local aggregator, before any India voice launch (lowest-priority market already).

## 6. Risks

1. WhatsApp's Oct 1, 2026 pricing change turns today's free in-window messages into billed ones mid-build — the cost model here is a floor, not a ceiling, until Meta's live utility-category rate card is confirmed.
2. LINE has no read-receipt signal for bots, so "family acts on silence" can only mean "no reply arrived," not "read but unanswered" — may need a longer silence window on LINE than on WhatsApp.
3. Meta Business Verification and a Verified LINE badge both gate on entity formation; an unverified LINE OA can launch pre-entity, WhatsApp effectively cannot at real volume.
4. WhatsApp per-country rates here are secondary-sourced, not pulled from Meta's live table — get the authoritative card from WhatsApp Manager before any external cost commitment.
5. Voice-line legal clearance has open gaps in Taiwan, Japan, Germany, and India (§5); don't schedule a launch date until counsel closes them. The US is the best-understood market and the logical first for voice.
6. Twilio's baseline is 40–80%+ above Telnyx/Plivo (secondary-sourced) — accepted now for compliance tooling maturity, revisit once volume makes the markup material.
7. Telegram must not quietly become permanent: no read receipts, no real market presence, platform-governance risk — keep it trivial to retire once LINE/WhatsApp are live.
8. Expo's worst-case push error spike (2.21%) exceeds FCM's (0.45%); an undelivered-but-looks-delivered push is a silent failure for a "notice if she doesn't answer" product — consider a periodic reconciliation job, not push-delivery alone, as the failure signal.

---
*Estimated/secondary figures marked [est.]; others quoted or fetched directly from the cited page on 2026-09-13. Re-check live pricing pages before any external cost commitment — several rate cards, especially WhatsApp's per-country utility pricing, could not be fully rendered via automated fetch and were reconstructed from secondary aggregators.*
