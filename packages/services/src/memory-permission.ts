/**
 * The author's own answer to the memory-suggestion question (consent.rich_memories@2).
 * Off unless config.richMemories; no Worker runtime sets it yet. A yes is only recorded from a
 * fresh, one-use presentation of the exact text, for the same account and membership revision,
 * issued after any earlier withdrawal. Withdrawal stays in memory-consent.ts.
 */
import {
  MEMORY_PERMISSION_NOTICE_VERSION,
  MEMORY_PERMISSION_TEXT_EN,
  MEMORY_PERMISSION_VERSION,
  MemoryPermissionChoice,
  MemoryPermissionPrepare,
  type MemoryPermissionPreview,
  type MemoryPermissionState,
} from "@vela/contracts";
import { consents, members, memoryPermissionPresentations } from "@vela/db";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { sha256Hex } from "./hash.ts";
import { lockMemoryOwner } from "./memory-keeps.ts";
import type { Queryable } from "./repo.ts";

type PermissionDeps = Pick<Deps, "db" | "clock"> & { config: Pick<Deps["config"], "richMemories"> };
const uuid = z.uuid();
const LIFETIME_MS = 5 * 60_000;
const absent = () => new VelaError("not_found", "Memory permission not found");
const unavailable = () => new VelaError("illegal_state", "This question is no longer current");

async function currentMember(db: Queryable, identity: SessionIdentity, familyId: string) {
  const access = await authorizeFamilyAccess(db, identity, familyId);
  if (access.kind !== "granted") throw absent();
  return access.access;
}

async function latestConsent(db: Queryable, memberId: string) {
  const [row] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.memberId, memberId), eq(consents.kind, "rich_memories")))
    .orderBy(desc(consents.givenAt), desc(consents.id))
    .limit(1);
  return row;
}

function stateOf(row: typeof consents.$inferSelect | undefined): MemoryPermissionState {
  if (row === undefined) return { state: "none", outdated: false };
  if (row.answer === "no") return { state: "no", outdated: false };
  if (row.withdrawnAt !== null) return { state: "withdrawn", outdated: false };
  return { state: "yes", outdated: row.textVersion !== MEMORY_PERMISSION_VERSION };
}

/** The signed-in person's own state. Free and read-only; null when the feature is off. */
export async function loadMemoryPermission(
  deps: Pick<PermissionDeps, "config"> & { db: Queryable },
  identity: SessionIdentity,
  familyId: string,
): Promise<MemoryPermissionState | null> {
  if (deps.config.richMemories !== true) return null;
  try {
    const access = await currentMember(deps.db, identity, familyId);
    return stateOf(await latestConsent(deps.db, access.memberId));
  } catch (error) {
    if (error instanceof VelaError) return null;
    throw error;
  }
}

/** Issue a fresh presentation. The words are loaded separately and never stored in a receipt. */
export async function prepareMemoryPermission(
  deps: PermissionDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
) {
  const parsed = MemoryPermissionPrepare.safeParse(input);
  if (!parsed.success || !uuid.safeParse(familyId).success)
    throw new ApiIdempotencyError("invalid");
  if (deps.config.richMemories !== true) throw absent();
  let owner: { memberId: string; userId: string; revision: string } | null = null;
  return runApiMutation(
    deps,
    identity,
    { key, operation: "memory.permission.prepare:v1", familyId, input: parsed.data },
    {
      authorize: async (tx) => {
        const access = await currentMember(tx, identity, familyId);
        await lockMemoryOwner(tx, identity, familyId, access.memberId);
        const [member] = await tx
          .select({ revision: members.memoryMembershipRevision })
          .from(members)
          .where(eq(members.id, access.memberId));
        if (!member) throw absent();
        owner = { memberId: access.memberId, userId: access.userId, revision: member.revision };
      },
      mutate: async (tx) => {
        if (!owner) throw absent();
        const now = deps.clock.now();
        const id = crypto.randomUUID();
        await tx.insert(memoryPermissionPresentations).values({
          id,
          memberId: owner.memberId,
          userId: owner.userId,
          membershipRevision: owner.revision,
          textVersion: MEMORY_PERMISSION_VERSION,
          noticeVersion: MEMORY_PERMISSION_NOTICE_VERSION,
          lang: parsed.data.lang,
          textSha256: await sha256Hex(MEMORY_PERMISSION_TEXT_EN),
          issuedAt: now,
          expiresAt: new Date(now.getTime() + LIFETIME_MS),
        });
        return { status: 200, body: { id } };
      },
    },
  );
}

/**
 * Lock and check a presentation: same account and member, unchanged membership revision, current
 * text, not expired, and no withdrawal at or after it was issued (a late tap on a screen shown
 * before "turn off and clear" must not turn memories back on).
 */
async function lockLivePresentation(
  deps: PermissionDeps,
  tx: Queryable,
  identity: SessionIdentity,
  familyId: string,
  id: string,
) {
  const access = await currentMember(tx, identity, familyId);
  await lockMemoryOwner(tx, identity, familyId, access.memberId, "update");
  const [row] = await tx
    .select()
    .from(memoryPermissionPresentations)
    .where(
      and(
        eq(memoryPermissionPresentations.id, id),
        eq(memoryPermissionPresentations.memberId, access.memberId),
        eq(memoryPermissionPresentations.userId, access.userId),
      ),
    )
    .for("update");
  if (!row) throw unavailable();
  const [member] = await tx
    .select({ revision: members.memoryMembershipRevision })
    .from(members)
    .where(eq(members.id, access.memberId));
  const [laterWithdrawal] = await tx
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.memberId, access.memberId),
        eq(consents.kind, "rich_memories"),
        isNotNull(consents.withdrawnAt),
        gte(consents.withdrawnAt, row.issuedAt),
      ),
    )
    .limit(1);
  if (
    member?.revision !== row.membershipRevision ||
    laterWithdrawal !== undefined ||
    row.textVersion !== MEMORY_PERMISSION_VERSION ||
    row.noticeVersion !== MEMORY_PERMISSION_NOTICE_VERSION ||
    row.textSha256 !== (await sha256Hex(MEMORY_PERMISSION_TEXT_EN)) ||
    deps.clock.now().getTime() >= row.expiresAt.getTime()
  )
    throw unavailable();
  return { access, row };
}

/** The exact words to show. Null when the presentation is unknown, used, stale or expired. */
export async function loadMemoryPermissionPresentation(
  deps: PermissionDeps,
  identity: SessionIdentity,
  familyId: string,
  id: string,
): Promise<MemoryPermissionPreview | null> {
  if (deps.config.richMemories !== true) return null;
  if (!uuid.safeParse(familyId).success || !uuid.safeParse(id).success) return null;
  try {
    return await deps.db.transaction(async (tx) => {
      const { row } = await lockLivePresentation(deps, tx, identity, familyId, id);
      if (row.consumedAt !== null) return null;
      return {
        presentation_id: row.id,
        text_version: MEMORY_PERMISSION_VERSION,
        notice_version: MEMORY_PERMISSION_NOTICE_VERSION,
        lang: "en",
        text: MEMORY_PERMISSION_TEXT_EN,
        text_sha256: row.textSha256,
        expires_at: row.expiresAt.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof VelaError) return null;
    throw error;
  }
}

/** Record the author's own yes or no. Only later answers become eligible after a yes. */
export async function answerMemoryPermission(
  deps: PermissionDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
) {
  const parsed = MemoryPermissionChoice.safeParse(input);
  if (!parsed.success || !uuid.safeParse(familyId).success)
    throw new ApiIdempotencyError("invalid");
  if (deps.config.richMemories !== true) throw absent();
  const choice = parsed.data;
  let current: Awaited<ReturnType<typeof lockLivePresentation>> | null = null;
  return runApiMutation(
    deps,
    identity,
    { key, operation: "memory.permission.answer:v1", familyId, input: choice },
    {
      authorize: async (tx) => {
        current = await lockLivePresentation(deps, tx, identity, familyId, choice.presentation_id);
        if (choice.text_sha256 !== current.row.textSha256) throw unavailable();
        const latest = await latestConsent(tx, current.access.memberId);
        if (current.row.consumedAt !== null) {
          // Only a replay of the answer this presentation recorded, while it is still the latest.
          if (
            latest?.evidence.presentation_id !== current.row.id ||
            latest.answer !== choice.answer
          )
            throw unavailable();
          return;
        }
        // A current yes is changed only by "turn off and clear", never by a second answer.
        const now = stateOf(latest);
        if (now.state === "yes" && !now.outdated) throw unavailable();
      },
      mutate: async (tx) => {
        if (!current) throw unavailable();
        const { access, row } = current;
        const now = deps.clock.now();
        await tx
          .update(memoryPermissionPresentations)
          .set({ consumedAt: now })
          .where(eq(memoryPermissionPresentations.id, row.id));
        await tx.insert(consents).values({
          memberId: access.memberId,
          subjectRef: `member:${access.memberId}`,
          kind: "rich_memories",
          answer: choice.answer,
          textVersion: MEMORY_PERMISSION_VERSION,
          lang: row.lang,
          channel: "app",
          givenAt: now,
          evidence: {
            presentation_id: row.id,
            text_sha256: row.textSha256,
            notice_version: row.noticeVersion,
          },
        });
        return { status: 200, body: { answer: choice.answer } };
      },
    },
  );
}
