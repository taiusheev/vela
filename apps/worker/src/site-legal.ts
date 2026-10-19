/** Public legal information for the free pilot; no certification or legal-clearance claims. */

import type { SiteLang } from "./site.ts";
import type { PrivacySection } from "./site-privacy.ts";
export const LEGAL_PAGES = ["terms", "security", "data-rights"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];
export const LEGAL_LABELS: Record<SiteLang, Record<LegalPage, string>> = {
  en: { terms: "Service terms", security: "Security", "data-rights": "Your data and deletion" },
  "zh-TW": { terms: "服務條款", security: "安全性", "data-rights": "資料權利與刪除" },
};
export const legalPath = (lang: SiteLang, page: LegalPage): string =>
  `${lang === "en" ? "" : "/zh-TW"}/${page}`;
interface LegalCopy {
  lede: string;
  sections: readonly PrivacySection[];
}
const EMAIL = "t.aiusheev@gmail.com";
export const LEGAL_COPY: Record<SiteLang, Record<LegalPage, LegalCopy>> = {
  en: {
    terms: {
      lede: "Terms for the Vela website and its free, invitation-only family pilot. Updated 19 October 2026 · service-terms.v1.",
      sections: [
        {
          heading: "Who provides Vela",
          paragraphs: [
            `Vela is operated by Timur Aiusheev, a private individual in Taipei, Taiwan. There is no company yet. Contact ${EMAIL} with questions or concerns. These terms cover use of the website and pilot; joining the waitlist does not enrol anyone in the pilot.`,
          ],
        },
        {
          heading: "Joining and leaving",
          paragraphs: [
            "Vela is still being tested. Preparation is focused on Taiwan first; the current pilot remains free, invitation-only and in English. Joining requires the founder’s eligibility review; an app or invitation does not mean a country or family has been approved. There are no charges, payment details, automatic subscriptions or paid renewals. Any future paid service would need its price and terms shown before you choose it.",
            "An organiser must be an adult and authorised to share the information they provide. Explain Vela before inviting someone and respect their decision. An organiser cannot consent on another adult’s behalf. Children do not create independent pilot accounts; an adult supervises anything a child contributes from their phone. Anyone may leave or ask to stop at any time.",
          ],
        },
        {
          heading: "Your messages and choices",
          paragraphs: [
            "You keep your rights in your content. You permit Vela to process and deliver it only to provide the service described in the privacy notice, for the periods stated there. This does not authorise sale or advertising use of your content. Share only material you have permission to share.",
            "The pilot notice explains the recipients, AI providers, retention and choices. These terms do not replace each person’s service consent or the separate health-words choice. The founder can read family messages to operate and review the pilot, as the notice explains.",
          ],
        },
        {
          heading: "AI and human judgement",
          paragraphs: [
            "Vela uses OpenAI for language processing and suggestions, and Deepgram for voice-to-text. AI can mishear, omit details or produce incorrect text. Review drafts and contact the person when something matters. If you choose automatic questions in your name, the recipient sees your name; the family app marks those questions as written by Vela. You can turn that choice off.",
          ],
        },
        {
          heading: "Not an emergency or medical service",
          paragraphs: [
            "Vela cannot monitor anyone’s safety, diagnose a condition or send help. A missing answer does not establish that someone is in danger or safe. Messages and notices may be delayed or fail. Contact the person directly when concerned; in an emergency call the emergency service where they are.",
          ],
        },
        {
          heading: "Respectful use and reporting",
          paragraphs: [
            `Do not use Vela for harassment, coercive monitoring, impersonation, unlawful content, spam or attempts to access another family’s information. Report harmful content, unwanted contact or security problems to ${EMAIL}. Do not publish private messages or invitation links. The founder may restrict misuse or end access to protect people, and will explain when practical. Your data rights remain available.`,
          ],
        },
        {
          heading: "Changes and availability",
          paragraphs: [
            "This is an early pilot. Features may change and availability is not guaranteed. We will explain material changes before they apply and obtain fresh consent when required. The privacy notice’s deletion rules apply when the pilot ends. Nothing in these terms removes rights or remedies under applicable law, or excludes responsibility where the law does not permit it.",
          ],
        },
      ],
    },
    security: {
      lede: "How Vela protects family information and how to report a concern. Updated 19 October 2026.",
      sections: [
        {
          heading: "Access and encryption",
          paragraphs: [
            "Signed-in app requests are checked for family membership and role. The founder’s administration tools require separate sign-in protected by Cloudflare Access. The founder can read messages to operate and review the pilot. Vela is not end-to-end encrypted: its servers and named providers process messages.",
            "Vela uses HTTPS. Family content fields are encrypted before database storage; the database and private media storage also use provider-managed encryption at rest. Media access is checked and temporary access links expire. Production and test environments have separate resources and credentials. No service can guarantee perfect security.",
          ],
        },
        {
          heading: "What stays on your phone",
          paragraphs: [
            "The optional parent portrait and calling number stay on the organiser’s device rather than being uploaded as profile data. A photo deliberately sent in an ask or reply is uploaded as a family message. iPhone sign-in credentials use the operating system’s secure storage. Protect shared devices and chat histories with your own screen lock.",
          ],
        },
        {
          heading: "Retention and deletion",
          paragraphs: [
            "The pilot notice gives each category’s retention period. Vela deletion does not remove delivered Telegram messages, screenshots or copies on other people’s devices. Providers may have their own disclosed retention, including AI abuse-monitoring records. See Your data and deletion for request instructions.",
          ],
        },
        {
          heading: "Report a vulnerability",
          paragraphs: [
            `Email ${EMAIL} with the affected page or app version, a description and steps using your own account or synthetic data. Do not include passwords, sign-in codes, invitation tokens or someone else’s messages. Do not access another family, disrupt the service or publish private information to demonstrate an issue. We will review and coordinate a fix. There is no paid bug-bounty programme or guaranteed response time.`,
          ],
        },
        {
          heading: "If information is exposed",
          paragraphs: [
            "We investigate, contain the problem, preserve necessary evidence and notify affected people and authorities when required. If someone else may have your sign-in code or invitation link, stop sharing it and contact the founder. Never send a sign-in code or password to support.",
          ],
        },
      ],
    },
    "data-rights": {
      lede: "Request access, a copy, correction, restriction, withdrawal or deletion, even without signing in. Updated 19 October 2026.",
      sections: [
        {
          heading: "Delete your account in the app",
          paragraphs: [
            "Open You → Settings → Delete account and follow the confirmation. It explains the effect on your family and membership. Removing the app or signing out alone does not delete your account or server records.",
          ],
        },
        {
          heading: "Request without the app",
          paragraphs: [
            `Email ${EMAIL} from your Vela email address with the subject “Vela data request”. Say whether you want account deletion, removal of particular information, a copy, correction or consent withdrawal. If that address is unavailable, explain how you normally use Vela so we can agree a safe verification method. Do not send passwords, sign-in codes, identity-document scans or private family content in your first message.`,
          ],
        },
        {
          heading: "Stop messages",
          paragraphs: [
            "The person receiving morning messages can say “stop” in their Vela chat to pause the light. This is not by itself a request to delete every record. Contact the founder for deletion or to withdraw a particular consent. Declining the separate health-words choice does not end the daily exchange.",
          ],
        },
        {
          heading: "What happens next",
          paragraphs: [
            "We verify that the request concerns your information before disclosing or changing it, using only what is necessary. We respond within 15 days, or explain a lawful extension. Requests are free. If records must remain, we explain which ones, why and for how long; partial deletion is not silently treated as complete.",
          ],
        },
        {
          heading: "What deletion can leave behind",
          paragraphs: [
            "The pilot notice gives the detailed retention periods. Minimal consent and deletion evidence may remain for five years; deleted data can remain in database restore history for up to seven days. Delivered Telegram messages, screenshots and copies others saved are outside Vela’s control. Provider retention is described in the notice. We can explain how to remove portraits and calling numbers from your device.",
          ],
        },
        {
          heading: "Website waitlist",
          paragraphs: [
            `To leave the waitlist, email ${EMAIL} from the address you registered and ask to be removed. No app account is needed. Website browsing and the waitlist have a separate website privacy notice.`,
          ],
        },
      ],
    },
  },
  "zh-TW": {
    terms: {
      lede: "適用於 Vela 網站與免費、邀請制家庭試辦。更新：2026 年 10 月 19 日 · service-terms.v1。",
      sections: [
        {
          heading: "服務提供者",
          paragraphs: [
            `Vela 由居住於台灣台北的 Timur Aiusheev 個人經營，尚未成立公司。問題請寄至 ${EMAIL}。本條款適用於網站與試辦；加入等候名單不代表加入試辦。`,
          ],
        },
        {
          heading: "參加與退出",
          paragraphs: [
            "Vela 仍在測試與準備，優先以台灣為方向，目前免費、採邀請制，且全程使用英文。須由創辦人審查資格；取得 App 或邀請不代表該家庭或國家已獲准。沒有收費、付款資料、自動訂閱或續約；未來付費服務須先說明價格與條款供您選擇。",
            "組織者須成年且有權提供資料，邀請前須說明並尊重本人選擇，不能代另一位成年人同意。兒童不自行建立試辦帳號，透過成人手機提供內容須由成人監督。任何人可隨時停止或退出。",
          ],
        },
        {
          heading: "內容與隱私",
          paragraphs: [
            "您保留內容權利，僅授權 Vela 依告知事項，於指定期間內為提供服務而處理與傳送；不授權出售或用於廣告。請僅分享有權分享的內容。",
            "試辦告知事項說明接收者、AI 供應商、期限與選擇。本條款不取代各人的服務同意或健康內容的另行選擇。創辦人可依告知事項為營運與檢視試辦閱讀家庭訊息。",
          ],
        },
        {
          heading: "AI 與判斷",
          paragraphs: [
            "Vela 使用 OpenAI 處理文字與建議，Deepgram 將語音轉文字。AI 可能誤聽、遺漏或產生錯誤。使用草稿前請確認，重要事項請直接聯絡本人。選擇以您名義自動提問時，接收者會看到您的姓名，家庭 App 會標示由 Vela 撰寫。您可關閉此選項。",
          ],
        },
        {
          heading: "非醫療或緊急服務",
          paragraphs: [
            "Vela 無法監控安全、診斷或派遣救援。沒回答不代表安全或危險。訊息與通知可能延誤或失敗。有疑慮請直接聯絡本人；緊急時請聯絡對方所在地的緊急服務。",
          ],
        },
        {
          heading: "合理使用與通報",
          paragraphs: [
            `請勿騷擾、強迫監控、冒充、傳播違法內容、濫發訊息或存取其他家庭資料。有害內容、不受歡迎的聯絡或安全問題請寄至 ${EMAIL}。請勿公開私密訊息或邀請連結。創辦人可為保護使用者限制濫用或終止存取，並於可行時說明；資料權利仍可行使。`,
          ],
        },
        {
          heading: "變更與可用性",
          paragraphs: [
            "這是早期試辦，功能可能變動，無法保證持續可用。重大變更生效前會說明，依法需要時重新取得同意。結束時依告知事項刪除。本條款不排除法定權利、救濟或依法不得排除的責任。",
          ],
        },
      ],
    },
    security: {
      lede: "Vela 如何保護家庭資料與受理通報。更新：2026 年 10 月 19 日。",
      sections: [
        {
          heading: "存取與加密",
          paragraphs: [
            "App 請求檢查登入身分、家庭資格與角色。管理工具另由 Cloudflare Access 保護。創辦人可為營運與檢視試辦閱讀訊息。Vela 並非端對端加密：伺服器與列出的供應商需要處理訊息。",
            "使用 HTTPS，家庭內容欄位寫入資料庫前加密，資料庫與私人媒體另有供應商的靜態加密。媒體存取須經檢查，臨時連結有期限。正式與測試環境資源與憑證分開。任何服務都不能保證絕對安全。",
          ],
        },
        {
          heading: "留在手機的資料",
          paragraphs: [
            "選用的親人肖像與撥號號碼留在組織者裝置，不作為個人檔案上傳。主動在提問或回覆傳送的照片會上傳為家庭訊息。iPhone 登入憑證使用作業系統安全儲存。共用裝置與聊天紀錄仍需妥善保管與螢幕鎖。",
          ],
        },
        {
          heading: "保存與刪除",
          paragraphs: [
            "各類期限見試辦告知事項。Vela 刪除不會移除已送達 Telegram 的訊息、截圖或他人裝置副本。供應商可能另有揭露的保存規則，包括 AI 濫用監控。請見「資料權利與刪除」。",
          ],
        },
        {
          heading: "通報漏洞",
          paragraphs: [
            `請寄至 ${EMAIL}，提供頁面或 App 版本、說明及以自己帳號或虛構資料重現的步驟。勿附密碼、登入碼、邀請憑證或他人訊息。勿存取其他家庭、干擾服務或公開私密資料來證明問題。我們會檢視並協調修正，目前沒有付費獎勵或保證回覆期限。`,
          ],
        },
        {
          heading: "可能外洩時",
          paragraphs: [
            "我們會調查、控制影響、保留必要證據並依法通知。若登入碼或邀請連結可能外洩，請停止分享並聯絡創辦人。客服不會索取密碼或登入碼。",
          ],
        },
      ],
    },
    "data-rights": {
      lede: "可請求查閱、複製、更正、停止使用、撤回或刪除，無須登入。更新：2026 年 10 月 19 日。",
      sections: [
        {
          heading: "在 App 刪除帳號",
          paragraphs: [
            "開啟 You → Settings → Delete account，依畫面確認對家庭與成員資格的影響。移除 App 或登出不會刪除帳號或伺服器資料。",
          ],
        },
        {
          heading: "不用 App 也能請求",
          paragraphs: [
            `請以 Vela 信箱寄至 ${EMAIL}，主旨「Vela data request」，說明刪除帳號、移除特定資料、取得副本、更正或撤回同意。無法使用原信箱時，請說明平常如何使用，以便安排安全驗證。第一封信勿附密碼、登入碼、證件影本或私人家庭內容。`,
          ],
        },
        {
          heading: "停止訊息",
          paragraphs: [
            "接收早晨訊息的人可在 Vela 聊天輸入「stop」暫停，不代表刪除所有紀錄。刪除或撤回特定同意請聯絡創辦人。不接受健康內容的另行選擇，不會停止每日交流。",
          ],
        },
        {
          heading: "後續處理",
          paragraphs: [
            "披露或變更前以最少必要資料確認本人。15 日內回覆或說明依法延長。請求免費。若須保留，會說明內容、理由與期間，不把部分刪除當作全部完成。",
          ],
        },
        {
          heading: "可能保留什麼",
          paragraphs: [
            "完整期限見試辦告知事項。最少量同意與刪除證據可能保留五年，資料庫還原歷史最多七天。已送達 Telegram 訊息、截圖與他人副本不在 Vela 控制範圍。供應商保存規則見告知事項；我們可協助說明如何移除手機肖像與號碼。",
          ],
        },
        {
          heading: "等候名單",
          paragraphs: [
            `以登記信箱寄至 ${EMAIL} 要求移除，無須 App 帳號。網站與名單另適用網站告知事項。`,
          ],
        },
      ],
    },
  },
};
