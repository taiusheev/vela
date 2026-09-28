import { PushData, type PushKind } from "@vela/contracts";

/**
 * Where a tapped notification opens, and how one that arrives while the app is open is shown
 * (ADR-34, A4), as rules apart from the phone. A notification carries ids only (`PushData`), never
 * words, so everything it opens is read again from the API as the reader is allowed to see it.
 */

export type TapTarget =
  /** Today, and for a quiet notice the sheet for that event, which says calmly if it is settled. */
  | { screen: "today"; quietEventId?: string }
  | { screen: "exchange"; exchangeId: string }
  | { screen: "ask"; recipientId: string; suggestionId?: string };

const DATA_KEYS = [
  "kind",
  "family_id",
  "member_id",
  "quiet_event_id",
  "exchange_id",
  "suggestion_id",
] as const;

/**
 * A notification's data as Vela sent it, or null for anything else. Only the keys Vela sends are
 * read, so a field a platform adds does not make a real notification unreadable.
 */
export function pushDataOf(data: unknown): PushData | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of DATA_KEYS) {
    if (record[key] !== undefined && record[key] !== null) picked[key] = record[key];
  }
  const parsed = PushData.safeParse(picked);
  return parsed.success ? parsed.data : null;
}

/**
 * Where a tap goes. The app shows one family (the first membership) until it has a family switcher,
 * so an exchange or a turn of another family opens Today rather than a screen that would show, or
 * ask, the wrong family's people. A quiet notice opens its sheet whichever family it is: the sheet
 * is read by its event, which the API gives only to that family's organisers.
 */
export function tapTargetOf(data: PushData, shownFamilyId: string | undefined): TapTarget {
  const shown = shownFamilyId !== undefined && data.family_id === shownFamilyId;
  switch (data.kind) {
    case "quiet_notice":
      return data.quiet_event_id === undefined
        ? { screen: "today" }
        : { screen: "today", quietEventId: data.quiet_event_id };
    case "quiet_resolved":
      return { screen: "today" };
    case "answer_receipt":
      return shown && data.exchange_id !== undefined
        ? { screen: "exchange", exchangeId: data.exchange_id }
        : { screen: "today" };
    case "turn_prompt":
      if (!shown) return { screen: "today" };
      return data.suggestion_id === undefined
        ? { screen: "ask", recipientId: data.member_id }
        : { screen: "ask", recipientId: data.member_id, suggestionId: data.suggestion_id };
  }
}

/** The route a target opens, as expo-router takes it. */
export type TapHref =
  | { pathname: "/"; params: { quiet?: string } }
  | { pathname: "/exchange/[id]"; params: { id: string } }
  | { pathname: "/ask"; params: { recipient: string; suggestion?: string } };

export function hrefOf(target: TapTarget): TapHref {
  switch (target.screen) {
    case "today":
      return {
        pathname: "/",
        params: target.quietEventId === undefined ? {} : { quiet: target.quietEventId },
      };
    case "exchange":
      return { pathname: "/exchange/[id]", params: { id: target.exchangeId } };
    case "ask":
      return {
        pathname: "/ask",
        params:
          target.suggestionId === undefined
            ? { recipient: target.recipientId }
            : { recipient: target.recipientId, suggestion: target.suggestionId },
      };
  }
}

/** How a notification arriving while the app is open is shown (expo-notifications' behaviour). */
export interface ForegroundBehaviour {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: false;
}

const QUIET_KINDS: ReadonlySet<PushKind> = new Set<PushKind>(["quiet_notice", "quiet_resolved"]);

/**
 * A quiet notice and its close show as a banner with their sound even with the app open: the reader
 * may be on another screen. Anything else goes quietly to the list, since what it says is in the
 * app already. Never a badge (spec A6).
 */
export function foregroundBehaviour(data: unknown): ForegroundBehaviour {
  const kind = pushDataOf(data)?.kind;
  const quiet = kind !== undefined && QUIET_KINDS.has(kind);
  return {
    shouldShowBanner: quiet,
    shouldShowList: true,
    shouldPlaySound: quiet,
    shouldSetBadge: false,
  };
}
