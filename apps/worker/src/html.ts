/**
 * The smallest safe way to build the admin pages: a tagged template that escapes every value it
 * interpolates. Nothing reaches a page without going through it, so a family name, a summary, or a
 * flag quote cannot close a tag. Markup a page builds itself is wrapped in `raw`.
 */

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

/** One page: the title and the body. No scripts, no external requests. */
export function page(title: string, body: Html, status = 200): Response {
  const markup = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>${raw(STYLE)}</style>
</head>
<body><main>${body}</main></body>
</html>`;
  return new Response(markup.markup, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The page carries family records: no store, no referrer, no framing.
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}
