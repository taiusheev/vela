import { readFileSync } from "node:fs";
import { createCompiledCatalog } from "@lingui/cli/api";
import {
  FORBIDDEN_ZH_TW,
  LATIN_TOUCHING_HAN,
  MAINLAND_TERMS,
  SIMPLIFIED_ONLY,
  SURVEILLANCE_WORDS,
} from "@vela/copy/rules";
import {
  extractVariables,
  type IcuNode,
  type PoFile,
  type PoItem,
  parseIcu,
  parsePo,
  validateIcu,
} from "pofile-ts";
import { describe, expect, it } from "vitest";

/**
 * The app's two catalogs, as `pnpm --filter @vela/app i18n:extract` writes them and a translator
 * fills them. English is the source: its msgids are the words in the code (build plan 3.1).
 */
function read(locale: "en" | "zh-TW"): PoFile {
  return parsePo(readFileSync(new URL(`./locales/${locale}.po`, import.meta.url), "utf8"));
}

const en = read("en");
const zhTW = read("zh-TW");

function keyOf(item: PoItem): string {
  return `${item.msgctxt ?? ""}\u0004${item.msgid}`;
}

function label(item: PoItem): string {
  return item.msgctxt === null ? item.msgid : `${item.msgid} (${item.msgctxt})`;
}

const current = (po: PoFile): PoItem[] => po.items.filter((item) => !item.obsolete);
const english = current(en);
const chinese = current(zhTW);
const translationOf = (item: PoItem): string => item.msgstr[0] ?? "";

/**
 * Placeholders whose values are Latin text or digits, so Traditional Chinese sets them apart from
 * its characters by a space: times ("08:12"), dates ("10月12日" starts with a digit), prices,
 * counts, a phone number, an email address, a code. Every other placeholder holds a name or a word
 * (`name`, `asker`, `day` for a weekday such as 星期四, `language`, `text`…) and touches the
 * characters around it, as a written name does (`packages/copy/src/zh-TW.ts`).
 */
const LATIN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "time",
  // The second time in one sentence (the quiet notice's "and again at…").
  "timeAgain",
  "date",
  "price",
  "count",
  "phone",
  "email",
  "sentTo",
  "shorter",
  "code",
  // A photo's upload in digits ("42%"), and a vote option's number.
  "percent",
  "number",
]);

/** Names that hide a time or a date from the rule above; they are written `time` and `date`. */
const RENAMED: Readonly<Record<string, string>> = { at: "time", arrival: "time", ends: "date" };

/** English msgids that are only the product's name, which Chinese writes in Latin letters too. */
const BRAND_ONLY: ReadonlySet<string> = new Set(["Vela", "Vela Light"]);

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Every sentence an ICU message can become, with its placeholders kept as `{name}` and a plural's
 * `#` as `{count}`: one per branch of each plural or select, so each is checked as it will read.
 */
function sentences(nodes: readonly IcuNode[]): string[] {
  return nodes.reduce<string[]>(
    (sofar, node) => sofar.flatMap((before) => pieces(node).map((piece) => before + piece)),
    [""],
  );
}

function pieces(node: IcuNode): string[] {
  switch (node.type) {
    case "literal":
      return [node.value];
    case "pound":
      return ["{count}"];
    case "plural":
    case "select":
      return Object.values(node.options).flatMap((option) => sentences(option.value));
    case "tag":
      return sentences(node.children);
    default:
      return [`{${node.value}}`];
  }
}

function sentencesOf(message: string): string[] {
  const parsed = parseIcu(message);
  return parsed.success ? sentences(parsed.ast) : [message];
}

/**
 * Latin placeholders as a digit and every other one as a Chinese character, as they will read. A
 * date reads as both: it starts with a digit and ends with 日 ("10月12日"), so it takes a space
 * before it and none after it: its sample is "0 日", whose inner space only keeps this check to
 * the date's first character, and `spacedAfterDate` checks the side after it.
 */
function withSampleValues(sentence: string): string {
  return sentence.replace(PLACEHOLDER, (_placeholder: string, name: string) =>
    name === "date" ? "0 日" : LATIN_PLACEHOLDERS.has(name) ? "0" : "名",
  );
}

/** A date set apart by a space from the Chinese character after it ("10月12日 結束"). */
function spacedAfterDate(sentence: string): boolean {
  return /\{date\}\s+\p{Script=Han}/u.test(sentence);
}

/** A name placeholder set apart from a neighbouring Chinese character by a space. */
function spacedNames(sentence: string): string[] {
  const spaced =
    /\p{Script=Han}\s+\{([A-Za-z_][A-Za-z0-9_]*)\}|\{([A-Za-z_][A-Za-z0-9_]*)\}\s+\p{Script=Han}/gu;
  return [...sentence.matchAll(spaced)]
    .map((match) => match[1] ?? match[2] ?? "")
    .filter((name) => !LATIN_PLACEHOLDERS.has(name));
}

function variablesOf(message: string): string[] {
  return [...new Set(extractVariables(message))].sort();
}

/** Each failing entry with what is wrong with it, so one run lists every line to fix. */
function failures(items: readonly PoItem[], problem: (item: PoItem) => string | null): string[] {
  return items.flatMap((item) => {
    const found = problem(item);
    return found === null ? [] : [`${label(item)} → ${translationOf(item)}: ${found}`];
  });
}

describe("the checks", () => {
  it("read each branch of a plural or select as its own sentence", () => {
    expect(sentencesOf("{count, plural, one {# day with {name}} other {# days}}")).toEqual([
      "{count} day with {name}",
      "{count} days",
    ]);
    expect(sentencesOf("{from}：{kind, select, heart {愛心} other {回覆}}")).toEqual([
      "{from}：愛心",
      "{from}：回覆",
    ]);
  });

  it("see Latin text, digits and Latin placeholders touching Chinese characters", () => {
    expect(withSampleValues("{time}回覆")).toMatch(LATIN_TOUCHING_HAN);
    expect(withSampleValues("試用至{date}")).toMatch(LATIN_TOUCHING_HAN);
    expect(withSampleValues("試用至 {date}結束")).not.toMatch(LATIN_TOUCHING_HAN);
    expect(spacedAfterDate("{date} 結束")).toBe(true);
    expect(spacedAfterDate("到 {date}為止")).toBe(false);
    expect(withSampleValues("Vela回覆")).toMatch(LATIN_TOUCHING_HAN);
    expect(withSampleValues("{time} 回覆，問{name}一件事")).not.toMatch(LATIN_TOUCHING_HAN);
  });

  it("see a space between a name placeholder and a Chinese character", () => {
    expect(spacedNames("問 {name} 一件事")).not.toEqual([]);
    expect(spacedNames("{from} 回覆了")).toEqual(["from"]);
    expect(spacedNames("{time} 回覆，問{name}一件事")).toEqual([]);
  });
});

describe("the catalogs", () => {
  it("hold the same messages in English and Traditional Chinese", () => {
    const englishKeys = english.map(keyOf).sort();
    const chineseKeys = chinese.map(keyOf).sort();
    expect(
      chineseKeys.filter((key) => !englishKeys.includes(key)),
      "only in zh-TW",
    ).toEqual([]);
    expect(
      englishKeys.filter((key) => !chineseKeys.includes(key)),
      "only in en",
    ).toEqual([]);
  });

  it("keep no message the code no longer has", () => {
    expect(en.items.filter((item) => item.obsolete).map(label), "en").toEqual([]);
    expect(zhTW.items.filter((item) => item.obsolete).map(label), "zh-TW").toEqual([]);
  });

  it("are not empty", () => {
    expect(english.length).toBeGreaterThan(0);
  });

  it("mark the Traditional Chinese as awaiting native review until each entry is signed off", () => {
    expect(zhTW.headers["X-Native-Review"] ?? "").toMatch(/^pending; /);
  });
});

describe("the English messages", () => {
  it("are valid ICU", () => {
    expect(
      failures(english, (item) => (validateIcu(item.msgid).valid ? null : "not valid ICU")),
    ).toEqual([]);
  });

  it("name every placeholder, never a position", () => {
    // `${exchange.recipient}` in a macro becomes {0}: a translator cannot tell what it holds.
    expect(
      failures(english, (item) =>
        /\{\d+\}/.test(item.msgid) ? "bind the value to a named local first" : null,
      ),
    ).toEqual([]);
  });

  it("call a time `time` and a date `date`, so their spacing is known", () => {
    expect(
      failures(english, (item) => {
        const renamed = variablesOf(item.msgid).filter((name) => name in RENAMED);
        return renamed.length === 0
          ? null
          : renamed.map((name) => `{${name}} is written {${RENAMED[name]}}`).join(", ");
      }),
    ).toEqual([]);
  });

  it("never frame the family as watched", () => {
    expect(
      failures(english, (item) => (SURVEILLANCE_WORDS.test(item.msgid) ? "surveillance" : null)),
    ).toEqual([]);
  });

  it("compile as the Metro transformer compiles them", () => {
    const messages = Object.fromEntries(english.map((item) => [keyOf(item), item.msgid]));
    expect(createCompiledCatalog("en", messages, { strict: true, namespace: "es" }).errors).toEqual(
      [],
    );
  });
});

describe("the Traditional Chinese messages", () => {
  const sources = new Map(english.map((item) => [keyOf(item), item.msgid]));
  const sourceOf = (item: PoItem): string => sources.get(keyOf(item)) ?? item.msgid;
  const translated = chinese.filter((item) => translationOf(item).trim().length > 0);

  it("are all translated", () => {
    expect(chinese.filter((item) => translationOf(item).trim().length === 0).map(label)).toEqual(
      [],
    );
  });

  it("are valid ICU with exactly the English placeholders", () => {
    expect(
      failures(translated, (item) => {
        const text = translationOf(item);
        if (!validateIcu(text).valid) return "not valid ICU";
        const want = variablesOf(sourceOf(item)).join(", ");
        const have = variablesOf(text).join(", ");
        return want === have ? null : `placeholders {${have}}, English has {${want}}`;
      }),
    ).toEqual([]);
  });

  it("compile as the Metro transformer compiles them", () => {
    const messages = Object.fromEntries(
      translated.map((item) => [keyOf(item), translationOf(item)]),
    );
    expect(
      createCompiledCatalog("zh-TW", messages, { strict: true, namespace: "es" }).errors,
    ).toEqual([]);
  });

  it("never use a gendered pronoun or a surveillance word", () => {
    expect(
      failures(translated, (item) =>
        FORBIDDEN_ZH_TW.test(translationOf(item)) ? "他/她 or a surveillance word" : null,
      ),
    ).toEqual([]);
  });

  it("are written in Traditional characters with Taiwanese words", () => {
    expect(
      failures(translated, (item) => {
        const text = translationOf(item);
        if (SIMPLIFIED_ONLY.test(text)) return "a Simplified character";
        return MAINLAND_TERMS.test(text) ? "a mainland word" : null;
      }),
    ).toEqual([]);
  });

  it("set Latin text, digits and Latin placeholders apart from Chinese characters", () => {
    expect(
      failures(translated, (item) =>
        sentencesOf(translationOf(item)).some((sentence) =>
          LATIN_TOUCHING_HAN.test(withSampleValues(sentence)),
        )
          ? "Latin or a digit touches a Chinese character; put a space between"
          : null,
      ),
    ).toEqual([]);
  });

  it("let a date touch the Chinese characters after it, since it ends with 日", () => {
    expect(
      failures(translated, (item) =>
        sentencesOf(translationOf(item)).some(spacedAfterDate)
          ? "no space after {date}: it ends with 日"
          : null,
      ),
    ).toEqual([]);
  });

  it("let name placeholders touch the Chinese characters around them", () => {
    expect(
      failures(translated, (item) => {
        const spaced = sentencesOf(translationOf(item)).flatMap(spacedNames);
        return spaced.length === 0
          ? null
          : `no space around {${[...new Set(spaced)].join("}, {")}}`;
      }),
    ).toEqual([]);
  });

  it("are Chinese wherever the English has words", () => {
    expect(
      failures(translated, (item) => {
        const source = sourceOf(item);
        if (BRAND_ONLY.has(source)) return null;
        const words = sentencesOf(source).some((sentence) =>
          /[A-Za-z]{2,}/.test(sentence.replace(PLACEHOLDER, "")),
        );
        const han = sentencesOf(translationOf(item)).every((sentence) =>
          /\p{Script=Han}/u.test(sentence),
        );
        return words && !han ? "left in English" : null;
      }),
    ).toEqual([]);
  });
});
