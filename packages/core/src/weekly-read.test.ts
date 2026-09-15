import { type Lang, OutboundMessage } from "@vela/contracts";
import { describe, expect, it } from "vitest";
import {
  type RenderWeeklyReadInput,
  renderWeeklyRead,
  type WeeklyReadStats,
} from "./weekly-read.ts";

const FULL_WEEK: WeeklyReadStats = {
  countedDays: 7,
  answeredDays: 6,
  helloMornings: 2,
  familyAsks: 5,
};

const LINES = [
  "Mom usually answered around 08:50, later than usual.",
  "Mom taught Anna the braised pork with rock sugar.",
  "The tomatoes were mentioned twice.",
];

const SUGGESTION = "Mom, which Taiwanese word should Mia learn next?";

function input(overrides: Partial<RenderWeeklyReadInput> = {}): RenderWeeklyReadInput {
  return {
    lang: "en",
    name: "Mom",
    stats: FULL_WEEK,
    lines: LINES,
    suggestion: SUGGESTION,
    audience: "organiser",
    ...overrides,
  };
}

/** A render that must produce text; a null here is a failure of the test, not a value to check. */
function text(overrides: Partial<RenderWeeklyReadInput> = {}): string {
  const rendered = renderWeeklyRead(input(overrides));
  if (rendered === null) {
    throw new Error("expected a rendered weekly read");
  }
  return rendered;
}

function expectSendable(rendered: string, lang: Lang): void {
  const parsed = OutboundMessage.safeParse({
    kind: "weekly_read",
    idempotencyKey: "weekly_read:test",
    lang,
    to: { channel: "telegram", conversationId: "12345" },
    text: rendered,
  });
  expect(parsed.success).toBe(true);
}

describe("renderWeeklyRead for organisers", () => {
  it("opens with the counts, then the lines, then the suggestion, in English", () => {
    expect(text()).toBe(
      [
        "Mom answered 6 of 7 days.",
        "On 2 mornings nobody in the family asked, so Vela sent Mom a hello.",
        "",
        "Mom usually answered around 08:50, later than usual.",
        "Mom taught Anna the braised pork with rock sugar.",
        "The tomatoes were mentioned twice.",
        "",
        "Something to ask next week: Mom, which Taiwanese word should Mia learn next?",
      ].join("\n"),
    );
  });

  it("opens with the counts, then the lines, then the suggestion, in Traditional Chinese", () => {
    const rendered = text({
      lang: "zh-TW",
      name: "阿嬤",
      lines: ["阿嬤通常在 08:50 左右回覆，比平常晚。", "番茄提到了不只一次。"],
      suggestion: "阿嬤，下次再教 Mia 一句台語好嗎？",
    });

    expect(rendered).toBe(
      [
        "阿嬤這週 7 天中回覆了 6 天。",
        "有 2 天早上家裡沒有人提問，Vela 就傳了早安問候給阿嬤。",
        "",
        "阿嬤通常在 08:50 左右回覆，比平常晚。",
        "番茄提到了不只一次。",
        "",
        "下週可以問問看：阿嬤，下次再教 Mia 一句台語好嗎？",
      ].join("\n"),
    );
  });

  it("says day and morning for exactly one, and days and mornings otherwise", () => {
    const one = text({
      stats: { countedDays: 1, answeredDays: 1, helloMornings: 1, familyAsks: 1 },
      lines: [],
      suggestion: "",
    });
    const zero = text({
      stats: { countedDays: 7, answeredDays: 0, helloMornings: 1, familyAsks: 3 },
      lines: [],
      suggestion: "",
    });

    expect(one).toBe(
      "Mom answered 1 of 1 day.\nOn 1 morning nobody in the family asked, so Vela sent Mom a hello.",
    );
    expect(zero).toBe(
      "Mom answered 0 of 7 days.\nOn 1 morning nobody in the family asked, so Vela sent Mom a hello.",
    );
  });

  it("uses the one Chinese form for a single day and a single morning", () => {
    const rendered = text({
      lang: "zh-TW",
      name: "阿公",
      stats: { countedDays: 1, answeredDays: 1, helloMornings: 1, familyAsks: 1 },
      lines: [],
      suggestion: "",
    });

    expect(rendered).toBe(
      "阿公這週 1 天中回覆了 1 天。\n有 1 天早上家裡沒有人提問，Vela 就傳了早安問候給阿公。",
    );
  });

  it("counts only the days since the light started in a first week, with no hello line when every morning had an ask", () => {
    const rendered = text({
      stats: { countedDays: 3, answeredDays: 2, helloMornings: 0, familyAsks: 3 },
    });

    expect(rendered.split("\n\n")[0]).toBe("Mom answered 2 of 3 days.");
  });

  it("says plainly that nobody asked when the family sent no ask, instead of counting hello mornings", () => {
    const en = text({
      stats: { countedDays: 7, answeredDays: 5, helloMornings: 7, familyAsks: 0 },
    });
    const zh = text({
      lang: "zh-TW",
      name: "阿嬤",
      stats: { countedDays: 7, answeredDays: 5, helloMornings: 7, familyAsks: 0 },
    });

    expect(en.split("\n\n")[0]).toBe(
      "Mom answered 5 of 7 days.\nNobody in the family asked Mom anything this week.",
    );
    expect(zh.split("\n\n")[0]).toBe("阿嬤這週 7 天中回覆了 5 天。\n這週家裡沒有人問阿嬤任何事。");
  });

  it("gives a read with no lines its counts and suggestion", () => {
    expect(text({ lines: ["  ", ""] })).toBe(
      [
        "Mom answered 6 of 7 days.",
        "On 2 mornings nobody in the family asked, so Vela sent Mom a hello.",
        "",
        "Something to ask next week: Mom, which Taiwanese word should Mia learn next?",
      ].join("\n"),
    );
  });

  it("leaves out a suggestion the founder emptied", () => {
    expect(text({ suggestion: "  " }).endsWith("The tomatoes were mentioned twice.")).toBe(true);
  });

  it.each<{ name: string; stats: WeeklyReadStats }>([
    { name: "more days answered than counted", stats: { ...FULL_WEEK, answeredDays: 8 } },
    { name: "no counted day", stats: { ...FULL_WEEK, countedDays: 0, answeredDays: 0 } },
    { name: "more than a week", stats: { ...FULL_WEEK, countedDays: 8 } },
    { name: "more hello mornings than days", stats: { ...FULL_WEEK, helloMornings: 8 } },
    { name: "a fractional count", stats: { ...FULL_WEEK, answeredDays: 5.5 } },
    { name: "negative asks", stats: { ...FULL_WEEK, familyAsks: -1 } },
  ])("refuses stats with $name", ({ stats }) => {
    expect(() => renderWeeklyRead(input({ stats }))).toThrow(RangeError);
  });
});

describe("renderWeeklyRead for her", () => {
  it("shows only the lines", () => {
    expect(text({ audience: "kept_light_member" })).toBe(LINES.join("\n"));
  });

  it("shows no weekly read at all when there are no lines", () => {
    expect(renderWeeklyRead(input({ audience: "kept_light_member", lines: [] }))).toBeNull();
    expect(renderWeeklyRead(input({ audience: "kept_light_member", lines: [" "] }))).toBeNull();
  });

  it.each<{ lang: Lang; name: string; stats: WeeklyReadStats }>([
    { lang: "en", name: "Mom", stats: FULL_WEEK },
    { lang: "en", name: "Mom", stats: { ...FULL_WEEK, helloMornings: 1 } },
    { lang: "en", name: "Mom", stats: { ...FULL_WEEK, helloMornings: 7, familyAsks: 0 } },
    { lang: "zh-TW", name: "阿嬤", stats: FULL_WEEK },
    { lang: "zh-TW", name: "阿嬤", stats: { ...FULL_WEEK, helloMornings: 7, familyAsks: 0 } },
  ])(
    "never shows her a count, the nobody-asked line, or the suggestion ($lang, $stats.familyAsks asks)",
    ({ lang, name, stats }) => {
      const organisers = text({ lang, name, stats, audience: "organiser" }).split("\n\n");
      const countLines = (organisers[0] ?? "").split("\n");
      const suggestion = organisers[2] ?? "";
      expect(countLines).toHaveLength(2);
      expect(suggestion).toContain(SUGGESTION);

      const hers = text({ lang, name, stats, audience: "kept_light_member" });

      for (const line of [...countLines, suggestion]) {
        expect(hers).not.toContain(line);
      }
      expect(hers).not.toContain(SUGGESTION);
      expect(hers).toBe(LINES.join("\n"));
    },
  );

  it("does not need valid stats, which she never sees", () => {
    const stats = { ...FULL_WEEK, answeredDays: 9 };

    expect(text({ audience: "kept_light_member", stats })).toBe(LINES.join("\n"));
  });
});

describe("renderWeeklyRead length", () => {
  const longLines = ["a", "b", "c", "d"].map((letter) => `${letter} ${"word ".repeat(700)}`);
  const longSuggestion = `Mom, ${"tell me more ".repeat(200)}?`;

  it.each<Lang>(["en", "zh-TW"])(
    "keeps an organiser's read within 4000 characters without shortening the counts or dropping a line (%s)",
    (lang) => {
      const full = text({ lang, lines: longLines, suggestion: longSuggestion });

      expect(full.length).toBeLessThanOrEqual(4000);
      expectSendable(full, lang);
      const [counts = "", lines = "", suggestion = ""] = full.split("\n\n");
      expect(counts).toBe(text({ lang, lines: [], suggestion: "" }));
      const shortened = lines.split("\n");
      expect(shortened).toHaveLength(4);
      for (const [index, line] of shortened.entries()) {
        expect(line.endsWith("…")).toBe(true);
        expect(longLines[index]?.startsWith(line.slice(0, -1))).toBe(true);
      }
      expect(suggestion.endsWith("…")).toBe(true);
      expect(suggestion.length).toBeGreaterThan(100);
    },
  );

  it("keeps her copy within 4000 characters", () => {
    const hers = text({ audience: "kept_light_member", lines: longLines });

    expect(hers.length).toBeLessThanOrEqual(4000);
    expectSendable(hers, "en");
    expect(hers.split("\n")).toHaveLength(4);
  });

  it("leaves a read that fits untouched", () => {
    const lines = ["x".repeat(900), "y".repeat(900), "z".repeat(900), "w".repeat(900)];

    expect(text({ audience: "kept_light_member", lines })).toBe(lines.join("\n"));
  });
});
