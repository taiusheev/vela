/**
 * The public website's own address (launch gate 14). `SITE_HOST` (for example "vela-light.com")
 * names the custom domain the site answers on. That address serves the website and nothing else:
 * the webhooks, the media LINE fetches, her phone's routes and the API stay on the Worker's
 * workers.dev address, so a public domain adds no way in to them. `www.` sends a visitor to the
 * bare domain. Only the site's own address is indexed; every other address keeps search engines out.
 */
import { SITE_LANGS, SITE_PATHS, WAITLIST_PATH } from "./site.ts";

/** The paths the public address answers; static files under /site/ are the platform's. */
export const PUBLIC_SITE_PATHS: ReadonlySet<string> = new Set([
  ...SITE_LANGS.flatMap((lang) => [SITE_PATHS[lang].home, SITE_PATHS[lang].precision]),
  WAITLIST_PATH,
  "/privacy",
  "/privacy/zh-TW",
  "/robots.txt",
  "/sitemap.xml",
]);

/** The site's host from the environment, lowercased, or null when it has none. */
export function siteHostOf(env: { readonly SITE_HOST?: string }): string | null {
  const host = env.SITE_HOST?.trim().toLowerCase() ?? "";
  return host === "" ? null : host;
}

/**
 * What the public address answers before anything else runs: a redirect from `www.`, a 404 for a
 * path that is not the website's, or null to carry on as on any other address.
 */
export function publicHostAnswer(
  request: Request,
  env: { readonly SITE_HOST?: string },
): Response | null {
  const site = siteHostOf(env);
  if (site === null) return null;
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host === `www.${site}`) {
    return new Response(null, {
      status: 301,
      headers: { location: `https://${site}${url.pathname}${url.search}` },
    });
  }
  if (host === site && !PUBLIC_SITE_PATHS.has(url.pathname)) {
    return new Response("not found", { status: 404 });
  }
  return null;
}

/** Whether a page may be indexed: production, or the site's own public address. */
export function siteIndexable(
  env: { readonly ENVIRONMENT: string; readonly SITE_HOST?: string },
  url: URL,
): boolean {
  return env.ENVIRONMENT === "production" || url.hostname.toLowerCase() === siteHostOf(env);
}

/** The origin canonical links name: the site's own address when it has one. */
export function canonicalOrigin(env: { readonly SITE_HOST?: string }, url: URL): string {
  const site = siteHostOf(env);
  return site === null ? url.origin : `https://${site}`;
}

/** robots.txt: the whole site on its own address, nothing anywhere else. */
export function robotsTxt(indexable: boolean, origin: string): string {
  return indexable
    ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
}

/** The site's pages in both languages, each naming the other as its alternate. */
export function sitemapXml(origin: string): string {
  const pages = (["home", "precision"] as const).flatMap((page) =>
    SITE_LANGS.map((lang) => {
      const alternates = SITE_LANGS.map(
        (other) =>
          `<xhtml:link rel="alternate" hreflang="${other}" href="${origin}${SITE_PATHS[other][page]}"/>`,
      ).join("");
      return `<url><loc>${origin}${SITE_PATHS[lang][page]}</loc>${alternates}</url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${pages.join("")}</urlset>\n`;
}
