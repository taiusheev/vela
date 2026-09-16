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

/** The vars that name a host: the Worker's own origin and the published privacy notices. */
const HOST_VARS = ["PUBLIC_BASE_URL", "PRIVACY_NOTICE_URL_EN", "PRIVACY_NOTICE_URL_ZH_TW"] as const;

describe("each deployed environment in wrangler.jsonc", () => {
  const environments = inject("deployedConfig");

  it("covers every environment deploy.yml deploys", () => {
    expect(environments.map(({ environment }) => environment)).toEqual(["staging", "production"]);
  });

  // Telegram's webhook, /healthz, and the links in admin messages are all PUBLIC_BASE_URL. A Worker
  // that does not answer on that host still runs its alarms and crons, so arrivals and quiet notices
  // would go on while none of her answers could arrive.
  it.each(environments)(
    "$environment serves HTTPS on the host of its PUBLIC_BASE_URL",
    ({ vars, routes }) => {
      const publicBaseUrl = vars.PUBLIC_BASE_URL;
      expect(typeof publicBaseUrl).toBe("string");
      const base = new URL(String(publicBaseUrl));

      expect(base.protocol).toBe("https:");
      expect(customDomains(routes)).toContain(base.hostname);
    },
  );

  // A guessed host can belong to someone else: vela.family is another company's family-calendar
  // app (design/research-identity.md), and a notice link there sends families to its site. Until
  // the founder chooses hosts Vela owns, each is a placeholder the Worker refuses to start with
  // (src/deps.ts). The commit that sets the chosen hosts changes this test to name them.
  it.each(environments)(
    "$environment leaves every host the founder must choose as a placeholder",
    ({ vars, routes }) => {
      for (const name of HOST_VARS) {
        expect(vars[name], name).toEqual(expect.stringContaining("PLACEHOLDER_"));
      }
      const domains = customDomains(routes);
      expect(domains.length).toBeGreaterThan(0);
      for (const domain of domains) {
        // `customDomains` lowercases each pattern, as `URL` does a hostname.
        expect(domain).toContain("placeholder_");
      }
    },
  );
});
