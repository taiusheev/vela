/**
 * Traditional Chinese as written in Taiwan. These strings await native review before launch
 * (spec §20); until a native speaker signs them off, treat every line here as a draft.
 *
 * Register: warm and plain, 您 toward the kept-light member and organisers, Taiwanese vocabulary
 * (訊息, 設定, 群組, 略過, 早安) rather than mainland terms. The kept-light member is always
 * named or called 這位家人, never 他 or 她 (其他, "other", is not a pronoun), and nothing uses 監控,
 * 監看, 監視, 追蹤, 盯著, or 看著您 (the surveillance words the consent script forbids), for the
 * same reasons as the English rules. `onboarding.done` asks for a separate new group without the
 * member, not the 家族群組 the family already has, which usually includes the elders (see the note
 * in en.ts). The stop and start words the member is told to say (「停」,
 * 「開始」) must stay in step with the zh-TW keywords of `parseParentCommand` in @vela/core.
 * `consent.request`, `consent.yes`, and `consent.no` are what the founder reads aloud on the consent
 * call (plan/materials/pilot/consent-script.zh-TW.md, sections 2 and 6): change the script with
 * them.
 *
 * Latin text, digits, and placeholders that always render as Latin or digits ({time}, {sent},
 * {usual}, {n}, {channel}, {link}) are separated from Chinese characters by a space. {link} also
 * keeps a space after the full-width colon, so a messenger's link detection cannot take a
 * neighbouring character as part of the URL.
 */
import type { en } from "./en.ts";

export const zhTW: Record<keyof typeof en, string> = {
  "arrival.greeting": "{address}，早安。",
  "arrival.late": "不好意思，這則訊息晚到了。",
  "arrival.repeat": "怕您沒看到，再傳一次：",
  "arrival.readback_heading": "昨天家人的回覆：",
  "arrival.asks": "{asker}想問您：",
  "arrival.asks_on_behalf": "{asker}替{child}問您：",
  "arrival.sent_photo": "{asker}傳了一張照片給您。",
  "arrival.sent_voice": "{asker}傳了一則語音訊息給您。",
  "arrival.photo_choice": "選哪一張呢？請按 1 或 2。",
  "arrival.vote": "請按一個選項。",
  "arrival.hello": "今天家人沒有新的消息。您早上過得好嗎？",
  "arrival.hello_signature": "Vela，代表您的家人",
  "arrival.hint": "您可以傳語音訊息回覆，或按下面的按鈕。",
  "button.fine": "我很好",
  "button.heart": "❤️",
  "button.choice": "{n}",
  "ack.thanks": "謝謝您，{address}。家人會收到的。",
  "readback.replied": "{name}：{text}",
  "readback.voice": "{name}傳了一則語音訊息。",
  "readback.photo": "{name}傳了一張照片。",
  "readback.reactions": "{names}送上{emoji}",
  "consent.invalid_link": "這個連結已經失效了。請跟傳連結給您的人再要一個新的。",
  "consent.already_linked": "這個 Telegram 帳號已經連結到 Vela 上的另一個家庭。",
  "consent.request":
    "{organiser}想為您留一盞燈。每天早上，家裡會有人問您一件事。您回覆了，家人就知道您一切都好。如果哪天早上的訊息一直沒有回覆，{organiser}會收到一則簡短的通知，就可以打電話給您。您隨時都可以說「停」。",
  "consent.yes": "好，沒問題",
  "consent.no": "不用了，謝謝",
  "consent.accepted": "謝謝您。第一則早安訊息會在明天 {time} 送到。",
  "consent.declined": "沒關係，不會傳任何訊息給您。",
  "organiser.consent_given": "{name}同意了。第一則早安訊息會在明天 {time} 送到。",
  "organiser.consent_declined": "{name}說暫時先不要。不會傳送任何訊息。",
  "parent.stopped": "已經全部暫停了。想恢復的時候，隨時說「開始」就可以。",
  "parent.started": "歡迎回來。下一則早安訊息會在 {time} 送到。",
  "organiser.stopped": "{name}想先暫停。系統一切正常。",
  "parent.family_sees_heading": "這個星期，家人從您這裡看到的是：",
  "parent.family_sees_empty": "這個星期還沒有內容。",
  "group.linked": "大家好，我是 Vela。每天晚上，我會告訴大家明天早上輪到誰問{name}一件事。",
  "group.not_linked": "只有家庭的發起人才能把 Vela 連結到群組。",
  "group.turn_prompt":
    "明天輪到{holder}問{name}。請直接回覆這則訊息，傳一個問題、一張照片或一段語音。",
  "group.turn_prompt_open":
    "明天大家都可以問{name}一件事。請直接回覆這則訊息，傳一個問題、一張照片或一段語音。",
  "group.ask_confirmed": "已放進{name}的早安訊息。",
  "group.ask_queued": "明天已經有{asker}的提問了。這則先保留，改天早上再送出。",
  "group.answer_light": "☀️ {name}回覆了{asker} · {time}",
  "group.answer_hello": "☀️ {name}一切都好 · {time}",
  "group.answer_chip": "{name}選了：{choice}",
  "group.answer_pick": "{name}選了第 {n} 張照片。",
  "group.answer_vote": "{name}投票：{choice}",
  "group.answer_text": "{name}：{text}",
  "group.answer_transcript": "{name}（語音）：{text}",
  "quiet.notice":
    "{name}那邊今天比較安靜。早安訊息在 {sent} 送出；{name}通常會在 {usual} 前回覆。目前沒有任何令人擔心的消息。",
  "quiet.notice_no_usual":
    "{name}那邊今天比較安靜。早安訊息在 {sent} 送出。目前沒有任何令人擔心的消息。",
  "quiet.nearby": "附近的聯絡人：{contacts}",
  "quiet.fine_button": "{name}沒事，我知道原因",
  "quiet.wait_button": "再等 2 小時",
  "quiet.waiting": "我會在 {time} 再看看。",
  "quiet.resolved_answered": "{name}在 {time} 回覆了。燈又亮了。",
  "quiet.resolved_fine": "{organiser}說{name}沒事。",
  "delivery.failed": "今天沒辦法透過 {channel} 把訊息送給{name}。除此之外，目前沒有別的消息。",
  "flag.notice": "{name}說了一句話，您可能會想知道：「{quote}」",
  "away.confirmed": "好的，那就到{date}為止。祝您過得愉快。",
  "away.confirmed_open": "好的，知道了。祝您過得愉快。",
  "help.private": "您好。想為家人設定 Vela 的話，請傳送 /start。",
  "onboarding.welcome": "您好，我是 Vela。我們一起為一位家人留一盞燈吧。大約兩分鐘就能完成。",
  "onboarding.ask_name": "您平常怎麼稱呼這位家人？例如：媽媽、阿嬤、爸爸。",
  "onboarding.ask_address": "我每天早上問候時，要怎麼稱呼這位家人？例如：陳太太、媽媽。",
  "onboarding.ask_language": "要用哪一種語言傳訊息給這位家人？",
  "onboarding.ask_country": "這位家人住在哪個國家或地區？",
  "onboarding.country_tw": "台灣",
  "onboarding.country_us": "美國",
  "onboarding.country_gb": "英國",
  "onboarding.country_ca": "加拿大",
  "onboarding.country_au": "澳洲",
  "onboarding.country_sg": "新加坡",
  "onboarding.country_jp": "日本",
  "onboarding.country_de": "德國",
  "onboarding.country_in": "印度",
  "onboarding.country_other": "其他",
  "onboarding.ask_zone": "在哪個時區？",
  "onboarding.ask_zone_other":
    "這位家人住在哪個時區？請輸入時區名稱，例如 Asia/Seoul 或 Europe/Paris。",
  "onboarding.invalid_zone": "請輸入像 Asia/Seoul 或 Europe/Paris 這樣的時區名稱。",
  "onboarding.ask_wake": "這位家人通常幾點起床？請按一個選項，或輸入像 07:30 這樣的時間。",
  "onboarding.ask_nearby":
    "有沒有住在附近、需要的時候可以過去看看的人？請傳送名字和電話號碼，或按「略過」。",
  "onboarding.skip": "略過",
  "onboarding.invalid_time": "請輸入像 07:30 這樣的時間。",
  "onboarding.done":
    "設定完成。請把這個連結傳給{name}： {link} 然後另外建立一個家人群組（不要加{name}），把我加進去，讓家人可以輪流提問。",
  "admin.weekly_read_draft": "{family}的每週回顧草稿：",
  "admin.flag": "{family}有一則標記：{name}說「{quote}」",
};
