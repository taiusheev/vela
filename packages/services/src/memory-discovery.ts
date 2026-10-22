/**
 * Memory suggestions from her own answers (privacy-notice v7 wording, consent.rich_memories@2):
 * after an answer is understood, an ordinary one may go to `memory_pick`, which points at up to two
 * exact phrases; code keeps only phrases found word for word and proposes them as her private
 * candidates. Off unless both `richMemories` and `memoryDiscovery` are on (MEMORY_DISCOVERY is off
 * in every environment until the founder approves the screening).
 *
 * Screening comes first and fails closed. Her words reach the memory model only when every one of
 * these, each independent of that model, says the answer is ordinary:
 * 1. the flag call ran and raised nothing;
 * 2. the understand call ran and named no health mention (read before the no-consent wipe);
 * 3. none of the health, body, money, religion, politics or loss words below is in her words.
 * An answer before her yes, a withdrawn yes, or an older version gets nothing, and the candidate
 * service checks all of that again with the source under lock.
 */
import type { AiOutcome, FlagResult, Understanding } from "@vela/ai";
import { type answers, consents, type Exchange, type Member } from "@vela/db";
import { and, desc, eq } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import {
  proposeMemoryCandidate,
  RICH_MEMORY_CONSENT_VERSION,
  sourceWords,
} from "./rich-memories.ts";

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

/** Her current memory yes, given before this answer arrived; anything else permits nothing. */
async function permitted(
  deps: Pick<Deps, "db">,
  member: Member,
  answer: typeof answers.$inferSelect,
): Promise<boolean> {
  const [latest] = await deps.db
    .select()
    .from(consents)
    .where(and(eq(consents.memberId, member.id), eq(consents.kind, "rich_memories")))
    .orderBy(desc(consents.givenAt), desc(consents.id))
    .limit(1);
  return (
    latest !== undefined &&
    latest.answer === "yes" &&
    latest.withdrawnAt === null &&
    latest.textVersion === RICH_MEMORY_CONSENT_VERSION &&
    latest.givenAt.getTime() <= answer.receivedAt.getTime()
  );
}

/**
 * Proposes her memory candidates from one understood answer. Never throws: a failure here must not
 * undo or repeat her answer's understanding, so it is logged by label and nothing is proposed.
 * Logs only counts and reasons, never her words.
 */
export async function discoverMemories(
  deps: Deps,
  ctx: { answer: typeof answers.$inferSelect; member: Member; exchange: Exchange },
  screen: DiscoveryScreen,
): Promise<number> {
  const { answer, member, exchange } = ctx;
  try {
    if (deps.config.richMemories !== true || deps.config.memoryDiscovery !== true) return 0;
    const skip = screenForMemories(answer, screen);
    if (skip !== null) {
      deps.logger.info("memory_discovery_skipped", { answerId: answer.id, reason: skip });
      return 0;
    }
    if (!(await permitted(deps, member, answer))) {
      deps.logger.info("memory_discovery_skipped", {
        answerId: answer.id,
        reason: "no_permission",
      });
      return 0;
    }
    const words = sourceWords(answer);
    if (words === null) return 0;
    const picked = await deps.ai.memoryPick({
      lang: member.language,
      addressForm: member.addressForm ?? member.displayName,
      ask: exchange.text,
      answer: words.text,
    });
    if (!picked.ok) {
      deps.logger.warn("memory_discovery_failed", { answerId: answer.id });
      return 0;
    }
    let proposed = 0;
    for (const pick of picked.value.picks) {
      const quote = pick.quote.trim();
      // Code, not the model, decides what her words are: only an exact phrase of hers is kept.
      const start = words.text.indexOf(quote);
      if (quote.length < 3 || start === -1 || hasSensitiveWords(quote)) continue;
      const id = await proposeMemoryCandidate(
        deps,
        { source_answer_id: answer.id, kind: pick.kind, start, end: start + quote.length },
        { answerId: answer.id, ordinaryText: words.text },
      );
      if (id !== null) proposed += 1;
    }
    deps.logger.info("memory_discovery", {
      answerId: answer.id,
      picked: picked.value.picks.length,
      proposed,
    });
    return proposed;
  } catch (error) {
    deps.logger.error("memory_discovery_error", { answerId: answer.id, error: errorLabel(error) });
    return 0;
  }
}
