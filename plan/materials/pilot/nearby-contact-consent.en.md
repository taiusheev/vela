> **Draft for the pilot, not legal advice. To be reviewed by counsel before any public launch.**

# Nearby contact: the consent message and what saying yes means

Version `nearby-consent.v1` · 17 September 2026 · goes with `privacy-notice.v1` · spec §8, §9, §14.3 M6

A nearby contact is one of up to two people living near the person the light is for, whom an organiser would call first on a quiet day. They agree once, through a message sent in the organiser's name. Until they say yes, Vela holds only their name and how they know the person, lists them in no notice, and holds no number with which anyone could reach them.

## How the message is sent

| Stage | Who sends it | How the answer is recorded |
|---|---|---|
| **Pilot on Telegram and LINE (now)** | The organiser, from their own phone (SMS, LINE, WhatsApp or Telegram), using text A below | The organiser gives Vela only the contact's name, and how they know the person, at Vela's setup; for a contact named later, the founder first adds the name the same way (`add_contact` without a number). The organiser sends text A, the contact replies to the organiser, and the organiser forwards the reply (their words or a screenshot), with the contact's phone number for a yes, to the founder. The founder records the answer on Vela's admin page (`record_contact_consent`; by hand, [`infra/runbooks/data-requests.md`](../../../infra/runbooks/data-requests.md) section C, until the admin page runs in production). A yes stores the number, the messaging app and the time of the yes, with a `consents` row: kind `nearby`, answer `yes`, text version `nearby-consent.v1`, the channel used, the date and the contact's words as evidence; from then on Vela lists the contact in quiet notices. A no is recorded the same way with answer `no`, holds no number, and the founder removes the contact within 7 days (`remove_contact`, section D) |
| **In the app (from sprint 3)** | Vela, in the organiser's name, when the organiser saves the contact (text B) | The contact taps a button; `POST /nearby/:token/consent` records consent or decline |

## Text A: sent by the organiser in the pilot

> Hello [contact's name], it's [organiser's name].
>
> Our family uses Vela, a small service: each morning someone in the family sends [Name] a question, and when [Name] answers, we know all is well.
>
> You live near [Name]. On a day when [Name] hasn't answered and I can't get through, could I ask you to go round? I would always ask you myself. Vela never contacts you on its own.
>
> When I set Vela up, I gave it only your name and how you know [Name], and it shows them in no message. If you say yes, I'll also give Vela your phone number and the messaging app you use. Vela keeps your details in its database in Singapore and shows them only to me [and to (other organiser's name)], on a day like that. Timur Aiusheev, who runs the Vela pilot, can see them and records your answer. Vela keeps them until you or I remove them. If you say no, your details are deleted within 7 days, and if you haven't said yes after 14 days, they are deleted then. You can ask Timur at any time to see, correct or delete them, or change your mind, and nothing changes between us.
>
> How your details are used: https://vela.vela-light.workers.dev/privacy
>
> Would that be all right? Just reply yes or no.

## Text B: sent by Vela in the organiser's name (app, sprint 3)

> [Organiser's name] asks: you live near [Name]. On a day when [Name] hasn't answered and [organiser's name] can't get through, may [organiser's name] ask you to go round?
>
> [Organiser's name] added your name and number to Vela so they can reach you on a day like that. Vela never contacts you on its own; any request comes from [organiser's name]. You can say no, or change your mind at any time.
>
> Vela is a pilot run by Timur Aiusheev. How your details are used: https://vela.vela-light.workers.dev/privacy
>
> Buttons: **Yes, I'm happy to** · **No, thank you**

## What saying yes means

**What Vela keeps:** your name, how you know [Name], your phone number, the messaging app you use, and when and how you said yes.

**Who sees it:** the organisers of [Name]'s family, and Timur Aiusheev, who runs the pilot and records your answer in Vela. Your details are stored with the providers named in the privacy notice (Vela's database in Singapore, and Cloudflare, which runs Vela's software), and reach the organiser through their messaging app on a quiet day. Vela's AI never sees your phone number. You will not see [Name]'s messages or answers, and nothing about [Name]'s days is shared with you.

**When you might hear from the family:** only on a day when [Name] has not answered, and only if an organiser decides to ask you. We expect this to be rare. In the pilot, the organiser calls or messages you directly. Later, in the app, you may receive a message sent in the organiser's name, such as:

> [Organiser's name] asks: could you look in on [Name] today? [Name] hasn't answered this morning.
>
> Buttons: **I'll look in** · **Can't today**

Your answer goes to the organiser.

**What you are not agreeing to:** you are not responsible for [Name]. "Can't today" is always a good answer, and nobody will ask why. Vela does not send you reminders, updates or anything else. If you ever think someone is in danger, call emergency services first (119 in Taiwan, 911 in the United States, 112 in Europe); Vela is not an emergency service.

**How long:** until you or the organiser remove you, or [Name]'s family leaves Vela. Then your details are deleted (see "How long we keep it" in the privacy notice). A record that you said yes, holding reference numbers, the version of this text and the time, but not your name or number, is kept for 5 years after your details are deleted, to show what was agreed.

**Changing your mind:** tell the organiser, or write to the founder at t.aiusheev@gmail.com. Your number is removed from Vela's list of contacts as soon as your no is recorded, your other details within 7 days, and nobody uses Vela to contact you again. A quiet-day notice sent to the organiser before your no may hold your number: Vela deletes its copy within 30 days of that notice, and the message stays in the organiser's own chat until they delete it.

**Your rights:** you can see, correct or delete what Vela holds about you at any time, free of charge (privacy notice, "Your rights").

## What saying no means

Your details never appear in a notice, and they are deleted. In the pilot, Vela never holds your number unless you say yes, and the founder deletes your name within 7 days of your no, or 14 days after it was added to Vela if you have not said yes. In the app, your name and number are deleted as soon as you decline, and if you do not answer within 14 days they are deleted too. Either way, the request is not repeated. A record that you said no, without your name or number, is kept for 5 years to show that you were asked and what you answered. The organiser may still call you as a friend or neighbour, as they always could.

## Notes for the founder

- A contact without a recorded yes never appears in a notice on a quiet day: Vela lists only contacts whose yes is recorded and who have not said no (`architecture/04-instrument-flows.md` §3.12). Vela's setup stores contacts by name and relation only, and refuses a number there (`onboarding.nearby_no_number`). Record each answer (`record_contact_consent` on the admin page, with the number for a yes, or [`infra/runbooks/data-requests.md`](../../../infra/runbooks/data-requests.md) section C until it runs in production), and remove a contact who says no within 7 days, or who has no yes 14 days after being added (`remove_contact`, or section D).
- A number is entered only together with the contact's recorded yes (`record_contact_consent` with the number, or `add_contact` with the yes and the number in one form). A number without a standing yes is refused by the database.
- The organiser must be the one who knows the contact. Vela never recruits contacts.
- Record the text version, the channel, the date and the contact's exact words in Vela's consent record, never in the Google Drive notes. If the contact asks a question the text does not answer, answer it before recording consent.
- Changing this text in a way that changes its meaning needs a new version and a new yes from contacts already recorded.
