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

test("upstream receives only allowed headers and redirects return to the public domain", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let called = false;
    globalThis.fetch = async (url, init) => {
      called = true;
      assert.equal(String(url), "https://vela.vela-light-staging.workers.dev/waitlist");
      assert.equal(init.headers.get("cookie"), null);
      assert.equal(init.headers.get("authorization"), null);
      assert.equal(init.headers.get("origin"), "https://vela-light.com");
      return new Response(null, {status:303, headers:{location:"https://vela.vela-light-staging.workers.dev/?joined=1", "set-cookie":"private=x"}});
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
