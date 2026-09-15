# Vela product specification, v2

2026-09-14 (written 2026-09-13 and revised the same day against the evidence in `research/14-evidence-synthesis.md`; Appendix A updated 2026-09-14; §9, §13, and Appendix A revised 2026-09-14 so the weekly read never shows her missed days). **This is the only product spec.** It absorbs the interaction model and replaces the v1 spec (both now in `archive/product/`). Written so that the founder, a designer, and an engineer read the same thing, and so that every screen in `design/prototype/vela-app.html` has acceptance criteria here. Companion documents: `02-app-plan.md` (why), `architecture/02-technical-architecture-v2.md` (how), `research/08–13` (evidence), `design/design-system.md` (look).

## 0. What is final

| Decision | Final form |
|---|---|
| What arrives | An **ask from a person**: a question, two photos to choose from, a voice note to answer, a word to teach, a story prompt, a recipe step, an old photo to name, a vote. Vela authors nothing except the fallback hello. |
| What she does | One gesture: speak, tap a chip, tap a photo, tap a heart. "Just say hi" is the small fallback, never the hero. |
| What comes back | Her answer is a post. The family reacts and replies. **She hears the replies at the start of tomorrow's arrival.** Receipts both ways. |
| The light | Lights on any answer, on the raw event, before any AI runs. Paid layer "Vela Light" carries the light, quiet notices, nearby contacts, away mode, the weekly read, memory, and the family book export. |
| Silence | Repeat once, then a quiet notice to the organisers with nearby contacts one tap away. **Every message to a nearby contact is sent by a person's tap.** Vela never contacts anyone on its own. The "auto-ask" step from v1 is removed. |
| The free layer | The whole exchange: asks, answers, replies, turns, translation, story day, the archive in the app. Free for every member, for ever. |
| Surfaces | The app (family), the parent surface (same app, one screen at a time), kitchen-table mode (tablet), messengers (LINE first for Taiwan and Japan; WhatsApp for Europe and India once the entity exists; Telegram for the phase-0 instrument and wherever a family already uses it), and a voice line in phase 2 for parents who are offline. The parent surface is the floor under every market and the whole path for the United States. Russia is deferred (plan/market-order.md). No family is told a messenger is unsupported in a market we launch. |
| Vocabulary | family · member · organiser · kept-light member · nearby contact · **exchange** (one ask, one answer, its replies) · arrival (the delivery of an exchange's ask) · answer · reply · light · quiet notice · away · turn · story day · family book · weekly read |

## 1. Principles

1. **People ask; Vela carries.** Every arrival has a person's name on it. Vela signs only the fallback hello and system notices.
2. **One gesture answers.** Every ask can be answered with one tap; voice is always offered, never required. Nothing on the parent surface takes more than one tap or one voice note.
3. **The light is a by-product.** Peace of mind comes from a real exchange, not from a check.
4. **She hears the family, she never scrolls it.** Replies are read to her tomorrow morning; there is no feed on her side.
5. **Symmetry.** She can always see what the family sees about her, in one tap or one message.
6. **One moment a day.** One arrival per member per day, one notification, then the app closes. Enforced in code (§15).
7. **Silence gets a plan, not an alarm.** Facts, the people nearby, and the one thing to do next.

## 2. People and families

### 2.1 Membership

| Field | Values | Notes |
|---|---|---|
| role | organiser · member | One or more organisers per family; the one who pays is the billing organiser |
| surfaces | app · parent-surface · telegram · line · whatsapp · max · viber · voice | The arrival goes to the **primary** surface; answers are accepted from any |
| light | off · on | Only with the member's consent (§9); a member may switch their own on or off |
| turns | in · out | Default: in for everyone except kept-light members |
| language | en · zh-TW (MVP); ja · de · hi (phase 2); ru as a localisation when needed | Every string, transcript, and translation is keyed to this |
| address form | free text | "Mrs Ivanova", "Mom", "Галина Петровна"; used in every greeting |
| arrival hour | local time | Default 08:00; for kept-light members wake time + 30 min, set by the organiser, learned after 14 days |
| status | invited · active · paused · left | Paused from either side; left keeps data 30 days then deletes |

### 2.2 Member states (what the lights show)

| State | Meaning | Glyph |
|---|---|---|
| Resting | Light on, no answer yet today, inside her usual window | Window outline, no light |
| Lit | Answered today | Window with the light on, time of answer |
| Quiet | Past her tuned threshold, no answer, not away | Outline with a dot; a quiet notice exists |
| Away | Away mode active | Dashed outline, "until Sunday" |
| Paused | Member or family paused | Grey outline |
| No light | Ordinary member | No glyph; appears in exchanges only |

### 2.3 Families

- Name (default: the eldest's surname or "Our family"), region for data residency (from the kept-light member's country), plan (free · light), members, nearby contacts.
- **Invite** by link or phone/email; the invite names the family and the inviter; accepting creates a membership with role member.
- **One person, two families.** The second setup detects the same channel identity and offers "join Anna's family" or "make a second family". MVP allows both, with copy that discourages two; phase 2 merges.
- **Delete family** removes everything within 24 h except archives the family exported.

## 3. The exchange

The exchange is the core object. One ask, one answer, its replies.

```
composed ──► scheduled ──► delivered ──► seen ──► answered ──► replied ──► read back ──► archived
   │                          │                      │
   └── withdrawn              └── repeated (once)    └── (no answer) ──► quiet ──► resolved
```

| State | Enters when | Leaves when |
|---|---|---|
| composed | A member saves an ask (queued for a date or "whenever") | Scheduled by the composer for a member's next arrival, or withdrawn by its author before delivery |
| scheduled | The composer picks it for tomorrow's arrival at her hour | Delivered |
| delivered | The arrival left the outbound gateway on her primary surface | Seen (app/parent surface opened, messenger read receipt where available) or answered directly |
| seen | She opened it | Answered, or the day ends |
| answered | Any answer arrived (§5) | Replied (first reply), or read back with no replies |
| replied | At least one reply or reaction exists | Read back |
| read back | The replies were delivered as the opening of her next arrival, or she played them on the parent surface | Archived |
| archived | 24 h after read back, or 48 h after answered with no replies | Never; it lives in the archive |
| quiet | No answer by T_quiet on a kept-light member's exchange | Resolved by an answer, "she's fine", or away |

Rules:
- Exactly one exchange per member per day is delivered. If nothing was composed, the composer creates a **fallback hello** exchange (§4.5).
- An exchange has one **asker** (a person, or Vela for the fallback), one **recipient**, one **type** (§4.3), media, and the reader-language versions of every text.
- Answers to yesterday's exchange that arrive after today's delivery attach to yesterday's exchange and still count as today's answer for the light.
- Nothing nags. An exchange with no answer simply archives; the only consequence is the quiet ladder for kept-light members.

## 4. The arrival

### 4.1 Timing

One arrival per member per day at their arrival hour, local time including DST. Delivered within 5 minutes of the hour (SLO in the technical design). If the worker missed the minute, the next tick sends it with "sorry this is late" prepended. Never two in one day, enforced by a unique (member, local date) key.

### 4.2 Composition, in priority order

1. The ask scheduled for today by a person (the turn holder or anyone).
2. If none: the oldest "whenever" ask addressed to her or to everyone, at most one.
3. If none and it is story day: this week's story question, in the name of the member who chose it (or "the family").
4. If none: the fallback hello (§4.5).

Then the **opening**: if yesterday's exchange has replies, the arrival opens with them (§6.3) before the ask.

### 4.3 Types

| Type | What she receives | Her one gesture | What the asker gets back |
|---|---|---|---|
| Question | "Mia asks: what did you cook today?" plus Mia's voice if she recorded it | Voice; or one of three chips drafted from her own past answers | Her answer in the exchange; "Grandma answered you" |
| Photo choice | Two photos: "Which one should I frame?" | Tap one; optional voice | Her pick on the photo; her words |
| Voice note | Sam's 10-second note | Voice; or a heart | Her voice |
| Word to teach | "Mia is learning Russian. Teach her one word?" | Say it once | Her voice saying the word, the transcript, the translation; Mia can record it back |
| Story | "How did you meet Dad?" | Voice, any length | The story in the family book; a follow-up next week |
| Recipe | "Sam wants your borscht. How do you start?" | Voice, over one or several days | A recipe card assembled from her answers |
| Memory photo | An old photo: "Who is this?" | Voice | Names and the story attached to the photo |
| Vote | "Sunday call at 6 or 7?" | Tap one | The result to everyone |
| Fallback hello | A warm morning from Vela on the family's behalf | Heart, or "I'm fine" | The light; the organiser sees "quiet day, she's fine" |

Every type has a **just say hi** at the bottom on the parent surface and an equivalent button on messengers.

### 4.4 Composition rules

- One ask per arrival. One photo, or two for a choice; anything else is attached behind a tap or as a second message inside the same minute (counts as one arrival).
- Voice is delivered as voice where the channel supports it, with a transcript for the app.
- Text is in her language; the asker's original is one tap away (§11).
- The greeting uses her address form. The asker is named and shown with their avatar.
- The asker may attach a 10-second voice hello to any type; it plays before the ask.

### 4.5 Fallback hello

Two lines signed "Vela, from your family": yesterday's replies if any, then "Nothing new from the family today. How are you this morning?" with heart and "I'm fine". The composer logs a **quiet day** for the family. Target: under 20% of days per family; the turn prompts (§7) exist to make this rare. Ordinary members get no arrival on an empty day; their app simply shows the exchanges.

### 4.6 Repeat

If a kept-light member has not answered 2.5 h after delivery, the same arrival is re-sent once with "in case you missed it". Ordinary members never get a repeat. Not sent in away mode.

## 5. Answers

### 5.1 What counts

Anything from the member on any surface between delivery and the next delivery: chip tap, photo tap, vote, heart, voice, text, photo, sticker, a call attempt through the app, or "I'm fine". It attaches to today's exchange (or yesterday's, per §3).

### 5.2 Processing order

1. **Record the raw event and light the light.** Cancel the pending repeat; resolve any open quiet notice and tell whoever was told. This step has no dependency on AI or transcription.
2. Transcribe voice (her language; auto-detect fallback).
3. AI understanding (technical design §6): one neutral summary line, mood words from a fixed list, mentions (people, places, plans, health words, dates), an escalation flag with reason, the language tag.
4. Translate for members whose language differs.
5. Post the answer into the exchange as "[Name] answered": media, transcript behind a tap, summary line for the organiser's day note.
6. Notify the asker: "Grandma answered you" (their one notification of the day if they have none yet; otherwise it waits for their arrival).
7. Vela's acknowledgement to her (§5.4).

### 5.3 Answer chips

For questions, Vela drafts up to three short chips **from her own previous answers and the question's topic** ("Soup", "Pancakes", "Nothing yet"). They are the primary answer row: tapping is the reliable gesture at 70+ (research/10), voice is the warm one. Only she sees them. A tapped chip is posted as her answer in her words, never expanded by AI. If she has fewer than five past answers, the chips are generic to the question type. Chips are never shown for story, recipe, or memory types; those are voice.

### 5.4 Vela's acknowledgement

At most one per day, in her language, two sentences, at most one question, never medical advice, never a conversation. If she writes again the same day, a fixed sign-off or nothing. On the parent surface the acknowledgement is the "Thank you, Anna knows you're fine" screen.

### 5.5 Escalation flags

Health words (pain, fall, dizzy, chest, breathing, not eating), hopelessness, a stranger at the door, "the bank called", requests for money. On a flag: the organisers get a notice with her words verbatim (the one place we quote, because they must judge); her acknowledgement stays calm and warm; nothing is sent to nearby contacts. A flag notice counts as the organiser's one notification only if they have not had one; otherwise it is sent anyway, as the single exception to the budget, and logged as such.

## 6. The reply loop

### 6.1 Replies

Under her answer any member can react (heart, laugh, hug) or reply with text, a voice note, or a photo. Replies are collected for the read-back; they do not generate notifications to her. Replies from ordinary members to each other are allowed but are not read back to her unless addressed to her.

### 6.2 What she is told

No counts. She hears substance: "Sam laughed at your story and says the borscht turned out well. Mia listened to it twice." Reactions are summarised as words; voice replies are played.

### 6.3 Read-back

The next arrival opens with yesterday's replies, then the new ask. On the parent surface the replies are read aloud (TTS in her language) with the voice replies played in the senders' own voices; on messengers they are the first paragraph of the arrival plus voice files. She can play them again on the "after answering" screen. Read-back marks the exchange read back.

### 6.4 Receipts

- To the asker: "Grandma saw it · 8:12" when seen; "Grandma answered you" when answered.
- To her, next morning: who listened, who replied, in words.
- Never to anyone: how many times, how long, who did not reply.

### 6.5 Closing

An exchange archives 24 h after read-back. Nothing asks for a reply. The archive is browsable by every member in the app as a list of exchanges, never as a feed with an end to reach.

## 7. Turns and suggestions

- **Turns** rotate round-robin among members with turns in, one per day, skipping days that already have a scheduled ask. The turn holder gets one prompt at their 19:00 local: "Tomorrow is your turn with Mom. Vela suggests: ask her for a photo of the tomatoes." One suggestion, one tap to use it, one tap to write their own.
- **Suggestions** come from her recent mentions, family dates, the asker's own last item, and the type rotation (question, photo, voice, word, story) so the week varies. Suggestions are never sent to her; only a person's ask is.
- If the turn holder does nothing by 22:00 her time, the composer takes a "whenever" ask if one exists; else the fallback. The turn holder is never scolded; the organiser's weekly read says on how many mornings nobody in the family asked.
- A family can switch turns off; the organiser then gets one weekly note when the queue is empty.
- Grandchildren under 13 participate through a parent's device; the ask carries the child's name as asker and the parent as sender.

## 8. The light and the quiet ladder

Applies to kept-light members only.

| Step | When | What |
|---|---|---|
| Repeat | delivery + 2.5 h | Re-send the arrival once (§4.6) |
| Quiet notice | delivery + T_quiet | To every organiser, in the app and by push: last answer, her usual answer time, yesterday's summary, nearby contacts with **Call** and **Ask them to look in**, buttons **Call Mom**, **She's fine, I know why**, **Wait 2 hours** |
| Wait 2 hours | tap | The notice returns after 2 h if still quiet |
| Ask them to look in | tap | Sends, on the organiser's behalf and in their name, a message to that nearby contact: "Anna asks: could you look in on Mrs Ivanova today? She hasn't answered this morning." The organiser sees it was sent and any reply |
| Resolution | any answer, "she's fine", or away | The notice closes; everyone who was told is told it's fine ("Mom answered at 11:40. Everything's lit again.") |

**No automatic messages to nearby contacts, ever.** Every contact to a third person is a person's tap. This is the product's promise and it is enforced in the outbound gateway (technical design §5) by requiring an actor id on every nearby-contact message.

**T_quiet.** Start at 6 h. After 14 answered days: median answer latency over the last 14 answered days + 2 h, floor 4 h, cap 10 h, recomputed weekly. Sundays and her country's holidays use the Sunday median if it differs by more than 1 h. The organiser can widen it, never narrow it below 4 h.

**Learning period.** For the first 14 days the quiet state shows in the app and the widget without a push; a push goes out only after 8 h of silence. The evidence (research/08) says one day in four or five goes unanswered even when everything works, so the ladder must treat silence as expected information and learn her rhythm before it interrupts anyone.

**No guilt, either way.** She is never shown missed days, never told the family worried, never asked why. The organiser's notice states facts and never frames her silence as a failure. The precision page says plainly that most quiet notices end as "answered late" or "away".

**Away mode.** Set by the organiser or any member; said by her in an answer ("going to my sister's until Sunday", detected, confirmed back once: "Until Sunday, then. Have a lovely trip."); or proposed by Vela after three occurrences of a weekly pattern. In away mode arrivals continue (she likes them), repeats and quiet notices do not. Away ends on the date, or on any answer if she chose "until I'm back".

**Precision accounting.** Every quiet notice records an outcome: answered late · away · true concern (organiser confirms something was wrong) · unknown. Precision = true concern ÷ notices, published monthly in the app's "How Vela is doing" page and on the website.

## 9. Consent, symmetry, stop

- A light is switched on only after she agrees. Messenger: the first message asks, in her language: "Anna would like to keep a light on for you. Every morning someone in the family will ask you something, and when you answer, they will know you are fine. If a morning goes unanswered, Anna will get a quiet note so they can call. You can say stop at any time." Two buttons answer it, **Yes, that's fine** and **No, thank you**; only a tap on one of them does. Parent surface: the consent screen (§14, P1). A member who switches their own light on consents implicitly.
- **Words.** Consent and every later screen say what the family sees and who will act; they never use "monitor", "check on", "track", or "keep an eye". Framing the product as surveillance is what 30–40% of invited elders refuse (research/08, /11); framing it as the family asking is what they accept.
- **Stop.** "Stop", "не надо", "停", or any refusal turns the light off and pauses arrivals; the organiser is told without judgement ("Mom asked to pause. Nothing is wrong with the app."). "Start" resumes.
- **What the family sees.** Any kept-light member can ask in the chat "what does the family see" (or tap the button on the parent surface) and gets the summary lines of her last seven answered days and the notes of the latest sent weekly read, in her language. The weekly read's counts and its suggestion are never part of it (§8, §13).
- Nearby contacts consent once, via a message sent in the organiser's name. Until they say yes, they can only be called by the organiser directly; "Ask them to look in" is disabled for them.

## 10. Story day, recipes, memory photos, the family book

- **Story day** is weekly, default Sunday. The question comes from the bank (ordered gently: childhood, first job, how you met, a recipe, a place), chosen by a member or voted by the family; never repeated; skippable ("ask me another"). Answers go into the **family book** unless she says "don't keep that one".
- **Recipes** accumulate over several asks into one card (ingredients, steps, her remarks), assembled by the AI and shown to her for a yes before it is kept.
- **Memory photos** get names and stories attached; the family can add their own.
- The family book is readable in the app by every member; exportable as PDF (phase 2); printable via a partner (phase 3, optional). Export needs Vela Light; reading never does.

## 11. Language and translation

- Every member has a language; every text is shown in the reader's language with the original one tap away.
- Translation preserves register: address form, diminutives, a grandchild's tone. The AI is told who speaks to whom.
- MVP: English and Traditional Chinese. Phase 2: Japanese, German, Hindi. Later: Russian, Ukrainian, Tagalog, Spanish, Korean.
- Transcription in her language with auto-detect fallback; the transcript is editable by her family only with her permission ("Mia corrected the spelling of the village").

## 12. Memory and reminders

- From answers the AI extracts dated facts ("doctor on Thursday", "Mia's exam next week") and proposes a reminder to the relevant member as a suggestion ("Ask Mom how the doctor went on Friday?"). Reminders exist only after a tap.
- Memory feeds suggestions and the weekly read. It never appears to her as "we noticed"; it appears as a person asking.

## 13. The weekly read

- Sunday, to organisers and members who opted in, per kept-light member. Vela Light only.
- **Counts, from numbers.** The read opens with lines Vela renders from the week's numbers, never written by the AI: on how many of the counted days she answered (seven, or in her first week only the days since her light started), then, when it applies, on how many mornings nobody in the family asked so Vela sent the hello, or that nobody in the family asked anything this week.
- **Notes, from the AI.** Zero to four lines about her week: usual time and drift versus last week (only if > 30 min); what she told, taught, and chose this week; anything mentioned twice or more; voice-length drift (only if > 40%). A week with nothing to say has no notes. The notes never state how many days she answered or did not, never mention mornings nobody asked or how many asks the family sent, and never imply a missed day.
- **One suggestion:** something to ask her next week.
- Words: "later than usual", "shorter than usual", "mentioned twice". Never "concerning", "decline", "risk". No scores.
- A person who edits the draft before it is sent (Appendix A) edits the notes and the suggestion, never the counts.
- She can read the notes too, in her language (§9), never the counts, the nobody-asked line, or the suggestion: she is never shown missed days (§8), and the suggestion is an ask meant to reach her as a surprise. A read with no notes shows her no weekly read at all.

## 14. Surfaces and screens: acceptance criteria

Screen names match `design/prototype/vela-app.html`. Each criterion is testable.

### 14.1 The app (family)

**A1 · Onboarding 1 · Who.** Lists the people to keep a light on for; each has name, age, city, "lives alone"; add another; address form field; wake time field with the computed arrival hour shown live. Next is disabled until one person and a wake time exist.

**A2 · Onboarding 2 · First ask.** Three choices (a question, two photos, a 10-second hello) plus "write your own". Selecting a photo choice opens the picker for exactly two photos. Next creates the first exchange in state composed, scheduled for her first arrival. An invite link to the family is shown with copy naming grandchildren first.

**A3 · Onboarding 3 · Nearby.** Two contact slots (name, relation, phone); "consent sent" appears after saving; "Skip for now" is always available; the card explains this is part of Vela Light.

**A4 · Onboarding 4 · Channel.** Options: LINE (recommended in Taiwan and Japan), WhatsApp (Europe, India), Telegram, the Vela app ("I'll set it up for her"; recommended in the US). Choosing a messenger shows the invite text in her language with the organiser's name and the "say stop" line; "Send the invite" opens the messenger share sheet with the link.

**A5 · The light is ready.** Resting light, "The light is ready", the time of her first arrival, "Ask Mom something else" and "Go to Today". Becomes lit in place if she answers while the screen is open.

**A6 · Home · Today.** Header: lights row (one glyph per kept-light member, name, state text: "answered 8:12" · "quiet" · "away · Sunday" · "resting"). Body: today's exchange card (asker, ask, her answer with media and transcript, replies summary, receipt chip), then "Tomorrow · [Name]'s turn" card with the suggestion and "Use this". Primary action: "Ask Mom something". Tab bar: Today · Exchanges · Sunday · You. No badge counts anywhere. Opening the app when nothing changed shows the same screen with no "new" markers.

**A7 · Ask.** Suggestion card from her words with "Use this"; type grid (question, two photos, voice note, word to teach, old photo, vote); free-text field with live translation preview in her language; When: "Tomorrow morning" (default) or "Whenever"; "Into her morning" saves the exchange as composed and returns to Today with the tomorrow card updated. If tomorrow already has an ask by someone else, the screen says so and offers "the day after" or "whenever".

**A8 · Exchanges.** A list of exchanges, newest first, each showing asker → recipient, the ask, her answer, replies and reactions, receipt chip. Language switch shows originals. Tapping opens the exchange with the reply composer (heart · laugh · hug · text · voice · photo). No infinite scroll: the list ends with "the family book" link after 30 days.

**A9 · Weekly read.** Seven small lights for the week with late days marked; the count lines from the week's numbers, then up to four Literata notes (none when the week has nothing to say); one suggestion in action colour; story of the week card linking to the family book. Free plan shows the seven lights and "Vela Light shows you the read".

**A10 · Story day.** This Sunday's question with who chose it and "add a question"; recent stories with play buttons; "Export the book" (Vela Light) and "Read in the app" (free).

**A11 · Quiet notice.** A sheet over Today: label with her usual time, Literata title "It's been quiet at Mom's today", one calm paragraph of facts (last answer, arrivals sent, yesterday's words), nearby contacts with Call and Ask them to look in, primary "Call Mom", secondary "She's fine, I know why" and "Wait 2 hours". Closes itself when she answers, with the resolution line. Never red.

**A12 · You.** Own light toggle with the symmetry line; family list (kept-light members with plan state, contributors, nearby contacts with consent state); "One moment a day" notification setting (on by default, cannot be set to more than one); "What the family sees about you"; Pause; Leave.

**A13 · Vela Light.** Shown once, after her first answer: lit light, "Mom's light is on", the 30-day trial explanation, the plan card ($9.99/mo or $79/yr per kept-light member, second person +50%), what is always free, "Start the 30 days" and "Not now". Never shown again unless opened from You.

**A14 · Widget.** Her light and state, her latest answer (one line, one photo), "Tomorrow is [Name]'s turn · tap to ask". Updates on answer; never shows counts.

### 14.2 The parent surface

**P1 · Consent.** Display-size greeting with the organiser's name; three short paragraphs (what arrives, what happens on silence, how to stop); a toggle "Keep a light on for me"; the 88 pt "Yes, that's fine" button; "Read this aloud" plays the text. Declining shows "That's fine. Nothing will arrive." and tells the organiser.

**P2 · Question.** Greeting with her address form; the asker's avatar and name; the ask in Voice type with a play button if voice exists; up to three chips as the primary row (64 pt each); the mic below them at 96 pt with "or tell her in your voice"; "Just say hi today" as a text link; "What the family sees · Stop" at the bottom. If yesterday had replies, the screen first shows "From yesterday" with a play button and continues after it ends or on tap.

**P3 · Photo choice.** Two photos filling the width, at least 190 pt tall each; a tap selects with a 4 pt teal ring and posts the answer after a 1 s undo window; optional mic; "Just say hi today".

**P4 · Recording.** Tap to start, tap the square to stop; elapsed time in 28 pt; up to 60 s; then playback with "Send" and "Say it again"; "Back" always available; no time limit to decide.

**P5 · After answering.** The light blooms once (600–900 ms, no pulse); "Thank you. Anna knows you're fine."; "From yesterday" card with the replies read aloud and "Hear it again"; three family photos; "Call Anna". This screen is what she sees if she opens the app again the same day.

**P6 · Kitchen-table mode.** Landscape; clock and date; the day's ask in Display type; "Answer Mia" 88 pt; photos cycle when idle; one chime at the arrival hour, opt-in; tap anywhere wakes to P2/P3.

All parent screens: body 22 pt minimum, targets 64 pt minimum, contrast 7:1, light mode only, every text readable aloud, no menus.

### 14.3 The messenger path (Telegram first)

**M1 · Invite.** The organiser's share link opens the bot with a start parameter; the bot greets her by address form in her language and asks consent (§9) with two buttons.

**M2 · Arrival.** One message: yesterday's replies (if any, text plus voice files), then "[Name] asks:" and the ask, with media; inline buttons per type (chips · photo A/B · vote options · ❤ · "I'm fine"); "Reply with a voice message or tap a button".

**M3 · Answer.** Any message counts. Voice is transcribed; a chip tap edits the message to show her choice. The acknowledgement follows once.

**M4 · Repeat.** Same message, prefaced, once.

**M5 · Commands.** "stop" / "start" / "what does the family see", in her language, as plain words, no slash needed.

**M6 · Nearby contact (organiser's tap).** A message in the organiser's name with one button "I'll look in" and one "Can't today"; the reply goes to the organiser.

### 14.4 What no surface may do

Show a feed of everything; badge counts; streaks; "great job"; anything that rewards frequent opening; describe her as monitored, checked on, or tracked; send her anything not from a person except the fallback hello and system notices.

## 15. Notifications budget

Per member per day: one arrival (their surface), at most one turn prompt (19:00 the evening before), one answer receipt to an asker (folded into their arrival if they already had a notification), quiet notices to organisers as they occur, one weekly read, escalation flags as the only exception. Nothing else. Enforced by the outbound gateway, which rejects any send that exceeds the budget and logs it.

## 16. Plans and billing

| | Free | Vela Light |
|---|---|---|
| Who | Every member | Per kept-light member; the billing organiser pays |
| Includes | Asks, answers, replies, turns, translation, story day, reading the family book, the lights as "answered today" | Quiet notices, nearby contacts and Ask them to look in, away mode, the weekly read, memory and reminders, family book export, precision page |
| Price | 0 | $79/yr pre-selected, or $9.99/mo as the low-commitment ramp; per kept-light member; second member +50%; to be tested against $14.99 |
| Trial | | 30 days after her first answer, no card |
| Lapse | | 14 days grace; then Light features stop; arrivals and exchanges continue; nobody is cut off from family |

Payments provider and legal entity are open (founder decision; Singapore under consideration). The app never blocks the exchange behind a paywall.

## 17. Data

- **Kept:** names, address forms, cities, languages, hours, nearby contacts, exchanges (30 days of media by default; the family book by choice), summaries, weekly reads, precision outcomes.
- **Not kept:** raw audio beyond 30 days unless in the family book; location; contacts beyond the two nearby; anything from her device other than what she sends.
- **Deletion:** "left" deletes a member's data after 30 days; "delete family" within 24 h; death (§19) keeps a read-only record one year unless exported, then deletes.
- **Residency:** region from the kept-light member's country (eu · apac · us); GDPR for Europe, APPI for Japan, DPDP for India reviewed before each launch; Russia deferred.
- **AI sees:** her answers, the ask, the family's replies, the member list with roles and languages, memory facts. Never billing data, never nearby contacts' numbers. Every AI call is logged with prompt version and output.

## 18. Events and metrics

Minimal event list, all with family id, member id, exchange id, surface, local time:

`ask_composed` (type, asker role, from suggestion), `arrival_delivered` (type, on time), `arrival_seen`, `answer_recorded` (kind: voice · chip · photo · vote · heart · text · fine), `reply_posted` (kind), `readback_delivered`, `readback_played`, `repeat_sent`, `quiet_notice_sent`, `quiet_notice_resolved` (outcome), `ask_to_check_sent`, `away_set` (source), `consent_given`, `stop_said`, `trial_started`, `plan_started`, `plan_lapsed`, `weekly_read_opened`, `story_saved`.

They produce the metrics below (targets revised against research/14; kill signals in brackets): answer rate for kept-light members ≥ 75% of days in weeks 1–4 and ≥ 65% at week 12 [< 50%]; median latency < 60 min; answers with content ÷ answers > 70%; replies per answer ≥ 1.5; types per family per week ≥ 3; grandchild-initiated asks per week ≥ 2; quiet-day rate < 20%; quiet notices per member per month < 4 by month 3, with > 60% marked useful by the organiser and the true-concern share published; "stop" rate < 10% in month 1 [> 30%]; families with a kept-light member paying at day 90 ≥ 10% [< 4%]; monthly paid retention ≥ 90%; minutes in app per member per day 2–4; "very disappointed if Vela stopped" > 40%. Loneliness is measured (UCLA-3 at weeks 0, 4, 12 in the pilot), never claimed.

## 19. Edge cases

| Case | Decision |
|---|---|
| DST on arrival day | Local wall-clock hour; if it doesn't exist, the next valid minute |
| Two organisers disagree (one marks away, one calls) | Both logged; away wins for the ladder; each sees the other's action |
| She changes phone number | Messenger link breaks; the app shows "we lost Mom's Telegram"; re-invite flow; the light pauses without a quiet notice |
| Family in two countries | Holidays follow her country |
| She answers before the arrival is sent | Counts as today's answer; the arrival still goes out |
| Two families, one grandmother | Both arrivals sent; copy discourages; phase 2 merges |
| The asker withdraws after delivery | Not possible; before delivery, the composer picks the next item |
| Nobody in the family has asked for 7 days | The organiser's weekly read says so plainly; Vela does not invent asks |
| Organiser stops paying | 14 days grace; Light features stop; exchanges continue free |
| Her messenger is blocked in her country | The adapter reports failures; the organiser is told once; the ladder does not fire on our failure; the app offers the next channel |
| Our worker is down at her hour | The next tick catches up; late arrival is marked; no quiet notice counts time before delivery |
| A kept-light member dies | Any member marks it; every schedule stops within the hour; the family book is offered for export; no automated message of any kind afterwards |

## 20. Copy and accessibility

- Names, never "the parent" or "the user". Neutral over alarming. Every notice ends with the one thing the reader can do.
- She is never described as monitored, checked on, or tracked, anywhere, including in our copy to the family and on the website.
- English is authored first; every string has a key; Russian and Traditional Chinese are reviewed by a native speaker before launch; no idioms, no emoji as tone.
- Parent surface and messenger: 22 pt body, 64 pt targets (88 for the primary), 7:1 contrast, no time limits, everything readable aloud; Android 8+ and iOS 15+ for the app; messengers on anything that runs them.

## Appendix A · Phase-0 instrument (no app)

The pilot starts on Telegram (the cheapest bot platform, voice-capable, and where the founder's own family already is) for the first 3–5 families, then continues on LINE for Taiwanese families from sprint 2. It measures whether the loop works before the app exists.

- **Setup.** The organiser adds the Vela bot to a new Telegram group with the family (not the grandmother). The grandmother talks to the bot in a private chat (M1). The founder onboards each family by call.
- **Asking.** In the family group the bot posts at 19:00 her time: "Tomorrow is Anna's turn with Mom. Reply to this message with a question, a photo, or a voice note." A reply to that message becomes tomorrow's ask; `/ask <text>` does the same without replying, and `/later <text>` saves a whenever ask. Two photos sent as one album become a photo choice. The bot confirms "Into Mom's morning." If nobody asks by 22:00, the bot uses the oldest whenever ask or the fallback hello. Telegram's group privacy mode means the bot sees only replies to its own messages and commands, never the family's ordinary conversation.
- **Her morning.** M2–M4 as specified, in her private chat.
- **Her answer.** Nothing she writes before she taps Yes on the consent message, or after she says no, is stored or posted. Once she has agreed, the bot posts her answer into the family group: "☀️ Mom answered Anna · 8:12" with her choice, text, or voice, then the transcript and translation as a reply once processed. Replies to that post are collected; reactions on it are collected when the organiser makes the bot a group administrator (Telegram only delivers reactions to administrators).
- **Read-back.** The next morning's arrival opens with those replies, as text plus forwarded voice notes.
- **The light.** The bot posts "Mom answered · 8:12 ☀" in the group; quiet notice at T_quiet to the organiser privately with the names and phone numbers, as text, of the nearby contacts who said yes to being listed (the founder records each contact's answer); "Ask them to look in" is the organiser's own call in phase 0.
- **Weekly read.** The founder edits the AI draft's notes and suggestion (ready on Sunday evening) on the admin page and taps Send; the count lines come from the week's numbers and cannot be edited. The bot sends each organiser, privately, the counts, the notes, and the suggestion (§13). When she asks "what does the family see", she gets the summaries of her last seven answered days and the notes of the most recent sent weekly read, in her language, never its counts or its suggestion (§8, §9, §13). The founder's own Telegram chat with the bot carries no content: a flag or a draft arrives there only as a link to the admin page.
- **Logged from day one.** Per parent per day: ask delivered (type, asker), seen, answered (kind), time to answer, replies received, replies heard, quiet notice and its outcome, away, stop. Per family per week: who composed, quiet days, types used. UCLA-3 loneliness at weeks 0, 4, 12 and "if Vela stopped tomorrow" at days 14 and 30, asked by the founder on the calls.
- **Not in phase 0.** Payments in the app (the $15 pilot fee is collected by hand), WhatsApp, the parent surface, memory, votes.

This appendix supersedes the v1 bot spec (`archive/product/bot-spec.md`). It is implemented on the production platform in `apps/worker` and `packages/services`; the D1 prototype is archived in `archive/phase0-bot-d1/`.

## Appendix B · Parameters checked against the evidence (2026-09-13)

| Parameter | Before | After | Source |
|---|---|---|---|
| Kept-light answer rate | > 85% | ≥ 75% weeks 1–4, ≥ 65% at week 12 | research/08 |
| T_quiet | start 5 h, 4–8 h | start 6 h, 4–10 h, 14-day learning period | research/08 |
| Quiet notices | < 2/month, > 50% true | < 4/month by month 3, > 60% useful, true share published | research/08, /11 |
| Answer bar | mic first | one tap always possible; chips primary, mic offered | research/10 |
| Consent | screen + stop | no monitoring words; stop rate < 10% month 1 | research/08, /11 |
| First adapter | Telegram (RU), LINE (TW) | confirmed, with the parent surface as the floor, the voice line in phase 2, LINE paid plan from day one | research/10 |
| Price | $9.99/mo or $79/yr | confirmed; annual pre-selected; adult child owns the account | research/09 |
| Conversion | > 25% at 90 days | ≥ 10% of kept-light families at 90 days | research/09, /12 |
| Turns, one notification, no streaks, no feed | rules | confirmed | research/12 |
| Loneliness | claimed | measured, not claimed | research/08, /11 |
