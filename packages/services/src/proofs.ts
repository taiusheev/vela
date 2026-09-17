/**
 * Consent and deletion proofs (flows §3.2, §3.15; ADR-28), one implementation every flow shares.
 *
 * A consent row outlives the member or contact it is about without holding their data: it names its
 * subject by id (`subject_ref`), and before any deletion of that subject its evidence is cut to the
 * proof keys, which hold ids and a hash and nothing the person said or is called. The database
 * refuses a deletion that skipped the step (`consents_subject_deleted_check`), so every path that
 * deletes a member or a nearby contact calls `forgetConsentSubjects` first, in its own transaction.
 *
 * A deletion proof hashes the object's type and id, never a value the row held: a phone number or a
 * storage key has so few possible values that its hash gives it back (L4).
 */
import type { Lang } from "@vela/contracts";
import { type MessageKey, t } from "@vela/copy";
import { CONSENT_PROOF_KEYS, consents, deletions, members, nearbyContacts } from "@vela/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { sha256Hex } from "./hash.ts";
import type { Queryable } from "./repo.ts";

export type ConsentSubject = { memberId: string } | { contactId: string };

/** `member:<id>` or `contact:<id>`: every consent insert's `subject_ref`, never changed after. */
export function subjectRef(subject: ConsentSubject): string {
  return "memberId" in subject ? `member:${subject.memberId}` : `contact:${subject.contactId}`;
}

/**
 * What a tap on a consent button proves (L6). The text version and `params` rebuild the message;
 * `text_sha256` shows the rebuild is the message she saw, and the chat and message ids say where
 * she saw it. A type alias rather than an interface, so it is a JSON object the column accepts.
 */
export type ChatConsentEvidence = {
  chat_id: string;
  message_id?: string;
  params: Record<string, string>;
  text_sha256: string;
};

export interface ChatConsentEvidenceInput {
  /** The conversation the buttons are in. */
  chatId: string;
  /** The message that carries the buttons; left out when the event carries none. */
  messageId: string | undefined;
  lang: Lang;
  key: MessageKey;
  /** The values filled into the text, derived again at the tap from the sources the send used. */
  params: Record<string, string>;
}

export async function chatConsentEvidence(
  input: ChatConsentEvidenceInput,
): Promise<ChatConsentEvidence> {
  const text_sha256 = await sha256Hex(t(input.lang, input.key, input.params));
  return input.messageId === undefined
    ? { chat_id: input.chatId, params: input.params, text_sha256 }
    : { chat_id: input.chatId, message_id: input.messageId, params: input.params, text_sha256 };
}

/**
 * What an adult's tap on "I've read it" under `group.linked` proves (L9): where they tapped, and the
 * hash of the text the group received, kept on the group's `family_channels` row when it was posted.
 * Nothing is rebuilt at the tap, so a later change in the family cannot make the hash name a message
 * nobody saw. No `params`: the text names her, and this row is another adult's, where her name would
 * outlive her No or her deletion.
 */
export type GroupNoticeEvidence = {
  chat_id: string;
  message_id?: string;
  text_sha256: string;
};

export function groupNoticeEvidence(
  chatId: string,
  messageId: string | undefined,
  linkedTextSha256: string,
): GroupNoticeEvidence {
  return messageId === undefined
    ? { chat_id: chatId, text_sha256: linkedTextSha256 }
    : { chat_id: chatId, message_id: messageId, text_sha256: linkedTextSha256 };
}

export interface ConsentSubjects {
  memberIds?: readonly string[];
  contactIds?: readonly string[];
}

/**
 * Before a member or nearby contact is deleted, in the caller's transaction: the consent rows about
 * them keep only `CONSENT_PROOF_KEYS` of their evidence and record when the subject went. Rows
 * already forgotten are left as they are. Returns how many rows it forgot.
 */
export async function forgetConsentSubjects(
  tx: Queryable,
  subjects: ConsentSubjects,
  at: Date,
): Promise<number> {
  const refs = [
    ...(subjects.memberIds ?? []).map((memberId) => subjectRef({ memberId })),
    ...(subjects.contactIds ?? []).map((contactId) => subjectRef({ contactId })),
  ];
  if (refs.length === 0) {
    return 0;
  }
  const kept = sql.join(
    CONSENT_PROOF_KEYS.map((key) => sql`${key}`),
    sql`, `,
  );
  const rows = await tx
    .update(consents)
    .set({
      evidence: sql`(select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb) from jsonb_each(${consents.evidence}) entry where entry.key in (${kept}))`,
      subjectDeletedAt: at,
    })
    .where(and(inArray(consents.subjectRef, refs), isNull(consents.subjectDeletedAt)))
    .returning({ id: consents.id });
  return rows.length;
}

/**
 * `forgetConsentSubjects` for members about to be deleted and for the nearby contacts near them,
 * which the delete takes with them through their foreign key.
 */
export async function forgetMembersWithTheirContacts(
  tx: Queryable,
  memberIds: readonly string[],
  at: Date,
): Promise<number> {
  if (memberIds.length === 0) {
    return 0;
  }
  const contacts = await tx
    .select({ id: nearbyContacts.id })
    .from(nearbyContacts)
    .where(inArray(nearbyContacts.memberId, [...memberIds]));
  return forgetConsentSubjects(
    tx,
    { memberIds, contactIds: contacts.map((contact) => contact.id) },
    at,
  );
}

/** `forgetConsentSubjects` for every member and nearby contact of a family about to be deleted. */
export async function forgetFamilySubjects(
  tx: Queryable,
  familyId: string,
  at: Date,
): Promise<number> {
  const people = await tx
    .select({ id: members.id })
    .from(members)
    .where(eq(members.familyId, familyId));
  const contacts = await tx
    .select({ id: nearbyContacts.id })
    .from(nearbyContacts)
    .where(eq(nearbyContacts.familyId, familyId));
  return forgetConsentSubjects(
    tx,
    {
      memberIds: people.map((member) => member.id),
      contactIds: contacts.map((contact) => contact.id),
    },
    at,
  );
}

/** The only value `deletions.content_hash` holds: the SHA-256 of `<object type>:<object id>`. */
export function deletionHash(objectType: string, objectId: string): Promise<string> {
  return sha256Hex(`${objectType}:${objectId}`);
}

export interface DeletionRecord {
  objectType: string;
  objectId: string;
  reason: string;
  at: Date;
}

/** The proof that a row was deleted, in the caller's transaction. */
export async function recordDeletion(tx: Queryable, row: DeletionRecord): Promise<void> {
  await tx.insert(deletions).values({
    objectType: row.objectType,
    objectId: row.objectId,
    contentHash: await deletionHash(row.objectType, row.objectId),
    reason: row.reason,
    deletedAt: row.at,
  });
}
