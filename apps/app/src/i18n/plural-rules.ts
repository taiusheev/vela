/**
 * Lingui renders a plural through `new Intl.PluralRules(locales, { type })`, and Hermes, the engine
 * on phones, has none: its `doc/IntlAPIs.md` lists Collator, NumberFormat, DateTimeFormat and
 * getCanonicalLocales, not PluralRules (nor Locale or ListFormat). Without it any plural would throw
 * on a phone. The formatjs polyfill and its locale data are a large native bundle for two languages
 * whose rules fit in a line each: English says "one" for exactly one and "other" otherwise, and
 * Chinese has only "other". So this stands in, and only where the engine has no PluralRules of its
 * own; a browser and Node keep theirs.
 *
 * It knows English and Chinese only. Adding ja, de, hi or ru to the app means replacing it with
 * `@formatjs/intl-pluralrules` and its locale data (ADR-30).
 */

type PluralCategory = "one" | "other";

interface PluralOptions {
  type?: string;
}

export class MinimalPluralRules {
  readonly locale: string;
  readonly type: string;

  constructor(locales?: string | readonly string[], options?: PluralOptions) {
    // Lingui passes the active locale with its fallbacks, as a list; the first one decides.
    this.locale = (typeof locales === "string" ? locales : locales?.[0]) ?? "en";
    this.type = options?.type ?? "cardinal";
  }

  private get english(): boolean {
    return this.locale.split("-")[0] === "en";
  }

  select(n: number): PluralCategory {
    // Ordinals ("1st", "2nd") are not used by the app, so they are always "other".
    return this.type === "cardinal" && this.english && Math.abs(n) === 1 ? "one" : "other";
  }

  resolvedOptions(): { locale: string; pluralCategories: string[]; type: string } {
    return {
      locale: this.locale,
      pluralCategories: this.type === "cardinal" && this.english ? ["one", "other"] : ["other"],
      type: this.type,
    };
  }
}

/** Puts the stand-in on `Intl` where the engine has no PluralRules, and does nothing elsewhere. */
export function installPluralRules(): void {
  if (typeof Intl.PluralRules === "function") return;
  Object.defineProperty(Intl, "PluralRules", {
    value: MinimalPluralRules,
    configurable: true,
    writable: true,
  });
}
