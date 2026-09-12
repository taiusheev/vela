# Vela product specification

v1, 2026-09-12. The functional contract for the MVP and phase 2. Written so a designer, an engineer, and the founder read the same thing. Companion to `02-app-plan.md` (why) and `architecture/01-technical-design.md` (how).

Vocabulary: **family**, **member**, **organiser**, **kept-light member** (a member with a light), **nearby contact**, **arrival** (the one daily message), **answer**, **light**, **quiet notice**, **away**, **weekly read**, **story day**, **turn**.

---

## 1. Members and their states

A person is a **member** of one or more families. Each membership has a role and a set of surfaces.

| Field | Values | Notes |
|---|---|---|
| role | organiser · member | One or more organisers per family; the organiser who pays is the **billing organiser** |
| surfaces | app · parent-surface · telegram · whatsapp · line · max · viber · voice | A member may have several; the arrival goes to the **primary** one |
| light | off · on | On only with the member's consent (§6). A member may switch their own on or off any time |
| status | invited · active · paused · left | Paused = "stop for now" from either side; left = removed, data retained 30 days then deleted |

**Member states, as the app shows them:**

| State | Meaning | Shown as |
|---|---|---|
| Unlit | Light on, no answer yet today, within her usual window | Outlined light |
| Lit | Answered today | Filled light, time of answer |
| Quiet | Past her tuned quiet threshold, no answer, no away | Outlined light with a dot; quiet notice sent |
| Away | Away mode active | Dashed light, "until Sunday" |
| Paused | Member or family paused | Grey, "paused" |
| No light | Ordinary member | No light drawn; appears in the thread only |

## 2. Families

- A family has a name (default: the eldest's surname or "Our family"), a region for data residency, a plan (free, light), and members.
- **Invites.** Any member can invite by link or phone/email. The invite names the family and who invited. Accepting creates a membership with role member.
- **One person, two families.** A grandmother whose two children set up separately: the second setup detects the same channel identity (phone number or Telegram id) and offers "join Anna's family instead" or "create a second family". MVP allows both; the parent receives one arrival per family per day, which we discourage in copy. Phase 2 merges.
- **Deleting a family** removes all data within 24 h except exported archives the family downloaded.

## 3. The arrival

**When.** Each member with a primary surface gets one arrival per day at their **arrival hour** (default 08:00 local; for kept-light members, their wake time plus 30 minutes as set by the organiser or learned). Never more than one per day. Time zone is the member's, including DST.

**What goes in, in priority order:**
1. Items queued for today, addressed to this member or to everyone.
2. Items queued for "whenever", oldest first, at most two.
3. On story day (default Sunday), the story question for kept-light members.
4. If nothing above applies and the member is kept-light: a **Vela fallback**, two lines, signed "Vela, from your family", referencing yesterday's answer summary and the local weather. Ordinary members get no arrival on an empty day; their app simply shows the thread.

**Composition rules.**
- One photo or drawing maximum in the visible message; further items are attached as a small gallery where the channel supports it, else sent as a second message *only* within the same minute (counts as one arrival).
- Voice notes are delivered as voice where the channel supports it; otherwise transcribed.
- Text is in the member's language; contributions in another language are translated with the original underneath (§9).
- The greeting uses the member's address form ("Mrs Ivanova", "Mom", "Galina Petrovna").
- Reply affordance: a button "☀️ I'm fine" where buttons exist; where they don't (WhatsApp free-form, voice), the copy says "reply with anything, even a heart".

**Repeat.** If a kept-light member hasn't answered 2.5 h after the arrival, the same arrival is re-sent once with a one-line preface ("in case you missed it"). Ordinary members never get a repeat.

## 4. Answers

Anything from the member on any surface between arrival and the next arrival counts as **today's answer**: button tap, reaction, text, voice, photo, sticker, a call attempt through the app.

**Processing.**
1. Record raw answer with channel metadata.
2. Voice: transcribe (member's language, auto-detect fallback).
3. AI understanding: one neutral summary line, mood words (from a fixed vocabulary), mentions (people, places, plans, health words, dates), flag (none | escalate) with reason, and a language tag.
4. Translations for members whose language differs (§9).
5. Post to the family thread as "[Member] answered": summary line, media, transcript behind a tap.
6. If the answer references a contributor's item, notify that contributor ("Grandma answered your photo").
7. Light the light; cancel any pending repeat or quiet notice; if a quiet notice was sent, resolve it and notify whoever was told.

**Vela's replies to a kept-light member.** At most one warm acknowledgement per day, in the member's language, two sentences, at most one question; never medical advice; never continues into a conversation. If the member writes again the same day, the reply is a fixed sign-off or nothing. (Phase 0 prototype allows four turns; MVP allows one.)

**Escalation flags.** Health words (pain, fall, dizzy, chest, breathing, not eating), hopelessness, a stranger at the door, "the bank called", requests for money. On a flag: the organiser gets a notice with the member's words verbatim (this is the one place we quote, because the organiser must judge), the acknowledgement to the member is calm and warm, nothing is auto-sent to nearby contacts.

## 5. The quiet ladder

Applies only to kept-light members.

| Step | When | What |
|---|---|---|
| Repeat | arrival + 2.5 h | Re-send the arrival (§3) |
| Quiet notice | arrival + T_quiet | Notice to organiser(s) in the app and by push: last contact, usual answer time, yesterday's summary, nearby contacts with **Call** and **Ask to check**, buttons **She's away** and **Wait 2 hours** |
| Auto-ask (opt-in) | notice + T_auto, no organiser action | Message to the first nearby contact: "Anna asked us to check on Mrs Ivanova; she hasn't answered today. Could you knock or call?" |
| Resolution | any answer, or organiser marks fine/away | Notice closes; everyone told is told it's fine |

**T_quiet tuning.** Start at 5 h. After 14 days, T_quiet = median answer latency over the last 14 answered days + 2 h, floored at 4 h and capped at 8 h, recomputed weekly. Sundays and known holidays (member's country) use the Sunday median if it differs by more than 1 h.

**Wait 2 hours** re-sends the notice after 2 h if still quiet. **She's away** opens away mode until a date the organiser picks (default: tomorrow).

**Away mode.** Sources: the organiser or any member sets it; the kept-light member says it in an answer ("going to my sister's until Sunday", detected by the AI with a confirm-back: "Until Sunday, then. Have a lovely trip."); or Vela learns a recurring pattern (Sunday church) after three occurrences and proposes it. In away mode: arrivals continue (people like them), repeats and quiet notices do not. Away ends on the date, or on any answer if the member chose "until I'm back".

**Precision accounting.** Every quiet notice records an outcome: answered late, away, true concern (organiser confirms something was wrong), unknown. Precision = true concern ÷ notices. Published monthly.

## 6. Consent and the light

- A light is switched on for a member only after they agree. On a messenger surface, the first message asks: "Anna would like to keep a light on for you: every morning something from the family, and if you don't answer, she'll know to call. Tap 'Yes' or write 'no'." On the parent surface, it's a screen. For a member who set the light on themselves, consent is implicit.
- "Stop", "не надо", "停" or any refusal turns the light off and pauses arrivals; the organiser is told, without judgement.
- **What the family sees.** Any kept-light member can ask in the chat "what does the family see" and gets: the summary lines of the last 7 days and the last weekly read. The parent surface has it as a button.
- Nearby contacts consent once via a message from Vela on the organiser's behalf; until they say yes, they cannot be auto-asked, only called by the organiser directly.

## 7. Turns and prompts

- **Turns** rotate among members who opted into turns (default: all members except kept-light ones), one per day, round-robin, skipping days that already have queued content. The turn holder gets a prompt the evening before (their 19:00) with one suggestion.
- **Prompts** are generated from: the kept-light member's recent mentions ("she mentioned the tomatoes"), family dates (birthdays, appointments from memory), and the contributor's own last item. One sentence, one concrete ask. Never guilt-tripping copy; skipping a turn has no consequence except the fallback.
- A family can turn turns off; the organiser then gets a single weekly "the queue is empty" note.

## 8. Story day

- Weekly, default Sunday, for kept-light members. One question from a curated bank (ordered gently: childhood, first job, how you met, a recipe, a place), never repeated, skippable ("ask me another").
- Answers (voice or text) are transcribed, translated, and stored in the **archive** if the family keeps them (default on; the storyteller can say "don't keep that one").
- The archive is exportable as a PDF book (phase 2) and, later, a printed book via a print partner (phase 3, optional).

## 9. Language and translation

- Every member has a language; the family thread shows each item in the reader's language with the original one tap away.
- Translation preserves register: address form, diminutives, and the grandchild's tone. The AI is told who is speaking to whom.
- Supported at MVP: English, Russian, Traditional Chinese. Phase 2: Ukrainian, Tagalog, Hindi, Spanish, Japanese, Korean, German.
- Transcription language is the member's, with auto-detect fallback.

## 10. Memory and reminders

- From answers, the AI extracts dated facts ("doctor on Thursday", "Mia's exam next week") and proposes a reminder to the relevant member ("Ask Mom how the doctor went on Friday?"). Reminders are created only on a tap, never silently.
- Memory shows in prompts and in the weekly read. It is never shown to the kept-light member as "we noticed"; it appears as the family asking.

## 11. The weekly read

- Sunday, to organisers and members who opted in, for each kept-light member.
- Three to five lines: answered N of 7 days; usual time and drift vs last week (only if > 30 min); topics; anything mentioned twice or more; voice note length drift (only if > 40%); one suggestion.
- Words: "later than usual", "shorter than usual", "mentioned twice". Never "concerning", "decline", "risk". No scores.
- The kept-light member can read it too (§6).

## 12. Surfaces: what each must do

| Surface | Must | Must not |
|---|---|---|
| App (member) | Show lights and today's moment first; thread; queue; turns; settings for own light; language; invite | Show a feed of everything; badge counts; anything that rewards frequent opening |
| Parent surface | One screen; the arrival; one big answer button; voice reply; call the organiser; "what the family sees"; "stop" | Menus, settings, anything that requires reading small text |
| Kitchen-table mode | Cycle family photos when idle; wake to the arrival; tap anywhere to answer; large clock | Notifications, sounds beyond a gentle chime at the arrival hour |
| Messenger | Arrival as one message; button where supported; accept any reply; commands "stop", "start", "what does the family see" in the member's language | Chat beyond the one acknowledgement; links to install anything |
| Voice line (later) | Call at the arrival hour from a saved number; play the family's voice notes; "press 1 if you're fine, or just say something" | Menus deeper than one level |

## 13. Notifications budget

Per member per day: one arrival notification (their surface), at most one turn prompt (evening before), quiet notices to organisers as they occur, one weekly read. Nothing else, ever. Enforced by the outbound gateway (technical design §5), not by discipline.

## 14. Edge cases we've decided

| Case | Decision |
|---|---|
| DST change on arrival day | Arrival at the local wall-clock hour; if the hour doesn't exist, the next valid minute |
| Two organisers disagree (one marks away, one calls) | Both actions are logged; away wins for the ladder; both see each other's action |
| Member changes phone number | Messenger link breaks; app shows "we lost Mom's Telegram"; re-invite flow |
| Family in two countries with different holidays | Holidays follow the kept-light member's country |
| A kept-light member answers before the arrival is sent | Counts as today's answer; arrival still goes out (people like it) |
| Two arrivals due within the same minute for the same member (two families) | Both sent; product copy discourages two families; phase 2 merges |
| Organiser stops paying | Light features stop after grace of 14 days; arrivals and thread continue on the free plan; nobody is cut off from family |
| Kept-light member dies | Any member marks it; all schedules stop within the hour; the archive is offered for export; no automated messages of any kind afterwards; the family record is kept read-only for a year, then deleted unless exported |

## 15. Copy principles

- Address people by name. Never "the parent", "the user".
- Neutral over alarming. "Hasn't answered yet" not "no response detected".
- Say what happens next. Every notice ends with the one thing the reader can do.
- The kept-light member is never described as monitored, checked on, or tracked, in any surface, including ours to the family.
- English is authored first; every string has a key; translations are reviewed by a native speaker before a market launch.

## 16. Accessibility (parent surface and messenger)

- Minimum 18 pt text on the parent surface, buttons at least 64 pt tall, contrast 7:1.
- Voice everywhere: every text can be read aloud; every reply can be spoken.
- No time-limited interactions; nothing disappears.
- Works on Android 8+ and iOS 15+ for the app; the messenger path works on anything that runs the messenger.
