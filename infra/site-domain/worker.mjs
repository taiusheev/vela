// Prepared production bridge. Deploy only after the protected production release is verified.
// No credentials, database bindings, app routes, or messaging endpoints.
const ORIGIN = "https://vela.vela-light.workers.dev";
const PUBLIC = "https://vela-light.com";
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const PAGES = new Set([
  "/", "/zh-TW", "/how-vela-is-doing", "/zh-TW/how-vela-is-doing",
  "/website-privacy", "/zh-TW/website-privacy", "/privacy", "/privacy/zh-TW",
  "/sitemap.xml", "/.well-known/security.txt",
  "/terms", "/security", "/data-rights",
  "/zh-TW/terms", "/zh-TW/security", "/zh-TW/data-rights",
  "/analytics/config",
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const local = (body, init = {}) => {
      const headers = new Headers(init.headers);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
      headers.set("X-Vela-Website", "domain-bridge-v3-production");
      return new Response(body, { ...init, headers });
    };
    if (url.protocol !== "https:") {
      return local(null, { status: 301, headers: { location: PUBLIC + url.pathname + url.search } });
    }
    if (url.hostname === "www.vela-light.com") {
      return local(null, { status: 301, headers: { location: PUBLIC + url.pathname + url.search } });
    }
    const asset = url.pathname.startsWith("/site/");
    const waitlist = url.pathname === "/waitlist" || url.pathname === "/analytics/event";
    if (!PAGES.has(url.pathname) && !asset && !waitlist && url.pathname !== "/robots.txt") {
      return local("not found", { status: 404 });
    }
    if (waitlist ? request.method !== "POST" : !["GET", "HEAD"].includes(request.method)) {
      return local("method not allowed", { status: 405, headers: { Allow: waitlist ? "POST" : "GET, HEAD" } });
    }
    if (url.pathname === "/robots.txt") {
      return local(request.method === "HEAD" ? null : "User-agent: *\nAllow: /\nSitemap: " + PUBLIC + "/sitemap.xml\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }
    // Forward only website headers. Browser cookies and authorization never leave this Worker.
    const headers = new Headers();
    for (const name of ["accept", "accept-language", "content-type", "origin"]) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    if (waitlist && ![PUBLIC, "https://www.vela-light.com"].includes(headers.get("origin"))) {
      return local("forbidden", { status: 403 });
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
      return local("Website temporarily unavailable. Please try again.", { status: 502 });
    }
    response = new Response(response.body, response);
    response.headers.delete("set-cookie");
    response.headers.delete("x-robots-tag");
    const location = response.headers.get("location");
    if (location?.startsWith(ORIGIN + "/")) {
      response.headers.set("location", PUBLIC + location.slice(ORIGIN.length));
    }
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
    response.headers.set("X-Vela-Website", "domain-bridge-v3-production");
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
