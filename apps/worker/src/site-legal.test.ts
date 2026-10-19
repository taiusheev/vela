import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createWorker } from "./pilot-worker.ts";
import { SITE_LANGS } from "./site.ts";
import { LEGAL_LABELS, LEGAL_ORIGIN, LEGAL_PAGES, legalPath } from "./site-legal.ts";
import { createFakePilotRuntime, testEnv } from "./testing/fakes.ts";

describe("public legal access", () => {
  it.each(SITE_LANGS)(
    "serves the %s terms, security and deletion instructions without an account or database",
    async (lang) => {
      const fake = createFakePilotRuntime();
      const worker = createWorker(fake.runtime);
      const env = { ...testEnv, ENVIRONMENT: "production" as const, SITE_HOST: "vela-light.com" };
      for (const page of LEGAL_PAGES) {
        const ctx = createExecutionContext();
        const response = await worker.fetch(
          new Request(`https://vela-light.com${legalPath(lang, page)}`),
          env,
          ctx,
        );
        await waitOnExecutionContext(ctx);
        expect(response.status).toBe(200);
        const body = await response.text();
        expect(body).toContain(`<h1>${LEGAL_LABELS[lang][page]}</h1>`);
        expect(body).toContain(`${LEGAL_ORIGIN}${legalPath(lang, page)}`);
        expect(body).toContain("t.aiusheev@gmail.com");
        expect(body).toContain('<main id="main"');
        const other = lang === "en" ? "zh-TW" : "en";
        expect(body).toContain(`href="${legalPath(other, page)}" hreflang="${other}"`);
        expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
        expect(response.headers.get("set-cookie")).toBeNull();
        for (const linked of LEGAL_PAGES)
          expect(body).toContain(`href="${LEGAL_ORIGIN}${legalPath(lang, linked)}"`);
      }
      expect(fake.built()).toBe(0);
      expect(fake.calls).toEqual([]);
    },
  );

  it("publishes a security reporting policy and public legal policy, while blocking private routes on the public host", async () => {
    const fake = createFakePilotRuntime();
    const worker = createWorker(fake.runtime);
    const env = { ...testEnv, SITE_HOST: "vela-light.com" };
    for (const [path, status, contains] of [
      ["/.well-known/security.txt", 200, "Policy: https://vela.vela-light.workers.dev/security"],
      ["/sitemap.xml", 200, "https://vela-light.com/website-privacy"],
      ["/v1/me", 404, "not found"],
    ] as const) {
      const ctx = createExecutionContext();
      const response = await worker.fetch(new Request(`https://vela-light.com${path}`), env, ctx);
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(status);
      expect(await response.text()).toContain(contains);
    }
    expect(fake.built()).toBe(0);
  });
});
