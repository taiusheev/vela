/** Disabled internal sharing workflow. No Worker/app/messenger imports this module.
 * Receipts and permission rows contain IDs/fingerprints only; never quote/name copies.
 */
import {
  MEMORY_KEEP_VERSION,
  MEMORY_SHARE_VERSION,
  MemoryShareChoice,
  MemorySharingView,
} from "@vela/contracts";
import {
  answers,
  exchanges,
  families,
  members,
  memoryKeeps,
  memoryShares,
  memorySharingPresentations,
  users,
  type VelaTransaction,
} from "@vela/db";
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { loadOwnKeptMemory } from "./memory-keeps.ts";
import {
  buildMemorySharingConfirmation,
  type MemorySharingPresentationRecord,
  type MemorySharingSnapshot,
  matchesMemorySharingConfirmation,
} from "./memory-sharing-confirmation.ts";
import { RICH_MEMORY_CONSENT_VERSION } from "./rich-memories.ts";

type SharingDeps = Pick<Deps, "db" | "clock" | "config">;
const uuid = z.uuid();
const Selection = z.strictObject({
  memory_id: uuid,
  recipient_ids: z
    .array(uuid)
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
});
const absent = () => new VelaError("not_found", "Memory not found");
const unavailable = () =>
  new VelaError("illegal_state", "Sharing confirmation is no longer available");
const eligibleStatus = ["active", "paused"] as const;

/** Internal owner state, not an HTTP endpoint or permission to share. No payment/config gate.
 * Read one coherent snapshot: never combine a previous quote/revision with a newer audience.
 * Return the complete bounded audience or nothing; a partial list must never replace permissions.
 * Prepare/confirm still revalidate live state under locks. No snapshot may authorize a later write.
 */
export async function loadMemorySharingView(
  deps: SharingDeps,
  identity: SessionIdentity,
  familyId: string,
  memoryId: string,
): Promise<MemorySharingView | null> {
  if (!uuid.safeParse(familyId).success || !uuid.safeParse(memoryId).success) return null;
  return deps.db.transaction(
    async (tx) => {
      const access = await authorizeFamilyAccess(tx, identity, familyId);
      if (access.kind !== "granted") return null;
      const kept = await loadOwnKeptMemory({ ...deps, db: tx }, identity, familyId, memoryId);
      if (!kept) return null;
      const [revision] = await tx
        .select({ value: memoryKeeps.sharingRevision })
        .from(memoryKeeps)
        .where(eq(memoryKeeps.id, kept.id));
      if (!revision) return null;
      const rows = await tx
        .select({
          id: members.id,
          userId: users.id,
          name: members.displayName,
          shareId: memoryShares.id,
        })
        .from(members)
        .innerJoin(
          users,
          and(
            eq(users.id, members.userId),
            isNull(users.deletedAt),
            isNotNull(users.authSubject),
            sql`btrim(${users.authSubject}) <> ''`,
          ),
        )
        .leftJoin(
          memoryShares,
          and(
            eq(memoryShares.keepId, kept.id),
            eq(memoryShares.recipientMemberId, members.id),
            eq(memoryShares.recipientUserId, users.id),
            eq(memoryShares.recipientMembershipRevision, members.memoryMembershipRevision),
            eq(memoryShares.sharingRevision, revision.value),
            eq(memoryShares.confirmationVersion, MEMORY_SHARE_VERSION),
            lte(memoryShares.grantedAt, deps.clock.now()),
          ),
        )
        .where(
          and(
            eq(members.familyId, familyId),
            ne(members.id, kept.member_id),
            ne(users.id, access.access.userId),
            isNull(members.leftAt),
            inArray(members.status, eligibleStatus),
          ),
        )
        .orderBy(asc(members.id))
        .limit(51);
      if (rows.length > 50 || new Set(rows.map((row) => row.userId)).size !== rows.length)
        return null;
      const parsed = MemorySharingView.safeParse({
        memory_id: kept.id,
        author_id: kept.member_id,
        quote: kept.quote,
        revision: revision.value,
        audience_complete: true,
        recipients: rows.map((row) => ({
          member_id: row.id,
          display_name: row.name,
          shared: row.shareId !== null,
        })),
      });
      if (!parsed.success) return null;
      const names = parsed.data.recipients.map((row) =>
        row.display_name.normalize("NFKC").toLocaleLowerCase("en-US"),
      );
      if (new Set(names).size !== names.length) return null;
      return parsed.data;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Serialize the bounded sharing workflow per family. Lock order: sorted users -> family -> sorted
 * members -> exchange -> answer -> keep -> presentation. Lock accounts before membership rows,
 * matching account deletion; never move an account's membership lock into its binding trigger.
 * No network or model work inside this transaction.
 */
async function lockOwnerMemory(
  deps: SharingDeps,
  tx: VelaTransaction,
  identity: SessionIdentity,
  familyId: string,
  memoryId: string,
  recipientIds: string[] = [],
) {
  const initial = await authorizeFamilyAccess(tx, identity, familyId);
  if (initial.kind !== "granted") throw absent();
  const bindings = await tx
    .select({ userId: members.userId })
    .from(members)
    .where(
      and(
        eq(members.familyId, familyId),
        inArray(members.id, [initial.access.memberId, ...recipientIds]),
      ),
    );
  const userIds = [
    ...new Set(bindings.flatMap((member) => (member.userId === null ? [] : [member.userId]))),
  ];
  const accounts = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, userIds), isNull(users.deletedAt)))
    .orderBy(asc(users.id))
    .for("share");
  const lockedUserIds = new Set(accounts.map((account) => account.id));
  const [family] = await tx
    .select({ id: families.id })
    .from(families)
    .where(and(eq(families.id, familyId), isNull(families.deletedAt)))
    .for("update");
  const access = await authorizeFamilyAccess(tx, identity, familyId);
  if (!family || access.kind !== "granted") throw absent();
  const lockedMembers = await tx
    .select()
    .from(members)
    .where(
      and(
        inArray(members.id, [access.access.memberId, ...recipientIds]),
        eq(members.familyId, familyId),
        isNull(members.leftAt),
        inArray(members.status, eligibleStatus),
      ),
    )
    .orderBy(asc(members.id))
    .for("share");
  const owner = lockedMembers.find(
    (member) => member.id === access.access.memberId && member.userId === access.access.userId,
  );
  const [location] = await tx
    .select()
    .from(memoryKeeps)
    .where(
      and(
        eq(memoryKeeps.id, memoryId),
        eq(memoryKeeps.familyId, familyId),
        eq(memoryKeeps.memberId, access.access.memberId),
        isNull(memoryKeeps.removedAt),
      ),
    );
  if (!owner || !location || owner.userId === null || !lockedUserIds.has(owner.userId))
    throw absent();
  const [answerLocation] = await tx
    .select({ exchangeId: answers.exchangeId })
    .from(answers)
    .where(eq(answers.id, location.sourceAnswerId));
  if (!answerLocation) throw unavailable();
  await tx
    .select({ id: exchanges.id })
    .from(exchanges)
    .where(and(eq(exchanges.id, answerLocation.exchangeId), eq(exchanges.familyId, familyId)))
    .for("share");
  await tx
    .select({ id: answers.id })
    .from(answers)
    .where(eq(answers.id, location.sourceAnswerId))
    .for("no key update");
  const [kept] = await tx
    .select()
    .from(memoryKeeps)
    .where(eq(memoryKeeps.id, memoryId))
    .for("update");
  if (!kept || kept.removedAt !== null) throw unavailable();
  const valid = await loadOwnKeptMemory({ ...deps, db: tx }, identity, familyId, memoryId);
  if (!valid) throw unavailable();
  return {
    kept,
    owner,
    lockedUserIds,
    actor: {
      familyId,
      memberId: owner.id,
      userId: owner.userId,
      membershipRevision: owner.memoryMembershipRevision,
    },
  };
}
type Locked = Awaited<ReturnType<typeof lockOwnerMemory>>;

async function snapshotFor(
  tx: VelaTransaction,
  locked: Locked,
  recipientIds: string[],
): Promise<MemorySharingSnapshot> {
  const rows = await tx
    .select()
    .from(members)
    .where(
      and(
        inArray(members.id, recipientIds),
        eq(members.familyId, locked.kept.familyId),
        isNull(members.leftAt),
        inArray(members.status, eligibleStatus),
      ),
    )
    .orderBy(asc(members.id))
    .for("share");
  if (rows.length !== recipientIds.length) throw unavailable();
  const recipients: MemorySharingSnapshot["recipients"] = [];
  for (const member of rows) {
    if (member.userId === null || !locked.lockedUserIds.has(member.userId)) throw unavailable();
    const [account] = await tx
      .select({ id: users.id, subject: users.authSubject })
      .from(users)
      .where(and(eq(users.id, member.userId), isNull(users.deletedAt)));
    if (!account?.subject) throw unavailable();
    recipients.push({
      familyId: member.familyId,
      memberId: member.id,
      userId: account.id,
      membershipRevision: member.memoryMembershipRevision,
      displayName: member.displayName,
      eligible: true,
    });
  }
  const { kept } = locked;
  return {
    owner: locked.actor,
    memoryId: kept.id,
    quote: kept.quote,
    lang: kept.lang,
    sharingRevision: kept.sharingRevision,
    sourceDigest: kept.sourceDigest,
    purposeConsentId: kept.discoveryConsentId,
    purposeVersion: RICH_MEMORY_CONSENT_VERSION,
    keepConsentId: kept.keepConsentId,
    keepVersion: MEMORY_KEEP_VERSION,
    eligible: true,
    recipients,
  };
}

/** Create content-free pending evidence. The preview is loaded separately, never receipt-cached. */
export async function createMemorySharingPresentation(
  deps: SharingDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
) {
  const selection = Selection.safeParse(input);
  if (!selection.success || !uuid.safeParse(familyId).success)
    throw new ApiIdempotencyError("invalid");
  if (deps.config.richMemories !== true) throw absent();
  const choice = { ...selection.data, recipient_ids: [...selection.data.recipient_ids].sort() };
  let prepared: Awaited<ReturnType<typeof buildMemorySharingConfirmation>> = null;
  return runApiMutation(
    deps,
    identity,
    { key, operation: "memory.share.prepare:v1", familyId, input: choice },
    {
      authorize: async (tx) => {
        const locked = await lockOwnerMemory(
          deps,
          tx,
          identity,
          familyId,
          choice.memory_id,
          choice.recipient_ids,
        );
        const snapshot = await snapshotFor(tx, locked, choice.recipient_ids);
        prepared = await buildMemorySharingConfirmation(
          locked.actor,
          snapshot,
          crypto.randomUUID(),
          deps.clock.now().getTime(),
        );
        if (!prepared) throw unavailable();
      },
      mutate: async (tx) => {
        if (!prepared) throw unavailable();
        const record = prepared.record;
        await tx.insert(memorySharingPresentations).values({
          id: record.id,
          keepId: record.memoryId,
          ownerUserId: record.owner.userId,
          ownerMembershipRevision: record.owner.membershipRevision,
          recipientIds: choice.recipient_ids,
          fingerprint: record.fingerprint,
          issuedAt: new Date(record.issuedAt),
          expiresAt: new Date(record.expiresAt),
        });
        return { status: 200, body: { id: record.id } };
      },
    },
  );
}

async function lockPresentation(
  deps: SharingDeps,
  tx: VelaTransaction,
  identity: SessionIdentity,
  familyId: string,
  id: string,
) {
  const [location] = await tx
    .select({
      keepId: memorySharingPresentations.keepId,
      recipientIds: memorySharingPresentations.recipientIds,
    })
    .from(memorySharingPresentations)
    .where(eq(memorySharingPresentations.id, id));
  if (!location) throw unavailable();
  const locked = await lockOwnerMemory(
    deps,
    tx,
    identity,
    familyId,
    location.keepId,
    location.recipientIds,
  );
  const [row] = await tx
    .select()
    .from(memorySharingPresentations)
    .where(eq(memorySharingPresentations.id, id))
    .for("update");
  if (!row) throw unavailable();
  const snapshot = await snapshotFor(tx, locked, row.recipientIds);
  const record: MemorySharingPresentationRecord = {
    id: row.id,
    owner: {
      ...locked.actor,
      userId: row.ownerUserId,
      membershipRevision: row.ownerMembershipRevision,
    },
    memoryId: row.keepId,
    fingerprint: row.fingerprint,
    issuedAt: row.issuedAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    consumedAt: row.consumedAt?.getTime() ?? null,
  };
  return { locked, row, snapshot, record };
}

/** Read-only in-memory view; never stored in mutation receipts. No payment gate for this view. */
export async function loadMemorySharingPresentation(
  deps: SharingDeps,
  identity: SessionIdentity,
  familyId: string,
  id: string,
) {
  if (!uuid.safeParse(familyId).success || !uuid.safeParse(id).success) return null;
  try {
    return await deps.db.transaction(async (tx) => {
      const { locked, snapshot, record } = await lockPresentation(deps, tx, identity, familyId, id);
      const choice = {
        presentation_id: id,
        presentation_sha256: record.fingerprint,
        confirmation_version: MEMORY_SHARE_VERSION,
      };
      if (
        !(await matchesMemorySharingConfirmation(
          locked.actor,
          snapshot,
          record,
          choice,
          deps.clock.now().getTime(),
        ))
      )
        return null;
      return (
        (await buildMemorySharingConfirmation(locked.actor, snapshot, id, record.issuedAt))
          ?.preview ?? null
      );
    });
  } catch (error) {
    if (error instanceof VelaError) return null;
    throw error;
  }
}

export async function confirmMemorySharing(
  deps: SharingDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
) {
  const parsed = MemoryShareChoice.safeParse(input);
  if (!parsed.success || !uuid.safeParse(familyId).success)
    throw new ApiIdempotencyError("invalid");
  if (deps.config.richMemories !== true) throw absent();
  const choice = parsed.data;
  let current: Awaited<ReturnType<typeof lockPresentation>> | null = null;
  return runApiMutation(
    deps,
    identity,
    { key, operation: "memory.share.confirm:v1", familyId, input: choice },
    {
      authorize: async (tx) => {
        current = await lockPresentation(deps, tx, identity, familyId, choice.presentation_id);
        const { locked, snapshot, record } = current;
        if (
          !(await matchesMemorySharingConfirmation(
            locked.actor,
            snapshot,
            { ...record, consumedAt: null },
            choice,
            deps.clock.now().getTime(),
          ))
        )
          throw unavailable();
        if (record.consumedAt !== null) {
          // Only an unchanged, still-live result may be replayed. Revoked results cannot claim success.
          const grants = await tx
            .select()
            .from(memoryShares)
            .where(eq(memoryShares.keepId, locked.kept.id));
          if (
            grants.length !== snapshot.recipients.length ||
            snapshot.recipients.some(
              (recipient) =>
                !grants.some(
                  (grant) =>
                    grant.presentationId === record.id &&
                    grant.fingerprint === record.fingerprint &&
                    grant.recipientMemberId === recipient.memberId &&
                    grant.recipientUserId === recipient.userId &&
                    grant.recipientMembershipRevision === recipient.membershipRevision &&
                    grant.sharingRevision === locked.kept.sharingRevision,
                ),
            )
          )
            throw unavailable();
        }
      },
      mutate: async (tx) => {
        if (!current || current.row.consumedAt !== null) throw unavailable();
        const { locked, snapshot, record } = current;
        // The preview describes the COMPLETE audience, not an implicit union with old grants.
        await tx.delete(memoryShares).where(eq(memoryShares.keepId, locked.kept.id));
        await tx
          .delete(memorySharingPresentations)
          .where(
            and(
              eq(memorySharingPresentations.keepId, locked.kept.id),
              ne(memorySharingPresentations.id, record.id),
            ),
          );
        await tx
          .update(memorySharingPresentations)
          .set({ consumedAt: deps.clock.now() })
          .where(eq(memorySharingPresentations.id, record.id));
        await tx.insert(memoryShares).values(
          snapshot.recipients.map((recipient) => ({
            keepId: locked.kept.id,
            recipientMemberId: recipient.memberId,
            recipientUserId: recipient.userId,
            recipientMembershipRevision: recipient.membershipRevision,
            sharingRevision: locked.kept.sharingRevision,
            presentationId: record.id,
            confirmationVersion: MEMORY_SHARE_VERSION,
            fingerprint: record.fingerprint,
            grantedAt: deps.clock.now(),
          })),
        );
        return { status: 200, body: { shared: true, id: locked.kept.id } };
      },
    },
  );
}

/** Stop-sharing works with processing/payment off. Old choices/receipts cannot regrant. */
export async function stopSharingMemory(
  deps: SharingDeps,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memoryId: string,
) {
  if (!uuid.safeParse(familyId).success || !uuid.safeParse(memoryId).success)
    throw new ApiIdempotencyError("invalid");
  return runApiMutation(
    deps,
    identity,
    { key, operation: "memory.share.stop:v1", familyId, input: { memoryId } },
    {
      authorize: async (tx) => {
        await lockOwnerMemory(deps, tx, identity, familyId, memoryId);
      },
      mutate: async (tx) => {
        await tx
          .update(memoryKeeps)
          .set({ sharingRevision: sql`uuidv7()` })
          .where(eq(memoryKeeps.id, memoryId));
        return { status: 200, body: { stopped: true } };
      },
    },
  );
}
