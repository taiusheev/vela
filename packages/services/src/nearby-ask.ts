/**
 * "Ask them to look in" (spec §8, §14.1 A11, §14.3 M6; ADR-36): on a quiet morning an organiser asks
 * someone nearby who said yes, on Telegram and in the organiser's own name, whether they could look
 * in on her today, with "I'll look in" and "Can't today". Their answer goes to whoever asked, and
 * the sheet shows it; when the morning closes (she answers, or an organiser says she is fine) each
 * contact asked and not refused is told there is no need. One ask per contact per quiet morning: the
 * `nearby_ask` row's key is the event and their chat, and the event keeps who asked whom and what
 * came back in `ask_to_check`. A message to a third person is always a person's tap, so the row
 * names the organiser who tapped (`outbound_nearby_ask_actor_check`).
 */
import type { ApiMutationResponse, InboundEvent, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
import { encodeButton, outboundKey } from "@vela/core";
import {
  consents,
  type Member,
  type NearbyContact,
  nearbyContacts,
  type QuietEvent,
  quietEvents,
  type VelaTransaction,
} from "@vela/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import {
  handOverOutbound,
  type InsertResult,
  insertOutbound,
  type OutboundRequest,
} from "./gateway.ts";
import { channelLinkOfMember, familyHasEnded, memberById, type Queryable } from "./repo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One ask on a quiet morning, as `quiet_events.ask_to_check` keeps it. */
export interface LookInAsk {
  contact_id: string;
  sent_by: string;
  sent_at: string;
  reply: "yes" | "no" | null;
  replied_at: string | null;
}

export function asksOf(quiet: Pick<QuietEvent, "askToCheck">): LookInAsk[] {
  return (quiet.askToCheck as unknown[]).flatMap((entry) => {
    const ask = entry as Partial<LookInAsk>;
    return typeof ask.contact_id === "string" &&
      typeof ask.sent_by === "string" &&
      typeof ask.sent_at === "string"
      ? [
          {
            contact_id: ask.contact_id,
            sent_by: ask.sent_by,
            sent_at: ask.sent_at,
            reply: ask.reply === "yes" || ask.reply === "no" ? ask.reply : null,
            replied_at: typeof ask.replied_at === "string" ? ask.replied_at : null,
          },
        ]
      : [];
  });
}

export class LookInRefusedError extends Error {
  override readonly name = "LookInRefusedError";
  readonly reason: "settled" | "cannot_be_asked";
  constructor(reason: "settled" | "cannot_be_asked") {
    super(`Ask to look in refused: ${reason}`);
    this.reason = reason;
  }
}

/** Whether a contact can be asked: listed, with the Telegram account their yes gave. */
export function canBeAsked(contact: NearbyContact): boolean {
  return (
    contact.consentedAt !== null &&
    contact.declinedAt === null &&
    contact.externalId !== null &&
    contact.channel === "telegram"
  );
}

/** The language a contact said yes in, which every message to them is written in. */
async function languageOfContact(db: Queryable, contact: NearbyContact): Promise<Lang> {
  const [yes] = await db
    .select({ lang: consents.lang })
    .from(consents)
    .where(
      and(
        eq(consents.contactId, contact.id),
        eq(consents.kind, "nearby"),
        eq(consents.answer, "yes"),
        isNull(consents.withdrawnAt),
      ),
    )
    .orderBy(desc(consents.givenAt))
    .limit(1);
  return yes?.lang === "zh-TW" ? "zh-TW" : "en";
}

function addressOf(her: Member): string {
  return her.addressForm ?? her.displayName;
}

/**
 * "Ask them to look in" from the app (`POST /v1/quiet/:quietEventId/ask-to-check`, `{contact_id}`):
 * organisers of her family only, while the morning is still quiet, to a contact near her who can be
 * asked. Through `runApiMutation`, under the event's row lock: asking the same person again on the
 * same morning sends nothing new and answers the ask as it stands. 409 `settled` once the morning
 * closed, 409 `cannot_be_asked` for a contact with no Telegram yes.
 */
export async function askApiToLookIn(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  quietEventId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  const contactId =
    typeof input === "object" && input !== null && "contact_id" in input
      ? (input as { contact_id: unknown }).contact_id
      : undefined;
  if (typeof contactId !== "string" || !UUID.test(contactId) || !UUID.test(quietEventId)) {
    throw new VelaError("not_found", "Not found");
  }
  const now = deps.clock.now();
  const after = nothingAfterCommit();
  const result = await runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "quiet.ask_to_check:v1",
      input: { quiet_event_id: quietEventId.toLowerCase(), contact_id: contactId.toLowerCase() },
    },
    {
      authorize: async (tx) => {
        await lockForAsk(tx, identity, quietEventId, contactId);
      },
      mutate: async (tx) => {
        const { quiet, her, organiser, contact } = await lockForAsk(
          tx,
          identity,
          quietEventId,
          contactId,
        );
        const asks = asksOf(quiet);
        const earlier = asks.find((ask) => ask.contact_id === contact.id);
        if (earlier !== undefined) {
          return { status: 200, body: askBody(quiet.id, earlier) };
        }
        if (quiet.resolvedAt !== null) throw new LookInRefusedError("settled");
        if (!canBeAsked(contact) || contact.externalId === null) {
          throw new LookInRefusedError("cannot_be_asked");
        }
        const ask: LookInAsk = {
          contact_id: contact.id,
          sent_by: organiser.id,
          sent_at: now.toISOString(),
          reply: null,
          replied_at: null,
        };
        await tx
          .update(quietEvents)
          .set({ askToCheck: [...asks, ask] })
          .where(eq(quietEvents.id, quiet.id));
        const lang = await languageOfContact(tx, contact);
        const params = { organiser: organiser.displayName, name: addressOf(her) };
        const written = await insertOutbound(deps, tx, {
          kind: "nearby_ask",
          idempotencyKey: outboundKey("nearby_ask", {
            quietEventId: quiet.id,
            conversationId: contact.externalId,
          }),
          memberId: her.id,
          actorId: organiser.id,
          channel: "telegram",
          conversationId: contact.externalId,
          exchangeId: quiet.exchangeId,
          lang,
          text: t(lang, "nearby.ask", params),
          buttons: [
            [
              {
                id: encodeButton({ type: "look_in", quietEventId: quiet.id, accept: true }),
                label: t(lang, "nearby.ask_yes"),
              },
              {
                id: encodeButton({ type: "look_in", quietEventId: quiet.id, accept: false }),
                label: t(lang, "nearby.ask_no"),
              },
            ],
          ],
        });
        if ("outboundId" in written) after.outboundIds.push(written.outboundId);
        await recordEvent(
          tx,
          {
            name: "ask_to_check_sent",
            familyId: her.familyId,
            memberId: her.id,
            exchangeId: quiet.exchangeId,
            surface: "app",
            props: { contact_id: contact.id, by: organiser.id },
          },
          now,
        );
        return { status: 201, body: askBody(quiet.id, ask) };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}

function askBody(quietEventId: string, ask: LookInAsk) {
  return {
    quiet_event_id: quietEventId,
    contact_id: ask.contact_id,
    asked_at: ask.sent_at,
    reply: ask.reply,
  };
}

/** The event and the contact, locked, when the caller organises her family; otherwise a 404. */
async function lockForAsk(
  tx: VelaTransaction,
  identity: SessionIdentity,
  quietEventId: string,
  contactId: string,
): Promise<{ quiet: QuietEvent; her: Member; organiser: Member; contact: NearbyContact }> {
  const [quiet] = await tx
    .select()
    .from(quietEvents)
    .where(eq(quietEvents.id, quietEventId))
    .for("update");
  const her = quiet === undefined ? null : await memberById(tx, quiet.memberId);
  if (quiet === undefined || her === null || (await familyHasEnded(tx, her.familyId))) {
    throw new VelaError("not_found", "Not found");
  }
  const access = await authorizeFamilyAccess(tx, identity, her.familyId, "organiser");
  const organiser = access.kind === "granted" ? await memberById(tx, access.access.memberId) : null;
  if (organiser === null) throw new VelaError("not_found", "Not found");
  const [contact] = await tx
    .select()
    .from(nearbyContacts)
    .where(and(eq(nearbyContacts.id, contactId), eq(nearbyContacts.memberId, her.id)))
    .limit(1);
  if (contact === undefined) throw new VelaError("not_found", "Not found");
  return { quiet, her, organiser, contact };
}

type Pending = { request: OutboundRequest; written: InsertResult }[];

/**
 * Their "I'll look in" or "Can't today". It counts once, from someone the morning asked: their
 * Telegram account names their row near her, and the event names the ask. The organiser who asked
 * hears it on Telegram, the sheet shows it, and they are thanked. A tap after the morning closed is
 * answered with the stand-down instead.
 */
export async function handleLookInButton(
  deps: Deps,
  event: InboundEvent,
  action: { quietEventId: string; accept: boolean },
): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  const now = deps.clock.now();
  const conversationId = event.conversation.externalId;
  const pending: Pending = [];
  const recorded = await deps.db.transaction(async (tx) => {
    const [quiet] = await tx
      .select()
      .from(quietEvents)
      .where(eq(quietEvents.id, action.quietEventId))
      .for("update");
    if (quiet === undefined || event.conversation.kind !== "private") return false;
    const [contact] = await tx
      .select()
      .from(nearbyContacts)
      .where(
        and(
          eq(nearbyContacts.memberId, quiet.memberId),
          eq(nearbyContacts.externalId, event.sender.externalUserId),
          isNotNull(nearbyContacts.consentedAt),
        ),
      )
      .limit(1);
    const asks = asksOf(quiet);
    const ask = contact === undefined ? undefined : asks.find((a) => a.contact_id === contact.id);
    if (contact === undefined || ask === undefined || ask.reply !== null) return false;
    const her = await memberById(tx, quiet.memberId);
    const asker = await memberById(tx, ask.sent_by);
    if (her === null) return false;
    const lang = await languageOfContact(tx, contact);
    const reply = action.accept ? "yes" : "no";
    await tx
      .update(quietEvents)
      .set({
        askToCheck: asks.map((entry) =>
          entry.contact_id === contact.id
            ? { ...entry, reply, replied_at: now.toISOString() }
            : entry,
        ),
      })
      .where(eq(quietEvents.id, quiet.id));
    const settled = quiet.resolvedAt !== null;
    const thanks = settled
      ? t(lang, "nearby.stand_down", { name: addressOf(her) })
      : t(lang, action.accept ? "nearby.thanks_yes" : "nearby.thanks_no", {
          organiser: asker?.displayName ?? "",
        });
    pending.push(
      await written(deps, tx, {
        kind: "system",
        idempotencyKey: outboundKey("system", {
          conversationId,
          suffix: `look_in:${quiet.id}:${event.eventId}`,
        }),
        memberId: her.id,
        channel: "telegram",
        conversationId,
        lang,
        text: thanks,
      }),
    );
    if (asker !== null && !settled) {
      const link = await channelLinkOfMember(tx, asker.id, "telegram");
      if (link !== null && link.blockedAt === null) {
        pending.push(
          await written(deps, tx, {
            kind: "system",
            idempotencyKey: outboundKey("system", {
              conversationId: link.externalId,
              suffix: `look_in:${quiet.id}:${contact.id}`,
            }),
            memberId: asker.id,
            channel: "telegram",
            conversationId: link.externalId,
            exchangeId: quiet.exchangeId,
            lang: asker.language,
            text: t(
              asker.language,
              action.accept ? "organiser.look_in_yes" : "organiser.look_in_no",
              {
                contact: contact.name,
                name: addressOf(her),
              },
            ),
          }),
        );
      }
    }
    return true;
  });
  for (const { request, written: row } of pending) await handOverOutbound(deps, request, row);
  if (event.messageId !== undefined && recorded) {
    await adapter.closeButtons(conversationId, event.messageId);
  }
  deps.logger.info("look_in_button", { recorded, accept: action.accept });
}

async function written(
  deps: Deps,
  tx: VelaTransaction,
  request: OutboundRequest,
): Promise<{ request: OutboundRequest; written: InsertResult }> {
  return { request, written: await insertOutbound(deps, tx, request) };
}

/**
 * When the quiet morning closes, each contact asked who did not say "Can't today" is told there is
 * no need to look in, so nobody goes round for a morning already settled. In the caller's
 * transaction, as the organisers' closing notices are.
 */
export async function lookInStandDowns(
  db: Queryable,
  closed: QuietEvent,
  her: Member,
): Promise<OutboundRequest[]> {
  const notices: OutboundRequest[] = [];
  for (const ask of asksOf(closed)) {
    if (ask.reply === "no") continue;
    const [contact] = await db
      .select()
      .from(nearbyContacts)
      .where(eq(nearbyContacts.id, ask.contact_id))
      .limit(1);
    if (contact === undefined || contact.externalId === null) continue;
    const lang = await languageOfContact(db, contact);
    notices.push({
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: contact.externalId,
        suffix: `look_in_stand_down:${closed.id}`,
      }),
      memberId: her.id,
      channel: "telegram",
      conversationId: contact.externalId,
      exchangeId: closed.exchangeId,
      lang,
      text: t(lang, "nearby.stand_down", { name: addressOf(her) }),
    });
  }
  return notices;
}
