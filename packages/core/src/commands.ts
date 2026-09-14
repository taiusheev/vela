/**
 * Plain-word commands from a kept-light member (spec §9, §14.3 M5): stop, start, and what the family
 * sees, in every language she might write, with no slash needed.
 *
 * Only a whole message is a command. Her answers are free speech, and "I had to stop at the market"
 * must light the light rather than pause it, so a keyword inside a longer message never matches.
 * Matching is language-independent because she may write in a language other than her setting.
 */

export type ParentCommand = "stop" | "start" | "what_family_sees";

/**
 * The words she is told to use must stay here: English copy says "Say start", Traditional Chinese
 * copy says 「停」 and 「開始」, and the zh-TW pilot materials use both 家人看到什麼 (consent script
 * section 4, privacy notice) and 家人看得到什麼 (the script's answer to common question 3).
 * Simplified forms sit beside the Traditional ones because some phones type simplified characters by
 * default, and a stop she cannot get recognised is a promise broken.
 */
export const PARENT_COMMAND_KEYWORDS: Readonly<Record<ParentCommand, readonly string[]>> = {
  stop: [
    // en
    "stop",
    "pause",
    // zh-TW
    "停",
    "停止",
    "暫停",
    "暂停",
    "不要了",
    // ja
    "ストップ",
    "やめて",
    "止めて",
    "一時停止",
    // de
    "stopp",
    "anhalten",
    "aufhören",
    // hi
    "रुको",
    "रोको",
    "बंद करो",
    // ru
    "стоп",
    "хватит",
    "не надо",
    "пауза",
  ],
  start: [
    // en
    "start",
    "resume",
    // zh-TW
    "開始",
    "开始",
    "繼續",
    "继续",
    // ja
    "再開",
    "スタート",
    // de
    "weiter",
    "fortsetzen",
    // hi
    "शुरू करो",
    "फिर से शुरू करो",
    // ru
    "старт",
    "начать",
    "продолжить",
  ],
  what_family_sees: [
    // en
    "what does the family see",
    "what does my family see",
    // zh-TW
    "家人看到什麼",
    "家人看到甚麼",
    "家人看到什么",
    "家人看得到什麼",
    "家人看得到甚麼",
    "家人看得到什么",
    // ja
    "家族には何が見える",
    "家族には何が見えますか",
    // de
    "was sieht die familie",
    "was sieht meine familie",
    // hi
    "परिवार क्या देखता है",
    "परिवार को क्या दिखता है",
    // ru
    "что видит семья",
    "что видит моя семья",
  ],
};

/**
 * Whitespace, punctuation (including CJK brackets and full stops, the Devanagari danda, and the slash
 * of a typed `/stop`), and invisible format characters some keyboards insert.
 */
const EDGES = /^[\s\p{P}\p{Cf}]+|[\s\p{P}\p{Cf}]+$/gu;
const INNER_SPACE = /\s+/gu;

/**
 * NFKC folds full-width Latin and half-width katakana into their usual forms, so `ｓｔｏｐ` and `ｽﾄｯﾌﾟ`
 * match like `stop` and `ストップ`.
 */
function normalise(text: string): string {
  return text.normalize("NFKC").replace(EDGES, "").replace(INNER_SPACE, " ").toLowerCase();
}

const COMMANDS: readonly ParentCommand[] = ["stop", "start", "what_family_sees"];

const LOOKUP: ReadonlyMap<string, ParentCommand> = new Map(
  COMMANDS.flatMap((command) =>
    PARENT_COMMAND_KEYWORDS[command].map((keyword): [string, ParentCommand] => [
      normalise(keyword),
      command,
    ]),
  ),
);

export function parseParentCommand(text: string): ParentCommand | null {
  return LOOKUP.get(normalise(text)) ?? null;
}
