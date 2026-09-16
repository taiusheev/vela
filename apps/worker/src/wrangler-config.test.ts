import { describe, expect, inject, it } from "vitest";

/**
 * The hosts wrangler attaches to the Worker as custom domains. A custom domain is the binding this
 * configuration uses: a deploy whose zone is not in the account fails, where a Worker with no route
 * at all deploys successfully and answers nothing.
 */
function customDomains(routes: unknown): string[] {
  if (!Array.isArray(routes)) {
    return [];
  }
  return routes.flatMap((route: unknown) =>
    typeof route === "object" &&
    route !== null &&
    "custom_domain" in route &&
    route.custom_domain === true &&
    "pattern" in route &&
    typeof route.pattern === "string"
      ? [route.pattern.toLowerCase()]
      : [],
  );
}

describe("each deployed environment in wrangler.jsonc", () => {
  const environments = inject("deployedHttp");

  it("covers every environment deploy.yml deploys", () => {
    expect(environments.map(({ environment }) => environment)).toEqual(["staging", "production"]);
  });

  // Telegram's webhook, /healthz, and the links in admin messages are all PUBLIC_BASE_URL. A Worker
  // that does not answer on that host still runs its alarms and crons, so arrivals and quiet notices
  // would go on while none of her answers could arrive.
  it.each(environments)(
    "$environment serves HTTPS on the host of its PUBLIC_BASE_URL",
    ({ publicBaseUrl, routes }) => {
      expect(typeof publicBaseUrl).toBe("string");
      const base = new URL(String(publicBaseUrl));

      expect(base.protocol).toBe("https:");
      expect(customDomains(routes)).toContain(base.hostname);
    },
  );
});
