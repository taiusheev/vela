# Vela: execution plan

> **Revised 2026-09-17.** The pilot is free for families: there is no fee and no payment, because Vela has no entity yet and payments wait for one (decision of 2026-09-13). Willingness to pay is measured instead by asking each organiser on the day-30 call whether they would pay for Vela Light at $9.99/mo, and by who joins a paid plan once it exists; the goal, the pilot offer, and the kill signals below say so.
>
> **Revised 2026-09-13.** Markets reordered: Taiwan and the English-speaking app path first, then Japan and Germany/UK, then the US at scale and India; Russia deferred (`market-order.md`). The survey and interview wave is replaced by published evidence (research/08–14); the twelve-week build order now lives in `pre-build-readiness.md` (instrument first, foundation, family app, parent surface, Taiwan on LINE, measure). Phase exit tests below stand, with targets revised in spec v2 §18.

v1, 2026-09-12. Supersedes the 30-day plan (`archive/plan/`). Two people: the founder (business, Taipei, Russian and English, 40–60 h/week, near-zero budget) and the tech co-founder (AI, always on). The product is defined in `product/02-app-plan.md`.

## The order of things

1. **Prove the loop with real families before building the app** (weeks 1–4). The Telegram prototype is the parent channel; a Telegram group is the family side; we write the weekly read by hand.
2. **Build the MVP only for what the loop proved** (months 2–3).
3. **Raise or bootstrap on evidence, not slides** (ikigai answer arrives during phase 0; the deck is written from phase-0 data either way).

## Phase 0: prove the loop (weeks 1–4)

**Goal.** Twenty conversations and ten to twenty families living the daily loop for at least two weeks, with every organiser asked whether they would pay for it, so that the MVP is built from evidence. Each pilot family should have three generations where possible: the eldest as the kept-light member, the organiser in the middle, and at least one member under 30 as a contributor, so we test both promises (closer, calmer) at once.

**Two questions every interview and survey must answer.** Who in your family do you *wish* you heard from more often? Who do you *worry* about when they go quiet? If wishes cluster on the 20–45 pair and worries on the eldest, the three-generation design is confirmed.

**Founder, week 1**
- Post the survey (materials in `plan/materials/`, update the intro line so it speaks to all families, not only abroad). Channels: your own network first, Russian-speaking Telegram groups in Taiwan and the relocation cities, Taiwanese friends with the Chinese version, r/AgingParents with the English version.
- Book the first eight interviews from respondents who opted in. The script is in `plan/materials/interview-script.md`; add the five bridge questions from `archive/product/01-solution-thinking.md` §6.
- Talk to your own parent about the morning arrival. Show a mock. This is the elder-acceptance check.
- Make the repo public or keep it private; decide, don't drift.
- Time: 30 h.

**Tech co-founder, week 1**
- Update the survey intro and the recruitment posts for the "all families" framing.
- Adjust the prototype for phase 0: the arrival can carry family content (the child sends a photo or voice note to the bot and it goes out with tomorrow's morning); the quiet notice goes to the child with the nearby contacts they named; away mode by keyword. Remove the founder-decides card except for AI flags.
- Landing page: one page, the light, the promise, a waitlist, two price points shown alternately. Domain and hosting on free tiers.
- Weekly review template and a decisions log.

**Founder, week 2**
- Interviews 9–16. Every interview ends with the pilot offer: free for families, starts next Monday. No payment is taken; whether the organiser would pay is asked on the day-30 call.
- Ten families confirmed with parents' names, messengers, wake times, and two nearby contacts each.
- Time: 40 h.

**Tech co-founder, week 2**
- Deploy the prototype once you've created the Telegram bot, the Cloudflare account, and the Anthropic key (20 minutes; see `plan/build-plan.md` sprint 0).
- Three-day test with your own parent before any other family.
- Onboarding script for you: five minutes with the child, five minutes with the parent, in Russian.

**Week 3: pilot live**
- Founder: onboard families; read every conversation daily; write the weekly read by hand for each family on Sunday (the AI drafts, you edit; every edit is logged as a product lesson); interview anyone who declines or drops.
- Tech co-founder: run the daily loop, tune quiet times, log reply rate, latency, family-content days, quiet notices and whether they were true.

**Week 4: measure and decide**
- Founder: day-14 check-in with every family, one question: "If Vela stopped tomorrow, how would you feel?" Ask each parent, through the chat, one question: "Нравится ли вам получать это по утрам?"
- Tech co-founder: phase-0 report with the numbers in `product/02-app-plan.md` §9; what the arrival must contain; what the weekly read must say; the MVP scope cut to what was proven.
- Decision: build the MVP, or change one variable and rerun phase 0.

**Kill signals.** Fewer than 4 organisers of the ten to twenty pilot families saying on their day-30 call that they would pay for Vela Light at $9.99/mo (the same threshold as `build-plan.md` and `pre-build-readiness.md`). More than 30% of parents refusing or going silent in week one for reasons other than being away. Family-content days under 30% by week two despite prompts.

## Phase 1: MVP (months 2–3)

**Build** (tech co-founder, with a human technical co-founder if one has joined)
- Family app (Expo): setup flow, the light, the family thread, turns and prompts, queue for "whenever", quiet notice with nearby contacts, away mode, weekly read, subscription.
- Channel adapters: Telegram (from the prototype), WhatsApp Business API, LINE.
- AI service with versioned prompts and logged outputs.
- Admin view for the first months.

**Founder**
- Day-30 call with every phase-0 organiser: "If Vela stopped tomorrow, how would you feel?" and "Would you pay for Vela Light at $9.99/mo?"
- Convert phase-0 families to the app; recruit toward 100 families through their referrals (ask each pilot family for two introductions; contributors are the referral engine).
- Pricing test: $9.99/mo vs $79/yr vs $14.99/mo across cohorts.
- Ten more interviews with families who declined, to learn the objections.
- Taiwan groundwork: five conversations with Taiwanese families with a parent living alone; LINE is the channel.
- If ikigai says yes: the batch. If not: apply to two more programmes with phase-0 data, and keep bootstrapping; the cost base is near zero.

**Exit criteria.** 100 families; paying conversion after trial > 25%; D30 retention > 85%; parent reply rate > 85%.

## Phase 2: the bridge (months 4–6)

- Grandchildren contributions, translation both ways, story day and archive, memory and reminders, MAX and Viber adapters, referral loop in the app.
- Taiwan launch on LINE, Chinese-language app.
- First hire: a customer-facing person who speaks the languages of the first 1,000 families (support, onboarding calls, community).
- Exit criteria: 1,000 families; contributors per family ≥ 3; family-content days > 60%; Sean Ellis > 40%.

## Phase 3: the read (months 7–12)

- Drift with published precision; SMS/voice channel for parents without smartphones; second-parent plans.
- First B2B2C channel conversation with a telco or a remittance app; insurer conversation in Germany or Japan with our precision numbers.
- Exit criteria: 10,000 families; a channel partner signed or rejected with reasons; seed round on evidence.

## Pitch deck and site (parallel track, weeks 1–4)

The founder asked for these as the first MVP. They are built from the same material and get better with each week of phase 0.

**Site** (week 1, tech co-founder): one page. The light. "Vela keeps a light on for parents who live alone." Three lines on how it works. The parent's promise ("nothing to install, nothing to learn, say 'не надо' any time"). Waitlist with the two questions we most need answered (where does your parent live, which messenger does she use). Russian and English; Chinese in week 3.

**Deck** (draft week 1, final week 4, tech co-founder drafts, founder presents): ten slides.
1. The unanswered call (the problem, in one story).
2. 50 million parents alone, a worried child behind each (market).
3. Everything built so far treats her as a patient (why incumbents fail, with the adoption and non-wear numbers).
4. Vela: the family's daily thread, one moment a day, a safe place with no feed and no strangers; and a light kept on for whoever the family worries about (the product, one screen).
5. The daily loop (arrival, answer, light, quiet notice).
6. Closer and calmer: what makes it more than a group chat (turns, prompts, grandchildren, translation, story day) and what makes silence mean something.
7. Why now (messengers everywhere, multilingual AI, super-aged crossover in Taiwan/Korea/Japan).
8. Business model (free layer spreads, Vigil pays; comparables: Famileo, Snug, Docomo).
9. Phase-0 evidence (reply rate, family-content days, what parents said, how many organisers said they would pay).
10. The founder, the ask, the plan to 1,000 families.

## Cadence

- Monday: 30 minutes, three priorities each, in `plan/weekly/`.
- Daily in weeks 3–4: 15-minute check on the loop.
- Friday: written review with the metrics table; decisions in `plan/decisions.md`.

## What the founder needs to do this week, in order

1. Create the Telegram bot, the Cloudflare account, and the Anthropic key (20 minutes, `plan/build-plan.md` sprint 0).
2. Post the survey in three places today.
3. Book eight interviews.
4. Show your parent a mock of the morning arrival and write down her exact words.
