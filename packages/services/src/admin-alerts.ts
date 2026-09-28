/**
 * Where the founder is told, and the things the founder is told that no flow owns: a family left
 * with no organiser who can be told, a quiet morning that found nobody to tell (the founder's
 * decision of 24 September 2026), and, with push (ADR-34), a quiet notice that reached no phone and
 * push credentials that were refused. Every organiser who could hear of her silence is active, with
 * a Telegram link that is not blocked, or, while push is on, a phone that can be told
 * (`reachableOrganisers`); when none is left, the founder is.
 *
 * A leaf, importing no flow and not the gateway, so the gateway's own effects — which learn that a
 * link is blocked — can use it without an import cycle. `admin.ts` re-exports the constants.
 */
import type { Channel, Lang } from "@vela/contracts";
import { t } from "@vela/copy";
import { localDateOf, outboundKey } from "@vela/core";
import { type Family, type Member, outbound } from "@vela/db";
import { inArray } from "drizzle-orm";
import type { Config, Deps } from "./deps.ts";
import type { OutboundRequest } from "./gateway.ts";
import { isUnheardPush, PUSH_CHANNEL } from "./push-messages.ts";
import { NOTICE_CHANNEL } from "./quiet-closing.ts";
import {
  familyById,
  familyHasEnded,
  memberById,
  type Queryable,
  quietEventById,
  reachableOrganisers,
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
export function adminLink(config: Pick<Config, "publicBaseUrl">, familyId: string): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}${familyPagePath(familyId)}`;
}

/** The `{link}` in an admin message about no family, such as LINE's quota: the overview. */
export function adminOverviewLink(config: Config): string {
  return `${config.publicBaseUrl.replace(/\/+$/, "")}${ADMIN_OVERVIEW_PATH}`;
}

/**
 * What an alert about who can be told reads, where there is no `Deps` (ADR-34): the admin
 * conversation and origin, and whether push is on (`PUSH_SEND` "expo"), since only then does a
 * phone count toward being told. `Deps` carries the same through `config` and `push`.
 */
export interface AlertDeps {
  readonly config: Pick<Config, "adminConversationId" | "publicBaseUrl">;
  readonly pushSending: boolean;
}

/** Whether a phone counts toward being told (D4): push is on, `deps.push` non-null. */
function pushCounts(deps: AlertDeps | Pick<Deps, "config" | "push">): boolean {
  return "pushSending" in deps ? deps.pushSending : deps.push !== null;
}

/**
 * `memberId`, an organiser, has just stopped being one who can be told — marked left, their link
 * blocked, or, with push, their last phone that could be told gone (ADR-34) — and no other
 * organiser of the family can be. From now on a quiet morning there reaches nobody, so the founder
 * hears it at once, while the family can still be reached another way. `occasion` names what
 * happened, once. Null when `memberId` was not an organiser, anyone can still be told, the family
 * has ended, or there is no admin conversation.
 */
export async function organisersUnreachableAlert(
  deps: AlertDeps | Pick<Deps, "config" | "push">,
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
  if ((await reachableOrganisers(db, family.id, NOTICE_CHANNEL, pushCounts(deps))).length > 0) {
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
 *
 * With `readerId` (ADR-34), it is one organiser's phone the round's notice never reached, told once
 * per event, round and reader (`quietNoticeUnheardAlert`).
 */
export function quietNobodyToldAlert(
  deps: Pick<Deps, "config">,
  input: { quietId: string; round: number; her: Member; family: Family; readerId?: string },
): OutboundRequest | null {
  const admin = deps.config.adminConversationId;
  if (admin === null) {
    return null;
  }
  const { quietId, round, her, family, readerId } = input;
  return {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: admin,
      suffix:
        readerId === undefined
          ? `quiet_nobody_told:${quietId}:${round}`
          : `quiet_nobody_told:${quietId}:${round}:${readerId}`,
    }),
    memberId: her.id,
    channel: ADMIN_CHANNEL,
    conversationId: admin,
    lang: ADMIN_LANG,
    text: t(
      ADMIN_LANG,
      readerId === undefined ? "admin.quiet_nobody_told" : "admin.quiet_notice_unheard",
      { name: her.displayName, family: family.name, link: adminLink(deps.config, family.id) },
    ),
  };
}

// Push (ADR-34) -----------------------------------------------------------------------------------

/**
 * The quiet notice `outboundId` of `round` (the event's notify count before it) did not reach
 * `readerId`: it failed, or, on the app, push was off by the time it went, no phone of theirs
 * could be told, or Apple or Google refused it. The founder hears it (S2), once per event, round
 * and reader — unless the round's notice on the reader's other channel was sent or is still on its
 * way (queued, or waiting for a retry), whose own failure asks again. A sent app notice whose
 * receipts say no phone took it (`isUnheardPush`) carried nothing, so it counts as neither. Only
 * for a reader the round reached by push: a Telegram notice alone failing is what it was before
 * push (ADR-34). Null too when the event has closed since, and with no admin conversation.
 *
 * Every caller holds the quiet event's lock (`lockQuietEventOfNotice`), so of two notices of the
 * round settling at once, the one that decides second reads what the first wrote.
 */
export async function quietNoticeUnheardAlert(
  deps: Pick<Deps, "config">,
  db: Queryable,
  input: { quietEventId: string; round: number; readerId: string; outboundId: string },
): Promise<OutboundRequest | null> {
  if (deps.config.adminConversationId === null) {
    return null;
  }
  const quiet = await quietEventById(db, input.quietEventId);
  if (quiet === null || quiet.resolvedAt !== null) {
    return null;
  }
  const telegram = outboundKey("quiet_notice", {
    quietEventId: quiet.id,
    memberId: input.readerId,
    suffix: String(input.round),
  });
  const app = outboundKey("quiet_notice", {
    quietEventId: quiet.id,
    memberId: input.readerId,
    suffix: `${input.round}:${PUSH_CHANNEL}`,
  });
  const round = await db
    .select({
      id: outbound.id,
      channel: outbound.channel,
      status: outbound.status,
      error: outbound.error,
    })
    .from(outbound)
    .where(inArray(outbound.idempotencyKey, [telegram, app]));
  if (!round.some((row) => row.channel === PUSH_CHANNEL)) {
    return null;
  }
  const carried = round.some(
    (row) =>
      row.id !== input.outboundId &&
      (row.status === "queued" || (row.status === "sent" && !isUnheardPush(row))),
  );
  if (carried) {
    return null;
  }
  const her = await memberById(db, quiet.memberId);
  const family = her === null ? null : await familyById(db, her.familyId);
  if (her === null || family === null) {
    return null;
  }
  return quietNobodyToldAlert(deps, {
    quietId: quiet.id,
    round: input.round,
    her,
    family,
    readerId: input.readerId,
  });
}

/**
 * Expo, Apple or Google refused Vela's own push credentials (`reason`, the push port's label for
 * it, never a token). No retry mends that, and no phone hears anything until the founder fixes it,
 * so the founder hears it once a day (UTC) per reason (S2). The row is filed under `memberId`, the
 * reader whose push found it. Null with no admin conversation.
 */
export function pushMisconfiguredAlert(
  deps: Pick<Deps, "config" | "clock">,
  memberId: string,
  reason: string,
): OutboundRequest | null {
  const admin = deps.config.adminConversationId;
  if (admin === null) {
    return null;
  }
  const day = localDateOf(deps.clock.now(), "UTC");
  return {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: admin,
      suffix: `push_misconfigured:${reason.slice(0, 60)}:${day}`,
    }),
    memberId,
    channel: ADMIN_CHANNEL,
    conversationId: admin,
    lang: ADMIN_LANG,
    text: t(ADMIN_LANG, "admin.push_misconfigured", {
      link: `${deps.config.publicBaseUrl.replace(/\/+$/, "")}${ADMIN_OVERVIEW_PATH}`,
    }),
  };
}
