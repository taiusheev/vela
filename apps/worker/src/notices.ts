/**
 * The privacy notices the pilot Worker serves (H4): the founder's Markdown in
 * `plan/materials/pilot`, turned into HTML by `scripts/generate-notices.ts` and committed as
 * `notices.generated.ts`. Families open these pages from Vela's first group message and from the
 * bot's privacy policy link, so a notice that still holds a blank must never be served outside
 * development (`config.ts` refuses it).
 *
 * This module imports nothing, so the generator script and `vitest.config.ts`, which run under
 * Node, can read the file names from it without loading the Worker.
 */

/** The languages a notice is written in; every other language links the English one. */
export const NOTICE_LANGS = ["en", "zh-TW"] as const;
export type NoticeLang = (typeof NOTICE_LANGS)[number];

/** Where the notices live, from the repository root. */
export const NOTICE_DIRECTORY = "plan/materials/pilot";

/**
 * Each notice's source file. The name is also the `code` of the `ConfigError` that refuses an
 * unfilled notice, so the log line names the file to fill in (`ConfigError:privacy-notice.en.md`).
 */
export const NOTICE_FILES: Readonly<Record<NoticeLang, string>> = {
  en: "privacy-notice.en.md",
  "zh-TW": "privacy-notice.zh-TW.md",
};

/**
 * Where the pilot Worker serves each notice. `PRIVACY_NOTICE_URL_EN` and `_ZH_TW` are the pilot
 * origin plus these paths (`wrangler-config.test.ts` holds the two together).
 */
export const NOTICE_PATHS: Readonly<Record<NoticeLang, string>> = {
  en: "/privacy",
  "zh-TW": "/privacy/zh-TW",
};

/** One notice, as the generator wrote it. */
export interface PrivacyNotice {
  /** The notice's `#` heading as plain text, for the page's `<title>`. */
  readonly title: string;
  /** The notice as HTML, every character of the Markdown's text already escaped. */
  readonly html: string;
}

export type PrivacyNotices = Readonly<Record<NoticeLang, PrivacyNotice>>;

const BRACKETED = /\[([^[\]]+)\]/g;

/**
 * Bracketed words that are the notice's own text, not blanks: both notices quote the message an
 * organiser receives when she pauses, and write her name in it as `[Name]` and `[名字]`. Anything
 * else in brackets is treated as a blank, so a new bracket fails closed: the Worker refuses to
 * start until it is filled in or added here.
 */
const QUOTED_COPY: ReadonlySet<string> = new Set(["Name", "名字"]);

/**
 * The blanks still in a notice's HTML, such as `FOUNDER FULL NAME`. Links are already anchors in
 * the HTML, so every bracket left is one the Markdown wrote as text.
 */
export function unfilledPlaceholders(html: string): string[] {
  return [...html.matchAll(BRACKETED)]
    .map((match) => match[1] ?? "")
    .filter((text) => !QUOTED_COPY.has(text));
}
