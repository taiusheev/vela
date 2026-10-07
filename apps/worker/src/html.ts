/**
 * The smallest safe way to build the pages: a tagged template that escapes every value it
 * interpolates. Nothing reaches a page without going through it, so a family name, a summary, or a
 * flag quote cannot close a tag. Markup a page builds itself is wrapped in `raw`.
 */
import type { NoticeLang, PrivacyNotice } from "./notices.ts";

/** Markup that is already safe. Only this package's own helpers produce it. */
export interface Html {
  readonly markup: string;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** The one door out of escaping, for markup this module writes itself. */
function raw(markup: string): Html {
  return { markup };
}

function isHtml(value: unknown): value is Html {
  return typeof value === "object" && value !== null && typeof (value as Html).markup === "string";
}

export type Renderable = Html | string | number | null | undefined | readonly Renderable[];

function render(value: Renderable): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(render).join("");
  }
  if (isHtml(value)) {
    return value.markup;
  }
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Renderable[]): Html {
  let markup = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) {
    markup += render(values[index]) + (strings[index + 1] ?? "");
  }
  return { markup };
}

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 1.5rem 1rem; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
main { max-width: 68rem; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.5rem; }
h3 { font-size: 0.95rem; margin: 1.25rem 0 0.35rem; }
a { color: inherit; }
p.lede { margin: 0 0 1.5rem; opacity: 0.7; }
table { border-collapse: collapse; width: 100%; margin-bottom: 0.5rem; }
th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid rgba(128,128,128,0.35); vertical-align: top; }
th { font-weight: 600; white-space: nowrap; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
section { border-top: 1px solid rgba(128,128,128,0.35); padding-top: 0.5rem; }
form.action { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-end; margin: 0.5rem 0 1rem; }
form.action label { display: flex; flex-direction: column; font-size: 0.8rem; gap: 0.15rem; }
input, select, textarea { font: inherit; padding: 0.25rem 0.35rem; }
textarea { min-width: 28rem; min-height: 5rem; }
button { font: inherit; padding: 0.3rem 0.8rem; cursor: pointer; }
.notice { padding: 0.5rem 0.75rem; border: 1px solid rgba(128,128,128,0.6); margin-bottom: 1rem; }
.muted { opacity: 0.6; }
@media (max-width: 40rem) { textarea { min-width: 100%; } table { display: block; overflow-x: auto; } }
`;

/** The document around a page's body, in the page's language. No scripts, no external requests. */
function htmlDocument(lang: string, title: string, style: string, body: Html): string {
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>${raw(style)}</style>
</head>
<body><main>${body}</main></body>
</html>`.markup;
}

/** One admin page: the title and the body. */
export function page(title: string, body: Html, status = 200): Response {
  return new Response(htmlDocument("en", title, STYLE, body), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The page carries family records: no store, no framing, and no referrer to another origin.
      // Not `no-referrer`: under it the Fetch standard ("append a request `Origin` header") sends a
      // form POST with `Origin: null`, which the admin Worker's same-origin check refuses. Under
      // `same-origin` a form posted to this origin carries its real Origin.
      "cache-control": "no-store",
      "referrer-policy": "same-origin",
      "x-frame-options": "DENY",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

/** A notice is read on a phone: one narrow column of larger type, and wide tables scroll sideways. */
const NOTICE_STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 1.25rem 1rem 3rem; font: 17px/1.6 ui-sans-serif, system-ui, sans-serif; }
main { max-width: 42rem; margin: 0 auto; overflow-wrap: anywhere; }
h1 { font-size: 1.6rem; line-height: 1.3; margin: 1.5rem 0 0.75rem; }
h2 { font-size: 1.25rem; line-height: 1.35; margin: 2.25rem 0 0.5rem; }
h3 { font-size: 1.05rem; margin: 1.5rem 0 0.4rem; }
ul, ol { padding-left: 1.4rem; }
li { margin: 0.35rem 0; }
blockquote { margin: 0 0 1rem; padding: 0.5rem 0.9rem; border-left: 4px solid rgba(128,128,128,0.6); }
blockquote p { margin: 0.25rem 0; }
code { font-size: 0.9em; }
table { display: block; overflow-x: auto; border-collapse: collapse; margin: 1rem 0; font-size: 0.92rem; }
th, td { text-align: left; vertical-align: top; padding: 0.45rem 0.6rem; border: 1px solid rgba(128,128,128,0.4); min-width: 8rem; }
th { font-weight: 600; }
`;

/**
 * A privacy notice as a page in its own language. The markup is the generated module's, whose
 * generator escaped every character of the notice's text; the page itself adds only the document.
 */
export function noticePage(lang: NoticeLang, notice: PrivacyNotice): Response {
  return new Response(
    htmlDocument(notice.language ?? lang, notice.title, NOTICE_STYLE, raw(notice.html)),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Public text that changes only with a deploy; a short cache still shows a fix within minutes.
        "cache-control": "public, max-age=300",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );
}

/** The public site in the brand's colours (Brand 2026-10, tokens.css), light and dark, phone first. */
const SITE_STYLE = `
:root { color-scheme: light dark; --paper: #FBF7F0; --ink: #1E1A16; --muted: #5A534B; --soft: #F3EDE4; --rule: #E8E1D6; --amber: #E9A23B; --teal: #1F5C66; --light: #FBEBCF; }
@media (prefers-color-scheme: dark) { :root { --paper: #1B1714; --ink: #F6F0E6; --muted: #C9BFB2; --soft: #2A241F; --rule: #3A322B; --teal: #7FC2CC; --light: #3A2C17; } }
* { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0; padding: 1rem 1rem 3rem; background: var(--paper); color: var(--ink); font: 17px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", sans-serif; }
main { max-width: 46rem; margin: 0 auto; overflow-wrap: anywhere; }
h1, h2, h3 { font-family: Literata, Georgia, "Noto Serif TC", "Songti TC", serif; font-weight: 600; line-height: 1.25; }
h1 { font-size: clamp(2rem, 7vw, 2.9rem); margin: 0 0 0.75rem; }
h2 { font-size: 1.45rem; margin: 0 0 0.6rem; }
h3 { font-size: 1.15rem; margin: 0 0 0.25rem; }
a { color: var(--teal); }
header { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between; padding: 0.25rem 0 1.5rem; }
.brand { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--ink); text-decoration: none; font: 600 1.35rem/1 Literata, Georgia, serif; }
.mark { width: 1.6rem; height: 2rem; }
.langs { display: flex; gap: 0.75rem; font-size: 0.95rem; }
.langs [aria-current] { font-weight: 600; }
section { padding: 1.75rem 0; border-top: 1px solid var(--rule); }
section.hero { border-top: 0; padding-top: 0.5rem; }
.lede { font-size: 1.15rem; color: var(--muted); margin: 0; }
ol.steps { padding-left: 1.4rem; margin: 0; }
ol.steps li, ul li { margin: 0.5rem 0; }
ul { padding-left: 1.3rem; }
.plans { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); margin-bottom: 1rem; }
.plan { background: var(--soft); border-radius: 16px; padding: 1.1rem 1.2rem; }
.plan.paid { background: var(--light); }
.plan .price { font-weight: 600; margin: 0 0 0.5rem; }
.email { font-size: 1.15rem; font-weight: 600; }
.blank { background: var(--amber); color: #1E1A16; padding: 0 0.3rem; border-radius: 4px; }
.scroll { overflow-x: auto; margin: 1rem 0 0.5rem; }
table { border-collapse: collapse; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--rule); white-space: nowrap; }
th:first-child { text-align: left; }
thead th { font-weight: 600; vertical-align: bottom; white-space: normal; min-width: 5.5rem; }
.empty { background: var(--soft); border-radius: 16px; padding: 1rem 1.2rem; }
.small, footer { font-size: 0.9rem; color: var(--muted); }
footer { border-top: 1px solid var(--rule); margin-top: 1rem; padding-top: 1rem; }
footer p { margin: 0.25rem 0; }
`;

/**
 * A page of the public website. No scripts and no requests to another origin. Only production asks
 * to be indexed; staging and development keep search engines out, so a test site never ranks.
 */
export function sitePage(
  lang: string,
  title: string,
  body: Html,
  options: { readonly indexable: boolean; readonly status?: number },
): Response {
  const document = htmlDocument(lang, title, SITE_STYLE, body);
  return new Response(
    options.indexable ? document.replace(/<meta name="robots"[^>]*>\n/, "") : document,
    {
      status: options.status ?? 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );
}
