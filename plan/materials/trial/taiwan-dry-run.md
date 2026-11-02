# The LINE dry run on staging, before the first Taiwan family

29 October 2026. For the founder and one helper. Two to three days on **staging**, in Chinese, on LINE, so the first real family does not find a broken step. Step 3 of [`../../taiwan-line-test.md`](../../taiwan-line-test.md). Nothing here touches production or a real family.

## Who plays whom

LINE allows one account per phone, so the dry run needs two people:

| Role | Who | Phone |
|---|---|---|
| Mom (the kept-light parent) | a helper: a friend or relative who reads Chinese | their own LINE |
| Organiser (the adult child) | the founder | the founder's LINE, plus the test app (preview) on the founder's iPhone |
| A second family member in the group | optional, anyone | their own LINE |

Staging's LINE account is **Vela Light test** (`@661oqjkt`), not the real "Vela Light". Everyone adds the test account as a friend first: search `@661oqjkt` in LINE, or open `https://line.me/R/ti/p/@661oqjkt`.

Staging admits everyone and has no family approval, so the approval click is proven later, on production, with the founder's own family (step 6 of the plan). Everything else in the dry run is exactly what a Taiwan family will see.

## Day 0 (evening, about 20 minutes)

1. **The founder's setup.** In the private chat with `@661oqjkt`, send `/start`. Answer in Chinese: what you call her (媽媽), how Vela greets her, **繁體中文**, **台灣**, her wake time (pick one about 30 minutes from when the helper will be awake tomorrow). Nearby contact: **略過**. Keep the invite link from the last message.
2. **The family group.** Create a LINE group with the optional second member, **without the helper**, and invite `@661oqjkt`. Vela posts "大家好，我是 Vela。…" with **我看過了**: each adult taps it once. If Vela says "只有家庭的發起人才能把 Vela 連結到群組。" and leaves, step 1 was not finished.
3. **The helper says yes.** Send the helper the invite link. They tap it; LINE opens the chat with "/start …" already typed; they press **Send**, then **兩個都好** (or **好，健康的話不分享**). The founder gets "… said yes".
   - If the link opens LINE but nothing is typed, or the helper sees an error: screenshot, tell Claude, stop here.
4. **The app.** On the founder's iPhone, open the test app (preview), go to connecting your family, choose **用 LINE** and follow it. Today should show her window, still dark.

Tell Claude when step 3 is done. Claude reads staging (counts and states only, no words) and confirms the morning is scheduled.

## Day 1 (morning to evening)

| Time | What should happen | Who checks |
|---|---|---|
| Her wake time + 30 min | The morning question reaches the helper's LINE, in Chinese, with **no buttons** | Helper |
| Helper answers in their own words, text or voice | "☀️ … 回覆了" reaches the group; the app's window lights up | Founder |
| Someone in the group replies to her answer | Nothing yet: it is read back to her tomorrow morning | — |
| 19:00 | The group gets the turn prompt (whose turn it is to ask tomorrow) | Founder |
| Before 22:00 | The turn holder asks a question in the group, or `/ask` and a question | Founder |

Try one **voice note** answer from the helper, and one **photo** ask from the group.

## Day 2: the safety path

Agree with the helper in advance. This is the part a family must never see go wrong.

1. **The helper does not answer the morning.** About **2 hours** later the helper gets a short check-in with two buttons: **🙂 我還好** / **不太好，告訴家人**.
2. **The helper taps 不太好，告訴家人.** At once, the founder (as organiser) gets the "Not okay" message on LINE, and the founder's admin chat gets its alert. The helper reads that the family is being told.
3. **Optional, Day 3: full silence.** The helper ignores the morning and the check-in. About **4 hours** after the morning, the founder gets one calm quiet notice. Tap the button that says she is fine.

## If anything goes wrong

Tell Claude at once, with the time it happened. Never paste the helper's words; say "her answer" or "the voice note".

- A message that did not arrive, arrived twice, or came at the wrong time.
- Any English, broken characters, `{name}`-style placeholders, or 她/他 where her name should be.
- A button that did nothing.
- An alert that went to the wrong person, or did not go.

## What the dry run should prove

- [ ] Invite link → `/start` → yes, on LINE, from a phone that never used Vela.
- [ ] Group links and every adult can tap 我看過了.
- [ ] Morning, answer (text and voice), group sees it, replies read back the next morning.
- [ ] Turn prompt and a family-asked question.
- [ ] Check-in after silence; 不太好 reaches the organiser at once.
- [ ] Quiet notice after full silence, once.
- [ ] The app links over LINE and the window lights on her answer.
- [ ] Every message read by Claude on a LINE screen for natural Taiwan Chinese.
