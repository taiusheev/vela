import { defineConfig, type LinguiConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

type Format = NonNullable<LinguiConfig["format"]>;

/** Origins without line numbers and messages in text order keep a catalog's diff to its lines. */
const po = { origins: true, lineNumbers: false } as const;

/**
 * The Traditional Chinese catalog says in its header that it is a draft until a native reader signs
 * each entry off with the `native-reviewed` flag (build plan 2.4). The header is written into the
 * file whenever it is extracted, so a catalog made again from nothing still says so.
 */
const NATIVE_REVIEW =
  "pending; entries without the native-reviewed flag are drafts (build plan 2.4)";

const plain = formatter(po);
const reviewed = formatter({ ...po, customHeaderAttributes: { "X-Native-Review": NATIVE_REVIEW } });

const format: Format = {
  ...plain,
  serialize: (catalog, ctx) => (ctx.locale === "zh-TW" ? reviewed : plain).serialize(catalog, ctx),
};

/** English is the source; zh-TW is the one translation until phase 2 (spec §2, build plan 3.1). */
export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "zh-TW"],
  // A missing zh-TW entry shows English at runtime; `pnpm test` fails on it before that can ship.
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/i18n/locales/{locale}",
      include: ["<rootDir>/app", "<rootDir>/src"],
      exclude: ["**/*.test.ts"],
    },
  ],
  format,
  orderBy: "message",
});
