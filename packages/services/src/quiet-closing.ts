/**
 * The message that closes a quiet event for one organiser who was told of it (flows §3.12): that she
 * answered, or who said she is fine. The close writes it to everyone the event counts as told
 * (`tellNotified` in `quiet.ts`), and the gateway writes it after a notice that was already on its
 * way when the event closed (`quietNoticeSent`), since the close could not count a reader that notice
 * had not reached yet. One idempotency key per event and reader, so each hears it once, whichever
 * writes it first.
 *
 * Apart from `quiet.ts`, which reaches the gateway, so the gateway's effects can use it without an
 * import cycle.
 */
import type { Channel } from "@vela/contracts";
import { t } from "@vela/copy";
import { outboundKey } from "@vela/core";
import type { Member, QuietEvent } from "@vela/db";
import { formatTime } from "./format.ts";
import type { OutboundRequest } from "./gateway.ts";
import { channelLinkOfMember, memberById, type Queryable } from "./repo.ts";

/** Quiet notices go out on Telegram in the pilot, and so do the messages that close them. */
export const NOTICE_CHANNEL: Channel = "telegram";

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
 * What `readerId` reads now that `closed` has closed; null while it is open, for the organiser who
 * closed it, for a reader who can no longer be reached, and for an outcome that tells no one.
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
