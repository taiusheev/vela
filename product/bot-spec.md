# Vela pilot bot: behaviour spec

v1, 2026-09-11. This is what the Telegram bot does during the 30-day pilot. It is deliberately small. Everything not listed here, it does not do.

## Three people, one bot

| Who | How they meet the bot | What they see |
|---|---|---|
| **Parent** ("Галина Петровна") | Child sends her a link; she taps Start | One morning message a day, one big button, a warm reply if she writes back |
| **Child** ("Аня", abroad) | Taps Start, answers five questions, gets the link for her mother | One note a day at 09:00 her time; a message only if the ladder reaches the top |
| **Founder** (you) | Private admin chat with the bot | Every anomaly, every escalation, a daily digest, and every conversation in week three |

## Onboarding

**Child** (in Russian or English, chosen from Telegram's language setting; can switch with /lang):
1. Your name.
2. Parent's name and how she likes to be addressed (name + patronymic, or "мама").
3. Parent's city (for time zone and weather).
4. What time she usually wakes up. We message 30 minutes after that.
5. Your own time zone for the 09:00 note.
Then: a one-time link to forward to the parent, and the parent explainer text to send alongside it.

**Parent**: taps the link. The bot says, in warm Russian: "Здравствуйте, Галина Петровна. Аня попросила меня желать вам доброго утра. Каждый день в 8:30 я буду спрашивать, как вы. Нажмите «Всё хорошо» или напишите пару слов. Если не хотите, скажите «не надо», и я перестану." One button: «Понятно». That is the whole setup. No account, no password, nothing to install.

## The daily loop (parent's local time)

| Time | Event |
|---|---|
| wake + 0:30 | Morning message. Text varies daily (the AI writes it from a small set of templates plus yesterday's context and today's weather). One button: «Всё хорошо ☀️». Voice or text replies welcome. |
| reply | AI replies in two lines, warm, specific to what she said. Never asks more than one question. Never gives medical advice. Ends the exchange naturally; it does not chat indefinitely (max 4 turns, then "хорошего дня"). |
| wake + 3:00, no reply | Second message, gentler: "Галина Петровна, вы там? Просто нажмите кнопку, когда увидите." |
| wake + 5:30, no reply | Founder gets an anomaly card in the admin chat: parent, last reply, plug signal if any, buttons: «Написать дочери» / «Подождать 2 часа» / «Отметить: всё в порядке». Nothing goes to the child automatically. |
| founder taps «Написать дочери» | Child gets: "Мама сегодня не ответила на утреннее сообщение (обычно отвечает к 9:00). Ничего страшного пока не известно. Может, позвоните?" |
| any time, parent replies late | Ladder resets; child's note updates if not yet sent; founder card auto-closes. |
| when the parent replies (never before 07:00 child local) | The child's note (see below). If the parent stays quiet, the child hears nothing until the founder decides. |
| child's 07:00 onward | Retry window: if the note could not go out earlier because it was night for the child, it goes now. |

Weekends are the same. Holidays are the same. Quiet is the product.

## The child's morning note

Two lines, generated from: reply time, reply content (summarised, never quoted verbatim without the parent's consent in onboarding), plug signal if present, and yesterday's context.

- Green: "Мама ответила в 8:12. Спала нормально, собирается на рынок. Ничего делать не нужно."
- Green, thin signal: "Мама нажала «всё хорошо» в 8:40. Ничего делать не нужно."
- Yellow (only after the founder decided): "Мама сегодня пока не ответила. Мы написали ей ещё раз. Позвоните, если хочется спокойствия."
- Never red from the bot. Red is a human call.

The child can reply to the note with a voice or text message for the parent; the bot delivers it with the next morning message ("Аня передаёт: …"). This is the one feature that makes the bot feel like a bridge instead of a monitor.

## What the AI may and may not do (system rules)

May: greet, ask how she slept, react to plans, mention the weather in her city, remember what she said yesterday and the day before, pass on the child's message, say goodbye.

May not: give medical, legal, or financial advice; discuss medication beyond "напомнить, что дочь просила спросить"; continue past four turns; pretend to be human if asked ("Я помощник, которого попросила Аня"); mention anything about monitoring, sensors, or data.

Must escalate to the founder immediately (admin card, no reply to the parent beyond a warm acknowledgement) on: any mention of pain, a fall, dizziness, chest, breathing, not eating, feeling hopeless or not wanting to live, someone at the door she doesn't know, a request for money or a "bank employee" call. The founder decides what reaches the child.

Language: the parent's language, matched from her first message; Russian by default. Address form: as configured by the child (вы + имя-отчество by default).

## Optional plug

If a family adds a Tuya smart plug: the bot reads on/off events via the Tuya cloud API. A kettle or lamp switching on before the morning message counts as "awake" and softens the ladder (second message skipped; founder card still fires at +5:30 if no reply and no plug activity since wake). The parent never interacts with the plug.

## Admin chat (founder)

- /families: list with today's status (green, waiting, escalated, paused).
- /digest at a fixed evening time: replies today, average reply time, anomalies opened and how they closed, opt-outs, AI turns per parent.
- Week three only: every parent conversation forwarded in full, so you can read what the AI actually said.
- Every note you edit before it goes out is stored as (draft, final); that diff is the spec for the real product.

## Data we keep

Parent: first name and address form, city, wake time, Telegram chat id, reply timestamps, the last 7 days of conversation text (rolling; older is deleted), plug events if any.
Child: name, Telegram chat id, time zone, notes sent.
Nothing medical is asked or stored. /stop from either side pauses everything; /delete erases the family within 24 hours.

## Not in the pilot

No app, no web dashboard for the child, no payments in the bot (payment is a manual transfer to the founder), no WhatsApp, no phone calls, no fall detection, no health questions, no more than one parent per child, no more than one child per parent.
