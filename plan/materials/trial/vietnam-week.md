# The Vietnam week: the founder's own family, Telegram only

13 October 2026. For the founder. Seven mornings with the founder's own family in Vietnam on production (`@VelaLightbot`), before any friend's family. The founder's decision to start, and the open items they accepted for this week, are recorded in [`../../english-trial-readiness.md`](../../english-trial-readiness.md). The founder is the organiser, from Taipei. There is no iPhone app this week, so the whole loop runs in Telegram: the turn prompt, asks, the answer, replies, the read-back, the quiet note and the weekly read. [`first-families.md`](first-families.md) stays the guide for friends' families.

## Times

Vietnam is `Asia/Ho_Chi_Minh` (UTC+7) and Taipei is UTC+8, so Taipei is one hour ahead all year.

| What | Your parent's time (Vietnam) | Your time (Taipei) |
|---|---|---|
| Turn prompt in the family group | 19:00 | 20:00 |
| Last moment for tomorrow's ask | 22:00 | 23:00 |
| Their morning message | their wake time + 30 min | one hour later |
| Sent again if they have not answered | 2 h 30 after the morning message | |
| Quiet note to you (first 14 days) | 8 h after the morning message | |
| Weekly read draft to your admin chat | Sunday 18:00 | Sunday 19:00 |

Their first morning is the day after they tap **Yes**. A Yes after 22:00 their time still starts the next morning, but usually with Vela's own question, because tomorrow's ask closes at 22:00.

## Before the setup day (about 30 minutes, any day this week)

1. **Production backup drill** ([`infra/runbooks/restore-drill.md`](../../../infra/runbooks/restore-drill.md), about 20 minutes in the Neon console, Claude guides). Production holds no family yet, so this is the cheapest moment. Note the Neon plan's restore window: on the Free plan it is 6 hours.
2. **Every adult approved.** Your parent and each relative who will be in the group opens `https://t.me/VelaLightbot`, presses **Start** and sends you the number the bot shows. Approve each number on the admin page, **Trial roster** (`/admin/roster`). The bot does nothing for a number that is not on the roster, and a relative who is not approved cannot ask or reply.
3. **Each relative gets the privacy notice** (`https://vela.vela-light.workers.dev/privacy`) from you, individually, before you add them to the group.
4. **You tell your parent about it yourself** and book ten minutes on the phone for the setup day. Note in your private "Vela pilot" notes, under the family code: where each adult lives, the citizenship answers, and the date of your decision.

## The setup day (the day before their first morning)

1. **Your setup, in your own chat with `@VelaLightbot`.** Send `/start` and answer: what you call them; how Vela greets them each morning; English; Vietnam; their usual wake time (their message comes 30 minutes later); nearby contacts: **Skip** for this week. Keep the invite link from the last message. It works for 7 days. Do not send it yet.
2. **The family group.** Create a Telegram group with the relatives, without your parent, and add `@VelaLightbot`. Vela posts "Hello, family. I'm Vela." with a button **I've read it**: each adult taps it once. Optional: make the bot an administrator with every permission switched off, so ❤️ reactions count. If Vela says "Only the family organiser can connect Vela to a group", remove the bot and add it again; it means step 1 was not finished.
3. **The call with your parent**, before 19:00 their time if you can, using the [consent script](../pilot/consent-script.en.md) (Vietnam's emergency number for an ambulance is 115). At the end, send them the invite link. They tap it, tap **Start**, then tap **Yes, that's fine** themselves, and a moment later answer the health-words question as they like. You get "<name> said yes. The first morning arrives tomorrow at …". If instead they see "Your light is not on yet", their number or yours is not on the roster.
4. **The first ask.** At 19:00 their time Vela posts in the group whose turn it is, with an idea. The turn holder replies to that message with a question, a photo, two photos to choose between, or a voice note. Anyone can also send `/ask` and a question in the group at any time before 22:00 their time. If nobody asks, Vela sends one of its own questions, signed "Vela, from your family".

## Each day (2 minutes, after their morning)

Open `/admin/trial?days=7`, then the family's **Test week** page (from the family page). Act only on what they say.

| Day | Good looks like | If not |
|---|---|---|
| 1 | The morning arrived on time, they answered, "☀️ <name> answered …" reached the group | Not arrived or arrived twice: tell Claude at once. Not answered by evening: call them and ask if the message arrived, never why they did not answer |
| 2 | Yesterday's replies came first in their morning ("From your family:") | Nobody replied: remind the group that a reply to their answer is what they hear next |
| 3 | Someone in the family asked; no Vela question needed | Message tomorrow's turn holder privately with the idea from the evening prompt |
| 4–6 | Try what the week should prove (below) | |
| 7 | Seven mornings delivered on the Test week page; ten-minute call with your parent and one relative: the best moment, and what annoyed them | Write each annoyance in the AGENT-CLAIMS notes, without anyone's words |

## What the week should prove

Each of these once, at a natural moment:

- A family reply to their answer, read back to them the next morning.
- A photo ask, a two-photo choice and a voice-note ask.
- Your parent writes "what does the family see" and gets what the family saw.
- On Sunday, the weekly read draft link in your admin chat: open it, check it, tap **Send**.
- Only if your parent is happy to: they write `stop`, and later `start`.
- Only if agreed with your parent in advance: one quiet morning. You should get exactly one calm note about 8 hours after the morning message; tap "<name> is fine, I know why".

## Tell Claude at once

- A morning that did not arrive, arrived twice, or arrived at the wrong time.
- An answer that did not reach the group, or a reply that was not read back.
- A quiet note on a day they had answered. This pauses the week until it is fixed.
- Any admin message in your chat about failed arrivals, dropped sends, missed scheduler runs, dead letters or AI failing.
- Anything your parent or a relative found confusing: what happened and when, never their words.

Your admin alerts and your organiser messages arrive in the same chat with `@VelaLightbot`, because you are both founder and organiser this week. That is expected.

## Never

- Never tell them they missed a day, and never let the family say "you didn't answer".
- Never paste their words into notes, chats or issues. Family code, dates and counts only.
- Never promise the book, recipes, memory, the voice line or the iPhone app; they are off this week.

## After the seven mornings

Read the seven-day numbers with Claude, fix what failed, and decide on the first Taiwan family ([`first-families.md`](first-families.md)). Before friends' families: the TestFlight build, and a lawyer's view of any family with a Russian citizen.
