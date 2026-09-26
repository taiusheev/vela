/**
 * The wording rules every user-facing catalog is held to, the messenger's here and the app's
 * (`apps/app/src/i18n/catalog.test.ts`). One list, so the two cannot drift apart (build plan 3.1).
 */

/** Whole words, including inflections, that frame the product as surveillance (spec §9, §14.4). */
export const SURVEILLANCE_WORDS =
  /\b(monitor(s|ed|ing)?|track(s|ed|ing)?|check(s|ed|ing)? on|keep(s|ing)? an eye)\b/i;

/** The product never assumes the kept-light member's gender (code design §4). */
export const GENDERED_PRONOUNS = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

/**
 * 他 and 她 are the gendered third-person pronouns, except in 其他 ("other"); 監控, 監看, 監視, and
 * 追蹤 mean monitor, watch over, surveil, and track, and 盯著 and 看著您 (keeping an eye on you) are
 * the other surveillance phrases the zh-TW consent script forbids
 * (plan/materials/pilot/consent-script.zh-TW.md).
 */
export const FORBIDDEN_ZH_TW = /(?<!其)他|她|監控|監看|監視|追蹤|盯|看著您/;

/** Simplified-only forms of characters used in everyday copy; Taiwan writes 們這時說發語… */
export const SIMPLIFIED_ONLY =
  /[们这时说发语设问点为会过还没让张选号码间边个来对开关给请谢讯灯应电话联络统与图组暂续听见]/;

/**
 * Mainland vocabulary with a different Taiwanese word: 訊息, 使用者, 設定, 影片, 群組, 預設, 點選,
 * 簡訊, 早安.
 */
export const MAINLAND_TERMS = /信息|用戶|設置|視頻|群聊|默認|點擊|短信|早上好/;

/** A Chinese character directly against a Latin letter or a digit, with no space between. */
export const LATIN_TOUCHING_HAN = /\p{Script=Han}[A-Za-z0-9]|[A-Za-z0-9]\p{Script=Han}/u;

/**
 * Words that turn an ask into a check on how she is: "are you OK", "how have you been", how she
 * feels, her mood, her body, her appetite, sleep, medicine, doctors, being alone, loneliness, worry.
 * A suggested ask is about her life, her knowledge, or her opinions, never a health check: the
 * question bank (`ask-bank.ts`) never uses these words, and a suggestion an AI drafts with one of
 * them is dropped for the bank item it stood on.
 */
export const HEALTH_CHECK: Readonly<Record<"en" | "zh-TW", RegExp>> = {
  en: /\b(are you (ok|okay|alright|all right|well)|how are you|how have you been|feel(s|ing)?|health(y)?|sick|ill|pain|hurts?|doctor|clinic|hospital|medicines?|pills?|sleep|slept|tired|alone|lonely|moods?|appetite|worried)\b/i,
  "zh-TW":
    /還好嗎|好不好|身體|健康|生病|不舒服|痛|醫生|醫院|診所|看病|吃藥|藥|睡|累|孤單|寂寞|擔心|心情|胃口|精神/,
};
