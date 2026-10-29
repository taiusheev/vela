# The first Taiwan families on LINE: the founder's kit

29 October 2026. For the founder. Step 7 of [`../../taiwan-line-test.md`](../../taiwan-line-test.md). It starts only after the [dry run](taiwan-dry-run.md) passed and production has LINE, family approval and Chinese switched on.

Founder decisions, 29 October:
- **Start small:** two or three families first; the rest once their first days look clean.
- **Android organisers use LINE only.** The app is iPhone-only for now; on Android, everything an organiser needs arrives in LINE.
- **Family 0 is the founder's own family**, on production, one morning before anyone else (confirmed by the founder). Real Taiwan families are already waiting to test.

Production's LINE account is **Vela Light** (`@675nhrpg`, `https://line.me/R/ti/p/@675nhrpg`). The Chinese privacy notice is `https://vela.vela-light.workers.dev/privacy/zh-TW`.

## Now, while families wait (founder, 5 minutes per family)

Real families already want to test. Send each organiser the short message below now, so the first two or three can be picked by 2 November. Note the answers in your private "Vela pilot" notes under a family code (TW-01, TW-02 …), never in the repo.

> 嗨！Vela 預計 11 月 4 日開始試用，想先問你幾件事，好安排順序：
> 1. 你用 iPhone 還是 Android？
> 2. 爸媽有在用 LINE 嗎？會看、會回 LINE 訊息嗎？
> 3. 爸媽通常幾點起床？
> 4. 家裡還有誰想一起加入家人群組？（大概幾個人）
> 5. 11 月 3 日或 4 日晚上，你方便花 15 分鐘設定、再打一通電話跟爸媽說明嗎？

Pick first the families whose parent already reads and answers LINE, and whose organiser can do the setup call on 3 or 4 November. Keep one iPhone organiser among them, so the app is tried by a real family too.

## Before inviting anyone (founder)

1. **Any day now:** double-click `Vela/line-production-setup.command`. It signs you in to Cloudflare, creates LINE's queue and asks for the "Vela Light" channel secret and access token in hidden prompts (copy them from LINE Developers). It changes nothing families see.
2. In LINE Official Account Manager, the plan is **中用量**, bought on or after 3 November. The free plan's 200 messages a month cannot carry one family.
3. In LINE Developers, the production channel has **Allow bot to join group chats** on.
4. Production is released with LINE, family approval and Chinese on (PR #217; Claude prepares it, you approve the tag).
5. Family 0 has had one good morning on production.

## Each family (about 30 minutes, the day before her first morning)

1. **Send the organiser message below** (in your own chat with them, LINE or other).
2. **The organiser sets up** in the private chat with Vela Light: `/start`, then about two minutes of questions. They get her invite link at the end, and keep it.
3. **You approve the family** on the admin page, **Trial roster** (`/admin/roster`): the newest family waiting, one click. **Always before the organiser sends her the link:** a yes she taps before your approval is ignored, and she sees nothing. If the list shows a family you do not know, leave it unapproved.
4. **The organiser makes the family group** in LINE, without her, and invites Vela Light. Each adult taps **我看過了**.
5. **The organiser calls her**, using the [Chinese consent script](../pilot/consent-script.zh-TW.md), then sends her the invite link. She taps it, presses **傳送**, then chooses **兩個都好** or **好，健康的話不分享**. Her first morning comes the next day.
   - If she sees "您的燈還沒亮起", the family is not approved yet, or the organiser has not added Vela Light as a friend.
6. **iPhone organisers** get the TestFlight link from you and connect the app with **用 LINE**. Optional; LINE is enough.

## Message 1: to the organiser (send as is, or in your own words)

> 嗨！謝謝你願意一起試用 Vela。
>
> Vela 是一個很小的服務：每天早上，家裡會有人在 LINE 上問爸媽一件事，爸媽回覆了，你就知道今天一切都好。如果哪天早上一直沒有回覆，Vela 會先輕輕關心一下，還是沒有消息的話，才會通知你，讓你可以打電話給他們。
>
> 試用期間完全免費，大約兩到四週。
>
> 開始的步驟，大概 10 分鐘：
> 1. 加「Vela Light」為 LINE 好友：https://line.me/R/ti/p/@675nhrpg
> 2. 在跟 Vela Light 的聊天裡傳「/start」，回答幾個簡單的問題。最後會收到一個邀請連結，先留著，不要馬上傳出去。
> 3. 跟我說一聲，我這邊確認後會告訴你。
> 4. 開一個家人的 LINE 群組（先不要加爸媽），把 Vela Light 邀請進來。
> 5. 打電話跟爸媽說明，再把邀請連結傳給他們。我會給你一份通話時可以照著說的稿子。
>
> 資料怎麼使用，請看：https://vela.vela-light.workers.dev/privacy/zh-TW
>
> 有任何問題，隨時直接找我。

## Message 2: what to expect in week 1 (send after she said yes)

> 爸媽已經答應了，明天早上就是第一則訊息 🌅
>
> 這一週會發生的事：
> - **每天早上**：爸媽會收到一個問題，用自己的話、打字或語音回覆都可以。回覆會出現在家人群組裡。
> - **每天晚上 7 點**：Vela 會在群組裡說明天輪到誰問問題。輪到你的話，晚上 10 點前在群組裡回覆一個問題就好；沒人問的話，Vela 會代替家人問一個。
> - **你在群組裡回覆爸媽的話**，隔天早上會先傳給他們看。
> - **如果早上一直沒有回覆**：大約 2 小時後，Vela 會先關心爸媽一下；他們可以按「我還好」或「不太好，告訴家人」。按了「不太好」，你會馬上收到通知。完全沒有回覆的話，大約 4 小時後你會收到一則簡短的通知。
> - **週日**：你會收到這一週的每週小記。
>
> 請不要跟爸媽說「你今天沒回」。偶爾忘記回覆很正常，關心就好。
>
> 這是試用版，難免有小問題。覺得哪裡怪、哪裡不方便，直接跟我說，這對我們幫助很大 🙏

## Each day (2 minutes)

Open `/admin/trial?days=7` and act only on what it shows.

| Day | Good looks like | If not |
|---|---|---|
| 1 | Her morning arrived on time, she answered, the group saw it | Not arrived, or twice: tell Claude at once. Not answered by evening: the organiser asks if the message arrived, never why she did not answer |
| 2 | Yesterday's replies came first in her morning | Nobody replied: remind the group that a reply is what she hears next |
| 3–7 | Someone in the family asks; any check-in or notice was right | A notice on a day she answered pauses new families until fixed |

## Tell Claude at once

- A morning that did not arrive, arrived twice, or at the wrong time.
- A check-in, "不太好" alert or quiet notice that went wrong, or went when she had answered.
- Any English, broken text or odd wording a family mentions.
- Any admin alert about failed sends, the LINE quota, or the AI failing.

Say what happened and when. Never paste a family's words.

## Never

- Never let anyone say "you didn't answer" to her.
- Never paste family words into notes, chats or issues: family code, dates and counts only.
- Never promise payments, memories, a family book or an Android app.
