/** Draft-only everyday support policy. No model, storage, health advice or live consent route.
 * Inputs must come from trusted source/audience reads and human review, never a client or model.
 * Every presentation is rebuilt from the current sources; stored rendered quotations are invalid.
 */
export const WEEKLY_SUPPORT_REVIEW_VERSION = "weekly.support.review@1";
export const WEEKLY_SUPPORT_TEMPLATE_VERSION = "weekly.support.templates@1";
export const WEEKLY_SUPPORT_KINDS = ["shared_interest", "company", "practical_help"] as const;
export type WeeklySupportKind = (typeof WEEKLY_SUPPORT_KINDS)[number];

export interface WeeklySupportSource {
  id: string;
  familyId: string;
  memberId: string;
  revision: number;
  text: string;
  occurredAt: Date;
  expiresAt: Date;
  deleted: boolean;
  /** Independent screening; unknown and health always fail closed. */
  sensitivity: "ordinary" | "health" | "unknown";
  /** Readers authorised for this source right now, not a historical family roster. */
  readerIds: readonly string[];
}

/** A human selects a specific offer or interest; a model cannot declare its own input eligible. */
export interface WeeklySupportSelection {
  sourceId: string;
  sourceRevision: number;
  start: number;
  end: number;
  kind: WeeklySupportKind;
  reviewerId: string;
  reviewedAt: Date;
  /** Human-reviewed relevance deadline, so a passed plan never becomes next week’s offer. */
  validUntil: Date;
}

export interface WeeklySupportContext {
  enabled: boolean;
  familyId: string;
  memberId: string;
  viewerId: string;
  activeMemberIds: readonly string[];
  organiserIds: readonly string[];
  /** Separate future-purpose permission. Existing health-word or memory permission is insufficient. */
  permission: { version: string; givenAt: Date; withdrawnAt: Date | null } | null;
  now: Date;
  weekFrom: Date;
  weekUntil: Date;
}

export interface WeeklySupportSuggestion {
  /** IDs and revisions only; no quotation in the identity. */
  id: string;
  kind: WeeklySupportKind;
  templateVersion: typeof WEEKLY_SUPPORT_TEMPLATE_VERSION;
  status: "review_draft";
  expiresAt: Date;
  source: {
    id: string;
    revision: number;
    start: number;
    end: number;
    quote: string;
    occurredAt: Date;
    expiresAt: Date;
  };
}

const valid = (date: Date) => Number.isFinite(date.getTime());
const DAY = 86_400_000;

/** Up to 3 source-backed drafts, with no fallback advice when evidence or permission is missing. */
export function buildWeeklySupportDraft(
  context: WeeklySupportContext,
  sources: readonly WeeklySupportSource[],
  selections: readonly WeeklySupportSelection[],
): WeeklySupportSuggestion[] {
  const { permission, now, weekFrom, weekUntil } = context;
  if (
    !context.enabled ||
    permission === null ||
    permission.version !== WEEKLY_SUPPORT_REVIEW_VERSION ||
    permission.withdrawnAt !== null ||
    ![now, weekFrom, weekUntil, permission.givenAt].every(valid) ||
    permission.givenAt > now ||
    weekFrom >= weekUntil ||
    weekFrom > now ||
    weekUntil.getTime() - weekFrom.getTime() > 8 * DAY ||
    now.getTime() >= weekUntil.getTime() + 30 * DAY ||
    !context.activeMemberIds.includes(context.memberId) ||
    !context.activeMemberIds.includes(context.viewerId) ||
    (context.viewerId !== context.memberId && !context.organiserIds.includes(context.viewerId))
  )
    return [];

  const byId = new Map<string, WeeklySupportSource>();
  const ambiguous = new Set<string>();
  for (const source of sources.slice(0, 100)) {
    if (byId.has(source.id)) ambiguous.add(source.id);
    byId.set(source.id, source);
  }
  const seen = new Set<string>();
  const drafts: WeeklySupportSuggestion[] = [];
  for (const selection of selections.slice(0, 100)) {
    const source = byId.get(selection.sourceId);
    if (
      source === undefined ||
      ambiguous.has(source.id) ||
      seen.has(source.id) ||
      source.familyId !== context.familyId ||
      source.memberId !== context.memberId ||
      source.deleted ||
      source.sensitivity !== "ordinary" ||
      !source.readerIds.includes(context.viewerId) ||
      ![source.occurredAt, source.expiresAt, selection.reviewedAt, selection.validUntil].every(
        valid,
      ) ||
      source.occurredAt < permission.givenAt ||
      source.occurredAt > now ||
      source.occurredAt < weekFrom ||
      source.occurredAt >= weekUntil ||
      source.expiresAt <= now ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 1 ||
      source.revision !== selection.sourceRevision ||
      !context.activeMemberIds.includes(selection.reviewerId) ||
      !context.organiserIds.includes(selection.reviewerId) ||
      selection.reviewedAt < source.occurredAt ||
      selection.reviewedAt > now ||
      selection.validUntil <= now ||
      selection.validUntil <= selection.reviewedAt ||
      !WEEKLY_SUPPORT_KINDS.includes(selection.kind) ||
      !Number.isSafeInteger(selection.start) ||
      !Number.isSafeInteger(selection.end) ||
      selection.start < 0 ||
      selection.end <= selection.start ||
      selection.end > source.text.length ||
      selection.end - selection.start > 1000
    )
      continue;
    const quote = source.text.slice(selection.start, selection.end);
    const first = quote.charCodeAt(0);
    const last = quote.charCodeAt(quote.length - 1);
    if (!quote.trim() || (first >= 0xdc00 && first <= 0xdfff) || (last >= 0xd800 && last <= 0xdbff))
      continue;
    const expiresAt = new Date(
      Math.min(
        source.expiresAt.getTime(),
        selection.validUntil.getTime(),
        weekUntil.getTime() + 30 * DAY,
      ),
    );
    drafts.push({
      id: JSON.stringify([
        WEEKLY_SUPPORT_TEMPLATE_VERSION,
        source.id,
        source.revision,
        selection.start,
        selection.end,
        selection.kind,
      ]),
      kind: selection.kind,
      templateVersion: WEEKLY_SUPPORT_TEMPLATE_VERSION,
      status: "review_draft",
      expiresAt,
      source: {
        id: source.id,
        revision: source.revision,
        start: selection.start,
        end: selection.end,
        quote,
        occurredAt: new Date(source.occurredAt),
        expiresAt: new Date(source.expiresAt),
      },
    });
    seen.add(source.id);
    if (drafts.length === 3) break;
  }
  return drafts;
}
