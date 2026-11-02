import { z } from "zod";

/** The exact English permission shown and fingerprinted by the testing app. Change its version when meaning changes. */
export const APP_PRIVACY_VERSION = "app-privacy.v1";
export const APP_PRIVACY_TEXT =
  "Vela is a free, invitation-only test run by Timur Aiusheev in Taipei, Taiwan (t.aiusheev@gmail.com). We save your account details and the family setup and messages you choose to provide. OpenAI in the United States processes family text and voice transcripts for summaries, suggestions and weekly reads; Deepgram in the United States processes voice notes into text. OpenAI API data is not used for training by default, but abuse-monitoring logs may keep inputs and outputs for up to 30 days, with safety or legal exceptions. The founder can read family exchanges to operate and review the test. Your parent portrait and optional calling number stay on this device; photos deliberately sent as messages are uploaded. Your parent decides separately whether to join and whether health words may be shared. You cannot agree for another adult. Vela is not a medical or emergency service. You can stop, withdraw consent or request access, correction or deletion by contacting the founder. Read the full privacy notice for recipients, retention and rights. By choosing Agree and continue, you confirm you are an adult authorised to provide this information, accept the service terms, and explicitly permit the AI processing described here for the information you choose to share.";
/**
 * The same permission in Traditional Chinese, for an organiser using the app in Chinese (the privacy
 * notice promises the app shows it "in English or Traditional Chinese"). Same meaning and version as
 * the English; each acceptance records the language shown and the fingerprint of that exact text.
 */
export const APP_PRIVACY_TEXT_ZH_TW =
  "Vela 是一項免費、僅限受邀參加的測試，由台灣台北的 Timur Aiusheev 負責（t.aiusheev@gmail.com）。我們會儲存你的帳號資料，以及你選擇提供的家庭設定和訊息。美國的 OpenAI 會處理家人的文字和語音轉成的文字，用來做摘要、建議和每週小記；美國的 Deepgram 會把語音訊息轉成文字。OpenAI 預設不會用 API 資料訓練模型，但濫用監控紀錄可能保留輸入和輸出最長 30 天，安全或法律上另有規定的除外。創辦人可以閱讀家人之間的往來，以運作和檢視這項測試。你為長輩設定的照片和可選的通話號碼只留在這支手機上；特意當作訊息傳送的照片會上傳。長輩會另外自己決定是否參加，以及是否允許分享關於身體狀況的話。你不能代替另一位成年人同意。Vela 不是醫療或緊急服務。你可以隨時聯絡創辦人，停止使用、撤回同意，或要求查閱、更正或刪除資料。收件者、保存期間和你的權利，請看完整的隱私權告知。按下「同意並繼續」，即表示你確認自己是成年人、有權提供這些資料、接受服務條款，並明確允許上述對你選擇分享的資料所做的 AI 處理。";

/** The permission's text in each language the app shows it in. */
export const APP_PRIVACY_TEXTS = { en: APP_PRIVACY_TEXT, "zh-TW": APP_PRIVACY_TEXT_ZH_TW } as const;
export type AppPrivacyLang = keyof typeof APP_PRIVACY_TEXTS;

export const AppPrivacyAcceptance = z.strictObject({
  version: z.literal(APP_PRIVACY_VERSION),
  ai_processing: z.literal(true),
  terms: z.literal(true),
  /** The language the permission was shown in; absent means English (older apps). */
  lang: z.enum(["en", "zh-TW"]).optional(),
});
export type AppPrivacyAcceptance = z.infer<typeof AppPrivacyAcceptance>;
export const appPrivacyAcceptance = (lang: AppPrivacyLang = "en"): AppPrivacyAcceptance => ({
  version: APP_PRIVACY_VERSION,
  ai_processing: true,
  terms: true,
  ...(lang === "en" ? {} : { lang }),
});

/** The permission's language for an app locale: Traditional Chinese, else English. */
export const privacyLangOf = (locale: string): AppPrivacyLang =>
  locale === "zh-TW" ? "zh-TW" : "en";
