/**
 * A nearby contact's yes, asked for by Vela in the organiser's name (ADR-36; spec §9, §14.3 M6;
 * `plan/materials/pilot/nearby-contact-consent.en.md`, text B as `nearby-consent.v2`). An organiser
 * shares a link from the app; the contact opens it in Telegram and is asked, in that organiser's
 * name, whether they may be asked to look in on her on a quiet morning. A yes keeps their Telegram
 * account with the yes, and lists them; a no deletes them at once, keeping only the proof that they
 * were asked and said no. Sending stop removes them from every list. Nobody is ever written to
 * before they open the link themselves.
 */
import type { InboundEvent, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
import { encodeButton, outboundKey } from "@vela/core";
import {
  consents,
  type Member,
  members,
  type NearbyContact,
  nearbyContacts,
  outbound,
  type VelaTransaction,
} from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { deviceTokenHash } from "./api-device.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import {
  handOverOutbound,
  type InsertResult,
  insertOutbound,
  type OutboundRequest,
} from "./gateway.ts";
import { languageOfSender, sendOutsideGateway } from "./group.ts";
import {
  chatConsentEvidence,
  forgetConsentSubjects,
  recordDeletion,
  subjectRef,
} from "./proofs.ts";
import { activeOrganisersWithLinks, MESSENGER, type Queryable } from "./repo.ts";

/** The text a contact's tap answers: text B of the nearby-contact consent, on Telegram. */
export const NEARBY_TEXT_VERSION = "nearby-consent.v2";
/** A contact's link: `n` and 24 random bytes, apart from a member's invite of 43 characters. */
const NEARBY_START = /^n[A-Za-z0-9_-]{32}$/;
const NEARBY_TOKEN_BYTES = 24;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Organisers are told on Telegram, where the pilot reaches them. */
/** Organisers are reached on their own messenger (05-line-flows §5.11). */
const ORGANISER_CHANNEL = MESSENGER;
/** What a contact sends to be removed, in either language. */
const STOP = /^\/?(stop|停|停止)$/i;

export class NearbyInviteRefusedError extends Error {
  override readonly name = "NearbyInviteRefusedError";
  readonly reason: "already_listed";
  constructor(reason: "already_listed") {
    super(`Nearby invite refused: ${reason}`);
    this.reason = reason;
  }
}

/** Whether a Telegram start parameter is a nearby contact's link rather than her invite. */
export function isNearbyStart(param: string | undefined): boolean {
  return NEARBY_START.test(param?.trim() ?? "");
}

/**
 * The link an organiser shares with someone nearby (`POST /v1/nearby/:contactId/invite`). Like her
 * phone's set-up, its answer is a credential, so it is not kept in a receipt: a retry mints a new
 * link and voids the old one, under the contact's row lock. Organisers of her family only; a
 * contact already listed is 409 `already_listed`. The 14 days after which an unanswered contact is
 * deleted run from here.
 */
export async function inviteApiNearby(
  deps: Pick<Deps, "db" | "clock" | "random"> & {
    config: Pick<Deps["config"], "telegramBotUsername">;
  },
  identity: SessionIdentity,
  contactId: string,
): Promise<{ contact_id: string; link: string }> {
  if (!UUID.test(contactId)) throw new VelaError("not_found", "Not found");
  const id = contactId.toLowerCase();
  const token = `n${deps.random.token(NEARBY_TOKEN_BYTES)}`;
  const hash = await deviceTokenHash(token);
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const [contact] = await tx
      .select()
      .from(nearbyContacts)
      .where(eq(nearbyContacts.id, id))
      .for("update");
    if (contact === undefined) throw new VelaError("not_found", "Not found");
    const access = await authorizeFamilyAccess(tx, identity, contact.familyId, "organiser");
    if (access.kind !== "granted") throw new VelaError("not_found", "Not found");
    if (contact.consentedAt !== null && contact.declinedAt === null) {
      throw new NearbyInviteRefusedError("already_listed");
    }
    await tx
      .update(nearbyContacts)
      .set({ inviteTokenHash: hash, invitedBy: access.access.memberId, consentRequestedAt: now })
      .where(eq(nearbyContacts.id, contact.id));
  });
  return {
    contact_id: id,
    link: `https://t.me/${deps.config.telegramBotUsername}?start=${token}`,
  };
}

/** The suffix that ties the request a chat was sent to the link it opened, so a tap proves both. */
function requestSuffix(contactId: string, hash: string): string {
  return `nearby:${contactId}:${hash.slice(0, 16)}`;
}

async function nameOf(db: Queryable, memberId: string | null): Promise<string> {
  if (memberId === null) return "";
  const [row] = await db
    .select({ displayName: members.displayName })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  return row?.displayName ?? "";
}

async function herOf(db: Queryable, contact: NearbyContact): Promise<Member> {
  const [her] = await db.select().from(members).where(eq(members.id, contact.memberId)).limit(1);
  if (her === undefined) throw new Error("a nearby contact without her member row");
  return her;
}

function addressOf(her: Member): string {
  return her.addressForm ?? her.displayName;
}

/** The request's words for this contact, which the tap's evidence hashes as they were shown. */
async function requestParams(
  deps: Pick<Deps, "config">,
  db: Queryable,
  contact: NearbyContact,
  lang: Lang,
): Promise<Record<string, string>> {
  const her = await herOf(db, contact);
  const organiser = (await nameOf(db, contact.invitedBy)) || addressOf(her);
  return { organiser, name: addressOf(her), notice: deps.config.privacyNoticeUrls[lang] };
}

/**
 * A contact opened the link an organiser shared: they are asked, in that organiser's name and in
 * the language their Telegram is set to, with Yes and No. A link already answered, or replaced by
 * a newer one, is refused as any spent link is.
 */
export async function handleNearbyStart(deps: Deps, event: InboundEvent): Promise<void> {
  const token = event.startParam?.trim() ?? "";
  const conversationId = event.conversation.externalId;
  const lang = languageOfSender(event.sender.languageCode);
  const hash = await deviceTokenHash(token);
  const [contact] = await deps.db
    .select()
    .from(nearbyContacts)
    .where(eq(nearbyContacts.inviteTokenHash, hash))
    .limit(1);
  if (contact === undefined) {
    await sendOutsideGateway(deps, {
      kind: "consent",
      idempotencyKey: outboundKey("consent", {
        conversationId,
        suffix: `nearby_invalid:${event.eventId}`,
      }),
      lang,
      to: { channel: event.channel, conversationId },
      text: t(lang, "consent.invalid_link"),
    });
    deps.logger.info("nearby_start_refused", {});
    return;
  }
  const params = await requestParams(deps, deps.db, contact, lang);
  const request: OutboundRequest = {
    kind: "consent",
    idempotencyKey: outboundKey("consent", {
      conversationId,
      suffix: requestSuffix(contact.id, hash),
    }),
    memberId: contact.memberId,
    channel: event.channel,
    conversationId,
    lang,
    text: t(lang, "nearby.request", params),
    buttons: [
      [
        {
          id: encodeButton({ type: "nearby_consent", contactId: contact.id, accept: true }),
          label: t(lang, "nearby.yes"),
        },
        {
          id: encodeButton({ type: "nearby_consent", contactId: contact.id, accept: false }),
          label: t(lang, "nearby.no"),
        },
      ],
    ],
  };
  await handOverOutbound(deps, request, await insertOutbound(deps, deps.db, request));
  deps.logger.info("nearby_start", { familyId: contact.familyId });
}

/** Messages written in an answer's transaction, handed to the queue once it commits. */
type Pending = { request: OutboundRequest; written: InsertResult }[];

async function write(
  deps: Deps,
  tx: VelaTransaction,
  pending: Pending,
  request: OutboundRequest,
): Promise<void> {
  pending.push({ request, written: await insertOutbound(deps, tx, request) });
}

/** Every organiser of her family who can be told on Telegram, in their own language. */
async function tellOrganisers(
  deps: Deps,
  tx: VelaTransaction,
  pending: Pending,
  contact: NearbyContact,
  key: "organiser.nearby_yes" | "organiser.nearby_no",
  suffix: string,
): Promise<void> {
  const her = await herOf(tx, contact);
  for (const organiser of await activeOrganisersWithLinks(
    tx,
    contact.familyId,
    ORGANISER_CHANNEL,
  )) {
    const lang = organiser.member.language;
    await write(deps, tx, pending, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: organiser.link.externalId,
        suffix,
      }),
      memberId: organiser.member.id,
      channel: organiser.link.channel,
      conversationId: organiser.link.externalId,
      lang,
      text: t(lang, key, { contact: contact.name, name: addressOf(her) }),
    });
  }
}

/**
 * Their Yes or No under the request. It counts only from the chat the current link's request was
 * sent to, and only while that link waits: a tap on an older request, after a newer link replaced
 * it or after their answer, changes nothing. Yes keeps their account with the yes, lists them, and
 * tells the organisers; No records the no and deletes them at once, with a proof of the deletion.
 */
export async function handleNearbyConsentButton(
  deps: Deps,
  event: InboundEvent,
  action: { contactId: string; accept: boolean },
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  const conversationId = event.conversation.externalId;
  const now = deps.clock.now();
  const pending: Pending = [];
  const outcome = await deps.db.transaction(async (tx) => {
    const [contact] = await tx
      .select()
      .from(nearbyContacts)
      .where(eq(nearbyContacts.id, action.contactId))
      .for("update");
    if (contact === undefined || contact.inviteTokenHash === null) return null;
    const [sent] = await tx
      .select({ payload: outbound.payload })
      .from(outbound)
      .where(
        eq(
          outbound.idempotencyKey,
          outboundKey("consent", {
            conversationId,
            suffix: requestSuffix(contact.id, contact.inviteTokenHash),
          }),
        ),
      )
      .limit(1);
    if (sent === undefined || event.conversation.kind !== "private") return null;
    // The language the request was written in, which is what the tap answers.
    const lang = (sent.payload as { message?: { lang?: Lang } }).message?.lang ?? "en";
    const params = await requestParams(deps, tx, contact, lang);
    const evidence = await chatConsentEvidence({
      chatId: conversationId,
      messageId: event.messageId,
      lang,
      key: "nearby.request",
      params,
    });
    const proof = {
      contactId: contact.id,
      subjectRef: subjectRef({ contactId: contact.id }),
      kind: "nearby" as const,
      textVersion: NEARBY_TEXT_VERSION,
      lang,
      channel: event.channel,
      givenAt: now,
      evidence: { ...evidence, recorded_by: "contact" },
    };
    const words = {
      "nearby.accepted": { organiser: params.organiser ?? "", name: params.name ?? "" },
      "nearby.declined": {},
      "nearby.already_listed": { name: params.name ?? "" },
    } as const;
    const reply = (key: keyof typeof words) => ({
      kind: "consent" as const,
      idempotencyKey: outboundKey("consent", {
        conversationId,
        suffix: `nearby_answer:${contact.id}:${event.eventId}`,
      }),
      memberId: contact.memberId,
      channel: event.channel,
      conversationId,
      lang,
      text: t(lang, key, words[key]),
    });

    if (action.accept) {
      const [already] = await tx
        .select({ id: nearbyContacts.id })
        .from(nearbyContacts)
        .where(
          and(
            eq(nearbyContacts.memberId, contact.memberId),
            eq(nearbyContacts.externalId, event.sender.externalUserId),
          ),
        )
        .limit(1);
      if (already !== undefined) {
        // The same person, listed near her under another name: this row asks for nothing new.
        await write(deps, tx, pending, reply("nearby.already_listed"));
        return { answered: t(lang, "nearby.already_listed", words["nearby.already_listed"]) };
      }
      await tx
        .update(nearbyContacts)
        .set({
          externalId: event.sender.externalUserId,
          channel: "telegram",
          consentedAt: now,
          declinedAt: null,
          inviteTokenHash: null,
        })
        .where(eq(nearbyContacts.id, contact.id));
      await tx.insert(consents).values({ ...proof, answer: "yes" });
      await recordEvent(
        tx,
        {
          name: "consent_given",
          familyId: contact.familyId,
          memberId: contact.memberId,
          props: { kind: "nearby", contact_id: contact.id, recorded_by: "contact" },
        },
        now,
      );
      await write(deps, tx, pending, reply("nearby.accepted"));
      await tellOrganisers(
        deps,
        tx,
        pending,
        contact,
        "organiser.nearby_yes",
        `nearby_yes:${contact.id}`,
      );
      return { answered: t(lang, "nearby.accepted", words["nearby.accepted"]) };
    }

    await tx.insert(consents).values({ ...proof, answer: "no" });
    await recordEvent(
      tx,
      {
        name: "consent_declined",
        familyId: contact.familyId,
        memberId: contact.memberId,
        props: { kind: "nearby", contact_id: contact.id, recorded_by: "contact" },
      },
      now,
    );
    await write(deps, tx, pending, reply("nearby.declined"));
    await tellOrganisers(
      deps,
      tx,
      pending,
      contact,
      "organiser.nearby_no",
      `nearby_no:${contact.id}`,
    );
    await deleteContact(tx, contact, "contact declined", now);
    return { answered: t(lang, "nearby.declined") };
  });
  for (const { request, written } of pending) await handOverOutbound(deps, request, written);
  if (outcome === null) {
    deps.logger.warn("nearby_consent_ignored", {});
    return;
  }
  if (event.messageId !== undefined) {
    await adapter.closeButtons(conversationId, event.messageId);
  }
  deps.logger.info("nearby_consent", { accept: action.accept });
}

/** Deletes a contact as every path does: their consents forgotten, the row gone, a proof kept. */
export async function deleteContact(
  tx: VelaTransaction,
  contact: NearbyContact,
  reason: string,
  at: Date,
): Promise<void> {
  await forgetConsentSubjects(tx, { contactIds: [contact.id] }, at);
  await tx.delete(nearbyContacts).where(eq(nearbyContacts.id, contact.id));
  await recordDeletion(tx, { objectType: "nearby_contact", objectId: contact.id, reason, at });
  await recordEvent(
    tx,
    {
      name: "nearby_contact_removed",
      familyId: contact.familyId,
      memberId: contact.memberId,
      props: { contact_id: contact.id, by: "contact" },
    },
    at,
  );
}

/**
 * Words in a private chat from someone who is no member but is listed near someone: stop removes
 * them from every list they are on, their yes withdrawn and their details deleted, and anything
 * else is told how Vela writes to them. False when the sender is listed nowhere, for the router's
 * own answer to strangers.
 */
export async function handleNearbyMessage(deps: Deps, event: InboundEvent): Promise<boolean> {
  if (event.conversation.kind !== "private" || event.channel !== "telegram") return false;
  const listed = await deps.db
    .select()
    .from(nearbyContacts)
    .where(eq(nearbyContacts.externalId, event.sender.externalUserId));
  if (listed.length === 0) return false;
  const conversationId = event.conversation.externalId;
  const lang = languageOfSender(event.sender.languageCode);
  const stop = STOP.test(event.text?.trim() ?? "");
  const now = deps.clock.now();
  const first = listed[0];
  if (first === undefined) return false;
  const pending: Pending = [];
  await deps.db.transaction(async (tx) => {
    if (stop) {
      for (const contact of listed) {
        await tx
          .update(consents)
          .set({ withdrawnAt: now })
          .where(
            and(
              eq(consents.contactId, contact.id),
              eq(consents.kind, "nearby"),
              eq(consents.answer, "yes"),
              isNull(consents.withdrawnAt),
            ),
          );
        await deleteContact(tx, contact, "contact said stop", now);
      }
    }
    await write(deps, tx, pending, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId,
        suffix: `nearby_${stop ? "stop" : "help"}:${event.eventId}`,
      }),
      // A row belongs to a member: the first family's kept-light member, whose contact this is.
      memberId: first.memberId,
      channel: "telegram",
      conversationId,
      lang,
      text: t(lang, stop ? "nearby.removed" : "nearby.help"),
    });
  });
  for (const { request, written } of pending) await handOverOutbound(deps, request, written);
  deps.logger.info("nearby_message", { stop });
  return true;
}
