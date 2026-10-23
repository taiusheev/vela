/**
 * The screen an answer passes before her words may reach the memory model (ADR-50: suggestions to
 * the family of answers worth keeping, `memories.ts`). It fails closed: her words go only when every
 * one of these, each independent of that model, says the answer is ordinary:
 * 1. the flag call ran and raised nothing;
 * 2. the understand call ran and named no health mention (read before the no-consent wipe);
 * 3. none of the health, body, money, religion, politics or loss words below is in her words.
 */
import type { AiOutcome, FlagResult, Understanding } from "@vela/ai";
import type { answers } from "@vela/db";
import { sourceWords } from "./rich-memories.ts";

/**
 * Words that keep an answer away from the memory model, in English and Traditional Chinese. Broad
 * on purpose: a missed memory costs nothing, a health word sent costs her trust (ADR-27).
 */
const SENSITIVE: readonly RegExp[] = [
  /\b(pain|painful|ache|aches|aching|hurt|hurts|hurting|sore|ill|illness|sick|unwell|fever|cough|cold|flu|covid|virus|infection|injur\w*|wound|bleed\w*|blood|bruise\w*|swollen|dizz\w*|faint\w*|fell|fall|falls|fallen|tired|exhausted|sleep\w*|insomnia|appetite|eat(?:ing)? (?:little|less|nothing)|weight)\b/i,
  /\b(doctor|doctors|dr\.?|nurse|clinic|hospital\w*|surgery|operation|scan|x-?ray|test results?|diagnos\w*|treatment|therapy|medicine|medication|meds|pill\w*|tablet\w*|prescription|dose|injection|vaccin\w*|pharmacy|ambulance|emergency)\b/i,
  /\b(heart|chest|lung\w*|breath\w*|stomach|bowel|bladder|kidney\w*|liver|knee\w*|hip|hips|back|spine|joint\w*|arthritis|bone\w*|skin|eye\w*|ear\w*|teeth|tooth|dentist|blood pressure|sugar|diabet\w*|cancer|tumou?r|stroke|dementia|memory loss|forget\w*|alzheimer\w*|parkinson\w*|depress\w*|anxi\w*|lonely|alone|sad|cry\w*|scared|afraid|worried)\b/i,
  /\b(money|debt|loan|bank|pension|rent|bill|bills|scam|password|religio\w*|church|temple|pray\w*|god|politic\w*|election|vote|party|divorce|fight|fought|argu\w*|angry|died|death|dead|funeral|grave|passed away|cemetery)\b/i,
  /(痛|疼|酸|病|不舒服|發燒|咳嗽|感冒|受傷|流血|跌倒|摔|頭暈|暈倒|累|睡|失眠|胃口|吃不下|體重|醫|護士|診所|醫院|開刀|手術|檢查|報告|診斷|治療|藥|針|疫苗|救護車|急診|心臟|胸|肺|呼吸|胃|腸|腎|肝|膝|腰|背|骨|關節|皮膚|眼|耳|牙|血壓|血糖|糖尿|癌|中風|失智|忘|憂鬱|焦慮|孤單|寂寞|難過|哭|害怕|擔心|錢|債|貸|銀行|退休金|房租|帳單|詐騙|密碼|宗教|教會|廟|拜拜|祈禱|政治|選舉|投票|離婚|吵架|生氣|過世|死|喪|墳)/u,
];

/** Whether any sensitive word is in her words: then nothing is sent to the memory model. */
export function hasSensitiveWords(text: string): boolean {
  return SENSITIVE.some((pattern) => pattern.test(text));
}

/** What the understanding step saw, read before anything was wiped for lack of consent. */
export interface DiscoveryScreen {
  understanding: AiOutcome<Understanding>;
  flag: AiOutcome<FlagResult>;
}

export type DiscoverySkip =
  | "off"
  | "no_words"
  | "not_understood"
  | "flagged"
  | "health_mentioned"
  | "sensitive_words"
  | "no_permission";

/** Why an answer was not screened through, or null when it may go to the memory model. */
export function screenForMemories(
  answer: typeof answers.$inferSelect,
  screen: DiscoveryScreen,
): DiscoverySkip | null {
  const words = sourceWords(answer);
  if (words === null || words.text.trim().length === 0) return "no_words";
  if (!screen.understanding.ok || !screen.flag.ok) return "not_understood";
  if (screen.flag.value.flag || answer.flag) return "flagged";
  if (screen.understanding.value.mentions.health.length > 0) return "health_mentioned";
  if (hasSensitiveWords(words.text)) return "sensitive_words";
  return null;
}
