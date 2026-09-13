import { LANGS, type Lang, MVP_LANGS } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import { catalogs, type MessageKey, t } from "./index.ts";

const englishKeys = Object.keys(catalogs.en) as MessageKey[];

const langsWithoutCatalog = LANGS.filter((lang) => !(MVP_LANGS as readonly Lang[]).includes(lang));

function sampleParams(template: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of template.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const name = match[1];
    if (name !== undefined) {
      params[name] = `<${name}>`;
    }
  }
  return params;
}

describe("t", () => {
  it("substitutes a parameter", () => {
    expect(t("en", "arrival.greeting", { address: "Mrs Chen" })).toBe("Good morning, Mrs Chen.");
  });

  it("renders the requested catalog", () => {
    expect(t("zh-TW", "arrival.greeting", { address: "陳媽媽" })).toBe("陳媽媽，早安。");
  });

  it("substitutes every occurrence of a placeholder", () => {
    expect(t("en", "consent.request", { organiser: "Anna" })).toBe(
      "Anna would like to keep a light on for you. Every morning someone in the family will ask you something, and when you answer, they will know you are fine. If there is no answer by evening, Anna will know to call. You can say stop at any time.",
    );
  });

  it("renders numbers", () => {
    expect(t("en", "group.answer_pick", { name: "Mom", n: 2 })).toBe("Mom picked photo 2.");
  });

  it("returns a message without placeholders unchanged", () => {
    expect(t("en", "arrival.late")).toBe("Sorry this is late.");
    expect(t("en", "arrival.late", {})).toBe("Sorry this is late.");
  });

  it.each(langsWithoutCatalog)("falls back to English for %s", (lang) => {
    expect(t(lang, "arrival.greeting", { address: "Oma" })).toBe("Good morning, Oma.");
  });

  it("falls back to English for a language value that names an Object.prototype member", () => {
    expect(t("toString" as Lang, "arrival.late")).toBe("Sorry this is late.");
  });

  it("inserts values literally, without reading them as placeholders or replacement patterns", () => {
    expect(t("en", "readback.replied", { name: "Mia", text: "{name} and $& and $1" })).toBe(
      "Mia: {name} and $& and $1",
    );
  });

  it("throws naming the message and the parameter when a parameter is missing", () => {
    expect(() => t("en", "arrival.greeting")).toThrow(
      'Message "arrival.greeting" (language en) is missing the parameter "address"',
    );
    expect(() => t("zh-TW", "quiet.notice", { name: "Mom", sent: "08:30" })).toThrow(
      'Message "quiet.notice" (language zh-TW) is missing the parameter "usual"',
    );
  });

  it("does not take an inherited property as a parameter", () => {
    const prototype: Record<string, string> = { name: "Mia" };
    const inherited: Record<string, string> = Object.create(prototype);
    expect(() => t("en", "readback.voice", inherited)).toThrow(
      'Message "readback.voice" (language en) is missing the parameter "name"',
    );
  });

  it("throws naming the parameter when a parameter has no placeholder", () => {
    expect(() => t("en", "arrival.late", { address: "Mrs Chen" })).toThrow(
      'Message "arrival.late" (language en) has no placeholder for the parameter "address"',
    );
  });

  it("throws on a key that is not in the catalog", () => {
    expect(() => t("en", "arrival.nope" as MessageKey)).toThrow(
      'Unknown message key "arrival.nope"',
    );
  });

  it.each(MVP_LANGS)("renders every %s message completely when given its parameters", (lang) => {
    for (const key of englishKeys) {
      const params = sampleParams(catalogs.en[key]);
      const text = t(lang, key, params);
      expect(text, `${lang} ${key}`).not.toMatch(/[{}]/);
      for (const value of Object.values(params)) {
        expect(text, `${lang} ${key}`).toContain(value);
      }
    }
  });
});
