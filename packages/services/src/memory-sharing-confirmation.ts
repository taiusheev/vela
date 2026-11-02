/** Read-only confirmation building block. No runtime caller, grant writer, route or AI call.
 * Inputs MUST come from authenticated, locked server state, never a request's snapshot.
 * A fingerprint is not a signature, consent record or permission to read a memory.
 */
import {
  MEMORY_KEEP_VERSION,
  MEMORY_SHARE_EXPLANATION_EN,
  MEMORY_SHARE_VERSION,
  MemoryShareChoice,
  MemorySharePreview,
} from "@vela/contracts";
import { z } from "zod";
import { sha256Hex } from "./hash.ts";
import { RICH_MEMORY_CONSENT_VERSION } from "./rich-memories.ts";

const uuid = z.uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
// Stay within four-digit ISO years accepted by transport validation.
const timestamp = z.number().int().nonnegative().max(253_402_300_799_999);
export const MEMORY_SHARE_PRESENTATION_MS = 5 * 60_000;

const Binding = z.strictObject({
  familyId: uuid,
  memberId: uuid,
  userId: uuid,
  /** Persisted membership generation; departure/rejoin or account rebind must change it. */
  membershipRevision: uuid,
});
const Recipient = Binding.extend({
  displayName: z.string().trim().min(1).max(120),
  eligible: z.literal(true),
});
const Snapshot = z.strictObject({
  owner: Binding,
  memoryId: uuid,
  quote: z.string().min(1).max(2000),
  lang: z.string().min(1).max(35),
  /** Revision must change on removal/recreation or revocation, even if words are unchanged. */
  sharingRevision: uuid,
  sourceDigest: digest,
  purposeConsentId: uuid,
  purposeVersion: z.literal(RICH_MEMORY_CONSENT_VERSION),
  keepConsentId: uuid,
  keepVersion: z.literal(MEMORY_KEEP_VERSION),
  /** Current source, screening, purpose, keep and owner checks, derived by server only. */
  eligible: z.literal(true),
  recipients: z.array(Recipient).min(1).max(50),
});
export type MemorySharingSnapshot = z.infer<typeof Snapshot>;
export type MemorySharingActor = z.infer<typeof Binding>;

/** Only this content-free record may be persisted; never persist the preview's quote/names.
 * Future writer must lock it, compare it with live state, consume once and grant atomically.
 */
const PresentationRecord = z.strictObject({
  id: uuid,
  owner: Binding,
  memoryId: uuid,
  fingerprint: digest,
  issuedAt: timestamp,
  expiresAt: timestamp,
  consumedAt: timestamp.nullable(),
});
export type MemorySharingPresentationRecord = z.infer<typeof PresentationRecord>;

function sameBinding(a: MemorySharingActor, b: MemorySharingActor) {
  return (
    a.familyId === b.familyId &&
    a.memberId === b.memberId &&
    a.userId === b.userId &&
    a.membershipRevision === b.membershipRevision
  );
}

/** Return null for all stale/unauthorized/ambiguous states; never echo a failed input. */
export async function buildMemorySharingConfirmation(
  actorInput: unknown,
  snapshotInput: unknown,
  presentationId: string,
  issuedAt: number,
) {
  const actor = Binding.safeParse(actorInput);
  const parsed = Snapshot.safeParse(snapshotInput);
  if (
    !actor.success ||
    !parsed.success ||
    !uuid.safeParse(presentationId).success ||
    !timestamp.safeParse(issuedAt).success ||
    !timestamp.safeParse(issuedAt + MEMORY_SHARE_PRESENTATION_MS).success
  )
    return null;
  const snapshot = parsed.data;
  if (!sameBinding(actor.data, snapshot.owner)) return null;
  const recipients = [...snapshot.recipients].sort((a, b) => a.memberId.localeCompare(b.memberId));
  const memberIds = new Set<string>();
  const userIds = new Set<string>();
  const names = new Set<string>();
  for (const recipient of recipients) {
    const name = recipient.displayName.normalize("NFKC").toLocaleLowerCase("en-US");
    if (
      recipient.familyId !== snapshot.owner.familyId ||
      recipient.memberId === snapshot.owner.memberId ||
      recipient.userId === snapshot.owner.userId ||
      memberIds.has(recipient.memberId) ||
      userIds.has(recipient.userId) ||
      names.has(name)
    )
      return null;
    memberIds.add(recipient.memberId);
    userIds.add(recipient.userId);
    names.add(name);
  }
  const expiresAt = issuedAt + MEMORY_SHARE_PRESENTATION_MS;
  const fingerprint = await sha256Hex(
    JSON.stringify({
      version: MEMORY_SHARE_VERSION,
      explanation: MEMORY_SHARE_EXPLANATION_EN,
      presentationId,
      issuedAt,
      expiresAt,
      ...snapshot,
      recipients,
    }),
  );
  return {
    preview: MemorySharePreview.parse({
      presentation_id: presentationId,
      memory_id: snapshot.memoryId,
      quote: snapshot.quote,
      lang: snapshot.lang,
      recipients: recipients.map((recipient) => ({
        member_id: recipient.memberId,
        display_name: recipient.displayName,
      })),
      confirmation_version: MEMORY_SHARE_VERSION,
      explanation: MEMORY_SHARE_EXPLANATION_EN,
      presentation_sha256: fingerprint,
      expires_at: new Date(expiresAt).toISOString(),
    }),
    record: PresentationRecord.parse({
      id: presentationId,
      owner: snapshot.owner,
      memoryId: snapshot.memoryId,
      fingerprint,
      issuedAt,
      expiresAt,
      consumedAt: null,
    }),
  };
}

/** Necessary validation only: true does NOT grant access or consume a presentation.
 * The eventual writer must use runApiMutation, row locks, a single-use record and fresh live
 * membership/consent/source checks in the SAME transaction as persisting per-recipient grants.
 */
export async function matchesMemorySharingConfirmation(
  actor: unknown,
  currentSnapshot: unknown,
  recordInput: unknown,
  choiceInput: unknown,
  now: number,
): Promise<boolean> {
  const record = PresentationRecord.safeParse(recordInput);
  const choice = MemoryShareChoice.safeParse(choiceInput);
  if (!record.success || !choice.success || !timestamp.safeParse(now).success) return false;
  const stored = record.data;
  if (
    stored.consumedAt !== null ||
    stored.issuedAt > now ||
    stored.expiresAt <= now ||
    stored.expiresAt !== stored.issuedAt + MEMORY_SHARE_PRESENTATION_MS ||
    stored.id !== choice.data.presentation_id ||
    stored.fingerprint !== choice.data.presentation_sha256
  )
    return false;
  const current = await buildMemorySharingConfirmation(
    actor,
    currentSnapshot,
    stored.id,
    stored.issuedAt,
  );
  return (
    current !== null &&
    sameBinding(current.record.owner, stored.owner) &&
    current.record.memoryId === stored.memoryId &&
    current.record.fingerprint === stored.fingerprint
  );
}
