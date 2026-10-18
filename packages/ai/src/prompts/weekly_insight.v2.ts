/** v2: keep original evidence in quotes, with the founder's interpretation in English. */
import { system as previous } from "./weekly_insight.v1.ts";
export const version = "weekly_insight.v2";
export const system = `${previous}

Field separation: reading is the English interpretation only. Put the original verbatim evidence and its dates exclusively in quotes, never repeat or embed quotations in reading. The original evidence can be in any language and is not translated or changed. Feedback still uses lang. This avoids duplicating untranslated evidence inside the founder's English interpretation.`;
