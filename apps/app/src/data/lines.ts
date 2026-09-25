import { t } from "@lingui/core/macro";

/**
 * What the family said on an exchange, one whole line per reply with the name inside it: "Anna:
 * Those are the ones from the seeds you saved", "Mia sent a heart". Today, Exchanges and one
 * exchange all read replies through these, so a reply reads the same on each, and a translation
 * gets the name and the verb as one sentence to order as its language does (build plan 3.1).
 * They translate with the language active when called, which is while a screen renders.
 */

/** A reply that carried no words: a heart, a laugh or a hug, or a voice message or a photo. */
export function reactionLine(from: string, kind: string): string {
  switch (kind) {
    case "heart":
      return t`${from} sent a heart`;
    case "laugh":
      return t`${from} sent a laugh`;
    case "hug":
      return t`${from} sent a hug`;
    case "voice":
      return t`${from} sent a voice message`;
    case "photo":
      return t`${from} sent a photo`;
    default:
      return t`${from} replied`;
  }
}

/** One reply: the words after the name when it has any, and what it was when it has none. */
export function replyLine(from: string, kind: string, words: string | null | undefined): string {
  const text = words?.trim() ?? "";
  return text.length > 0 ? t`${from}: ${text}` : reactionLine(from, kind);
}
