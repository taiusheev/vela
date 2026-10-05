import { ASK_BANK, type AskBankItem } from "@vela/copy";

/**
 * Story day (spec §10, A10): the story prompts of Vela's bank, gently ordered as the bank orders
 * them (childhood, work, friends, family, places), and the Sunday the next story goes to.
 */

export const STORY_PROMPTS: readonly AskBankItem[] = ASK_BANK.filter(
  (item) => item.type === "story",
);

/** Skip questions already asked in either language; an exhausted list offers no repeat. */
export function nextPrompt(
  asked: ReadonlySet<string>,
  skip: number,
  _lang: "en" | "zh-TW",
): AskBankItem | undefined {
  const fresh = STORY_PROMPTS.filter((item) =>
    Object.values(item.text).every((text) => !asked.has(text.trim())),
  );
  return fresh.length === 0 ? undefined : fresh[skip % fresh.length];
}

/** The coming Sunday as a local date, never today: a story ask names a morning still ahead. */
export function nextSunday(today: Date, timeZone?: string): string {
  if (timeZone !== undefined) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(today);
    const part = (name: string) => Number(parts.find((item) => item.type === name)?.value);
    const local = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
    const days = (7 - local.getUTCDay()) % 7 || 7;
    local.setUTCDate(local.getUTCDate() + days);
    return local.toISOString().slice(0, 10);
  }
  const days = (7 - today.getDay()) % 7 || 7;
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const month = String(sunday.getMonth() + 1).padStart(2, "0");
  const day = String(sunday.getDate()).padStart(2, "0");
  return `${sunday.getFullYear()}-${month}-${day}`;
}
