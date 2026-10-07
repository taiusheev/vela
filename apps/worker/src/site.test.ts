import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { PublicPrecision } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import type { PilotEnv } from "./env.ts";
import { html, sitePage } from "./html.ts";
import { createWorker } from "./pilot-worker.ts";
import { SITE_LANGS, SITE_PATHS, unfilledSiteBlanks } from "./site.ts";
import {
  consoleLinesDuring,
  createFakePilotRuntime,
  type FakePilotRuntime,
  namesOf,
  testEnv,
} from "./testing/fakes.ts";

const staging: PilotEnv = { ...testEnv, ENVIRONMENT: "staging" };
const production: PilotEnv = { ...testEnv, ENVIRONMENT: "production" };

async function send(
  fake: FakePilotRuntime,
  url: string,
  env: PilotEnv = testEnv,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await createWorker(fake.runtime).fetch(new Request(url), env, ctx);
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

/** The page's words without its markup. */
function textOf(body: string): string {
  return body
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, " ");
}

describe("the public website", () => {
  it.each(SITE_LANGS)(
    "serves the %s home page with no scripts, no other origin, and out of search engines outside production",
    async (lang) => {
      const fake = createFakePilotRuntime();

      const response = await send(fake, `${origin()}${SITE_PATHS[lang].home}`, staging);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(body).toContain(`<html lang="${lang}">`);
      expect(body).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(body).not.toContain("<script");
      expect(body).not.toMatch(/(src|href)="(https?:)?\/\//);
      expect(body).toContain(`href="/privacy${lang === "en" ? "" : "/zh-TW"}"`);
      expect(body).toContain(`href="${SITE_PATHS[lang].precision}"`);
      expect(fake.built()).toBe(0);
    },
  );

  it("links each language's page to the other's", async () => {
    const fake = createFakePilotRuntime();

    const en = await (await send(fake, `${origin()}/`)).text();
    const zh = await (await send(fake, `${origin()}/zh-TW/how-vela-is-doing`)).text();

    expect(en).toContain('href="/zh-TW" hreflang="zh-TW"');
    expect(zh).toContain('href="/how-vela-is-doing" hreflang="en"');
  });

  // Spec §9 and §20: she is never described as monitored, checked on, or tracked, on the website too.
  it.each(SITE_LANGS)(
    "never describes her as monitored, checked on or tracked (%s)",
    async (lang) => {
      const fake = createFakePilotRuntime({
        services: {
          loadPublicPrecision: async () => ({
            months: [AUGUST],
            minimum: { notices: 10, families: 3 },
            through: "2026-08",
          }),
        },
      });
      for (const page of ["home", "precision"] as const) {
        const words = textOf(
          await (await send(fake, `${origin()}${SITE_PATHS[lang][page]}`)).text(),
        );
        expect(words).not.toMatch(/monitor|check(s|ed|ing)? (in )?on|track|keep an eye|surveil/i);
        expect(words).not.toMatch(/監控|監視|追蹤|定位/);
      }
    },
  );

  it("shows the founder's blanks in staging, highlighted, until they are chosen", async () => {
    const fake = createFakePilotRuntime();

    const body = await (await send(fake, `${origin()}/`, staging)).text();

    expect(body).toContain("[price] per parent");
    expect(body).toContain('<span class="blank">[support email]</span>');
  });

  it("refuses every page in production while its copy holds a blank, and logs which", async () => {
    expect(unfilledSiteBlanks("en")).toEqual(["[price]", "[support email]"]);
    const fake = createFakePilotRuntime();
    const at = origin();

    const { result, lines } = await consoleLinesDuring(async () => ({
      home: await send(fake, `${at}/`, production),
      precision: await send(fake, `${at}/zh-TW/how-vela-is-doing`, production),
    }));

    expect([result.home.status, result.precision.status]).toEqual([503, 503]);
    expect(await result.home.text()).toBe("unavailable");
    expect(lines).toEqual([
      {
        level: "error",
        environment: "production",
        event: "site_unfilled",
        lang: "en",
        blanks: "[price],[support email]",
      },
      {
        level: "error",
        environment: "production",
        event: "site_unfilled",
        lang: "zh-TW",
        blanks: "[price],[support email]",
      },
    ]);
    expect(fake.built()).toBe(0);
  });

  it("lets search engines index a page only when asked to", async () => {
    const page = (indexable: boolean) =>
      sitePage("en", "Vela", html`<h1>Vela</h1>`, { indexable }).text();

    expect(await page(true)).not.toContain('name="robots"');
    expect(await page(false)).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});

describe("How Vela is doing", () => {
  it("publishes each month's notices, outcomes, precision and useful share", async () => {
    const fake = createFakePilotRuntime({
      services: {
        loadPublicPrecision: async () => ({
          months: [
            AUGUST,
            {
              ...AUGUST,
              month: "2026-07",
              notices: 10,
              outcomes: { ...AUGUST.outcomes, true_concern: 0 },
              useful: { yes: 0, no: 0 },
            },
          ],
          minimum: { notices: 10, families: 3 },
          through: "2026-08",
        }),
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
    const fake = createFakePilotRuntime({
      services: {
        loadPublicPrecision: async () => ({
          months: [AUGUST],
          minimum: { notices: 10, families: 3 },
          through: "2026-08",
        }),
      },
    });

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
