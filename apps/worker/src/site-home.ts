/** Approved website, 20 October 2026. Synthetic examples; no family/provider calls. */
import { type Html, html } from "./html.ts";
import type { SiteLang, SitePageContent, WaitlistFlash } from "./site.ts";
import { LEGAL_LABELS, LEGAL_ORIGIN, LEGAL_PAGES, legalPath } from "./site-legal.ts";

const SUPPORT_EMAIL = "t.aiusheev@gmail.com";
const COPY = {
  en: {
    skip: "Skip to content",
    why: "Why Vela",
    how: "How it works",
    careNav: "Made with care",
    join: "Join the waitlist",
    tagline: "A LITTLE CLOSER, EVERY DAY.",
    heroStart: "Stay close to ",
    heroParent: "your parent.",
    heroSecond: "Even from ",
    heroEmphasis: "far away.",
    heroLine1: "You send a question from Vela.",
    heroLine2: "They reply in a messenger they know.",
    seeHow: "See how it works",
    galleryLabel: "Everyday family connection in four photographs",
    galleryKeys: "Moving photo story. Use left and right arrow keys to explore.",
    cityAlt: "A daughter finding a moment to send a voice message after work",
    gardenAlt: "A mother photographing the tomatoes she has grown on her balcony",
    voiceAlt: "A father listening to a voice message at his breakfast table",
    recipeAlt:
      "A father and child cooking together, ready to share their attempt at a family recipe",
    cityCaption: "A moment between everything.",
    gardenCaption: "A little news from home.",
    voiceCaption: "A familiar voice in their day.",
    recipeCaption: "A little of your day, back.",
    previousPhoto: "Previous photograph",
    nextPhoto: "Next photograph",
    pause: "Pause photos",
    ideaEyebrow: "A SMALL WAY INTO EACH OTHER’S DAY.",
    goBeyond: "Go beyond",
    howAreYou: "“How are you?”",
    specificQuestion: "A specific question gives you something real to talk about.",
    youAsk: "YOU ASK",
    gardenQuestion: "“What did the garden look like this morning?”",
    momAnswers: "MOM ANSWERS",
    gardenAnswer: "“The tomatoes finally turned. I picked three before breakfast.”",
    youReply: "YOU REPLY",
    saveTwo: "“Save me two for Sunday?”",
    payoffStart: "Now you’re part of ",
    payoffEnd: "her day.",
    howEyebrow: "HERE’S HOW IT WORKS.",
    oneQuestion: "One question.",
    aWhole: "A whole",
    conversation: "conversation.",
    smallExchange: "A small exchange, with a reply coming back.",
    exploreExchange: "Explore the daily exchange",
    sendTitle: "Send a little something.",
    sendDetail: "A question, a photo, a familiar hello.",
    answerTitle: "They answer their way.",
    answerDetail: "In a messenger they already know.",
    replyTitle: "Keep the conversation going.",
    replyDetail: "Send a little of your own day back.",
    questionLabel: "01 / YOUR QUESTION",
    appSource: "Vela app · Example family",
    askAlt: "Current Vela Ask screen with example family data",
    viewScreen: "View screen",
    enlarge: "Enlarge the current app screen",
    parentGreeting: "A morning hello for Mom",
    initialExplanation: "Choose a question and who it’s for.",
    youApp: "YOU · THE VELA APP",
    showAnswer: "Show how the parent replies",
    next: "Next",
    careEyebrow: "MADE WITH CARE.",
    closeSpace: "Close, with room",
    beYourself: "to be yourself.",
    windowAlt: "An illustrated window with a warm light on at home",
    everyoneSay: "Everyone gets a say.",
    choice:
      "Taking part is a choice. Agree on the rhythm together, with room for pauses and quiet days.",
    quietTitle: "A quiet day isn’t a diagnosis.",
    quietBody:
      "Optional, agreed follow-ups can give the family a reason to reach out. Vela is not an emergency or medical service.",
    dataTitle: "Clear about your family’s information.",
    dataBody:
      "Understand how content is handled and how to ask for access or deletion. Vela is not end-to-end encrypted.",
    readPrivacy: "Read the product privacy information",
    faqStart: "A few",
    faqEnd: "good questions.",
    needApp: "Does my parent need the Vela app?",
    needAppBody:
      "No. Vela is being built around the messengers parents already use. You use the Vela app; they have a familiar place to reply. We’ll share supported options as access opens.",
    replaceCalls: "Does this replace our calls?",
    replaceCallsBody:
      "Keep calling and visiting. Vela gives you something small to share between those bigger conversations.",
    afterAnswer: "What happens after my parent answers?",
    afterAnswerBody:
      "You can read their answer and reply. Your words come back to them, so the conversation travels both ways.",
    whenTry: "When can we try Vela?",
    whenTryBody: "Join the waitlist and we’ll let you know when Vela is ready for your family.",
    closeStart: "A little ",
    closer: "closer,",
    everyDay: "every day.",
    firstFamilies: "Be among the first families to try Vela.",
    yourEmail: "Your email",
    updates: "Vela availability updates only.",
    privacy: "Privacy",
    productPrivacy: "Product privacy",
    serviceStatus: "How Vela is doing",
    contact: "Contact",
    backToTop: "Back to top ↑",
    footerTagline: "A little closer, every day.",
    disclosure: "Illustrative photographs and example family",
    closeWaitlist: "Close waitlist",
    dialogTitleStart: "A little closer",
    dialogTitleMiddle: "starts with ",
    dialogTitleEnd: "hello.",
    leaveEmail: "Leave your email. We’ll let you know when Vela is ready for your family.",
    screenSource: "VELA APP · EXAMPLE FAMILY",
    closeScreen: "Close enlarged app screen",
    enlargedAlt: "Enlarged Vela app screen",
    title: "Vela — A little closer, every day.",
    description: "Stay close to your parent through small daily exchanges. Join the Vela waitlist.",
    joined: "You’re on the list. We’ll write when your family can start.",
    badEmail: "Please enter a valid email address.",
    failed: "We couldn’t confirm your place. Please try again.",
    joining: "Joining…",
    onList: "You’re on the list ✓",
    rateLimited: "Please wait a moment and try again.",
    play: "Play photos",
    replay: "Replay",
    readAnswer: "Read the example answer",
    hideAnswer: "Hide the example answer",
    parentSource: "Illustrative messenger exchange",
    parentCaption: "YOUR PARENT · THEIR MESSENGER",
    answerLabel: "02 / THEIR ANSWER",
    replyLabel: "03 / YOUR REPLY",
    askExplanation:
      "Choose a question and who it’s for. Your parent receives it in their messenger.",
    answerExplanation: "They answer with a tap or a voice note, in a familiar conversation.",
    replyExplanation:
      "Read her answer and send something back. She hears the family’s replies the next morning.",
    parentQuestion: "What did the garden look like this morning?",
    parentAnswer:
      "The tomatoes finally turned. I picked three before breakfast and left them on the sill.",
    parentSender: "A MORNING QUESTION, FROM MIA",
    voiceLabel: "MOM’S VOICE REPLY",
    noAudio: "Example messages; no audio is played.",
    askScreenAlt: "Current Vela Ask screen with a sample garden question",
    replyScreenAlt: "Current Vela Reply screen with a sample family response",
    photoPosition: "Photograph",
  },
  "zh-TW": {
    skip: "跳至主要內容",
    why: "為什麼是 Vela",
    how: "如何使用",
    careNav: "用心設計",
    join: "加入等候名單",
    tagline: "每天，靠近一點。",
    heroStart: "和",
    heroParent: "爸媽保持聯繫。",
    heroSecond: "無論相隔",
    heroEmphasis: "多遠。",
    heroLine1: "你從 Vela 傳出一個問題，",
    heroLine2: "爸媽用熟悉的通訊軟體回答。",
    seeHow: "看看如何使用",
    galleryLabel: "四張照片裡的日常親情",
    galleryKeys: "移動中的照片故事。可用左右方向鍵瀏覽。",
    cityAlt: "女兒下班後，找個空檔傳一段語音",
    gardenAlt: "媽媽拍下陽台上親手種的番茄",
    voiceAlt: "爸爸吃早餐時，聽著家人的語音",
    recipeAlt: "爸爸和孩子一起下廚，準備分享家傳食譜的成果",
    cityCaption: "忙碌之間，想起你。",
    gardenCaption: "家裡的一點新鮮事。",
    voiceCaption: "熟悉的聲音，陪著一天。",
    recipeCaption: "也把你的一天，分享回去。",
    previousPhoto: "上一張照片",
    nextPhoto: "下一張照片",
    pause: "暫停照片",
    ideaEyebrow: "從一個小問題，走進彼此的一天。",
    goBeyond: "試著多問一句，",
    howAreYou: "不只是「你好嗎？」",
    specificQuestion: "問得具體一點，就多了一件能好好聊的事。",
    youAsk: "你問",
    gardenQuestion: "「今天早上，菜園長得怎麼樣？」",
    momAnswers: "媽媽回答",
    gardenAnswer: "「番茄終於紅了。吃早餐前，我摘了三顆。」",
    youReply: "你回覆",
    saveTwo: "「幫我留兩顆，星期天回去拿？」",
    payoffStart: "於是，你也成了",
    payoffEnd: "她一天裡的一部分。",
    howEyebrow: "就從這樣的小交換開始。",
    oneQuestion: "一個問題，",
    aWhole: "聊成",
    conversation: "一段對話。",
    smallExchange: "你分享一點，對方也有話傳回來。",
    exploreExchange: "看看每天如何交流",
    sendTitle: "傳一點日常。",
    sendDetail: "一個問題、一張照片，或熟悉的問候。",
    answerTitle: "讓爸媽照自己的方式回答。",
    answerDetail: "就在原本熟悉的通訊軟體裡。",
    replyTitle: "讓對話繼續。",
    replyDetail: "把你的一天，也分享回去。",
    questionLabel: "01 / 你想問的",
    appSource: "Vela App · 示範家庭",
    askAlt: "現行 Vela 提問畫面，使用示範家庭資料",
    viewScreen: "放大畫面",
    enlarge: "放大現行 App 畫面",
    parentGreeting: "給媽媽的早安問候",
    initialExplanation: "選一個問題，再選想問的人。",
    youApp: "你 · VELA APP",
    showAnswer: "看看爸媽如何回答",
    next: "下一步",
    careEyebrow: "用心設計。",
    closeSpace: "讓彼此靠近，",
    beYourself: "也保有自己的空間。",
    windowAlt: "家裡亮著一盞暖燈的窗戶插畫",
    everyoneSay: "每個人都能自己決定。",
    choice: "是否參與，由自己決定。一起商量適合的節奏，也為暫停和安靜的日子留點空間。",
    quietTitle: "沒回覆，不等於出了狀況。",
    quietBody: "雙方同意的後續提醒，可以讓家人想起再聯絡看看。Vela 不是緊急救援或醫療服務。",
    dataTitle: "家人的資料，說清楚。",
    dataBody: "了解內容如何處理，以及如何申請查閱或刪除。Vela 並未提供端對端加密。",
    readPrivacy: "閱讀產品隱私說明",
    faqStart: "你可能想問的",
    faqEnd: "幾件事。",
    needApp: "爸媽需要安裝 Vela App 嗎？",
    needAppBody:
      "不需要。我們正把 Vela 做進爸媽原本使用的通訊軟體。你使用 Vela App，他們在熟悉的地方回答。開放使用時，我們會說明支援哪些選項。",
    replaceCalls: "這會取代打電話嗎？",
    replaceCallsBody: "電話照打，也繼續見面。Vela 讓你們在那些長聊之間，也有一點日常可以分享。",
    afterAnswer: "爸媽回答之後呢？",
    afterAnswerBody: "你可以讀到回答，再回覆幾句。你的話也會傳回爸媽那裡，讓交流是雙向的。",
    whenTry: "什麼時候可以試用 Vela？",
    whenTryBody: "加入等候名單，適合你的家庭開始使用時，我們會通知你。",
    closeStart: "每天，",
    closer: "靠近",
    everyDay: "一點。",
    firstFamilies: "和第一批家庭一起，試試 Vela。",
    yourEmail: "你的電子郵件",
    updates: "只寄送 Vela 開放使用的通知。",
    privacy: "網站隱私",
    productPrivacy: "產品隱私",
    serviceStatus: "Vela 的服務狀況",
    contact: "聯絡我們",
    backToTop: "回到頁首 ↑",
    footerTagline: "每天，靠近一點。",
    disclosure: "照片與家庭對話皆為示意，並非真實使用者",
    closeWaitlist: "關閉等候名單",
    dialogTitleStart: "靠近一點，",
    dialogTitleMiddle: "就從",
    dialogTitleEnd: "一句你好開始。",
    leaveEmail: "留下電子郵件。適合你的家庭開始使用時，我們會通知你。",
    screenSource: "VELA APP · 示範家庭",
    closeScreen: "關閉放大的 App 畫面",
    enlargedAlt: "放大的 Vela App 畫面",
    title: "Vela — 每天，靠近一點。",
    description: "從每天的小交流，和爸媽保持聯繫。加入 Vela 等候名單。",
    joined: "你已加入等候名單。適合你的家庭開始使用時，我們會通知你。",
    badEmail: "請填寫有效的電子郵件地址。",
    failed: "暫時無法確認是否加入成功，請再試一次。",
    joining: "加入中…",
    onList: "已加入等候名單 ✓",
    rateLimited: "請稍候再試一次。",
    play: "播放照片",
    replay: "重看",
    readAnswer: "閱讀示範回答",
    hideAnswer: "收起示範回答",
    parentSource: "通訊軟體對話示意",
    parentCaption: "爸媽 · 熟悉的通訊軟體",
    answerLabel: "02 / 爸媽的回答",
    replyLabel: "03 / 你的回覆",
    askExplanation: "選一個問題，再選想問的人。爸媽在熟悉的通訊軟體裡收到。",
    answerExplanation: "就在熟悉的對話裡，點一下或用語音回答。",
    replyExplanation: "讀到她的回答，再傳幾句回去。隔天早上，她會聽到家人的回覆。",
    parentQuestion: "今天早上，菜園長得怎麼樣？",
    parentAnswer: "番茄終於紅了。吃早餐前，我摘了三顆，放在窗台上。",
    parentSender: "MIA 傳來的早安問題",
    voiceLabel: "媽媽的語音回答",
    noAudio: "對話為示範內容；不播放錄音。",
    askScreenAlt: "現行 Vela 提問畫面，使用菜園問題作為示範",
    replyScreenAlt: "現行 Vela 回覆畫面，使用示範家庭資料",
    photoPosition: "照片",
  },
} as const;
export function approvedCopy(lang: SiteLang) {
  return COPY[lang];
}
export function approvedDemo(lang: SiteLang) {
  return COPY[lang];
}
function demoData(lang: SiteLang): Html {
  const json = JSON.stringify(approvedDemo(lang)).replace(/</g, "\\u003c");
  return { markup: `<script type="application/json" id="vela-demo">${json}</script>` };
}
export function approvedHome(lang: SiteLang, flash: WaitlistFlash): SitePageContent {
  const c = COPY[lang];
  const home = lang === "en" ? "/" : "/zh-TW";
  const privacy = lang === "en" ? "/website-privacy" : "/zh-TW/website-privacy";
  const pilotPrivacy = lang === "en" ? "/privacy" : "/privacy/zh-TW";
  const precision = lang === "en" ? "/how-vela-is-doing" : "/zh-TW/how-vela-is-doing";
  const otherLang = lang === "en" ? "zh-TW" : "en";
  const otherHome = lang === "en" ? "/zh-TW" : "/";
  const otherLabel = lang === "en" ? "繁體中文" : "English";
  const flashMarkup =
    flash === "joined"
      ? html`<div class="flash ok" role="status">${c.joined}</div>`
      : flash === "email"
        ? html`<div class="flash err" role="alert">${c.badEmail}</div>`
        : null;
  return {
    title: c.title,
    description: c.description,
    body: html`<div class="approved-home">  <a class="skip-link" href="#main">${c.skip}</a>
  <header class="site-header">
    <a class="wordmark" href="${home}" aria-label="Vela"><img src="/site/img/vela-logo.svg" width="126" height="48" alt="Vela"></a>
    <nav aria-label="Main navigation"><a href="#idea">${c.why}</a><a href="#exchange">${c.how}</a><a href="#care">${c.careNav}</a></nav>
    <a href="#join" class="nav-cta" data-waitlist aria-haspopup="dialog" aria-controls="waitlist-dialog">${c.join} <span aria-hidden="true">→</span></a>
  </header>
  <main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <p class="eyebrow">${c.tagline}</p>
      <h1 id="hero-title">${c.heroStart}<span class="hero-parent">${c.heroParent}</span><br>${c.heroSecond}<em>${c.heroEmphasis}</em></h1>
      <p class="hero-description">${c.heroLine1}<br>${c.heroLine2}</p>
      <div class="hero-actions"><a href="#join" class="button button-dark" data-waitlist aria-haspopup="dialog" aria-controls="waitlist-dialog">${c.join} <span aria-hidden="true">→</span></a><a class="hero-how" href="#exchange">${c.seeHow} <span aria-hidden="true">↓</span></a></div>
      <div class="story-gallery" role="region" aria-label="${c.galleryLabel}">
        <div class="story-viewport" tabindex="0" aria-label="${c.galleryKeys}">
          <div class="story-track">
            <div class="story-group">
              <figure class="story-card"><img src="/site/img/story/city-hello.jpg" alt="${c.cityAlt}" width="1024" height="1024"><figcaption><span>01</span>${c.cityCaption}</figcaption></figure>
              <figure class="story-card"><img src="/site/img/story/garden-update.jpg" alt="${c.gardenAlt}" width="1024" height="1024"><figcaption><span>02</span>${c.gardenCaption}</figcaption></figure>
              <figure class="story-card"><img src="/site/img/story/familiar-voice.jpg" alt="${c.voiceAlt}" width="1024" height="1024"><figcaption><span>03</span>${c.voiceCaption}</figcaption></figure>
              <figure class="story-card"><img src="/site/img/story/family-recipe.jpg" alt="${c.recipeAlt}" width="1024" height="1024"><figcaption><span>04</span>${c.recipeCaption}</figcaption></figure>
            </div>
          </div>
        </div>
        <div class="gallery-controls js-only"><button class="gallery-control" id="photo-previous" aria-label="${c.previousPhoto}">←</button><button class="gallery-pause" id="photo-pause" aria-pressed="false">${c.pause} <span aria-hidden="true">Ⅱ</span></button><button class="gallery-control" id="photo-next" aria-label="${c.nextPhoto}">→</button></div>
      </div>
    </section>
    <section class="question-chapter dark-section" id="idea" aria-labelledby="question-title">
      <div class="question-intro"><p class="eyebrow">${c.ideaEyebrow}</p><h2 id="question-title">${c.goBeyond}<br><em>${c.howAreYou}</em></h2><p>${c.specificQuestion}</p></div>
      <div class="question-story"><div class="story-message from-you"><span>${c.youAsk}</span><p>${c.gardenQuestion}</p></div><div class="story-message from-parent"><span>${c.momAnswers}</span><p>${c.gardenAnswer}</p></div><div class="story-message your-reply"><span>${c.youReply}</span><p>${c.saveTwo}</p></div></div>
      <p class="question-payoff">${c.payoffStart}<em>${c.payoffEnd}</em></p>
    </section>
    <section class="exchange-section" id="exchange" aria-labelledby="exchange-title">
      <div class="exchange-layout"><div class="exchange-copy"><p class="eyebrow">${c.howEyebrow}</p><h2 id="exchange-title">${c.oneQuestion}<br>${c.aWhole}<br><em>${c.conversation}</em></h2><p class="section-copy">${c.smallExchange}</p><div class="exchange-controls" role="tablist" aria-orientation="vertical" aria-label="${c.exploreExchange}">
      <button id="tab-0" role="tab" aria-selected="true" aria-controls="exchange-panel" data-step="0" disabled><span class="step-count">01</span><span><b>${c.sendTitle}</b><small>${c.sendDetail}</small></span><span class="step-arrow" aria-hidden="true">→</span></button>
      <button id="tab-1" role="tab" aria-selected="false" aria-controls="exchange-panel" tabindex="-1" data-step="1" disabled><span class="step-count">02</span><span><b>${c.answerTitle}</b><small>${c.answerDetail}</small></span><span class="step-arrow" aria-hidden="true">→</span></button>
      <button id="tab-2" role="tab" aria-selected="false" aria-controls="exchange-panel" tabindex="-1" data-step="2" disabled><span class="step-count">03</span><span><b>${c.replyTitle}</b><small>${c.replyDetail}</small></span><span class="step-arrow" aria-hidden="true">→</span></button>
      </div></div><div class="exchange-stage" id="exchange-panel" role="tabpanel" aria-labelledby="tab-0" tabindex="0"><div class="stage-heading"><span class="stage-step-label" id="stage-step-label">${c.questionLabel}</span><span id="stage-source">${c.appSource}</span></div><div class="app-screen-shell" id="app-screen-shell"><img id="app-screen" src="/site/img/app-current/ask.png" alt="${c.askAlt}" width="390" height="844"><button class="screen-expand js-only" id="screen-expand" aria-haspopup="dialog" aria-controls="screen-dialog" aria-label="${c.enlarge}">${c.viewScreen} <span aria-hidden="true">↗</span></button></div><div class="parent-example" id="parent-example" hidden><div class="parent-example-heading"><img src="/site/img/vela-mark-small.svg" width="22" height="28" alt=""><span>${c.parentGreeting}</span></div><div id="phone-content"></div></div><p class="stage-explanation" id="stage-explanation">${c.initialExplanation}</p><div class="stage-bottom"><span id="stage-caption">${c.youApp}</span><button id="next-step" class="js-only" aria-label="${c.showAnswer}">${c.next} <span aria-hidden="true">→</span></button></div></div></div>
    </section>
    <section class="care-section" id="care" aria-labelledby="care-title"><div class="care-illustration"><img src="/site/img/a-light-at-home.jpg" alt="${c.windowAlt}" loading="lazy"></div><div class="care-copy"><p class="eyebrow">${c.careEyebrow}</p><h2 id="care-title">${c.closeSpace}<br><em>${c.beYourself}</em></h2><div class="care-lines"><details open><summary>${c.everyoneSay}<span aria-hidden="true">+</span></summary><p>${c.choice}</p></details><details><summary>${c.quietTitle}<span aria-hidden="true">+</span></summary><p>${c.quietBody}</p></details><details><summary>${c.dataTitle}<span aria-hidden="true">+</span></summary><p>${c.dataBody}</p><a href="${pilotPrivacy}" target="_blank" rel="noopener">${c.readPrivacy} ↗</a></details></div></div></section>
    <section class="faq-section" aria-labelledby="faq-title"><div><h2 id="faq-title">${c.faqStart}<br><em>${c.faqEnd}</em></h2></div><div class="faq-list"><details><summary>${c.needApp}<span aria-hidden="true">+</span></summary><p>${c.needAppBody}</p></details><details><summary>${c.replaceCalls}<span aria-hidden="true">+</span></summary><p>${c.replaceCallsBody}</p></details><details><summary>${c.afterAnswer}<span aria-hidden="true">+</span></summary><p>${c.afterAnswerBody}</p></details><details><summary>${c.whenTry}<span aria-hidden="true">+</span></summary><p>${c.whenTryBody}</p><a class="text-button" href="#join" data-waitlist>${c.join} →</a></details></div></section>
    <section class="closing-section" id="join" aria-labelledby="closing-title"><img class="closing-mark" src="/site/img/vela-mark-white.svg" width="48" height="60" alt=""><h2 id="closing-title">${c.closeStart}<em>${c.closer}</em><br>${c.everyDay}</h2><p>${c.firstFamilies}</p><form class="waitlist" method="post" action="/waitlist" data-waitlist-form><input type="hidden" name="lang" value="${lang}"><label for="footer-email">${c.yourEmail}</label><div class="waitlist-input-row"><input id="footer-email" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"><button class="button button-cream" type="submit">${c.join} <span aria-hidden="true">→</span></button></div><div class="form-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="waitlist-privacy">${c.updates} <a href="${privacy}">${c.privacy}</a></p><p class="form-status" role="status" aria-live="polite"></p>${flashMarkup}</form></section>
  </main>
  <footer><a class="wordmark" href="${home}" aria-label="Vela"><img src="/site/img/vela-logo.svg" width="126" height="48" alt="Vela"></a><span>${c.footerTagline}</span><div class="footer-links"><a href="${privacy}">${c.privacy}</a><a href="${pilotPrivacy}">${c.productPrivacy}</a><a href="${precision}">${c.serviceStatus}</a>${LEGAL_PAGES.map((page) => html`<a href="${LEGAL_ORIGIN}${legalPath(lang, page)}">${LEGAL_LABELS[lang][page]}</a>`)}<a href="mailto:${SUPPORT_EMAIL}">${c.contact}</a><a href="${otherHome}" hreflang="${otherLang}" lang="${otherLang}">${otherLabel}</a><a href="#main">${c.backToTop}</a></div><p class="prototype-note">${c.disclosure}</p></footer>
  <dialog id="waitlist-dialog" aria-labelledby="waitlist-title"><button class="dialog-close" aria-label="${c.closeWaitlist}">×</button><img src="/site/img/vela-logo.svg" width="126" height="48" alt="Vela"><h2 id="waitlist-title">${c.dialogTitleStart}<br>${c.dialogTitleMiddle}<em>${c.dialogTitleEnd}</em></h2><p>${c.leaveEmail}</p><form class="waitlist" method="post" action="/waitlist" data-waitlist-form><input type="hidden" name="lang" value="${lang}"><label for="dialog-email">${c.yourEmail}</label><div class="waitlist-input-row"><input id="dialog-email" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"><button class="button button-dark" type="submit">${c.join} <span aria-hidden="true">→</span></button></div><div class="form-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="waitlist-privacy">${c.updates} <a href="${privacy}">${c.privacy}</a></p><p class="form-status" role="status" aria-live="polite"></p></form></dialog>
  <dialog id="screen-dialog" class="screen-dialog" aria-labelledby="screen-dialog-title"><div class="screen-dialog-header"><div><p class="eyebrow">${c.screenSource}</p><h2 id="screen-dialog-title">${c.sendTitle}</h2></div><button class="screen-dialog-close" aria-label="${c.closeScreen}">×</button></div><img id="enlarged-screen" src="/site/img/app-current/ask.png" alt="${c.enlargedAlt}" width="390" height="844"></dialog>
${demoData(lang)}</div>`,
  };
}
