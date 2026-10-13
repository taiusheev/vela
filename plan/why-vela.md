# Why a family would use Vela, why not just the messenger, and what we focus on

Written 13 October 2026 by Claude (tech co-founder), at the founder's request: "think as our consumers… make sure all answers are based on something, not your opinion." Every claim below names its source: a report in `research/` (about 700 sources, September 2026) or a web source checked today. Where no evidence exists, this says so instead of guessing.

**One-line answer.** Families already have the messenger. What they lack is someone noticing when a parent goes quiet, and a reason for her to answer that isn't a check. Vela sits inside the messenger and does both. Today we have no moat. The only moat open to us is one that real families build by using Vela: a record of how often our notices were right, each family's own history, and the relatives they invite.

## 1. The two consumers and the job each hires Vela for

### The organiser (adult child; pays)

| Evidence | Source |
|---|---|
| Long-distance caregivers report the most emotional distress of any caregiver group: 47%. | research/13 row 28 (caregiver.org/AARP) |
| On days after worrying about a parent, adults report more comfort eating. The worry is a daily cost. | research/11 row 20 (Fingerman et al.) |
| 23.3% of Taiwan's 65+ live alone (~977,000 people); the health ministry reaches only ~50,000 of them. | research/13 rows 9–10 |
| Demand for "someone notices if I go silent" is mass-market. "Are You Dead?" is one button pressed every two days, with an email to a contact after two missed days. It topped China's paid App Store chart on 10–11 January 2026 and was removed on 15 January. | [Wikipedia](https://en.wikipedia.org/wiki/Are_You_Dead%3F) |
| The people who pay are paying for the human step. Snug's free tier is a tap; its US$19.99/month tier adds a live call and a wellness check. | research/07 |
| What families use today is the group chat. LINE reaches 93% of 15–65 year olds in Taiwan; in one UK survey 83% check a family group chat daily. | research/13 rows 13, 37 |

**The job:** *know every day that she is OK, without making her feel watched, and without me having to remember to check.*

### The parent (answers; does not pay)

| Evidence | Source |
|---|---|
| Parents reject monitoring their children would accept: cameras 10% of mothers vs 70% of their children. 30–40% of invited 65+ refuse anything framed as monitoring. | research/11 row 1; research/08 row 31 |
| They do want family, above all grandchildren. In family WhatsApp groups, grandparents mostly react to grandchildren's content. | research/08 row 37 |
| Being asked about her own life helps her. Life-review and reminiscence have a large effect on depression in older adults (g = 1.41). | research/11 row 18 |
| A question from a person, answered when she likes, works best. 75+ answer asynchronous prompts 64% of the time vs 27% for live automated calls. Morning prompts beat evening ones by 18%. | research/08 |
| Tapping is the reliable gesture. A LINE check-in bot got 93.4% response; only 19% of Russians 60+ send voice messages at all. | research/10, research/14 |
| Unanswered messages hurt. In a 2025 study, a grandmother read "seen, no reply" as being ignored. | [Frontiers in Sociology 2025](https://www.frontiersin.org/journals/sociology/articles/10.3389/fsoc.2025.1643296/full) |

**The job:** *hear from my family and be asked about my life, without being a burden or a patient.*

## 2. Why not just the messenger?

**Where the messenger wins.** It needs no install, everyone is already in it, and it is free. Every dedicated family network that tried to replace the group chat died: Path burned US$66M, and Cocoon, 23snaps, Notabli and Lifecake all went the same way (research/12). So Vela must never be "a better family chat." It lives inside the messenger and does four things the messenger does not.

| The messenger | Vela | Evidence |
|---|---|---|
| **Silence has no owner and no meaning.** A quiet parent is just no new message. "Last seen" and read receipts show app activity, not how she is, and she can hide them. LINE is now testing reading without the 已讀 receipt (Japan, 7 October 2026). | One daily answer is the signal. Vela learns her usual answer time and tells one person only when today is unusual. | [Internet Matters](https://www.internetmatters.org/resources/whatsapp-safety-a-how-to-guide-for-parents/); [ETtoday, 7 Oct 2026](https://ettoday.net/news/20261007/3250729.htm); research/08 |
| A naive "no message by 10:00" rule would cry wolf. | The threshold comes from her own rhythm. The first 14 days are a learning period. Delivery failures never count as silence. | Even willing 70+ skip 20–35% of daily prompts, so a fixed-hour alert fires 5–7 times a month (research/08, research/14) |
| **Asking is nobody's job.** Group chats run on one or two "kinkeepers" while others go quiet ("flickerers"). Family apps collapse when the one poster stops. | Each evening names whose turn it is and offers an idea. When nobody asks, Vela asks a question from its bank. | [Israel three-generation WhatsApp study](https://www.researchgate.net/publication/379132073_It's_just_a_technological_version_of_us_Three-generation_family_WhatsApp_groups_in_Israel); research/12 |
| **Her messages go unanswered.** | The family's replies to her answer open her next morning. | Reciprocity is what keeps elders answering (research/08 §3) |
| **A check-in is a check.** Snug and "Are You Dead?" suit people who choose to be checked. | Her sign of life is a by-product of a question from a person she loves. | 30–40% of 65+ refuse a monitoring frame (research/08); a bare "OK?" LINE bot drew users of whom only 26% were 65+ (research/07, Enrich) |

**The honest limit.** A very disciplined family could do rows 3 and 4 by hand. Only row 1 is something the messenger cannot do at all. And Vela only beats a check-in app while her answers carry something. If her mornings drift into a bare "I'm fine" tap, Vela becomes a check-in app inside Telegram, which anyone can build. "Are You Dead?" came from a company with ¥100,000 registered capital, and copycats such as "Alive?" followed within days ([Wikipedia](https://en.wikipedia.org/wiki/Are_You_Dead%3F); [App Store](https://apps.apple.com/us/app/-/id6757625829)). Until 13 October 2026 we did not measure that drift; §5 adds the measure.

## 3. What is our moat?

**Today: none.** No real family has used production yet (the Vietnam family starts this week). Every feature can be copied:

- A messenger bot is cheap to build (above).
- In India, AskDiya (a WhatsApp helper for parents) and Amma Check-in (daily calls, open source) already exist ([askdiya.in](https://www.askdiya.in/); [GitHub](https://github.com/shivam8897/amma-checkin)).
- Platforms copy and kill partners. Facebook copied Path's differentiators (research/12), and Alexa Together's shutdown took Vayyar's consumer product with it (research/00).

What can become a moat. Each is earned only by families using Vela, so none exists until they do:

1. **A public record of being right.** Nobody in this category publishes precision. Seoul's smart-plug programme turned 46,974 signals into 154 interventions (0.3%), and about 80% of bed alarms are false (research/00). Every Vela notice is labelled useful or not by the organiser, and the monthly precision page is already built (`/how-vela-is-doing`). Trust compounds; a copycat starts at zero.
2. **Each family's own history.** Her learned rhythm sharpens every week, and her answers, voice and stories accumulate. History is a switching cost: Tinybeans keeps 88% of premium subscribers for 12 months, and Famileo reports "low churn" (research/12).
3. **The family network inside each family.** Siblings and grandchildren join through the organiser. 50% of Aura's sales come through family invites, Famileo has about 8 active users per paying family, and 70% of its growth is word of mouth (research/07, research/08).
4. **A head start on LINE in Taiwan.** A search today found no LINE product built around a family's daily question. That is a lead, not a moat; it lasts until someone else ships.

## 4. The one problem to solve best in the world

> **When a parent who lives alone goes quiet, her family knows the same day, and only when it means something. Every other day, they hear from her because she wanted to answer.**

The two halves run on one engine. The same daily answer is both the sign of life and the family conversation. "Best in the world" means numbers nobody in the category publishes, each against a target from the evidence (plan/product-week.md, research/14):

| Number | Target | Why it matters |
|---|---|---|
| Days she answers | ≥ 75% in weeks 1–4; ≥ 65% at week 12; kill < 50% | The engine (EMA decay curves, research/08) |
| Quiet notices marked useful | > 60%, fewer than 4 a month | Trust; the thing families pay for |
| Missed real trouble | 0 | The promise |
| Parent stop rate | < 10% in month 1 | Acceptance (research/11) |
| Replies heard next morning | ≥ 50% of answered days | Reciprocity keeps her answering (research/08) |
| **Days she said something** (new) | No published benchmark. Watch the trend from day 1 and set a target after week 4. | Separates an exchange from a check-in (§2) |

Same-day is the honest promise. Vela cannot find a fall in minutes; nothing short of a worn device does (research/00). What Vela can change is days into hours. In Japan, 21,856 people who died alone at home in 2024 were found after eight days or more, and a long lie's mortality rises from 12% when found within an hour to 67% after 72 hours (research/00).

## 5. Plan

**This week, before the Vietnam family's first morning**

1. *Done in this change.* The trial report gains "Days she said something": answered days where she gave words, voice, a photo, or a choice, rather than only ❤️ or "I'm fine". It counts answer kinds only, never content. From day one we can see whether Vela is an exchange or a check-in.
2. *Next.* Vela's own question gets one-tap answers too. On mornings no one asks, Vela sends a question from its bank with only ❤️ and "I'm fine" under it, while family questions get three drafted one-tap options (spec §5.3, `chips.v1`). The bank question should get the same treatment, so the easiest tap on a quiet-family morning still says something. This goes to staging first and to production only on the founder's go.
3. *Founder.* Start the Vietnam week. On days 7 and 14, ask yourself the organiser question: "If Vela stopped tomorrow, how would you feel?" (research/14 §4). Then ask your parent which mornings she liked answering, and which felt like a chore.

**Weeks 1–4 (Vietnam family, then 3–5 English-speaking families)**

- Read the six numbers every Monday on `/admin/trial`, and fix only what moves them.
- Then a gate before the Taiwan LINE launch: answer days ≥ 75%, useful notices > 60%, no missed trouble, and "said something" not falling.

**Not until the gate is met**

No new feature outside the loop: family book, recipes, memory, kitchen table, voice line, more weekly-read analysis. What is built stays as it is. Evidence: the products that last pair the daily ritual with a real utility (research/12), and ours is the signal. Extras before the engine is proven are guesses.

## 6. Gaps we cannot close from published data

- No study measures a family-question loop's answer rate. The Vietnam week is the first real number (research/08 §4).
- No study compares a bare tap with a content answer for retention. "Said something" is our own measure, and its target must come from our own weeks.
- No Taiwan- or Vietnam-specific willingness-to-pay data exists (research/14 §5).
