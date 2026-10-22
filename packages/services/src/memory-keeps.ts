/** Internal, disabled keep transport. No route, messenger action or consent-acceptance UI calls it. */
import {
  type ApiKeptMemory,
  type KeptMemoryPage,
  MEMORY_KEEP_EXPLANATION_EN,
  MEMORY_KEEP_VERSION,
  MEMORY_SHARE_VERSION,
  MemoryKeepChoice,
  type SharedKeptMemoryPage,
} from "@vela/contracts";
import {
  answers,
  consents,
  exchanges,
  families,
  members,
  memoryCandidates,
  memoryKeeps,
  memoryShares,
  users,
} from "@vela/db";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
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
import { RICH_MEMORY_CONSENT_VERSION, sourceDigest, sourceWords } from "./rich-memories.ts";

type KeepDeps = Pick<Deps, "db" | "clock" | "config">;
type KeepReadDeps = Omit<KeepDeps, "db"> & { db: Queryable };
const uuid = z.uuid();
const lifetime = 30 * 86_400_000;
const absent = () => new VelaError("not_found", "Memory not found");
const unavailable = () => new VelaError("illegal_state", "Memory is no longer available");
const active = ["active", "paused"] as const;

/** Shared lock order for owner actions; withdrawal takes the member's exclusive lock. */
export async function lockMemoryOwner(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  memberId: string,
  memberLock: "share" | "update" = "share",
) {
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted" || access.access.memberId !== memberId) throw absent();
  const [family] = await db
    .select()
    .from(families)
    .where(and(eq(families.id, familyId), isNull(families.deletedAt)))
    .for("share");
  const [member] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.id, memberId),
        eq(members.familyId, familyId),
        isNull(members.leftAt),
        inArray(members.status, active),
      ),
    )
    .for(memberLock);
  if (!family || !member || member.userId !== access.access.userId) throw absent();
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, access.access.userId),
        eq(users.authSubject, identity.authSubject),
        isNull(users.deletedAt),
      ),
    )
    .for("share");
  if (!user) throw absent();
}

/** Exact selection + purpose consent + own confirmation, serialized with source/privacy changes.
 * Receipts contain IDs only, never a second quote copy. Every replay rechecks eligibility. */
export async function keepMemoryCandidate(
  deps: KeepDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
) {
  const parsed = MemoryKeepChoice.safeParse(input);
  if (!parsed.success || !uuid.safeParse(familyId).success)
    throw new ApiIdempotencyError("invalid");
  const choice = parsed.data;
  if (deps.config.richMemories !== true) throw absent();
  if (choice.confirmation_sha256 !== (await sha256Hex(MEMORY_KEEP_EXPLANATION_EN)))
    throw unavailable();
  let locked: {
    candidate: typeof memoryCandidates.$inferSelect;
    answer: typeof answers.$inferSelect;
    quote: string;
    lang: string;
  } | null = null;
  return runApiMutation(
    deps,
    identity,
    { key, operation: "memory.keep:v1", familyId, input: choice },
    {
      authorize: async (tx) => {
        const [location] = await tx
          .select({ candidate: memoryCandidates, exchangeId: answers.exchangeId })
          .from(memoryCandidates)
          .innerJoin(answers, eq(answers.id, memoryCandidates.sourceAnswerId))
          .where(
            and(
              eq(memoryCandidates.id, choice.candidate_id),
              eq(memoryCandidates.familyId, familyId),
            ),
          );
        if (!location) throw absent();
        await lockMemoryOwner(tx, identity, familyId, location.candidate.memberId);
        const [exchange] = await tx
          .select({ id: exchanges.id })
          .from(exchanges)
          .where(and(eq(exchanges.id, location.exchangeId), eq(exchanges.familyId, familyId)))
          .for("share");
        if (!exchange) throw unavailable();
        const [answer] = await tx
          .select()
          .from(answers)
          .where(eq(answers.id, location.candidate.sourceAnswerId))
          .for("no key update");
        const [candidate] = await tx
          .select()
          .from(memoryCandidates)
          .where(eq(memoryCandidates.id, location.candidate.id))
          .for("update");
        if (
          !answer ||
          !candidate ||
          candidate.dismissedAt !== null ||
          candidate.expiresAt <= deps.clock.now() ||
          answer.memberId !== candidate.memberId ||
          answer.exchangeId !== exchange.id ||
          answer.wordsExpiredAt !== null
        )
          throw unavailable();
        const [consent] = await tx
          .select()
          .from(consents)
          .where(and(eq(consents.memberId, candidate.memberId), eq(consents.kind, "rich_memories")))
          .orderBy(desc(consents.givenAt), desc(consents.id))
          .limit(1)
          .for("share");
        const words = sourceWords(answer);
        if (
          !exchange ||
          !words ||
          answer.flag ||
          (Array.isArray(answer.mentions.health) && answer.mentions.health.length > 0) ||
          (await sourceDigest(answer)) !== candidate.sourceDigest ||
          !consent ||
          consent.id !== candidate.consentId ||
          consent.answer !== "yes" ||
          consent.textVersion !== RICH_MEMORY_CONSENT_VERSION ||
          consent.withdrawnAt !== null ||
          consent.subjectDeletedAt !== null ||
          consent.givenAt > answer.receivedAt ||
          consent.givenAt > deps.clock.now()
        )
          throw unavailable();
        const quote = words.text.slice(candidate.start, candidate.end);
        if (!quote.trim() || !words.lang.trim() || words.lang.length > 35) throw unavailable();
        const [existing] = await tx
          .select()
          .from(memoryKeeps)
          .where(eq(memoryKeeps.candidateId, candidate.id));
        if (candidate.keptAt !== null && !existing) throw unavailable();
        if (existing) {
          const [grant] = await tx
            .select()
            .from(consents)
            .where(eq(consents.id, existing.keepConsentId))
            .for("share");
          if (
            existing.removedAt !== null ||
            !grant ||
            grant.kind !== "memory_keep" ||
            grant.answer !== "yes" ||
            grant.withdrawnAt !== null ||
            grant.subjectDeletedAt !== null ||
            grant.textVersion !== MEMORY_KEEP_VERSION
          )
            throw unavailable();
        }
        locked = { candidate, answer, quote, lang: words.lang };
      },
      mutate: async (tx) => {
        if (locked === null) throw unavailable();
        const { candidate, answer, quote, lang } = locked;
        const [existing] = await tx
          .select()
          .from(memoryKeeps)
          .where(eq(memoryKeeps.candidateId, candidate.id));
        if (existing) return { status: 200, body: { kept: true, id: existing.id } };
        const now = deps.clock.now();
        if (candidate.expiresAt <= now) throw unavailable();
        const [proof] = await tx
          .insert(consents)
          .values({
            memberId: candidate.memberId,
            subjectRef: `member:${candidate.memberId}`,
            kind: "memory_keep",
            answer: "yes",
            textVersion: MEMORY_KEEP_VERSION,
            lang: "en",
            channel: "app",
            givenAt: now,
            evidence: {
              params: { candidate_id: candidate.id },
              text_sha256: choice.confirmation_sha256,
            },
          })
          .returning();
        if (!proof) throw unavailable();
        const [kept] = await tx
          .insert(memoryKeeps)
          .values({
            familyId,
            memberId: candidate.memberId,
            candidateId: candidate.id,
            sourceAnswerId: answer.id,
            discoveryConsentId: candidate.consentId,
            keepConsentId: proof.id,
            kind: candidate.kind,
            start: candidate.start,
            end: candidate.end,
            sourceDigest: candidate.sourceDigest,
            quote,
            lang,
            occurredAt: answer.receivedAt,
            keptAt: now,
          })
          .returning();
        if (!kept) throw unavailable();
        await tx
          .update(memoryCandidates)
          .set({ keptAt: now })
          .where(eq(memoryCandidates.id, candidate.id));
        return { status: 200, body: { kept: true, id: kept.id } };
      },
    },
  );
}

const discovery = alias(consents, "kept_discovery_consent");
const grant = alias(consents, "kept_quote_grant");
const later = alias(consents, "kept_later_consent");
const viewer = alias(members, "kept_memory_viewer");
const ownerAccount = alias(users, "kept_memory_owner_account");

/** Author's private collection; recipient reads are separate. Never depends on payment. */
export async function loadKeptMemories(
  deps: KeepDeps,
  identity: SessionIdentity,
  familyId: string,
  cursor: string | null = null,
): Promise<KeptMemoryPage | null> {
  return readKeptMemoryPage(deps, identity, familyId, cursor, false);
}

/** Separate internal recipient collection, not a change to private/default reads or exports.
 * It reveals only selected words, not original answer IDs or conversation-access hints.
 * No runtime caller or HTTP route; reads revalidate every page without a payment gate.
 */
export async function loadSharedKeptMemories(
  deps: KeepDeps,
  identity: SessionIdentity,
  familyId: string,
  cursor: string | null = null,
): Promise<SharedKeptMemoryPage | null> {
  const page = await readKeptMemoryPage(
    deps,
    identity,
    familyId,
    cursor,
    false,
    undefined,
    "shared",
  );
  if (!page) return null;
  return {
    items: page.items.map(({ id, member_id, kind, quote, lang, occurred_at, kept_at }) => ({
      id,
      member_id,
      kind,
      quote,
      lang,
      occurred_at,
      kept_at,
    })),
    next_cursor: page.next_cursor,
  };
}

/**
 * One page of the authenticated author's own kept words for a free data copy.
 * Not a whole-account export or a download endpoint. No export artifact is stored.
 * Reauthorise every page; callers must not reuse cached pages after withdrawal.
 */
export async function loadOwnKeptMemoriesForExport(
  deps: KeepDeps,
  identity: SessionIdentity,
  familyId: string,
  cursor: string | null = null,
): Promise<KeptMemoryPage | null> {
  return readKeptMemoryPage(deps, identity, familyId, cursor, true);
}

/** Internal single-row source/consent validation for locked owner operations. No new reader audience. */
export async function loadOwnKeptMemory(
  deps: KeepReadDeps,
  identity: SessionIdentity,
  familyId: string,
  id: string,
): Promise<ApiKeptMemory | null> {
  if (!uuid.safeParse(id).success) return null;
  const page = await readKeptMemoryPage(deps, identity, familyId, null, true, id);
  return page?.items[0] ?? null;
}

async function readKeptMemoryPage(
  deps: KeepReadDeps,
  identity: SessionIdentity,
  familyId: string,
  cursor: string | null,
  ownOnly: boolean,
  onlyId?: string,
  audience: "private" | "shared" = "private",
): Promise<KeptMemoryPage | null> {
  if (cursor !== null && !uuid.safeParse(cursor).success) return null;
  const access = await authorizeFamilyAccess(deps.db, identity, familyId);
  if (access.kind !== "granted") return null;
  const now = deps.clock.now();
  const rows = await deps.db
    .select({ kept: memoryKeeps, answer: answers })
    .from(memoryKeeps)
    .innerJoin(answers, eq(answers.id, memoryKeeps.sourceAnswerId))
    .innerJoin(
      exchanges,
      and(eq(exchanges.id, answers.exchangeId), eq(exchanges.familyId, memoryKeeps.familyId)),
    )
    .innerJoin(families, and(eq(families.id, memoryKeeps.familyId), isNull(families.deletedAt)))
    .innerJoin(
      members,
      and(
        eq(members.id, memoryKeeps.memberId),
        eq(members.id, answers.memberId),
        eq(members.familyId, memoryKeeps.familyId),
      ),
    )
    .innerJoin(
      discovery,
      and(eq(discovery.id, memoryKeeps.discoveryConsentId), eq(discovery.memberId, members.id)),
    )
    .innerJoin(grant, and(eq(grant.id, memoryKeeps.keepConsentId), eq(grant.memberId, members.id)))
    .innerJoin(viewer, eq(viewer.id, access.access.memberId))
    .innerJoin(users, eq(users.id, viewer.userId))
    .innerJoin(ownerAccount, eq(ownerAccount.id, members.userId))
    .where(
      and(
        eq(memoryKeeps.familyId, familyId),
        onlyId === undefined ? undefined : eq(memoryKeeps.id, onlyId),
        // Select the audience BEFORE pagination. Private defaults and own copies never widen.
        audience === "private"
          ? eq(memoryKeeps.memberId, access.access.memberId)
          : and(
              ne(memoryKeeps.memberId, access.access.memberId),
              exists(
                deps.db
                  .select({ id: memoryShares.id })
                  .from(memoryShares)
                  .where(
                    and(
                      eq(memoryShares.keepId, memoryKeeps.id),
                      eq(memoryShares.recipientMemberId, viewer.id),
                      eq(memoryShares.recipientUserId, users.id),
                      eq(memoryShares.recipientMembershipRevision, viewer.memoryMembershipRevision),
                      eq(memoryShares.sharingRevision, memoryKeeps.sharingRevision),
                      eq(memoryShares.confirmationVersion, MEMORY_SHARE_VERSION),
                      lte(memoryShares.grantedAt, now),
                    ),
                  ),
              ),
            ),
        ownOnly ? eq(memoryKeeps.memberId, access.access.memberId) : undefined,
        isNull(memoryKeeps.removedAt),
        isNull(members.leftAt),
        inArray(members.status, active),
        isNull(ownerAccount.deletedAt),
        isNotNull(ownerAccount.authSubject),
        eq(viewer.familyId, familyId),
        eq(users.id, access.access.userId),
        eq(users.authSubject, identity.authSubject),
        isNull(users.deletedAt),
        isNull(viewer.leftAt),
        inArray(viewer.status, active),
        eq(discovery.kind, "rich_memories"),
        eq(discovery.answer, "yes"),
        eq(discovery.textVersion, RICH_MEMORY_CONSENT_VERSION),
        isNull(discovery.withdrawnAt),
        isNull(discovery.subjectDeletedAt),
        lte(discovery.givenAt, memoryKeeps.occurredAt),
        eq(grant.kind, "memory_keep"),
        eq(grant.answer, "yes"),
        eq(grant.textVersion, MEMORY_KEEP_VERSION),
        isNull(grant.withdrawnAt),
        isNull(grant.subjectDeletedAt),
        lte(grant.givenAt, now),
        notExists(
          deps.db
            .select({ id: later.id })
            .from(later)
            .where(
              and(
                eq(later.memberId, members.id),
                eq(later.kind, "rich_memories"),
                or(
                  gt(later.givenAt, discovery.givenAt),
                  and(eq(later.givenAt, discovery.givenAt), gt(later.id, discovery.id)),
                ),
              ),
            ),
        ),
        cursor === null ? undefined : gt(memoryKeeps.id, cursor),
      ),
    )
    .orderBy(asc(memoryKeeps.id))
    .limit(51);
  const scanned = rows.slice(0, 50);
  const items: ApiKeptMemory[] = [];
  for (const { kept, answer } of scanned) {
    const words = sourceWords(answer);
    if (answer.flag || (Array.isArray(answer.mentions.health) && answer.mentions.health.length > 0))
      continue;
    if (words !== null) {
      if (
        (await sourceDigest(answer)) !== kept.sourceDigest ||
        words.text.slice(kept.start, kept.end) !== kept.quote
      )
        continue;
    } else if (
      answer.wordsExpiredAt === null ||
      answer.wordsExpiredAt.getTime() < answer.receivedAt.getTime() + lifetime ||
      answer.wordsExpiredAt > now
    )
      continue;
    items.push({
      id: kept.id,
      member_id: kept.memberId,
      source_answer_id: kept.sourceAnswerId,
      kind: kept.kind,
      quote: kept.quote,
      lang: kept.lang,
      occurred_at: kept.occurredAt.toISOString(),
      kept_at: kept.keptAt.toISOString(),
      source_available: words !== null && answer.receivedAt.getTime() + lifetime > now.getTime(),
    });
  }
  return { items, next_cursor: rows.length > 50 ? (scanned.at(-1)?.kept.id ?? null) : null };
}

export async function removeKeptMemory(
  deps: KeepDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  id: string,
) {
  if (!uuid.safeParse(id).success || !uuid.safeParse(familyId).success)
    throw new ApiIdempotencyError("invalid");
  // An empty tombstone permits retries; ownership is always freshly checked.
  return runApiMutation(
    deps,
    identity,
    { key, operation: "memory.remove:v1", familyId, input: { id } },
    {
      authorize: async (tx) => {
        const [row] = await tx
          .select()
          .from(memoryKeeps)
          .where(and(eq(memoryKeeps.id, id), eq(memoryKeeps.familyId, familyId)));
        if (!row) throw absent();
        await lockMemoryOwner(tx, identity, familyId, row.memberId);
        await tx
          .select({ id: answers.id })
          .from(answers)
          .where(eq(answers.id, row.sourceAnswerId))
          .for("no key update");
      },
      mutate: async (tx) => {
        const [kept] = await tx
          .select()
          .from(memoryKeeps)
          .where(eq(memoryKeeps.id, id))
          .for("update");
        if (!kept) throw absent();
        if (kept.removedAt !== null) return { status: 200, body: { removed: true } };
        await tx
          .update(memoryKeeps)
          .set({ quote: "", sourceDigest: "", removedAt: deps.clock.now() })
          .where(eq(memoryKeeps.id, id));
        if (kept.candidateId !== null)
          await tx
            .update(memoryCandidates)
            .set({ dismissedAt: deps.clock.now() })
            .where(eq(memoryCandidates.id, kept.candidateId));
        await tx
          .update(consents)
          .set({ withdrawnAt: deps.clock.now() })
          .where(eq(consents.id, kept.keepConsentId));
        return { status: 200, body: { removed: true } };
      },
    },
  );
}
