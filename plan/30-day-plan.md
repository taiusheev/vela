# Vela: 30-day validation plan

v2, 2026-09-11. Founder: business side, based in Taiwan, interviews in Russian and English, student budget, runs daily pilot ops. Tech co-founder: everything technical, always on.

Changes from v1: beachhead fixed to Russian-speaking children abroad with a parent in Russia/CIS; Telegram replaces phone calls and plugs as the primary channel; survey added as the top of the funnel; budget cut to under $50.

## Why this beachhead

- You are the customer. Founder-market fit is the cheapest advantage there is.
- The post-2022 emigration wave put roughly a million Russian speakers in Georgia, Serbia, Kazakhstan, Turkey, Cyprus, Thailand, Taiwan, Bali, Germany, Israel. Their parents stayed. Flights are long, visits are rare, worry is constant, and there is no product for them.
- They pay in hard currency abroad; the parent never pays. Nothing in the pilot touches Russian payment rails.
- Russian parents 65–80 already use Telegram or WhatsApp daily. A daily message from a bot is normal; a pendant is not.
- Second segment, later: Taiwan itself became super-aged in 2025. Your Taiwanese friends are the interview pool for wave two; a Traditional Chinese survey is included so you can test the water for free.

## What 30 days must answer

| Question | Evidence by day 30 | Kill signal |
|---|---|---|
| 1. Will children abroad pay $15–25/month for a daily "mom is fine"? | 100+ survey responses, 20 interviews, ≥8 families paying in the pilot | <4 paying after 20 interviews |
| 2. Will parents accept a daily Telegram exchange with a warm AI? | Parent opt-out rate; reply rate; what they say | >30% refuse or stop replying in week one |
| 3. Can we produce a trustworthy daily signal from Telegram alone (plus an optional plug)? | Confident-day rate; false alarms per family per week | <70% confident days, or >1 false alarm per family per week |

Pass all three: day 31 starts the MVP build. Fail one: change one variable and rerun. Fail two: stop and rethink.

## The pilot, zero-hardware version

15 families, $15/month (or a one-time $30 for the pilot; refundable). Behind it: a Telegram bot, Claude, a spreadsheet, and you.

**Parent side, every morning at a time she chooses:**
"Доброе утро, Галина Петровна. Как спалось?" with one big button, "Всё хорошо", and the option to reply by voice. The AI answers warmly in two lines, remembers yesterday, never lectures. If no reply by late morning, a gentle second message. If still nothing by early afternoon, you get a note, you decide, and only then does the child hear anything.

**Child side, every morning at 9:00 their time:**
A green dot and two lines. "Мама ответила в 8:12, спала нормально, собирается на дачу. Ничего делать не нужно." On a quiet day, that is the entire product.

**Optional plug (only if a family asks):** a Tuya smart plug on the kettle, bought by the child on Ozon or Wildberries for about 600 RUB, delivered to the parent. Gives us a second signal without the parent doing anything.

**Humans in the loop:** you review every anomaly before it reaches a child. Every false alarm, every parent complaint, every edit you make to a morning note gets logged. Those logs are the product spec.

## Budget

| Item | Cost |
|---|---|
| Telegram bot | $0 |
| Google Forms survey, Sheets as the ops board | $0 |
| Hosting (Cloudflare Workers or Supabase free tier) | $0 |
| Claude API for daily conversations, 15 parents × 30 days | ~$5–10 |
| Domain for the waitlist page (optional) | ~$10 |
| Plugs (optional, only if a family asks; child buys) | $0 to us |
| **Total** | **under $25** |

Interview incentives: none. People with this worry want to talk; the survey ends with "would you like to talk for 20 minutes?" and that converts.

## Week by week

### Week 1: survey out, first interviews, bot skeleton (days 1–7)

**Founder**
- Post the survey (Russian and English versions in `plan/materials/`) in Russian-speaking relocation groups on Telegram: Taiwan, Georgia, Serbia, Kazakhstan, Turkey, Cyprus, Thailand, Bali, Germany, Israel. Post the English version on r/AgingParents and Taiwan expat groups. Target: 100 responses by day 10.
- Book and run the first 6 interviews from survey respondents who opted in. Script in `plan/materials/`.
- Talk to your own parent (or a friend's) about the morning message. Show them a mock. This is the elder-acceptance check that nobody in this industry does.
- Time: ~30 h.

**Tech co-founder**
- Survey (RU, EN, ZH-TW), interview script with scoring, recruitment posts, one-page explainer for parents (RU). Done today.
- Telegram bot skeleton: onboarding for parent and child, the morning message, the button, voice-note transcription, the AI reply, the "no reply" ladder, the child's morning note.
- Ops board in Google Sheets: one row per family, daily status, anomaly log, false-alarm log.
- Spike: is Telegram alone enough, or do we need WhatsApp too? (WhatsApp Business API costs money and needs Meta approval; we start Telegram-only and record how many parents are WhatsApp-only.)

**Friday review:** survey count and early patterns, interview notes, bot demo on your phone.

### Week 2: interviews, close pilot families, bot ready (days 8–14)

**Founder**
- Interviews 7–16. Every interview ends with the offer: "We are starting a small pilot next week, $15 for the month, refundable. Want in?" Collect payment on the spot (Wise, PayPal, Revolut; whatever the interviewee already has).
- First 10 pilot families confirmed, parents' names and morning times collected.
- Time: ~40 h.

**Tech co-founder**
- Bot finished and tested with your own parent for three days before anyone else.
- Onboarding checklist for you: what to say to the child (5 min), what to say to the parent (5 min, in Russian, warm, "your daughter asked us to say good morning").
- Escalation playbook: reply ladder timings, what you check, when you message the child, what you never do.

**Friday review:** interview synthesis (top objections, top reasons to say yes, price points people named), pilot roster, bot walkthrough.

### Week 3: pilot live (days 15–21)

**Founder**
- Onboard 10–15 families. Send the parent explainer, do the parent call yourself for the first five, then let the bot's onboarding handle the rest and see if it works without you.
- Daily ops at a fixed morning time: review anomalies, approve notes for the first days, log everything.
- Interviews 17–20 with anyone who declined the pilot. Their reasons matter more than the yeses.
- Time: ~45 h.

**Tech co-founder**
- Run the pipeline daily, tune each parent's baseline, draft morning notes for your approval, then automate once your edit rate drops.
- Daily metrics in the ops board: reply rate, reply time, confident-day rate, false alarms, opt-outs, note edits.

**Friday review:** first live week. What did parents actually say to the bot? Did any child feel spied on or nagged? Did anything scary happen?

### Week 4: measure, decide (days 22–30)

**Founder**
- Day-14 check-in with every family, one question: "If we stopped tomorrow, how would you feel?" Record the exact words.
- Ask each paying family for two introductions.
- Three conversations with people who know ageing, Telegram products, or the Russian diaspora. Learning, not fundraising.
- Time: ~35 h.

**Tech co-founder**
- Day-30 report: the three questions answered with numbers; what the morning message must say; what parents said in their own words; technical feasibility; MVP v0 spec and cost.
- Recommendation: continue, pivot one variable, or stop.

## Founder time budget, per week

| Activity | Hours |
|---|---|
| Survey distribution and community posting | 5–8 |
| Interviews | 8–12 |
| Pilot onboarding and daily ops (weeks 3–4) | 10–20 |
| Elder conversations and parent explainer testing | 3–5 |
| Working sessions with me, reading, decisions | 5–8 |

## Cadence

- Monday: 30-minute plan, three priorities each, in `plan/weekly/`.
- Daily in weeks 3–4: 15-minute ops check at the same morning time.
- Friday: written review with the metrics table; decisions in `plan/decisions.md`.

## Risks specific to this beachhead

- **Telephony and payments into Russia** are avoided entirely by design: Telegram carries the parent side, the child abroad pays.
- **Russian data-localisation law** could apply to personal data of Russian citizens. Pilot mitigation: store the minimum (first name, morning time, reply timestamps), no health data, delete on request. Legal review before the real launch.
- **Parents on WhatsApp only:** we count them; if it is more than half, WhatsApp Business API goes into the MVP.
- **The AI says something wrong to a lonely parent:** every conversation is logged, you read them daily in week three, and the bot is scoped to small talk, sleep, plans, and weather, with hard rules to escalate to you on anything medical or dark.
