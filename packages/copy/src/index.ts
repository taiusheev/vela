import type { Lang, MVP_LANGS } from "@vela/contracts";
import { en } from "./en.ts";
import { zhTW } from "./zh-TW.ts";

export type MessageKey = keyof typeof en;

type CatalogLang = (typeof MVP_LANGS)[number];

/**
 * One complete catalog per MVP language. Keyed by `MVP_LANGS` from contracts, so adding a language
 * there does not compile until its catalog exists here.
 */
export const catalogs: Record<CatalogLang, Record<MessageKey, string>> = {
  en,
  "zh-TW": zhTW,
};

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function hasCatalog(lang: Lang): lang is CatalogLang {
  // An own-property check, so a language value that happens to name an Object.prototype member
  // (a corrupt row, an unchecked cast) falls back to English instead of reading the prototype.
  return Object.hasOwn(catalogs, lang);
}

/**
 * Renders one message. Languages without a catalog fall back to English. Every `{placeholder}` in
 * the message needs a parameter and every parameter needs a placeholder: a missing value would
 * leave a raw `{name}` in front of a family, and an unused one usually means the wrong key, so both
 * throw rather than render something quietly wrong. Values are inserted literally and are never
 * re-read as placeholders, because they carry family-written text.
 */
export function t(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  const catalog = hasCatalog(lang) ? catalogs[lang] : catalogs.en;
  if (!Object.hasOwn(catalog, key)) {
    throw new Error(`Unknown message key "${key}" (language ${lang})`);
  }
  const template = catalog[key];
  const used = new Set<string>();
  const text = template.replace(PLACEHOLDER, (_placeholder: string, name: string) => {
    used.add(name);
    const value = params !== undefined && Object.hasOwn(params, name) ? params[name] : undefined;
    if (value === undefined) {
      throw new Error(`Message "${key}" (language ${lang}) is missing the parameter "${name}"`);
    }
    return String(value);
  });
  for (const name of Object.keys(params ?? {})) {
    if (!used.has(name)) {
      throw new Error(
        `Message "${key}" (language ${lang}) has no placeholder for the parameter "${name}"`,
      );
    }
  }
  return text;
}
export * from "./ask-bank.ts";
