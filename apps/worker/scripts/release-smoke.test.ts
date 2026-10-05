import { describe, expect, it, vi } from "vitest";
import { releaseSmoke } from "./release-smoke-checks.ts";

const caps = {
  pilot: true,
  telegram_first: true,
  english_only: true,
  memory: false,
  book: false,
  parent_app: false,
  billing: false,
};
function healthy(url: string): Response {
  const { pathname, hostname } = new URL(url);
  if (hostname.startsWith("vela-admin.")) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "https://vela.cloudflareaccess.com/cdn-cgi/access/login/vela-admin?token=private",
      },
    });
  }
  if (pathname === "/healthz") {
    return Response.json({ status: "ok", lastReconcileAgeSeconds: 30 });
  }
  if (pathname === "/v1/capabilities") return Response.json(caps);
  if (pathname.startsWith("/privacy")) {
    return new Response("Private notice content", { headers: { "Content-Type": "text/html" } });
  }
  return new Response(null, { status: pathname === "/v1/me" ? 401 : 404 });
}
function mockFetch(override?: (url: string) => Response | undefined): typeof fetch {
  return vi.fn(async (input) => {
    const url = String(input);
    return override?.(url) ?? healthy(url);
  });
}
function check(result: Awaited<ReturnType<typeof releaseSmoke>>, name: string) {
  return result.checks.find((item) => item.name === name);
}

describe("public deployment smoke", () => {
  it("uses only fixed environment hosts, no credentials, and never follows login redirects", async () => {
    const fetcher = mockFetch();
    const result = await releaseSmoke("production", fetcher);
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(7);
    for (const [url, init] of vi.mocked(fetcher).mock.calls) {
      expect(new URL(String(url)).hostname).toMatch(/^vela(-admin)?\.vela-light\.workers\.dev$/);
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    }
    expect(JSON.stringify(result)).not.toMatch(/private|token=|Private notice/);
  });

  it.each(["pilot", "telegram_first", "english_only", "memory", "book", "parent_app", "billing"])(
    "refuses a production trial with the wrong %s switch",
    async (key) => {
      const result = await releaseSmoke(
        "production",
        mockFetch((url) =>
          url.endsWith("/v1/capabilities")
            ? Response.json({ ...caps, [key]: !caps[key as keyof typeof caps] })
            : undefined,
        ),
      );
      expect(result.passed).toBe(false);
      expect(check(result, "english_trial_capabilities")?.passed).toBe(false);
    },
  );

  it("allows broader synthetic staging switches but still requires the complete boolean contract", async () => {
    const broader = { ...caps, pilot: false, memory: true };
    const fetcher = mockFetch((url) =>
      url.endsWith("/v1/capabilities") ? Response.json(broader) : undefined,
    );
    expect((await releaseSmoke("staging", fetcher)).passed).toBe(true);
    const result = await releaseSmoke(
      "staging",
      mockFetch((url) =>
        url.endsWith("/v1/capabilities") ? Response.json({ ...broader, book: "off" }) : undefined,
      ),
    );
    expect(check(result, "capabilities_available")?.passed).toBe(false);
  });

  it.each([
    "https://example.com/cdn-cgi/access/login",
    "https://evilcloudflareaccess.com/cdn-cgi/access/login",
    "http://vela.cloudflareaccess.com/cdn-cgi/access/login",
    "https://vela.cloudflareaccess.com/unrelated",
  ])("refuses an admin redirect outside the HTTPS Access login: %s", async (location) => {
    const result = await releaseSmoke(
      "staging",
      mockFetch((url) =>
        new URL(url).hostname.startsWith("vela-admin.")
          ? new Response(null, { status: 302, headers: { Location: location } })
          : undefined,
      ),
    );
    expect(check(result, "admin_access_login")?.passed).toBe(false);
  });

  it.each([200, 403, 404, 500])(
    "refuses an admin status %s without Access login proof",
    async (status) => {
      const result = await releaseSmoke(
        "staging",
        mockFetch((url) =>
          new URL(url).hostname.startsWith("vela-admin.")
            ? new Response(null, { status })
            : undefined,
        ),
      );
      expect(check(result, "admin_access_login")?.passed).toBe(false);
    },
  );

  it.each([-1, 2101, "30", null])("refuses a misleading healthy heartbeat age %s", async (age) => {
    const result = await releaseSmoke(
      "staging",
      mockFetch((url) =>
        url.endsWith("/healthz")
          ? Response.json({ status: "ok", lastReconcileAgeSeconds: age })
          : undefined,
      ),
    );
    expect(check(result, "reconcile_heartbeat")?.passed).toBe(false);
  });

  it("fails when the unauthenticated API opens, or the pilot exposes admin", async () => {
    const result = await releaseSmoke(
      "staging",
      mockFetch((url) =>
        !new URL(url).hostname.startsWith("vela-admin.") &&
        (url.endsWith("/v1/me") || url.endsWith("/admin"))
          ? Response.json({ private: "must never be recorded" })
          : undefined,
      ),
    );
    expect(check(result, "api_requires_authentication")?.passed).toBe(false);
    expect(check(result, "pilot_has_no_admin")?.passed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("refuses oversized or malformed JSON without printing bodies", async () => {
    const result = await releaseSmoke(
      "staging",
      mockFetch((url) => {
        if (url.endsWith("/healthz"))
          return new Response("private", { headers: { "Content-Type": "application/json" } });
        if (url.endsWith("/v1/capabilities"))
          return new Response("x".repeat(16_385), {
            headers: { "Content-Type": "application/json" },
          });
        return undefined;
      }),
    );
    expect(check(result, "reconcile_heartbeat")?.passed).toBe(false);
    expect(check(result, "capabilities_available")?.passed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("bounds a stalled response body and suppresses transport exception details", async () => {
    const fetcher: typeof fetch = vi.fn(async (input) => {
      if (String(input).endsWith("/healthz")) {
        return new Response(new ReadableStream({ start() {} }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("private signed URL or credential");
    });
    const result = await releaseSmoke("staging", fetcher, 20);
    expect(result.passed).toBe(false);
    expect(check(result, "reconcile_heartbeat")?.http_status).toBe(200);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
