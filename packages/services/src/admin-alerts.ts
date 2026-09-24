/**
 * Where the founder is told, and two things the founder is told that no flow owns: a family left
 * with no organiser who can be told, and a quiet morning that found nobody to tell (the founder's
 * decision of 24 September 2026). Every organiser who could hear of her silence is active, with a
 * Telegram link that is not blocked; when none is left, the founder is.
 *
 * A leaf, importing no flow and not the gateway, so the gateway's own effects — which learn that a
 * link is blocked — can use it without an import cycle. `admin.ts` re-exports the constants.
 */
import type { Channel, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
import { outboundKey } from "@vela/core";
import type { Family, Member } from "@vela/db";
import type { Config, Deps } from "./deps.ts";
import type { OutboundRequest } from "./gateway.ts";
import { NOTICE_CHANNEL } from "./quiet-closing.ts";
import {
  activeOrganisersWithLinks,
  familyById,
  familyHasEnded,
  memberById,
  type Queryable,
} from "./repo.ts";

/**
 * The founder reads the admin conversation in English, the copy's source language: every
 * `admin.*` message is written in it, whatever the family speaks.
 */
export const ADMIN_LANG: Lang = "en";

/**
 * The admin conversation is one chat on one channel: the founder's chat with the bot on Telegram,
 * like the pilot's families (flows §3.14). Every row addressed to `Config.adminConversationId`
 * carries this channel, whatever channel the family that caused it is on, or the row would be
 * handed to another channel's adapter with a Telegram chat id.
 */
export const ADMIN_CHANNEL: Channel = "telegram";

/** The path of the overview; the family page is `familyPagePath`. The worker serves both (§9). */
export const ADMIN_OVERVIEW_PATH = "/admin";

export function familyPagePath(familyId: string): string {
  return `/admin/families/${familyId}`;
}

/** The `{link}` in admin messages: the family's page on the Worker's public origin. */
export function adminLink(config: Config, familyId: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}${familyPagePath(familyId)}`;
}

/**
 * `memberId`, an organiser, has just stopped being one who can be told — marked left, or their
 * link blocked — and no other organiser of the family can be. From now on a quiet morning there
 * reaches nobody, so the founder hears it at once, while the family can still be reached another
 * way. `occasion` names what happened, once. Null when `memberId` was not an organiser, another
 * organiser can still be told, the family has ended, or there is no admin conversation.
 */
export async function organisersUnreachableAlert(
  deps: Pick<Deps, "config">,
  db: Queryable,
  memberId: string,
  occasion: string,
): Promise<OutboundRequest | null> {
  const admin = deps.config.adminConversationId;
  if (admin === null) {
    return null;
  }
  const organiser = await memberById(db, memberId);
  if (organiser === null || organiser.role !== "organiser") {
    return null;
  }
  const family = await familyById(db, organiser.familyId);
  if (family === null || (await familyHasEnded(db, family.id))) {
    return null;
  }
  if ((await activeOrganisersWithLinks(db, family.id, NOTICE_CHANNEL)).length > 0) {
    return null;
  }
  return {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: admin,
      suffix: `organisers_unreachable:${occasion}`,
    }),
    memberId: organiser.id,
    channel: ADMIN_CHANNEL,
    conversationId: admin,
    lang: ADMIN_LANG,
    text: t(ADMIN_LANG, "admin.organisers_unreachable", {
      name: organiser.displayName,
      family: family.name,
      link: adminLink(deps.config, family.id),
    }),
  };
}

/**
 * Her silence found no organiser to tell: a family made in the app, whose organiser has no Telegram
 * link while notices reach only Telegram, or one whose last organiser was marked left or blocked the
 * bot. (Leaving the Telegram group is not one of these: an organiser keeps their membership and their
 * private chat, flows §3.16.) The founder is the one left to tell, once per round of notices. Null
 * with no admin conversation. Her words never go with it: names and a link only.
 */
export function quietNobodyToldAlert(
  deps: Pick<Deps, "config">,
  input: { quietId: string; round: number; her: Member; family: Family },
): OutboundRequest | null {
  const admin = deps.config.adminConversationId;
  if (admin === null) {
    return null;
  }
  const { quietId, round, her, family } = input;
  return {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: admin,
      suffix: `quiet_nobody_told:${quietId}:${round}`,
    }),
    memberId: her.id,
    channel: ADMIN_CHANNEL,
    conversationId: admin,
    lang: ADMIN_LANG,
    text: t(ADMIN_LANG, "admin.quiet_nobody_told", {
      name: her.displayName,
      family: family.name,
      link: adminLink(deps.config, family.id),
    }),
  };
}
