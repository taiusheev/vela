# Vela: 30-day validation plan

Draft v1, 2026-09-11. Two people: the founder (business side, 40–60 h/week) and the tech co-founder (AI, always on). Days count from the day we agree this plan.

## What 30 days must answer

We are not building the product yet. We are buying three answers with our own data, because nobody in this market publishes theirs.

| Question | Evidence we need by day 30 | Kill signal |
|---|---|---|
| 1. Will adult children pay $20–29/month for a daily "she's fine"? | 30 interviews scored; ≥10 families actually paying in the concierge pilot | <5 families pay after 25+ interviews |
| 2. Will parents accept the signals and the call? | Parent opt-out rate; call answer rate; what they say in onboarding | >30% of parents refuse or drop out in week one |
| 3. Can we produce a trustworthy daily signal with (near) zero hardware? | Days with a confident green dot vs. days we had to guess; false alarms per family per week | <70% confident days, or >1 false alarm per family per week |

If all three pass, day 31 starts the real MVP build. If one fails, we change one variable (segment, price, signal mix) and run again. If two fail, we stop and rethink.

## The concierge pilot (the heart of the month)

20 families pay $20/month. Behind the scenes it is us, a spreadsheet, and a few scripts. Each parent gets:

- **One signal we control:** a $15 smart plug on the kettle, TV, or bedside lamp (cloud API, no Wi-Fi setup by the parent if we pre-pair it, otherwise a 5-minute call).
- **One signal from the phone, with consent:** a tiny Android app (or, for iPhone/no-smartphone, nothing; the call carries the load).
- **One short daily call or voice message** from a named, saved number, in the parent's language, warm and two minutes long.
- **Every morning the child gets the note:** green dot, two lines, nothing to do. Anomaly: we (humans) check before anything is sent.

Honesty note on signals: WhatsApp "last seen" is not available through any API and we will not scrape it. Signals are only what the parent explicitly gives us.

Budget for the month: about $600–1,200 (plugs, telephony, hosting, small interview incentives).

## Week by week

### Week 1: recruit and discover (days 1–7)

**Founder**
- Build the interview pool: 30 adult children, 15 with a parent abroad (diaspora), 15 domestic. Sources: your own network first, then diaspora Telegram/Facebook/WhatsApp groups, r/AgingParents, LinkedIn. Aim for 40 booked, expect 30 to show.
- Run the first 8 interviews (30 min each, scoring sheet provided by me).
- Talk to 3 parents-of-friends (65+ living alone) about the plug and the call. This is the elder-acceptance check nobody does.
- Time: ~35 h (recruiting 15, interviews 8, elder chats 4, sync and reading 8).

**Tech co-founder**
- Interview script, scoring sheet, and recruitment messages in English, Russian, and two more languages you pick.
- Waitlist landing page with two price points shown to alternating visitors ($19 vs $29).
- Technical spikes: (a) Android background signals and battery cost; (b) smart-plug cloud API choice; (c) branded outbound calling with a saved caller ID in five countries; (d) smart-meter API access in UK, Japan, EU.
- Repo hygiene: weekly review template, decision log.

**Friday review:** interview pool size, first patterns, spike results, go/no-go on the concierge signal mix.

### Week 2: interview, design the pilot, start selling it (days 8–14)

**Founder**
- Interviews 9–22. From the ones who say "when can I start," recruit the 20 pilot families. Charge from day one ($20, refundable, no free tier; the payment is the data).
- Partner outreach: 10 emails to delivery, postal, and security companies in the beachhead country about a welfare-check pilot. Goal: 2 calls booked.
- Order 25 plugs; ship or hand-deliver.
- Time: ~45 h.

**Tech co-founder**
- Pilot operations tooling: family and parent records, daily status board, the note generator, the daily-call script and voice, plug integration, an escalation playbook (family → neighbour → local contact → emergency) with a checklist for us as the humans in the loop.
- Consent and privacy one-pager for parents, in their language.

**Friday review:** interview synthesis (top 5 objections, top 5 "yes" reasons, willingness to pay distribution), pilot roster, tooling demo.

### Week 3: run the pilot (days 15–21)

**Founder**
- Onboard the 20 families: a 15-minute call with each child, a 10-minute call with each parent (in their language where possible). Save our number in the parent's phone during the call.
- Run daily ops with me: review every anomaly before it goes out, log every false alarm, note every parent complaint.
- Partner calls (2), plus 2 interviews with anyone who churned or refused.
- Time: ~50 h (onboarding 15, ops 20, partners 5, interviews 5, sync 5).

**Tech co-founder**
- Run the pipeline every morning; tune the baseline per parent; draft the morning notes for your approval in the first week, then automate.
- Daily metrics: confident-day rate, call answer rate, false alarms, parent opt-outs, note edits you made (each edit is a product lesson).

**Friday review:** first week of live data. Are the notes right? Is anyone annoyed? Did anything scary happen and how did we handle it?

### Week 4: measure and decide (days 22–30)

**Founder**
- Interviews 23–30, prioritising the segment that converted best.
- Retention check-ins with all 20 families at day 14 of their pilot. Ask the one question: "If we stopped tomorrow, how would you feel?"
- 3 conversations with advisors or angels who know ageing, telecom, or diaspora markets. Not fundraising, learning.
- Time: ~40 h.

**Tech co-founder**
- Day-30 report: the three questions answered with numbers; precision and false-alarm rate; what the note must contain; technical feasibility memo; MVP v0 spec and cost estimate.
- Proposed beachhead country pair and segment, with the evidence.

**Day 30 review:** pass, pivot one variable, or stop.

## Founder time budget, per week

| Activity | Hours |
|---|---|
| Interviews and elder conversations | 10–15 |
| Recruiting (pool and pilot families) | 8–12 |
| Pilot operations (weeks 3–4) | 10–20 |
| Partner and advisor outreach | 4–6 |
| Working sessions with me, reading, decisions | 5–8 |

## Weekly cadence

- Monday: 30-minute plan in this repo (`plan/weekly/`), three priorities each.
- Daily (weeks 3–4): 15-minute ops check at the same time every morning.
- Friday: written review, metrics table, decisions logged in `plan/decisions.md`.

## Decisions needed before day 1

1. **Where are you and which languages can you interview in?** This sets the interview pool and the beachhead pair (child's country × parent's country).
2. **Are you willing to be the human in the loop for weeks 3–4?** That means a daily morning check and being reachable if a parent goes quiet. Without this the pilot is not a pilot.
3. **Budget ceiling for the month.** $600 covers the minimum; $1,200 gives interview incentives and spare plugs.
