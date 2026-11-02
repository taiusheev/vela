---
name: vela-zh-tw
description: Traditional Chinese as Taiwan writes it, for Vela's parents and families. Use when writing, translating, reviewing or fixing any zh-TW words - packages/copy zh-TW.ts, the app's zh-TW.po, the question bank's Chinese, the /zh-TW website, LINE messages, the Chinese notice or consent script - or when the founder says 中文, 繁中, "translate", "the Taiwan launch", "LINE wording" or "does this sound Taiwanese". Covers the glossary, 您 and 你, 爸媽 and 長輩, Taiwan-versus-mainland words, the Lingui steps and native-reviewer sign-off.
metadata:
  owner: founder
  last-checked: "2026-10-20"
---

# Vela in Traditional Chinese (Taiwan)

Taiwan is Vela's first real market, on LINE. Its parents read Traditional Chinese written the Taiwanese way, and a mainland word or a cold register tells them at once that a machine wrote it. Every Chinese line is a **draft until a native Taiwanese reviewer signs it off** (build plan 2.4). Today none of the app's 1,026 lines carries that sign-off.

The tone rules (no surveillance words, facts then one action, names not roles) are in the `writing-vela-voice` skill. This skill covers what is special to Chinese.

## Four rules first

1. **Never machine-translate a line a reviewer signed off**, and never re-translate the whole catalog in one pass. A machine or model may draft a *new* line; it stays a draft until the reviewer reads it.
2. **Only the reviewer adds the sign-off.** In the app it is the flag `#, native-reviewed` above the msgid in `apps/app/src/i18n/locales/zh-TW.po`. An agent never adds or keeps that flag on a line it changed.
3. **您 when Vela speaks.** To her, to organisers and to nearby contacts.
4. **Never 他 or 她 in the bot or app catalogs, and never a surveillance word** (監控, 監看, 監視, 追蹤, 盯, 看著您). The tests fail on both (`FORBIDDEN_ZH_TW` in `packages/copy/src/rules.ts`).

## Glossary

The first five are the terms the founder asked to pin. "Inconsistent" marks drafts that disagree today; see the end of this skill.

| English | zh-TW | Notes |
|---|---|---|
| check-in | (not said to families) | Vela is "not a check-in": the website says 「不是報平安，是一段對話。」 For the daily message say 早安訊息, or 每天早上一個小問題. |
| organiser | 發起人 | The adult child who set Vela up. Inconsistent: `pilot.activation_wait` says 安排人. |
| Memories (the tab) | 回憶 | Past exchanges and the family book. |
| family book | 家庭故事書 | Stories and recipes she chose to keep. Inconsistent: one app line says 家族故事書. |
| Sunday windows | 窗；這週的窗 | The row of seven windows at the top of the Sunday tab. A window lights on a day she and the family shared a message. Never a streak or a score. The tab itself is 週日. |
| send-as-me | 用我的名字送出 | The organiser's opt-in for Vela to send its drafted ask in their name (ADR-49). |
| written by Vela | Vela 代筆 | The label everyone sees on a send-as-me ask. Inconsistent: one app line says 由 Vela 撰寫. |
| keep a light on for you | 為您留一盞燈 | The product's central image. Her light: 燈；燈亮著；燈又亮了. |
| morning message | 早安訊息 | Inconsistent: 早晨訊息 and 早上的訊息 also appear. |
| ask (noun, verb) | 提問；問{name}一件事 | |
| her answer | 回覆 (her reply to a morning)、回答 (an answer to a question) | |
| the family's reply | 回覆 | |
| quiet notice | 安靜通知 | Sentence form: {name}那邊今天比較安靜。 |
| people nearby | 附近的聯絡人 | "Look in" is 過去看看. |
| away | 不在家；外出模式 (the setting) | |
| weekly read | 每週小記 | The notice and consent script use this name. Inconsistent: three app lines say 每週回顧. |
| story day | 故事日 | |
| family group (the family's chat without her) | 家人群組 | Not 家族群組, which usually includes the elders. |
| stop / start (what she says) | 停 / 開始 | Must match `parseParentCommand` in `packages/core/src/commands.ts`, which also accepts 停止 and 暫停. |
| Vela, Vela Light, LINE, Telegram, App | Latin letters | The founder's name stays Latin too: Timur Aiusheev. |

A new product word needs the founder's yes. Add it to this table and to `writing-vela-voice` in the same pull request.

## Register: 您 and 你

- **Vela's own voice uses 您**, to everyone, including the adult child in the app. The bot catalog does this throughout.
- **A son or daughter's own words use 你.** The question bank's `child` wording ("我突然很好奇你小時候住的房子") is how a child writes to their own parent. Whether a child should write 您 to a parent is an open question for the reviewer (`packages/copy/src/ask-bank.ts`, top comment).
- The app is mixed today: 141 lines use 您, 31 use 你. New lines use 您 until the reviewer decides. Never mix both in one line.

## Naming the parent

| Speaking to | Say | Never |
|---|---|---|
| Her | Her name, or how the family greets her ({address}: 陳太太、媽媽、阿嬤), with 您 | 使用者、長輩、長者、老人家 (consent script, "說話的原則"), 他/她 |
| The family, about her | Her name ({name}); in setup questions 這位家人 | 他/她 in the catalogs, 使用者, 個案, 被照顧者 |
| The family, about "your parent" in general | 爸媽 in a sentence ("請自行打電話給爸媽") | 老人、銀髮族 |
| Families, about elders in general (website, store) | 長輩 ("給家中有長輩獨居的家庭") | 老人、獨居老人 |

The website speaks to adult children about Mom, so `apps/worker/src/site.ts` may say 她. The catalogs may not.

## Taiwan, not mainland

The tests reject Simplified characters (`SIMPLIFIED_ONLY`) and these mainland words (`MAINLAND_TERMS`):

| Write (Taiwan) | Not (mainland) |
|---|---|
| 訊息 | 信息 |
| 使用者 | 用戶 |
| 設定 | 設置 |
| 影片 | 視頻 |
| 群組 | 群聊 |
| 預設 | 默認 |
| 點選、按 | 點擊 |
| 簡訊 | 短信 |
| 早安 | 早上好 |

No test checks these, so read for them:

| Write (Taiwan) | Not (mainland) |
|---|---|
| 軟體 | 軟件 |
| 網路 | 網絡 |
| 資料 | 數據 (for "data") |
| 帳號 | 賬號 |
| 登入 | 登錄 |
| 連結 | 鏈接 |
| 檔案 | 文件 (for "file") |
| 螢幕 | 屏幕 |
| 列印 | 打印 |
| 品質 | 質量 |
| 支援 | 支持 (for "support") |
| 推播 | 推送 |
| 回饋 | 反饋 |
| 視訊 | 視頻 |
| 語音訊息 | 語音消息 (消息 is fine for "news": 目前沒有任何令人擔心的消息) |
| 每週、週日 | 每周、周日 |

LINE's own Taiwanese words, when copy points at LINE: 聊天室, 好友, 加入好友, 官方帳號, 群組, 已讀, 貼圖. Check them against the LINE app before shipping a line that names a LINE button.

## Typography

- Full-width punctuation: ，。、：；？「」（）. Quotes are 「」, with 『』 inside them, never “”.
- A space between a Chinese character and Latin text, digits, or a placeholder that renders as Latin or digits ({time}, {date}, {count}, {code}…): 「明天 {time} 送到」, 「Vela 會」.
- Name placeholders touch the characters around them, as a written name does: 「{name}那邊」, 「{asker}傳了」.
- A link after a full-width colon gets a space, so LINE's link detection does not swallow the colon: 「請看： {notice}」.
- Lists use 、, and 和 before the last item. No exclamation marks except in a greeting.
- The full spacing rules are tested in `apps/app/src/i18n/catalog.test.ts` and explained at the top of `packages/copy/src/zh-TW.ts`.

## The two places Chinese lives, and how to change each

**Bot, LINE and Telegram messages:** `packages/copy/src/zh-TW.ts`, one entry per key of `en.ts`. Change the English first, then the Chinese, then run `pnpm --filter @vela/copy test`. A change to `consent.*` changes what families agreed to: follow the `guarding-family-data` skill and change `plan/materials/pilot/consent-script.zh-TW.md` with it.

**App screens (Lingui):**

1. Write the English in the code with Lingui's `t` or `<Trans>`. The English is the msgid.
2. `pnpm --filter @vela/app i18n:extract` runs `lingui extract --clean` and rewrites `en.po`, `zh-TW.po` and `ja.po`. In `en.po` the msgstr equals the msgid, so renaming English means changing both.
3. Fill the new zh-TW msgstr. It is a draft: no `native-reviewed` flag.
4. `pnpm --filter @vela/app test` runs `lingui check sync --clean` and the catalog tests: placeholders, Traditional characters, Taiwanese words, spacing, banned words. There is no separate compile step; the Metro transformer compiles the catalogs.
5. Before the Taiwan launch, `pnpm --filter @vela/app test:i18n:future` must pass: every zh-TW line translated.
6. Metro caches `.po` files. After editing one, restart the preview with `expo start --clear`.

Leave `ja.po` empty. Japanese is extracted for a translator but not loaded (`plan/japanese-scope.md`).

## Native review

- From the repo root, `pnpm --filter @vela/app i18n:review ../zh-TW-review.md` writes every unsigned line beside its English as a table, outside the repo (`.csv` gives a spreadsheet). Send that to the reviewer.
- The reviewer's changes go in by pull request. Add `#, native-reviewed` only to the lines they approved.
- If the English of a reviewed line changes, Lingui makes it a new entry without the flag. That is correct: it needs review again.
- The bot catalog has no per-line flag yet. Treat all of `zh-TW.ts` and the question bank's Chinese as drafts until the reviewer signs off, and say so in the pull request.
- Never present a Chinese draft to families or the founder as final.

## Known inconsistencies (for the founder and the reviewer)

Do not fix these on your own: each needs the founder's choice. `packages/copy` and the `.po` files may also be claimed by another agent in `../AGENT-CLAIMS.md`.

1. organiser: 發起人 everywhere, 安排人 in `pilot.activation_wait`.
2. weekly read: 每週小記 (notice, consent, five app lines), 每週回顧 (three app lines).
3. written by Vela: Vela 代筆 (five lines), 由 Vela 撰寫 (one line).
4. family book: 家庭故事書 (eight lines), 家族故事書 (one line).
5. morning message: 早安訊息 (30), 早晨訊息 (7), 早上的訊息 (6).
6. your parent: 爸媽 (3), 父母 (5, including 「父母的設定」).
7. 您 and 你 to the adult child: 31 app lines and `weekly_read.feedback_heading` use 你.

Recount before reporting: `grep -c 每週回顧 apps/app/src/i18n/locales/zh-TW.po`.
