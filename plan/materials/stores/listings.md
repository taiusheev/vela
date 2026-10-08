# Store listings: English and Traditional Chinese

Prepared 8 October 2026 (technical plan step 5.7, launch gate 13). This is the text for the App Store and Google Play pages of Vela Light (`family.vela.light`). The English listing serves the English trial's TestFlight and the public launch. The Traditional Chinese listing serves the Taiwan launch and **needs the native reviewer's sign-off** (gate 8) before it is used. Character limits are noted, and every field below fits its limit.

Rules the text keeps: no medical or emergency claims, no "monitoring" or "tracking" of the parent, no price (the founder decides it after the three-price test), and no feature that is off in public v1 (book, recipes, memory, parent app, tablet, voice line).

## English

**App name** (30): Vela Light

**Subtitle** (App Store, 30): One small question a day

**Short description** (Play, 80): One small question a day, answered in a tap, and a light that says she answered.

**Promotional text** (App Store, 170): Every morning, someone in the family asks one small question. She answers in a tap or a voice note, the family replies, and her light shows the day has begun.

**Description** (4,000):

> Vela Light keeps a family close through one small exchange a day.
>
> Each morning, one of you asks a question: what's for lunch, which photo she likes, how the garden is doing. Mom answers in LINE or Telegram, with a tap, a few words, a photo or a voice note. She needs no new app.
>
> Her answer comes to the family. Reply with words, a photo or your voice, and she hears your replies with the next morning's question.
>
> **The light.** When she answers, her light comes on for the whole family to see. If a morning stays quiet longer than usual, the organiser is told gently, so someone can call. When she is away, the light rests.
>
> **The weekly read.** Once a week, a short note on how her week went, in her own words, with one idea for what to ask next.
>
> **Made for the person answering.** Large buttons, her language, no feeds and no ads. One question a day, never more.
>
> **Private by design.** Her words stay within the family. Vela never sells data and shows no ads. She agrees to take part herself, and she can say stop at any time.
>
> Vela Light is not a medical device or an emergency service. In an emergency, call your local emergency number.

**Keywords** (App Store, 100): family,parents,grandparents,daily question,elderly,check in,LINE,Telegram,voice note,photos

**Category:** Lifestyle (secondary: Social Networking). Not Medical: Vela makes no health claims.

**Support URL:** `https://<production host>/` (contact on the site). **Marketing URL:** the same. **Privacy policy URL:** `https://<production host>/privacy`.

**Screenshot captions** (one per screen, short):
1. One small question a day
2. Her answer, in her own words
3. Reply with words, a photo or your voice
4. Her light says the day has begun
5. A gentle note when a morning stays quiet
6. Her week, in a few lines

## 繁體中文（台灣）: needs native review

**App 名稱** (30): Vela Light

**副標題** (30): 每天一個小問題

**簡短說明** (Play, 80): 每天一個家人問的小問題，媽媽輕點就能回答，一盞燈讓全家知道她回答了。

**宣傳文字** (170): 每天早上，家裡有人問一個小問題。媽媽輕點一下或錄一段語音回答，家人回覆她，她的燈亮起，大家就知道新的一天開始了。

**描述**:

> Vela Light 用每天一次小小的交流，讓家人更靠近。
>
> 每天早上，你們其中一人問一個問題：中午吃什麼、喜歡哪張照片、菜園長得怎麼樣。媽媽在 LINE 或 Telegram 裡回答，輕點一下、幾個字、一張照片或一段語音都可以，不需要另外下載 App。
>
> 她的回答會傳給家人。用文字、照片或聲音回覆她，隔天早上她會連同新的問題一起聽到你們的回覆。
>
> **燈。** 她一回答，她的燈就會亮起，全家都看得到。如果某天早上比平常安靜得久，發起人會收到溫和的提醒，好讓有人打個電話。她出門時，燈會休息。
>
> **每週小記。** 每週一次，用她自己的話寫下她這一週，並附上一個下次可以問的點子。
>
> **為回答的人設計。** 大按鈕、她的語言、沒有動態消息也沒有廣告。每天一個問題，絕不多。
>
> **重視隱私。** 她的話只留在家人之間。Vela 不販售資料，也沒有廣告。是否參加由她自己決定，她隨時都可以說「停止」。
>
> Vela Light 不是醫療器材，也不是緊急救援服務。緊急情況請撥打 119 或 110。

**關鍵字** (100): 家人,父母,長輩,爺爺奶奶,每日問候,關心,LINE,語音,照片,報平安

**類別：** 生活風格（次要：社交）

**截圖說明：**
1. 每天一個小問題
2. 她的回答，她自己的話
3. 用文字、照片或聲音回覆
4. 她的燈，說新的一天開始了
5. 早上太安靜時，溫和地提醒
6. 她的一週，幾行字就好

## Before submitting

1. Replace `<production host>` once the domain is on the Vela account (step 1.2) and `/privacy` answers 200 on production.
2. The trial build is English-only and Telegram-only. Its TestFlight text stays in `../trial/testflight-review.en.md`, and this listing's LINE wording applies from the Taiwan launch.
3. Screenshots come from the signed build (step 5.2), with the synthetic family only: never a real family's words or photos.
4. The Chinese text goes to the native reviewer with the app catalogue review (`../zh-tw-review/`).
