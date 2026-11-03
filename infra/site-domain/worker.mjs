// Prepared production bridge. Deploy only after the protected production release is verified.
// No credentials, database bindings, app routes, or messaging endpoints.
const ORIGIN = "https://vela.vela-light.workers.dev";
const PUBLIC = "https://vela-light.com";
const PAGES = new Set([
  "/", "/zh-TW", "/how-vela-is-doing", "/zh-TW/how-vela-is-doing",
  "/website-privacy", "/zh-TW/website-privacy", "/privacy", "/privacy/zh-TW",
  "/sitemap.xml", "/.well-known/security.txt",
  "/terms", "/security", "/data-rights",
  "/zh-TW/terms", "/zh-TW/security", "/zh-TW/data-rights",
  "/analytics/config",
]);

// Each visitor's writes are counted here, by the address Cloudflare saw them come from. The pilot
// Worker cannot do it for this domain: Cloudflare stamps every request this Worker forwards with
// the bridge's own address, so behind the bridge all visitors would share one count. Each binding
// is a Workers Rate Limiting namespace of this account (wrangler.jsonc). A limiter that fails
// admits the request, as the pilot Worker's does: a sign-up is never lost to an outage.
const LIMITS = { "/waitlist": "WAITLIST_LIMIT", "/analytics/event": "ANALYTICS_LIMIT" };

async function admitted(env, path, request) {
  const limiter = env?.[LIMITS[path]];
  if (limiter === undefined) return true;
  const address = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  try {
    return (await limiter.limit({ key: address })).success;
  } catch {
    return true;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.vela-light.com") {
      return Response.redirect(PUBLIC + url.pathname + url.search, 301);
    }
    const asset = url.pathname.startsWith("/site/");
    const waitlist = url.pathname === "/waitlist" || url.pathname === "/analytics/event";
    if (!PAGES.has(url.pathname) && !asset && !waitlist && url.pathname !== "/robots.txt") {
      return new Response("not found", { status: 404 });
    }
    if (waitlist ? request.method !== "POST" : !["GET", "HEAD"].includes(request.method)) {
      return new Response("method not allowed", { status: 405, headers: { Allow: waitlist ? "POST" : "GET, HEAD" } });
    }
    if (url.pathname === "/robots.txt") {
      return new Response(request.method === "HEAD" ? null : "User-agent: *\nAllow: /\nSitemap: " + PUBLIC + "/sitemap.xml\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }
    // Forward only website headers. Browser cookies and authorization never leave this Worker.
    const headers = new Headers();
    for (const name of ["accept", "accept-language", "content-type", "origin"]) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    if (waitlist && ![PUBLIC, "https://www.vela-light.com"].includes(headers.get("origin"))) {
      return new Response("forbidden", { status: 403 });
    }
    if (waitlist && !(await admitted(env, url.pathname, request))) {
      return new Response("Too many tries. Please wait a minute and try again.", {
        status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" },
      });
    }
    const upstream = new URL(url.pathname + url.search, ORIGIN);
    let response;
    try {
      response = await fetch(upstream, {
        method: request.method, headers,
        body: waitlist ? request.body : undefined,
        redirect: "manual",
      });
    } catch {
      return new Response("Website temporarily unavailable. Please try again.", { status: 502 });
    }
    response = new Response(response.body, response);
    response.headers.delete("set-cookie");
    response.headers.delete("x-robots-tag");
    const location = response.headers.get("location");
    if (location?.startsWith(ORIGIN + "/")) {
      response.headers.set("location", PUBLIC + location.slice(ORIGIN.length));
    }
    response.headers.set("X-Vela-Website", "domain-bridge-v2-production");
    if (response.headers.get("content-type")?.includes("text/html") && request.method !== "HEAD") {
      response.headers.delete("etag");
      response.headers.delete("content-length");
      return new HTMLRewriter()
        .on('meta[name="robots"]', { element(element) { element.setAttribute("content", "index, follow"); } })
        .transform(response);
    }
    return response;
  },
};
