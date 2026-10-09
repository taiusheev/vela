# First families: the founder's runbook

10 October 2026. For the founder, during the English trial (plan/english-trial-readiness.md). It is the short operating page on top of the full consent pack in [`../pilot/README.md`](../pilot/README.md), which stays the authority on who can join and the onboarding order. Each step below names what to do, where, and what "good" looks like.

## Who to invite

- An adult child (the organiser) who already worries about a parent living alone and has an iPhone.
- The parent uses Telegram on their own phone, reads English comfortably, and would tap a button or send a short message once a day.
- At least one more relative who will take turns asking. A family with only one asker runs dry by week two.
- Not this cohort: a parent who has not heard of Vela from their own child, anyone the pilot pack's "Who can join" excludes, or the founder's own parent.

Aim for 3–5 families. Book a 30-minute call with each organiser and a 15-minute call with each parent.

## Before the organiser call (10 minutes)

1. The family's Telegram IDs are on the approved roster (engineering adds them; ask Claude in chat).
2. Production `/healthz` is green and `/admin/trial` opens.
3. Have open: the organiser agreement, the privacy notice and the [consent script](../pilot/consent-script.en.md).

## The organiser call (30 minutes)

| Minutes | What | Good looks like |
|---|---|---|
| 0–5 | Why they want it. Ask: "When did you last worry because she didn't pick up?" Write down the answer in their words (private notes, family code only). | A specific recent moment |
| 5–10 | The promise, honestly: one ask a day from the family, her one-tap answer lights the light, a calm notice if a morning stays quiet. Vela is not an emergency service. | They can say it back in one sentence |
| 10–20 | Setup together: `/start` with the bot (her name, greeting, time zone, wake time), create the family group with relatives only, add the bot, install the app from TestFlight and connect the Telegram family. | Group shows Vela's first message; app shows Today |
| 20–25 | Who asks: agree the turn order in the group and write tomorrow's first ask together. Show the evening prompt and its idea. | First ask queued for her first morning |
| 25–30 | What happens on a quiet morning, nearby contacts (names only for now), away dates. Book the parent call within 7 days. | They know the one thing to do when a notice comes |

## The parent call (15 minutes)

Use the [consent script](../pilot/consent-script.en.md) word for word. The organiser speaks to her before you do. She taps **Yes** herself. Ask the health-words question only as the script says. UCLA-3 only after a separate yes.

Good looks like: she knows a message comes each morning from her family, that answering takes one tap, that she can always ask what the family sees, and that "stop" stops it.

## The first two weeks

Look at `/admin/trial?days=7` each morning after her arrival hour (two minutes). Act only on what the table says.

| Day | Check | If it is not right |
|---|---|---|
| 1 | Arrival delivered on time; she answered; the answer reached the group | Not delivered: check the admin family page and tell Claude. Not answered by evening: the organiser asks her by phone if the message arrived (never "why didn't you answer") |
| 2 | Yesterday's replies were read to her this morning ("Replies heard") | Nobody replied: nudge the organiser once: "A one-line reply to her answer is what she hears tomorrow" |
| 3 | Fallback share is 0: someone asked each evening | Message the turn holder privately with tomorrow's idea from the evening prompt |
| 7 | Seven-day numbers: answer rate, fallback share, replies heard. 10-minute call with the organiser: what was the best moment, what annoyed them | Write each annoyance in the AGENT-CLAIMS notes for Claude and Codex |
| 14 | Learning period ends: quiet notices start to push. Call: "If Vela stopped tomorrow, how would you feel?" (very / somewhat / not disappointed) | Answer rate under 50%: talk to the organiser about her hour and the ask types she likes |
| 30 | 30-day numbers; day-30 call: the same question, and "would you pay US$9.99 a month for the light?" (yes / no / maybe) | Record answers without quotes under the family code |

## Reading the numbers

`/admin/trial` judges each number against its target and says "too early" until there is enough data.

| Number | On track | Act when |
|---|---|---|
| Days she answers (outside away days) | ≥ 75% | Under 50% for a week: change her arrival hour or the kind of asks; never ask her to answer more |
| Quiet notices marked useful | > 60% | Under 30%: tell Claude; the threshold or the copy is wrong |
| Notices per 30 days | < 4 | 4 or more after day 14: tell Claude with the family code |
| Real trouble missed | 0 | Any: stop and call Claude at once; this pauses new families |
| She said stop | 0 | Call the organiser the same day; never contact her to change her mind |
| Mornings nobody asked | < 15% | Over 30%: the family needs a second asker; ask the organiser who else could take turns |
| Answered days with replies heard | ≥ 50% | Under 50%: remind the family that their reply is what she hears next morning |

## Never

- Never tell her she missed a day, and never let the family say "you didn't answer".
- Never contact a nearby contact yourself; only the organiser does, by their own tap.
- Never paste her words into notes, chats or issues. Family code and counts only.
- Never promise the book, recipes, memory or voice line; they are off in this trial.
