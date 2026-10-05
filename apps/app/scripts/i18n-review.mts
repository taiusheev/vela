import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { type PoItem, parsePo } from "pofile-ts";

/**
 * What a native Taiwanese reader still has to read (build plan 2.4): every English line of the app
 * beside its Traditional Chinese draft, with a count. A line is signed off by adding the flag
 * `#, native-reviewed` above its msgid in src/i18n/locales/zh-TW.po; until then it is a draft.
 *
 *   pnpm --filter @vela/app i18n:review                         prints them
 *   pnpm --filter @vela/app i18n:review .work/zh-TW-review.md   also writes them, as a table
 *   pnpm --filter @vela/app i18n:review .work/zh-TW-review.csv  or as CSV
 *
 * A relative path is read from where pnpm was run.
 */

const FLAG = "native-reviewed";
const catalog = new URL("../src/i18n/locales/zh-TW.po", import.meta.url);
const items = parsePo(readFileSync(catalog, "utf8")).items.filter((item) => !item.obsolete);
const drafts = items.filter((item) => item.flags[FLAG] !== true);

interface Pair {
  english: string;
  chinese: string;
  context: string;
}

const pairs: Pair[] = drafts.map((item: PoItem) => ({
  english: item.msgid,
  chinese: item.msgstr[0] ?? "",
  context: item.msgctxt ?? "",
}));

console.log(
  `${drafts.length} of ${items.length} zh-TW lines await native review (build plan 2.4).`,
);
for (const pair of pairs) {
  const context = pair.context === "" ? "" : `  (${pair.context})`;
  console.log(`\n${pair.english}${context}\n  ${pair.chinese === "" ? "—" : pair.chinese}`);
}

function markdown(rows: readonly Pair[]): string {
  const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    `# zh-TW lines awaiting native review (${rows.length} of ${items.length})`,
    "",
    "Sign a line off with `#, native-reviewed` above its msgid in apps/app/src/i18n/locales/zh-TW.po.",
    "",
    "| English | Traditional Chinese (draft) | Context |",
    "|---|---|---|",
    ...rows.map((row) => `| ${cell(row.english)} | ${cell(row.chinese)} | ${cell(row.context)} |`),
    "",
  ].join("\n");
}

function csv(rows: readonly Pair[]): string {
  const field = (text: string) => `"${text.replaceAll('"', '""')}"`;
  // The byte-order mark makes a spreadsheet read the file as UTF-8 rather than mangle the Chinese.
  return [
    "﻿english,chinese,context",
    ...rows.map((row) => [row.english, row.chinese, row.context].map(field).join(",")),
    "",
  ].join("\n");
}

const out = process.argv[2];
if (out !== undefined) {
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), out);
  writeFileSync(path, extname(path) === ".csv" ? csv(pairs) : markdown(pairs), "utf8");
  console.log(`\nWritten to ${path}`);
}
