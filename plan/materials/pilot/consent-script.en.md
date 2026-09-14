> **Draft for the pilot, not legal advice. To be reviewed by counsel before any public launch.**

# Consent script: the onboarding call with the person the light is for

Version `consent-script.v1` · 14 September 2026 · goes with `privacy-notice.v1` · spoken meaning matches the `consent.request` message (architecture/03-code-design.md §4, spec §9)

What the founder says on the onboarding call, before Vela sends its consent message. The call is where the person hears everything and asks questions; the tap on "Yes, that's fine" in the chat is what switches the light on. Nobody's light is switched on by the call alone, and nobody's light is switched on by the organiser.

Neither the founder nor the organiser can make Vela send the consent message: a bot cannot start a chat. It comes only when the person opens the invite link from the organiser's setup and taps **Start**, which is why the link is opened at the end of the call (section 6).

## Before the call

- [ ] The organiser has already talked about Vela with the person. The call is never the first they hear of it.
- [ ] The organiser has agreed to the pilot (`organiser-agreement.en.md`) and has the privacy notice.
- [ ] The organiser has finished Vela's setup in their private chat with the bot within the last 7 days, and has the invite link from its last message (the link stops working after 7 days). They have **not** sent it to the person yet, and can send it during the call, so the consent message never arrives before the person has heard this script.
- [ ] You know: the name the family uses, how they like to be greeted, the language, the morning time, the messaging app, the names of any nearby contacts, and the emergency number where the person lives.
- [ ] Ten quiet minutes. The organiser may join, but the person answers for themselves.
- [ ] You are **not** recording. Take notes by hand or in [NOTES TOOL] under the family code.
- [ ] If the person prefers another language, stop and reschedule with the right script.

## How to speak

- Use their name and the organiser's name. Never "the user", "the parent" or "the elderly".
- Say who acts: the family asks, the organiser calls, Vela carries messages. Vela never acts on its own.
- Never say "monitor", "track", "check on", "keep an eye on", "watch over", "safety alert" or "for your safety". Do not promise that Vela keeps anyone safe.
- Pause after each part. Short sentences. Let silence happen.
- "No" and "not now" are good outcomes. Ask once; never persuade.

## The script

Replace everything in [brackets]. Words in *italics* are notes for you, not for saying aloud.

### 1. Hello

"Hello [greeting, for example Mrs Chen]. My name is [founder's first name]. I'm helping [organiser] with a small service called Vela. This call takes about ten minutes, I'm not recording it, and at the end you decide. 'No' is a perfectly good answer."

### 2. What it is

*This part carries the meaning of the consent message. Keep every sentence.*

"[Organiser] would like to keep a light on for you. Every morning someone in the family will ask you something. When you answer, they will know you are fine. If a morning goes unanswered, [organiser] will get a quiet note so they can call. You can say stop at any time."

### 3. How answering works

"The message comes at about [time] in [Telegram / LINE]. It might be a question from [a family member's name], two photos to choose between, or a voice message. You answer with one tap on a button. If you feel like talking, you can send a voice message, but you never have to. The next morning, you'll hear what the family said back to you."

### 4. What else you should know

"A few more things, so there are no surprises."

- "What you send goes to the family in the Vela group: [names of the people in the group]."
- "[Organiser] gave me your name, your morning time and how to greet you. Tell me if anything is wrong."
- "If you ever mention something like a fall or pain, [organiser] will see your own words that same day. Vela is not a doctor and never gives medical advice. If you need help quickly, call [local emergency number: 119 in Taiwan, 911 in the United States, 999 or 112 in the United Kingdom, 112 in the European Union] or [organiser] straight away. Don't wait for the morning message."
- "If [organiser] can't reach you on a quiet day, they might ask [nearby contact's name] to come by. That is always [organiser]'s own decision. Vela never contacts anyone by itself."
- "A computer program helps with the messages: it writes down voice messages as text, translates for [family member who speaks another language], and suggests short answers you can tap. Voice messages and photos are deleted after 30 days."
- "While we test Vela over these first weeks, I read the messages too, only to make sure everything works. Nobody outside the family and me."
- "On Sundays [organiser] gets a few lines about your week. You can always see what the family sees: just write 'what does the family see'."

### 5. Questions

"What would you like to ask?"

*Answer in your own words using the five answers below. If a question is not covered, say you don't know and will find out; never guess.*

### 6. Asking

"Would you like to try it?"

- **Yes:** "Thank you. [Organiser] is sending you a link in Telegram now. When it arrives, tap the link, then tap **Start** at the bottom of the chat that opens. Vela will then send you a message that says what I just told you. Please tap **'Yes, that's fine'**. Your first morning message arrives tomorrow at [time]."

  *Ask the organiser to send the link now (message them if they are not on the call). Stay on the call until the person has tapped Start and seen the message, or agree that the organiser helps them straight after the call. Only a tap on one of the message's buttons answers it: anything the person types in the chat instead is ignored, and neither stored nor shown to the family, so help them find the button. If Vela says the link is no longer valid, thank them and end the call kindly; create a new link ([`infra/runbooks/data-requests.md`](../../../infra/runbooks/data-requests.md), section A) for the organiser to send on the next call, and never ask the person to keep retrying. These are Telegram's steps; LINE's are added here when the LINE flow is built (sprint 2).*
- **No:** "That's completely fine. Nothing will be sent. I'll tell [organiser] you said no for now, and there's nothing wrong with that."
- **Not sure:** "Take your time. Nothing starts until you tap yes. [Organiser] can reach me whenever you'd like to talk again."

### 7. The research questions (separate, optional)

*Ask only after step 6, and only if they said yes to Vela.*

"One more thing, separate from Vela. For this test I'm asking a few people three short questions about how connected they feel: today, in about a month and in three months. You can say no, and it changes nothing about Vela."

*If yes, ask the questions from the pilot's research sheet and record the scores under the family code only. If no, do not ask again.*

## The five questions people most often ask

**1. "Who will see what I say?"**

"The family in the Vela group: [names]. They see your answer, and a written version if you sent a voice message. On quiet days and on Sundays, [organiser] gets a short note. I read the messages during this test to make sure it works. A computer program helps write down and translate the words, and it doesn't show them to anyone. Nobody else sees your answers: not neighbours, not advertisers, not anyone selling anything."

**2. "What happens if I don't answer one day? Will everyone worry?"**

"Nothing happens on your side, and you never have to explain. If you haven't answered after about two and a half hours, the same message comes once more. If there is still no answer later on, [organiser] gets a short, calm note with the facts and will call you. In the first two weeks that note waits until about eight hours after the morning message, while Vela learns your usual time. Quiet days are normal: people are busy, go out, or forget. If you're going away, just say so in an answer, for example 'I'm at my sister's until Sunday', and nobody will expect an answer until then."

**3. "Is it listening to me, or following where I go?"**

"No. Vela has no access to your microphone, your camera, your contacts or where you are. It only knows what you send it: a tap, a voice message you record and send, a photo you choose. Between messages it knows nothing about you. And you can always see what the family sees."

**4. "Is a computer reading my messages? Is it a robot talking to me?"**

"The questions come from real people in your family, with their names on them. Vela carries them. A computer program helps: it turns voice messages into writing, translates when someone speaks another language, and suggests short answers you can tap. If a message mentions something like a fall or pain, it makes sure [organiser] sees your own words. It never gives advice, never pretends to be someone in your family, and never contacts anyone. On days when nobody in the family has asked anything, Vela sends a short hello signed 'Vela, from your family'."

**5. "What if I want to stop? Will [organiser] be upset?"**

"Just write 'stop'. Everything pauses straight away. [Organiser] gets a message saying you asked to pause and that nothing is wrong with the app. You don't owe anyone a reason. If you'd like it back, write 'start'. And if you want everything Vela has about you deleted, tell [organiser] or me and it will be done."

## After the call (within one hour)

Record under the family code, never in the chat:

- Date, time, language, who was on the call.
- Versions used: `consent-script.v1`, `privacy-notice.v1`.
- The answer in their own words ("yes, let's try", "no", "not now").
- Anything corrected (name, greeting, time) and any question you could not answer.
- Research questions: yes or no; scores if yes.
- Check with the organiser that the person opened the invite link and tapped Start: that is the only thing that makes Vela send the consent message. When they tap yes, Vela writes the `consents` row (kind `light`, the message's text version, language, channel, message id as evidence) and `members.light_consented_at`. For the call itself, record a `consents` row of kind `privacy_notice` with channel `call` and a reference to your note (family code and date) as evidence: on the admin page (`record_consent`) once it ships, and until then following [`infra/runbooks/data-requests.md`](../../../infra/runbooks/data-requests.md), section B.
- If there is no tap within 24 hours, ask the organiser to mention it once. Never send reminders from Vela.
- If the person said no: tell the organiser the same day, kindly. Nothing is created.
