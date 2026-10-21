/**
 * Pending conversational selections. No runtime caller yet: Worker configuration never enables
 * richMemories. Ingestion must supply trusted ordinary-content review tied to exact source words;
 * the model is not a reviewer. This module sends no words to AI and creates no permanent copies.
 */
import {
  type ApiMemoryCandidate,
  type MemoryCandidatePage,
  MemoryCandidateSelection,
} from "@vela/contracts";
import { materializeFamilyMemory } from "@vela/core";
import { answers, consents, exchanges, families, members, memoryCandidates, users } from "@vela/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { sha256Hex } from "./hash.ts";
import type { Queryable } from "./repo.ts";

export const RICH_MEMORY_CONSENT_VERSION = "consent.rich_memories@1";
const SOURCE_LIFETIME_MS = 30 * 86_400_000;
const PAGE_SIZE = 50;
export const MAX_MEMORY_CANDIDATES_PER_SOURCE = 12;
const uuid = z.uuid();
type MemoryDeps = Pick<Deps, "db" | "clock" | "config">;

function sourceWords(answer: typeof answers.$inferSelect): { text: string; lang: string } | null {
  if (answer.kind === "voice") {
    return answer.transcript?.trim() && answer.transcriptLang
      ? { text: answer.transcript, lang: answer.transcriptLang }
      : null;
  }
  return answer.kind === "text" && typeof answer.payload.text === "string"
    ? { text: answer.payload.text, lang: answer.transcriptLang ?? "und" }
    : null;
}

function sourceDigest(answer: typeof answers.$inferSelect): Promise<string> {
  return sha256Hex(JSON.stringify([answer.id, answer.memberId, sourceWords(answer)]));
}

const laterConsent = alias(consents, "later_memory_consent");
const viewer = alias(members, "memory_viewer");
function noLaterConsent(db: Queryable) {
  return notExists(
    db
      .select({ id: laterConsent.id })
      .from(laterConsent)
      .where(
        and(
          eq(laterConsent.memberId, consents.memberId),
          eq(laterConsent.kind, "rich_memories"),
          or(
            gt(laterConsent.givenAt, consents.givenAt),
            and(eq(laterConsent.givenAt, consents.givenAt), gt(laterConsent.id, consents.id)),
          ),
        ),
      ),
  );
}

/** Trusted ingestion entry point, not a public request handler. */
export async function proposeMemoryCandidate(
  deps: MemoryDeps,
  input: unknown,
  review: { ordinaryText: string; answerId: string },
): Promise<string | null> {
  if (deps.config.richMemories !== true) return null;
  const parsed = MemoryCandidateSelection.safeParse(input);
  if (!parsed.success) return null;
  const selection = parsed.data;
  const now = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const [location] = await tx
      .select({ familyId: exchanges.familyId, memberId: answers.memberId })
      .from(answers)
      .innerJoin(exchanges, eq(exchanges.id, answers.exchangeId))
      .where(eq(answers.id, selection.source_answer_id));
    if (location === undefined) return null;
    // Family -> member -> answer -> consent matches deletion, keeping and withdrawal lock order.
    const [family] = await tx
      .select()
      .from(families)
      .where(and(eq(families.id, location.familyId), isNull(families.deletedAt)))
      .for("share");
    if (family === undefined) return null;
    const [member] = await tx
      .select()
      .from(members)
      .where(
        and(
          eq(members.id, location.memberId),
          eq(members.familyId, family.id),
          inArray(members.status, ["active", "paused"]),
          isNull(members.leftAt),
        ),
      )
      .for("share");
    if (member === undefined) return null;
    const [answer] = await tx
      .select()
      .from(answers)
      .where(and(eq(answers.id, selection.source_answer_id), eq(answers.memberId, member.id)))
      .for("no key update");
    if (answer === undefined || review.answerId !== answer.id) return null;
    const words = sourceWords(answer);
    if (words === null || words.text !== review.ordinaryText) return null;
    // Existing pipeline health/flag results are an extra refusal, not proof of ordinary content.
    if (answer.flag || (Array.isArray(answer.mentions.health) && answer.mentions.health.length > 0))
      return null;
    const [consent] = await tx
      .select()
      .from(consents)
      .where(and(eq(consents.memberId, member.id), eq(consents.kind, "rich_memories")))
      .orderBy(desc(consents.givenAt), desc(consents.id))
      .limit(1)
      .for("share");
    if (
      consent === undefined ||
      consent.answer !== "yes" ||
      consent.withdrawnAt !== null ||
      consent.subjectDeletedAt !== null ||
      consent.textVersion !== RICH_MEMORY_CONSENT_VERSION
    )
      return null;
    const expiresAt = new Date(answer.receivedAt.getTime() + SOURCE_LIFETIME_MS);
    const memory = materializeFamilyMemory({
      enabled: true,
      now,
      consentedAt: consent.givenAt,
      source: {
        id: answer.id,
        familyId: family.id,
        memberId: member.id,
        revision: 1,
        text: words.text,
        occurredAt: answer.receivedAt,
        expiresAt,
        deleted: false,
        sensitivity: "ordinary",
      },
      selection: {
        familyId: family.id,
        memberId: member.id,
        kind: selection.kind,
        sourceId: answer.id,
        sourceRevision: 1,
        start: selection.start,
        end: selection.end,
      },
    });
    if (memory === null) return null;
    const digest = await sourceDigest(answer);
    const [existing] = await tx
      .select()
      .from(memoryCandidates)
      .where(
        and(
          eq(memoryCandidates.sourceAnswerId, answer.id),
          eq(memoryCandidates.start, memory.start),
          eq(memoryCandidates.end, memory.end),
        ),
      );
    if (existing !== undefined) {
      return existing.dismissedAt === null &&
        existing.sourceDigest === digest &&
        existing.consentId === consent.id
        ? existing.id
        : null;
    }
    // The answer lock serializes count + insertion; dismissals also count, preventing rediscovery.
    const [used] = await tx
      .select({ total: count() })
      .from(memoryCandidates)
      .where(eq(memoryCandidates.sourceAnswerId, answer.id));
    if ((used?.total ?? MAX_MEMORY_CANDIDATES_PER_SOURCE) >= MAX_MEMORY_CANDIDATES_PER_SOURCE)
      return null;
    await tx
      .insert(memoryCandidates)
      .values({
        familyId: family.id,
        memberId: member.id,
        sourceAnswerId: answer.id,
        consentId: consent.id,
        kind: memory.kind,
        start: memory.start,
        end: memory.end,
        sourceDigest: digest,
        createdAt: now,
        expiresAt,
      })
      .onConflictDoNothing();
    const [candidate] = await tx
      .select()
      .from(memoryCandidates)
      .where(
        and(
          eq(memoryCandidates.sourceAnswerId, answer.id),
          eq(memoryCandidates.start, memory.start),
          eq(memoryCandidates.end, memory.end),
        ),
      );
    return candidate?.dismissedAt === null &&
      candidate.sourceDigest === digest &&
      candidate.consentId === consent.id
      ? candidate.id
      : null;
  });
}

/** Bounded, source-backed family read. The cursor is a scanned ID, not an offset. */
export async function loadMemoryCandidates(
  deps: MemoryDeps,
  identity: SessionIdentity,
  familyId: string,
  cursor: string | null = null,
): Promise<MemoryCandidatePage | null> {
  if (deps.config.richMemories !== true || (cursor !== null && !uuid.safeParse(cursor).success))
    return null;
  const access = await authorizeFamilyAccess(deps.db, identity, familyId);
  if (access.kind !== "granted") return null;
  const now = deps.clock.now();
  const rows = await deps.db
    .select({ candidate: memoryCandidates, answer: answers })
    .from(memoryCandidates)
    .innerJoin(answers, eq(answers.id, memoryCandidates.sourceAnswerId))
    .innerJoin(
      families,
      and(eq(families.id, memoryCandidates.familyId), isNull(families.deletedAt)),
    )
    .innerJoin(
      exchanges,
      and(eq(exchanges.id, answers.exchangeId), eq(exchanges.familyId, memoryCandidates.familyId)),
    )
    .innerJoin(
      members,
      and(
        eq(members.id, memoryCandidates.memberId),
        eq(members.id, answers.memberId),
        eq(members.familyId, memoryCandidates.familyId),
      ),
    )
    .innerJoin(
      consents,
      and(eq(consents.id, memoryCandidates.consentId), eq(consents.memberId, members.id)),
    )
    .where(
      and(
        eq(memoryCandidates.familyId, familyId),
        isNull(memoryCandidates.dismissedAt),
        gt(memoryCandidates.expiresAt, now),
        isNull(members.leftAt),
        inArray(members.status, ["active", "paused"]),
        eq(consents.kind, "rich_memories"),
        eq(consents.answer, "yes"),
        eq(consents.textVersion, RICH_MEMORY_CONSENT_VERSION),
        isNull(consents.withdrawnAt),
        isNull(consents.subjectDeletedAt),
        lte(consents.givenAt, answers.receivedAt),
        lte(consents.givenAt, now),
        noLaterConsent(deps.db),
        exists(
          deps.db
            .select({ id: viewer.id })
            .from(viewer)
            .innerJoin(users, eq(users.id, viewer.userId))
            .where(
              and(
                eq(viewer.id, access.access.memberId),
                eq(viewer.familyId, memoryCandidates.familyId),
                eq(users.id, access.access.userId),
                isNull(users.deletedAt),
                isNull(viewer.leftAt),
                inArray(viewer.status, ["active", "paused"]),
              ),
            ),
        ),
        cursor === null ? undefined : gt(memoryCandidates.id, cursor),
      ),
    )
    .orderBy(asc(memoryCandidates.id))
    .limit(PAGE_SIZE + 1);
  const scanned = rows.slice(0, PAGE_SIZE);
  const items: ApiMemoryCandidate[] = [];
  for (const { candidate, answer } of scanned) {
    const words = sourceWords(answer);
    if (
      words === null ||
      answer.flag ||
      (Array.isArray(answer.mentions.health) && answer.mentions.health.length > 0) ||
      (await sourceDigest(answer)) !== candidate.sourceDigest
    )
      continue;
    const quote = words.text.slice(candidate.start, candidate.end);
    if (!quote.trim()) continue;
    items.push({
      id: candidate.id,
      member_id: candidate.memberId,
      source_answer_id: answer.id,
      kind: candidate.kind,
      quote,
      lang: words.lang,
      occurred_at: answer.receivedAt.toISOString(),
      expires_at: candidate.expiresAt.toISOString(),
    });
  }
  return {
    items,
    next_cursor: rows.length > PAGE_SIZE ? (scanned.at(-1)?.candidate.id ?? null) : null,
  };
}

async function authorizeDismiss(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  id: string,
) {
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted") throw new VelaError("not_found", "Memory not found");
  const [candidate] = await db
    .select({ memberId: memoryCandidates.memberId })
    .from(memoryCandidates)
    .where(and(eq(memoryCandidates.id, id), eq(memoryCandidates.familyId, familyId)));
  if (candidate?.memberId !== access.access.memberId)
    throw new VelaError("not_found", "Memory not found");
}

/** Only the author dismisses their selection; replay rechecks ownership and returns no words. */
export async function dismissMemoryCandidate(
  deps: MemoryDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  id: string,
) {
  // Privacy removal remains available when discovery/read is disabled; ownership is always checked.
  if (!uuid.safeParse(id).success || !uuid.safeParse(familyId).success)
    throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "memory.dismiss:v1",
      familyId,
      input: { id },
    },
    {
      authorize: (tx) => authorizeDismiss(tx, identity, familyId, id),
      mutate: async (tx) => {
        await tx
          .update(memoryCandidates)
          .set({ dismissedAt: deps.clock.now() })
          .where(
            and(
              eq(memoryCandidates.id, id),
              eq(memoryCandidates.familyId, familyId),
              isNull(memoryCandidates.dismissedAt),
            ),
          );
        return { status: 200, body: { dismissed: true } };
      },
    },
  );
}

/** Retention removes candidates and dedup tombstones together, with their source lifetime. */
export async function deleteExpiredMemoryCandidates(db: Queryable, now: Date): Promise<number> {
  return (
    await db
      .delete(memoryCandidates)
      .where(or(lt(memoryCandidates.expiresAt, now), eq(memoryCandidates.expiresAt, now)))
      .returning({ id: memoryCandidates.id })
  ).length;
}
