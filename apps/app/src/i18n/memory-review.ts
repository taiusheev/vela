import { setupI18n } from "@lingui/core";
import { messages as en } from "./locales/memory-review/en.po";
import { messages as zhTW } from "./locales/memory-review/zh-TW.po";

/** Isolated feature-preview catalog. It never activates or overwrites the family's app locale. */
export const reviewI18n = setupI18n({ locale: "en", messages: { en, "zh-TW": zhTW } });
