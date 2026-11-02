import { readFileSync } from "node:fs";
import { createCompiledCatalog } from "@lingui/cli/api";
import { extractVariables, parsePo } from "pofile-ts";
import { describe, expect, it } from "vitest";

const read = (locale: string) =>
  parsePo(
    readFileSync(new URL(`./locales/memory-review/${locale}.po`, import.meta.url), "utf8"),
  ).items.filter((item) => !item.obsolete);
describe("the isolated memory-review catalog", () => {
  it("translates every English message and preserves interpolation in Traditional Chinese", () => {
    const en = read("en");
    const zh = read("zh-TW");
    expect(zh.map((item) => item.msgid).sort()).toEqual(en.map((item) => item.msgid).sort());
    for (const item of zh) {
      const value = item.msgstr[0] ?? "";
      expect(value.trim(), item.msgid).not.toBe("");
      expect(extractVariables(value)).toEqual(extractVariables(item.msgid));
    }
    expect(
      createCompiledCatalog(
        "zh-TW",
        Object.fromEntries(zh.map((item) => [item.msgid, item.msgstr[0] ?? ""])),
        { strict: true, namespace: "es" },
      ).errors,
    ).toEqual([]);
  });
});
