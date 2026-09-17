/**
 * The Markdown the privacy notices are written in, turned into HTML without a dependency (H4).
 * Only what the notices use is understood: `#` headings, paragraphs, `-` and numbered lists,
 * tables, block quotes, `**strong**` and `*emphasis*`, `[links](https://…)`, and `code spans`.
 * Anything else throws with its line number rather than reaching a family as stray symbols, so a
 * notice edit that needs more syntax fails `pnpm --filter @vela/worker notices` and the test that
 * holds the committed module to the Markdown.
 *
 * Every character of text is escaped, so the HTML is safe to serve as it is. Attributes are quoted
 * with `'` and a `"` in text is written `&quot;`, so the module's string literals carry no escaped
 * double quotes, which Biome would otherwise rewrite.
 *
 * Pure string work: the generator runs it under Node, and `src/notices.test.ts` runs it in workerd.
 */
import {
  NOTICE_DIRECTORY,
  NOTICE_FILES,
  NOTICE_LANGS,
  type NoticeLang,
  type PrivacyNotice,
  type PrivacyNotices,
} from "../src/notices.ts";

/** A construct the generator does not understand, at a 1-based line of the source. */
export class UnsupportedMarkdownError extends Error {
  override readonly name = "UnsupportedMarkdownError";

  constructor(line: number, what: string) {
    super(`line ${line}: ${what} is not supported by scripts/notice-markdown.ts`);
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeText(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const HEADING = /^(#{1,6})\s+(.+)$/;
const BULLET = /^-\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const TABLE_ROW = /^\|.*\|\s*$/;
const TABLE_RULE = /^\|(\s*:?-+:?\s*\|)+\s*$/;
/**
 * The starts of lines this generator does not read: indented code or nested lists, fences, raw
 * HTML, thematic rules and setext underlines, and `*` or `+` lists. A paragraph stops before one,
 * so it throws rather than being read as text.
 */
const UNSUPPORTED = /^(\s|```|~~~|<|\*\*\*|---|___|===|\* |\+ )/;
/** An https or mailto target: a notice never links anywhere a family's browser would not go. */
const LINK_TARGET = /^(https:\/\/|mailto:)/;

/** Text between code spans: escaped, then links, strong, and emphasis, in that order. */
function spans(text: string, line: number): string {
  return escapeText(text)
    .replace(/\[([^[\]]+)\]\(([^()\s]+)\)/g, (_match, label: string, target: string) => {
      if (!LINK_TARGET.test(target)) {
        throw new UnsupportedMarkdownError(line, "a link that is not https or mailto");
      }
      return `<a href='${target}'>${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function inline(text: string, line: number): string {
  const parts = text.split("`");
  if (parts.length % 2 === 0) {
    throw new UnsupportedMarkdownError(line, "an unclosed code span");
  }
  return parts
    .map((part, index) =>
      index % 2 === 1 ? `<code>${escapeText(part)}</code>` : spans(part, line),
    )
    .join("");
}

/** A heading as plain text: its code spans, strong, emphasis, and links reduced to their words. */
function plainText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^[\]]+)\]\([^()\s]+\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1");
}

interface Line {
  readonly text: string;
  /** 1-based, in the notice file. */
  readonly number: number;
}

function isBlank(line: Line): boolean {
  return line.text.trim() === "";
}

/** A line that begins a block other than a paragraph, and so ends the paragraph before it. */
function startsBlock(text: string): boolean {
  return [HEADING, BULLET, NUMBERED, QUOTE, TABLE_ROW].some((pattern) => pattern.test(text));
}

function cells(line: Line): string[] {
  return line.text.trim().slice(1, -1).split("|");
}

function table(rows: readonly Line[]): string {
  const [head, rule, ...body] = rows;
  if (head === undefined || rule === undefined || !TABLE_RULE.test(rule.text)) {
    throw new UnsupportedMarkdownError(rows[0]?.number ?? 0, "a table without a header rule");
  }
  const width = cells(head).length;
  const row = (line: Line, tag: "th" | "td"): string => {
    const values = cells(line);
    if (values.length !== width) {
      throw new UnsupportedMarkdownError(line.number, "a table row with another number of cells");
    }
    return `<tr>${values.map((value) => `<${tag}>${inline(value.trim(), line.number)}</${tag}>`).join("")}</tr>`;
  };
  return [
    "<table>",
    `<thead>${row(head, "th")}</thead>`,
    "<tbody>",
    ...body.map((line) => row(line, "td")),
    "</tbody>",
    "</table>",
  ].join("\n");
}

function list(tag: "ul" | "ol", items: readonly Line[], pattern: RegExp): string {
  return [
    `<${tag}>`,
    ...items.map((item) => {
      const match = pattern.exec(item.text);
      return `<li>${inline(match?.[1] ?? "", item.number)}</li>`;
    }),
    `</${tag}>`,
  ].join("\n");
}

interface Blocks {
  readonly html: string[];
  /** The text of the first `#` heading, as plain text. */
  title: string | null;
}

/** The consecutive lines from `start` that match, and the index after them. */
function take(lines: readonly Line[], start: number, keep: (line: Line) => boolean): Line[] {
  const taken: Line[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || !keep(line)) {
      break;
    }
    taken.push(line);
  }
  return taken;
}

function blocks(lines: readonly Line[], into: Blocks): void {
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) {
      break;
    }
    const { text, number } = line;
    if (isBlank(line)) {
      index += 1;
      continue;
    }
    const heading = HEADING.exec(text);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      const words = heading[2] ?? "";
      if (level > 3) {
        throw new UnsupportedMarkdownError(number, "a heading below level 3");
      }
      if (level === 1 && into.title === null) {
        into.title = plainText(words);
      }
      into.html.push(`<h${level}>${inline(words, number)}</h${level}>`);
      index += 1;
      continue;
    }
    if (QUOTE.test(text)) {
      const quoted = take(lines, index, (next) => QUOTE.test(next.text));
      const inner: Blocks = { html: [], title: into.title };
      blocks(
        quoted.map((next) => ({ text: QUOTE.exec(next.text)?.[1] ?? "", number: next.number })),
        inner,
      );
      into.title = inner.title;
      into.html.push(["<blockquote>", ...inner.html, "</blockquote>"].join("\n"));
      index += quoted.length;
      continue;
    }
    if (TABLE_ROW.test(text)) {
      const rows = take(lines, index, (next) => TABLE_ROW.test(next.text));
      into.html.push(table(rows));
      index += rows.length;
      continue;
    }
    if (BULLET.test(text)) {
      const items = take(lines, index, (next) => BULLET.test(next.text));
      into.html.push(list("ul", items, BULLET));
      index += items.length;
      continue;
    }
    if (NUMBERED.test(text)) {
      const items = take(lines, index, (next) => NUMBERED.test(next.text));
      into.html.push(list("ol", items, NUMBERED));
      index += items.length;
      continue;
    }
    if (UNSUPPORTED.test(text)) {
      throw new UnsupportedMarkdownError(
        number,
        "an indented line, a fence, raw HTML, a rule or underline, or a * or + list",
      );
    }
    const paragraph = take(
      lines,
      index,
      (next) => !isBlank(next) && !startsBlock(next.text) && !UNSUPPORTED.test(next.text),
    );
    into.html.push(
      `<p>${paragraph.map((next) => inline(next.text.trim(), next.number)).join("\n")}</p>`,
    );
    index += paragraph.length;
  }
}

/**
 * A notice's version: the code span of its version line, "Version `privacy-notice.vN`" in English
 * and "版本 `privacy-notice.vN`" in Traditional Chinese. An adult's tap on "I've read it" records it
 * (flows §3.3), so a notice without one cannot be served.
 */
const VERSION_LINE = /^\S+\s+`(privacy-notice\.v[1-9]\d*)`/mu;

/** A notice with no version line, or two notices whose versions differ. */
export class NoticeVersionError extends Error {
  override readonly name = "NoticeVersionError";
}

/** The version on a notice's version line, or a `NoticeVersionError`. */
export function noticeVersion(markdown: string): string {
  const version = VERSION_LINE.exec(markdown)?.[1];
  if (version === undefined) {
    throw new NoticeVersionError(
      "a notice needs a version line such as: Version `privacy-notice.v1`",
    );
  }
  return version;
}

/** One notice's Markdown as the page the pilot Worker serves, without its version. */
export function renderNotice(markdown: string): Omit<PrivacyNotice, "version"> {
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((text, index) => ({ text, number: index + 1 }));
  const rendered: Blocks = { html: [], title: null };
  blocks(lines, rendered);
  if (rendered.title === null) {
    throw new UnsupportedMarkdownError(1, "a notice without a # heading");
  }
  return { title: rendered.title, html: rendered.html.join("\n") };
}

/**
 * Both notices, rendered, each with its version. The two must carry the same version: they say the
 * same thing, and one `Config.privacyNoticeVersion` is recorded whichever language an adult read.
 */
export function renderNotices(sources: Readonly<Record<NoticeLang, string>>): PrivacyNotices {
  const en = noticeVersion(sources.en);
  const zhTw = noticeVersion(sources["zh-TW"]);
  if (en !== zhTw) {
    throw new NoticeVersionError(
      `the notices' versions differ: ${NOTICE_FILES.en} has ${en}, ${NOTICE_FILES["zh-TW"]} has ${zhTw}`,
    );
  }
  return {
    en: { ...renderNotice(sources.en), version: en },
    "zh-TW": { ...renderNotice(sources["zh-TW"]), version: zhTw },
  };
}

/**
 * The committed module's text: a header, then each notice's title, HTML, and version as string
 * literals.
 */
export function noticesModule(sources: Readonly<Record<NoticeLang, string>>): string {
  const notices = renderNotices(sources);
  const entries = NOTICE_LANGS.map((lang) => {
    const key = lang === "en" ? lang : JSON.stringify(lang);
    const notice = notices[lang];
    return [
      `  ${key}: {`,
      `    title: ${JSON.stringify(notice.title)},`,
      `    html: ${JSON.stringify(notice.html)},`,
      `    version: ${JSON.stringify(notice.version)},`,
      "  },",
    ].join("\n");
  });
  return [
    `// Generated by scripts/generate-notices.ts from ${NOTICE_DIRECTORY}/${NOTICE_FILES.en} and`,
    `// ${NOTICE_FILES["zh-TW"]}. Do not edit: change the notice, then run`,
    "// `pnpm --filter @vela/worker notices`. src/notices.test.ts fails while this file is stale.",
    'import type { PrivacyNotices } from "./notices.ts";',
    "",
    "export const PRIVACY_NOTICES: PrivacyNotices = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}
