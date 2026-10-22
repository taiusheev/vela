import { setupI18n } from "@lingui/core";
import { messages as en } from "./locales/memory-sharing/en.po";

/** English-only isolated draft. Never changes the family's app locale or claims translation. */
export const sharingI18n = setupI18n({ locale: "en", messages: { en } });
