import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { PublicPrecision } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import type { PilotEnv } from "./env.ts";
import { SITE_CSP } from "./html.ts";
import { createWorker } from "./pilot-worker.ts";
import { SITE_LANGS, SITE_PATHS, siteDemo, unfilledSiteBlanks } from "./site.ts";
import {
  createFakePilotRuntime,
  type FakePilotRuntime,
  namesOf,
  testEnv,
} from "./testing/fakes.ts";

const staging: PilotEnv = { ...testEnv, ENVIRONMENT: "staging" };
const production: PilotEnv = { ...testEnv, ENVIRONMENT: "production" };

async function send(
  fake: FakePilotRuntime,
  request: Request | string,
  env: PilotEnv = testEnv,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await createWorker(fake.runtime).fetch(
    typeof request === "string" ? new Request(request) : request,
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/** Each test its own origin, so the edge cache one test fills never answers another. */
let origins = 0;
function origin(): string {
  origins += 1;
  return `https://site-${origins}.worker.test`;
}

const AUGUST: PublicPrecision["months"][number] = {
  month: "2026-08",
  notices: 20,
  open: 1,
  outcomes: { answered_late: 12, away: 4, fine_known: 1, true_concern: 2, unknown: 0 },
  useful: { yes: 9, no: 3 },
};

const published = (months: PublicPrecision["months"]) => async () => ({
  months,
  minimum: { notices: 10, families: 3 },
  through: "2026-08",
});

/** The page's words, its demo script's included, without markup. */
function textOf(body: string): string {
  return body.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ");
}

function waitlistPost(at: string, fields: Record<string, string>, json = false): Request {
  return new Request(`${at}/waitlist`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(json ? { accept: "application/json" } : {}),
    },
    body: new URLSearchParams(fields),
  });
}

describe("the public website", () => {
  it.each(SITE_LANGS)(
    "serves the %s home page under a strict policy, loading only its own files",
    async (lang) => {
      const fake = createFakePilotRuntime();
      const at = origin();

      const response = await send(fake, `${at}${SITE_PATHS[lang].home}`, staging);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("content-security-policy")).toBe(SITE_CSP);
      expect(SITE_CSP).not.toContain("unsafe-inline");
      expect(body).toContain(`<html lang="${lang}">`);
      expect(body).toContain('<meta name="robots" content="noindex, nofollow">');
      // Scripts only from this origin's files, plus the one data block the script reads.
      expect(body.match(/<script[^>]*>/g)).toEqual([
        '<script src="/site/boot.js">',
        '<script src="/site/site.js" defer>',
        '<script type="application/json" id="vela-demo">',
      ]);
      expect(body).not.toContain("style=");
      for (const [, url] of body.matchAll(/(?:src|href|content)="(https?:[^"]+)"/g)) {
        expect(url?.startsWith(at)).toBe(true);
      }
      expect(body).toContain(`href="/privacy${lang === "en" ? "" : "/zh-TW"}"`);
      expect(body).toContain(`href="${SITE_PATHS[lang].precision}"`);
      expect(body).toContain('href="mailto:t.aiusheev@gmail.com"');
      expect(body).toContain('<form class="waitlist" method="post" action="/waitlist">');
      expect(fake.built()).toBe(0);
    },
  );

  it("names each language's page as the other's alternate, and links between them", async () => {
    const fake = createFakePilotRuntime();
    const at = origin();

    const en = await (await send(fake, `${at}/`)).text();
    const zh = await (await send(fake, `${at}/zh-TW/how-vela-is-doing`)).text();

    expect(en).toContain(`<link rel="alternate" hreflang="zh-TW" href="${at}/zh-TW">`);
    expect(en).toContain(`<link rel="canonical" href="${at}/">`);
    expect(en).toContain('href="/zh-TW" hreflang="zh-TW"');
    expect(zh).toContain('href="/how-vela-is-doing" hreflang="en"');
  });

  // Spec §9 and §20: she is never described as monitored, checked on, or tracked, on the website too.
  it.each(SITE_LANGS)(
    "never describes her as monitored, checked on or tracked (%s)",
    async (lang) => {
      const fake = createFakePilotRuntime({
        services: { loadPublicPrecision: published([AUGUST]) },
      });
      for (const page of ["home", "precision"] as const) {
        const words = textOf(
          await (await send(fake, `${origin()}${SITE_PATHS[lang][page]}`)).text(),
        );
        expect(words).not.toMatch(
          /monitor|check(s|ed|ing)? (in )?on|tracking|tracked|keep an eye|surveil/i,
        );
        expect(words).not.toMatch(/監控|監視|追蹤|定位/);
      }
    },
  );

  it("embeds a demo script no string of which can close its element", () => {
    for (const lang of SITE_LANGS) {
      expect(JSON.stringify(siteDemo(lang))).not.toMatch(/<\/?script/i);
    }
  });

  it("has no founder's blank left, so production serves every page, and only production is indexed", async () => {
    expect(SITE_LANGS.map(unfilledSiteBlanks)).toEqual([[], []]);
    const fake = createFakePilotRuntime();

    const response = await send(fake, `${origin()}/zh-TW`, production);

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('name="robots"');
  });

  it("thanks a person who joined without script, and asks again after a bad address", async () => {
    const fake = createFakePilotRuntime();

    const joined = await (await send(fake, `${origin()}/?joined=1`)).text();
    const bad = await (await send(fake, `${origin()}/zh-TW?joined=email`)).text();

    expect(joined).toContain(
      '<div class="flash ok" role="status">You’re on the list. We’ll write when your family can start.</div>',
    );
    expect(bad).toContain('<div class="flash err" role="alert">');
  });
});

describe("the waitlist form", () => {
  it("keeps the address and sends a browser without script back to the page's thanks", async () => {
    const fake = createFakePilotRuntime();

    const response = await send(
      fake,
      waitlistPost(origin(), { email: " Mia@Example.com ", lang: "zh-TW", role: "organiser" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/zh-TW?joined=1#join");
    expect(fake.calls).toEqual([
      {
        name: "joinWaitlist",
        args: [{ email: "mia@example.com", lang: "zh-TW", role: "organiser" }],
      },
    ]);
    expect(fake.closed()).toBe(fake.built());
  });

  it("answers the page's script in JSON", async () => {
    const fake = createFakePilotRuntime();

    const response = await send(
      fake,
      waitlistPost(origin(), { email: "a@b.co", lang: "en" }, true),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ joined: true });
    expect(fake.calls[0]?.args).toEqual([{ email: "a@b.co", lang: "en", role: null }]);
  });

  it("asks again for an address that is not one, storing nothing", async () => {
    const fake = createFakePilotRuntime();
    const at = origin();

    const form = await send(fake, waitlistPost(at, { email: "mia@", lang: "en" }));
    const json = await send(fake, waitlistPost(at, { email: "", lang: "en" }, true));

    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/?joined=email#join");
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: "email" });
    expect(namesOf(fake.calls)).toEqual([]);
    expect(fake.built()).toBe(0);
  });

  it("answers a robot that filled the hidden field as if it joined, and stores nothing", async () => {
    const fake = createFakePilotRuntime();

    const response = await send(
      fake,
      waitlistPost(origin(), { email: "bot@spam.example", lang: "en", website: "http://spam" }),
    );

    expect(response.headers.get("location")).toBe("/?joined=1#join");
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("falls back to English for a language the site does not have, and drops an unknown role", async () => {
    const fake = createFakePilotRuntime();

    const response = await send(
      fake,
      waitlistPost(origin(), { email: "a@b.co", lang: "fr", role: "admin" }),
    );

    expect(response.headers.get("location")).toBe("/?joined=1#join");
    expect(fake.calls[0]?.args).toEqual([{ email: "a@b.co", lang: "en", role: null }]);
  });

  it("refuses an address over the per-address limit before reading the database", async () => {
    const fake = createFakePilotRuntime();
    const keys: string[] = [];
    const limited: PilotEnv = {
      ...testEnv,
      API_IP_LIMIT: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: false };
        },
      } as RateLimit,
    };
    const request = waitlistPost(origin(), { email: "a@b.co", lang: "en" }, true);
    request.headers.set("cf-connecting-ip", "203.0.113.9");

    const response = await send(fake, request, limited);

    expect(response.status).toBe(429);
    expect(keys).toEqual(["waitlist:203.0.113.9"]);
    expect(fake.built()).toBe(0);
  });
});

describe("How Vela is doing", () => {
  it("publishes each month's notices, outcomes, precision and useful share", async () => {
    const fake = createFakePilotRuntime({
      services: {
        loadPublicPrecision: published([
          AUGUST,
          {
            ...AUGUST,
            month: "2026-07",
            notices: 10,
            outcomes: { ...AUGUST.outcomes, true_concern: 0 },
            useful: { yes: 0, no: 0 },
          },
        ]),
      },
    });

    const response = await send(fake, `${origin()}/how-vela-is-doing`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(body).toContain(
      '<tr><th scope="row">August 2026</th><td>20</td><td>12</td><td>4</td><td>1</td><td>2</td><td>0</td><td>1</td><td>10%</td><td>75%</td></tr>',
    );
    // A month with no verdicts has no useful share, rather than 0%.
    expect(body).toContain('<th scope="row">July 2026</th><td>10</td>');
    expect(body).toMatch(/<td>0%<\/td><td>–<\/td><\/tr>/);
    expect(body).toContain("fewer than 10 quiet notes, or notes from fewer than 3 families");
    expect(namesOf(fake.calls)).toEqual(["loadPublicPrecision"]);
    expect(fake.closed()).toBe(fake.built());
  });

  it("says plainly that nothing is published before a month qualifies", async () => {
    const fake = createFakePilotRuntime();

    const en = await (await send(fake, `${origin()}/how-vela-is-doing`)).text();
    const zh = await (await send(fake, `${origin()}/zh-TW/how-vela-is-doing`)).text();

    expect(en).toContain("No month is published yet.");
    expect(en).not.toContain("<table");
    expect(zh).toContain("目前還沒有公布任何月份。");
  });

  it("names the month in the reader's language", async () => {
    const fake = createFakePilotRuntime({ services: { loadPublicPrecision: published([AUGUST]) } });

    const zh = await (await send(fake, `${origin()}/zh-TW/how-vela-is-doing`)).text();

    expect(zh).toContain('<th scope="row">2026 年 8 月</th>');
  });

  it("answers repeat visits from the edge cache, reading the database once an hour", async () => {
    const fake = createFakePilotRuntime();
    const at = origin();

    await send(fake, `${at}/how-vela-is-doing`);
    await send(fake, `${at}/how-vela-is-doing?ref=share`);
    await send(fake, `${at}/how-vela-is-doing`);

    expect(namesOf(fake.calls)).toEqual(["loadPublicPrecision"]);
    expect(fake.built()).toBe(1);
  });
});

describe("the website's privacy notice", () => {
  it.each(SITE_LANGS)("serves it in %s, linked from every page and from the form", async (lang) => {
    const fake = createFakePilotRuntime();
    const at = origin();

    const notice = await send(fake, `${at}${SITE_PATHS[lang].privacy}`);
    const home = await (await send(fake, `${at}${SITE_PATHS[lang].home}`)).text();
    const body = await notice.text();

    expect(notice.status).toBe(200);
    expect(body).toContain(`<html lang="${lang}">`);
    // The Art. 8 items: who, what, why, how long, where and by whom, rights, and if not given.
    expect(body.match(/<h2>/g)?.length).toBeGreaterThanOrEqual(8);
    expect(body).toContain("t.aiusheev@gmail.com");
    expect(body).toContain(lang === "en" ? "within 15 days" : "15 日內");
    expect(body).toContain(lang === "en" ? "Singapore" : "新加坡");
    expect(body).toContain(`href="/privacy${lang === "en" ? "" : "/zh-TW"}"`);
    expect(home.match(new RegExp(`href="${SITE_PATHS[lang].privacy}"`, "g"))).toHaveLength(2);
  });

  it("promises no cookies, and the pages set none", async () => {
    const fake = createFakePilotRuntime();
    const at = origin();

    const notice = await (await send(fake, `${at}/website-privacy`)).text();
    for (const path of ["/", "/zh-TW", "/how-vela-is-doing", "/website-privacy"]) {
      expect((await send(fake, `${at}${path}`)).headers.get("set-cookie")).toBeNull();
    }

    expect(notice).toContain("We do not use cookies, analytics, advertising or tracking tools");
  });
});

describe("the website's protections", () => {
  it.each(["/", "/zh-TW/how-vela-is-doing", "/website-privacy"])(
    "sends %s with HTTPS-only, no framing, no sniffing and no device access",
    async (path) => {
      const fake = createFakePilotRuntime();

      const headers = (await send(fake, `${origin()}${path}`)).headers;

      expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(headers.get("permissions-policy")).toContain("camera=()");
      expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
    },
  );

  it("refuses a waitlist form sent from another site", async () => {
    const fake = createFakePilotRuntime();
    const request = waitlistPost(origin(), { email: "a@b.co", lang: "en" });
    request.headers.set("origin", "https://evil.example");

    const response = await send(fake, request);

    expect(response.status).toBe(403);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("takes a form from this address and from the website's own domain", async () => {
    const fake = createFakePilotRuntime();
    const at = origin();
    const own = waitlistPost(at, { email: "a@b.co", lang: "en" });
    own.headers.set("origin", at);
    const site = waitlistPost(at, { email: "c@d.co", lang: "en" });
    site.headers.set("origin", "https://vela-light.com");

    const ownAnswer = await send(fake, own, { ...testEnv, SITE_HOST: "vela-light.com" });
    const siteAnswer = await send(fake, site, { ...testEnv, SITE_HOST: "vela-light.com" });

    expect([ownAnswer.status, siteAnswer.status]).toEqual([303, 303]);
    expect(namesOf(fake.calls)).toEqual(["joinWaitlist", "joinWaitlist"]);
  });

  it("refuses a body that is not this form, or larger than it could be", async () => {
    const fake = createFakePilotRuntime();
    const at = origin();
    const json = new Request(`${at}/waitlist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.co" }),
    });

    const wrongType = await send(fake, json);
    const tooBig = await send(
      fake,
      waitlistPost(at, { email: "a@b.co", lang: "en", pad: "x".repeat(3000) }),
    );

    expect([wrongType.status, tooBig.status]).toEqual([415, 413]);
    expect(namesOf(fake.calls)).toEqual([]);
  });

  it("says where to report a security problem", async () => {
    const fake = createFakePilotRuntime();

    const response = await send(fake, "https://vela-light.com/.well-known/security.txt", {
      ...testEnv,
      SITE_HOST: "vela-light.com",
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Contact: mailto:t.aiusheev@gmail.com");
    expect(body).toMatch(/Expires: \d{4}-\d{2}-\d{2}T00:00:00\.000Z/);
    expect(body).toContain("Canonical: https://vela-light.com/.well-known/security.txt");
  });
});
