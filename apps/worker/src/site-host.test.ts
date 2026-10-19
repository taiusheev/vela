import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { PilotEnv } from "./env.ts";
import { createWorker } from "./pilot-worker.ts";
import { createFakePilotRuntime, namesOf, testEnv } from "./testing/fakes.ts";

const public_: PilotEnv = { ...testEnv, ENVIRONMENT: "staging", SITE_HOST: "vela-light.com" };

async function send(request: Request | string, env: PilotEnv = public_) {
  const fake = createFakePilotRuntime();
  const ctx = createExecutionContext();
  const response = await createWorker(fake.runtime).fetch(
    typeof request === "string" ? new Request(request) : request,
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { response, fake };
}

describe("the website's own address", () => {
  it("serves the website, indexed, with canonical links on its own address", async () => {
    const { response } = await send("https://vela-light.com/zh-TW");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('name="robots"');
    expect(body).toContain('<link rel="canonical" href="https://vela-light.com/zh-TW">');
  });

  it("keeps workers.dev out of search engines and points its canonical links at the site", async () => {
    const { response } = await send("https://vela.vela-light-staging.workers.dev/");
    const body = await response.text();

    expect(body).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(body).toContain('<link rel="canonical" href="https://vela-light.com/">');
  });

  it("sends www. to the bare domain, path and query kept", async () => {
    const { response } = await send("https://www.vela-light.com/how-vela-is-doing?ref=x");

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://vela-light.com/how-vela-is-doing?ref=x");
  });

  // The webhooks, her phone's routes, the media LINE fetches and the API stay on workers.dev.
  it.each([
    ["POST", "/webhooks/telegram"],
    ["POST", "/webhooks/line"],
    ["POST", "/webhooks/clerk"],
    ["GET", "/v1/me"],
    ["POST", "/device/messages"],
    ["GET", "/media/a/b"],
    ["GET", "/healthz"],
    ["GET", "/admin"],
  ])("answers 404 to %s %s on the public address and runs nothing", async (method, path) => {
    const { response, fake } = await send(new Request(`https://vela-light.com${path}`, { method }));

    expect(response.status).toBe(404);
    expect(namesOf(fake.calls)).toEqual([]);
    expect(fake.built()).toBe(0);
  });

  it("still takes the waitlist and serves the privacy notice there", async () => {
    const form = await send(
      new Request("https://vela-light.com/waitlist", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: "a@b.co", lang: "en" }),
      }),
    );
    const privacy = await send("https://vela-light.com/privacy");

    expect(form.response.status).toBe(303);
    expect(namesOf(form.fake.calls)).toEqual(["joinWaitlist"]);
    expect(privacy.response.status).toBe(200);
  });

  it("leaves every other address as it was when no site host is set", async () => {
    const { response } = await send("https://vela-light.com/healthz", testEnv);

    expect(response.status).not.toBe(404);
  });

  it("invites crawlers on its own address and turns them away elsewhere", async () => {
    const own = await (await send("https://vela-light.com/robots.txt")).response.text();
    const other = await (
      await send("https://vela.vela-light-staging.workers.dev/robots.txt")
    ).response.text();
    const map = await (await send("https://vela-light.com/sitemap.xml")).response.text();

    expect(own).toBe("User-agent: *\nAllow: /\nSitemap: https://vela-light.com/sitemap.xml\n");
    expect(other).toBe("User-agent: *\nDisallow: /\n");
    expect(map).toContain("<loc>https://vela-light.com/zh-TW/how-vela-is-doing</loc>");
    expect(map.match(/<url>/g)).toHaveLength(6);
  });
});
