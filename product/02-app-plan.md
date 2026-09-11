# Vela: the app plan

v1, 2026-09-12. This is the product. It supersedes the human-ladder parts of `01-solution-thinking.md` and the pilot-only `bot-spec.md`. Direction agreed with the founder: for every family with a parent who lives alone; the app makes the daily interaction richer and effortless; the parent's response is the sign of life; the family, not a service, acts when it goes quiet; no Vela staff, no partners, no hardware.

---

## 1. What Vela is, in one paragraph

Vela is a family app with one parent at the centre. Every morning, the parent receives one thing worth opening from her family, delivered inside the messenger she already uses. She replies with a tap, a heart, a voice note. That reply lights a small flame the whole family can see. Vela keeps the rhythm going when the family is busy, helps grandchildren take part, remembers what she says, translates when the grandchildren have lost her language, and asks her one story question a week so she is the storyteller, not the patient. If the flame doesn't light, the family knows within hours and sees who is nearby. Over weeks, Vela reads how she really is from how she replies. The name is the point: *vela* is a candle, *velar* is to keep vigil. The family keeps a light on.

## 2. The people

| Role | Who | Pays | Installs | What they get |
|---|---|---|---|---|
| **Parent** | 65–85, lives alone, has a phone with a messenger (Telegram, WhatsApp, MAX, LINE, Viber); some only a landline | No | Nothing | One warm arrival a day, from people she loves; a story question a week; the feeling of being remembered |
| **Organiser** | The child who worries most; sets it up, pays, names the nearby contacts | Yes | The Vela app | The daily flame; a weekly read; a quiet alert with a plan; less guilt |
| **Contributors** | Siblings, in-laws, grandchildren (teens and kids via a parent), close family friends | No | Vela app, or nothing (contribute from a messenger bot) | Prompts when it is their turn; the parent's replies to their own contributions; a shared family memory |
| **Nearby contacts** | A neighbour, a relative in the same town, a friend from church | No | Nothing | One message, only when the parent is quiet and the organiser wants them called; they consent once |

Design rule that follows: **the parent never learns anything new.** No app, no password, no button she hasn't seen before. Everything on her side is a normal message in a normal chat from a contact she saved once.

## 3. The daily loop

```
   family queues things        Vela composes            parent's morning
   (any time, any member) ──▶  one arrival      ──▶     one message, one tap
                                                              │
   family sees the flame  ◀──  Vela reads reply  ◀──   tap / heart / voice
   + her words, translated                                     │
                                                          (silence)
                                                              ▼
                              gentle repeat (+2.5h) ──▶ quiet notice to organiser (+5h)
                                                        with nearby contacts, one tap to call
```

**The arrival.** At the parent's chosen time (default: 30 minutes after she usually wakes), one message. It contains: something from the family (a photo with a line, a 15-second voice note, a drawing, a question), a gentle greeting in her name and form of address, and one reply affordance: a big "☀️ Всё хорошо" button in messengers that support buttons, a heart reaction where they don't, and always the option to speak. Never more than one message. Never a feed.

**What fills the arrival, in priority order.**
1. Something a family member queued for today.
2. Something queued for "whenever" (a bank of photos and notes the family drops in on Sunday night).
3. A story question (see §5) if it is the story day.
4. A Vela-composed morning, honestly signed ("Vela, от вашей семьи"), when nobody sent anything. It references yesterday's reply and today's weather in her city. This is the fallback that keeps the rhythm alive; the app's job is to make it rare.

**The reply.** Anything counts: tap, emoji, text, voice, a photo of the cat. Vela transcribes voice, summarises in one line for the family, translates for members who need it, and posts it to the family's shared thread under her flame for today. Contributors whose content she responded to get told ("Бабушка ответила на твоё фото: …"). The AI may send one warm acknowledgement back to the parent and pass on a family reply the same day; it never carries a conversation on the family's behalf beyond that.

**Silence.** The ladder is short and belongs to the family.
- +2.5 h: the same arrival, gently repeated ("на случай, если не увидели").
- +5 h (tuned per parent from her usual reply time): the organiser gets a **quiet notice**: last contact, her usual reply time, what she said yesterday, and the nearby contacts with one-tap call and one-tap "ask them to check". Nothing goes to nearby contacts without the organiser's tap, unless the organiser has switched on "if I don't respond within 2 hours, ask [neighbour] automatically".
- Whenever she replies late, the flame lights, the quiet notice closes itself, and everyone who was told is told it's fine.
- **Away mode**: the parent says "уезжаю к сестре до воскресенья" in a reply, or the family sets it, and the ladder pauses with a note on the flame. Learned holidays and Sunday church are honoured. This is the single biggest false-alarm killer.

**The weekly read.** Every Sunday the organiser (and contributors who opt in) get "How mom is this week": three to five lines drawn from her replies. What she talked about. Whether she replied earlier or later than usual. Whether her voice notes were longer or shorter. Anything she mentioned twice (the knee, the pharmacy, the neighbour's dog). One suggestion ("She asked about Masha's exams twice; a call from Masha would land"). Neutral words, no diagnosis, no scores.

## 4. What "interaction much more" means, concretely

These are the features that make the family group chat look like what it is: chaos that goes quiet.

1. **Turns.** Vela quietly gives each member a day ("Today is Sasha's day"). A prompt arrives the evening before with a suggestion drawn from the parent's recent replies. Nobody is shamed for skipping; the fallback covers it. Turns make five people produce a daily rhythm that no single busy child can sustain.
2. **Prompts that know her.** "She mentioned the tomatoes are ripening. Ask her to send a photo." "Her birthday is in 9 days; here's what she said she wanted last year." Kinsome does generic prompts; Vela's are drawn from her own words.
3. **Grandchildren as contributors.** A kid records a 10-second voice note or draws on the screen; a teen sends a photo without writing anything. Grandchildren's content gets the strongest parent replies (Famileo's insight), and their contributions are the ones the parent keeps.
4. **Translation both ways.** The parent speaks Russian; the grandchild in Taipei reads English and Chinese. Vela transcribes and translates her voice note, and translates the grandchild's text into her language with her form of address. This is the feature that reconnects families who have lost a shared language, and nobody offers it.
5. **Story day.** Once a week the arrival is a question about her life ("Как вы познакомились с папой?"). Her answer, voice or text, goes into a family archive that grows into a book. She is the author. Storyworth built a company on this alone; here it is one day in seven and it gives the parent a reason to reply that is about her.
6. **Memory.** Vela remembers what she says: the doctor's appointment on Thursday, the neighbour's name, the medicine she mentioned. It reminds the right family member at the right time ("Mom's appointment is tomorrow; ask her how it went on Friday"). The family remembers more; the parent feels heard.
7. **Her side of the bridge.** She can send anything to the family any time through the same chat; it lands in the family thread, transcribed and translated. The channel is two-way; the morning is just the guaranteed moment.
8. **The flame.** The app's home screen is one thing: her flame, lit or not, and her last words. Underneath, the family's thread. No dashboards, no charts, no scores. Quiet is the design.

## 5. The parent's channel: messenger-agnostic by construction

The parent side is a set of adapters behind one interface: send an arrival, offer a tap, receive text/voice/photo/reaction, detect read receipts where available.

| Channel | Where it matters | Notes |
|---|---|---|
| Telegram | Russia (daily leader), CIS diaspora, Ukraine | Free bot API, buttons, voice; throttled in Russia, may be blocked |
| MAX | Russia (monthly reach leader since mid-2026) | Official bot and mini-app API; state-run, assume everything is readable; required for Russian parents |
| WhatsApp | Philippines, India, LatAm, Europe, US | Business API, small per-message cost, template rules; blocked in Russia |
| LINE | Taiwan, Japan, Thailand | Messaging API; the channel for the Taiwan launch |
| Viber | Ukraine, parts of CIS | Bot API |
| SMS + voice call | Parents with no smartphone | Twilio-class provider; the arrival becomes a short call from a saved number that plays the family's voice note and takes a keypress; last in the roadmap, first in importance for the 80+ segment |
| Vela Parent app | Parents who want it | Optional, later: one screen, big buttons, the family's photos; never required |

Rule: a family is never told "your parent's messenger isn't supported". If we don't have the adapter, we don't launch in that market.

## 6. The AI layer

Everything the model does, and the line it never crosses.

| Task | How | Guardrail |
|---|---|---|
| Understand replies | Transcribe voice (multilingual), summarise to one neutral line, extract mood words and mentioned things (people, places, health words, plans) | Never quote her verbatim to the family without her seeing what the family sees; never infer diagnoses |
| Flag what matters now | Pain, fall, dizziness, chest or breathing, not eating, hopelessness, a stranger at the door, a "bank" call, money requests | Flag goes to the organiser with her words; the AI's reply to her is warm and calm and does not alarm; never medical advice |
| Prompt the family | Evening-before suggestions from her recent replies and the family calendar | Suggestions, never auto-sent as if from a person |
| Compose the fallback morning | Warm, two lines, references yesterday and the weather | Always signed as Vela; never pretends to be a family member |
| Translate | Both directions, preserving her form of address and the grandchild's tone | Show the original alongside |
| Weekly read | Narrative from the week's replies and timing | Neutral words; "later than usual", not "concerning"; one suggestion at most |
| Drift | Per-parent baselines: reply latency, length, sentiment, vocabulary richness, topics; flag sustained change over 2–3 weeks | Conservative thresholds; we publish our precision; framed as "worth a call", never as a finding |
| Quiet-time tuning | Learn her usual reply window; set the quiet notice per parent | Never earlier than +4 h; away mode overrides everything |

Model choice: the strongest available model for understanding and composition (quality of a two-line reply to an 80-year-old is not where to save money); a cheaper model for transcription-only paths. Costs at scale are cents per family per month.

## 7. Privacy and trust, as product decisions

- **Symmetry.** The parent can see, in her chat, everything the family sees about her ("что видит семья"). She can say "не надо" and everything stops.
- **Minimum data.** Her name, form of address, city, wake time, replies for 30 days (rolling), the weekly reads, the story archive she chose to keep. No health records, no location tracking, no contacts scraping.
- **Nearby contacts consent once**, by a message from the organiser through Vela, before they can ever be pinged.
- **No ads, ever.** The business model is the subscription. This is stated on the landing page.
- **Region rules.** Data stored per region; Russian citizens' data handling reviewed before launch (localisation law); GDPR for Europe; PDPA for Taiwan.
- **Honest language.** Vela is not an emergency service and never says otherwise. The promise is "you'll know within hours, and you'll know who to call", not "we'll save her".

## 8. Pricing

Two tiers, decided from the evidence and to be tested in the first 90 days.

| Tier | Price | What's in it | Why |
|---|---|---|---|
| **Vela** (free) | $0 | The daily arrival, replies, turns, contributors, translation of replies | Growth runs through contributors (Aura: half of sales from family invites); the free layer is what spreads |
| **Vela Vigil** | $9.99/mo or $79/yr per parent; second parent +50% | Quiet notices and nearby contacts, away mode, weekly read, memory and reminders, story archive and book export, drift | The paid reason is meaning of silence, not messaging (Marco Polo, Locket: ~1% pay for messaging; Snug's $19.99 tier sells the alert) |

Willingness-to-pay band from the research is $10–35; Famileo sits at £6–18; Docomo at ¥1,980. We start at the bottom of the band because the paying customer skews young and the parent's life is finite (2–4 year LTV), and we grow ARPU with a second parent and family-wide features. Trial: 30 days of Vigil free after the parent's first reply, so the family experiences one quiet notice or one weekly read before paying.

## 9. What we measure

| Metric | Why it matters | Target at 90 days |
|---|---|---|
| Parent reply rate (days with any reply ÷ days with an arrival) | Is she opening it with joy? | > 85% |
| Median reply latency | Feeds quiet tuning; a habit signal | < 60 min |
| Family-content days (arrivals with real family content ÷ all arrivals) | Is the interaction real or is Vela carrying it? | > 60% |
| Contributors per family | Growth engine | ≥ 3 |
| Quiet notices per family per month, and share that were true (she was actually unreachable) | Precision; we publish this | < 2/month, > 50% true |
| Paying conversion after trial | The business | > 25% |
| D90 retention of paying families | The business | > 80% |
| Parent-side "не надо" rate | Dignity check | < 5% |
| "If Vela stopped tomorrow, how would you feel?" (Sean Ellis) | Product-market fit | > 40% "very disappointed" |

## 10. Architecture (what we build, and what we already have)

- **Family app**: React Native (Expo) for iOS and Android, one codebase; web for setup and the story archive.
- **Parent channels**: adapter service; the Telegram bot we already wrote becomes the first adapter (its onboarding, morning loop, and reply handling carry over).
- **Core**: families, members, parents, arrivals, replies, flames, quiet ladder, away mode, weekly reads, story archive, reminders. Postgres (Supabase or Neon), scheduled jobs per parent time zone, an event log we can audit.
- **AI service**: transcription, understanding, flags, prompts, composition, translation, weekly read, drift. Claude via the API; prompts versioned; every model output logged with the input it came from so we can measure precision.
- **Notifications**: push for the family app; messenger messages for contributors who never installed.
- **Ops**: an internal admin view (who's quiet, what got flagged, what the model said) for the first months; it replaces the founder-in-the-loop of the pilot.
- **Hosting**: Cloudflare Workers or a small Node service plus Postgres; free tiers carry us to the first few hundred families.

## 11. Roadmap

| Phase | When | What ships | Families | Decision at the end |
|---|---|---|---|---|
| **0. Prove the loop** | Weeks 1–4 | No app. Telegram prototype as the parent channel; the family side is a Telegram group with Vela; manual weekly read written by us. 20 interviews first. | 10–20, paying $15 for the month | Do parents reply with joy? Do families keep sending? What must the arrival contain? |
| **1. MVP** | Months 2–3 | Family app (Expo): setup, flame, thread, turns, prompts, quiet notice, away mode; Telegram + WhatsApp + LINE adapters; automated weekly read; pricing live | 100 | Conversion and D30 retention; reply rate |
| **2. The bridge** | Months 4–6 | Grandchildren contributions, translation both ways, story day and archive, memory and reminders, MAX and Viber, family invites and referral loop; Taiwan launch on LINE | 1,000 | Contributors per family; family-content days; NPS |
| **3. The read** | Months 7–12 | Drift with published precision; SMS/voice channel for no-smartphone parents; second-parent plans; first B2B2C channel (telco or remittance app) | 10,000 | Whether the drift read is trusted and paid for; channel economics |

## 12. Risks and what we do about them

| Risk | Mitigation |
|---|---|
| Family attention decays after week three | Turns, prompts that know her, grandchildren, the Vela fallback; measure family-content days weekly and treat a drop as a product bug |
| Parent feels watched or patronised | Symmetry, "не надо", story day, the arrival is always from people not a system; ask her directly at week two |
| False quiet notices erode trust | Per-parent tuning, away mode, never before +4 h, publish precision, the notice is information not alarm |
| Messenger platform risk (blocks, throttling, API changes) | Adapters; never single-channel in a market; SMS/voice as the floor |
| Free tier cannibalises paid | Silence semantics and the weekly read are the paid layer; test at 90 days and move the line if conversion is under 25% |
| A parent is found late despite Vela | Honest promise from day one ("within hours, and who to call"), never "emergency"; the language is written before the first customer |
| Data law (Russia localisation, GDPR, PDPA) | Minimum data, per-region storage, legal review before each market launch |
| Solo non-technical founder | The AI co-founder builds; the ikigai batch and network for a human technical co-founder; the prototype already exists |
