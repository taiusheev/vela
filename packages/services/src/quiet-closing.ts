/**
 * The message that closes a quiet event for one organiser who was told of it (flows §3.12): that she
 * answered, or who said she is fine. The close writes it to everyone the event counts as told
 * (`tellNotified` in `quiet.ts`), and the gateway writes it after a notice that was already on its
 * way when the event closed (`quietNoticeSent`), since the close could not count a reader that notice
 * had not reached yet. One idempotency key per event, reader and channel, so each hears it once on
 * each channel, whichever writes it first.
 *
 * With push (ADR-34), a reader told on their phone hears the close there too: only a reader whose
 * app notice for the event was sent, since a close about a notice they never had would say nothing
 * to them. It goes whatever "One moment a day" says, as the notice did, to the account that notice
 * went to; should push be off by then, the gateway drops it.
 *
 * Apart from `quiet.ts`, which reaches the gateway, so the gateway's effects can use it without an
 * import cycle.
 */
import type { Channel } from "@vela/contracts";
import { t } from "@vela/copy";
import { outboundKey } from "@vela/core";
import { type Member, outbound, type QuietEvent } from "@vela/db";
import { and, eq } from "drizzle-orm";
import { formatTime } from "./format.ts";
import type { OutboundRequest } from "./gateway.ts";
import { PUSH_CHANNEL } from "./push-messages.ts";
import { channelLinkOfMember, isMessenger, MESSENGER, memberById, type Queryable } from "./repo.ts";

/** Quiet notices go out on Telegram in the pilot, and so do the messages that close them. */
/** Organisers hear of a quiet morning on their own messenger (05-line-flows §5.11). */
export const NOTICE_CHANNEL = MESSENGER;

/** The words that close `closed` for a reader in `lang`, or null for an outcome that tells no one. */
async function closingText(
  db: Queryable,
  closed: QuietEvent,
  her: Member,
  lang: Member["language"],
): Promise<string | null> {
  if (closed.resolvedAt === null) {
    return null;
  }
  switch (closed.outcome) {
    case "answered_late":
      return t(lang, "quiet.resolved_answered", {
        name: her.displayName,
        time: formatTime(closed.resolvedAt, her.tz),
      });
    case "fine_known": {
      const resolver = closed.resolvedBy === null ? null : await memberById(db, closed.resolvedBy);
      return resolver === null
        ? null
        : t(lang, "quiet.resolved_fine", {
            organiser: resolver.displayName,
            name: her.displayName,
          });
    }
    default:
      return null;
  }
}

/**
 * What `readerId` reads on Telegram now that `closed` has closed; null while it is open, for the
 * organiser who closed it, for a reader who can no longer be reached there, and for an outcome that
 * tells no one.
 */
export async function closingNoticeFor(
  db: Queryable,
  closed: QuietEvent,
  her: Member,
  readerId: string,
): Promise<OutboundRequest | null> {
  if (closed.resolvedAt === null || readerId === closed.resolvedBy) {
    return null;
  }
  const reader = await memberById(db, readerId);
  const link = await channelLinkOfMember(db, readerId, NOTICE_CHANNEL);
  if (reader === null || link === null || link.blockedAt !== null) {
    return null;
  }
  const text = await closingText(db, closed, her, reader.language);
  if (text === null) {
    return null;
  }
  return {
    kind: "quiet_resolved",
    idempotencyKey: outboundKey("quiet_resolved", { quietEventId: closed.id, memberId: readerId }),
    memberId: readerId,
    channel: link.channel,
    conversationId: link.externalId,
    exchangeId: closed.exchangeId,
    lang: reader.language,
    text,
  };
}

// Push (ADR-34) -----------------------------------------------------------------------------------

/**
 * What `readerId` reads on their phone now that `closed` has closed: only when the app's notice of
 * this event was sent to them, and to the account it went to. Null otherwise, and in every case
 * `closingNoticeFor` returns null for.
 */
export async function appClosingNoticeFor(
  db: Queryable,
  closed: QuietEvent,
  her: Member,
  readerId: string,
): Promise<OutboundRequest | null> {
  if (closed.resolvedAt === null || readerId === closed.resolvedBy) {
    return null;
  }
  const [told] = await db
    .select({ conversationId: outbound.conversationId })
    .from(outbound)
    .where(
      and(
        eq(outbound.memberId, readerId),
        eq(outbound.exchangeId, closed.exchangeId),
        eq(outbound.kind, "quiet_notice"),
        eq(outbound.channel, PUSH_CHANNEL),
        eq(outbound.status, "sent"),
      ),
    )
    .limit(1);
  const reader = told === undefined ? null : await memberById(db, readerId);
  if (told === undefined || reader === null) {
    return null;
  }
  const text = await closingText(db, closed, her, reader.language);
  if (text === null) {
    return null;
  }
  return {
    kind: "quiet_resolved",
    idempotencyKey: outboundKey("quiet_resolved", {
      quietEventId: closed.id,
      memberId: readerId,
      suffix: PUSH_CHANNEL,
    }),
    memberId: readerId,
    channel: PUSH_CHANNEL,
    conversationId: told.conversationId,
    exchangeId: closed.exchangeId,
    lang: reader.language,
    text,
  };
}

/**
 * Every close `readerId` reads now that `closed` has closed: on Telegram (`closingNoticeFor`) and on
 * their phone (`appClosingNoticeFor`), or on `channel` alone, the channel of a notice that landed
 * after the close, which is followed by the close on its own channel.
 */
export async function closingNoticesFor(
  db: Queryable,
  closed: QuietEvent,
  her: Member,
  readerId: string,
  channel?: Channel,
): Promise<OutboundRequest[]> {
  const notices: OutboundRequest[] = [];
  if (channel === undefined || isMessenger(channel)) {
    const notice = await closingNoticeFor(db, closed, her, readerId);
    if (notice !== null) notices.push(notice);
  }
  if (channel === undefined || channel === PUSH_CHANNEL) {
    const notice = await appClosingNoticeFor(db, closed, her, readerId);
    if (notice !== null) notices.push(notice);
  }
  return notices;
}
