import { z } from "zod";

/** Review-only policy. These documents are not approved public terms or live consent. */
export const PUBLIC_ELIGIBILITY_VERSION = "tw-eligibility-review.v1";
export const PUBLIC_ELIGIBILITY_TERMS_VERSION = "tw-public-terms-review.v1";
export const PUBLIC_ELIGIBILITY_TEXT = {
  en: "Review draft only, not an active notice. The proposed operator is Timur Aiusheev in Taipei, Taiwan; contact t.aiusheev@gmail.com for access, correction, deletion or questions. Vela's proposed Taiwan launch is for adults aged 18 or older who usually live in Taiwan. Answer only for yourself. Your existing name/account reference and your own age/residence declarations, language, document versions, text fingerprints and server timestamps would be used only to check launch scope and remember your choices. Age and residence are self-declared, not verified identity, citizenship, legal capacity or legal clearance. Each other adult makes their own choices. The declaration would be kept with your account or member record in Singapore and handled through Cloudflare internationally; corrections replace the current record, and account/member erasure or a request to clear the declaration removes it. No separate historical eligibility archive is proposed. Clerk handles app authentication; this declaration would not be sent to AI providers or relatives. Without these answers you cannot complete the proposed public signup, but privacy rights, stopping and help remain available. This declaration does not enable family access, messages, AI processing, health features or marketing. Vela is not a medical or emergency service. The current synthetic preview uses fictional answers in memory and records no live agreement.",
  "zh-TW":
    "本文件僅供審閱，尚未生效。規劃中的營運者為位於台灣台北的 Timur Aiusheev。如需查閱、更正、刪除或詢問，請聯絡 t.aiusheev@gmail.com。Vela 規劃中的台灣服務，適用於年滿 18 歲且平常居住在台灣的成年人。請只回答您自己的情況。既有姓名或帳號參照、您自己的年齡與居住地聲明、語言、文件版本、文字指紋及伺服器時間，只會用於檢查服務範圍及記錄您的選擇。年齡與居住地由您自行聲明，不代表已查驗身分、國籍、行為能力或法律適用資格。其他成年人必須各自作出選擇。資料將隨帳號或成員記錄儲存於新加坡，並由 Cloudflare 的跨國基礎設施處理；更正會取代現有記錄，刪除帳號或成員記錄，或要求清除聲明時，會一併清除。不另建歷史資格檔案。Clerk 處理 App 身分驗證；此聲明不會傳送給 AI 服務商或其他親屬。未提供聲明即無法完成規劃中的公開註冊，但仍可行使隱私權、停止使用及尋求協助。這份聲明不會開放家人資料存取、訊息、AI 處理、健康相關功能或行銷。Vela 不是醫療或緊急救援服務。目前模擬預覽只在記憶體中使用虛構回答，不成立正式協議。",
} as const;
export const PUBLIC_ELIGIBILITY_TERMS = {
  en: "Review draft only. You would agree to use Vela for lawful family communication, provide your own accurate eligibility answers, respect other adults' choices, and not use Vela as an emergency or medical service. This draft does not replace the full service terms, privacy notice, or separate feature permissions. No contract or live permission is recorded in this synthetic preview.",
  "zh-TW":
    "僅供審閱的草稿。規劃中的條款包括：合法使用 Vela 與家人聯絡、如實回答您自己的資格問題、尊重其他成年人的選擇，以及不將 Vela 當作醫療或緊急救援服務。本草稿不能取代完整服務條款、隱私權告知事項或個別功能的同意程序。此模擬預覽不會成立契約或記錄正式同意。",
} as const;

export const EligibilityLanguage = z.enum(["en", "zh-TW"]);
export type EligibilityLanguage = z.infer<typeof EligibilityLanguage>;
/** No subject IDs, parent answers, date of birth, citizenship, health fields or client timestamps. */
export const PublicEligibilityChoice = z.strictObject({
  version: z.literal(PUBLIC_ELIGIBILITY_VERSION),
  terms_version: z.literal(PUBLIC_ELIGIBILITY_TERMS_VERSION),
  language: EligibilityLanguage,
  adult_self_declared: z.literal(true),
  residence_self_declared: z.literal("TW"),
  notice_read: z.literal(true),
  review_terms_acknowledged: z.literal(true),
});
export type PublicEligibilityChoice = z.infer<typeof PublicEligibilityChoice>;
export const PublicEligibilityRecord = PublicEligibilityChoice.extend({
  source: z.enum(["app_account", "telegram_self"]),
  actor_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  recorded_at: z.iso.datetime(),
  notice_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  terms_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("review_only"),
});
export type PublicEligibilityRecord = z.infer<typeof PublicEligibilityRecord>;

/** Own-account rights only; these contracts never grant public admission. */
export const PublicEligibilityView = z.strictObject({ record: PublicEligibilityRecord.nullable() });
export const PublicEligibilityClear = z.strictObject({});
export const PublicEligibilityCleared = z.strictObject({ cleared: z.literal(true) });
