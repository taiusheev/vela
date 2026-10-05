import { i18n, type Messages } from "@lingui/core";
import { Platform } from "react-native";
import type { AppLocale } from "./locale.ts";
import { messages as en } from "./locales/en.po";
import { messages as zhTW } from "./locales/zh-TW.po";
import { installPluralRules } from "./plural-rules.ts";

/**
 * The one Lingui instance the whole app reads: `t` from the macros compiles to `i18n._` on it, in
 * screens and in the data hooks alike. Both catalogs load at start; a few hundred short messages
 * each are far smaller than loading them on demand is worth.
 */
installPluralRules();
i18n.load({ en, "zh-TW": zhTW } satisfies Record<AppLocale, Messages>);

if (__DEV__) {
  // A string that reaches the screen with no entry was added without `pnpm i18n:extract`. Said
  // while developing only; a release shows the English quietly, and `pnpm test` fails before that.
  i18n.on("missing", ({ locale, id }) => {
    console.warn(`No ${locale} message for ${id}: run pnpm --filter @vela/app i18n:extract`);
  });
}

/** Switches every word on screen at once; `I18nProvider` re-renders what reads it. */
export function activate(locale: AppLocale): void {
  if (i18n.locale === locale) return;
  i18n.activate(locale);
  if (Platform.OS === "web" && typeof document !== "undefined") {
    // The page's language picks the Traditional glyphs and tells a screen reader what it reads.
    document.documentElement.lang = locale === "zh-TW" ? "zh-Hant-TW" : "en";
  }
}

export { i18n };
