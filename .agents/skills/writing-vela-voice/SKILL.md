---
name: writing-vela-voice
description: Vela's voice for every word a family reads, in English and Traditional Chinese. Use when writing, rewording or reviewing anything a parent, organiser, family member, nearby contact or website visitor will read - bot and LINE messages, app screens, notifications, question-bank asks, AI prompts that draft family-facing words, the website, store listings, emails to families - or when the founder asks to "make it warmer", "check the wording", "fix the copy" or "does this sound right". Not for code comments, PR text or reports to the founder.
metadata:
  owner: founder
  last-checked: "2026-10-20"
---

# Writing in Vela's voice

Vela is a small question from the family each morning, carried to a parent who lives alone. Every word either feels like the family asking about her life, or like a device checking on her. Older parents refuse the second: 30–40% of invited elders turn down anything framed as monitoring (`plan/why-vela.md` §1). So the voice is not decoration; a wrong word loses the family.

**Before writing, read the lines next to yours** in the same catalog and match them. The tests below catch the banned words, not a cold tone.

## We are / We are not

| We are | We are not |
|---|---|
| A family asking about her life: her childhood, her cooking, her opinions | A device checking on her, her mood or her health |
| Facts, then the one thing the reader can do | Alarms, worry or guesses about what silence means |
| Names: Mom, Mrs Chen, Mia | "the user", "the parent", "the senior", "the elderly" |
| Calm, plain and short; one idea per sentence | Cheerful hype, exclamation marks, "great job", streaks, guilt |
| Honest about limits: Vela cannot detect a fall or call for help | Promises of safety ("keeps her safe", "for your safety") |
| Her choice: nothing starts until she says yes; "no" is a good answer | Persuading, nagging, or naming a feeling she did not say |
| People ask and sign; Vela only carries | Vela speaking as a person without saying "written by Vela" |

## Words

**Never use, anywhere a family can read** (the website and our emails included, spec §20):

- *monitor, track, check on, keep an eye on, watch over, keep tabs on, surveillance* (enforced by `SURVEILLANCE_WORDS` in `packages/copy/src/rules.ts`)
- *safety alert, for your safety, alarm*; say *quiet notice* or *quiet note*
- *user, senior, elderly, the parent, patient*; use her name, or how the family greets her
- *check-in* in family-facing copy. The website's line is "Not a check-in. A conversation." The word is fine in research and internal notes.
- *mood, wellbeing score, streak, great job, don't worry*
- In a suggested ask or a bank question: *are you OK, how are you feeling, health, sleep, pain, doctor, medicine, lonely, alone* (`HEALTH_CHECK`). An ask is about her life, her knowledge or her opinions, never how she is.

**Pronouns.** Name her. Messenger copy (`packages/copy`) never uses he/she (`GENDERED_PRONOUNS`), because Vela never assumes her gender. Chinese copy in the bot and app never uses 他 or 她 (`FORBIDDEN_ZH_TW`). The app's English has some "her" lines; prefer the name in new ones.

**Use these words** (full Chinese glossary and register: the `vela-zh-tw` skill):

| English | Traditional Chinese | Not |
|---|---|---|
| keep a light on for you; her light | 為您留一盞燈；燈 | status, tracker |
| the morning message; the morning | 早安訊息 | check-in, reminder |
| an ask; ask her something | 提問；問{name}一件事 | prompt, task |
| her answer | 回覆、回答 | response |
| a reply (the family's, to her answer) | 回覆 | comment |
| organiser (British spelling, like *neighbour*) | 發起人 | admin, caregiver |
| people nearby; look in | 附近的聯絡人；過去看看 | emergency contact |
| quiet notice; "It's been quiet at Mom's today" | 安靜通知；媽媽那邊今天比較安靜 | alert, missed check-in |
| away | 不在家 | absent, offline |
| weekly read | 每週小記 | report, score, summary |
| family book | 家庭故事書 | archive, database |
| Memories (the tab) | 回憶 | history, log |
| story day | 故事日 | |
| written by Vela (the send-as-me label) | Vela 代筆 | AI-generated |
| stop / start (what she says) | 停 / 開始 | unsubscribe |
| Vela, Vela Light | Vela, Vela Light (always Latin letters) | |

A new product word needs the founder's yes. Add it to this table and to `vela-zh-tw` in the same pull request.

## How the words behave

- **Notices end with the one thing the reader can do** ("If you can, give Mom a call."), and say what is not known ("Nothing worrying is known."). Neutral over alarming.
- **She is told nothing alarming about herself.** She never sees missed days, counts or the weekly read's numbers (spec §8, §13).
- **Stops carry no judgement.** "Mom asked to pause. Nothing is wrong with the app."
- **Short.** One idea per sentence, about one sentence per screen. No idioms, no emoji as tone (☀️ and ❤️ in lines and buttons are markers, not mood). Every sentence must translate cleanly.
- **No exclamation marks** in notices, screens or Vela's own sentences. A greeting may have one, as a person's would ("Morning, Mom!").
- **Who acts is always clear.** The family asks, the organiser calls, Vela carries. "Vela never contacts anyone on its own."
- **Lock screens get names and times only**: never her words, an answer or anything about health (`push.*` in `en.ts`).
- **Consent and notice wording is a promise.** Changing `consent.*`, the privacy notice or the consent script means a new text version: follow the `guarding-family-data` skill.

## Sounding like a person, not a model

Cut these on sight:

- Comfort the reader did not ask for: "We're here for you", "Don't worry", "Rest easy".
- Marketing words: seamless, effortless, empower, journey, peace of mind (in anything she reads).
- Three adjectives where one fact would do.
- "It's not just X, it's Y" more than once on a page.
- A question that answers itself ("Want to feel closer? Vela can help.").
- Naming a feeling for someone ("Mom seemed happy today").

## Three before-and-after examples

All "after" lines are the real copy.

**1. A quiet morning, to the organiser** (`quiet.notice`, `quiet.next_step`)

- Before: "⚠️ Alert! Mom missed her check-in. Tap to check on her now."
- After: "It's been quiet at Mom's today. The morning message went out at 08:00; Mom usually answers by 09:30. Nothing worrying is known. If you can, give Mom a call."
- 中文: 「媽媽那邊今天比較安靜。早安訊息在 08:00 送出；媽媽通常會在 09:30 前回覆。目前沒有任何令人擔心的消息。方便的話，打個電話給媽媽。」

**2. The invite the organiser sends her** (`invite.for_her`)

- Before: "Your son has set up Vela to monitor your wellbeing every day and keep you safe."
- After: "Hello Anna, it is Mia. I would like to keep a light on for you: one small question from the family each morning. Open this to hear about it, and say yes if you would like it: [link] You can say stop at any time."
- 中文: 「Anna您好，我是Mia。我想為您留一盞燈：每天早上，家人會問您一件小事。打開這個連結看看，願意的話就說好： [link] 您隨時都可以說「停」。」

**3. Describing Vela to families** (the website, `apps/worker/src/site.ts`)

- Before: "Track Mom's daily mood and get a weekly wellness score, so you always know she's safe."
- After: "One small question from the family each morning. She answers in LINE with a tap or her voice. If a morning stays quiet, you know that day."
- 中文: 「每天早上，家人問媽媽一個小問題。她在 LINE 上點一下或說一句話回答。如果哪天早上沒有回音，您當天就會知道。」 (The website speaks to adult children about Mom, so it may say she/她; the catalogs may not.)

## Where the words live, and the check for each

| Words | File | Check |
|---|---|---|
| Bot, LINE and Telegram messages | `packages/copy/src/en.ts`, `zh-TW.ts` | `pnpm --filter @vela/copy test` |
| Question bank (`text` is Vela's voice, `child` is a son or daughter's) | `packages/copy/src/ask-bank.ts` | same |
| App screens | code via Lingui, then `apps/app/src/i18n/locales/*.po` | `pnpm --filter @vela/app test` |
| AI prompts that draft family words | `packages/ai/src/prompts/*.vN.ts` (a change is a new version file) | `pnpm --filter @vela/ai test` |
| Website | `apps/worker/src/site.ts` | `pnpm --filter @vela/worker test` |
| Privacy notice, consent script | `plan/materials/pilot/` | `guarding-family-data` skill |

Read the long comment at the top of `en.ts` before changing a bot message: it says why each tricky line reads as it does. The sources for this skill are spec §1, §9, §14.4 and §20 (`product/05-product-spec-v2.md`), the Voice section of `design/design-system.md`, and "How to speak" in `plan/materials/pilot/consent-script.en.md`.

When a change alters wording families will notice, show the founder the before and after in the pull request, and wait for their yes.
