import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

test("website bridge protects nonwebsite paths and preserves www destinations", async () => {
  for (const path of ["/v1/me", "/admin", "/webhooks/telegram", "/media/private", "/site/../v1/me"]) {
    assert.equal((await worker.fetch(new Request(`https://vela-light.com${path}`))).status, 404);
  }
  const redirect = await worker.fetch(new Request("https://www.vela-light.com/zh-TW?ref=launch"));
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "https://vela-light.com/zh-TW?ref=launch");
  assert.equal((await worker.fetch(new Request("https://vela-light.com/", {method:"POST"}))).status, 405);
  assert.equal((await worker.fetch(new Request("https://vela-light.com/waitlist", {method:"POST", headers:{origin:"https://other.example"}}))).status, 403);
});

test("website bridge forces the first visit onto HTTPS and protects its own responses", async () => {
  const response = await worker.fetch(new Request("http://vela-light.com/zh-TW?ref=launch"));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://vela-light.com/zh-TW?ref=launch");
  assert.match(response.headers.get("strict-transport-security"), /max-age=31536000/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("upstream receives only allowed headers and redirects return to the public domain", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let called = false;
    globalThis.fetch = async (url, init) => {
      called = true;
      assert.equal(String(url), "https://vela.vela-light.workers.dev/waitlist");
      assert.equal(init.headers.get("cookie"), null);
      assert.equal(init.headers.get("authorization"), null);
      assert.equal(init.headers.get("origin"), "https://vela-light.com");
      return new Response(null, {status:303, headers:{location:"https://vela.vela-light.workers.dev/?joined=1", "set-cookie":"private=x"}});
    };
    const result = await worker.fetch(new Request("https://vela-light.com/waitlist", {method:"POST", body:"email=test", headers:{origin:"https://vela-light.com",cookie:"private=secret",authorization:"Bearer secret"}}));
    assert.equal(called, true);
    assert.equal(result.headers.get("location"), "https://vela-light.com/?joined=1");
    assert.equal(result.headers.get("set-cookie"), null);
  } finally { globalThis.fetch = originalFetch; }
});

test("public robots allow indexing and upstream failures return a bounded error", async () => {
  const robots = await worker.fetch(new Request("https://vela-light.com/robots.txt"));
  assert.match(await robots.text(), /Allow: \/\nSitemap: https:\/\/vela-light.com\/sitemap.xml/);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("private provider detail"); };
    const result = await worker.fetch(new Request("https://vela-light.com/"));
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /private/);
  } finally { globalThis.fetch = originalFetch; }
});

test("production bridge forwards both languages' legal pages and optional analytics only", async () => {
  const originalFetch = globalThis.fetch;
  const called = [];
  try {
    globalThis.fetch = async (url, init) => {
      called.push(String(url));
      assert.equal(new URL(url).origin, "https://vela.vela-light.workers.dev");
      assert.equal(init.headers.get("authorization"), null);
      assert.equal(init.headers.get("cookie"), null);
      return new Response(null, { status: 200 });
    };
    for (const path of ["/terms", "/security", "/data-rights", "/zh-TW/terms", "/zh-TW/security", "/zh-TW/data-rights", "/analytics/config"]) {
      const result = await worker.fetch(new Request(`https://vela-light.com${path}`));
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("x-vela-website"), "domain-bridge-v3-production");
    }
    const result = await worker.fetch(new Request("https://vela-light.com/analytics/event", {
      method: "POST", headers: { origin: "https://vela-light.com", "content-type": "application/json" }, body: "{}",
    }));
    assert.equal(result.status, 200);
    assert.equal(called.length, 8);
  } finally { globalThis.fetch = originalFetch; }
});

test("write endpoints reject foreign or missing origins and wrong methods before upstream fetch", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("must not forward"); };
    for (const path of ["/waitlist", "/analytics/event"]) {
      for (const origin of [undefined, "https://evil.example", "null"]) {
        const result = await worker.fetch(new Request(`https://vela-light.com${path}`, {
          method: "POST", headers: origin ? { origin } : {}, body: "{}",
        }));
        assert.equal(result.status, 403);
      }
      assert.equal((await worker.fetch(new Request(`https://vela-light.com${path}`))).status, 405);
    }
    assert.equal((await worker.fetch(new Request("https://vela-light.com/analytics/config", {method:"POST"}))).status, 405);
  } finally { globalThis.fetch = originalFetch; }
});
