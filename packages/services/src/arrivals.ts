/**
 * Her morning and the evening before it (flows §3.4, §3.6, §3.7, §3.8): preparing the day's
 * exchange, delivering the arrival with yesterday's replies read back, the repeat, and the turn
 * prompt to the family group. Every function is safe to run twice: the exchange is unique per day,
 * the outbound rows are keyed by member and date, and the turn is keyed by the day.
 */
import { isAiOff } from "@vela/ai";
import type { Channel, LocalDate, OutboundMediaRef } from "@vela/contracts";
import { t } from "@vela/copy";
import {
  type ArrivalAsk,
  addDays,
  arrivalWindowEnd,
  localDateOf,
  nextExchangeState,
  nextTurnHolder,
  outboundKey,
  renderArrival,
  selectAsk,
  summariseReplies,
  type TurnHolder,
  zonedInstant,
} from "@vela/core";
import {
  answers,
  type ChannelLink,
  chips,
  type Exchange,
  exchanges,
  type Family,
  type Media,
  type Member,
  media,
  members,
  outbound,
  replies,
  turns,
  type VelaTransaction,
} from "@vela/db";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { Deps } from "./deps.ts";
import { errorLabel, VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import {
  enqueueOutbound,
  handOverOutbound,
  type InsertResult,
  insertOutbound,
  type OutboundRequest,
} from "./gateway.ts";
import { recordAiCall } from "./jobs.ts";
import { storedCopyOf } from "./media-copy.ts";
import { readsStoredMedia, uploadsStoredMedia } from "./outbound-media.ts";
import { ordinaryPushReader, turnPromptPush } from "./push-messages.ts";
import {
  channelLinkOfMember,
  exchangeForLocalDate,
  familyById,
  linkedGroupOfFamily,
  memberById,
  type Queryable,
} from "./repo.ts";

/** The pilot's kept-light members and families are reached on Telegram. */
export const ARRIVAL_CHANNEL: Channel = "telegram";

/**
 * The channel her mornings reach her on: her phone where an organiser set it up for the parent
 * surface (ADR-35), else Telegram. The family group stays on `ARRIVAL_CHANNEL`.
 */
export function arrivalChannelOf(member: Pick<Member, "primarySurface">): Channel {
  return member.primarySurface === "parent-surface" ? "device" : ARRIVAL_CHANNEL;
}

/** `OutboundMessage.media` allows at most ten items. */
const MAX_MEDIA = 10;

/** `ChipsInput.pastAnswers` takes at most twenty of her recent answers. */
const PAST_ANSWERS = 20;

/** The part of `exchanges.options` the arrival reads: a vote's options, when the ask is a vote. */
const ExchangeOptions = z.object({ vote_options: z.array(z.string()).optional() }).loose();

// preparing ------------------------------------------------------------------------------------

interface Prepared {
  exchange: Exchange;
  /** True when this call settled the exchange, so the chips are drafted once. */
  fresh: boolean;
}

/**
 * Settles what the morning of `date` carries, in one transaction under her member row's lock so
 * two ticks cannot both claim a whenever ask: a composed exchange for the date, else an ask whose
 * own morning passed unsent, else the oldest whenever ask, else a hello. Returns the exchange's id.
 * A day already prepared is left as it is.
 */
export async function prepareDay(deps: Deps, memberId: string, date: LocalDate): Promise<string> {
  const now = deps.clock.now();
  const prepared = await deps.db.transaction(async (tx): Promise<Prepared> => {
    const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
    if (member === undefined) {
      throw new VelaError("not_found", `member ${memberId} does not exist`);
    }
    const existing = await exchangeForLocalDate(tx, memberId, date);
    if (existing !== null && existing.state !== "composed") {
      return { exchange: existing, fresh: false };
    }
    const candidates = (await askCandidates(tx, memberId, date)).filter(
      (candidate) =>
        candidate.scheduledFor === null ||
        candidate.scheduledFor >= date ||
        now.getTime() >=
          arrivalWindowEnd(candidate.scheduledFor, member.arrivalTime, member.tz).getTime(),
    );
    // The pilot has no story day (flows §3.6): the choice is the date's ask, an ask its own morning
    // left, a whenever ask, or the hello.
    const selection = selectAsk({
      date,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        whenRule: candidate.whenRule,
        scheduledFor: candidate.scheduledFor,
        createdAt: candidate.createdAt,
        state: candidate.state,
      })),
      isStoryDay: false,
      storyQuestionAvailable: false,
    });
    const chosen =
      "exchangeId" in selection
        ? candidates.find((candidate) => candidate.id === selection.exchangeId)
        : undefined;
    const exchange = await settle(tx, member, date, chosen, now);
    await recordEvent(
      tx,
      {
        name: "exchange_prepared",
        familyId: member.familyId,
        memberId,
        exchangeId: exchange.id,
        props: { date, type: exchange.type, source: selection.source },
      },
      now,
    );
    return { exchange, fresh: true };
  });
  if (prepared.fresh && prepared.exchange.type === "question") {
    await draftChips(deps, prepared.exchange);
  }
  return prepared.exchange.id;
}

/**
 * Her asks a morning may take: composed ones, and one already scheduled for a morning before `date`
 * that passed unsent, which is carried (flows §3.6). A hello left by a skipped morning is not an
 * ask. An ask whose delivery failed, or whose arrival is queued, sent, or failed, may be on her
 * phone or about to be, so carrying it could send it twice; only an arrival the gateway dropped
 * unsent leaves it free. The caller still drops a passed morning whose window is open.
 */
async function askCandidates(
  tx: VelaTransaction,
  memberId: string,
  date: LocalDate,
): Promise<Exchange[]> {
  const arrivalNotDropped = tx
    .select({ id: outbound.id })
    .from(outbound)
    .where(
      and(
        eq(outbound.exchangeId, exchanges.id),
        eq(outbound.kind, "arrival"),
        ne(outbound.status, "dropped"),
      ),
    );
  return tx
    .select()
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, memberId),
        or(
          eq(exchanges.state, "composed"),
          and(
            eq(exchanges.state, "scheduled"),
            lt(exchanges.scheduledFor, date),
            ne(exchanges.type, "hello"),
          ),
        ),
        isNull(exchanges.deliveredAt),
        isNull(exchanges.deliveryFailedAt),
        notExists(arrivalNotDropped),
      ),
    );
}

async function settle(
  tx: VelaTransaction,
  member: Member,
  date: LocalDate,
  chosen: Exchange | undefined,
  now: Date,
): Promise<Exchange> {
  if (chosen !== undefined) {
    const [row] = await tx
      .update(exchanges)
      .set({ state: nextExchangeState(chosen.state, "schedule"), scheduledFor: date })
      .where(eq(exchanges.id, chosen.id))
      .returning();
    if (row === undefined) {
      throw new VelaError("not_found", `exchange ${chosen.id} vanished while preparing`);
    }
    return row;
  }
  const [hello] = await tx
    .insert(exchanges)
    .values({
      familyId: member.familyId,
      recipientId: member.id,
      askerId: null,
      type: "hello",
      state: "scheduled",
      text: null,
      textLang: member.language,
      whenRule: "date",
      scheduledFor: date,
      createdAt: now,
    })
    .returning();
  if (hello === undefined) {
    throw new VelaError("illegal_state", `no hello could be created for ${date}`);
  }
  return hello;
}

/**
 * Her recent answers in her own words, newest first, for the chips prompt: what she said, else what
 * she wrote, else the summary of what she tapped. Every name comes from the schema, so a renamed
 * column cannot quietly break this query, whose failure only leaves the chips undrafted.
 */
async function recentAnswerTexts(db: Queryable, memberId: string): Promise<string[]> {
  const rows = await db
    .select({
      text: sql<string | null>`coalesce(
        ${answers.transcript}, ${answers.payload} ->> 'text', ${answers.summary}
      )`,
    })
    .from(answers)
    .where(eq(answers.memberId, memberId))
    .orderBy(desc(answers.receivedAt), desc(answers.id))
    .limit(PAST_ANSWERS);
  return rows.flatMap((row) => {
    const text = row.text?.trim() ?? "";
    return text.length === 0 ? [] : [text];
  });
}

/**
 * Three chips for a question, drafted once when the day is prepared. Nothing here may stop the
 * ask: a failed or refused call is logged and the arrival goes out without chips (flows §3.6). A
 * carried ask keeps the chips drafted for the morning that passed, so the model is asked once.
 */
async function draftChips(deps: Deps, exchange: Exchange): Promise<void> {
  const question = exchange.text?.trim() ?? "";
  if (question.length === 0) {
    return;
  }
  try {
    const [drafted] = await deps.db
      .select({ exchangeId: chips.exchangeId })
      .from(chips)
      .where(eq(chips.exchangeId, exchange.id))
      .limit(1);
    if (drafted !== undefined) {
      return;
    }
    const member = await memberById(deps.db, exchange.recipientId);
    const family = member === null ? null : await familyById(deps.db, member.familyId);
    const asker = exchange.askerId === null ? null : await memberById(deps.db, exchange.askerId);
    if (member === null || family === null) {
      return;
    }
    const outcome = await deps.ai.chips({
      lang: member.language,
      askerName: asker?.displayName ?? family.name,
      question,
      pastAnswers: await recentAnswerTexts(deps.db, member.id),
    });
    if (isAiOff(outcome)) {
      // No call was made, so none is logged, and the question goes out without chips, as it does
      // after a failed call.
      return;
    }
    await recordAiCall(deps.db, {
      familyId: family.id,
      memberId: member.id,
      record: outcome.record,
      inputRef: { exchange_id: exchange.id },
      output: outcome.value,
      at: deps.clock.now(),
    });
    if (!outcome.ok) {
      deps.logger.warn("chips_failed", { exchangeId: exchange.id, error: outcome.error });
      return;
    }
    await deps.db
      .insert(chips)
      .values({
        exchangeId: exchange.id,
        chips: outcome.value.chips,
        promptVersion: outcome.record.promptVersion,
        createdAt: deps.clock.now(),
      })
      .onConflictDoNothing();
  } catch (error) {
    deps.logger.error("chips_failed", {
      exchangeId: exchange.id,
      error: errorLabel(error),
    });
  }
}

// delivering -------------------------------------------------------------------------------------

interface ArrivalContext {
  member: Member;
  family: Family;
  link: ChannelLink;
  exchange: Exchange;
}

async function loadArrivalContext(deps: Deps, exchangeId: string): Promise<ArrivalContext> {
  const [exchange] = await deps.db.select().from(exchanges).where(eq(exchanges.id, exchangeId));
  const member = exchange === undefined ? null : await memberById(deps.db, exchange.recipientId);
  const family = member === null ? null : await familyById(deps.db, member.familyId);
  if (exchange === undefined || member === null || family === null) {
    throw new VelaError("not_found", `exchange ${exchangeId} has no member or family`);
  }
  const channel = arrivalChannelOf(member);
  const link = await channelLinkOfMember(deps.db, member.id, channel);
  if (link === null) {
    throw new VelaError("no_channel_link", `member ${member.id} has no ${channel} link`);
  }
  return { member, family, link, exchange };
}

/**
 * The media rows behind ids, in the ids' order, and only ever this family's. `exchanges.media_ids`
 * is a bare `uuid[]` that no foreign key covers (schema, exchanges), so this predicate is the only
 * thing standing between one family's photo and another family's morning. It is the recipient's
 * family rather than `exchanges.family_id`, because what has to be true is that she sees nothing
 * but her own family's files, whatever the exchange row claims. An id this family does not own is
 * dropped rather than refused, as a photo choice without two images is downgraded rather than
 * refused: her morning still goes out.
 *
 * Nothing on today's inbound path can write such an id — media arrives through
 * `recordInboundMedia`, which sets the family — so a drop is never routine, and is always logged.
 */
async function mediaByIds(deps: Deps, familyId: string, ids: readonly string[]): Promise<Media[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await deps.db
    .select()
    .from(media)
    .where(and(eq(media.familyId, familyId), inArray(media.id, [...ids])));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const dropped = ids.filter((id) => !byId.has(id));
  if (dropped.length > 0) {
    await logDroppedMedia(deps, familyId, dropped);
  }
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [row];
  });
}

/**
 * Why ids were dropped, for the log alone. An id that exists in another family is an integrity
 * failure — something wrote an exchange across families — and is logged as an error with the ids to
 * chase it; an id that exists nowhere is the ordinary end of a file retention has already cleared.
 * This reads ids and nothing else, and hands no row back to the caller.
 */
async function logDroppedMedia(
  deps: Deps,
  familyId: string,
  dropped: readonly string[],
): Promise<void> {
  const elsewhere = await deps.db
    .select({ id: media.id })
    .from(media)
    .where(inArray(media.id, [...dropped]));
  if (elsewhere.length > 0) {
    deps.logger.error("media_outside_family", {
      familyId,
      mediaIds: elsewhere.map((row) => row.id),
    });
  }
  const absent = dropped.length - elsewhere.length;
  if (absent > 0) {
    deps.logger.warn("ask_media_missing", { familyId, count: absent });
  }
}

/**
 * How a message names a file. One the platform holds goes by its own file id, which Telegram sends
 * again without an upload. An image only Vela keeps, a photo the app uploaded (ADR-33), goes by its
 * storage key: the gateway loads its bytes on each attempt and the adapter uploads them. One whose
 * object is gone, or that nothing can reach while storage is off, is null and left out, so a photo
 * choice short of two is turned into a question before her text and buttons are drawn, never sent
 * with 1 and 2 under one photo. `byStorage` names every image and voice note by its storage key,
 * for her phone. A store that cannot answer throws, and her morning is tried again,
 * rather than sent without a photo that is there.
 */
async function mediaRefOf(
  deps: Deps,
  row: Media,
  byStorage = false,
): Promise<OutboundMediaRef | null> {
  if (row.providerFileId !== null && !byStorage) {
    return { kind: row.kind, providerFileId: row.providerFileId };
  }
  if (row.storageKey === null || deps.media === null) {
    return null;
  }
  const object = await deps.media.head(row.storageKey);
  if (object === null) {
    return null;
  }
  return {
    kind: row.kind,
    storageKey: row.storageKey,
    mime: row.mime ?? object.mime,
    bytes: object.bytes,
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
  };
}

/**
 * The files behind rows, in their order, for a message on `channel`, leaving out any that cannot be
 * sent, which is logged. A file only Vela keeps goes only where the adapter uploads its bytes
 * (`uploadsStoredMedia`); on any other channel it is left out as a missing one is, and logged with
 * the channel, so a photo choice becomes a question there rather than a send the adapter refuses.
 * Her phone (`readsStoredMedia`) is sent every file by its stored key, a file Telegram holds copied
 * into the store first (`storedCopyOf`); one that cannot be copied is left out as a missing one is.
 */
async function mediaRefsOf(
  deps: Deps,
  familyId: string,
  channel: Channel,
  rows: readonly Media[],
): Promise<OutboundMediaRef[]> {
  const refs: OutboundMediaRef[] = [];
  let offChannel = 0;
  const byStorage = readsStoredMedia(channel);
  for (const original of rows) {
    // Her phone opens only files Vela keeps, so a file Telegram holds is copied first.
    const row = byStorage ? await storedCopyOf(deps, original) : original;
    if (row === null) continue;
    if (
      !byStorage &&
      row.providerFileId === null &&
      row.storageKey !== null &&
      !uploadsStoredMedia(channel)
    ) {
      offChannel += 1;
      continue;
    }
    const ref = await mediaRefOf(deps, row, byStorage);
    if (ref !== null) {
      refs.push(ref);
    }
  }
  if (offChannel > 0) {
    deps.logger.warn("media_not_sendable_on_channel", { familyId, channel, count: offChannel });
  }
  const missing = rows.length - refs.length - offChannel;
  if (missing > 0) {
    deps.logger.warn("media_not_sendable", { familyId, count: missing });
  }
  return refs;
}

interface LoadedAsk {
  ask: ArrivalAsk;
  media: OutboundMediaRef[];
}

/** The morning an ask is loaded for: its local date and her zone. */
export interface AskMorning {
  date: LocalDate;
  timeZone: string;
}

/**
 * The rows that last while her pick on this morning is still read: to the end of the day after
 * it, in her zone, the deadline compose checks against the morning an ask is written for
 * (`lockAskPhotos` in `api-asks.ts`). A carried ask, or a group photo that waited, can reach a
 * morning after which retention deletes an image before she taps, so such an image is left out as
 * one already gone, and logged. A kept image, or one with no deletion date, lasts; so does a voice.
 */
function lastingRows(
  deps: Deps,
  ids: { familyId: string; exchangeId: string },
  morning: AskMorning,
  rows: readonly Media[],
): Media[] {
  const until = zonedInstant(addDays(morning.date, 2), "00:00", morning.timeZone).getTime();
  const lasting = rows.filter(
    (row) =>
      row.kind !== "image" || row.kept || row.expiresAt === null || row.expiresAt.getTime() > until,
  );
  const expiring = rows.length - lasting.length;
  if (expiring > 0) {
    deps.logger.warn("ask_media_expiring", { ...ids, count: expiring });
  }
  return lasting;
}

/**
 * The ask as `renderArrival` takes it, with the files to attach on `channel`, for `morning`. A photo
 * choice needs exactly two images (spec §4.4, core's rendering contract); with any other number it
 * goes out as a question carrying the first image, so a family's morning is never refused for a
 * missing photo, nor for photos her channel cannot be sent. An image deleted before her pick on
 * this morning can no longer be read counts as missing (`lastingRows`), so her "1" and "2" are never
 * drawn over a photo that can vanish before she taps. The arrival and its repeat load it for the
 * same morning, so both send the same photos. Exported for the tests alone: an arrival goes by her
 * own channel (`arrivalChannelOf`), Telegram or her phone, so only a test asks for LINE's.
 *
 * `exchanges.voice_hello_id` is not read here. It is a write-only column today: nothing loads it,
 * and `ArrivalAsk` has no slot for it, so no voice hello reaches anyone. Whoever gives it a slot
 * has to scope it the way `mediaByIds` is scoped above — its foreign key reaches `media.id` in
 * any family — and that belongs with the change that delivers it, not before.
 */
export async function loadAsk(
  deps: Deps,
  family: Family,
  exchange: Exchange,
  channel: Channel,
  morning: AskMorning,
): Promise<LoadedAsk> {
  if (exchange.type === "hello") {
    return { ask: { type: "hello" }, media: [] };
  }
  const asker = exchange.askerId === null ? null : await memberById(deps.db, exchange.askerId);
  const rows = lastingRows(
    deps,
    { familyId: family.id, exchangeId: exchange.id },
    morning,
    await mediaByIds(deps, family.id, exchange.mediaIds),
  );
  const files = await mediaRefsOf(deps, family.id, channel, rows);
  const images = files.filter((file) => file.kind === "image");
  let type = exchange.type;
  let attached = files;
  if (type === "photo_choice" && images.length !== 2) {
    deps.logger.warn("photo_choice_without_two_images", {
      exchangeId: exchange.id,
      images: images.length,
    });
    type = "question";
    attached = images.slice(0, 1);
  } else if (type === "photo_choice") {
    attached = images;
  }
  const [chipRow] =
    type === "question"
      ? await deps.db.select().from(chips).where(eq(chips.exchangeId, exchange.id)).limit(1)
      : [];
  const options = ExchangeOptions.safeParse(exchange.options);
  return {
    ask: {
      type,
      askerName: asker?.displayName ?? family.name,
      onBehalfOf: exchange.onBehalfOf,
      text: exchange.text,
      chips: chipRow?.chips ?? [],
      voteOptions: type === "vote" && options.success ? (options.data.vote_options ?? []) : [],
      imageCount: attached.filter((file) => file.kind === "image").length,
    },
    media: attached,
  };
}

interface ReadBack {
  lines: string[];
  media: OutboundMediaRef[];
  replyIds: string[];
  previousExchangeId: string | null;
}

/**
 * Yesterday's replies (spec §6.3, flows §3.7): the previous delivered exchange's replies to her that
 * were not read back yet, as lines in her language, with the family's voice replies as files.
 */
async function loadReadBack(
  deps: Deps,
  member: Member,
  date: LocalDate,
  channel: Channel,
): Promise<ReadBack> {
  const none: ReadBack = { lines: [], media: [], replyIds: [], previousExchangeId: null };
  const [previous] = await deps.db
    .select()
    .from(exchanges)
    .where(
      and(
        eq(exchanges.recipientId, member.id),
        lt(exchanges.scheduledFor, date),
        isNotNull(exchanges.deliveredAt),
        ne(exchanges.state, "withdrawn"),
      ),
    )
    .orderBy(desc(exchanges.scheduledFor))
    .limit(1);
  if (previous === undefined) {
    return none;
  }
  const rows = await deps.db
    .select({ reply: replies, name: members.displayName })
    .from(replies)
    .innerJoin(members, eq(members.id, replies.memberId))
    .where(
      and(
        eq(replies.exchangeId, previous.id),
        eq(replies.toRecipient, true),
        isNull(replies.readBackAt),
      ),
    )
    .orderBy(asc(replies.createdAt), asc(replies.id));
  if (rows.length === 0) {
    return none;
  }
  const voiceIds = rows.flatMap((row) =>
    row.reply.kind === "voice" && row.reply.mediaId !== null ? [row.reply.mediaId] : [],
  );
  const voices = await mediaRefsOf(
    deps,
    member.familyId,
    channel,
    await mediaByIds(deps, member.familyId, voiceIds),
  );
  return {
    lines: summariseReplies({
      lang: member.language,
      replies: rows.map((row) => ({ name: row.name, kind: row.reply.kind, text: row.reply.text })),
    }),
    media: voices,
    replyIds: rows.map((row) => row.reply.id),
    previousExchangeId: previous.id,
  };
}

/**
 * Whether her morning's row, named by `key`, is already written and not dropped. Read with her member
 * row held, before the insert: the insert would find such a row at its key and wait there for any
 * transaction changing it, and the effects of its send change it and then write her member row, a
 * cycle PostgreSQL breaks by aborting one of them (code design §8). This read waits for nothing, and
 * with her member row held no other queueing can be writing the row. A row her pause dropped is left
 * to the insert, which queues it again (`insertOutbound`): only a queueing, under this same lock,
 * ever changes a dropped row, so the insert finds nothing there to wait for.
 */
async function arrivalWritten(tx: VelaTransaction, key: string): Promise<boolean> {
  const [row] = await tx
    .select({ status: outbound.status })
    .from(outbound)
    .where(eq(outbound.idempotencyKey, key));
  return row !== undefined && row.status !== "dropped";
}

/**
 * Enqueues her arrival for `date`, preparing the day first if nothing was (flows §3.7). The read-back
 * voices come before the ask's own files, as the read-back lines come before the ask in the text.
 * The ask's files are kept whole within the message's ten, and the voices take what is left: a
 * photo choice's buttons are drawn for both its photos, so neither may be cut.
 * A day already delivered, or whose delivery failed, is left alone.
 *
 * The row is written under her member row's lock, the one `prepareDay` takes, once the ask is read
 * again still dated `date`. Preparing a later morning carries an ask that has no arrival row once
 * its window has closed (flows §3.6), and a tick that decided before 22:00 that this morning is due
 * can reach its queueing after the 22:00 tick has prepared tomorrow: queued anyway, the ask would go
 * out tonight and tomorrow's morning would find it delivered. Under the lock, whichever comes second
 * sees what the first wrote: the arrival row, and the ask stays, or the ask moved, and this morning,
 * whose window has closed, sends nothing, as any morning whose window closed.
 *
 * A morning whose row is already written is not inserted again (`arrivalWritten`), so the insert
 * never waits at the row's key while this holds her member row.
 */
export async function deliverArrival(
  deps: Deps,
  memberId: string,
  date: LocalDate,
  late: boolean,
): Promise<void> {
  const exchangeId = await prepareDay(deps, memberId, date);
  const { member, family, link, exchange } = await loadArrivalContext(deps, exchangeId);
  if (exchange.deliveredAt !== null || exchange.deliveryFailedAt !== null) {
    deps.logger.info("arrival_already_out", { memberId, date });
    return;
  }
  const readBack = await loadReadBack(deps, member, date, link.channel);
  const { ask, media: askMedia } = await loadAsk(deps, family, exchange, link.channel, {
    date,
    timeZone: member.tz,
  });
  const rendered = renderArrival({
    lang: member.language,
    address: member.addressForm ?? member.displayName,
    exchangeId: exchange.id,
    ask,
    readBack: readBack.lines,
    late,
    repeat: false,
  });
  const askFiles = askMedia.slice(0, MAX_MEDIA);
  const attached = [...readBack.media.slice(0, MAX_MEDIA - askFiles.length), ...askFiles];
  const request: OutboundRequest = {
    kind: "arrival",
    idempotencyKey: outboundKey("arrival", { memberId, date }),
    memberId,
    channel: link.channel,
    conversationId: link.externalId,
    localDay: date,
    exchangeId: exchange.id,
    lang: member.language,
    text: rendered.text,
    buttons: rendered.buttons,
    media: attached.length === 0 ? undefined : attached,
    ref: { purpose: "arrival", exchangeId: exchange.id },
    effect: {
      exchangeId: exchange.id,
      late,
      readBackReplyIds: readBack.replyIds,
      previousExchangeId: readBack.previousExchangeId,
    },
  };
  const written = await deps.db.transaction(async (tx): Promise<InsertResult | null> => {
    await tx.select({ id: members.id }).from(members).where(eq(members.id, memberId)).for("update");
    const [current] = await tx
      .select({ scheduledFor: exchanges.scheduledFor })
      .from(exchanges)
      .where(eq(exchanges.id, exchange.id));
    if (current === undefined) {
      throw new VelaError("not_found", `exchange ${exchange.id} vanished before its arrival`);
    }
    if (current.scheduledFor !== date) {
      deps.logger.info("arrival_carried", { memberId, date, exchangeId: exchange.id });
      return null;
    }
    if (await arrivalWritten(tx, request.idempotencyKey)) {
      return { duplicate: true };
    }
    return insertOutbound(deps, tx, request);
  });
  // Handed to the queue after the commit, as `enqueueOutbound` hands a row over after its insert, so
  // her member row is not held across the queue's send.
  if (written !== null) {
    await handOverOutbound(deps, request, written);
  }
}

/**
 * Re-sends the morning once, "in case you missed it", without the read-back (flows §3.8). Nothing
 * goes out for a day that was not delivered, failed, was answered meanwhile, or was repeated already.
 * This reads the day before the enqueue, so the gateway checks the answer again before the send.
 */
export async function sendRepeat(deps: Deps, memberId: string, date: LocalDate): Promise<void> {
  const exchange = await exchangeForLocalDate(deps.db, memberId, date);
  if (
    exchange === null ||
    exchange.deliveredAt === null ||
    exchange.deliveryFailedAt !== null ||
    exchange.answeredAt !== null ||
    exchange.repeatedAt !== null
  ) {
    deps.logger.info("repeat_skipped", { memberId, date });
    return;
  }
  const { member, family, link } = await loadArrivalContext(deps, exchange.id);
  const { ask, media: askMedia } = await loadAsk(deps, family, exchange, link.channel, {
    date,
    timeZone: member.tz,
  });
  const rendered = renderArrival({
    lang: member.language,
    address: member.addressForm ?? member.displayName,
    exchangeId: exchange.id,
    ask,
    readBack: [],
    late: false,
    repeat: true,
  });
  await enqueueOutbound(deps, deps.db, {
    kind: "repeat",
    idempotencyKey: outboundKey("repeat", { memberId, date }),
    memberId,
    channel: link.channel,
    conversationId: link.externalId,
    localDay: date,
    exchangeId: exchange.id,
    lang: member.language,
    text: rendered.text,
    buttons: rendered.buttons,
    media: askMedia.length === 0 ? undefined : askMedia,
    ref: { purpose: "repeat", exchangeId: exchange.id },
    effect: { exchangeId: exchange.id },
  });
}

// the turn prompt ----------------------------------------------------------------------------------

/** The family's turn holders: active members who take turns and are not kept-light members. */
async function turnHolders(db: Queryable, familyId: string): Promise<TurnHolder[]> {
  const rows = await db
    .select({ id: members.id, createdAt: members.createdAt })
    .from(members)
    .where(
      and(
        eq(members.familyId, familyId),
        eq(members.status, "active"),
        eq(members.turnsIn, true),
        eq(members.lightOn, false),
        isNull(members.lightConsentedAt),
      ),
    )
    .orderBy(asc(members.createdAt), asc(members.id));
  return rows.map((row) => ({ memberId: row.id, joinedAt: row.createdAt }));
}

/**
 * The evening prompt for `forDate`'s ask (flows §3.4). With no linked group the turn is recorded
 * with the first organiser as holder (turns do not rotate there), so the schedule does not ask
 * again, and nothing is posted: the holder's phones hear it instead when push is on (ADR-34); otherwise
 * the next holder in join order is named in the group, or anyone is invited when nobody holds turns.
 * The turn row and the outbound row are written together, so a repeated call finds the turn taken.
 */
export async function sendTurnPrompt(
  deps: Deps,
  recipientId: string,
  forDate: LocalDate,
): Promise<void> {
  const now = deps.clock.now();
  const recipient = await memberById(deps.db, recipientId);
  const family = recipient === null ? null : await familyById(deps.db, recipient.familyId);
  if (recipient === null || family === null || family.deletedAt !== null) {
    deps.logger.warn("turn_prompt_context_missing", { recipientId, forDate });
    return;
  }
  const group = await linkedGroupOfFamily(deps.db, family.id, ARRIVAL_CHANNEL);
  const holders = await turnHolders(deps.db, family.id);
  const [previous] = await deps.db
    .select({ holderId: turns.holderId })
    .from(turns)
    .where(
      and(
        eq(turns.familyId, family.id),
        eq(turns.recipientId, recipientId),
        lt(turns.localDay, forDate),
      ),
    )
    .orderBy(desc(turns.localDay))
    .limit(1);
  const previousHolderId = previous?.holderId ?? null;
  // A previous holder who left keeps their place in the order through when they joined, so nobody
  // behind them loses a turn (core's `nextTurnHolder`).
  const previousStillHolds = holders.some((holder) => holder.memberId === previousHolderId);
  const previousJoinedAt =
    previousHolderId !== null && !previousStillHolds
      ? ((await memberById(deps.db, previousHolderId))?.createdAt ?? null)
      : null;

  await deps.db.transaction(async (tx) => {
    if (group === null) {
      const [organiser] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.familyId, family.id),
            eq(members.role, "organiser"),
            eq(members.status, "active"),
          ),
        )
        .orderBy(asc(members.createdAt), asc(members.id))
        .limit(1);
      const [taken] = await tx
        .insert(turns)
        .values({
          familyId: family.id,
          localDay: forDate,
          recipientId,
          holderId: organiser?.id ?? null,
          promptedAt: now,
        })
        .onConflictDoNothing()
        .returning({ recipientId: turns.recipientId });
      deps.logger.info("turn_prompt_without_group", { recipientId, forDate });
      // Push (ADR-34, S6): the holder hears it on their phone instead, once, when this call took
      // the turn, and while push is on. It fires at her 19:00, as the group's prompt does.
      if (taken !== undefined && organiser !== undefined && deps.push !== null) {
        const holder = await ordinaryPushReader(tx, organiser.id);
        if (holder !== null) {
          await enqueueOutbound(
            deps,
            tx,
            turnPromptPush({
              holder,
              familyId: family.id,
              recipientId,
              herName: recipient.displayName,
              forDate,
            }),
          );
        }
      }
      return;
    }
    const holderId = nextTurnHolder(holders, previousHolderId, previousJoinedAt);
    const [turn] = await tx
      .insert(turns)
      .values({ familyId: family.id, localDay: forDate, recipientId, holderId })
      .onConflictDoNothing()
      .returning({ recipientId: turns.recipientId });
    if (turn === undefined) {
      return;
    }
    const holder = holderId === null ? null : await memberById(tx, holderId);
    const name = recipient.displayName;
    const text =
      holder === null
        ? t(family.language, "group.turn_prompt_open", { name })
        : t(family.language, "group.turn_prompt", { holder: holder.displayName, name });
    const rowMember = holder ?? recipient;
    await enqueueOutbound(deps, tx, {
      kind: "turn_prompt",
      idempotencyKey: outboundKey("turn_prompt", { memberId: recipientId, date: forDate }),
      memberId: rowMember.id,
      channel: group.channel,
      conversationId: group.conversationId,
      localDay: localDateOf(now, rowMember.tz),
      lang: family.language,
      text,
      ref: { purpose: "turn_prompt", memberId: recipientId, localDate: forDate },
      effect: { familyId: family.id, recipientId, localDay: forDate },
    });
  });
}
