/**
 * The website's privacy notice: what the public website and its waitlist collect, written to
 * cover the items Taiwan's Personal Data Protection Act asks a collector to tell people (Art. 8:
 * who collects, the purpose, the kinds of data, how long, where, by whom and how it is used, the
 * person's rights under Art. 3, and what follows from not giving it). The families in the pilot
 * have their own notice (`/privacy`, plan/materials/pilot), which this does not replace.
 *
 * Founder-approved facts only: run by Timur Aiusheev in Taipei, contact t.aiusheev@gmail.com,
 * database in Singapore (Neon), served through Cloudflare. Counsel review of both notices is
 * launch gate 12; change this text with the data map (plan/materials/pilot/data-map.md).
 */
import type { SiteLang } from "./site.ts";

export interface PrivacySection {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly items?: readonly string[];
}

export interface WebsitePrivacy {
  readonly title: string;
  readonly updated: string;
  readonly lede: string;
  readonly sections: readonly PrivacySection[];
  readonly pilotNote: string;
}

const EMAIL = "t.aiusheev@gmail.com";

export const WEBSITE_PRIVACY: Readonly<Record<SiteLang, WebsitePrivacy>> = {
  en: {
    title: "Website privacy notice",
    updated: "Last updated 7 October 2026",
    lede: "This notice covers the Vela website and its waitlist. It explains what we collect when you visit or join, why, for how long, and what you can ask us to do.",
    sections: [
      {
        heading: "Who we are",
        paragraphs: [
          `Vela is run by Timur Aiusheev, in Taipei, Taiwan. For anything about your data, write to ${EMAIL}. A person reads every message.`,
        ],
      },
      {
        heading: "What we collect",
        items: [
          "If you join the waitlist: your email address, the language of the page you used, and, if you chose one, who you would set Vela up for.",
          "When you visit any page: your device sends the usual technical details (such as its internet address and browser type) to our hosting provider, Cloudflare, to deliver the page and protect it from abuse. We do not store them with your email, and we do not use them to identify you.",
          "We do not use cookies, analytics, advertising or tracking tools, and we do not buy or receive data about you from anyone else. Cloudflare may set a strictly necessary security cookie on your device if it sees traffic that looks automated; it is not used for anything else.",
        ],
      },
      {
        heading: "Why we use it",
        paragraphs: [
          "Only to write to you when Vela opens for families, and to answer you if you write to us. We will not send you newsletters or marketing beyond that, and we never sell or share your address.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "Your email stays on the waitlist until we have written to say Vela is open, or until you ask us to remove it, whichever comes first. We then delete it.",
        ],
      },
      {
        heading: "Where it is kept and who handles it",
        paragraphs: [
          "The waitlist is stored in a database run for us by Neon, in Singapore. Pages are delivered by Cloudflare, whose network spans many countries. Both act only on our instructions. Nobody else receives your data.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          `You can ask to see what we hold about you, get a copy, correct it, stop us using it, or have it deleted. Write to ${EMAIL} from the address in question. We answer within 15 days. You can also complain to the data protection authority where you live.`,
        ],
      },
      {
        heading: "If you do not give your email",
        paragraphs: [
          "Joining is entirely your choice. Without an email we simply cannot tell you when Vela opens; everything else on the website works the same.",
        ],
      },
      {
        heading: "Security",
        paragraphs: [
          "Every page is sent over an encrypted connection. The waitlist can be read only by Vela's founder, behind a separate sign-in. We keep what we collect to the minimum above.",
        ],
      },
      {
        heading: "Pictures",
        paragraphs: [
          "Photographs on this website are illustrative scenes created for Vela, not Vela families, and no story or message shown is from a real family.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "If we change this notice we will update the date above. If a change affects what we do with your email, we will tell you before it applies.",
        ],
      },
    ],
    pilotNote: "Families taking part in the Vela pilot have their own, fuller notice:",
  },
  "zh-TW": {
    title: "網站隱私權告知事項",
    updated: "最後更新：2026 年 10 月 7 日",
    lede: "本告知事項適用於 Vela 網站及其等候名單，說明您瀏覽或加入時我們蒐集哪些資料、為什麼、保存多久，以及您可以要求我們做什麼。",
    sections: [
      {
        heading: "我們是誰",
        paragraphs: [
          `Vela 由 Timur Aiusheev 在台灣台北經營。任何關於您個人資料的事，請寫信到 ${EMAIL}，每封信都會由真人閱讀。`,
        ],
      },
      {
        heading: "我們蒐集什麼",
        items: [
          "如果您加入等候名單：您的電子郵件地址、您使用的網頁語言，以及（如果您有選擇）您想為誰設定 Vela。",
          "瀏覽任何網頁時：您的裝置會將一般技術資訊（例如網際網路位址和瀏覽器類型）傳送給我們的主機服務 Cloudflare，用來傳送網頁並防止濫用。我們不會將這些資訊與您的電子郵件一起保存，也不會用來識別您。",
          "我們不使用 Cookie、分析、廣告或追蹤工具，也不會向任何人購買或取得關於您的資料。若 Cloudflare 偵測到疑似自動化的流量，可能會在您的裝置設定一個安全所必需的 Cookie，僅用於此目的。",
        ],
      },
      {
        heading: "使用目的",
        paragraphs: [
          "僅用於在 Vela 對家庭開放時寫信通知您，以及在您來信時回覆您。除此之外，我們不會寄送電子報或行銷訊息，也絕不出售或分享您的電子郵件。",
        ],
      },
      {
        heading: "保存期間",
        paragraphs: [
          "您的電子郵件會保留在等候名單上，直到我們寫信通知您 Vela 已開放，或您要求移除為止（以先發生者為準），之後即予刪除。",
        ],
      },
      {
        heading: "保存地點與處理者",
        paragraphs: [
          "等候名單儲存在由 Neon 為我們營運、位於新加坡的資料庫。網頁由 Cloudflare 傳送，其網路遍及許多國家。兩者都只依我們的指示處理資料，沒有其他人會取得您的資料。",
        ],
      },
      {
        heading: "您的權利",
        paragraphs: [
          `依個人資料保護法第 3 條，您可以請求查詢或閱覽、製給複製本、補充或更正、停止蒐集、處理或利用，或刪除您的資料。請用該電子郵件地址寫信到 ${EMAIL}，我們會在 15 日內回覆。您也可以向您所在地的個人資料保護主管機關申訴。`,
        ],
      },
      {
        heading: "不提供電子郵件的影響",
        paragraphs: [
          "是否加入完全由您決定。沒有電子郵件，我們就無法在 Vela 開放時通知您；網站的其他功能都不受影響。",
        ],
      },
      {
        heading: "安全",
        paragraphs: [
          "每個網頁都透過加密連線傳送。等候名單只有 Vela 的創辦人能透過另外的登入查看。我們只蒐集上述最少的資料。",
        ],
      },
      {
        heading: "圖片",
        paragraphs: [
          "本網站的照片為替 Vela 製作的示意情境，並非 Vela 的使用家庭，所示的故事或訊息也都不是來自真實家庭。",
        ],
      },
      {
        heading: "變更",
        paragraphs: [
          "如果我們修改本告知事項，會更新上方的日期。如果變更會影響我們如何使用您的電子郵件，會在生效前先通知您。",
        ],
      },
    ],
    pilotNote: "參與 Vela 試辦計畫的家庭，另有一份更完整的告知事項：",
  },
};
