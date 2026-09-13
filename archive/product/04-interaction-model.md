# Vela interaction model: from "tap I'm fine" to a place where the family actually talks

> **Superseded on 2026-09-13 by [`05-product-spec-v2.md`](05-product-spec-v2.md).** Kept for history; where the two differ, v2 wins.

v1, 2026-09-12. Founder's direction: Vela must make the generations interact, not check on each other. This document replaces the "morning message with a button" model in the product spec §3–4 wherever they conflict. The light (the sign of life) stays, but it becomes a by-product of a real exchange.

## 1. The principle

Every arrival is a **conversation starter with a specific ask**, from a specific person, that the recipient can answer in one gesture and that produces a reply back. The daily loop is:

```
someone asks or shares  →  she answers (voice, choice, heart)  →  the family reacts  →  she hears the reactions tomorrow
```

"I'm fine" never disappears, but it is the small fallback at the bottom ("Just say hi today"), never the hero button. On a good day she never sees it, because she answered Mia's question instead.

## 2. Arrival types (the ask is the design)

| Type | What arrives | How she answers (one gesture) | What the family gets back | Why it works |
|---|---|---|---|---|
| **Question from a person** | "Mia asks: what did you cook today?" | Voice reply; or one of three answer chips Vela drafts from her past answers ("Soup", "Pancakes", "Nothing yet") | Her answer in the thread; Mia gets "Grandma answered you ♥"; the family reacts | The most natural human exchange; Storyworth, Remento, Kinsome all prove elders answer questions |
| **Photo with a choice** | Two photos from Sam's trip: "Which one should I frame?" | Tap left or right; optional voice | Sam gets her pick and any words; a small "Grandma chose this one" on the photo | A choice is an opinion; opinions are conversation |
| **Voice note to answer** | Sam's 10-second note about his exam | Voice reply, or a heart | Sam hears her back | Voice is the lowest-friction, highest-warmth medium for 75+ |
| **Word of the week** | "Mia is learning Russian. Teach her one word today?" | Say the word; Vela records and transcribes | Mia gets Grandma's voice saying the word plus the translation; Mia records it back tomorrow | Reverses the roles: she is the teacher. Uses translation as a game, not a utility |
| **Story day** | "How did you meet Dad?" (family-voted) | Voice, as long as she likes | The story lands in the family book; grandchildren react; Vela offers a follow-up question next week | She is the author |
| **Recipe / how-to** | "Sam wants to make your borscht. How do you start?" | Voice, step by step over several days if she likes | A living recipe card assembled from her answers | Practical, proud, repeatable |
| **Memory photo** | An old photo Anna scanned: "Who is this?" | Voice; names get attached to the photo | The family archive gains names and stories | Nostalgia is the strongest hook for the eldest |
| **Family vote** | "Sunday call at 6 or 7?" | Tap one | Everyone sees the result; the call gets scheduled | Makes her part of decisions |
| **Just a hello** (fallback) | A warm morning from Vela on the family's behalf when nothing was queued | Heart, or "I'm fine" | The light lights; the organiser sees "quiet day, she's fine" | Keeps the ritual alive; Vela's job is to make this rare |

Rotation rule: Vela varies the type across the week (question, photo, voice, word, story) so the ritual never becomes a formality. The family can pin types they like.

## 3. The reply loop (what makes it a place, not a ping)

- **Her answer is a post the family replies to.** Under it: reactions (heart, laugh, hug), short replies, voice replies. No counts shown to her; she hears the substance.
- **Tomorrow's arrival opens with yesterday's replies.** "Sam laughed at your story and says the borscht turned out well. Today, Mia asks…" Vela reads it aloud on the parent surface. This is how she experiences the family's presence without opening a feed.
- **Receipts both ways.** The sender learns "Grandma saw it · 8:12" and "Grandma answered you"; she learns "Mia listened to your story twice."
- **Threads close.** After a day, an exchange is done and lives in the archive. Nothing nags for a reply.

## 4. Roles in the loop

| Person | Gives | Gets |
|---|---|---|
| Grandmother (kept-light) | Answers, stories, words, opinions, recipes | Questions that show she matters; the family's reactions; the family book |
| Grandchild (20, abroad) | Questions, photos, ten-second notes, a word learned back | Her voice; the sense he can reach her in ten seconds; his own light for his mother if he wants it |
| Parent (45, organiser) | Turns, the occasional prompt, the memory photos | Calm (the light), the weekly read, and a family that talks without her pushing |
| Younger children (via a parent's phone) | Drawings, "guess what I drew", questions in their own words | Her reply read aloud to them |

## 5. What Vela's AI does here (and doesn't)

Does: drafts the three answer chips from her own past answers; transcribes and translates; reads replies aloud; suggests the next question from what she said; assembles the recipe card and the family book; picks the day's type to keep variety.
Doesn't: ask questions in its own name (questions come from people; the fallback hello is the only Vela-authored arrival); reply on anyone's behalf; score, count, or rank anyone.

## 6. How this changes the screens

- **Home** is "Today with Mom": her answer to yesterday's ask, the family's replies under it, and the next ask being prepared ("Tomorrow: Mia's question"). Lights are in the header, small. The primary action is "Ask Mom something" / "Reply to Mom".
- **Send** becomes **Ask**: pick a type (question, photo choice, voice, word, memory photo), Vela suggests one from her words; "whenever" queue stays.
- **Parent surface** shows one ask at a time with the matching answer bar: for a question, a big mic and three chips; for a photo choice, two big tappable photos; for a voice note, play then a mic; for a word, a mic with "say it once". "Just say hi" is a small line at the bottom.
- **Thread** is a list of exchanges (ask, answer, replies), not a chat.
- **Weekly read** adds "what she taught, told, and chose this week."

## 7. Metrics that follow

- Answers with content (voice, choice, chips) ÷ all answers: target > 70% (the rest are hearts and "hi").
- Replies from the family per answer: target ≥ 1.5.
- Types used per family per week: target ≥ 3.
- Grandchild-initiated asks per week: target ≥ 2 per family.
- Quiet-day rate (fallback hello used): target < 20% of days.

## 8. What stays from the old model

The light, the quiet ladder, away mode, the weekly read, nearby contacts, consent and symmetry, the notification budget, the parent surface's accessibility rules. The paid layer is unchanged. What changed is what the arrival asks for and what comes back.
