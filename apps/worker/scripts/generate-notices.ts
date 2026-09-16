/**
 * Writes `src/notices.generated.ts` from the privacy notices in `plan/materials/pilot` (H4). Run it
 * after every change to either notice:
 *
 *   pnpm --filter @vela/worker notices
 *
 * The Worker serves only the committed module, never the Markdown, so an edit that was not
 * regenerated would never reach families; `src/notices.test.ts` renders the Markdown again and
 * fails while the module is stale, which CI runs before every deploy.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NOTICE_DIRECTORY, NOTICE_FILES } from "../src/notices.ts";
import { noticesModule } from "./notice-markdown.ts";

const REPOSITORY = new URL("../../../", import.meta.url);

function source(file: string): string {
  return readFileSync(new URL(`${NOTICE_DIRECTORY}/${file}`, REPOSITORY), "utf8");
}

const target = fileURLToPath(new URL("../src/notices.generated.ts", import.meta.url));
writeFileSync(
  target,
  noticesModule({ en: source(NOTICE_FILES.en), "zh-TW": source(NOTICE_FILES["zh-TW"]) }),
);
console.log(`Wrote ${target}`);
