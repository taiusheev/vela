import {
  AddNearby,
  type ApiMutationResponse,
  type ApiNearbyContact,
  type NearbyRefusal,
} from "@vela/contracts";
import { deletions, members, type NearbyContact, nearbyContacts } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { MAX_NEARBY_CONTACTS } from "./admin.ts";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { holdsPhoneNumber } from "./onboarding.ts";
import { forgetConsentSubjects, recordDeletion } from "./proofs.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class NearbyRefusedError extends Error {
  override readonly name = "NearbyRefusedError";
  readonly reason: NearbyRefusal;

  constructor(reason: NearbyRefusal) {
    super(`Nearby contact refused: ${reason}`);
    this.reason = reason;
  }
}

function notFound(): VelaError {
  return new VelaError("not_found", "Not found");
}

function contactOf(contact: NearbyContact): ApiNearbyContact {
  return {
    id: contact.id,
    near_member_id: contact.memberId,
    name: contact.name,
    relation: contact.relation,
    consent: contact.declinedAt !== null ? "no" : contact.consentedAt === null ? "waiting" : "yes",
  };
}

/**
 * "Someone nearby" from the app (`POST /v1/families/:familyId/nearby`, API contract § "People
 * nearby", spec A3): a person near her by name and relation, as Telegram onboarding stores them,
 * with no number and no yes. Nobody is contacted: the founder asks them and records their yes and
 * number on the admin page (L8, spec Appendix A), and "Ask them to look in" waits for it.
 *
 * Organisers only, for a kept-light member who has not left, invited or not. A name or relation
 * holding a phone number is refused before anything is written or kept in a receipt (`number`), as
 * onboarding refuses it. Her member row is locked first, so two organisers adding at once count
 * each other: a third person is refused (`full`), and a name already near her answers that
 * contact, whatever its yes, rather than a second row.
 */
export async function addApiNearby(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = AddNearby.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  const { name, relation } = parsed.data;
  if (holdsPhoneNumber(name) || (relation !== null && holdsPhoneNumber(relation))) {
    throw new NearbyRefusedError("number");
  }
  if (!UUID.test(familyId)) throw notFound();
  const family = familyId.toLowerCase();
  const herId = parsed.data.member_id.toLowerCase();
  const now = deps.clock.now();

  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "nearby.add:v1",
      input: { member_id: herId, name, relation },
      familyId: family,
      memberId: herId,
    },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
        if (access.kind !== "granted") throw notFound();
        const [inFamily] = await tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.id, herId), eq(members.familyId, family)))
          .limit(1);
        if (inFamily === undefined) throw notFound();
      },
      mutate: async (tx) => {
        const [her] = await tx
          .select()
          .from(members)
          .where(and(eq(members.id, herId), eq(members.familyId, family)))
          .for("update");
        if (
          her === undefined ||
          her.role !== "member" ||
          her.leftAt !== null ||
          (her.status !== "invited" && her.status !== "active" && her.status !== "paused")
        ) {
          throw notFound();
        }
        const near = await tx
          .select()
          .from(nearbyContacts)
          .where(eq(nearbyContacts.memberId, her.id))
          .orderBy(nearbyContacts.createdAt, nearbyContacts.id);
        const same = near.find(
          (contact) => contact.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (same !== undefined) return { status: 200, body: contactOf(same) };
        if (near.length >= MAX_NEARBY_CONTACTS) throw new NearbyRefusedError("full");

        const [created] = await tx
          .insert(nearbyContacts)
          .values({ familyId: family, memberId: her.id, name, relation, createdAt: now })
          .returning();
        if (created === undefined) throw new Error("nearby contact not written");
        await recordEvent(
          tx,
          {
            name: "nearby_contact_added",
            familyId: family,
            memberId: her.id,
            surface: "app",
            props: { consented: false, source: "app" },
          },
          now,
        );
        return { status: 201, body: contactOf(created) };
      },
    },
  );
}

/**
 * Removing someone nearby from the app (`POST /v1/nearby/:contactId/remove`): as the admin page
 * removes one, their consent rows are forgotten, the row is deleted, and a deletion proof is kept.
 * Organisers of her family only. A retry after a lost answer sends the same key and replays it; a
 * remove that reaches the row after another removed it, which its proof shows, answers removed; a
 * new key for a contact already gone is 404, since nothing is left to say whose family it was.
 */
export async function removeApiNearby(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  contactId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!UUID.test(contactId)) throw notFound();
  const id = contactId.toLowerCase();
  const now = deps.clock.now();
  const [found] = await deps.db
    .select({ familyId: nearbyContacts.familyId, memberId: nearbyContacts.memberId })
    .from(nearbyContacts)
    .where(eq(nearbyContacts.id, id))
    .limit(1);

  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "nearby.remove:v1",
      input: { contact_id: id },
      ...(found === undefined ? {} : { familyId: found.familyId, memberId: found.memberId }),
    },
    {
      authorize: async (tx) => {
        if (found === undefined) throw notFound();
        const access = await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
        if (access.kind !== "granted") throw notFound();
      },
      mutate: async (tx) => {
        const [contact] = await tx
          .select()
          .from(nearbyContacts)
          .where(eq(nearbyContacts.id, id))
          .for("update");
        if (contact === undefined) {
          const [gone] = await tx
            .select({ id: deletions.id })
            .from(deletions)
            .where(and(eq(deletions.objectType, "nearby_contact"), eq(deletions.objectId, id)))
            .limit(1);
          if (gone === undefined) throw notFound();
          return { status: 200, body: { id, removed: true } };
        }
        await forgetConsentSubjects(tx, { contactIds: [contact.id] }, now);
        await tx.delete(nearbyContacts).where(eq(nearbyContacts.id, contact.id));
        await recordDeletion(tx, {
          objectType: "nearby_contact",
          objectId: contact.id,
          reason: "app remove_nearby",
          at: now,
        });
        await recordEvent(
          tx,
          {
            name: "nearby_contact_removed",
            familyId: contact.familyId,
            memberId: contact.memberId,
            surface: "app",
            props: { contact_id: contact.id, by: "organiser" },
          },
          now,
        );
        return { status: 200, body: { id, removed: true } };
      },
    },
  );
}
