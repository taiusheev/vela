/**
 * The golden set's format: one JSON file per call in `cases/`, each an array of cases. A case names
 * the call, gives the input exactly as services would pass it, and states what a good output is in
 * two ways: deterministic checks that code can decide, and rubric criteria for an LLM judge.
 *
 * Every case is synthetic. No real person's words, names, or numbers belong here until the process
 * in `README.md` for consented cases has been followed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AiCallName, INPUT_SCHEMAS, OUTPUT_SCHEMAS } from "../src/types.ts";

/** A dotted path into a JSON value, with numeric segments for array items: `away.until`, `lines.0`. */
const JsonPath = z
  .string()
  .regex(/^[A-Za-z]\w*(?:\.(?:\d+|[A-Za-z]\w*))*$/, "expected a dotted path such as away.until");

const Texts = z.array(z.string().min(1)).min(1);

/** Languages a deterministic script check can recognise. */
export const CHECKABLE_LANGS = ["en", "zh-TW"] as const;
export type CheckableLang = (typeof CHECKABLE_LANGS)[number];

/**
 * Deterministic checks on a call's output. Text comparisons are case-insensitive, and a path that
 * resolves to an array of strings is read as its items joined by newlines.
 */
export const Check = z
  .discriminatedUnion("kind", [
    /** The value at `path` deep-equals `value`. */
    z.strictObject({ kind: z.literal("equals"), path: JsonPath, value: z.json() }),
    /** The value at `path` deep-equals one of `values`. */
    z.strictObject({ kind: z.literal("oneOf"), path: JsonPath, values: z.array(z.json()).min(2) }),
    /** The array at `path` has between `min` and `max` items. */
    z.strictObject({
      kind: z.literal("count"),
      path: JsonPath,
      min: z.int().nonnegative(),
      max: z.int().nonnegative(),
    }),
    /** The text at `path` contains every one of `texts`. */
    z.strictObject({ kind: z.literal("contains"), path: JsonPath, texts: Texts }),
    /** The text at `path` contains at least one of `texts`. */
    z.strictObject({ kind: z.literal("containsAny"), path: JsonPath, texts: Texts }),
    /** The text at `path` contains none of `texts`. */
    z.strictObject({ kind: z.literal("notContains"), path: JsonPath, texts: Texts }),
    /** The string at `path` matches the regular expression `pattern` (Unicode mode). */
    z.strictObject({ kind: z.literal("matches"), path: JsonPath, pattern: z.string().min(1) }),
    /** The text at `path` is mainly written in `lang`; for zh-TW, in Traditional characters. */
    z.strictObject({ kind: z.literal("writtenIn"), path: JsonPath, lang: z.enum(CHECKABLE_LANGS) }),
    /** The string at `path` is not null and appears verbatim in the input at `inputPath`. */
    z.strictObject({ kind: z.literal("excerptOf"), path: JsonPath, inputPath: JsonPath }),
  ])
  .refine((check) => check.kind !== "count" || check.min <= check.max, "min exceeds max")
  .refine((check) => check.kind !== "matches" || compiles(check.pattern), "invalid pattern");
export type Check = z.infer<typeof Check>;

/** What a case exercises; the golden-set test keeps a minimum of each over-weighted theme. */
export const CASE_TAGS = [
  "taiwanese-mandarin",
  "hokkien",
  "code-switching",
  "register",
  "address-form",
  "health-borderline",
  "health-clear",
  "safety-borderline",
  "hopelessness",
  "stranger",
  "scam",
  "money-request",
  "away",
  "injection",
  "mood",
  "no-counts",
  "no-invention",
  "no-guilt",
  "vocabulary",
  "generic",
  "sparse",
] as const;
export const CaseTag = z.enum(CASE_TAGS);
export type CaseTag = z.infer<typeof CaseTag>;

export const EvalCase = z.strictObject({
  /** Unique across the golden set, kebab-case, starting with the call. */
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected kebab-case"),
  call: AiCallName,
  /** What the case is about, for a person reading a failure. */
  description: z.string().min(10).max(300),
  tags: z.array(CaseTag).min(1),
  /** Validated against `INPUT_SCHEMAS[call]` by `caseIssues`. */
  input: z.record(z.string(), z.unknown()),
  checks: z.array(Check),
  /** Criteria for the LLM judge, one judgement each. */
  rubric: z.array(z.string().min(20)).min(1),
});
export type EvalCase = z.infer<typeof EvalCase>;

export const CaseFile = z.array(EvalCase).min(1);

/** Where the case files live, relative to this directory, as the Promptfoo config names them. */
export const CASES_DIR = "cases";

const EVALS_DIR = new URL("./", import.meta.url);

/** Every case file on disk, as `cases/<name>.json`, sorted. */
export function listCaseFiles(): string[] {
  return readdirSync(new URL(`${CASES_DIR}/`, EVALS_DIR))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => `${CASES_DIR}/${name}`);
}

/**
 * Reads and parses one case file, named relative to this directory or as an absolute file URL;
 * throws with the file name.
 */
export function readCaseFile(file: string): EvalCase[] {
  const text = readFileSync(new URL(file, EVALS_DIR), "utf8");
  const parsed = CaseFile.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`${file} is not a valid case file:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** The prefix every id of a call's cases starts with: the call name in kebab-case. */
export function idPrefix(call: AiCallName): string {
  return `${call.replaceAll("_", "-")}-`;
}

/**
 * Everything wrong with a case beyond its shape, empty when it is ready to run: the id prefix, the
 * input against the call's schema, check paths against the output schema, and rubric text the
 * judge's template engine would misread.
 */
export function caseIssues(evalCase: EvalCase): string[] {
  const issues: string[] = [];
  if (!evalCase.id.startsWith(idPrefix(evalCase.call))) {
    issues.push(`the id must start with ${idPrefix(evalCase.call)}`);
  }
  const input = inputIssues(evalCase);
  if (input !== null) {
    issues.push(input);
  }
  const output = z.toJSONSchema(OUTPUT_SCHEMAS[evalCase.call]);
  for (const check of evalCase.checks) {
    if (!schemaHasPath(output, check.path.split("."))) {
      issues.push(
        `check ${check.kind}: ${check.path} is not a field of the ${evalCase.call} output`,
      );
    }
    if (check.kind === "excerptOf") {
      const source = resolvePath(evalCase.input, check.inputPath);
      if (!source.found || typeof source.value !== "string") {
        issues.push(`check excerptOf: input ${check.inputPath} is not a string`);
      }
    }
  }
  for (const criterion of evalCase.rubric) {
    if (TEMPLATE_OPENER.test(criterion)) {
      issues.push(`a rubric criterion contains a template opener ({{, {%, or {#)`);
    }
  }
  return issues;
}

/**
 * Why a case's input does not exactly match its call's input schema, or null when it does. Parsing
 * must give back the input unchanged, so a misspelt key (which Zod strips), an untrimmed name, or text
 * longer than the call keeps fails.
 */
function inputIssues(evalCase: EvalCase): string | null {
  const parsed = INPUT_SCHEMAS[evalCase.call].safeParse(evalCase.input);
  if (!parsed.success) {
    return z.prettifyError(parsed.error);
  }
  if (!isDeepStrictEqual(parsed.data, evalCase.input)) {
    return "the input changes when parsed: an unknown key was stripped or a value was normalised";
  }
  return null;
}

/**
 * Promptfoo renders `llm-rubric` values with Nunjucks, which reads these pairs as the start of a
 * tag, so rubric text must not contain them.
 */
export const TEMPLATE_OPENER = /\{[{%#]/;

/** The languages a case's text is in: her language, the summary's, and a translation's two sides. */
export function caseLanguages(evalCase: EvalCase): string[] {
  const { input } = evalCase;
  const values = [input.lang, input.summaryLang, input.from, input.to];
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

/**
 * For a flag case, whether the answer must be flagged, read from its `equals` check on `flag`; null
 * for other calls or a flag case without that check.
 */
export function mustFlag(evalCase: EvalCase): boolean | null {
  if (evalCase.call !== "flag") {
    return null;
  }
  for (const check of evalCase.checks) {
    if (check.kind === "equals" && check.path === "flag" && typeof check.value === "boolean") {
      return check.value;
    }
  }
  return null;
}

type Resolved = { readonly found: true; readonly value: unknown } | { readonly found: false };

/** Follows a dotted path through objects and arrays; numeric segments index arrays. */
export function resolvePath(root: unknown, path: string): Resolved {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (index >= current.length) {
        return { found: false };
      }
      current = current[index];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a JSON Schema, as Zod emits it, can hold a value at the path; indexes respect maxItems. */
function schemaHasPath(schema: unknown, segments: readonly string[]): boolean {
  if (!isRecord(schema)) {
    return false;
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((alternative) => schemaHasPath(alternative, segments));
  }
  const [segment, ...rest] = segments;
  if (segment === undefined) {
    return true;
  }
  if (/^\d+$/.test(segment)) {
    const withinMax = typeof schema.maxItems !== "number" || Number(segment) < schema.maxItems;
    return withinMax && schemaHasPath(schema.items, rest);
  }
  return isRecord(schema.properties) && schemaHasPath(schema.properties[segment], rest);
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
}
