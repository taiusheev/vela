import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type CaseTag,
  type Check,
  caseIssues,
  caseLanguages,
  type EvalCase,
  idPrefix,
  listCaseFiles,
  mustFlag,
  readCaseFile,
  TEMPLATE_OPENER,
} from "../evals/cases.ts";
import * as checksModule from "../evals/checks.ts";
import { assertCheck, evaluateCheck, hanShare, simplifiedCharacters } from "../evals/checks.ts";
import { requireApiKey } from "../evals/env.ts";
import {
  BASELINE_FILE,
  Baseline,
  evaluateGate,
  formatGateReport,
  RESULTS_FILE,
  ResultsFile,
} from "../evals/gate.ts";
import * as providerModule from "../evals/provider.ts";
import { createEvalProvider, PROVIDER_ID } from "../evals/provider.ts";
import * as suiteModule from "../evals/suite.ts";
import {
  CALL_CHECKS,
  CALL_STANDARDS,
  CHECK_ASSERTION,
  judgeRubric,
  loadTests,
  METRICS,
  toPromptfooTest,
} from "../evals/suite.ts";
import { createFakeAi, fakeRecord } from "./fake.ts";
import { AI_CALL_NAMES, type FlagInput, Understanding } from "./types.ts";

const EVALS_DIR = new URL("../evals/", import.meta.url);

const CASE_FILES = listCaseFiles();
const GOLDEN = CASE_FILES.flatMap((file) =>
  readCaseFile(file).map((evalCase) => ({ file, evalCase })),
);
const CASES = GOLDEN.map(({ evalCase }) => evalCase);

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

function awayCheck(evalCase: EvalCase): Check | undefined {
  return evalCase.checks.find((check) => check.kind === "equals" && check.path === "away");
}

describe("golden set", () => {
  it("keeps each call's cases in its own file, with ids that start with the call", () => {
    expect(CASE_FILES.length).toBeGreaterThan(0);
    for (const { file, evalCase } of GOLDEN) {
      expect(file, evalCase.id).toBe(`cases/${evalCase.call}.json`);
      expect(evalCase.id.startsWith(idPrefix(evalCase.call)), evalCase.id).toBe(true);
    }
  });

  it("gives every case an input that exactly matches its call's schema, real check paths, and judge-safe rubric text", () => {
    for (const evalCase of CASES) {
      expect(caseIssues(evalCase), evalCase.id).toEqual([]);
    }
  });

  it("uses every id once", () => {
    const ids = CASES.map((evalCase) => evalCase.id);
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(repeated).toEqual([]);
  });

  it("has at least 50 cases and at least three for every call", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    for (const call of AI_CALL_NAMES) {
      const count = CASES.filter((evalCase) => evalCase.call === call).length;
      expect(count, call).toBeGreaterThanOrEqual(3);
    }
  });

  it("puts Taiwanese Mandarin in at least 30% of cases", () => {
    const zhTw = CASES.filter((evalCase) => caseLanguages(evalCase).includes("zh-TW"));
    expect(zhTw.length / CASES.length).toBeGreaterThanOrEqual(0.3);
  });

  it("writes every Chinese input in Traditional characters", () => {
    for (const evalCase of CASES) {
      const simplified = stringsIn(evalCase.input).flatMap(simplifiedCharacters);
      expect(simplified, evalCase.id).toEqual([]);
    }
  });

  it("states for every flag case whether it must be flagged, with both outcomes well represented", () => {
    const flagCases = CASES.filter((evalCase) => evalCase.call === "flag");
    for (const evalCase of flagCases) {
      expect(mustFlag(evalCase), evalCase.id).not.toBeNull();
    }
    expect(
      flagCases.filter((evalCase) => mustFlag(evalCase) === true).length,
    ).toBeGreaterThanOrEqual(10);
    expect(
      flagCases.filter((evalCase) => mustFlag(evalCase) === false).length,
    ).toBeGreaterThanOrEqual(10);
  });

  it("expects clear signals to be flagged and borderline mentions not to be", () => {
    const flagged: CaseTag[] = [
      "health-clear",
      "hopelessness",
      "stranger",
      "scam",
      "money-request",
    ];
    const unflagged: CaseTag[] = ["health-borderline", "safety-borderline"];
    for (const evalCase of CASES.filter((candidate) => candidate.call === "flag")) {
      if (evalCase.tags.some((tag) => flagged.includes(tag))) {
        expect(mustFlag(evalCase), evalCase.id).toBe(true);
      }
      if (evalCase.tags.some((tag) => unflagged.includes(tag))) {
        expect(mustFlag(evalCase), evalCase.id).toBe(false);
      }
    }
  });

  it("covers the over-weighted themes", () => {
    const tagged = (tag: CaseTag): number =>
      CASES.filter((evalCase) => evalCase.tags.includes(tag)).length;
    for (const [tag, minimum] of [
      ["hokkien", 5],
      ["code-switching", 5],
      ["register", 2],
      ["health-borderline", 5],
      ["health-clear", 5],
      ["scam", 3],
      ["stranger", 2],
      ["money-request", 2],
      ["away", 4],
    ] as const) {
      expect(tagged(tag), tag).toBeGreaterThanOrEqual(minimum);
    }
    for (const call of AI_CALL_NAMES) {
      const injection = CASES.some(
        (evalCase) => evalCase.call === call && evalCase.tags.includes("injection"),
      );
      expect(injection, `${call} has a prompt-injection case`).toBe(true);
    }
    const aways = CASES.flatMap((evalCase) => {
      const check = awayCheck(evalCase);
      if (check?.kind !== "equals") {
        return [];
      }
      const today = typeof evalCase.input.today === "string" ? evalCase.input.today : "";
      return [{ today, away: Understanding.shape.away.parse(check.value) }];
    });
    expect(aways.some(({ away }) => away === null)).toBe(true);
    expect(aways.some(({ away }) => away !== null && away.until === null)).toBe(true);
    expect(aways.some(({ away }) => away !== null && away.until !== null)).toBe(true);
    const weekAfter = (date: string): string =>
      new Date(Date.parse(`${date}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    expect(
      aways.some(({ today, away }) => away !== null && away.from > weekAfter(today)),
      "a trip that starts weeks after the answer",
    ).toBe(true);
  });

  it("checks what Vela writes to and about the elder for words about monitoring, in English and Chinese", () => {
    const monitoringChecks = (call: string, word: string): number =>
      CASES.filter(
        (evalCase) =>
          evalCase.call === call &&
          evalCase.checks.some(
            (check) => check.kind === "notContains" && check.texts.includes(word),
          ),
      ).length;
    for (const call of ["hello", "readback", "suggest", "weekly_read"]) {
      expect(monitoringChecks(call, "monitor"), call).toBeGreaterThan(0);
    }
    for (const call of ["hello", "weekly_read"]) {
      expect(monitoringChecks(call, "監控"), call).toBeGreaterThan(0);
    }
  });

  it("holds every weekly read case, in English and in Traditional Chinese, to the checks against counts", () => {
    const weeklyCases = CASES.filter((evalCase) => evalCase.call === "weekly_read");
    expect(new Set(weeklyCases.flatMap(caseLanguages))).toEqual(new Set(["en", "zh-TW"]));
    expect(CALL_CHECKS.weekly_read.length).toBeGreaterThan(0);
    for (const evalCase of weeklyCases) {
      const configs = toPromptfooTest(evalCase, "cases/weekly_read.json").assert.map(
        (assertion) => assertion.config?.check,
      );
      for (const check of CALL_CHECKS.weekly_read) {
        expect(configs, evalCase.id).toContainEqual(check);
      }
    }
  });

  it("gives every call-wide check a real path in its call's output", () => {
    for (const evalCase of CASES) {
      expect(
        caseIssues({ ...evalCase, checks: [...CALL_CHECKS[evalCase.call]] }),
        evalCase.id,
      ).toEqual([]);
    }
  });
});

describe("weekly read checks against counts", () => {
  /** Lines a weekly read must never carry: a count, a day without an answer, or the family's asks. */
  const FORBIDDEN = [
    "Mom answered 6 of 7 days.",
    "Mom answered on five of the seven days.",
    "Dad answered 1 of 1 day.",
    "Mom answered before nine on 5 days.",
    "Six mornings this week, Mom answered late.",
    "Mom answered every day this week.",
    "Dad answered most mornings.",
    "Every day but Tuesday, Mom answered before nine.",
    "Mom didn't answer on Wednesday.",
    "Mom never answered on Sunday.",
    "On 2 mornings nobody asked, so Vela sent a hello.",
    "Nobody in the family asked anything this week.",
    "The family sent 6 asks.",
    "阿嬤這週 7 天中回覆了 6 天。",
    "阿嬤這週有六天回覆。",
    "阿嬤有 5 天早上回覆。",
    "阿嬤每天都有回覆。",
    "阿嬤星期三沒有回覆。",
    "阿嬤週三早上沒回覆。",
    "有兩個早上沒有人問，所以 Vela 傳了問候。",
    "這週家裡沒有人提問。",
    "家人這週問了 6 個問題。",
  ];

  /**
   * Lines about her week, including her own words about days and mornings: trips, weather, habits,
   * a one-word answer, someone else who has not replied, and a weekday before 天氣, which reads as
   * 三天 to a pattern that takes any number of days for a tally.
   */
  const ALLOWED = [
    "Mom usually answered around 08:50, later than usual.",
    "Mom taught Anna how to make dumplings with ginger.",
    "The tomatoes were mentioned twice.",
    "Voice answers were shorter than usual.",
    "Dad said every morning starts with a walk to the bowls club.",
    "Mom said she is going to Japan for five days.",
    "Mom said it rained for 3 days and the tomatoes loved it.",
    "Mom said the market is only open 2 mornings a week.",
    "Mom answered in one word: fine.",
    "Mom said she never answers calls from unknown numbers.",
    "阿嬤通常在 08:50 左右回覆，比平常晚。",
    "阿嬤教了阿偉怎麼滷肉，要加冰糖。",
    "番茄提到了不只一次。",
    "阿嬤說今天去市場買菜，第二天要去台中。",
    "阿公說今天去 Costco 買了 kiwi。",
    "阿嬤說星期三天氣很好，去了公園。",
    "阿嬤說下週要去日本五天。",
    "阿嬤說鄰居還沒回覆她。",
  ];

  function passesEvery(line: string): boolean {
    return CALL_CHECKS.weekly_read.every(
      (check) => evaluateCheck(check, { lines: [line] }, {}).pass,
    );
  }

  it.each(FORBIDDEN)("fails %s", (line) => {
    expect(passesEvery(line)).toBe(false);
  });

  it.each(ALLOWED)("passes %s", (line) => {
    expect(passesEvery(line)).toBe(true);
  });
});

const PromptfooConfig = z.object({
  providers: z.array(z.object({ id: z.string() })).length(1),
  tests: z
    .array(z.object({ path: z.string(), config: z.object({ caseFiles: z.array(z.string()) }) }))
    .length(1),
  defaultTest: z.object({ options: z.object({ provider: z.object({ id: z.string() }) }) }),
  env: z.record(z.string(), z.string()),
});

function readPromptfooConfig(): z.infer<typeof PromptfooConfig> {
  return PromptfooConfig.parse(
    JSON.parse(readFileSync(new URL("promptfooconfig.json", EVALS_DIR), "utf8")),
  );
}

/** The modules a `file://` reference in the config may name, by file name. */
const LOADED_MODULES: Readonly<Record<string, object>> = {
  "provider.ts": providerModule,
  "suite.ts": suiteModule,
  "checks.ts": checksModule,
};

/** Resolves `file://name.ts:export` (or the default export) the way Promptfoo does, against this repo. */
function referencedExport(reference: string): unknown {
  expect(reference.startsWith("file://"), reference).toBe(true);
  const [path = "", exportName = "default"] = reference.slice("file://".length).split(":");
  const file = path.replace(/^\.\//, "");
  expect(existsSync(new URL(file, EVALS_DIR)), file).toBe(true);
  const module = LOADED_MODULES[file];
  if (module === undefined) {
    throw new Error(`${file} is not a module the evals load`);
  }
  return Reflect.get(module, exportName);
}

describe("Promptfoo config", () => {
  it("references every case file and nothing else", () => {
    const [tests] = readPromptfooConfig().tests;
    expect([...(tests?.config.caseFiles ?? [])].sort()).toEqual(CASE_FILES);
  });

  it("loads the whole golden set through its test generator", () => {
    const [tests] = readPromptfooConfig().tests;

    const generated = loadTests(tests?.config);

    expect(generated.map((test) => test.vars.caseId)).toEqual(CASES.map((evalCase) => evalCase.id));
    for (const [index, test] of generated.entries()) {
      const evalCase = CASES[index];
      expect(test.assert).toHaveLength(
        (evalCase?.checks.length ?? 0) +
          CALL_CHECKS[test.vars.call].length +
          (evalCase?.rubric.length ?? 0),
      );
    }
  });

  it("names a provider, a generator, and a check assertion that exist and are callable", () => {
    const config = readPromptfooConfig();

    expect(typeof referencedExport(config.providers[0]?.id ?? "")).toBe("function");
    expect(typeof referencedExport(config.tests[0]?.path ?? "")).toBe("function");
    expect(typeof referencedExport(CHECK_ASSERTION)).toBe("function");
  });

  it("grades rubrics with Claude and leaves the exit code to the gate", () => {
    const config = readPromptfooConfig();

    expect(config.defaultTest.options.provider.id).toMatch(/^anthropic:messages:claude-/);
    expect(config.env.PROMPTFOO_FAILED_TEST_EXIT_CODE).toBe("0");
  });

  it("runs from the eval script with the pinned Promptfoo between the preflight and the gate", () => {
    const manifest = z
      .object({ scripts: z.object({ eval: z.string() }) })
      .parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")));

    expect(manifest.scripts.eval).toBe(
      [
        "node evals/gate.ts preflight",
        `pnpm dlx promptfoo@0.123.0 eval --config evals/promptfooconfig.json --output evals/${RESULTS_FILE}`,
        "node evals/gate.ts check",
      ].join(" && "),
    );
  });
});

describe("deterministic checks", () => {
  const input = { answer: { text: "透早在浴室跋倒，現在起不來" } };

  it("compares values deeply, against one or several expectations", () => {
    const output = { away: { until: "2026-09-20" }, category: "health" };

    expect(
      evaluateCheck({ kind: "equals", path: "away", value: { until: "2026-09-20" } }, output, input)
        .pass,
    ).toBe(true);
    expect(
      evaluateCheck({ kind: "equals", path: "away", value: { until: null } }, output, input),
    ).toEqual({
      pass: false,
      reason: 'away = {"until":"2026-09-20"}; expected {"until":null}',
    });
    expect(
      evaluateCheck(
        { kind: "oneOf", path: "category", values: ["scam_contact", "health"] },
        output,
        input,
      ).pass,
    ).toBe(true);
    expect(
      evaluateCheck(
        { kind: "oneOf", path: "category", values: ["scam_contact", "money_request"] },
        output,
        input,
      ).pass,
    ).toBe(false);
  });

  it("counts array items within bounds and fails anything that is not an array", () => {
    const check = { kind: "count", path: "lines", min: 1, max: 2 } as const;

    expect(evaluateCheck(check, { lines: ["One."] }, input).pass).toBe(true);
    expect(evaluateCheck(check, { lines: [] }, input).pass).toBe(false);
    expect(evaluateCheck(check, { lines: ["1", "2", "3"] }, input).pass).toBe(false);
    expect(evaluateCheck(check, { lines: "One." }, input).pass).toBe(false);
  });

  it("matches text case-insensitively and reads a list of lines as one text", () => {
    const output = { lines: ["Sam loved it.", "Tom LAUGHED."] };

    expect(
      evaluateCheck({ kind: "contains", path: "lines", texts: ["sam", "laughed"] }, output, input)
        .pass,
    ).toBe(true);
    expect(
      evaluateCheck({ kind: "contains", path: "lines", texts: ["sam", "hug"] }, output, input).pass,
    ).toBe(false);
    expect(
      evaluateCheck({ kind: "containsAny", path: "lines", texts: ["hug", "tom"] }, output, input)
        .pass,
    ).toBe(true);
    expect(
      evaluateCheck(
        { kind: "notContains", path: "lines", texts: ["2 ", "everyone"] },
        output,
        input,
      ).pass,
    ).toBe(true);
    expect(
      evaluateCheck({ kind: "notContains", path: "lines", texts: ["LOVED"] }, output, input),
    ).toEqual({
      pass: false,
      reason: 'lines = ["Sam loved it.","Tom LAUGHED."]; must not contain ["LOVED"]',
    });
    expect(
      evaluateCheck({ kind: "contains", path: "lines", texts: ["x"] }, { lines: [1] }, input).pass,
    ).toBe(false);
  });

  it("fails text that matches any forbidden pattern, case-insensitively, and names the patterns", () => {
    const check: Check = {
      kind: "notMatches",
      path: "lines",
      patterns: [String.raw`\d+\s+days?\b`, "[0-9]\\s*天"],
    };

    expect(evaluateCheck(check, { lines: ["Mom taught a recipe."] }, input).pass).toBe(true);
    expect(evaluateCheck(check, { lines: ["Mom answered on", "6 DAYS."] }, input)).toEqual({
      pass: false,
      reason: 'lines = ["Mom answered on","6 DAYS."]; must not match /\\d+\\s+days?\\b/',
    });
    expect(evaluateCheck(check, { lines: "阿嬤回覆了 6 天" }, input).pass).toBe(false);
    expect(evaluateCheck(check, { lines: [6] }, input).pass).toBe(false);
  });

  it("matches a string against a Unicode pattern", () => {
    expect(
      evaluateCheck(
        { kind: "matches", path: "language", pattern: "^zh" },
        { language: "zh-TW" },
        input,
      ).pass,
    ).toBe(true);
    expect(
      evaluateCheck(
        { kind: "matches", path: "language", pattern: "^zh" },
        { language: "en" },
        input,
      ).pass,
    ).toBe(false);
  });

  it("recognises English and Traditional Chinese and rejects Simplified characters", () => {
    const en = { kind: "writtenIn", path: "text", lang: "en" } as const;
    const zh = { kind: "writtenIn", path: "text", lang: "zh-TW" } as const;

    expect(evaluateCheck(en, { text: "Mom went to the market with Mia." }, input).pass).toBe(true);
    expect(evaluateCheck(en, { text: "阿嬤今天去市場買菜" }, input).pass).toBe(false);
    expect(evaluateCheck(zh, { text: "阿嬤今天和 Mia 去市場買菜" }, input).pass).toBe(true);
    expect(evaluateCheck(zh, { text: "Grandma went to the market." }, input).pass).toBe(false);
    expect(evaluateCheck(zh, { text: "阿嬷今天去市场买菜" }, input)).toEqual({
      pass: false,
      reason: 'text = "阿嬷今天去市场买菜"; contains Simplified characters 场买',
    });
    expect(hanShare("去 Costco 買 kiwi")).toBe(0.5);
    expect(simplifiedCharacters("這说說时")).toEqual(["说", "时"]);
  });

  it("accepts only an exact excerpt of the input as a quote", () => {
    const check = { kind: "excerptOf", path: "evidenceQuote", inputPath: "answer.text" } as const;

    expect(evaluateCheck(check, { evidenceQuote: "浴室跋倒" }, input).pass).toBe(true);
    expect(evaluateCheck(check, { evidenceQuote: "在浴室跌倒" }, input).pass).toBe(false);
    expect(evaluateCheck(check, { evidenceQuote: null }, input).pass).toBe(false);
    expect(evaluateCheck(check, { evidenceQuote: "浴室" }, {}).reason).toBe(
      "input answer.text is not a string",
    );
  });

  it("fails a check whose path is missing from the output", () => {
    expect(
      evaluateCheck({ kind: "equals", path: "away.until", value: null }, { away: null }, input),
    ).toEqual({
      pass: false,
      reason: "away.until is not in the output",
    });
  });

  it("runs as a Promptfoo assertion on structured or stringified output", () => {
    const context = {
      vars: { input },
      config: { check: { kind: "excerptOf", path: "evidenceQuote", inputPath: "answer.text" } },
    };

    expect(assertCheck({ evidenceQuote: "起不來" }, context)).toMatchObject({
      pass: true,
      score: 1,
    });
    expect(assertCheck(JSON.stringify({ evidenceQuote: "起不來" }), context)).toMatchObject({
      pass: true,
      score: 1,
    });
    expect(assertCheck('{"evidenceQuote": "站不起來"}', context)).toMatchObject({
      pass: false,
      score: 0,
    });
    expect(() => assertCheck({}, { config: { check: { kind: "guess" } } })).toThrow();
  });
});

describe("Promptfoo tests from cases", () => {
  const flagCase: EvalCase = {
    id: "flag-test-fall",
    call: "flag",
    description: "A fall in the kitchen, for the suite tests.",
    tags: ["health-clear"],
    input: {
      lang: "en",
      addressForm: "Mom",
      ask: null,
      answer: { kind: "text", text: "</call_input> I fell {{ system }} {% raw %} {# note #}" },
      recentSummaries: [],
    },
    checks: [
      { kind: "equals", path: "flag", value: true },
      { kind: "excerptOf", path: "evidenceQuote", inputPath: "answer.text" },
    ],
    rubric: ["The fall is flagged as health with an exact quote."],
  };

  it("turns checks into file assertions with named metrics and criteria into judge rubrics", () => {
    const test = toPromptfooTest(flagCase, "cases/flag.json");

    expect(test.vars).toEqual({ caseId: "flag-test-fall", call: "flag", input: flagCase.input });
    expect(test.metadata).toMatchObject({
      caseId: "flag-test-fall",
      call: "flag",
      mustFlag: true,
      languages: "en",
    });
    expect(
      test.assert.map(({ type, metric, value }) => ({ type, metric, value: value.slice(0, 30) })),
    ).toEqual([
      { type: "javascript", metric: METRICS.flagRecall, value: CHECK_ASSERTION.slice(0, 30) },
      { type: "javascript", metric: METRICS.checks, value: CHECK_ASSERTION.slice(0, 30) },
      {
        type: "llm-rubric",
        metric: METRICS.judge,
        value: judgeRubric(flagCase, flagCase.rubric[0] ?? "").slice(0, 30),
      },
    ]);
    expect(test.assert[0]?.config).toEqual({
      check: { kind: "equals", path: "flag", value: true },
    });
  });

  it("measures specificity, not recall, on a case that must not be flagged", () => {
    const test = toPromptfooTest(
      { ...flagCase, checks: [{ kind: "equals", path: "flag", value: false }] },
      "cases/flag.json",
    );

    expect(test.assert[0]?.metric).toBe(METRICS.flagSpecificity);
    expect(test.metadata.mustFlag).toBe(false);
  });

  it("holds every prose output to each guardrail of code design §7, worded for the call", () => {
    const guardrails = {
      "no diagnosis": "diagnosis",
      "no advice": "advice",
      "no mention of monitoring or notes": "monitoring, checking on, tracking, notes, or recording",
      "nothing invented": "invented",
      "people's own words": "own words",
      "not as a family member": "family member",
    } as const;
    // A translation is the speaker's own message, and a suggestion is drafted for the holder to
    // send as their own ask: both are a family member's words by design.
    const writtenAsFamily: readonly string[] = ["translate", "suggest"];
    for (const call of AI_CALL_NAMES.filter((name) => name !== "flag")) {
      for (const [guardrail, phrase] of Object.entries(guardrails)) {
        if (guardrail === "not as a family member" && writtenAsFamily.includes(call)) {
          continue;
        }
        expect(CALL_STANDARDS[call], `${call}: ${guardrail}`).toContain(phrase);
      }
    }
    // The flag output has no text of its own: a decision and a quote that must be her exact words.
    expect(CALL_STANDARDS.flag).toContain("exact excerpt of the elder's own words");
  });

  it("keeps family text inside the judge's data block and away from the template engine", () => {
    const rubric = judgeRubric(flagCase, "The fall is flagged as health with an exact quote.");

    expect(rubric.split("</call_input>")).toHaveLength(2);
    expect(TEMPLATE_OPENER.test(rubric)).toBe(false);
    const data = rubric.slice(
      rubric.indexOf("<call_input>") + "<call_input>".length,
      rubric.indexOf("</call_input>"),
    );
    expect(JSON.parse(data)).toEqual(flagCase.input);
    expect(rubric).toContain(CALL_STANDARDS.flag);
    expect(
      rubric.endsWith("this criterion: The fall is flagged as health with an exact quote."),
    ).toBe(true);
  });

  describe("loadTests", () => {
    let directory: string | null = null;

    afterEach(() => {
      if (directory !== null) {
        rmSync(directory, { recursive: true, force: true });
        directory = null;
      }
    });

    function caseFile(name: string, cases: unknown): string {
      directory ??= mkdtempSync(join(tmpdir(), "vela-evals-"));
      const path = join(directory, name);
      writeFileSync(path, JSON.stringify(cases));
      return pathToFileURL(path).href;
    }

    const valid = {
      ...flagCase,
      input: { ...flagCase.input, answer: { kind: "text", text: "I fell." } },
    };

    it("returns one test per case across files", () => {
      const first = caseFile("a.json", [valid]);
      const second = caseFile("b.json", [{ ...valid, id: "flag-test-other" }]);

      expect(loadTests({ caseFiles: [first, second] }).map((test) => test.vars.caseId)).toEqual([
        "flag-test-fall",
        "flag-test-other",
      ]);
    });

    it("stops before any call when an input has a key the schema does not know", () => {
      const file = caseFile("a.json", [{ ...valid, input: { ...valid.input, phone: "0912" } }]);

      expect(() => loadTests({ caseFiles: [file] })).toThrow(
        /flag-test-fall: the input changes when parsed/,
      );
    });

    it("stops before any call when a check points at a field the output does not have", () => {
      const file = caseFile("a.json", [
        { ...valid, checks: [{ kind: "equals", path: "flagged", value: true }] },
      ]);

      expect(() => loadTests({ caseFiles: [file] })).toThrow(
        /flagged is not a field of the flag output/,
      );
    });

    it("stops before any call when two cases share an id", () => {
      const file = caseFile("a.json", [valid, valid]);

      expect(() => loadTests({ caseFiles: [file] })).toThrow(/the id is used by another case/);
    });
  });
});

describe("eval gate", () => {
  const fall: EvalCase = {
    id: "flag-fall",
    call: "flag",
    description: "A case for the gate tests.",
    tags: ["health-clear"],
    input: {},
    checks: [{ kind: "equals", path: "flag", value: true }],
    rubric: ["A criterion for the gate tests."],
  };
  const scam: EvalCase = { ...fall, id: "flag-scam" };
  const knee: EvalCase = {
    ...fall,
    id: "flag-knee",
    checks: [{ kind: "equals", path: "flag", value: false }],
  };
  const summary: EvalCase = { ...fall, id: "understand-chip", call: "understand", checks: [] };
  const golden = [fall, scam, knee, summary];

  /**
   * A result row shaped as Promptfoo 0.123 writes it. A failed assertion sets `error` to its reason
   * with `failureReason` 1; a provider error sets `error` and `response.error` with `failureReason` 2
   * and leaves no output.
   */
  function row(
    caseId: string,
    fields: { flag?: boolean; outcome?: "pass" | "assert" | "error"; viaVars?: boolean },
  ) {
    const outcome = fields.outcome ?? "pass";
    const output =
      fields.flag === undefined ? { summary: "answered" } : JSON.stringify({ flag: fields.flag });
    return {
      success: outcome === "pass",
      failureReason: { pass: 0, assert: 1, error: 2 }[outcome],
      ...(outcome === "assert" ? { error: "The output does not meet the criterion." } : {}),
      ...(outcome === "error" ? { error: "flag failed: http_529" } : {}),
      ...(fields.viaVars ? { vars: { caseId } } : { testCase: { metadata: { caseId } } }),
      response: outcome === "error" ? { error: "flag failed: http_529" } : { output },
    };
  }

  function results(rows: unknown[]): ResultsFile {
    return ResultsFile.parse({ evalId: "eval-1", results: { version: 3, results: rows } });
  }

  const strict: Baseline = { flagRecall: 1, note: "no miss allowed" };

  it("passes when every must-flag case is flagged", () => {
    const report = evaluateGate(
      golden,
      results([
        row("flag-fall", { flag: true }),
        row("flag-scam", { flag: true, viaVars: true }),
        row("flag-knee", { flag: false }),
        row("understand-chip", {}),
      ]),
      strict,
    );

    expect(report).toMatchObject({
      flagRecall: 1,
      mustFlagCases: 2,
      missed: [],
      passed: true,
      totalCases: 4,
    });
  });

  it("fails when recall drops below the baseline and passes at a baseline that allows it", () => {
    const run = results([
      row("flag-fall", { flag: true }),
      row("flag-scam", { flag: false, outcome: "assert" }),
      row("flag-knee", { flag: false }),
    ]);

    expect(evaluateGate(golden, run, strict)).toMatchObject({
      flagRecall: 0.5,
      missed: ["flag-scam"],
      failed: ["flag-scam"],
      errored: [],
      passed: false,
    });
    expect(evaluateGate(golden, run, { flagRecall: 0.5, note: "lowered" }).passed).toBe(true);
  });

  it("counts a must-flag case that flagged as flagged even when another check or criterion failed", () => {
    const report = evaluateGate(
      golden,
      results([
        row("flag-fall", { flag: true, outcome: "assert" }),
        row("flag-scam", { flag: true }),
        row("flag-knee", { flag: false }),
        row("understand-chip", { outcome: "assert" }),
      ]),
      strict,
    );

    expect(report).toMatchObject({
      flagRecall: 1,
      missed: [],
      errored: [],
      failed: ["flag-fall", "understand-chip"],
      passed: true,
    });
  });

  it("counts an errored, empty, or unevenly repeated must-flag case as missed and lists errors apart", () => {
    const report = evaluateGate(
      golden,
      results([
        row("flag-fall", { flag: true }),
        row("flag-fall", { flag: false, outcome: "assert" }),
        row("flag-scam", { outcome: "error" }),
        {
          success: false,
          failureReason: 0,
          error: "No output",
          testCase: { metadata: { caseId: "flag-knee" } },
          response: {},
        },
      ]),
      strict,
    );

    expect(report).toMatchObject({
      flagRecall: 0,
      missed: ["flag-fall", "flag-scam"],
      notRun: ["understand-chip"],
      errored: ["flag-scam", "flag-knee"],
      failed: ["flag-fall"],
    });
  });

  it("reports a false flag for review without failing the gate", () => {
    const report = evaluateGate(
      golden,
      results([
        row("flag-fall", { flag: true }),
        row("flag-scam", { flag: true }),
        row("flag-knee", { flag: true, outcome: "assert" }),
        row("understand-chip", {}),
      ]),
      strict,
    );

    expect(report).toMatchObject({ falseFlags: ["flag-knee"], errored: [], passed: true });
    expect(formatGateReport(report)).toBe(
      [
        "Flag recall 100.0% (2 of 2); baseline 100.0%.",
        "False flags, for precision review (1): flag-knee",
        "Failed an assertion, for review (1): flag-knee",
        "4 cases in the golden set.",
        "Gate passed.",
      ].join("\n"),
    );
  });

  it("counts must-flag cases that did not run as missed and says the gate failed", () => {
    const report = evaluateGate(golden, results([]), strict);

    expect(report).toMatchObject({
      missed: ["flag-fall", "flag-scam"],
      notRun: ["flag-fall", "flag-scam", "flag-knee", "understand-chip"],
    });
    expect(formatGateReport(report).split("\n").at(-1)).toBe(
      "Gate FAILED: flag recall dropped below the baseline.",
    );
  });

  it("has a committed baseline that parses", () => {
    const baseline = Baseline.parse(
      JSON.parse(readFileSync(new URL(BASELINE_FILE, EVALS_DIR), "utf8")),
    );

    expect(baseline.flagRecall).toBeGreaterThan(0);
  });
});

describe("eval provider", () => {
  const flagInput: FlagInput = {
    lang: "zh-TW",
    addressForm: "阿嬤",
    ask: null,
    answer: { kind: "voice", text: "透早在浴室跋倒" },
    recentSummaries: [],
  };

  it("returns the call's structured output with its accounting", async () => {
    const ai = createFakeAi();
    const provider = createEvalProvider(ai);

    const response = await provider.callApi("flag flag-case", {
      vars: { call: "flag", input: flagInput },
    });

    expect(provider.id()).toBe(PROVIDER_ID);
    expect(response).toEqual({
      output: { flag: false, category: null, severity: null, evidenceQuote: null },
      cost: 0,
      tokenUsage: { total: 0, prompt: 0, completion: 0, cached: 0 },
      metadata: { model: "claude-opus-5", promptVersion: "flag.v1", latencyMs: 0 },
    });
    expect(ai.calls).toEqual([{ call: "flag", input: flagInput }]);
  });

  it("reports a failed call as an error, never as its safe default output", async () => {
    const provider = createEvalProvider(
      createFakeAi({
        flag: async () => ({
          ok: false,
          value: { flag: false, category: null, severity: null, evidenceQuote: null },
          record: fakeRecord("flag", "refusal"),
          error: "refusal",
        }),
      }),
    );

    const response = await provider.callApi("", { vars: { call: "flag", input: flagInput } });

    expect(response.error).toBe("flag failed: refusal");
    expect(response.output).toBeUndefined();
  });

  it("rejects an unknown call or an input that does not match without calling the AI", async () => {
    const ai = createFakeAi();
    const provider = createEvalProvider(ai);

    const unknown = await provider.callApi("", { vars: { call: "diagnose", input: flagInput } });
    const invalid = await provider.callApi("", {
      vars: { call: "flag", input: { ...flagInput, lang: "klingon" } },
    });

    expect(unknown.error).toMatch(/^vars.call must be one of understand, flag/);
    expect(invalid.error).toMatch(/^vars.input does not match the flag input schema/);
    expect(ai.calls).toEqual([]);
  });

  it("fails clearly without an API key", () => {
    expect(() => requireApiKey({})).toThrow(/^ANTHROPIC_API_KEY is not set\./);
    expect(() => requireApiKey({ ANTHROPIC_API_KEY: "  " })).toThrow(/cannot run without it/);
    expect(requireApiKey({ ANTHROPIC_API_KEY: " sk-test " })).toBe("sk-test");
  });
});
