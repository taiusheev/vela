import { ASK_BANK, type AskBankItem } from "@vela/copy";

/**
 * Story day (spec §10, A10): the story prompts of Vela's bank, gently ordered as the bank orders
 * them (childhood, work, friends, family, places), and the Sunday the next story goes to.
 */

export const STORY_PROMPTS: readonly AskBankItem[] = ASK_BANK.filter(
  (item) => item.type === "story",
);

/** The prompt to offer, skipping the ones already asked (by their words), in the bank's order. */
export function nextPrompt(
  asked: ReadonlySet<string>,
  skip: number,
  lang: "en" | "zh-TW",
): AskBankItem | undefined {
  const fresh = STORY_PROMPTS.filter((item) => !asked.has(item.text[lang].trim()));
  const pool = fresh.length > 0 ? fresh : STORY_PROMPTS;
  return pool.length === 0 ? undefined : pool[skip % pool.length];
}

/** The coming Sunday as a local date, never today: a story ask names a morning still ahead. */
export function nextSunday(today: Date): string {
  const days = (7 - today.getDay()) % 7 || 7;
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const month = String(sunday.getMonth() + 1).padStart(2, "0");
  const day = String(sunday.getDate()).padStart(2, "0");
  return `${sunday.getFullYear()}-${month}-${day}`;
}
