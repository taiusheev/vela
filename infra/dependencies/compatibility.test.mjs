import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const fromPackage = (name) => createRequire(require.resolve(name));

test("router query strings preserve Chinese, repeated values, plus signs and fragments", () => {
  const query = fromPackage("expo-router")("query-string");
  const input = { name: "測試家人", words: ["a+b", "morning light"] };
  const encoded = query.stringifyUrl({ url: "/questions", query: input, fragmentIdentifier: "first" });
  const parsed = query.parseUrl(encoded, { parseFragmentIdentifier: true });
  assert.deepEqual({ ...parsed.query }, input);
  assert.equal(parsed.url, "/questions");
  assert.equal(parsed.fragmentIdentifier, "first");
  assert.equal(query.parse("words=a+b").words, "a b");
  assert.equal(query.parse("words=%zz%41").words, "%zzA");
});

test("malformed deep-link queries finish within a bounded subprocess", () => {
  const queryPath = fromPackage("expo-router").resolve("query-string");
  // A child deadline turns the vulnerable decoder's event-loop stall into a failed test.
  const script = `
    const assert = require('node:assert/strict');
    const query = require(${JSON.stringify(queryPath)});
    const words = query.parse('words=' + '%FF%41'.repeat(40000)).words;
    assert.equal(words, '%FFA'.repeat(40000));
  `;
  execFileSync(process.execPath, ["--max-old-space-size=128", "-e", script], {
    timeout: 3000,
    stdio: "pipe",
  });
});

test("Apple target asset discovery and fingerprint ignore rules retain their APIs", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "vela-dependency-assets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "targets", "lamp"), { recursive: true });
  await writeFile(path.join(directory, "targets", "lamp", "expo-target.config.js"), "module.exports = {};");
  const glob = fromPackage("@bacons/apple-targets")("glob");
  assert.deepEqual(glob.globSync("targets/*/expo-target.config.@(json|js)", { cwd: directory }), [
    "targets/lamp/expo-target.config.js",
  ]);
  const { isIgnoredPath } = require("@expo/fingerprint/build/utils/Path.js");
  assert.equal(isIgnoredPath("images/private/photo.jpg", ["**/private/**"]), true);
  assert.equal(isIgnoredPath("images/lamp.png", ["**/private/**"]), false);
});

test("fingerprint traversal honours an already-cancelled request", async () => {
  const { glob } = fromPackage("@expo/fingerprint")("glob");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(glob("**/*", { cwd: tmpdir(), signal: controller.signal }), {
    name: "AbortError",
  });
});

test("Apple target image metadata is written through its real prebuild dependency", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "vela-dependency-icons-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const assets = fromPackage("@bacons/apple-targets")(
    "@expo/prebuild-config/build/plugins/icons/AssetContents",
  );
  const image = { filename: "synthetic-lamp.png", idiom: "universal", scale: "2x" };
  await assets.writeContentsJsonAsync(directory, { images: [image] });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "Contents.json"), "utf8")), {
    images: [image],
    info: { version: 1, author: "expo" },
  });
});

test("the Xcode UUID dependency rejects a short destination buffer", () => {
  const { v5, validate } = fromPackage("@bacons/xcode")("uuid");
  assert.equal(validate(v5("synthetic-lamp", v5.URL)), true);
  assert.throws(() => v5("synthetic-lamp", v5.URL, new Uint8Array(1)), RangeError);
});

test("Drizzle's legacy loader still transforms TypeScript with its patched compiler", async () => {
  const { transform } = require("@esbuild-kit/core-utils");
  const result = await transform("export const count: number = 42;", "/tmp/vela-synthetic-schema.ts", {
    format: "cjs",
  });
  const module = { exports: {} };
  runInNewContext(result.code, { module, exports: module.exports });
  assert.equal(module.exports.count, 42);
});
