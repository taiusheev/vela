# Vela: the app plan

v2, 2026-09-12. Agreed with the founder: Vela is one app for the whole family across three generations. It is a safe, calm, family-only place with one shared moment a day, free for everyone. For any member the family wants to keep a light on for, usually the grandmother who lives alone, sometimes the student abroad, the flame is the paid layer, where silence means something. No Vela staff on the ladder, no partners, no hardware.

Supersedes v1 and the human-ladder parts of `01-solution-thinking.md`. `bot-spec.md` describes the phase-0 instrument only.

---

## 1. What Vela is

Vela is the family's daily thread. Every day, one moment: something worth opening from the people you love, and one easy way to answer. No feed, no strangers, no ads, no algorithm deciding what you see. Grandparents, parents, and children all in one place, each with the surface that fits them. And for the members the family worries about, the ones who live alone or far away, Vela keeps a light on: their daily answer lights a flame the family can see, and if it doesn't light, the family knows within hours and knows who is nearby. The name is the point: *vela* is a candle, *velar* is to keep vigil.

Two promises, one product:

- **Closer.** For the 20-year-old at university and the 45-year-old who misses her, for the sibling in another city, for the grandchildren who have lost their grandmother's language. Both busy, both want more, both hate the group chat that went quiet. Free.
- **Calmer.** For the child of a 78-year-old who lives alone. Her reply is the sign of life. Silence gets a plan instead of a spiral. Paid.

## 2. The family, and who does what

| Role | Typically | Installs | Pays | What they get |
|---|---|---|---|---|
| **Member** | Anyone in the family, any age | The Vela app; or nothing, joining through a messenger bot | No | The daily moment, the thread, turns and prompts, translation, story day, memory |
| **Organiser** | The one who sets the family up; usually the 40–55-year-old in the middle, who is both a child and a parent | The app | Yes, if the family keeps a light on for someone | Everything, plus the flame(s), quiet notices, weekly reads |
| **Kept-light member** | The grandmother who lives alone; the student abroad; anyone the family chooses, and who agrees | The app if they can; the messenger they already use if not; a landline later | No | A daily arrival from people who love them; nothing to learn; the right to say "не надо" |
| **Nearby contact** | A neighbour, a relative in the same town | Nothing | No | One message, only when the light hasn't lit and the organiser asks; consents once |

Rules that follow:

- **The eldest never has to learn anything new.** She can be in Vela entirely through Telegram, WhatsApp, MAX, LINE, or Viber, as one saved contact. If a child installs the app on her phone during a visit, she gets the parent surface (§5); it is never required.
- **Flames are opt-in per person and visible to that person.** A 20-year-old can switch his own flame on for his mother while he is abroad and off when he's home. Nobody is watched without knowing.
- **Everyone is a contributor.** The 20-year-old's ten-second voice note is the single strongest thing that reaches a grandmother. The product is designed so that he sends it in the time it takes to unlock his phone.

## 3. The daily loop

```
 anyone queues something   ─▶   one arrival per person, at their hour   ─▶   one easy answer
 (any time, from any member)     (the app, or her messenger)                  (tap, heart, voice, photo)
                                                                                     │
 the thread shows it, translated ◀──────── Vela reads and summarises ◀───────────────┘
 flames light for kept-light members
                                          (silence, kept-light member only)
                                                        ▼
                     gentle repeat (+2.5h) ─▶ quiet notice to organiser (+5h, tuned)
                                              with nearby contacts, one tap to call
```

**The arrival.** For every member, one message a day at their chosen hour: the family's moments since yesterday, composed into one thing, with one way to answer. For a member in the app it's a screen; for a member in a messenger it's a message with a button. Never more than one a day. This is the anti-feed: Vela is closed the rest of the day, on purpose.

**What fills an arrival, in order.** Things queued for today; things queued for "whenever" (the Sunday-night bank of photos and notes); the story question on story day; and, for a kept-light member only, a Vela-composed morning signed as Vela when nobody sent anything, so the ritual never breaks.

**The answer.** Anything counts. A heart, a voice note, a photo of the cat. Vela transcribes voice, summarises one line, translates for members who need it, and posts it to the thread. Whoever's content got the reply is told. Vela may send one warm acknowledgement to a kept-light member in her messenger; it never carries a conversation for the family beyond that.

**The flame.** For kept-light members, the day's answer lights their flame on the family's home screen. That is the whole dashboard. No scores, no charts.

**Silence, for kept-light members only.** The same arrival repeated gently at +2.5 h. At +5 h, tuned to her usual reply window and never earlier than +4 h, the organiser gets a quiet notice: last contact, usual reply time, yesterday's words, and the nearby contacts with one tap to call and one tap to ask them to check. Optional: "if I don't respond within 2 hours, ask [neighbour] automatically." A late reply lights the flame, closes the notice, and tells everyone it's fine. **Away mode** ("уезжаю к сестре до воскресенья", said in a reply or set by anyone) pauses the ladder; learned holidays and Sunday church are honoured. Away mode is the single biggest false-alarm killer.

**The weekly read.** Sunday, for kept-light members: three to five lines drawn from the week's answers. What she talked about, whether she answered earlier or later than usual, whether her voice notes ran shorter, what she mentioned twice, one suggestion. Neutral words, no diagnosis.

## 4. What makes it closer (the free layer, for everyone)

1. **One moment a day, then closed.** The engagement design and the ethical position are the same thing. BeReal's core opens within three minutes of one daily push; Locket reached 80 million downloads by being small-circle and feed-free. Vela is calmer than both: one arrival, one answer, done.
2. **Turns.** Each member gets a day ("Today is Sasha's day"). A prompt arrives the evening before. Five busy people produce a daily rhythm no single busy person can sustain. Skipping is fine; nobody is shamed.
3. **Prompts that know the family.** Drawn from what people actually said: "Grandma mentioned the tomatoes; ask for a photo." "Dad asked about your exam twice; a voice note would land." Kinsome does generic prompts; Vela's come from the family's own words.
4. **Grandchildren first-class.** Kids draw or record with a parent's phone; teens send a photo without writing. Their content gets the strongest replies and is what the eldest keeps.
5. **Translation both ways.** Grandma speaks Russian; the grandchild in Taipei reads English and Chinese. Vela transcribes and translates her voice note, and renders the grandchild's text in her language with her form of address. Reconnects families who lost a shared language; nobody offers it.
6. **Story day.** Once a week the arrival to the eldest is a question about her life. Her answer, voice or text, goes into a family archive that becomes a book. She is the author, not the patient. Storyworth built a company on this alone.
7. **Memory.** Vela remembers the Thursday appointment, the neighbour's name, the exam date, and reminds the right member to ask at the right time. The family remembers more; each person feels heard.
8. **The safe place.** No ads, no strangers, no discovery, no infinite scroll, no notifications except the one moment. Screen time is a metric we want low. This is on the landing page.

## 5. Surfaces

| Surface | For whom | What it is |
|---|---|---|
| **The app** (iOS, Android) | Every member who can install | Home: flames and today's moment. Thread. Queue. Turns and prompts. Story archive. Settings for one's own flame. |
| **Parent surface** (same app, simplified mode) | The eldest, when a child installs it on a visit | One screen: today's arrival, big buttons, voice-first reply, one-tap video call to whoever is online, the family's photo wall. Everything from family, nothing else on the screen. |
| **Kitchen-table mode** | An old phone or tablet on her table | The parent surface as a living frame: the family's photos cycle; she taps once a day. She already owns the device; Aura sells $229 frames for less. |
| **Messenger** (Telegram, MAX, WhatsApp, LINE, Viber) | The eldest who will not install; any member who joins casually | Adapters behind one interface: send the arrival, offer a tap, receive text/voice/photo/reaction. The prototype bot is the first adapter. |
| **Voice line and SMS** (later) | The parent with a landline | The arrival becomes a short call from a saved number that plays the family's voice notes and takes a keypress. Last in the roadmap; first in importance for 80+. |

Rule: no family is told "your grandmother's messenger isn't supported". If an adapter doesn't exist, we don't launch in that market.

## 6. The AI layer

| Task | How | Guardrail |
|---|---|---|
| Understand answers | Transcribe voice in any language; one neutral line; mood words; mentioned people, places, plans, health words | Never quote a kept-light member to the family without her seeing what they see; never infer diagnoses |
| Flag what matters now | Pain, fall, dizziness, chest or breathing, not eating, hopelessness, a stranger at the door, a "bank" call, a money request | To the organiser with her words; the reply to her is warm and calm; never medical advice |
| Prompt the family | Evening-before suggestions from recent answers and family dates | Suggestions only; nothing is auto-sent as if from a person |
| Compose the fallback morning | Two lines, references yesterday and her weather | Always signed as Vela; never pretends to be family |
| Translate | Both directions, keeping tone and form of address | Original shown alongside |
| Weekly read | Narrative from answers and timing | "Later than usual", never "concerning"; one suggestion at most |
| Drift | Per-person baseline of latency, length, sentiment, vocabulary, topics; sustained change over 2–3 weeks | Conservative; we publish precision; framed as "worth a call" |
| Quiet tuning | Learn each kept-light member's reply window | Never before +4 h; away mode overrides |

Model: the strongest available for understanding and composition; a cheaper path for transcription. Cents per family per month at scale.

## 7. Privacy and trust

- **Symmetry.** A kept-light member can always see what the family sees about her, and can say "не надо" to stop it.
- **Minimum data.** Names, forms of address, cities, chosen hours, answers for 30 days rolling, weekly reads, the story archive the family chose to keep. No health records, no location tracking, no contact scraping.
- **Flames are consented.** Switched on by the person or with their agreement; visible to them.
- **Nearby contacts consent once** before they can be pinged.
- **No ads, ever. No selling data, ever.** The subscription is the business. Stated on the landing page.
- **Regions.** Per-region storage; Russian localisation law reviewed before launch; GDPR; Taiwan PDPA.
- **Honest language.** Vela is not an emergency service. "You'll know within hours, and you'll know who to call."

## 8. Pricing

| Tier | Price | What's in it | Why |
|---|---|---|---|
| **Vela** | Free | The daily moment, thread, turns, prompts, contributors, translation of answers, story day | The free layer is the growth engine; the 20-year-old recruits the family (Aura: half of sales from family invites) |
| **Vela Light** | $9.99/month or $79/year per kept-light member; second member +50% | The flame, quiet notices and nearby contacts, away mode, weekly read, memory and reminders, story archive export and book, drift | People pay for the meaning of silence, not for messaging (Snug's $19.99 tier sells the alert; Locket and Marco Polo convert ~1% for messaging) |

Willingness to pay from the research is $10–35 for this feeling; we start at the bottom because the payer is often young and the eldest's life is finite. Trial: 30 days of Light free after the kept-light member's first answer, so the family sees one weekly read or one quiet notice before paying. To be tested against $14.99 and annual-only in the first 90 days.

## 9. What we measure

| Metric | Why | 90-day target |
|---|---|---|
| Kept-light answer rate (days answered ÷ days with an arrival) | Is she opening it with joy? | > 85% |
| Median answer latency | Habit; feeds quiet tuning | < 60 min |
| Family-content days (arrivals with real family content ÷ all) | Is the family present or is Vela carrying it? | > 60% |
| Members per family; active contributors per family | Growth engine | ≥ 5; ≥ 3 |
| Under-30 members per family | Is the closeness promise landing with the young? | ≥ 1 in 60% of families |
| Quiet notices per kept-light member per month; share true | Precision, published | < 2; > 50% |
| Light conversion after trial; D90 retention | The business | > 25%; > 80% |
| "не надо" rate among kept-light members | Dignity | < 5% |
| Daily minutes in app per member | The anti-addiction promise: low and steady | 2–4 minutes |
| "If Vela stopped tomorrow, how would you feel?" | Product-market fit, asked to organisers and to the young | > 40% very disappointed |

## 10. Architecture

- **App**: React Native (Expo), one codebase for iOS and Android, with a "parent surface" mode and a "kitchen-table" mode as display modes of the same app. Web for setup and the story archive.
- **Adapters**: messenger service behind one interface; the Telegram prototype is the first adapter; MAX, WhatsApp, LINE, Viber follow; voice/SMS last.
- **Core**: families, members, roles, flames, arrivals, answers, quiet ladder, away mode, weekly reads, story archive, reminders, subscriptions. Postgres; per-person scheduled jobs; an event log.
- **AI service**: transcription, understanding, flags, prompts, composition, translation, weekly read, drift. Claude via the API; versioned prompts; every output logged with its input so precision can be measured.
- **Notifications**: exactly one push per member per day, at their hour, plus quiet notices to organisers. The notification budget is a product rule, enforced in code.
- **Ops**: internal admin view for the first months.
- **Hosting**: Cloudflare Workers or a small Node service plus Postgres; free tiers to the first few hundred families.

## 11. Roadmap

| Phase | When | Ships | Families | Decides |
|---|---|---|---|---|
| **0. Prove the loop** | Weeks 1–4 | No app. The eldest via the Telegram prototype; the family in a Telegram group with Vela; each family recruited with at least one under-30 member; weekly read written by us | 10–20, paying $15 for the month | Does she answer with joy? Does the family keep sending? Does the young member send? What must the arrival contain? |
| **1. MVP** | Months 2–3 | The app: setup, flames, thread, queue, turns, prompts, quiet notice, away mode, weekly read, Light subscription; Telegram + WhatsApp + LINE adapters | 100 | Conversion, D30, answer rate, members per family |
| **2. The bridge** | Months 4–6 | Parent surface and kitchen-table mode; grandchildren tools; translation both ways; story day and archive; memory; MAX and Viber; referral loop; Taiwan on LINE | 1,000 | Contributors per family, family-content days, minutes per day, Sean Ellis |
| **3. The read** | Months 7–12 | Drift with published precision; voice/SMS line; second kept-light member plans; first channel partner (telco or remittance app) | 10,000 | Whether the read is trusted and paid; channel economics |

## 12. Risks

| Risk | Mitigation |
|---|---|
| The family goes quiet after week three, like every group chat | Turns, prompts from their own words, the under-30 member as contributor, the Vela fallback for kept-light members; family-content days reviewed weekly as a product bug when they drop |
| The eldest feels watched | Symmetry, "не надо", story day, everything arrives from people, ask her directly at week two |
| The young see it as their parents' app | The closeness promise is theirs: calm, no feed, no strangers; the 20-year-old can keep his own light for his mother while abroad, on his terms; test with under-30s in phase 0 |
| We become the group chat, i.e. a free messenger with 1% conversion | The free layer is one moment a day, not chat; the paid layer is silence semantics for a kept-light member; if Light conversion is under 25% at 90 days, move the line |
| False quiet notices | Per-person tuning, away mode, never before +4 h, published precision, notice as information not alarm |
| Messenger platform risk | Adapters; never single-channel in a market; the app and the voice line as floors |
| A kept-light member is found late despite Vela | Honest promise from day one; the language written before the first customer |
| Data law | Minimum data, per-region storage, legal review per market |
| Solo non-technical founder | AI co-founder builds; the prototype exists; a human technical co-founder from the batch or network |
