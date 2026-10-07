/**
 * Vela's public website (launch gate 14): what Vela is, Free and Vela Light, privacy and support,
 * and "How Vela is doing", the monthly precision spec §8 says is published on the website. The
 * pilot Worker serves it next to the privacy notices, so the site needs no second deploy and its
 * numbers come from the same query as the app's (`loadPublicPrecision`).
 *
 * The words follow spec §20 and §9: names, not "the user"; she is never described as monitored,
 * checked on, or tracked. Choices the founder has not made yet are written as bracketed blanks
 * (`[price]`); development and staging show them, production refuses to serve a page that still
 * holds one (`unfilledSiteBlanks`), as the notices do.
 */
import type { PublicPrecision } from "@vela/contracts";
import { type Html, html } from "./html.ts";

export const SITE_LANGS = ["en", "zh-TW"] as const;
export type SiteLang = (typeof SITE_LANGS)[number];

/** Where each page lives, by language. */
export const SITE_PATHS: Readonly<Record<SiteLang, { home: string; precision: string }>> = {
  en: { home: "/", precision: "/how-vela-is-doing" },
  "zh-TW": { home: "/zh-TW", precision: "/zh-TW/how-vela-is-doing" },
};

const PRIVACY_PATHS: Readonly<Record<SiteLang, string>> = {
  en: "/privacy",
  "zh-TW": "/privacy/zh-TW",
};

interface SiteCopy {
  readonly languageName: string;
  readonly title: string;
  readonly tagline: string;
  readonly lede: string;
  readonly how: { readonly heading: string; readonly steps: readonly [string, string][] };
  readonly light: { readonly heading: string; readonly body: readonly string[] };
  readonly plans: {
    readonly heading: string;
    readonly free: {
      readonly name: string;
      readonly price: string;
      readonly items: readonly string[];
    };
    readonly paid: {
      readonly name: string;
      readonly price: string;
      readonly items: readonly string[];
    };
    readonly note: string;
  };
  readonly promises: { readonly heading: string; readonly items: readonly string[] };
  readonly support: {
    readonly heading: string;
    readonly body: string;
    readonly email: string;
    readonly privacy: string;
    readonly precision: string;
  };
  readonly precisionPage: {
    readonly title: string;
    readonly lede: string;
    readonly explain: readonly string[];
    readonly none: (minimum: PublicPrecision["minimum"]) => string;
    readonly floor: (minimum: PublicPrecision["minimum"]) => string;
    readonly columns: {
      readonly month: string;
      readonly notices: string;
      readonly answeredLate: string;
      readonly away: string;
      readonly fineKnown: string;
      readonly trueConcern: string;
      readonly unknown: string;
      readonly open: string;
      readonly precision: string;
      readonly useful: string;
    };
    readonly back: string;
  };
  readonly footer: string;
  readonly month: (month: string) => string;
}

/** The founder's still-open choices, written once so both languages show the same blank. */
const PRICE_BLANK = "[price]";
const SUPPORT_EMAIL_BLANK = "[support email]";

const COPY: Readonly<Record<SiteLang, SiteCopy>> = {
  en: {
    languageName: "English",
    title: "Vela · A little closer, every day",
    tagline: "A little closer, every day.",
    lede: "Daily exchanges for families, near and far. Every morning someone in the family asks Mom one small thing. She answers with one tap or her voice, and tomorrow morning she hears what everyone replied.",
    how: {
      heading: "How it works",
      steps: [
        [
          "Someone asks.",
          "A question, two photos to choose from, a voice note, a story prompt. Every morning's ask has a person's name on it.",
        ],
        [
          "She answers in one gesture.",
          "On LINE or Telegram, the apps she already uses: a tap, a chip, a photo, or a short voice note. Nothing to install, no password.",
        ],
        [
          "The family replies.",
          "Her answer goes to the family's chat and app. Everyone can react and reply, in their own language.",
        ],
        [
          "She hears the replies tomorrow.",
          "Next morning's message starts with what the family said. She never has to scroll a feed.",
        ],
      ],
    },
    light: {
      heading: "The light",
      body: [
        "When she answers, her light is on, and the family sees it. It comes from a real exchange, not from a check.",
        "With Vela Light, if a morning goes quiet, Vela sends the ask once more. If it stays quiet, the family organiser gets a quiet note with the facts and the people nearby, so they can call. Vela never contacts anyone else by itself: every message to a neighbour or friend is sent by a person's tap.",
      ],
    },
    plans: {
      heading: "Free, and Vela Light",
      free: {
        name: "Free, for ever",
        price: "0",
        items: [
          "Asks, answers and replies, every day",
          "Translation between the family's languages",
          "Story day and the family's archive in the app",
          "Her light, shown as “answered today”",
        ],
      },
      paid: {
        name: "Vela Light",
        price: `${PRICE_BLANK} per parent, after a 30-day trial with no card`,
        items: [
          "A quiet note to the organiser if a morning stays unanswered",
          "Nearby people, one tap away, and “Ask them to look in”",
          "Away mode for trips and visits",
          "The weekly read: how the week went, in a few lines",
        ],
      },
      note: "If Vela Light ends, the daily exchange carries on. Nobody is cut off from their family.",
    },
    promises: {
      heading: "What we promise",
      items: [
        "Nothing starts until she says yes herself, and she can say stop at any time.",
        "She can always ask what the family sees about her.",
        "Her health words are passed on only if she said yes to that separately.",
        "One message a day. No streaks, no badges, no guilt about a missed morning.",
      ],
    },
    support: {
      heading: "Help and privacy",
      body: "Questions, a problem, or a family that wants to stop: write to us and a person answers.",
      email: SUPPORT_EMAIL_BLANK,
      privacy: "Privacy notice",
      precision: "How Vela is doing",
    },
    precisionPage: {
      title: "How Vela is doing",
      lede: "Every quiet note Vela sends ends with what really happened. We publish the count each month, across every family, so you can judge how often a note means something was wrong.",
      explain: [
        "A quiet note is sent only when a morning stays unanswered after one repeat. Most end as “answered late” or “away”: that is expected, and it is why the note states facts and never sounds an alarm.",
        "Precision is the share of notes where the organiser confirmed something was wrong.",
      ],
      none: (minimum) =>
        `No month is published yet. A month appears here once it has ended and holds at least ${minimum.notices} quiet notes from at least ${minimum.families} families, so no one family's morning can be read out of the numbers.`,
      floor: (minimum) =>
        `Months with fewer than ${minimum.notices} quiet notes, or notes from fewer than ${minimum.families} families, are left out so no one family's morning can be read out of the numbers.`,
      columns: {
        month: "Month",
        notices: "Quiet notes",
        answeredLate: "Answered late",
        away: "Away",
        fineKnown: "Family knew why",
        trueConcern: "Something was wrong",
        unknown: "Unknown",
        open: "Still open",
        precision: "Precision",
        useful: "Found useful",
      },
      back: "Back to Vela",
    },
    footer: "Vela is run by Timur Aiusheev.",
    month: (month) =>
      new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
  },
  "zh-TW": {
    languageName: "繁體中文",
    title: "Vela · 每天，更靠近一點",
    tagline: "每天，更靠近一點。",
    lede: "給遠近家人的每日交流。每天早上，家裡有人問媽媽一件小事。她點一下或說一句話就能回答，隔天早上就會聽到大家的回覆。",
    how: {
      heading: "怎麼運作",
      steps: [
        [
          "有人提問。",
          "一個問題、兩張照片選一張、一段語音、一個故事題目。每天早上的提問都署著家人的名字。",
        ],
        [
          "她用一個動作回答。",
          "就在她已經在用的 LINE 或 Telegram 上：點一下、選一個選項、選一張照片，或錄一小段語音。不用安裝，也不用密碼。",
        ],
        ["家人回覆。", "她的回答會出現在家人的群組和 App 裡。每個人都能用自己的語言回應。"],
        ["她隔天聽到回覆。", "隔天早上的訊息會先告訴她家人說了什麼。她不需要滑任何動態。"],
      ],
    },
    light: {
      heading: "那盞燈",
      body: [
        "她一回答，她的燈就亮了，家人看得到。燈來自一次真正的交流，而不是一次查勤。",
        "有了 Vela Light，如果某天早上沒有回音，Vela 會再傳一次提問。如果仍然安靜，家庭的發起人會收到一則安靜通知，附上事實和附近的人，方便打電話。Vela 從不自行聯絡任何其他人：每一則給鄰居或朋友的訊息，都是由家人親手按下送出的。",
      ],
    },
    plans: {
      heading: "免費，以及 Vela Light",
      free: {
        name: "永久免費",
        price: "0",
        items: [
          "每天的提問、回答和回覆",
          "家人之間不同語言的翻譯",
          "故事日和 App 裡的家庭紀錄",
          "她的燈，顯示為「今天已回答」",
        ],
      },
      paid: {
        name: "Vela Light",
        price: `每位長輩 ${PRICE_BLANK}，先免費試用 30 天，不需信用卡`,
        items: [
          "早上一直沒有回音時，發起人會收到安靜通知",
          "附近的人一鍵可聯絡，還有「請他們去看看」",
          "旅行或探親時的外出模式",
          "每週回顧：用幾句話說說這一週",
        ],
      },
      note: "即使 Vela Light 停止，每天的交流仍會繼續。沒有人會和家人斷了聯繫。",
    },
    promises: {
      heading: "我們的承諾",
      items: [
        "她本人說好之前，什麼都不會開始；她隨時都可以說停。",
        "她隨時都可以問家人看到了關於她的什麼。",
        "只有她另外同意，她提到的健康狀況才會轉告家人。",
        "一天一則訊息。沒有連續紀錄、沒有徽章，錯過一天也不會被責怪。",
      ],
    },
    support: {
      heading: "協助與隱私",
      body: "有問題、遇到狀況，或家人想要停止：寫信給我們，會有真人回覆。",
      email: SUPPORT_EMAIL_BLANK,
      privacy: "隱私權告知事項",
      precision: "Vela 的表現",
    },
    precisionPage: {
      title: "Vela 的表現",
      lede: "Vela 發出的每一則安靜通知，最後都會記錄實際發生了什麼。我們每個月公布所有家庭的統計，讓您判斷一則通知有多常代表真的出了事。",
      explain: [
        "只有在早上重傳一次後仍沒有回音，才會發出安靜通知。大多數最後是「晚一點回答了」或「外出」：這是正常的，所以通知只陳述事實，不會發出警報。",
        "準確率是發起人確認真的出了事的通知所佔的比例。",
      ],
      none: (minimum) =>
        `目前還沒有公布任何月份。一個月份要結束後，且至少有 ${minimum.families} 個家庭的 ${minimum.notices} 則安靜通知，才會出現在這裡，這樣任何一個家庭的早晨都無法從數字中被看出來。`,
      floor: (minimum) =>
        `安靜通知少於 ${minimum.notices} 則，或來自少於 ${minimum.families} 個家庭的月份不會列出，這樣任何一個家庭的早晨都無法從數字中被看出來。`,
      columns: {
        month: "月份",
        notices: "安靜通知",
        answeredLate: "晚一點回答",
        away: "外出",
        fineKnown: "家人知道原因",
        trueConcern: "真的出了事",
        unknown: "不清楚",
        open: "尚未結束",
        precision: "準確率",
        useful: "覺得有幫助",
      },
      back: "回到 Vela",
    },
    footer: "Vela 由 Timur Aiusheev 經營。",
    month: (month) => {
      const [year, number] = month.split("-");
      return `${year} 年 ${Number(number)} 月`;
    },
  },
};

const BLANK = /\[[^[\]]+\]/g;

/** The bracketed blanks still in a language's copy; production serves no page while any remain. */
export function unfilledSiteBlanks(lang: SiteLang): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") for (const blank of value.match(BLANK) ?? []) found.add(blank);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(visit);
  };
  visit(COPY[lang]);
  return [...found];
}

function languageSwitch(lang: SiteLang, page: "home" | "precision"): Html {
  return html`<nav class="langs" aria-label="Language">${SITE_LANGS.map((other) =>
    other === lang
      ? html`<span aria-current="true">${COPY[other].languageName}</span>`
      : html`<a href="${SITE_PATHS[other][page]}" hreflang="${other}" lang="${other}">${COPY[other].languageName}</a>`,
  )}</nav>`;
}

/** The emblem: the window, its light on. Decorative; the name beside it carries the meaning. */
const MARK = html`<svg class="mark" viewBox="-16 -16 132 164" aria-hidden="true" focusable="false"><path d="M34 8H66A26 26 0 0 1 92 34V118A6 6 0 0 1 86 124H14A6 6 0 0 1 8 118V34A26 26 0 0 1 34 8Z" fill="#E9A23B"/><path fill-rule="evenodd" d="M34 -8H66A42 42 0 0 1 108 34V118A22 22 0 0 1 86 140H14A22 22 0 0 1 -8 118V34A42 42 0 0 1 34 -8ZM34 8H66A26 26 0 0 1 92 34V118A6 6 0 0 1 86 124H14A6 6 0 0 1 8 118V34A26 26 0 0 1 34 8Z" fill="currentColor"/></svg>`;

function header(lang: SiteLang, page: "home" | "precision"): Html {
  return html`<header><a class="brand" href="${SITE_PATHS[lang].home}">${MARK}<span>Vela</span></a>${languageSwitch(lang, page)}</header>`;
}

function footer(lang: SiteLang): Html {
  const copy = COPY[lang];
  return html`<footer><p>${copy.footer}</p><p><a href="${PRIVACY_PATHS[lang]}">${copy.support.privacy}</a> · <a href="${SITE_PATHS[lang].precision}">${copy.support.precision}</a></p></footer>`;
}

function emailLink(address: string): Html {
  return address.startsWith("[")
    ? html`<span class="blank">${address}</span>`
    : html`<a href="mailto:${address}">${address}</a>`;
}

/** The home page's body. */
export function siteHome(lang: SiteLang): { title: string; body: Html } {
  const copy = COPY[lang];
  const plan = (p: SiteCopy["plans"]["free"], paid: boolean) =>
    html`<div class="plan${paid ? " paid" : ""}"><h3>${p.name}</h3><p class="price">${p.price}</p><ul>${p.items.map(
      (item) => html`<li>${item}</li>`,
    )}</ul></div>`;
  return {
    title: copy.title,
    body: html`${header(lang, "home")}
<section class="hero"><h1>${copy.tagline}</h1><p class="lede">${copy.lede}</p></section>
<section><h2>${copy.how.heading}</h2><ol class="steps">${copy.how.steps.map(
      ([step, detail]) => html`<li><strong>${step}</strong> ${detail}</li>`,
    )}</ol></section>
<section><h2>${copy.light.heading}</h2>${copy.light.body.map((p) => html`<p>${p}</p>`)}</section>
<section><h2>${copy.plans.heading}</h2><div class="plans">${plan(copy.plans.free, false)}${plan(copy.plans.paid, true)}</div><p>${copy.plans.note}</p></section>
<section><h2>${copy.promises.heading}</h2><ul>${copy.promises.items.map((item) => html`<li>${item}</li>`)}</ul></section>
<section id="support"><h2>${copy.support.heading}</h2><p>${copy.support.body}</p><p class="email">${emailLink(copy.support.email)}</p></section>
${footer(lang)}`,
  };
}

/** A share of notices as a whole percentage, or a dash for a month with none settled. */
function percent(part: number, whole: number): string {
  return whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`;
}

/** The precision page's body: every published month, newest first. */
export function sitePrecision(
  lang: SiteLang,
  precision: PublicPrecision,
): { title: string; body: Html } {
  const copy = COPY[lang].precisionPage;
  const c = copy.columns;
  const table =
    precision.months.length === 0
      ? html`<p class="empty">${copy.none(precision.minimum)}</p>`
      : html`<div class="scroll"><table><thead><tr><th scope="col">${c.month}</th><th scope="col">${c.notices}</th><th scope="col">${c.answeredLate}</th><th scope="col">${c.away}</th><th scope="col">${c.fineKnown}</th><th scope="col">${c.trueConcern}</th><th scope="col">${c.unknown}</th><th scope="col">${c.open}</th><th scope="col">${c.precision}</th><th scope="col">${c.useful}</th></tr></thead><tbody>${precision.months.map(
          (m) =>
            html`<tr><th scope="row">${COPY[lang].month(m.month)}</th><td>${m.notices}</td><td>${m.outcomes.answered_late}</td><td>${m.outcomes.away}</td><td>${m.outcomes.fine_known}</td><td>${m.outcomes.true_concern}</td><td>${m.outcomes.unknown}</td><td>${m.open}</td><td>${percent(m.outcomes.true_concern, m.notices)}</td><td>${percent(m.useful.yes, m.useful.yes + m.useful.no)}</td></tr>`,
        )}</tbody></table></div><p class="small">${copy.floor(precision.minimum)}</p>`;
  return {
    title: `${copy.title} · Vela`,
    body: html`${header(lang, "precision")}
<section class="hero"><h1>${copy.title}</h1><p class="lede">${copy.lede}</p></section>
<section>${copy.explain.map((p) => html`<p>${p}</p>`)}${table}</section>
<p><a href="${SITE_PATHS[lang].home}">${copy.back}</a></p>
${footer(lang)}`,
  };
}
