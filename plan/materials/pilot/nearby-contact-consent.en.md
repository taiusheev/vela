> **Draft for the pilot, not legal advice. To be reviewed by counsel before any public launch.**

# Nearby contact: the consent message and what saying yes means

Version `nearby-consent.v1` · 13 September 2026 · goes with `privacy-notice.v1` · spec §8, §9, §14.3 M6

A nearby contact is one of up to two people living near the person the light is for, whom an organiser would call first on a quiet day. They agree once, through a message sent in the organiser's name. Until they say yes, Vela does not list them, and nobody can use Vela to message them.

## How the message is sent

| Stage | Who sends it | How the answer is recorded |
|---|---|---|
| **Pilot on Telegram and LINE (now)** | The organiser, from their own phone (SMS, LINE, WhatsApp or Telegram), using text A below | The contact replies to the organiser. The organiser forwards the reply (their words or a screenshot) to the founder. The founder adds the contact to Vela **only after a yes**, and records a `consents` row: kind `nearby`, text version `nearby-consent.v1`, the channel used, the date and the contact's words as evidence |
| **In the app (from sprint 3)** | Vela, in the organiser's name, when the organiser saves the contact (text B) | The contact taps a button; `POST /nearby/:token/consent` records consent or decline |

## Text A: sent by the organiser in the pilot

> Hello [contact's name], it's [organiser's name].
>
> Our family uses Vela, a small service: each morning someone in the family sends [Name] a question, and when [Name] answers, we know all is well.
>
> You live near [Name]. On a day when [Name] hasn't answered and I can't get through, could I ask you to go round? I would always ask you myself. Vela never contacts you on its own.
>
> If you say yes, I'll give Vela your name, your phone number and how you know [Name]. Vela uses them only to show them to me [and to (other organiser's name)] on a day like that. You can say no, or change your mind at any time, and nothing changes between us.
>
> Vela is a pilot run by [FOUNDER FULL NAME]. How your details are used: [PRIVACY NOTICE LINK]
>
> Would that be all right? Just reply yes or no.

## Text B: sent by Vela in the organiser's name (app, sprint 3)

> [Organiser's name] asks: you live near [Name]. On a day when [Name] hasn't answered and [organiser's name] can't get through, may [organiser's name] ask you to go round?
>
> [Organiser's name] added your name and number to Vela so they can reach you on a day like that. Vela never contacts you on its own; any request comes from [organiser's name]. You can say no, or change your mind at any time.
>
> Vela is a pilot run by [FOUNDER FULL NAME]. How your details are used: [PRIVACY NOTICE LINK]
>
> Buttons: **Yes, I'm happy to** · **No, thank you**

## What saying yes means

**What Vela keeps:** your name, how you know [Name], your phone number, the messaging app you use, and when and how you said yes.

**Who sees it:** only the organisers of [Name]'s family. Vela's AI never sees your phone number. You will not see [Name]'s messages or answers, and nothing about [Name]'s days is shared with you.

**When you might hear from the family:** only on a day when [Name] has not answered, and only if an organiser decides to ask you. We expect this to be rare. In the pilot, the organiser calls or messages you directly. Later, in the app, you may receive a message sent in the organiser's name, such as:

> [Organiser's name] asks: could you look in on [Name] today? [Name] hasn't answered this morning.
>
> Buttons: **I'll look in** · **Can't today**

Your answer goes to the organiser.

**What you are not agreeing to:** you are not responsible for [Name]. "Can't today" is always a good answer, and nobody will ask why. Vela does not send you reminders, updates or anything else. If you ever think someone is in danger, call emergency services first (119 in Taiwan, 911 in the United States, 112 in Europe); Vela is not an emergency service.

**How long:** until you or the organiser remove you, or [Name]'s family leaves Vela. Then your details are deleted (see "How long we keep it" in the privacy notice).

**Changing your mind:** tell the organiser, or write to the founder at [CONTACT ADDRESS]. Your details are removed within 7 days, and nobody uses Vela to contact you again.

**Your rights:** you can see, correct or delete what Vela holds about you at any time, free of charge (privacy notice, "Your rights").

## What saying no means

Nothing is stored. In the pilot, the founder never receives your details. In the app, your name and number are deleted as soon as you decline, and if you do not answer within 14 days they are deleted too, and the request is not repeated. The organiser may still call you as a friend or neighbour, as they always could.

## Notes for the founder

- A contact who has not said yes is never added to Vela in the pilot, and never appears in a notice on a quiet day.
- The organiser must be the one who knows the contact. Vela never recruits contacts.
- Record the text version, the channel, the date and the contact's exact words. If the contact asks a question the text does not answer, answer it before recording consent.
- Changing this text in a way that changes its meaning needs a new version and a new yes from contacts already recorded.
