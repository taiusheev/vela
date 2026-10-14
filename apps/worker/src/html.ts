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
td.status-on_track { background: rgba(60,160,90,0.16); }
td.status-watch { background: rgba(230,170,40,0.2); }
td.status-kill { background: rgba(220,60,60,0.2); font-weight: 600; }
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

/**
 * What a public site page may load: its own stylesheet, script, fonts and pictures under `/site/`,
 * and a fetch back to this origin for the waitlist. Nothing from another origin, no inline script.
 */
export const SITE_CSP =
  "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

/**
 * The headers every public site page carries beyond its CSP: HTTPS only for a year, no framing,
 * no sniffing, no referrer path to other sites, and no camera, microphone, location or payment
 * access for anything on the page. `_headers` in site-assets gives the static files the same.
 */
export const SITE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
};

/** A page of the public website, in its language, with its social preview and alternate language. */
export function sitePage(
  page: {
    readonly lang: string;
    readonly title: string;
    readonly description: string;
    readonly body: Html;
    readonly path: string;
    readonly alternates: readonly { readonly lang: string; readonly path: string }[];
  },
  options: { readonly indexable: boolean; readonly origin: string; readonly status?: number },
): Response {
  const url = (path: string) => `${options.origin}${path}`;
  const document = html`<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${options.indexable ? null : raw('<meta name="robots" content="noindex, nofollow">\n')}<title>${page.title}</title>
<meta name="description" content="${page.description}">
<meta name="theme-color" content="#FBF7F0">
<link rel="canonical" href="${url(page.path)}">
${page.alternates.map(
  (a) => html`<link rel="alternate" hreflang="${a.lang}" href="${url(a.path)}">
`,
)}<meta property="og:type" content="website">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${url(page.path)}">
<meta property="og:image" content="${url("/site/img/open-graph.png")}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/site/favicon.svg">
<link rel="preload" href="/site/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site/site.css">
<script src="/site/boot.js"></script>
<script src="/site/site.js" defer></script>
</head>
<body>${page.body}</body>
</html>`.markup;
  return new Response(document, {
    status: options.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...SITE_SECURITY_HEADERS,
      "content-security-policy": SITE_CSP,
    },
  });
}
