/** Founder-selected Afterglow. Local imagery and synthetic examples; no family calls. */
import { type Html, html } from "./html.ts";
import type { SiteLang, SitePageContent, WaitlistFlash } from "./site.ts";
import { LEGAL_LABELS, LEGAL_ORIGIN, LEGAL_PAGES, legalPath } from "./site-legal.ts";

const COPY = {
  en: {
    title: "Vela — A little light. A lot less worry.",
    description:
      "For busy adult children and aging parents. Vela keeps the morning check-in going, even when you forget. See replies and keep family moments close.",
    skip: "Skip to content",
    how: "How it works",
    beyond: "Beyond the check-in",
    join: "Join the waitlist",
    tagline: "FOR ADULT CHILDREN. FOR AGING PARENTS.",
    headline: "A little light.",
    emphasis: "A lot less worry.",
    hero: [
      "You can’t always remember to check in.",
      "Vela does. Every morning.",
      "See your parent’s reply, even on your busiest days.",
    ],
    seeMorning: "See a morning with Vela",
    littleNews: "A little news.",
    littleCloser: "A little closer.",
    gardenAlt: "An illustrative parent photographing tomatoes in a balcony garden",
    todayAlt:
      "Current Vela app showing Mom and Dad with their profile photos and morning reply states",
    momAlt: "Illustrative Mom profile picture",
    lighter: "YOUR MORNING, LIGHTER.",
    log: [
      "Vela says good morning.",
      "Automatically. No reminder needed.",
      "A reply from home.",
      "Waiting for you in the app.",
      "You’re in a meeting.",
      "The connection still happens.",
    ],
    receipt: "Mom answered.",
    receiptTime: "A little news from home · 08:12",
    example: "A MORNING WITH VELA · ILLUSTRATIVE EXAMPLE",
    promises: [
      "A daily hello, sent for you",
      "A reply you can come back to",
      "A quiet notice with Vela Light",
    ],
    problemLabel: "IT’S NOT THAT YOU DON’T CARE.",
    lifeTitle: "Your life gets fuller.",
    parentTitle: "Your parents get older.",
    problem:
      "Work. Your own family. One thing after another. Suddenly it’s evening, and the message you meant to send never happened.",
    loving: "Loving them isn’t the hard part.",
    remembering: "Remembering every day is.",
    parentAlt: "An illustrative older parent listening to a message at the breakfast table",
    people: "THE PEOPLE BEHIND THE CHECK-IN",
    task: "Not another task.",
    loved: "Someone you love.",
    ritualLabel: "A SMALL ROUTINE. A REAL DIFFERENCE.",
    ritualTitle: "You get on with your day.",
    ritualEm: "Vela keeps the hello going.",
    ritualIntro: "You use Vela. Your parent answers in a familiar messenger. No new app to learn.",
    explore: "Explore a morning with Vela",
    morningExample: "AN EXAMPLE MORNING",
    momMorning: "Mom’s morning",
    messenger: "In a familiar messenger",
    steps: [
      {
        title: "Even when you forget.",
        body: "Vela sends the morning hello. Prepare something personal, or let Vela supply the greeting.",
        time: "08:00",
        label: "A HELLO FROM VELA",
        message: "Good morning, Mom. How’s your morning going?",
        status: "Morning hello sent automatically",
        outcome: "One less thing to remember. The daily connection still happens.",
      },
      {
        title: "A reply. A little relief.",
        body: "Your parent answers with a tap, words, or voice. The reply and its time are there when you have a moment.",
        time: "08:12",
        label: "A REPLY FROM MOM",
        message: "Already in the garden. The tomatoes are finally turning!",
        status: "Reply received · 08:12",
        outcome:
          "You’re busy. The reply is waiting. Come back to a little news from home when you can.",
      },
      {
        title: "And if it stays quiet?",
        body: "If Mom’s morning goes quiet, you’ll know before lunch. About an hour after she usually answers, Vela Light asks once how she is. If she taps “Not okay”, or stays quiet, the family hears. You decide how to follow up.",
        time: "Later",
        label: "WHEN THE MORNING STAYS QUIET",
        message: "No reply yet. It may be a good time to reach out.",
        status: "With Vela Light · after one gentle question, before lunch",
        outcome:
          "The family gets a quiet notice. You choose the next step. No assumption about what silence means.",
      },
    ],
    boundary: "Illustrative flow, not a live message. A reply isn’t proof of health or safety.",
    memoryLabel: "BEYOND “DID YOU CHECK IN?”",
    memoryTitle: "Don’t just keep up.",
    memoryEm: "Keep the little things.",
    ordinary: "The ordinary details are often the ones worth holding onto.",
    recipeAlt: "Illustrative family members preparing a family recipe together",
    memories: "MEMORIES",
    recipeTitle: "One day, it’s just a recipe.",
    recipeEm: "One day, it’s everything.",
    memoryBody:
      "Come back to family messages, stories, and moments. More than a quick “I’m fine,” less lost in the rush.",
    memoryStatus: "Conversational memory discovery is in development.",
    weekLabel: "A LITTLE MORE PERSPECTIVE",
    weekTitle: "The week.",
    weekEm: "Not just this morning.",
    weekBody: "A weekly read gives you another way to catch up, at your own pace.",
    weekStatus:
      "Everyday support suggestions are in development. Personalized health advice is not available.",
    weekAlt: "Current Vela Week screen with a synthetic family’s weekly read",
    values: [
      { title: "Made for parents, too.", body: "A familiar messenger, not another app to learn." },
      { title: "Care, with a choice.", body: "Taking part is a choice. Families stay in control." },
      {
        title: "A bridge, not a replacement.",
        body: "Vela keeps the routine. You bring the relationship.",
      },
    ],
    faqLabel: "A FEW THINGS YOU MIGHT WONDER",
    faqs: [
      {
        question: "Is Vela for me?",
        answer:
          "Vela is for adult children who want a more consistent connection with an aging parent, especially when busy days or distance get in the way.",
      },
      {
        question: "Does my parent need the Vela app?",
        answer:
          "No. You use the Vela app. Your parent answers in a familiar messenger. We’ll explain the supported options when your family starts.",
      },
      {
        question: "Is this an emergency or medical service?",
        answer:
          "No. Vela supports a daily connection. It cannot confirm that someone is awake, safe, or healthy, and does not replace emergency services or professional care.",
      },
      {
        question: "What happens after I join?",
        answer:
          "We’ll write when your family can start. Joining the waitlist does not create an account or start a paid plan.",
      },
    ],
    closingLabel: "FOR THE PEOPLE ALWAYS ON YOUR MIND.",
    closingTitle: "A familiar morning.",
    closingEm: "A little peace of mind.",
    closingBody: "You don’t have to remember everything to keep a little light on.",
    yourEmail: "Your email",
    updates: "Only news about when your family can start.",
    privacy: "Website privacy",
    productPrivacy: "Product privacy",
    serviceStatus: "How Vela is doing",
    contact: "Contact",
    footer: "A little closer, every day.",
    guarantee: "A daily connection. Not a safety guarantee.",
    disclosure: "Illustrative photographs and synthetic app data. Not customer stories.",
    closeWaitlist: "Close waitlist",
    dialogTitle: "A little closer starts here.",
    leaveEmail: "Leave your email. We’ll let you know when Vela is ready for your family.",
    joined: "You’re on the list. We’ll write when your family can start.",
    badEmail: "Please enter a valid email address.",
    failed: "We couldn’t confirm your place. Please try again.",
    joining: "Joining…",
    onList: "You’re on the list ✓",
    rateLimited: "Please wait a moment and try again.",
  },
  "zh-TW": {
    title: "Vela — 一點微光，多一點安心。",
    description:
      "給生活忙碌的你，也給年歲漸長的爸媽。就算忘了傳訊息，Vela 也會接續早晨的問候，讓你看見回覆、適時聯絡，記住家人的日常。",
    skip: "跳至主要內容",
    how: "如何使用",
    beyond: "不只一句早安",
    join: "加入等候名單",
    tagline: "給你，也給年歲漸長的爸媽。",
    headline: "一點微光，",
    emphasis: "多一點安心。",
    hero: [
      "有時候，你會忙得忘了問候。",
      "Vela 記得。每天早上。",
      "再忙，也能在有空時看看爸媽的回覆。",
    ],
    seeMorning: "看看有 Vela 的早晨",
    littleNews: "家裡的一點日常。",
    littleCloser: "讓彼此靠近一點。",
    gardenAlt: "爸媽在陽台菜園拍下番茄的示意照片",
    todayAlt: "現行 Vela App，顯示媽媽與爸爸的大頭照及早晨回覆狀態",
    momAlt: "媽媽大頭照示意",
    lighter: "讓早晨，少一點掛心。",
    log: [
      "Vela 送上一聲早安。",
      "自動送出，不用再提醒自己。",
      "家裡傳來了回覆。",
      "留在 App 裡，等你有空再看。",
      "你正在開會。",
      "問候依然沒有落下。",
    ],
    receipt: "媽媽回覆了。",
    receiptTime: "家裡的一點日常 · 08:12",
    example: "有 Vela 的早晨 · 示意內容",
    promises: ["每天，替你送上一聲問候", "有空時，再看看爸媽的回覆", "Vela Light 提供後續提醒"],
    problemLabel: "不是不關心，只是日子太忙。",
    lifeTitle: "你的生活越來越滿，",
    parentTitle: "爸媽也漸漸變老。",
    problem:
      "工作、自己的家庭，還有一件接一件的小事。忽然就到了晚上，原本想傳的那句問候，還沒送出去。",
    loving: "關心爸媽，不難。",
    remembering: "每天都記得，沒那麼容易。",
    parentAlt: "長輩在早餐桌前聽訊息的示意照片",
    people: "每一聲問候背後，都是你在乎的人。",
    task: "不只是一件待辦，",
    loved: "是你愛的人。",
    ritualLabel: "一個小習慣，讓日常多一點連結。",
    ritualTitle: "你繼續忙你的，",
    ritualEm: "Vela 把問候接下去。",
    ritualIntro: "你使用 Vela；爸媽在熟悉的通訊軟體裡回答，不用再學一個 App。",
    explore: "看看有 Vela 的早晨",
    morningExample: "早晨示例",
    momMorning: "媽媽的早晨",
    messenger: "在熟悉的通訊軟體裡",
    steps: [
      {
        title: "忘了準備，問候也不會落下。",
        body: "你可以先準備想說的話；如果還沒準備，Vela 會提供早晨的問候。",
        time: "08:00",
        label: "VELA 送上的早安",
        message: "媽媽，早安。今天早上過得怎麼樣？",
        status: "早晨問候已自動送出",
        outcome: "少一件要記住的事，每天的問候依然接得上。",
      },
      {
        title: "看見回覆，心裡鬆一點。",
        body: "爸媽可以點一下、打幾個字，或用語音回答。有空時，就能看到回覆和時間。",
        time: "08:12",
        label: "媽媽的回覆",
        message: "已經在菜園了。番茄終於紅了！",
        status: "收到回覆 · 08:12",
        outcome: "你正在忙，回答會留著。有空時，再看看家裡的一點日常。",
      },
      {
        title: "如果一直沒回覆呢？",
        body: "如果媽媽的早晨一直很安靜，午餐前你就會知道。Vela Light 會在她平常回覆的時間過後大約一小時，關心一次。如果她按下「不太好」，或一直沒有回覆，家人就會收到通知，再由你決定怎麼聯絡。",
        time: "稍後",
        label: "如果早晨一直沒有回覆",
        message: "目前還沒收到回覆。也許可以再聯絡看看。",
        status: "Vela Light · 關心一次之後，午餐前",
        outcome: "家人會收到提醒，下一步由你決定。不因為沉默，就判定發生了什麼事。",
      },
    ],
    boundary: "流程為示意，並非即時訊息。收到回覆，不代表能確認健康或安全狀況。",
    memoryLabel: "不只知道「今天問候了嗎？」",
    memoryTitle: "不只跟上日常，",
    memoryEm: "也留住那些小事。",
    ordinary: "看似平凡的細節，往往最值得記住。",
    recipeAlt: "家人一起準備家傳料理的示意照片",
    memories: "回憶",
    recipeTitle: "今天，只是一道菜。",
    recipeEm: "有一天，卻是最想念的味道。",
    memoryBody:
      "回頭看看家人分享的訊息、故事和片刻。不只是一句「我很好」，也少一點被忙碌沖淡的日常。",
    memoryStatus: "從對話發掘回憶的功能仍在開發中。",
    weekLabel: "多一點理解的空間",
    weekTitle: "看看這一週，",
    weekEm: "不只今天早上。",
    weekBody: "每週回顧，讓你用自己的步調，看看這一週家人分享了什麼。",
    weekStatus: "日常家庭支持建議仍在開發中。目前未提供個人化健康建議。",
    weekAlt: "現行 Vela 每週回顧畫面，使用示範家庭資料",
    values: [
      { title: "也替爸媽想好了。", body: "在熟悉的通訊軟體裡，不用多學一個 App。" },
      { title: "關心，也保有選擇。", body: "是否參與由自己決定，家人一起商量節奏。" },
      { title: "連結彼此，不取代相處。", body: "Vela 接續日常，感情還是你們的。" },
    ],
    faqLabel: "你可能想問的幾件事。",
    faqs: [
      {
        question: "Vela 適合我嗎？",
        answer:
          "如果你想和年歲漸長的爸媽保持更穩定的日常連結，卻常被忙碌或距離打斷，Vela 就是為這樣的家庭而做的。",
      },
      {
        question: "爸媽需要安裝 Vela App 嗎？",
        answer:
          "不需要。你使用 Vela App，爸媽在熟悉的通訊軟體裡回答。適合你的家庭開始使用時，我們會說明支援哪些選項。",
      },
      {
        question: "這是緊急救援或醫療服務嗎？",
        answer:
          "不是。Vela 支持日常的家庭連結，無法確認一個人是否醒著、健康或安全，也不能取代緊急救援或專業照護。",
      },
      {
        question: "加入之後會怎麼樣？",
        answer:
          "適合你的家庭開始使用時，我們會寄信通知。加入等候名單不會建立帳號，也不會開始付費方案。",
      },
    ],
    closingLabel: "給那些，你總是放在心上的人。",
    closingTitle: "一聲熟悉的早安，",
    closingEm: "心裡多一點安心。",
    closingBody: "不必記住所有事，也能為家人留一點光。",
    yourEmail: "你的電子郵件",
    updates: "只寄送 Vela 開放使用的通知。",
    privacy: "網站隱私",
    productPrivacy: "產品隱私",
    serviceStatus: "Vela 的服務狀況",
    contact: "聯絡我們",
    footer: "每天，靠近一點。",
    guarantee: "日常的連結，不是安全保證。",
    disclosure: "照片與 App 家庭資料皆為示意，並非真實使用者。",
    closeWaitlist: "關閉等候名單",
    dialogTitle: "靠近一點，就從一句你好開始。",
    leaveEmail: "留下電子郵件。適合你的家庭開始使用時，我們會通知你。",
    joined: "你已加入等候名單。適合你的家庭開始使用時，我們會通知你。",
    badEmail: "請填寫有效的電子郵件地址。",
    failed: "暫時無法確認是否加入成功，請再試一次。",
    joining: "加入中…",
    onList: "已加入等候名單 ✓",
    rateLimited: "請稍候再試一次。",
  },
} as const;

export function approvedCopy(lang: SiteLang) {
  return COPY[lang];
}
export function approvedDemo(lang: SiteLang) {
  return COPY[lang];
}
export function siteCopyright(lang: SiteLang): string {
  return `© ${new Date().getUTCFullYear()} Vela. ${lang === "en" ? "All rights reserved." : "保留所有權利。"}`;
}
function demoData(lang: SiteLang): Html {
  const json = JSON.stringify(approvedDemo(lang)).replace(/</g, "\\u003c");
  return { markup: `<script type="application/json" id="vela-demo">${json}</script>` };
}

/** Both forms retain ordinary POST navigation when JavaScript is unavailable. */
function form(lang: SiteLang, id: string, flash: WaitlistFlash = null): Html {
  const c = COPY[lang];
  const privacy = lang === "en" ? "/website-privacy" : "/zh-TW/website-privacy";
  const feedback =
    flash === "joined"
      ? html`<div class="flash ok" role="status">${c.joined}</div>`
      : flash === "email"
        ? html`<div class="flash err" role="alert">${c.badEmail}</div>`
        : null;
  return html`<form class="waitlist" method="post" action="/waitlist" data-waitlist-form><input type="hidden" name="lang" value="${lang}"><label for="${id}-email">${c.yourEmail}</label><div class="waitlist-input-row"><input id="${id}-email" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"><button class="button amber" type="submit">${c.join}<span aria-hidden="true">↗</span></button></div><div class="form-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="waitlist-privacy">${c.updates} <a href="${privacy}">${c.privacy}</a></p><p class="form-status" role="status" aria-live="polite"></p>${feedback}</form>`;
}

export function approvedHome(lang: SiteLang, flash: WaitlistFlash): SitePageContent {
  const c = COPY[lang];
  const home = lang === "en" ? "/" : "/zh-TW";
  const otherLang = lang === "en" ? "zh-TW" : "en";
  const otherHome = lang === "en" ? "/zh-TW" : "/";
  const otherLabel = lang === "en" ? "繁體中文" : "English";
  const privacy = lang === "en" ? "/website-privacy" : "/zh-TW/website-privacy";
  const pilotPrivacy = lang === "en" ? "/privacy" : "/privacy/zh-TW";
  const precision = lang === "en" ? "/how-vela-is-doing" : "/zh-TW/how-vela-is-doing";
  const first = c.steps[0];
  return {
    title: c.title,
    description: c.description,
    body: html`<div class="approved-home afterglow"><a class="skip-link" href="#main">${c.skip}</a>
<header class="wrap nav"><a href="${home}" aria-label="Vela"><img class="logo white" src="/site/img/vela-logo-white.svg" width="110" height="42" alt="Vela"></a><nav class="nav-links" aria-label="${c.how}"><a href="#how">${c.how}</a><a href="#more">${c.beyond}</a><a class="language-link" href="${otherHome}" hreflang="${otherLang}" lang="${otherLang}">${otherLabel}</a><a class="nav-join" href="#join" data-waitlist aria-haspopup="dialog" aria-controls="waitlist-dialog">${c.join} ↗</a></nav></header>
<main id="main">
<section class="hero" aria-labelledby="hero-title"><div class="wrap"><p class="label eyebrow"><span class="dot" aria-hidden="true"></span>${c.tagline}</p><h1 id="hero-title">${c.headline}<br><em>${c.emphasis}</em></h1><p class="lede">${c.hero[0]}<br><strong>${c.hero[1]}</strong><br>${c.hero[2]}</p><div class="actions"><a class="button amber" href="#join" data-waitlist aria-haspopup="dialog" aria-controls="waitlist-dialog">${c.join}<span aria-hidden="true">↗</span></a><a class="text-link" href="#how">${c.seeMorning} ↓</a></div>
<div class="morning-world"><figure class="home-moment"><img src="/site/img/story/garden-update.jpg" width="1024" height="1024" alt="${c.gardenAlt}"><figcaption>${c.littleNews}<br><em>${c.littleCloser}</em></figcaption></figure><div class="orbit" aria-hidden="true"></div><div class="orbit orbit-two" aria-hidden="true"></div><div class="phone hero-phone"><img src="/site/img/app-current/today-portraits.jpg" width="390" height="844" alt="${c.todayAlt}"></div><div class="morning-log"><p class="label">${c.lighter}</p><div><span>08:00</span><p>${c.log[0]}<small>${c.log[1]}</small></p></div><div><span>08:12</span><p>${c.log[2]}<small>${c.log[3]}</small></p></div><p class="log-note">${c.log[4]}<br>${c.log[5]}</p></div><div class="receipt floating-receipt"><img class="portrait" src="/site/img/story/parent-profile.jpg" width="38" height="38" alt="${c.momAlt}"><div><strong>${c.receipt}</strong><small>${c.receiptTime}</small></div><span class="receipt-check" aria-hidden="true">↗</span></div><span class="scene-note">${c.example}</span></div></div></section>
<div class="promise-bar wrap">${c.promises.map((promise, index) => html`<span><i>0${index + 1}</i>${promise}</span>`)}</div>
<section id="why" class="life-section wrap" aria-labelledby="problem-title"><div class="life-copy"><p class="label">${c.problemLabel}</p><h2 id="problem-title">${c.lifeTitle}<br><span>${c.parentTitle}</span></h2><p>${c.problem}</p><p class="life-point">${c.loving}<br><strong>${c.remembering}</strong></p></div><figure class="life-photo"><img loading="lazy" src="/site/img/story/familiar-voice.jpg" width="1024" height="1024" alt="${c.parentAlt}"><figcaption><span>${c.people}</span><p>${c.task}<br><em>${c.loved}</em></p></figcaption></figure></section>
<section class="ritual" id="how" aria-labelledby="how-title"><div class="wrap"><div class="section-heading"><div><p class="label">${c.ritualLabel}</p><h2 id="how-title">${c.ritualTitle}<br><em>${c.ritualEm}</em></h2></div><p>${c.ritualIntro}</p></div><div class="ritual-grid"><div class="ritual-steps" role="group" aria-label="${c.explore}">${c.steps.map((step, index) => html`<button class="ritual-step" type="button" aria-pressed="${index === 0 ? "true" : "false"}" aria-controls="morning-preview" data-morning="${index}" disabled><span>0${index + 1}</span><span class="step-copy"><strong>${step.title}</strong><span>${step.body}</span></span><b aria-hidden="true">↗</b></button>`)}</div><div id="morning-preview" class="ritual-preview" aria-live="polite" aria-atomic="true"><div class="preview-top"><span class="label">${c.morningExample}</span><span id="morning-time">${first.time}</span></div><div class="example-person"><img src="/site/img/story/parent-profile.jpg" width="48" height="48" alt="${c.momAlt}"><div><strong>${c.momMorning}</strong><small>${c.messenger}</small></div><span class="sun-symbol" aria-hidden="true">☀</span></div><div class="example-message"><span class="label" id="morning-label">${first.label}</span><p id="morning-message">${first.message}</p><small id="morning-status">${first.status}</small></div><div class="example-outcome"><span class="dot" aria-hidden="true"></span><p id="morning-outcome">${first.outcome}</p></div><p class="example-disclaimer">${c.boundary}</p></div></div></div></section>
<section id="more" class="beyond wrap" aria-labelledby="more-title"><div class="section-heading"><div><p class="label">${c.memoryLabel}</p><h2 id="more-title">${c.memoryTitle}<br><em>${c.memoryEm}</em></h2></div><p>${c.ordinary}</p></div><div class="memory-layout"><article class="memory-story"><img loading="lazy" src="/site/img/story/family-recipe.jpg" width="1024" height="1024" alt="${c.recipeAlt}"><div class="memory-caption"><p class="label">${c.memories}</p><h3>${c.recipeTitle}<br>${c.recipeEm}</h3><p>${c.memoryBody}</p><small>${c.memoryStatus}</small></div></article><article class="week-story"><div><p class="label">${c.weekLabel}</p><h3>${c.weekTitle}<br>${c.weekEm}</h3><p>${c.weekBody}</p><small>${c.weekStatus}</small></div><div class="phone"><img loading="lazy" src="/site/img/app-current/week-current.jpg" width="390" height="844" alt="${c.weekAlt}"></div></article></div><div class="values" id="care">${c.values.map((value) => html`<div><h3>${value.title}</h3><p>${value.body}</p></div>`)}</div></section>
<section class="questions wrap" aria-labelledby="faq-title"><h2 class="label" id="faq-title">${c.faqLabel}</h2><div>${c.faqs.map((faq) => html`<details><summary>${faq.question}</summary><p>${faq.answer}</p></details>`)}</div></section>
<section id="join" class="closing" aria-labelledby="closing-title"><div class="closing-light" aria-hidden="true"></div><p class="label">${c.closingLabel}</p><h2 id="closing-title">${c.closingTitle}<br><em>${c.closingEm}</em></h2><p>${c.closingBody}</p>${form(lang, "footer", flash)}</section>
</main>
<footer class="wrap footer"><a href="${home}" aria-label="Vela"><img src="/site/img/vela-logo-white.svg" width="78" height="30" alt="Vela"></a><span>${c.footer}</span><span>${c.guarantee}</span><nav class="footer-links" aria-label="${c.privacy}"><a href="${privacy}">${c.privacy}</a><a href="${pilotPrivacy}">${c.productPrivacy}</a><a href="${precision}">${c.serviceStatus}</a>${LEGAL_PAGES.map((page) => html`<a href="${LEGAL_ORIGIN}${legalPath(lang, page)}">${LEGAL_LABELS[lang][page]}</a>`)}<a href="mailto:t.aiusheev@gmail.com">${c.contact}</a><a href="${otherHome}" hreflang="${otherLang}" lang="${otherLang}">${otherLabel}</a></nav><p class="footer-copyright">${siteCopyright(lang)}</p></footer><p class="prototype-note">${c.disclosure}</p>
<dialog id="waitlist-dialog" aria-labelledby="waitlist-title"><button class="dialog-close" type="button" aria-label="${c.closeWaitlist}">×</button><img src="/site/img/vela-logo.svg" width="110" height="42" alt="Vela"><h2 id="waitlist-title">${c.dialogTitle}</h2><p>${c.leaveEmail}</p>${form(lang, "dialog")}</dialog>${demoData(lang)}</div>`,
  };
}
