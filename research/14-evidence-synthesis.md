# 14 — Evidence synthesis: what the published record says about Vela's bet

2026-09-13. Six research workstreams (`08`–`13`, ~200 sources) ran in place of the survey and interview wave the founder chose not to wait for. This document says what they settle, what they change in the spec, and what only a pilot can answer. Every number below is sourced in the report named in brackets.

## 1. The six questions, answered

| Question | Answer | Confidence |
|---|---|---|
| Do 70+ parents answer a daily prompt? | Yes, at roughly **80% of days in the first month, drifting to 65–75% by week 12** (EMA studies of adults with mean age 72–76; decay ~1.5 points a week). A TV-based family photo service in Japan kept **92% of 115 older adults engaged daily at three months**. Morning prompts beat evening by 18%. [08] | High for the rate; medium for transfer to our loop (no published study of an ask-and-reply product) |
| Will they feel watched? | Not if **she initiates the signal, sees what the family sees, and a person is on the other end**. Passive sensors and cameras are what elders refuse (mothers accepted cameras at 10% vs their children at 70%). The real failure mode is the ritual becoming a duty on either side. [11] | High |
| Can we reach them without an install? | **Taiwan yes** for the online half: LINE at 99.4% of adults, but only **53.8% of 70+ are online at all**; a LINE check-in bot got a 93.4% response rate. **Russia is unstable**: WhatsApp was the 65+ default (57% WhatsApp-only in 2025) but its daily users fell 56% after the 2026 block; Telegram overtook it (96M reach) and is throttled since February 2026; MAX has 83M reach, stores chats in plaintext, and opens its bot platform only to Russian legal entities. **Initiating is the weak link**: 19% of Russians 60+ send voice messages; tapping a button is reliable. [10] | High |
| Does a one-moment-a-day family app retain? | The daily mechanic alone dies (BeReal, Gas, Poparazzi lost 70–99% of use in 12–18 months). What lasts pairs the ritual with utility or an archive: Life360 (DAU/MAU 62%), Tinybeans (monthly paid retention 93%), Famileo (260k families, 70% by word of mouth). Family-only networks die to the group chat unless posting is structurally shared. [12] | High |
| Will families pay? | Price is not the risk: $9.99/mo or $79/yr sits inside the proven band (FamilyAlbum $59–109/yr, Snug $19.99/mo for a human who acts on a missed check-in, Life360 $143/yr per paying circle; caregivers already spend $7,242/yr out of pocket). **Conversion is the risk**: freemium trial-to-paid medians are ~2%, hard paywalls ~11%; annual plans keep 44% at 12 months versus 17% for monthly. [09] | High on price; medium on conversion |
| How big is the pull, and where? | Elders living alone: ~33% of Russian pensioners, 23% of Taiwan's 65+ (~1M people), 19–34% across Japan, Korea, Germany, the UK, the US. Wave 1 (parents of the 650–920k who left Russia since 2022) is roughly **200,000 families with a parent already alone** (planning range); Taiwan roughly **500,000**. Remittance rails into Russia are closed to Western apps, so Telegram communities are the only distribution rail for wave 1. Taiwan's government reaches ~50,000 of ~977,000 registered elders living alone. [13] | Medium (sizing rests on flagged assumptions) |

## 2. What the evidence changes in the product

| Area | Was | Now | Why |
|---|---|---|---|
| Answer-rate target | > 85% | **≥ 75% of days in weeks 1–4; ≥ 65% at week 12**; kill signal < 50% | EMA decay curves; Mago-Channel [08] |
| Quiet ladder | T_quiet starts at 5 h; notice on every miss | **T_quiet starts at 6 h, floor 4 h, cap 10 h; first 14 days are a learning period** (quiet shown in the app, push only after 8 h) | With one day in four or five unanswered, a notice per miss fires 5–7 times a month; surviving check-in services retry and wait before alerting [08] |
| Notice metric | < 2 notices per member per month, > 50% true concern | **< 4 per month by month 3; > 60% marked useful by the organiser**; true-concern share still logged and published | Most notices will resolve as "answered late" or "away"; the notice is information, not alarm [08, 11] |
| The answer bar | Big mic, chips beside it | **Every ask answerable in one tap**: chips and photo taps are the primary row; the mic is present, not required | Voice initiation 19% among 60+; tap response 93% [10] |
| Consent and "stop" | Consent screen; stop rate < 5% | Copy leads with the family and never uses "monitor", "check", "track"; **stop rate target < 10% in month 1** | 30–40% of invited 65+ refuse anything framed as monitoring [08, 11] |
| Duty protection | Implicit | Explicit rules: she never sees missed days, never learns the family worried, the organiser's copy never blames; turns rotate so nobody carries the family alone | The main failure mode is obligation on either side [11, 12] |
| Channels, wave 1 | Telegram, MAX, WhatsApp | **Russia deferred by the founder on this evidence** (plan/market-order.md). LINE first for Taiwan and Japan; WhatsApp for Europe and India after the entity; the parent surface app is the floor and the whole US path; the voice line moves from phase 3 to phase 2; Telegram kept for the instrument | Block, throttling, MAX terms, closed remittance rails [10, 13] |
| Channels, wave 2 | LINE | LINE first, **paid Messaging API plan from day one** (free tier is 200 pushes a month), phone-call fallback for the offline half of 70+ | LINE pricing; 53.8% of 70+ online [10] |
| Billing default | Monthly shown first | **Annual pre-selected**; monthly framed as the trial ramp; per protected parent; the adult child is the account owner | 44% vs 17% year-one retention [09] |
| Conversion target | > 25% of families at 90 days | **≥ 10% of families with a kept-light member paying at day 90**; kill signal < 4%; monthly paid retention target 90% | Freemium 2% vs hard-paywall 11%; Life360 paying circles ÷ MAU ≈ 3%; Tinybeans 93% [09, 12] |
| Claims | "Peace of mind", "less lonely" | "You'll know she's fine every day" and "more contact with the family"; **no loneliness claim** until the pilot measures UCLA-3 at weeks 0, 4, 12 | Only human-contact trials show loneliness effects [08, 11] |
| Growth model | Referral loop | Word of mouth inside families (Famileo 70%), Telegram relocant communities for wave 1, LINE official account for Taiwan; remittance partnerships deferred to the Philippines wave | Rails closed into Russia; GCash and Wise live in the Philippines [13] |

## 3. The five things that surprised us

1. **Russia's channel is not a given.** The wave-1 parent may be on a blocked WhatsApp, a throttled Telegram, or a state messenger we cannot legally or ethically build on. The Telegram adapter is still the right first step, but the parent surface (our own app, installed by a visiting child) and a voice line are the floor, not a luxury. Build order changes accordingly.
2. **Half of Taiwan's 70+ are offline.** LINE reaches everyone who is online; nobody reaches the rest. The phone-call fallback that plays the family's voice and takes a keypress is a wave-2 requirement.
3. **Conversion, not price, is the business risk.** Our 25% conversion target had no basis; the published record says 2–11% depending on funnel. The trial after her first answer behaves like a hard paywall for the organiser, so 10% is the honest target.
4. **A quarter of days will be silent even when everything works.** The quiet ladder must treat silence as expected information, learn her rhythm, and never fire on the first missed hour. The precision page we promised will show mostly "answered late" and "away", and that is fine if the copy says so.
5. **Nobody has published our exact model.** Every acceptance study is about sensors; every retention study is about feeds or games. The pilot is original evidence, and its logging is the most valuable thing the first build produces.

## 4. What the pilot must log from day one

Per parent per day: ask delivered (type, asker), seen, answered (tap · chip · voice · photo · heart · "fine"), time to answer, replies received, replies heard next morning, quiet notice sent, notice outcome, away days, "stop". Per family per week: asks composed by whom, quiet-day count, types used. Per parent: UCLA-3 loneliness at weeks 0, 4, and 12, asked by the founder in the onboarding and check-in calls. Per organiser at day 14 and 30: "if Vela stopped tomorrow, how would you feel?" These close the gaps the literature cannot: the per-day answer rate for a family ask, the voice-versus-tap split at 70+, the false-quiet rate, and whether a reply heard the next morning changes the answer rate.

## 5. Gaps that remain (and how we live with them)

- No published answer rate for a family ask-and-reply loop: the pilot's first 30 days answer it.
- No Russian- or Taiwanese-specific acceptance or willingness-to-pay data: the pilot's founder-run onboarding calls double as interviews.
- No age-broken MAX adoption data: we do not build on MAX until it exists.
- Telegram relocant community sizes were not obtained: a one-hour follow-up before the wave-1 posts.
- Taiwan MOHW survey tables on desired contact frequency were located but not extracted: worth one more pass before the LINE launch.
