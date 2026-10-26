> **Draft for the pilot, not legal advice. To be reviewed by counsel before any public launch.**

# Consent script: the onboarding call with the person the light is for

Version `consent-script.v6` · 26 October 2026 · goes with `privacy-notice.v11` · spoken meaning matches the single `consent.request@3` message, which asks about the light and about health words together, as two separate choices with three buttons (founder's decision of 22 October 2026; architecture/03-code-design.md §4, spec §9). People who received a `consent.request@2` message before then still answer it with its Yes and No, followed by the `consent.health_words@2` question.

What the founder says on the onboarding call, before Vela sends its consent message. The call is where the person hears everything and asks questions; the tap on "Yes to both" or "Yes, health private" in the chat is what switches the light on. Nobody's light is switched on by the call alone, and nobody's light is switched on by the organiser.

Neither the founder nor the organiser can make Vela send the consent message: a bot cannot start a chat. It comes only when the person opens the invite link from the organiser's setup and taps **Start** (Telegram) or **Send** (LINE), which is why the link is opened at the end of the call (section 6).

## Before the call

- [ ] The organiser has already talked about Vela with the person. The call is never the first they hear of it.
- [ ] The organiser has agreed to the pilot (`organiser-agreement.en.md`) and has the privacy notice.
- [ ] **Who can join.** Under the family code you have recorded the country where the person and each family member in the group live, and whether any of them is a Russian citizen (pilot pack README, "Who can join the pilot"). Use the cohort and eligibility review in the pilot pack README; the family must be approved on the admin page (`/admin/roster`, Families) before the call. Vietnam participation requires a recorded review of the actual participants and processing flows first; language alone does not clear residence or citizenship restrictions. Otherwise do not hold the call: tell the organiser kindly that their family has to wait.
- [ ] The organiser has finished Vela's setup in their private chat with Vela (on Telegram or LINE) within the last 7 days, and has the invite link from its last message (the link stops working after 7 days). They have **not** sent it to the person yet, and can send it during the call, so the consent message never arrives before the person has heard this script.
- [ ] You know: the name the family uses, how they like to be greeted, the language, the morning time, the messaging app, the names of any nearby contacts, the names of the people in the family group, and the emergency number where the person lives.
- [ ] Ten quiet minutes. The organiser may join, but the person answers for themselves.
- [ ] You are **not** recording. Take notes by hand, or in the "Vela pilot" folder in Google Drive, under the family code. Notes in Google Drive hold only the family code, dates, the versions of the texts used, yes or no answers, the country codes and citizenship answers of "Who can join", and questionnaire scores: never a quote, and nothing about anyone's health.
- [ ] Hold the call in the person's language: this script in English, or `consent-script.zh-TW.md` in Traditional Chinese. If the person is comfortable in neither, do not enrol them in this cohort.

## How to speak

- Use their name and the organiser's name. Never "the user", "the parent" or "the elderly".
- Say who acts: the family asks, the organiser calls, Vela carries messages. Vela never acts on its own.
- Never say "monitor", "track", "check on", "keep an eye on", "watch over", "safety alert" or "for your safety". Do not promise that Vela keeps anyone safe.
- Pause after each part. Short sentences. Let silence happen.
- "No" and "not now" are good outcomes. Ask once; never persuade.

## The script

Replace everything in [brackets]. Words in *italics* are notes for you, not for saying aloud.

### 1. Hello

"Hello [greeting, for example Mrs Chen]. My name is Timur Aiusheev. I run Vela, a small service [organiser] would like to use, and I am responsible for your information. This call takes about ten minutes, I'm not recording it, and at the end you decide. 'No' is a perfectly good answer."

### 2. What it is

*This part carries the meaning of the consent message (`consent.request@2`). Keep every sentence.*

"[Organiser] would like to keep a light on for you. Every morning someone in the family will ask you something. When you answer, they will know you are fine. If a morning goes unanswered, [organiser] will get a quiet note so they can call. You can say stop at any time. The message Vela sends you also says that I run Vela, and has a link to a page that explains how your information is used."

### 3. How answering works

"The message comes at about [time] in [Telegram or LINE]. It might be a question from [a family member's name], two photos to choose between, or a voice message. You answer with one tap on a button. If you feel like talking, you can send a voice message, but you never have to. The next morning, you'll hear what the family said back to you."

### 4. What else you should know

"A few more things, so there are no surprises."

- "What you send goes to the family in the Vela group: [names of the people in the group]."
- "[Organiser] gave me your name, your morning time and how to greet you. Tell me if anything is wrong."
- "The same message also asks you a second, separate question, and you answer both with one tap. It asks whether Vela may pass on your words about your health, for example a fall or pain, to [organiser], so they can call you, and say in the Sunday lines which of those words came up more than once. You can say yes or no to it, and Vela works the same either way: 'Yes to both' says yes to the light and to this; 'Yes, health private' says yes to the light and keeps your health words to yourself; 'No, thank you' says no to everything. If you say yes, [organiser] sees your own words that same day, and on Sundays which of them you said on two or more days that week, such as 'knee hurts' on Monday and Thursday. You can see those Sunday lines too, and they go with your words after 30 days. If you say no, Vela keeps no separate notes about your health and leaves your health out of the one-line summary. Your own messages still reach the family as you sent them, and their words are deleted after 30 days. When something you said may be worth a call, [organiser] gets a short note without your words. Tapping the button is your agreement in writing; if you'd rather answer on paper, tell me. Whatever you answer, Vela's notes never keep the name of an illness, a test result or a medicine."
- "Vela is not a doctor and never gives medical advice. If you need help quickly, call [local emergency number: 119 in Taiwan, 911 in the United States, 999 or 112 in the United Kingdom, 112 in the European Union] or [organiser] straight away. Don't wait for the morning message."
- "If [organiser] can't reach you on a quiet day, they might ask [nearby contact's name] to come by. That is always [organiser]'s own decision. Vela never contacts anyone by itself."
- "A computer program helps with the messages: it writes down voice messages as text, translates between Chinese and English when someone in the family reads the other language, and suggests short answers you can tap."
- "On a morning when nobody in the family has written you a question, Vela sends one of its own, signed 'Vela'. [Organiser] can also choose to let the program write that question in their style and send it with their name on it. It is still [organiser]'s choice, and in the family's app it is marked as written by Vela. You can always ask [organiser] or me whether a question was written by Vela. If you'd rather every question come only from the family's own words, tell [organiser] or me and it will be turned off."
- "Companies that run Vela process your messages for it: the database is in Singapore, the program that writes down and understands voice messages works in the United States, Cloudflare's network, which runs Vela, works worldwide, and [Telegram or LINE] carries the messages."
- "Your voice messages, photos and the words of your answers are deleted after 30 days. A one-line summary of each answer stays while the family uses Vela."
- "While we test Vela over these first weeks, I read the messages too, only to make sure everything works."
- "You can ask me at any time to see what Vela has about you, to get a copy, to correct it or to delete it."
- "On Sundays [organiser] gets a few lines about your week: what you told the family, and what changed in how you answered, compared only with your own earlier weeks. Those lines are never a score and never advice. Whenever you like, write 'what does the family see', and you'll get what the family saw from your latest answers and the lines about your week."
- "[Organiser]'s copy of those Sunday lines may also have a few words just for them, about their own messages: which of their questions or replies you answered, and an idea for the next week. It never mentions your health."
- "On Sundays the program also writes me, and only me, a few careful guesses about what may lie beneath the week's messages, yours and the family's: a feeling, a wish or a worry, each with the words it rests on. They are guesses, not facts. I use them only to understand the week and to see whether guesses like these are any good. I don't show them to anyone, and they are deleted 30 days after that week. You can ask me to see them."

### 5. Questions

"What would you like to ask?"

*Answer in your own words using the five answers below. If a question is not covered, say you don't know and will find out; never guess.*

### 6. Asking

"Would you like to try it?"

- **Yes, on Telegram:** "Thank you. [Organiser] is sending you a link in Telegram now. When it arrives, tap the link, then tap **Start** at the bottom of the chat that opens. Vela will then send you a message that says what I just told you. It has three buttons. Please tap the one you choose yourself: **'Yes to both'**, **'Yes, health private'** if you'd like to keep your health words to yourself, or **'No, thank you'**. One tap answers both questions. Your first morning message arrives tomorrow at [time]."

  *Ask the organiser to send the link now (message them if they are not on the call). Stay on the call until the person has tapped Start and seen the message, or agree that the organiser helps straight after the call. The organiser may show the person where the buttons are, but the person taps them themselves: the tap is the person's own written consent. Only a tap on one of the message's buttons answers it: anything the person types in the chat instead is ignored, and neither stored nor shown to the family, so help them find the button. If Vela says the link is no longer valid, thank them and end the call kindly; create a new link ([`infra/runbooks/data-requests.md`](../../../infra/runbooks/data-requests.md), section A) for the organiser to send on the next call, and never ask the person to keep retrying. *
- **Yes, on LINE:** "Thank you. [Organiser] is sending you a link in LINE now. When it arrives, tap it. LINE opens Vela's chat with a short message already typed: just tap **Send**. If LINE first asks you to add Vela as a friend, tap **Add**. Vela will then send you a message that says what I just told you, with three buttons directly underneath it. Please tap the one you choose yourself: **'Yes to both'**, **'Yes, health private'**, or **'No, thank you'**. One tap answers both questions. Your first morning message arrives tomorrow at [time]."

  *The same notes apply as for Telegram. On LINE, do not change the typed message before Send: it carries the invitation.*
- **No:** "That's completely fine. Nothing will be sent. I'll tell [organiser] you said no for now, and there's nothing wrong with that. What [organiser] gave me about you is deleted; I keep only a note that you said no."
- **Not sure:** "Take your time. Nothing starts until you tap yes. [Organiser] can reach me whenever you'd like to talk again. If you haven't decided within about a month, what [organiser] gave me about you is deleted, and [organiser] can invite you again later."

### 7. The research questions (separate, optional)

*Ask only after step 6, and only if they said yes to Vela.*

"One more thing, separate from Vela. For this test I'm asking a few people three short questions about how connected they feel: at days 14 and 30. You can say no, and it changes nothing about Vela."

*If yes, ask the questions from the pilot's research sheet and record the scores under the family code only. If no, do not ask again.*

## The five questions people most often ask

**1. "Who will see what I say?"**

"The family in the Vela group: [names]. They see your answer, and a written version if you sent a voice message. On quiet days and on Sundays, [organiser] gets a short note. I read the messages during this test to make sure it works, and on Sundays I alone see the program's guesses about what may lie beneath the week's words. Companies that run Vela for me process the messages: the database in Singapore, the program in the United States that writes down and understands the words, and [Telegram or LINE]. They use them only to run Vela. Nobody else sees your answers: not neighbours, not advertisers, not anyone selling anything."

**2. "What happens if I don't answer one day? Will everyone worry?"**

"Nothing happens on your side, and you never have to explain. If you haven't answered after about two and a half hours, the same message comes once more. If there is still no answer later on, [organiser] gets a short, calm note with the facts and will call you. In the first two weeks that note waits until about eight hours after the morning message, while Vela learns your usual time. Quiet days are normal: people are busy, go out, or forget. If you're going away, just say so in an answer, for example 'I'm at my sister's until Sunday', and nobody will expect an answer until then."

**3. "Is it listening to me, or following where I go?"**

"No. Vela has no access to your microphone, your camera, your contacts or where you are. It only knows what you send it: a tap, a voice message you record and send, a photo you choose. Between messages it knows nothing about you. And you can always ask Vela what the family sees."

**4. "Is a computer reading my messages? Is it a robot talking to me?"**

"The questions come from people in your family, with their names on them, and Vela carries them. A computer program helps: it turns voice messages into writing, and suggests short answers you can tap. If a message mentions something like a fall or pain, it makes sure [organiser] hears about it: with your own words if you said yes to the health question, and otherwise with a short note without them. On Sundays it also suggests to [organiser] how their own messages might reach you, and writes me, only me, its guesses about what may lie beneath the week's words. It never gives you advice and never contacts anyone. On days when nobody in the family has asked anything, Vela sends a question of its own, signed 'Vela'. If [organiser] chose it, the program writes that question in [organiser]'s style instead and sends it with [organiser]'s name on it; the family's app shows it was written by Vela. Ask [organiser] or me whenever you want to know whether a question was written by Vela, and tell us if you'd like those to stop."

**5. "What if I want to stop? Will [organiser] be upset?"**

"Just write 'stop'. Everything pauses straight away. [Organiser] gets a message saying you asked to pause and that nothing is wrong with the app. You don't owe anyone a reason. If you'd like it back, write 'start'. Saying stop also takes back a yes to the health question, and start doesn't bring that yes back: tell me if you want it again. And if you want everything Vela has about you deleted, tell [organiser] or me and it will be done."

## After the call (within one hour)

Record under the family code, never in the chat, and in Google Drive only the family code, dates, text versions, yes or no answers, the country codes and citizenship answers of "Who can join", and scores (never a quote or anything about health):

- Date, time, language, who was on the call.
- Versions used: `consent-script.v6`, `privacy-notice.v11`, and the language of the call.
- The answer: yes, no or not now.
- Whether anything was corrected (the correction itself goes into Vela, `infra/runbooks/data-requests.md` section I), and whether a question stayed unanswered.
- Research questions: yes or no; scores if yes.
- Check with the organiser that the person opened the invite link and tapped Start (Telegram) or Send (LINE): that is the only thing that makes Vela send the consent message. When the person taps "Yes to both" or "Yes, health private", Vela writes, from that one tap and with the same evidence (the chat, the message, the values filled into the text and a fingerprint of it), a `consents` row of kind `light` with answer `yes` and a `consents` row of kind `health_words` with answer `yes` or `no`, both with text version `consent.request@3`, and `members.light_consented_at`. No second question follows. ("No, thank you" writes one `light` row with answer `no`, as before.) For the call itself, record a `consents` row of kind `privacy_notice` with channel `call` and a reference to your note (family code and date) as evidence: on the admin page (`record_consent`), or following [`infra/runbooks/data-requests.md`](../../../infra/runbooks/data-requests.md), section B, until the admin page runs in production.
- For someone who answered an older `consent.request@2` message: if the health-words question never arrived after their yes, tell the co-founder, and if the person answers on paper or tells you their answer, record it by hand (data-requests B).
- If there is no tap within 24 hours, ask the organiser to mention it once. Never send reminders from Vela.
- If the person said no on the call: tell the organiser the same day, kindly, and delete what setup stored about the person, keeping only the record of the no (data-requests, section L). If the person tapped No in the chat, Vela has already done both and told the organisers; nothing to delete by hand. Either way the organiser can invite the person again later: `create_invite` on the admin page, or the runbook.
