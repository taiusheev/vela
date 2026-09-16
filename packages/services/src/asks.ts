/**
 * Composing an ask in the family group (spec §4, flows §3.5): a reply to the evening prompt, or
 * `/ask <text>` for tomorrow and `/later <text>` for a whenever ask. The exchange is written in one
 * transaction under her member row's lock, the same lock `prepareDay` takes, so an album's two
 * photos arriving at once join one exchange and two asks cannot both claim a morning. The inbound
 * event ids an exchange came from live in `exchanges.options`, so a redelivered update finds its
 * exchange and changes nothing.
 */
import type { ExchangeType, InboundEvent, LocalDate, MediaRef, WhenRule } from "@vela/contracts";
import { t } from "@vela/copy";
import { addDays, localDateOf, outboundKey } from "@vela/core";
import {
  type Exchange,
  exchanges,
  type Family,
  type Member,
  members,
  turns,
  type VelaTransaction,
} from "@vela/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { recordEvent } from "./events.ts";
import { enqueueOutbound } from "./gateway.ts";
import { keptLightMemberOfFamily } from "./group.ts";
import {
  exchangeForLocalDate,
  familyById,
  familyHasEnded,
  memberById,
  recordInboundMedia,
} from "./repo.ts";

/** A photo choice is two photos (spec §4.4); an album with more keeps the first two. */
const ALBUM_PHOTOS = 2;

/** `/ask text`, `/later text`, with or without `@bot` (flows §3.5); the text may span lines. */
const ASK_COMMAND = /^\/(ask|later)(?:@(\w+))?(?:\s+([\s\S]*))?$/u;

/** The part of `exchanges.options` this module writes and reads. */
const AskOptions = z
  .object({
    inbound_event_ids: z.array(z.string()).default([]),
    media_group_id: z.string().optional(),
  })
  .loose();
type AskOptions = z.infer<typeof AskOptions>;

export interface AskTarget {
  familyId: string;
  /** The kept-light member the turn prompt was about. */
  recipientId: string;
  senderId: string;
  /** The date the prompt was for; null makes a whenever ask. */
  date: LocalDate | null;
}

export interface AskCommand {
  command: "ask" | "later";
  /** What follows the command, trimmed; empty when the command came alone or with media. */
  text: string;
}

/**
 * The ask command in a group message, or null for anything else, including a command addressed to
 * another bot (Telegram usernames are case-insensitive).
 */
export function parseAskCommand(text: string | undefined, botUsername: string): AskCommand | null {
  const match = text === undefined ? null : ASK_COMMAND.exec(text.trim());
  if (match === null) {
    return null;
  }
  const address = match[2];
  if (address !== undefined && address.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }
  return { command: match[1] === "later" ? "later" : "ask", text: (match[3] ?? "").trim() };
}

interface AskContent {
  type: ExchangeType;
  text: string | null;
  media: MediaRef[];
}

/** What the message asks (flows §3.5), or null when it carries nothing that can be an ask. */
function readAskContent(event: InboundEvent, text: string): AskContent | null {
  const words = text.length > 0 ? text : null;
  switch (event.kind) {
    case "text":
      return words === null ? null : { type: "question", text: words, media: [] };
    case "voice":
      return event.media === undefined
        ? null
        : { type: "voice_note", text: words, media: [event.media] };
    case "image":
      return event.media === undefined
        ? null
        : { type: "question", text: words, media: [event.media] };
    default:
      return null;
  }
}

function optionsOf(exchange: Exchange): AskOptions {
  const parsed = AskOptions.safeParse(exchange.options ?? {});
  return parsed.success ? parsed.data : { inbound_event_ids: [] };
}

/** The exchange this family already composed from the platform event, if the update came twice. */
async function exchangeFromEvent(
  tx: VelaTransaction,
  familyId: string,
  eventId: string,
): Promise<Exchange | null> {
  const rows = await tx
    .select()
    .from(exchanges)
    .where(
      and(
        eq(exchanges.familyId, familyId),
        sql`${exchanges.options} -> 'inbound_event_ids' ? ${eventId}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The composed exchange the sender's album already started, if this photo is its second. */
async function exchangeOfAlbum(
  tx: VelaTransaction,
  input: { familyId: string; recipientId: string; senderId: string; mediaGroupId: string },
): Promise<Exchange | null> {
  const rows = await tx
    .select()
    .from(exchanges)
    .where(
      and(
        eq(exchanges.familyId, input.familyId),
        eq(exchanges.recipientId, input.recipientId),
        eq(exchanges.askerId, input.senderId),
        eq(exchanges.state, "composed"),
        sql`${exchanges.options} ->> 'media_group_id' = ${input.mediaGroupId}`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

interface ComposeInput {
  family: Family;
  recipient: Member;
  sender: Member;
  date: LocalDate | null;
  content: AskContent;
  source: "reply" | "ask" | "later";
}

/**
 * The second photo of an album joins the exchange its first created (flows §3.5): the photo choice
 * has both images and the caption whichever message carried it. A third photo, a photo already in
 * the exchange, or a redelivered message changes nothing.
 */
async function joinAlbum(
  deps: Deps,
  tx: VelaTransaction,
  event: InboundEvent,
  existing: Exchange,
  input: ComposeInput,
  now: Date,
): Promise<void> {
  const options = optionsOf(existing);
  if (options.inbound_event_ids.includes(event.eventId)) {
    return;
  }
  const inboundEventIds = [...options.inbound_event_ids, event.eventId];
  const mediaIds = [...existing.mediaIds];
  for (const ref of input.content.media) {
    if (mediaIds.length >= ALBUM_PHOTOS) {
      break;
    }
    const file = await recordInboundMedia(tx, event.channel, {
      familyId: input.family.id,
      uploadedBy: input.sender.id,
      ref,
      now,
    });
    if (file !== null && !mediaIds.includes(file.id)) {
      mediaIds.push(file.id);
    }
  }
  const type: ExchangeType = mediaIds.length >= ALBUM_PHOTOS ? "photo_choice" : existing.type;
  await tx
    .update(exchanges)
    .set({
      type,
      text: existing.text ?? input.content.text,
      mediaIds,
      options: { ...options, inbound_event_ids: inboundEventIds },
    })
    .where(eq(exchanges.id, existing.id));
  deps.logger.info("ask_album_joined", {
    familyId: input.family.id,
    exchangeId: existing.id,
    photos: mediaIds.length,
  });
}

/** The name in `group.ask_queued`: who holds the morning already; Vela when it is the hello. */
async function holderOfDate(tx: VelaTransaction, taken: Exchange): Promise<string> {
  const asker = taken.askerId === null ? null : await memberById(tx, taken.askerId);
  return asker?.displayName ?? "Vela";
}

/**
 * One ask, in one transaction under the recipient's row lock. A date already taken (the one-per-day
 * index) makes the ask a whenever ask with `group.ask_queued`; otherwise `group.ask_confirmed`.
 */
async function composeAsk(deps: Deps, event: InboundEvent, input: ComposeInput): Promise<void> {
  const { family, recipient, sender, content } = input;
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.id, recipient.id))
      .for("update");
    const mediaGroupId = event.mediaGroupId;
    if (mediaGroupId !== undefined) {
      const album = await exchangeOfAlbum(tx, {
        familyId: family.id,
        recipientId: recipient.id,
        senderId: sender.id,
        mediaGroupId,
      });
      if (album !== null) {
        await joinAlbum(deps, tx, event, album, input, now);
        return;
      }
    }
    if ((await exchangeFromEvent(tx, family.id, event.eventId)) !== null) {
      deps.logger.info("ask_duplicate", { familyId: family.id });
      return;
    }

    const taken =
      input.date === null ? null : await exchangeForLocalDate(tx, recipient.id, input.date);
    const queued = taken !== null;
    const whenRule: WhenRule = input.date === null || queued ? "whenever" : "tomorrow";
    const scheduledFor = whenRule === "whenever" ? null : input.date;
    const mediaIds: string[] = [];
    for (const ref of content.media) {
      const file = await recordInboundMedia(tx, event.channel, {
        familyId: family.id,
        uploadedBy: sender.id,
        ref,
        now,
      });
      if (file !== null && !mediaIds.includes(file.id)) {
        mediaIds.push(file.id);
      }
    }
    const options: AskOptions = {
      inbound_event_ids: [event.eventId],
      ...(mediaGroupId === undefined ? {} : { media_group_id: mediaGroupId }),
    };
    const [exchange] = await tx
      .insert(exchanges)
      .values({
        familyId: family.id,
        recipientId: recipient.id,
        askerId: sender.id,
        type: content.type,
        state: "composed",
        text: content.text,
        textLang: sender.language,
        options,
        mediaIds,
        whenRule,
        scheduledFor,
        createdAt: now,
      })
      .returning();
    if (exchange === undefined) {
      throw new Error("exchange insert returned no row");
    }
    if (input.date !== null) {
      await tx
        .update(turns)
        .set({ actedAt: now })
        .where(
          and(
            eq(turns.familyId, family.id),
            eq(turns.localDay, input.date),
            eq(turns.recipientId, recipient.id),
            isNull(turns.actedAt),
          ),
        );
    }
    await recordEvent(
      tx,
      {
        name: "ask_composed",
        familyId: family.id,
        memberId: sender.id,
        exchangeId: exchange.id,
        surface: event.channel,
        props: {
          type: content.type,
          when_rule: whenRule,
          source: input.source,
          media: mediaIds.length,
          queued,
        },
      },
      now,
    );
    const lang = family.language;
    const text = queued
      ? t(lang, "group.ask_queued", { asker: await holderOfDate(tx, taken) })
      : t(lang, "group.ask_confirmed", { name: recipient.displayName });
    await enqueueOutbound(deps, tx, {
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: event.conversation.externalId,
        suffix: `ask:${event.eventId}`,
      }),
      memberId: sender.id,
      channel: event.channel,
      conversationId: event.conversation.externalId,
      exchangeId: exchange.id,
      lang,
      text,
      replyToMessageId: event.messageId,
      ref: { purpose: "ask_confirmation", exchangeId: exchange.id },
    });
  });
}

/** The family, the kept-light member, and the sender, when all three still belong together. */
async function loadAskContext(
  deps: Deps,
  familyId: string,
  recipientId: string,
  senderId: string,
): Promise<{ family: Family; recipient: Member; sender: Member } | null> {
  if (await familyHasEnded(deps.db, familyId)) {
    deps.logger.info("ask_ignored", { familyId, reason: "family_ended" });
    return null;
  }
  const family = await familyById(deps.db, familyId);
  const recipient = await memberById(deps.db, recipientId);
  const sender = await memberById(deps.db, senderId);
  if (
    family === null ||
    recipient === null ||
    sender === null ||
    recipient.familyId !== familyId ||
    sender.familyId !== familyId
  ) {
    deps.logger.warn("ask_context_missing", { familyId });
    return null;
  }
  return { family, recipient, sender };
}

/**
 * A reply to a turn prompt (flows §3.5): the prompt's recipient and date come from its message ref.
 * Ignored, with nothing stored or sent, once the family has ended.
 */
export async function handleGroupAsk(
  deps: Deps,
  event: InboundEvent,
  target: AskTarget,
): Promise<void> {
  if (event.conversation.kind !== "group") {
    return;
  }
  const ctx = await loadAskContext(deps, target.familyId, target.recipientId, target.senderId);
  if (ctx === null) {
    return;
  }
  const content = readAskContent(event, event.text?.trim() ?? "");
  if (content === null) {
    deps.logger.info("ask_ignored", { familyId: target.familyId, reason: "no_content" });
    return;
  }
  await composeAsk(deps, event, { ...ctx, date: target.date, content, source: "reply" });
}

/**
 * `/ask <text>` for tomorrow (her local date) and `/later <text>` for whenever (flows §3.5), in a
 * linked group, with the command in the text or in a photo's or voice note's caption.
 */
export async function handleAskCommand(
  deps: Deps,
  event: InboundEvent,
  familyId: string,
  senderId: string,
): Promise<void> {
  if (event.conversation.kind !== "group") {
    return;
  }
  const command = parseAskCommand(event.text, deps.config.telegramBotUsername);
  if (command === null) {
    return;
  }
  const recipient = await keptLightMemberOfFamily(deps.db, familyId);
  if (recipient === null) {
    deps.logger.warn("ask_context_missing", { familyId });
    return;
  }
  const ctx = await loadAskContext(deps, familyId, recipient.id, senderId);
  if (ctx === null) {
    return;
  }
  const content = readAskContent(event, command.text);
  if (content === null) {
    deps.logger.info("ask_ignored", { familyId, reason: "no_content" });
    return;
  }
  const date =
    command.command === "ask" ? addDays(localDateOf(deps.clock.now(), recipient.tz), 1) : null;
  await composeAsk(deps, event, { ...ctx, date, content, source: command.command });
}
