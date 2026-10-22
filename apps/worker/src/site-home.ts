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
    tagline: "FOR BUSY ADULT CHILDREN. FOR AGING PARENTS.",
    heroStart: "A morning check-in.",
    heroParent: "",
    heroSecond: "A little ",
    heroEmphasis: "peace of mind.",
    heroLine1:
      "Vela checks in with your parent every morning—even when your day gets away from you.",
    heroLine2: "See when they’ve answered. Know when it’s time to reach out.",
    morningEyebrow: "YOUR LIFE GETS BUSIER. YOUR PARENTS GET OLDER.",
    morningTitle: "You care every day. Remembering isn’t always that simple.",
    morningProblem:
      "Work. Children. Your own home. You mean to message your parent, then the day runs away. And later, there’s that thought: have I heard from them today?",
    morningSolution:
      "Vela keeps the morning routine going. A personal message when you’ve prepared one. A hello from Vela when you haven’t.",
    morningSteps: [
      {
        time: "01 / EVERY MORNING",
        title: "A check-in that doesn’t depend on your reminder.",
        body: "At the agreed time, your parent receives a message in their messenger. If the family hasn’t prepared one, Vela supplies the morning hello.",
      },
      {
        time: "02 / WHEN THEY ANSWER",
        title: "A reply you can see, at a glance.",
        body: "Vela shows when your parent answered, with the words or voice note they shared. A small response becomes one less unanswered question in your day.",
      },
      {
        time: "03 / IF IT STAYS QUIET",
        title: "A clear next step for the family.",
        body: "With Vela Light, a missed answer gets one repeat, then a quiet notice after the waiting period. You decide whether to call or ask a nearby contact for help.",
      },
    ],
    morningLimit:
      "An answer means your parent replied. It is not a health assessment. Vela is not an emergency service.",
    latestScreen: "Current Vela Today screen · illustrative family · 22 October",
    latestAlt:
      "Current Vela Today screen showing Mom answered at 8:12 and Dad has not answered yet",
    memoryEyebrow: "MORE VALUE FROM THE MOMENTS THEY SHARE.",
    memoryTitle: "Daily reassurance. A deeper picture over time.",
    memoryBody:
      "The answer is more than a morning response. It can be a story you didn’t know, a plan worth remembering, or something to ask about on your next call.",
    memoryFeatures: [
      {
        label: "MEMORIES",
        title: "Keep the details that make them, them.",
        body: "Revisit the messages, voices, photos and stories your family shares. Conversational memory discovery and permission-based keeping are in development.",
        image: "memories-current.jpg",
        alt: "Current Vela Memories screen with sample family messages and stories",
        status: "Current app preview · example family",
      },
      {
        label: "THE WEEK",
        title: "Catch up on more than the last message.",
        body: "The weekly read brings the week’s shared moments together. We’re developing optional everyday support suggestions grounded in what your parent actually shares.",
        image: "week-current.jpg",
        alt: "Current Vela Week screen with sample morning responses and a weekly read",
        status: "Current weekly read · support suggestions in development",
      },
    ],
    wellbeingNote:
      "The planned suggestions help families choose a thoughtful next step—such as a call, a visit or an offer of practical help. Personalized mental or physical health advice is not available.",
    roleYou: "You use Vela",
    roleParent: "Your parent uses a familiar messenger",
    roleRhythm: "Morning hello, even when you forget",
    exampleLabel: "TRY A CONVERSATION STARTER",
    exampleNote: "Illustrative conversation · choose a question to see the exchange",
    examples: [
      {
        label: "The garden",
        question: "What did the garden look like this morning?",
        answer: "The tomatoes finally turned. I picked three before breakfast.",
        reply: "Save me two for Sunday?",
      },
      {
        label: "A family recipe",
        question: "What’s the secret to your Sunday soup?",
        answer: "Your grandpa always added a little ginger. I still do it his way.",
        reply: "I’m making it tonight. I’ll send you a photo.",
      },
      {
        label: "An old story",
        question: "What do you remember about your first job?",
        answer: "I was so nervous I arrived an hour early. The door was still locked.",
        reply: "I never knew that. What happened next?",
      },
    ],
    seeHow: "Explore the product",
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
    ideaEyebrow: "A CHECK-IN THAT ALSO STARTS A CONVERSATION.",
    goBeyond: "More than",
    howAreYou: "“I’m fine.”",
    specificQuestion:
      "A simple response tells you they answered. A thoughtful question also gives your parent something personal to share, whenever they feel like it.",
    solutionKicker: "ONE SMALL QUESTION CAN OPEN A WHOLE STORY.",
    youAsk: "YOU ASK",
    gardenQuestion: "“What did the garden look like this morning?”",
    momAnswers: "MOM ANSWERS",
    gardenAnswer: "“The tomatoes finally turned. I picked three before breakfast.”",
    youReply: "YOU REPLY",
    saveTwo: "“Save me two for Sunday?”",
    payoffStart: "Something to share. ",
    payoffEnd: "Something to come back to.",
    howEyebrow: "THE PRODUCT, IN THREE STEPS.",
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
    differenceEyebrow: "WHY VELA FEELS DIFFERENT.",
    differenceTitleStart: "More than remembering",
    differenceTitleEnd: "to send a text.",
    differenceLede:
      "A consistent routine, a clear answer state, and a place for the family’s shared moments. That’s the value Vela adds to the conversations you already have.",
    differences: [
      {
        number: "01",
        title: "The morning happens, even on busy days.",
        body: "The daily hello doesn’t rely on someone in the family remembering to write. Vela provides one when no family message is ready.",
      },
      {
        number: "02",
        title: "You can see whether they answered.",
        body: "A timestamped reply is easy to find. With Vela Light, quiet notices help you decide when to follow up.",
      },
      {
        number: "03",
        title: "Their words add up to more.",
        body: "The family’s shared moments live together, ready to revisit. The weekly read helps you catch up when you have time.",
      },
      {
        number: "04",
        title: "Connection without pressure.",
        body: "Families choose the rhythm together, with consent, pauses, and quiet days built in from the start.",
      },
    ],
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
    afterAnswer: "What happens if I forget to write?",
    afterAnswerBody:
      "Vela still sends the morning hello at your parent’s agreed time. When nobody in the family has prepared a message, Vela supplies a question. You can catch up and reply when you have a moment.",
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
    title: "Vela — A morning check-in. A little peace of mind.",
    description:
      "For busy adult children and aging parents. Vela keeps the morning check-in going, even when you forget. See replies, follow up, and keep family moments close.",
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
    tagline: "給生活忙碌的你，也給年歲漸長的爸媽。",
    heroStart: "每天早上，一聲問候。",
    heroParent: "",
    heroSecond: "心裡，",
    heroEmphasis: "多一點安心。",
    heroLine1: "就算忙得忘了傳訊息，Vela 也會每天早上向爸媽問好。",
    heroLine2: "看見爸媽何時回覆，也知道什麼時候該再聯絡看看。",
    morningEyebrow: "你的生活越來越忙，爸媽也漸漸變老。",
    morningTitle: "每天都惦記，卻不一定每天都記得傳訊息。",
    morningProblem:
      "工作、孩子、自己的家。原本想傳訊息給爸媽，一忙卻又過了一天。晚一點才想起：今天有收到爸媽的消息嗎？",
    morningSolution:
      "Vela 把早晨的問候接續下去。有你準備的話，就替你送到；家人沒準備訊息時，Vela 也會送上一聲早安。",
    morningSteps: [
      {
        time: "01 / 每天早上",
        title: "忙得忘記了，問候還是會送到。",
        body: "在約好的時間，爸媽會在熟悉的通訊軟體裡收到訊息。家人還沒準備內容時，Vela 會提供早晨的問候。",
      },
      {
        time: "02 / 收到回覆",
        title: "一眼就能看到爸媽何時回覆。",
        body: "Vela 顯示回覆時間，以及爸媽分享的文字或語音。忙碌之間，也能知道今天已收到消息。",
      },
      {
        time: "03 / 還沒有回覆",
        title: "讓家人知道，下一步可以怎麼做。",
        body: "使用 Vela Light 時，未回覆的訊息會再提醒一次；等候時間過後，家人會收到溫和的通知。由你決定打電話，或請附近的親友幫忙。",
      },
    ],
    morningLimit: "收到回答，只代表爸媽已回覆，不是健康評估。Vela 不是緊急救援服務。",
    latestScreen: "現行 Vela 今日畫面 · 示範家庭 · 10 月 22 日",
    latestAlt: "現行 Vela 今日畫面：媽媽於 8:12 回覆，爸爸尚未回覆",
    memoryEyebrow: "從爸媽分享的日常，得到更多。",
    memoryTitle: "每天多一點安心，也慢慢多了解一點。",
    memoryBody:
      "回答不只是一聲早安，也可能是你沒聽過的故事、值得記住的計畫，或下次通話時想再問問的事。",
    memoryFeatures: [
      {
        label: "回憶",
        title: "記住那些，讓爸媽成為爸媽的小細節。",
        body: "回看家人分享的訊息、聲音、照片和故事。對話回憶的自動發現，以及由本人同意的保存功能，仍在開發中。",
        image: "memories-current.jpg",
        alt: "現行 Vela 回憶畫面，使用示範家庭的訊息與故事",
        status: "現行 App 預覽 · 示範家庭",
      },
      {
        label: "這一週",
        title: "有空時，一起看看這週的日常。",
        body: "每週回顧把分享過的片段整理在一起。我們也正在開發根據爸媽實際分享內容，提供日常支持建議的功能。",
        image: "week-current.jpg",
        alt: "現行 Vela 每週畫面，使用示範家庭的早晨回覆與每週回顧",
        status: "現行每週回顧 · 支持建議開發中",
      },
    ],
    wellbeingNote:
      "規劃中的建議，協助家人選擇貼心的下一步，例如打電話、探望，或主動提供實際幫忙。目前不提供個人化的身心健康建議。",
    roleYou: "你使用 Vela",
    roleParent: "爸媽使用熟悉的通訊軟體",
    roleRhythm: "忘了傳訊息，早安還是會到",
    exampleLabel: "試試不同的開場",
    exampleNote: "對話示意 · 選一個問題，看看交流如何開始",
    examples: [
      {
        label: "菜園的日常",
        question: "今天早上，菜園長得怎麼樣？",
        answer: "番茄終於紅了。吃早餐前，我摘了三顆。",
        reply: "幫我留兩顆，星期天回去拿？",
      },
      {
        label: "家傳的味道",
        question: "星期天那鍋湯，有什麼祕訣？",
        answer: "你阿公都會加一點薑，我到現在還是照他的方式煮。",
        reply: "我今晚也來煮，煮好拍給你看。",
      },
      {
        label: "以前的故事",
        question: "還記得第一天上班的情形嗎？",
        answer: "那天緊張得提早一小時到，連門都還沒開。",
        reply: "我都不知道這件事。後來呢？",
      },
    ],
    seeHow: "看看產品如何運作",
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
    ideaEyebrow: "一聲問候，也能聊成一段對話。",
    goBeyond: "除了「都很好」，",
    howAreYou: "還能多聊一點。",
    specificQuestion:
      "簡單的回答，讓你知道今天已收到消息。用心的問題，也讓爸媽在想分享時，有一個自然的開場。",
    solutionKicker: "一個小問題，就能聊出一段故事。",
    youAsk: "你問",
    gardenQuestion: "「今天早上，菜園長得怎麼樣？」",
    momAnswers: "媽媽回答",
    gardenAnswer: "「番茄終於紅了。吃早餐前，我摘了三顆。」",
    youReply: "你回覆",
    saveTwo: "「幫我留兩顆，星期天回去拿？」",
    payoffStart: "有一點日常可以分享，",
    payoffEnd: "也有一段對話值得期待。",
    howEyebrow: "三個步驟，看看 VELA 如何運作。",
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
    differenceEyebrow: "VELA 有什麼不同。",
    differenceTitleStart: "不只靠你每天記得，",
    differenceTitleEnd: "傳一封訊息。",
    differenceLede:
      "固定的早晨問候、清楚的回覆狀態，以及家人分享日常的地方。讓原本的對話，多一份持續的照應。",
    differences: [
      {
        number: "01",
        title: "就算今天很忙，早安還是會到。",
        body: "每天的問候，不必全靠家人記得準備。沒有預先寫好的訊息時，Vela 也會提供一聲早安。",
      },
      {
        number: "02",
        title: "爸媽回覆了沒有，一眼就清楚。",
        body: "回覆時間很容易找到。使用 Vela Light 時，溫和的通知也能幫你決定何時再聯絡看看。",
      },
      {
        number: "03",
        title: "每天的小片段，累積成更多了解。",
        body: "家人分享的日常放在一起，隨時能回看。每週回顧，讓忙碌的你有空時也能接上這週的故事。",
      },
      {
        number: "04",
        title: "保持聯繫，也保留空間。",
        body: "一家人一起決定節奏。從一開始，就把同意、暫停和安靜的日子放進設計裡。",
      },
    ],
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
    afterAnswer: "如果我忘了準備訊息呢？",
    afterAnswerBody:
      "Vela 還是會在約好的時間送上早安。家人還沒準備內容時，Vela 會提供一個問題。等你有空，再看看爸媽的回答、回覆幾句就好。",
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
    title: "Vela — 每天一聲問候，心裡多一點安心。",
    description:
      "給生活忙碌的你，也給年歲漸長的爸媽。就算忘了傳訊息，Vela 也會接續早晨的問候，讓你看見回覆、適時聯絡，記住家人的日常。",
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
    <nav aria-label="Main navigation"><a href="#difference">${c.why}</a><a href="#exchange">${c.how}</a><a href="#care">${c.careNav}</a></nav>
    <a href="#join" class="nav-cta" data-waitlist aria-haspopup="dialog" aria-controls="waitlist-dialog">${c.join} <span aria-hidden="true">→</span></a>
  </header>
  <main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <p class="eyebrow">${c.tagline}</p>
      <h1 id="hero-title">${c.heroStart}<span class="hero-parent">${c.heroParent}</span><br>${c.heroSecond}<em>${c.heroEmphasis}</em></h1>
      <p class="hero-description">${c.heroLine1}<br>${c.heroLine2}</p>
      <div class="hero-actions"><a href="#join" class="button button-dark" data-waitlist aria-haspopup="dialog" aria-controls="waitlist-dialog">${c.join} <span aria-hidden="true">→</span></a><a class="hero-how" href="#exchange">${c.seeHow} <span aria-hidden="true">↓</span></a></div>
      <ul class="product-facts"><li>${c.roleYou}</li><li>${c.roleParent}</li><li>${c.roleRhythm}</li></ul>
      <figure class="morning-preview"><div class="morning-preview-copy"><img src="/site/img/vela-mark-small.svg" width="32" height="40" alt=""><p class="eyebrow">${lang === "en" ? "A LITTLE REASSURANCE FROM HOME" : "來自家裡的一點安心"}</p><h2>${lang === "en" ? "Mom answered." : "媽媽回覆了。"}<br>${lang === "en" ? "8:12 this morning." : "今天早上 8:12。"}</h2><p>${lang === "en" ? "A real response, a clear time, and a little of the day behind it. Ready when you have a moment." : "一段回答、一個清楚的時間，還有今天的一點日常。有空時，隨時都能看看。"}</p></div><div class="latest-phone"><img src="/site/img/app-current/today-portraits.jpg" alt="${c.latestAlt}" width="390" height="844"></div><figcaption>${c.latestScreen}</figcaption></figure>
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
    <section class="morning-story" id="morning" aria-labelledby="morning-title"><div class="morning-story-heading"><p class="eyebrow">${c.morningEyebrow}</p><h2 id="morning-title">${c.morningTitle}</h2><p>${c.morningProblem}</p><p>${c.morningSolution}</p></div><div class="morning-steps">${c.morningSteps.map((step) => html`<article><span>${step.time}</span><h3>${step.title}</h3><p>${step.body}</p></article>`)}</div><p class="morning-boundary">${c.morningLimit}</p></section>
    <section class="question-chapter dark-section" id="idea" aria-labelledby="question-title">
      <div class="question-intro"><p class="eyebrow">${c.ideaEyebrow}</p><h2 id="question-title">${c.goBeyond}<br><em>${c.howAreYou}</em></h2><p>${c.specificQuestion}</p></div>
      <div class="conversation-picker"><p class="solution-kicker">${c.solutionKicker}</p><div class="starter-choices js-only" role="group" aria-label="${c.exampleLabel}">${c.examples.map((example, index) => html`<button type="button" data-starter="${index}" aria-pressed="${index === 0 ? "true" : "false"}">${example.label}<span aria-hidden="true">↗</span></button>`)}</div><p class="example-disclosure">${c.exampleNote}</p></div><div class="question-story" aria-live="polite" aria-atomic="true"><div class="story-message"><span>${c.youAsk}</span><p id="starter-question">${c.examples[0].question}</p></div><div class="story-message from-parent"><span>${c.momAnswers}</span><p id="starter-answer">${c.examples[0].answer}</p></div><div class="story-message your-reply"><span>${c.youReply}</span><p id="starter-reply">${c.examples[0].reply}</p></div></div>
      <p class="question-payoff">${c.payoffStart}<em>${c.payoffEnd}</em></p>
    </section>
    <section class="exchange-section" id="exchange" aria-labelledby="exchange-title">
      <div class="exchange-layout"><div class="exchange-copy"><p class="eyebrow">${c.howEyebrow}</p><h2 id="exchange-title">${c.oneQuestion}<br>${c.aWhole}<br><em>${c.conversation}</em></h2><p class="section-copy">${c.smallExchange}</p><div class="exchange-controls" role="tablist" aria-orientation="vertical" aria-label="${c.exploreExchange}">
      <button id="tab-0" role="tab" aria-selected="true" aria-controls="exchange-panel" data-step="0" disabled><span class="step-count">01</span><span><b>${c.sendTitle}</b><small>${c.sendDetail}</small></span><span class="step-arrow" aria-hidden="true">→</span></button>
      <button id="tab-1" role="tab" aria-selected="false" aria-controls="exchange-panel" tabindex="-1" data-step="1" disabled><span class="step-count">02</span><span><b>${c.answerTitle}</b><small>${c.answerDetail}</small></span><span class="step-arrow" aria-hidden="true">→</span></button>
      <button id="tab-2" role="tab" aria-selected="false" aria-controls="exchange-panel" tabindex="-1" data-step="2" disabled><span class="step-count">03</span><span><b>${c.replyTitle}</b><small>${c.replyDetail}</small></span><span class="step-arrow" aria-hidden="true">→</span></button>
      </div></div><div class="exchange-stage" id="exchange-panel" role="tabpanel" aria-labelledby="tab-0" tabindex="0"><div class="stage-heading"><span class="stage-step-label" id="stage-step-label">${c.questionLabel}</span><span id="stage-source">${c.appSource}</span></div><div class="app-screen-shell" id="app-screen-shell"><img id="app-screen" src="/site/img/app-current/ask-current.jpg" alt="${c.askAlt}" width="390" height="844"><button class="screen-expand js-only" id="screen-expand" aria-haspopup="dialog" aria-controls="screen-dialog" aria-label="${c.enlarge}">${c.viewScreen} <span aria-hidden="true">↗</span></button></div><div class="parent-example" id="parent-example" hidden><div class="parent-example-heading"><img src="/site/img/vela-mark-small.svg" width="22" height="28" alt=""><span>${c.parentGreeting}</span></div><div id="phone-content"></div></div><p class="stage-explanation" id="stage-explanation">${c.initialExplanation}</p><div class="stage-bottom"><span id="stage-caption">${c.youApp}</span><button id="next-step" class="js-only" aria-label="${c.showAnswer}">${c.next} <span aria-hidden="true">→</span></button></div></div></div>
    </section>
    <section class="memory-story" id="value" aria-labelledby="value-title"><div class="memory-story-heading"><p class="eyebrow">${c.memoryEyebrow}</p><h2 id="value-title">${c.memoryTitle}</h2><p>${c.memoryBody}</p></div><div class="memory-features">${c.memoryFeatures.map((feature) => html`<article><div class="memory-feature-copy"><p class="eyebrow">${feature.label}</p><h3>${feature.title}</h3><p>${feature.body}</p><span class="feature-status">${feature.status}</span></div><div class="latest-phone"><img src="/site/img/app-current/${feature.image}" alt="${feature.alt}" width="390" height="844" loading="lazy"></div></article>`)}</div><p class="morning-boundary">${c.wellbeingNote}</p></section>
    <section class="difference-section" id="difference" aria-labelledby="difference-title"><div class="difference-heading"><p class="eyebrow">${c.differenceEyebrow}</p><h2 id="difference-title">${c.differenceTitleStart}<br><em>${c.differenceTitleEnd}</em></h2><p>${c.differenceLede}</p></div><div class="difference-grid">${c.differences.map((item) => html`<article><span>${item.number}</span><h3>${item.title}</h3><p>${item.body}</p></article>`)}</div></section>
    <section class="care-section" id="care" aria-labelledby="care-title"><div class="care-illustration"><img src="/site/img/a-light-at-home.jpg" alt="${c.windowAlt}" loading="lazy"></div><div class="care-copy"><p class="eyebrow">${c.careEyebrow}</p><h2 id="care-title">${c.closeSpace}<br><em>${c.beYourself}</em></h2><div class="care-lines"><details open><summary>${c.everyoneSay}<span aria-hidden="true">+</span></summary><p>${c.choice}</p></details><details><summary>${c.quietTitle}<span aria-hidden="true">+</span></summary><p>${c.quietBody}</p></details><details><summary>${c.dataTitle}<span aria-hidden="true">+</span></summary><p>${c.dataBody}</p><a href="${pilotPrivacy}" target="_blank" rel="noopener">${c.readPrivacy} ↗</a></details></div></div></section>
    <section class="faq-section" aria-labelledby="faq-title"><div><h2 id="faq-title">${c.faqStart}<br><em>${c.faqEnd}</em></h2></div><div class="faq-list"><details><summary>${c.needApp}<span aria-hidden="true">+</span></summary><p>${c.needAppBody}</p></details><details><summary>${c.replaceCalls}<span aria-hidden="true">+</span></summary><p>${c.replaceCallsBody}</p></details><details><summary>${c.afterAnswer}<span aria-hidden="true">+</span></summary><p>${c.afterAnswerBody}</p></details><details><summary>${c.whenTry}<span aria-hidden="true">+</span></summary><p>${c.whenTryBody}</p><a class="text-button" href="#join" data-waitlist>${c.join} →</a></details></div></section>
    <section class="closing-section" id="join" aria-labelledby="closing-title"><img class="closing-mark" src="/site/img/vela-mark-white.svg" width="48" height="60" alt=""><h2 id="closing-title">${c.closeStart}<em>${c.closer}</em><br>${c.everyDay}</h2><p>${c.firstFamilies}</p><form class="waitlist" method="post" action="/waitlist" data-waitlist-form><input type="hidden" name="lang" value="${lang}"><label for="footer-email">${c.yourEmail}</label><div class="waitlist-input-row"><input id="footer-email" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"><button class="button button-cream" type="submit">${c.join} <span aria-hidden="true">→</span></button></div><div class="form-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="waitlist-privacy">${c.updates} <a href="${privacy}">${c.privacy}</a></p><p class="form-status" role="status" aria-live="polite"></p>${flashMarkup}</form></section>
  </main>
  <footer><a class="wordmark" href="${home}" aria-label="Vela"><img src="/site/img/vela-logo.svg" width="126" height="48" alt="Vela"></a><span>${c.footerTagline}</span><div class="footer-links"><a href="${privacy}">${c.privacy}</a><a href="${pilotPrivacy}">${c.productPrivacy}</a><a href="${precision}">${c.serviceStatus}</a>${LEGAL_PAGES.map((page) => html`<a href="${LEGAL_ORIGIN}${legalPath(lang, page)}">${LEGAL_LABELS[lang][page]}</a>`)}<a href="mailto:${SUPPORT_EMAIL}">${c.contact}</a><a href="${otherHome}" hreflang="${otherLang}" lang="${otherLang}">${otherLabel}</a><a href="#main">${c.backToTop}</a></div><p class="prototype-note">${c.disclosure}</p></footer>
  <dialog id="waitlist-dialog" aria-labelledby="waitlist-title"><button class="dialog-close" aria-label="${c.closeWaitlist}">×</button><img src="/site/img/vela-logo.svg" width="126" height="48" alt="Vela"><h2 id="waitlist-title">${c.dialogTitleStart}<br>${c.dialogTitleMiddle}<em>${c.dialogTitleEnd}</em></h2><p>${c.leaveEmail}</p><form class="waitlist" method="post" action="/waitlist" data-waitlist-form><input type="hidden" name="lang" value="${lang}"><label for="dialog-email">${c.yourEmail}</label><div class="waitlist-input-row"><input id="dialog-email" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"><button class="button button-dark" type="submit">${c.join} <span aria-hidden="true">→</span></button></div><div class="form-trap" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="waitlist-privacy">${c.updates} <a href="${privacy}">${c.privacy}</a></p><p class="form-status" role="status" aria-live="polite"></p></form></dialog>
  <dialog id="screen-dialog" class="screen-dialog" aria-labelledby="screen-dialog-title"><div class="screen-dialog-header"><div><p class="eyebrow">${c.screenSource}</p><h2 id="screen-dialog-title">${c.sendTitle}</h2></div><button class="screen-dialog-close" aria-label="${c.closeScreen}">×</button></div><img id="enlarged-screen" src="/site/img/app-current/ask-current.jpg" alt="${c.enlargedAlt}" width="390" height="844"></dialog>
${demoData(lang)}</div>`,
  };
}
