/**
 * Source-bound conversational memories. No I/O and no model input: callers must load sources
 * through family authorization. This policy is not an authorization boundary or a health detector.
 * No runtime uses it until the storage, consent and API rollout in plan/light-memories-wellbeing.md.
 */
import { FAMILY_MEMORY_KINDS, type FamilyMemoryKind } from "@vela/contracts";

export { FAMILY_MEMORY_KINDS, type FamilyMemoryKind } from "@vela/contracts";

export interface MemorySource {
  id: string;
  familyId: string;
  memberId: string;
  /** Revision changes whenever words/transcription/translation are corrected. */
  revision: number;
  text: string;
  occurredAt: Date;
  expiresAt: Date;
  deleted: boolean;
  /** Upstream eligibility, never supplied by the model; unknown fails closed. */
  sensitivity: "ordinary" | "health" | "unknown";
}

export interface MemorySelection {
  familyId: string;
  memberId: string;
  kind: FamilyMemoryKind;
  sourceId: string;
  sourceRevision: number;
  /** UTF-16 offsets into the original text. Never accept a model-authored paraphrase as a quote. */
  start: number;
  end: number;
}

export interface FamilyMemory {
  familyId: string;
  memberId: string;
  kind: FamilyMemoryKind;
  sourceId: string;
  sourceRevision: number;
  start: number;
  end: number;
  quote: string;
  occurredAt: Date;
  expiresAt: Date;
}

function validDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

/**
 * Materialise only exact words still covered by an eligible, unchanged source. Stored candidates
 * must be rechecked on every read, so deleting/correcting a source cannot leave a stale quotation.
 * Rich memory consent is separate from the historical dated-plan MEMORY switch.
 */
export function materializeFamilyMemory(input: {
  selection: MemorySelection;
  source: MemorySource | null;
  now: Date;
  enabled: boolean;
  consentedAt: Date | null;
}): FamilyMemory | null {
  const { selection, source, now, enabled, consentedAt } = input;
  if (
    !enabled ||
    source === null ||
    consentedAt === null ||
    !validDate(now) ||
    !validDate(consentedAt) ||
    !validDate(source.occurredAt) ||
    !validDate(source.expiresAt) ||
    consentedAt > now ||
    source.occurredAt < consentedAt ||
    source.occurredAt > now ||
    source.expiresAt <= now ||
    source.deleted ||
    source.sensitivity !== "ordinary" ||
    source.familyId !== selection.familyId ||
    source.memberId !== selection.memberId ||
    source.id !== selection.sourceId ||
    source.revision !== selection.sourceRevision ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1 ||
    !FAMILY_MEMORY_KINDS.includes(selection.kind) ||
    !Number.isSafeInteger(selection.start) ||
    !Number.isSafeInteger(selection.end) ||
    selection.start < 0 ||
    selection.end <= selection.start ||
    selection.end > source.text.length ||
    selection.end - selection.start > 2000
  ) {
    return null;
  }
  const quote = source.text.slice(selection.start, selection.end);
  if (!quote.trim()) return null;
  return {
    ...selection,
    quote,
    occurredAt: new Date(source.occurredAt),
    expiresAt: new Date(source.expiresAt),
  };
}

/** Stable key for deduplicating a selection, without copying family words into an index or log. */
export function familyMemoryKey(memory: FamilyMemory): string {
  return JSON.stringify([
    memory.familyId,
    memory.memberId,
    memory.sourceId,
    memory.sourceRevision,
    memory.start,
    memory.end,
  ]);
}
