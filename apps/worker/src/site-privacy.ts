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
    updated: "Last updated 30 October 2026 · website-usage.v3",
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
          "If you join the adult waitlist: your email address, the language of the page you used, and, if you chose one, who you would set Vela up for. The waitlist is for people aged 18 or older; do not submit a child’s email address.",
          "When you visit any page: your device sends the usual technical details (such as its internet address and browser type) to our hosting provider, Cloudflare, to deliver the page and protect it from abuse. We do not store them with your email, and we do not use them to identify you.",
          "Optional usage counts are off until you choose Allow counts, when the feature is available. PostHog then receives a random browser identifier, page language, fixed section names, active viewing time, action counts and a broad campaign category. We do not send form contents, email addresses, full URLs, your IP address or family messages to PostHog. There are no recordings or advertising tools. Cloudflare may set a strictly necessary security cookie to stop abuse.",
          "Your choice, its time, notice version and random identifier are saved in this browser's local storage. The notice version is also included with permitted counts. Use Usage privacy to decline or stop future collection. Turning it off clears the identifier here; it does not delete earlier events. Do Not Track and Global Privacy Control prevent optional usage counts. Counts cover only visitors who opt in, not everyone who visits.",
        ],
      },
      {
        heading: "Why we use it",
        paragraphs: [
          "Your email is used only to write when Vela opens for families and to answer your messages. Optional usage counts help us improve the website and understand which sections lead to signups. We never sell your address or send newsletters beyond the opening note.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "Your email stays on the waitlist until we have written to say Vela is open, or until you ask us to remove it, whichever comes first. We then delete it.",
          "Our free PostHog plan has a 1-year event retention window for reports. This window does not guarantee immediate deletion when it ends; deletion is a separate process. Your browser choice remains until you change it or clear this website's storage. If you request access or deletion of analytics events, contact us before clearing the identifier so we can locate those events.",
        ],
      },
      {
        heading: "Where it is kept and who handles it",
        paragraphs: [
          "The waitlist is stored by Neon in Singapore. Cloudflare delivers pages across its global network. Optional usage events go through Vela to PostHog Cloud in the European Union or United States, as identified in the usage choice. Only the founder sees the usage dashboard. We do not link its random browser identifier to waitlist addresses. These providers may use subprocessors in other countries, including the United States, for delivery, support and security; the selected storage region does not mean all processing occurs only there.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          `You can ask to see what we hold about you, get a copy, correct it, stop us using it, or have it deleted. Write to ${EMAIL} from the address in question. We decide access or copy requests within 15 days, and correction, stopping or deletion requests within 30 days. If the law permits an extension, we explain it in writing. You can also complain to the data protection authority where you live.`,
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
    updated: "最後更新：2026 年 10 月 30 日 · website-usage.v3",
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
          "如果您加入成人等候名單：您的電子郵件地址、您使用的網頁語言，以及（如果您有選擇）您想為誰設定 Vela。等候名單僅供年滿 18 歲者加入，請勿提交兒童的電子郵件地址。",
          "瀏覽任何網頁時：您的裝置會將一般技術資訊（例如網際網路位址和瀏覽器類型）傳送給我們的主機服務 Cloudflare，用來傳送網頁並防止濫用。我們不會將這些資訊與您的電子郵件一起保存，也不會用來識別您。",
          "選用使用統計預設關閉；功能可用時，只有您選擇允許後才會開始。PostHog 會收到隨機瀏覽器識別碼、網頁語言、固定區塊名稱、主動瀏覽時間、操作次數和概略的活動來源分類。我們不會傳送表單內容、電子郵件、完整網址、您的 IP 位址或家庭訊息。沒有錄影或廣告工具。Cloudflare 可能設定防止濫用所必需的安全 Cookie。",
          "您的選擇、選擇時間、告知事項版本和隨機識別碼儲存在此瀏覽器的本機儲存空間。經您允許傳送的統計也會包含告知事項版本。您可透過「使用情況隱私」拒絕或停止之後的蒐集；關閉會清除此處的識別碼，但不會刪除先前的事件。瀏覽器的 Do Not Track 或 Global Privacy Control 會阻止選用的使用統計。統計只涵蓋選擇允許的訪客。",
        ],
      },
      {
        heading: "使用目的",
        paragraphs: [
          "電子郵件僅用於在 Vela 對家庭開放時通知您，以及回覆您的來信。選用使用統計用於改善網站，了解哪些區塊帶來加入名單的操作。我們不會出售您的電子郵件，也不會寄送開放通知以外的電子報。",
        ],
      },
      {
        heading: "保存期間",
        paragraphs: [
          "您的電子郵件會保留在等候名單上，直到我們寫信通知您 Vela 已開放，或您要求移除為止（以先發生者為準），之後即予刪除。",
          "我們使用的 PostHog 免費方案提供 1 年的事件統計查詢期間。這不代表期間結束時資料會立即刪除；刪除須另行處理。瀏覽器內的選擇會保留到您變更或清除此網站的儲存資料為止。如需查閱或刪除統計事件，請在清除識別碼前聯絡我們，以便找到相關事件。",
        ],
      },
      {
        heading: "保存地點與處理者",
        paragraphs: [
          "等候名單由 Neon 儲存在新加坡。Cloudflare 透過全球網路傳送網頁。選用統計經 Vela 傳送至 PostHog Cloud，儲存於選擇畫面所示的歐盟或美國地區。只有創辦人可查看統計儀表板。我們不會將隨機瀏覽器識別碼與名單電子郵件連結。這些服務供應商可能由其他國家（包括美國）的次處理者協助傳送、客服與安全維護；所選儲存地區不代表所有處理都只在該地進行。",
        ],
      },
      {
        heading: "您的權利",
        paragraphs: [
          `依個人資料保護法第 3 條，您可以請求查詢或閱覽、製給複製本、補充或更正、停止蒐集、處理或利用，或刪除您的資料。請用該電子郵件地址寫信到 ${EMAIL}。查詢、閱覽或複製本請求於 15 日內決定；補充、更正、停止或刪除請求於 30 日內決定。依法延長時，我們會以書面說明理由。您也可以向您所在地的個人資料保護主管機關申訴。`,
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
