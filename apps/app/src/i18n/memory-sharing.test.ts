import { readFileSync } from "node:fs";
import { createCompiledCatalog } from "@lingui/cli/api";
import { parsePo } from "pofile-ts";
import { expect, it } from "vitest";

it("keeps the English sharing preview complete and compilable without changing the app locale", () => {
  const entries = parsePo(
    readFileSync(new URL("./locales/memory-sharing/en.po", import.meta.url), "utf8"),
  ).items.filter((item) => !item.obsolete);
  expect(entries.length).toBeGreaterThan(30);
  for (const entry of entries) expect(entry.msgstr[0], entry.msgid).toBe(entry.msgid);
  expect(
    createCompiledCatalog(
      "en",
      Object.fromEntries(entries.map((entry) => [entry.msgid, entry.msgstr[0] ?? ""])),
      { strict: true, namespace: "es" },
    ).errors,
  ).toEqual([]);
});
