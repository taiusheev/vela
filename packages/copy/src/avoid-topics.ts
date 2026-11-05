/**
 * What the organiser asked Vela never to bring up (onboarding v2, "How do you and Mom talk?"), and
 * how code keeps it out of her mornings. Matching is plain words in both languages, on purpose: the
 * topics never go to the AI ("her health" is itself a health word, ADR-47), and a question that only
 * might touch a topic is left out rather than risked. The same matcher runs in the app (her first
 * week) and on the server (the bank's daily pick and anything drafted in the organiser's name).
 */
import type { AvoidTopic } from "@vela/contracts";
import type { AskBankItem, AskBankLang } from "./ask-bank.ts";

export interface Avoidance {
  readonly topics: readonly AvoidTopic[];
  /** The organiser's own words, up to three. */
  readonly words: readonly string[];
}

export const NOTHING_TO_AVOID: Avoidance = { topics: [], words: [] };

/**
 * Words that put a question on a topic. English is matched as whole words (and their plurals);
 * Chinese has no spaces, so a listed character run anywhere counts.
 */
const TOPIC_WORDS: Readonly<Record<AvoidTopic, Readonly<Record<AskBankLang, readonly string[]>>>> =
  {
    money: {
      en: [
        "money",
        "price",
        "cost",
        "costs",
        "salary",
        "pension",
        "savings",
        "bank",
        "debt",
        "rich",
        "poor",
        "afford",
        "spend",
        "spent",
        "paid",
        "wage",
      ],
      "zh-TW": ["錢", "價", "薪", "退休金", "存款", "銀行", "債", "費", "花費", "貴", "便宜"],
    },
    health: {
      en: [
        "health",
        "healthy",
        "doctor",
        "hospital",
        "medicine",
        "sick",
        "ill",
        "illness",
        "pain",
        "surgery",
        "body",
        "sleep",
        "slept",
        "tired",
        "exercise",
        "knee",
        "feel",
        "feeling",
      ],
      "zh-TW": ["健康", "醫", "病", "藥", "痛", "手術", "身體", "睡", "累", "運動", "膝", "感覺"],
    },
    work: {
      en: [
        "work",
        "worked",
        "working",
        "job",
        "jobs",
        "office",
        "career",
        "boss",
        "colleague",
        "colleagues",
        "retire",
        "retired",
        "retirement",
      ],
      "zh-TW": ["工作", "上班", "職", "老闆", "同事", "退休"],
    },
    partner: {
      en: [
        "husband",
        "wife",
        "dad",
        "father",
        "mom",
        "mother",
        "married",
        "wedding",
        "marriage",
        "spouse",
      ],
      "zh-TW": ["先生", "老公", "太太", "老婆", "丈夫", "妻子", "爸", "媽", "結婚", "婚"],
    },
  };

const latin = /^[a-z0-9' -]+$/;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, word: string): boolean {
  const needle = word.trim().toLowerCase();
  if (needle.length === 0) return false;
  const haystack = text.toLowerCase();
  if (!latin.test(needle)) return haystack.includes(needle);
  return new RegExp(`(^|[^a-z])${escape(needle)}s?($|[^a-z])`).test(haystack);
}

/** Whether these words touch anything the organiser asked Vela to leave out, in any language. */
export function touchesAvoided(text: string, avoid: Avoidance): boolean {
  for (const topic of avoid.topics) {
    const words = TOPIC_WORDS[topic];
    if ([...words.en, ...words["zh-TW"]].some((word) => mentions(text, word))) return true;
  }
  return avoid.words.some((word) => mentions(text, word));
}

/** Whether a bank question is out: either of its wordings, in either language, touches a topic. */
export function bankItemAvoided(item: AskBankItem, avoid: Avoidance): boolean {
  if (avoid.topics.length === 0 && avoid.words.length === 0) return false;
  return [item.text.en, item.text["zh-TW"], item.child.en, item.child["zh-TW"]].some((text) =>
    touchesAvoided(text, avoid),
  );
}
