import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

/**
 * Words on screen must go through Lingui, or they stay English in every language. This reads the
 * screens and the data hooks the way Babel does and lists every English word it finds in a place
 * that reaches the screen without a `t`, `msg`, `plural` or `<Trans>` around it (build plan 3.1):
 * text in JSX, the props and keys that are always shown (label, title, placeholder, helper,
 * caption), a stand-in for a missing name, phrases held in state, variables or fixtures, and what
 * the screens' and data hooks' text builders return. It guards the strings later tasks add, as much
 * as the ones converted now. Single words in other places, such as a role in a variable, are beyond
 * it, since they cannot be told apart from keys.
 */

const APP = fileURLToPath(new URL("../../", import.meta.url));

interface Node {
  type: string;
  loc?: { start: { line: number } } | null;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

function child(node: Node, key: string): Node | undefined {
  const value = node[key];
  return isNode(value) ? value : undefined;
}

function children(node: Node): Node[] {
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") return [];
    if (Array.isArray(value)) return value.filter(isNode);
    return isNode(value) ? [value] : [];
  });
}

function nameOf(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name as string;
  if (node.type === "StringLiteral") return node.value as string;
  if (node.type === "MemberExpression" || node.type === "JSXMemberExpression") {
    return nameOf(child(node, "property"));
  }
  return undefined;
}

/** The macros and components that translate what is inside them. */
const TRANSLATING_CALLS: ReadonlySet<string> = new Set([
  "t",
  "msg",
  "defineMessage",
  "plural",
  "select",
  "selectOrdinal",
  "_",
]);
const TRANSLATING_ELEMENTS: ReadonlySet<string> = new Set([
  "Trans",
  "Plural",
  "Select",
  "SelectOrdinal",
]);

function translates(node: Node): boolean {
  if (node.type === "TaggedTemplateExpression") {
    return TRANSLATING_CALLS.has(nameOf(child(node, "tag")) ?? "");
  }
  if (node.type === "CallExpression") {
    return TRANSLATING_CALLS.has(nameOf(child(node, "callee")) ?? "");
  }
  if (node.type === "JSXElement") {
    const opening = child(node, "openingElement");
    return TRANSLATING_ELEMENTS.has(nameOf(opening && child(opening, "name")) ?? "");
  }
  return false;
}

/** Props and keys whose value is always read on screen. */
const TEXT_PROPS: ReadonlySet<string> = new Set([
  "label",
  "title",
  "placeholder",
  "helper",
  "caption",
  "accessibilityLabel",
  "accessibilityHint",
]);

/** String-returning helpers whose words pass through to what they return. */
const PASS_THROUGH: ReadonlySet<string> = new Set([
  "toUpperCase",
  "toLowerCase",
  "trim",
  "join",
  "filter",
  "concat",
]);

interface Found {
  line: number;
  text: string;
}

/**
 * The strings an expression can evaluate to: the branches of a condition, the parts of a template
 * or a join, never a comparison's operands or a function's arguments.
 */
function valuesOf(node: Node | undefined): Found[] {
  if (node === undefined || translates(node)) return [];
  const line = node.loc?.start.line ?? 0;
  switch (node.type) {
    case "StringLiteral":
      return [{ line, text: node.value as string }];
    case "TemplateLiteral": {
      const quasis = (node.quasis as Node[]).map((quasi) => {
        const value = quasi.value as { cooked?: string | null; raw: string };
        return value.cooked ?? value.raw;
      });
      const expressions = (node.expressions as Node[]).flatMap(valuesOf);
      return [{ line, text: quasis.join("{}") }, ...expressions];
    }
    case "ConditionalExpression":
      return [...valuesOf(child(node, "consequent")), ...valuesOf(child(node, "alternate"))];
    case "LogicalExpression":
      return node.operator === "&&"
        ? valuesOf(child(node, "right"))
        : [...valuesOf(child(node, "left")), ...valuesOf(child(node, "right"))];
    case "BinaryExpression":
      return node.operator === "+"
        ? [...valuesOf(child(node, "left")), ...valuesOf(child(node, "right"))]
        : [];
    case "ArrayExpression":
      return (node.elements as unknown[]).filter(isNode).flatMap(valuesOf);
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return valuesOf(child(node, "expression"));
    case "CallExpression": {
      const callee = child(node, "callee");
      return callee?.type === "MemberExpression" &&
        PASS_THROUGH.has(nameOf(child(callee, "property")) ?? "")
        ? valuesOf(child(callee, "object"))
        : [];
    }
    default:
      return [];
  }
}

/**
 * Names that read the same in every language: the product, the endonym English (繁體中文 has no
 * Latin to find), and Mia, the example name onboarding offers in both languages.
 */
const LITERAL: ReadonlySet<string> = new Set(["Vela", "Vela Light", "English", "Mia"]);
/** A locale tag handed to Intl, such as en-GB. */
const LOCALE_TAG = /^[a-z]{2}(-[A-Z]{2})?$/;

/** A word of two letters or more; single letters are an SVG path's commands, not English. */
function english(text: string): boolean {
  const trimmed = text.trim();
  return /[A-Za-z]{2}/.test(trimmed) && !LITERAL.has(trimmed) && !LOCALE_TAG.test(trimmed);
}

/** A phrase: English words with a space between, which a key or an enum value never has. */
function phrase(text: string): boolean {
  return english(text) && /[A-Za-z]\s+[A-Za-z]/.test(text);
}

/** Whether a function says it returns a string, as the data hooks' text builders do. */
function returnsString(fn: Node | undefined): boolean {
  const annotation = fn && child(fn, "returnType");
  const type = annotation && child(annotation, "typeAnnotation");
  if (type === undefined) return false;
  if (type.type === "TSStringKeyword") return true;
  return (
    type.type === "TSUnionType" &&
    (type.types as Node[]).some((member) => member.type === "TSStringKeyword")
  );
}

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Where a string held in a variable or returned from a function is, as a rule, read on screen. */
const SCREENS_AND_DATA = /^(app|src\/(data|components))\//;

function scan(file: string, source: string): string[] {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const words = SCREENS_AND_DATA.test(file);
  const found: string[] = [];
  const report = (items: Found[], test: (text: string) => boolean) => {
    for (const item of items) {
      if (test(item.text)) found.push(`${file}:${item.line} ${JSON.stringify(item.text.trim())}`);
    }
  };

  function visit(node: Node, fn: Node | undefined, parent: Node | undefined): void {
    if (translates(node)) return;
    switch (node.type) {
      case "JSXText":
        report([{ line: node.loc?.start.line ?? 0, text: node.value as string }], english);
        break;
      case "JSXExpressionContainer":
        if (parent?.type === "JSXElement" || parent?.type === "JSXFragment") {
          report(valuesOf(child(node, "expression")), english);
        }
        break;
      case "JSXAttribute": {
        if (!TEXT_PROPS.has(nameOf(child(node, "name")) ?? "")) break;
        const value = child(node, "value");
        report(
          value?.type === "JSXExpressionContainer"
            ? valuesOf(child(value, "expression"))
            : valuesOf(value),
          english,
        );
        break;
      }
      case "ObjectProperty": {
        const values = valuesOf(child(node, "value"));
        report(values, TEXT_PROPS.has(nameOf(child(node, "key")) ?? "") ? english : phrase);
        break;
      }
      case "CallExpression":
        // State holding words, such as setTrouble("That did not work."), freezes them in one
        // language; a kind, such as setTrouble("no_code"), is translated where it is shown.
        if (/^set[A-Z]/.test(nameOf(child(node, "callee")) ?? "")) {
          report((node.arguments as Node[]).flatMap(valuesOf), phrase);
        }
        break;
      case "LogicalExpression": {
        // A stand-in word for a missing name: `displayName ?? "Mom"`.
        const right = child(node, "right");
        if (words && node.operator !== "&&" && right?.type === "StringLiteral") {
          report(valuesOf(right), english);
        }
        break;
      }
      case "VariableDeclarator":
        if (words) report(valuesOf(child(node, "init")), phrase);
        break;
      case "ReturnStatement":
        if (words) report(valuesOf(child(node, "argument")), returnsString(fn) ? english : phrase);
        break;
      case "ArrowFunctionExpression": {
        const body = child(node, "body");
        if (words && body !== undefined && body.type !== "BlockStatement") {
          report(valuesOf(body), returnsString(node) ? english : phrase);
        }
        break;
      }
    }
    const inner = FUNCTIONS.has(node.type) ? node : fn;
    for (const next of children(node)) visit(next, inner, node);
  }

  visit(ast as unknown as Node, undefined, undefined);
  // A string can be reached by two rules, such as a fallback inside a child; it is listed once.
  return [...new Set(found)];
}

function sources(): string[] {
  const listed = (dir: string, extensions: RegExp) =>
    readdirSync(join(APP, dir), { recursive: true, encoding: "utf8" })
      .map((path) => `${dir}/${path.replaceAll("\\", "/")}`)
      .filter((path) => extensions.test(path) && !/\.(test|d)\.ts$/.test(path));
  return [
    ...listed("app", /\.tsx$/),
    ...listed("src", /\.tsx?$/).filter((path) => !path.startsWith("src/i18n/locales/")),
  ].sort();
}

describe("the app's words", () => {
  it("all pass through Lingui", () => {
    const found = sources().flatMap((file) => scan(file, readFileSync(join(APP, file), "utf8")));
    expect(found).toEqual([]);
  });
});

describe("the scanner", () => {
  // A sample writes a template's placeholder as #{…}, so the sample itself stays a plain string.
  const scanned = (source: string, file = "app/example.tsx") =>
    scan(file, source.replaceAll("#{", "${")).length;

  it("finds English in text, props, templates, refusals and data returns", () => {
    expect(scanned("const a = <Words>No word yet.</Words>;")).toBe(1);
    expect(scanned('const a = <Chip label="Use this" />;')).toBe(1);
    expect(scanned("const a = <Words>{`We sent a code to #{sentTo}.`}</Words>;")).toBe(1);
    expect(scanned('const a = <Words>{on ? "Resume" : "Pause"}</Words>;')).toBe(2);
    expect(scanned('const a = <Eyebrow>{[day, `#{asker} asked`].join(" · ")}</Eyebrow>;')).toBe(1);
    expect(scanned('setTrouble("That did not work.");')).toBe(1);
    expect(scanned("const o = { options: { title: `Ask #{name} something` } };")).toBe(1);
    expect(scanned('function f(): string { return "quiet"; }', "src/data/x.ts")).toBe(1);
    expect(scanned("const f = (n: string) => `#{n} said yes`;", "src/data/x.ts")).toBe(1);
    expect(scanned('const fixture = { text: "The tomatoes turned." };', "src/data/x.ts")).toBe(1);
    expect(scanned("const hold = paused ? `#{name}'s light is paused.` : null;")).toBe(1);
    expect(scanned('const her = name ?? "Mom";')).toBe(1);
    expect(scanned("setResolution(`You said #{name} is fine.`);")).toBe(1);
    expect(scanned('function reach(): string { return "She hears it."; }')).toBe(1);
  });

  it("passes translated words, names, formats, keys and enum values", () => {
    expect(scanned("const a = <Words><Trans>No word yet.</Trans></Words>;")).toBe(0);
    expect(scanned("const a = <Chip label={t`Use this`} />;")).toBe(0);
    expect(scanned('const a = t({ comment: "stands in for her name", message: "her" });')).toBe(0);
    expect(scanned('const a = plural(n, { one: "Said yes", other: "All said yes" });')).toBe(0);
    expect(scanned("const a = <Words>Vela Light</Words>;")).toBe(0);
    expect(scanned('const a = <TextField placeholder="+886 900 000 000" />;')).toBe(0);
    expect(scanned("const a = <Words>{`#{asker} → #{recipient}`}</Words>;")).toBe(0);
    expect(scanned('setTrouble("took_too_long");')).toBe(0);
    expect(scanned('if (kind === "heart Mia") setStep("code");')).toBe(0);
    expect(scanned('function f(): Plan { return "none"; }', "src/data/x.ts")).toBe(0);
    expect(scanned('function f(): string { return "en-GB"; }', "src/data/x.ts")).toBe(0);
    expect(scanned('const z = { zone: "Asia/Taipei", kind: "two_photos" };')).toBe(0);
    expect(scanned('const [step, setStep] = useState("identifier"); setWhen("another_day");')).toBe(
      0,
    );
    expect(scanned('const her = name ?? "Mom";', "src/api/client.ts")).toBe(0);
    expect(scanned('const a = <TextField placeholder="Mia" />;')).toBe(0);
    expect(scanned('function path(): string { return [`M #{x} #{y}`, "Z"].join(" "); }')).toBe(0);
  });
});
