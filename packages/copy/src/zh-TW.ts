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
 * them. A tap records the message's text version and a hash of the text as rendered, so a change of
 * meaning here is a new text version in services, as in English (see the note in en.ts). The
 * founder's name stays in its Latin spelling, as in every language. `consent.health_words` speaks of
 * 身體狀況 (the state of one's body), the everyday way to say "your health" in a question, and keeps
 * the English promise that a no changes nothing else (就算您說不要，Vela 也會照常運作).
 *
 * `onboarding.ask_nearby` and `onboarding.nearby_no_number` ask for a name and the contact's
 * relation to 這位家人, never a number; the example 王小姐，鄰居 uses the full-width comma that
 * onboarding splits the name and the relation at.
 *
 * The weekly read is 每週小記, the name the zh-TW privacy notice and consent script give it. Chinese
 * counts have one form, so each `weekly_read.*_one` key repeats its plural key (see the note in
 * en.ts). `parent.family_sees_weekly_read` says 每週小記裡…的幾行, the lines from the read, because
 * the lines are all she gets (see the note in en.ts).
 *
 * Latin text, digits, and placeholders that always render as Latin or digits ({time}, {sent},
 * {usual}, {n}, {answered}, {days}, {mornings}, {used}, {limit}, {channel}, {link}, {notice}) are
 * separated from Chinese characters by a space. The URLs {link} and {notice} also keep a space after the full-width
 * colon, so a messenger's link detection cannot take a neighbouring character as part of the URL.
 * Placeholders for names ({name}, {names}, {asker}, {holder}, {organiser}, {child}, {address},
 * {family}) touch the Chinese characters around them, as a written name would, and so does
 * {suggestion}, an ask worded as the family would send it.
 */
import type { en } from "./en.ts";

export const zhTW: Record<keyof typeof en, string> = {
  "account_link.confirm":
    "要將家人連結至這個 Vela 帳號嗎？\n帳號：{account}\n連結編號：{reference}\n\n只有在您剛從自己已登入的 Vela 開啟此聊天，且帳號與編號相符時，才按下「連結我的家人」。開啟聊天本身不會完成連結。\n\n若使用另一部裝置，您的私人備用代碼是 {code}，請勿分享。",
  "account_link.approve": "連結我的家人",
  "account_link.refuse": "這不是我",
  "account_link.approved": "已確認。請回到 iPhone 上的 Vela，確認家人並完成連結。不用複製代碼。",
  "account_link.cancelled": "連結已取消。您的家人和這個聊天室都沒有變更。",
  "account_link.code":
    "請在 Vela 輸入這個代碼，把這個聊天室連結到 app：{code}\n請保密；代碼即將到期。",
  "account_link.unavailable":
    "無法開啟這個帳號連結。請先在這個聊天室完成家人的設定，再從 Vela 建立新的連結。",
  "pilot.activation_wait":
    "您的燈還沒亮起。發起人的設定還沒完成：家庭需要先通過核准，發起人也要能收到訊息。請發起人完成設定，再試一次。",
  "pilot.invitation_only":
    "Vela 的英語試用僅限受邀者。請聯絡創辦人申請使用。您的 Telegram ID：{telegram_id}。",
  "arrival.greeting": "{address}，早安。",
  "arrival.greeting_2": "早安，{address}！",
  "arrival.greeting_3": "嗨，{address}，早安。",
  "arrival.late": "不好意思，這則訊息晚到了。",
  "arrival.repeat": "不急，有空再回就好。這是今天早上的訊息。",
  "arrival.readback_heading": "家人的回覆：",
  "arrival.signed": "—— {asker}",
  "arrival.signed_on_behalf": "—— {asker}（替{child}問）",
  "arrival.sent_photo": "{asker}傳了一張照片給您。",
  "arrival.sent_voice": "{asker}傳了一則語音訊息給您。",
  "arrival.photo_gone": "{asker}想給您看一張照片，可惜照片已經看不到了。您今天過得好嗎？",
  "arrival.photo_choice": "選哪一張呢？請按 1 或 2。",
  "arrival.vote": "請按一個選項。",
  "arrival.hello": "您早上過得好嗎？",
  "arrival.hello_signature": "—— 家人的小幫手 Vela",
  "arrival.hello_question": "傳段語音跟我說說吧，我會轉告家人。",
  "arrival.hint": "用語音回覆最好；在忙的話，按 ❤️ 就好。",
  "arrival.hint_words": "傳段語音或打幾個字回覆就好。",
  "checkin.text": "{address}，想關心一下您，今天還好嗎？",
  "button.okay": "🙂 我還好",
  "button.not_okay": "不太好，告訴家人",
  "button.fine": "我很好",
  "button.heart": "❤️",
  "button.choice": "{n}",
  "ack.thanks": "謝謝您，{address}。家人會收到的。",
  "ack.thanks_2": "謝謝您，{address}。已經幫您轉給家人了。",
  "ack.thanks_3": "謝謝您，{address}。家人等一下就會收到。",
  "ack.thanks_4": "謝謝您，{address}。這就轉給家人。",
  "ack.story": "謝謝您，{address}。您說的故事已經收進家庭故事書了。",
  "ack.not_okay":
    "謝謝您告訴我，{address}。我已經馬上通知{names}了。如果情況緊急，請直接撥打 119。",
  "ack.not_okay_founder":
    "謝謝您告訴我，{address}。我現在沒辦法透過 Vela 聯絡到您的家人，所以已經請 Vela 團隊幫忙聯絡。如果情況緊急，請直接撥打 119。",
  "ack.not_okay_family": "謝謝您告訴我，{address}。請打電話給家人；如果情況緊急，請直接撥打 119。",
  "ack.tap_asker": "謝謝您，{address} ❤️ {asker}很想多聽您說一點。有空的時候，傳一段語音好嗎？",
  "ack.tap_question":
    "謝謝您，{address} ❤️ 有空的時候，傳段語音跟家人說說您的想法吧，大家都很想聽。",
  "ack.tap_hello": "謝謝您，{address} ❤️ 今天在忙些什麼呢？有空的話，傳段語音給家人聽聽吧。",
  "book.dont_keep": "這則不要保留",
  "book.dropped": "沒問題，這則故事已經從家庭故事書拿掉了。",
  "recipe.offer": "{address}，這是您說的{title}做法：\n\n{card}\n\n要收進家庭故事書嗎？",
  "recipe.ingredients": "材料：",
  "recipe.steps": "做法：",
  "recipe.remarks": "小叮嚀：",
  "recipe.keep": "保留",
  "recipe.not_this": "這個不要",
  "recipe.kept": "好的，{title}已經收進家庭故事書了。",
  "recipe.dropped": "沒問題，這份食譜不保留。",
  "readback.replied": "{name}：{text}",
  "readback.voice": "{name}傳了一則語音訊息。",
  "readback.photo": "{name}傳了一張照片。",
  "readback.reactions": "{names}送上{emoji}",
  "consent.invalid_link": "這個連結已經失效了。請跟傳連結給您的人再要一個新的。",
  "consent.already_linked": "這個帳號已經連結到 Vela 上的另一個家庭。",
  "consent.request":
    "{organiser}想為您留一盞燈。每天早上，家裡會有人問您一件事。您回覆了，家人就知道您一切都好。如果哪天早上的訊息一直沒有回覆，{organiser}會收到一則簡短的通知，就可以打電話給您。您隨時都可以說「停」。Vela 由 Timur Aiusheev 經營。您的資料會怎麼使用，請看： {notice}",
  "consent.health_words":
    "還有一個問題。如果您提到身體狀況，例如跌倒或哪裡痛，Vela 可以把您說的話轉告{organiser}，讓{organiser}打電話給您，並在週日的每週小記裡寫出這週不只一次提到的話嗎？就算您說不要，Vela 也會照常運作。",
  "consent.request_both":
    "{organiser}想為您留一盞燈。每天早上，家裡會有人問您一件事。您回覆了，家人就知道您一切都好。如果哪天早上的訊息一直沒有回覆，{organiser}會收到一則簡短的通知，就可以打電話給您。您隨時都可以說「停」。\n\n身體狀況的話是另一個選擇。如果您提到身體狀況，例如跌倒或哪裡痛，Vela 可以把您說的話轉告{organiser}，讓{organiser}打電話給您，並在週日的每週小記裡寫出這週不只一次提到的話。如果您選擇不分享，Vela 也會照常運作。\n\n請點「兩個都好」、「好，健康的話不分享」（健康的話只留給自己），或「不用了，謝謝」。Vela 由 Timur Aiusheev 經營。您的資料會怎麼使用，請看： {notice}",
  "consent.both": "兩個都好",
  "consent.light_only": "好，健康的話不分享",
  "memory.told":
    "{organiser}把您的一則回答留作回憶，這則回答 30 天後不會被刪除。家人可以保留想記住的回答。要停止並移除已保留的回答，請寫「關閉回憶」。",
  "memory.off_done":
    "好了。您的回答不會再被留作回憶，已保留的也已移除。平常的聊天不受影響。要讓家人再保留回答，請寫「開啟回憶」。",
  "memory.on_done": "好了。家人又可以把您的回答留作回憶了。要停止，請寫「關閉回憶」。",
  "memory.gone": "這裡不需要做什麼。家人會在 App 裡保留回憶。要停止，請寫「關閉回憶」。",
  "consent.yes": "好，沒問題",
  "consent.no": "不用了，謝謝",
  "consent.accepted": "謝謝您。{organiser}一定會很開心。第一則早安訊息會在明天 {time} 送到。",
  "consent.accepted_first":
    "謝謝您。{organiser}一定會很開心。{organiser}有第一則訊息要給您，馬上就到。之後每天早上 {time} 都會有一則訊息，從明天開始。",
  "consent.declined": "沒關係，不會傳任何訊息給您。",
  "organiser.consent_given": "{name}同意了。第一則早安訊息會在明天 {time} 送到。",
  "organiser.consent_given_first":
    "{name}同意了，您的第一則訊息正在傳給{name}。早安訊息從明天 {time} 開始。",
  "organiser.consent_declined": "{name}說暫時先不要。不會傳送任何訊息。",
  "invite.for_her":
    "{name}您好，我是{organiser}。我想為您留一盞燈：每天早上，家人會問您一件小事。打開這個連結看看，願意的話就說好： {link} 您隨時都可以說「停」。",
  "organiser.invite_again": "這是新的邀請連結。請把這個連結傳給{name}： {link} 連結 7 天內有效。",
  "organiser.invite_again_line":
    "這是新的邀請。請依{name}使用的 App，傳給對方其中一個連結。LINE： {line_link} Telegram： {link} 兩個連結都在 7 天內有效。",
  "parent.stopped": "已經全部暫停了。想恢復的時候，隨時說「開始」就可以了。",
  "parent.started": "歡迎回來。下一則早安訊息會在 {time} 送到。",
  "organiser.stopped": "{name}想先暫停。系統一切正常。",
  "parent.family_sees_heading": "家人從您最近的回覆看到的是：",
  "parent.family_sees_empty": "還沒有內容。您回覆早安訊息之後，家人就會看到。",
  "parent.family_sees_weekly_read": "最近一次傳給家人的每週小記裡，關於您這一週的幾行：",
  "group.linked":
    "大家好，我是 Vela。每天晚上，我會告訴大家明天早上輪到誰問{name}一件事。Vela 如何處理大家的訊息： {notice}",
  "group.notice_read": "我看過了",
  "group.not_linked": "只有家庭的發起人才能把 Vela 連結到群組。",
  "group.turn_prompt":
    "明天輪到{holder}問{name}。請直接回覆這則訊息，傳一個問題、一張照片或一段語音。",
  "group.turn_prompt_open":
    "明天大家都可以問{name}一件事。請直接回覆這則訊息，傳一個問題、一張照片或一段語音。",
  "group.turn_prompt_idea": "需要一點靈感的話：「{idea}」",
  "group.turn_prompt_reply_first":
    "{name}今天早上回答了，還沒有人回覆。回覆那則回答，會是{name}明天早上第一個收到的。",
  "group.ask_confirmed": "已放進{name}的早安訊息。",
  "group.ask_queued": "明天已經有{asker}的提問了。這則先保留，改天早上再送出。",
  "group.ask_from_app": "{asker}已經為{name}準備好明天早上的提問。",
  "group.answer_light": "☀️ {name}回覆了{asker} · {time}",
  "group.answer_hello": "☀️ {name}一切都好 · {time}",
  "group.answer_not_okay": "⚠️ {name}說今天不太好 · {time}",
  "group.answer_question": "☀️ {name}回答了 Vela 今天的問題 · {time}\n「{question}」",
  "group.answer_question_tap":
    "Vela 問了：「{question}」直接回覆這則訊息，親自問問看：回覆會是{name}明天早上第一個收到的。",
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
  "quiet.next_step": "方便的話，打個電話給{name}。",
  "quiet.next_step_nearby": "方便的話，打個電話給{name}。如果{name}沒有接，可以請附近的人去看看。",
  "quiet.fine_button": "{name}沒事，我知道原因",
  "quiet.wait_button": "再等 2 小時",
  "quiet.waiting": "我會在 {time} 再看看。",
  "quiet.resolved_answered": "{name}在 {time} 回覆了。燈又亮了。",
  "quiet.resolved_fine": "{organiser}說{name}沒事。",
  "quiet.resolved_away": "{organiser}說{name}不在家。",
  "delivery.failed": "今天沒辦法透過 {channel} 把訊息送給{name}。除此之外，目前沒有別的消息。",
  "flag.notice": "{name}說了一句話，您可能會想知道：「{quote}」",
  "not_okay.notice":
    "⚠️ {name}在 {time} 回覆 Vela 的關心訊息時，按了「不太好」。請盡快打電話給{name}。",
  "flag.notice_no_words": "{name}今天說了一些話，也許值得打個電話問問。",
  "push.not_okay": "{name}在 Vela 上想找家人，請現在打電話給{name}。",
  "push.quiet_notice":
    "{name}那邊今天比較安靜。早安訊息在 {sent} 送到。打開 Vela，可以打個電話，也可以再等等。",
  "push.answer_receipt": "{name}回覆了您。",
  "push.turn_prompt": "明天早上輪到您了：問問{name}一件事吧。",
  "away.confirmed": "好的，那就到{date}為止。祝您過得愉快。",
  "away.confirmed_open": "好的，知道了。祝您過得愉快。",
  "weekly_read.answered": "{name}這週 {days} 天中回覆了 {answered} 天。",
  "weekly_read.answered_one": "{name}這週 {days} 天中回覆了 {answered} 天。",
  "weekly_read.hello_mornings": "有 {mornings} 天早上家裡沒有人提問，Vela 就傳了早安問候給{name}。",
  "weekly_read.hello_mornings_one":
    "有 {mornings} 天早上家裡沒有人提問，Vela 就傳了早安問候給{name}。",
  "weekly_read.nobody_asked": "這週家裡沒有人問{name}任何事。",
  "weekly_read.suggestion": "下週可以問問看：{suggestion}",
  "weekly_read.no_reply":
    "{name}這週的 {answered} 則回覆中，有 {count} 則沒有收到家人的回應或表情。",
  "weekly_read.asks_by": "這週的提問：{askers}。",
  "weekly_read.no_reply_day": "{name}{weekday}的回覆，沒有收到家人的回應或表情。",
  "weekly_read.no_reply_days": "{name}{weekdays}的回覆，沒有收到家人的回應或表情。",
  "weekly_read.asks_by_item": "{name} {asks} 次",
  "weekly_read.asks_none": "{names}這週沒有提問。",
  "weekly_read.health_days": "{name}在{weekdays}提到「{words}」。",
  "weekly_read.health_more": "{name}這週不只一次提到「{words}」。",
  "weekly_read.list_separator": "、",
  "weekly_read.list_and": "和",
  "weekly_read.after_second": "{weekdays}，{name}在第二次訊息之後才回覆。",
  "weekly_read.after_second_usual":
    "{weekdays}，{name}在第二次訊息之後才回覆；平常一週大約 {usual} 次。",
  "weekly_read.quiet_weekday": "已經連續 {weeks} 週，{weekday}早上都很安靜。",
  "weekly_read.feedback_heading": "{name}，這段只給你，關於你這週自己傳的訊息：",
  "weekday.0": "星期日",
  "weekday.1": "星期一",
  "weekday.2": "星期二",
  "weekday.3": "星期三",
  "weekday.4": "星期四",
  "weekday.5": "星期五",
  "weekday.6": "星期六",
  "help.private": "您好。想為家人設定 Vela 的話，請傳送 /start。",
  "help.followed":
    "您好，我是 Vela。如果家人傳了邀請給您，請現在打開。想為自己的家人設定 Vela，請傳 /start。",
  "nearby.request":
    "{organiser}想問您：您住在{name}附近。如果哪天{name}一直沒有回覆，{organiser}又聯絡不上，{organiser}可以透過 Vela 請您過去看看嗎？Vela 不會自己傳訊息給您：任何請求都來自{organiser}。如果您同意，Vela 會保存您的名字和這個 Telegram 帳號，直到您或{organiser}把它們移除。您可以說不，也可以隨時傳送「停」改變主意。Vela 是由 Timur Aiusheev 經營的試辦服務。您的資料會怎麼使用，請看： {notice}",
  "nearby.yes": "好，我願意",
  "nearby.no": "不用了，謝謝",
  "nearby.accepted":
    "謝謝您。只有在{organiser}請您過去看看{name}的時候，Vela 才會傳訊息給您。隨時傳送「停」就可以移除。",
  "nearby.declined": "沒關係。您的資料已經刪除，不會再有人問您。",
  "nearby.already_listed": "您已經列在{name}附近的人裡了，沒有任何變更。",
  "nearby.ask": "{organiser}想問您：今天可以過去看看{name}嗎？{name}今天早上還沒有回覆。",
  "nearby.ask_yes": "我會過去看看",
  "nearby.ask_no": "今天沒辦法",
  "nearby.thanks_yes": "謝謝您。{organiser}已經知道您會過去。",
  "nearby.thanks_no": "謝謝您讓{organiser}知道，完全沒關係。",
  "nearby.stand_down": "{name}已經回覆了，不用過去了。謝謝您。",
  "nearby.removed": "已經為您移除，Vela 不會再傳訊息給您。",
  "nearby.help": "只有在列出您的家庭請您過去看看時，Vela 才會傳訊息給您。傳送「停」就可以移除。",
  "organiser.nearby_yes":
    "{contact}同意了。之後如果哪天早上比較安靜，您可以請{contact}過去看看{name}。",
  "organiser.nearby_no": "{contact}說不用了，所以{contact}已經不在{name}附近的人裡。",
  "organiser.look_in_yes": "{contact}會過去看看{name}。",
  "organiser.look_in_no": "{contact}今天沒辦法。",
  "onboarding.welcome": "您好，我是 Vela。我們一起為一位家人留一盞燈吧。大約兩分鐘就能完成。",
  "onboarding.ask_name": "您平常怎麼稱呼這位家人？例如：媽媽、阿嬤、爸爸。",
  "onboarding.ask_address": "我每天早上問候時，要怎麼稱呼這位家人？例如：陳太太、媽媽。",
  "onboarding.ask_language": "要用哪一種語言傳訊息給這位家人？",
  "onboarding.ask_country": "這位家人住在哪個國家或地區？",
  "onboarding.country_tw": "台灣",
  "onboarding.country_vn": "越南",
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
    "這位家人住在哪個時區？請輸入時區名稱，例如 Asia/Taipei 或 America/Los_Angeles。",
  "onboarding.invalid_zone": "請輸入像 Asia/Taipei 或 America/Los_Angeles 這樣的時區名稱。",
  "onboarding.ask_wake": "這位家人通常幾點起床？請按一個選項，或輸入像 07:30 這樣的時間。",
  "onboarding.ask_nearby":
    "有沒有住在附近、需要的時候可以過去看看的人？請傳送對方的名字，也可以加上對方和這位家人的關係，例如：王小姐，鄰居。或按「略過」。請您先親自問過對方。這裡只填名字：對方同意之後，才會加上電話號碼。",
  "onboarding.nearby_no_number":
    "請只傳送名字，也可以加上對方和這位家人的關係，例如：王小姐，鄰居。對方同意之後，才會加上電話號碼。",
  "onboarding.skip": "略過",
  "onboarding.invalid_time": "請輸入像 07:30 這樣的時間。",
  "onboarding.done":
    "設定完成。請把這個連結傳給{name}： {link} 然後另外建立一個家人群組（不要加{name}），把我加進去，讓家人可以輪流提問。",
  "admin.weekly_read_draft": "{family}的每週小記草稿已經準備好了： {link}",
  "admin.flag": "{family}有一則標記。查看： {link}",
  "admin.quiet_reminder":
    "{family}的{name}安靜通知已經 2 小時沒有人處理，已再次通知發起人。查看： {link}",
  "admin.not_okay": "{family}有人按了「不太好」。查看： {link}",
  "admin.not_okay_nobody_told":
    "緊急：{family}有人按了「不太好」，但沒有任何發起人收到通知。請立刻聯絡這個家庭。查看： {link}",
  "admin.understand_failed": "{family}有一則回覆試了三次仍無法讀取。查看： {link}",
  "admin.family_waiting":
    "{family}的{name}按了同意，但燈還不能亮：請在試用名單核准這個家庭，並確認發起人收過 Vela 的訊息。然後請{name}再按一次同意。查看： {link}",
  "admin.member_left_group": "{name}退出了{family}的家人群組。{name}這邊沒有任何變動。",
  "admin.organisers_unreachable":
    "{family}已經無法再通知{name}，也沒有其他發起人能收到通知：那裡有人安靜下來時，不會有人知道。查看： {link}",
  "admin.quiet_nobody_told":
    "{family}的{name}那邊今天比較安靜，但沒有任何發起人能收到通知。查看： {link}",
  "admin.line_quota": "LINE 本月已用了 {used} 則訊息，上限是 {limit} 則。查看： {link}",
  "admin.line_quota_exhausted":
    "LINE 本月的訊息額度已經用完：在方案變更或下個月開始之前，LINE 上的早安訊息和通知都會傳送失敗，只有回覆還能送出。查看： {link}",
  "admin.quiet_notice_unheard":
    "{family}的{name}那邊今天比較安靜，但傳到一位發起人手機的通知沒有送達。查看： {link}",
  "admin.push_misconfigured":
    "推播通知無法送出：Vela 的推播憑證被拒絕了，修好之前，任何通知都到不了手機。查看： {link}",
  "admin.ops_arrival_failed":
    "自 UTC {since} 起，有 {count} 則早上的訊息無法送達（{environment}）。查看： {link}",
  "admin.ops_dropped":
    "自 UTC {since} 起，有 {count} 則訊息在送出前被丟棄（{environment}）。查看： {link}",
  "admin.ops_scheduler_missed":
    "自 UTC {since} 起，排程漏跑了 {count} 次（{environment}），早上的訊息可能會延遲。查看： {link}",
  "admin.ops_dead_letter":
    "自 UTC {since} 起，有 {count} 個佇列工作重試全部失敗，已保存為無法投遞的工作（{environment}）。請到總覽查看，必要時重新送出。查看： {link}",
  "admin.ops_ai_failing":
    "AI 呼叫正在失敗：過去一小時 {total} 次中有 {failed} 次失敗（{environment}）。回答仍會點亮燈。查看： {link}",
  "admin.ops_peer_down":
    "Vela {peer} 自 UTC {since} 起健康檢查沒有正常回應（最後回應：{seen}）。那裡早上的訊息和安靜通知可能沒有送出。檢查： {link}",
  "admin.ops_peer_back":
    "Vela {peer} 的健康檢查已恢復正常（自 UTC {since} 起中斷，約 {minutes} 分鐘）。請到它的管理頁查看有沒有延遲或漏送的早晨。檢查： {link}",
  "admin.ops_digest":
    "Vela {environment}，過去 24 小時：送達 {delivered} 個早晨、失敗 {failed} 個；{answers} 則回答、{replies} 則回覆、{readbacks} 次讀回；{quiet} 次安靜通知、已解決 {resolved} 次；{flags} 個標記、{stops} 次停止；AI 呼叫 {ai_calls} 次、失敗 {ai_failed} 次、US${ai_cost}；丟棄 {dropped} 則、排程漏跑 {missed} 次。查看： {link}",
};
