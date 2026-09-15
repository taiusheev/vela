/**
 * Deterministic checks on a call's output, and the Promptfoo `javascript` assertion that runs them.
 * Promptfoo loads this file by path (`file://checks.ts:assertCheck`) with the check in the
 * assertion's `config`, so the golden set stays data and the logic stays testable without a network.
 */
import { isDeepStrictEqual } from "node:util";
import { Check, type CheckableLang, resolvePath } from "./cases.ts";

export interface CheckResult {
  readonly pass: boolean;
  readonly reason: string;
}

/**
 * Characters that exist only in Simplified Chinese. The list keeps to common, unambiguous forms: a
 * character that is also correct Traditional usage (后, 里, 只, 台, 着) is left out, so a zh-TW text
 * is never failed for a character Taiwanese writing uses.
 */
export const SIMPLIFIED_ONLY =
  "们这说时会来对没过还为让听讲爱妈岁医药发边买卖钱银车见观开关门问间头东话语书学习长张电脑网气热饭鸡鱼汤点儿样谢给该请远进从两个孙乡园双苹当场厨带转办帮应实经红线级纪约馆饺汉岛湾戏欢乐亲爷奖礼节体检护疗伤压视频讯码账户号骗诈汇钟复历广厂录伞吗认识觉与业员务";

const SIMPLIFIED_SET = new Set(SIMPLIFIED_ONLY);

/** The Simplified-only characters in a text, each once, in order of first appearance. */
export function simplifiedCharacters(text: string): string[] {
  return [...new Set([...text].filter((character) => SIMPLIFIED_SET.has(character)))];
}

/** Han characters as a share of Han characters plus Latin words, so a Latin word weighs one character. */
export function hanShare(text: string): number {
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinWords = text.match(/\p{Script=Latin}+/gu)?.length ?? 0;
  const total = han + latinWords;
  return total === 0 ? 0 : han / total;
}

export function evaluateCheck(check: Check, output: unknown, input: unknown): CheckResult {
  const at = resolvePath(output, check.path);
  if (!at.found) {
    return fail(`${check.path} is not in the output`);
  }
  const { value } = at;
  const shown = `${check.path} = ${JSON.stringify(value)}`;

  switch (check.kind) {
    case "equals":
      return verdict(
        isDeepStrictEqual(value, check.value),
        `${shown}; expected ${JSON.stringify(check.value)}`,
      );
    case "oneOf":
      return verdict(
        check.values.some((candidate) => isDeepStrictEqual(value, candidate)),
        `${shown}; expected one of ${JSON.stringify(check.values)}`,
      );
    case "count": {
      if (!Array.isArray(value)) {
        return fail(`${shown}; expected an array`);
      }
      const within = value.length >= check.min && value.length <= check.max;
      return verdict(within, `${shown}; expected ${check.min} to ${check.max} items`);
    }
    case "contains":
    case "containsAny":
    case "notContains": {
      const text = textOf(value);
      if (text === null) {
        return fail(`${shown}; expected text`);
      }
      const haystack = text.toLowerCase();
      const present = check.texts.filter((needle) => haystack.includes(needle.toLowerCase()));
      if (check.kind === "contains") {
        return verdict(
          present.length === check.texts.length,
          `${shown}; expected all of ${JSON.stringify(check.texts)}`,
        );
      }
      if (check.kind === "containsAny") {
        return verdict(
          present.length > 0,
          `${shown}; expected any of ${JSON.stringify(check.texts)}`,
        );
      }
      return verdict(present.length === 0, `${shown}; must not contain ${JSON.stringify(present)}`);
    }
    case "matches":
      return verdict(
        typeof value === "string" && new RegExp(check.pattern, "u").test(value),
        `${shown}; expected to match /${check.pattern}/`,
      );
    case "notMatches": {
      const text = textOf(value);
      if (text === null) {
        return fail(`${shown}; expected text`);
      }
      const matched = check.patterns.filter((pattern) => new RegExp(pattern, "iu").test(text));
      return verdict(
        matched.length === 0,
        `${shown}; must not match ${matched.map((pattern) => `/${pattern}/`).join(", ")}`,
      );
    }
    case "writtenIn": {
      const text = textOf(value);
      if (text === null) {
        return fail(`${shown}; expected text`);
      }
      return writtenIn(text, check.lang, shown);
    }
    case "excerptOf": {
      const source = resolvePath(input, check.inputPath);
      const haystack = source.found && typeof source.value === "string" ? source.value : null;
      if (haystack === null) {
        return fail(`input ${check.inputPath} is not a string`);
      }
      return verdict(
        typeof value === "string" && haystack.includes(value),
        `${shown}; expected an exact excerpt of input ${check.inputPath}`,
      );
    }
  }
}

/** What Promptfoo passes a `javascript` assertion loaded from a file, as far as this file reads it. */
export interface AssertionContext {
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** Promptfoo's grading result for one assertion. */
export interface GradingResult {
  readonly pass: boolean;
  readonly score: number;
  readonly reason: string;
}

/**
 * The Promptfoo entry point. The check comes from the assertion's `config.check`; the output is the
 * provider's structured value, or its JSON text when Promptfoo has stringified it.
 */
export function assertCheck(output: unknown, context: AssertionContext): GradingResult {
  const check = Check.parse(context.config?.check);
  const result = evaluateCheck(check, parseOutput(output), context.vars?.input);
  return { pass: result.pass, score: result.pass ? 1 : 0, reason: result.reason };
}

function parseOutput(output: unknown): unknown {
  if (typeof output !== "string") {
    return output;
  }
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function writtenIn(text: string, lang: CheckableLang, shown: string): CheckResult {
  const share = hanShare(text);
  if (lang === "en") {
    return verdict(share <= 0.5 && /\p{Script=Latin}/u.test(text), `${shown}; expected English`);
  }
  const simplified = simplifiedCharacters(text);
  if (simplified.length > 0) {
    return fail(`${shown}; contains Simplified characters ${simplified.join("")}`);
  }
  return verdict(share >= 0.5, `${shown}; expected Traditional Chinese`);
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join("\n");
  }
  return null;
}

function verdict(pass: boolean, reason: string): CheckResult {
  return { pass, reason };
}

function fail(reason: string): CheckResult {
  return { pass: false, reason };
}
