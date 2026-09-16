/**
 * Understanding her answer (spec §5.2, flows §3.10): the voice is fetched, stored, and transcribed
 * in her language; the words go to `ai.understand` and `ai.flag`, are translated into the family's
 * language when it differs, and reach the group as a reply to the answer post; the summary line is
 * translated into her language when it differs; a flag reaches the organisers with her words and
 * the founder with a link and no words; a detected away sets a period and is confirmed to her once.
 *
 * Every step is keyed per answer, so `reconcile`'s re-runs never repeat a post, a translation, a
 * notice, or an away. Both jobs count an attempt when they start work on an answer (a redelivered
 * job for a voice already transcribed or an answer already understood does nothing); the attempt
 * that ends without a transcript or without `understood_at` at three or more tells the founder once
 * (flows §3.15). Provider failures never throw: the light is long since on, and the queue must not
 * retry them.
 */
import {
  type AiCallRecord,
  type FlagResult,
  type Understanding,
  WEEKDAYS,
  type Weekday,
} from "@vela/ai";
import {
  type AnswerKind,
  ChannelSendError,
  type FetchedMedia,
  type Lang,
  type LocalDate,
} from "@vela/contracts";
import { t } from "@vela/copy";
import { localDateOf, outboundKey, weekdayOf } from "@vela/core";
import {
  type Answer,
  aiCalls,
  answers,
  awayPeriods,
  type Exchange,
  exchanges,
  type Family,
  families,
  type Media,
  type Member,
  media,
  members,
  outbound,
  translations,
} from "@vela/db";
import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { ADMIN_CHANNEL, ADMIN_LANG, adminLink } from "./admin.ts";
import type { Deps } from "./deps.ts";
import { errorLabel } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { fitMessageText, formatAwayDate } from "./format.ts";
import { enqueueOutbound } from "./gateway.ts";
import {
  activeOrganisersWithLinks,
  channelLinkOfMember,
  linkedGroupOfFamily,
  markWakeDue,
  memberById,
  type Queryable,
} from "./repo.ts";

/** `reconcile` stops re-running an answer at this many attempts; the founder is told then. */
export const MAX_PROCESSING_ATTEMPTS = 3;

/** R2 keys are named by the file's type, which Telegram voice notes and photos leave to the MIME type. */
const EXTENSION_BY_MIME: ReadonlyMap<string, string> = new Map([
  ["audio/ogg", "ogg"],
  ["audio/opus", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "aac"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function extensionFor(mime: string): string {
  const type = (mime.split(";")[0] ?? "").trim().toLowerCase();
  return EXTENSION_BY_MIME.get(type) ?? "bin";
}

interface AnswerContext {
  answer: Answer;
  member: Member;
  family: Family;
  exchange: Exchange;
  asker: Member | null;
}

async function loadAnswer(deps: Deps, answerId: string): Promise<AnswerContext | null> {
  const rows = await deps.db
    .select({ answer: answers, member: members, family: families, exchange: exchanges })
    .from(answers)
    .innerJoin(exchanges, eq(exchanges.id, answers.exchangeId))
    .innerJoin(members, eq(members.id, answers.memberId))
    .innerJoin(families, eq(families.id, members.familyId))
    .where(eq(answers.id, answerId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    deps.logger.warn("answer_missing", { answerId });
    return null;
  }
  const asker =
    row.exchange.askerId === null ? null : await memberById(deps.db, row.exchange.askerId);
  return { ...row, asker };
}

/** One more start of ingestion or understanding for the answer; returns the count so far. */
async function countAttempt(deps: Deps, answerId: string): Promise<number> {
  const [row] = await deps.db
    .update(answers)
    .set({ processingAttempts: sql`${answers.processingAttempts} + 1` })
    .where(eq(answers.id, answerId))
    .returning({ attempts: answers.processingAttempts });
  return row?.attempts ?? 0;
}

/** Every provider call is logged from its record: counts and codes, never content. */
async function logAiCall(
  deps: Deps,
  ctx: AnswerContext,
  record: AiCallRecord,
  output: unknown,
): Promise<void> {
  await deps.db.insert(aiCalls).values({
    familyId: ctx.family.id,
    memberId: ctx.member.id,
    call: record.call,
    promptVersion: record.promptVersion,
    model: record.model,
    inputRef: { answer_id: ctx.answer.id },
    output: record.ok ? output : { error: record.error ?? "failed" },
    ok: record.ok,
    tokensIn: record.tokensIn,
    tokensOut: record.tokensOut,
    tokensCached: record.tokensCached,
    latencyMs: record.latencyMs,
    costUsd: record.costUsd,
    at: deps.clock.now(),
  });
}

/**
 * After the third failed attempt the founder is told once, with a link and no content: the key
 * names the answer, so later attempts add nothing.
 */
async function tellAdminUnderstandFailed(deps: Deps, ctx: AnswerContext): Promise<void> {
  const admin = deps.config.adminConversationId;
  if (admin === null) {
    return;
  }
  await enqueueOutbound(deps, deps.db, {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: admin,
      suffix: `understand_failed:${ctx.answer.id}`,
    }),
    memberId: ctx.member.id,
    channel: ADMIN_CHANNEL,
    conversationId: admin,
    exchangeId: ctx.exchange.id,
    lang: ADMIN_LANG,
    text: t(ADMIN_LANG, "admin.understand_failed", {
      family: ctx.family.name,
      link: adminLink(deps.config, ctx.family.id),
    }),
  });
}

async function endAttemptUnresolved(
  deps: Deps,
  ctx: AnswerContext,
  attempts: number,
): Promise<void> {
  if (attempts >= MAX_PROCESSING_ATTEMPTS) {
    await tellAdminUnderstandFailed(deps, ctx);
  }
}

/**
 * The voice as bytes: from R2 when a row is already stored (a re-forwarded file, a re-run after a
 * failed transcription), otherwise fetched from the platform and stored first. Null, logged, when
 * neither is possible; the attempt then ends without a transcript.
 */
async function loadAudio(
  deps: Deps,
  ctx: AnswerContext,
  file: Media,
): Promise<FetchedMedia | null> {
  const answerId = ctx.answer.id;
  if (file.storageKey !== null) {
    const stored = await deps.media.get(file.storageKey);
    if (stored === null) {
      deps.logger.error("answer_media_object_missing", { answerId, mediaId: file.id });
    }
    return stored;
  }
  if (file.providerFileId === null) {
    deps.logger.error("answer_media_unreachable", { answerId, mediaId: file.id });
    return null;
  }
  let fetched: FetchedMedia;
  try {
    fetched = await deps.channels.get(ctx.answer.channel).fetchMedia(file.providerFileId);
  } catch (error) {
    deps.logger.error("answer_media_fetch_failed", {
      answerId,
      code: error instanceof ChannelSendError ? error.code : "unknown",
    });
    return null;
  }
  // The message's own MIME type (a voice note's audio/ogg) is more exact than the one a download
  // path yields, so it is kept when the platform gave one.
  const mime = file.mime ?? fetched.mime;
  const key = `families/${ctx.family.id}/answers/${answerId}.${extensionFor(mime)}`;
  try {
    await deps.media.put(key, fetched.body, mime);
  } catch (error) {
    deps.logger.error("answer_media_store_failed", {
      answerId,
      error: errorLabel(error),
    });
    return null;
  }
  await deps.db
    .update(media)
    .set({ storageKey: key, mime, bytes: fetched.body.byteLength })
    .where(eq(media.id, file.id));
  return { body: fetched.body, mime };
}

/**
 * `ingest_answer_media` (flows §3.10): store her voice, transcribe it with her language as the hint,
 * keep the transcript, and hand the answer to understanding. A failed transcription is logged and
 * ends the attempt; the voice itself is already in the group.
 */
export async function ingestAnswerMedia(deps: Deps, answerId: string): Promise<void> {
  const ctx = await loadAnswer(deps, answerId);
  if (ctx === null) {
    return;
  }
  if (hasTranscript(ctx.answer)) {
    // A redelivered job: the words are known, so the voice is not transcribed (and paid for) twice,
    // and understanding, which stops by itself once done, is the only step left.
    await deps.queues.understand.send({ type: "understand_answer", answerId });
    return;
  }
  const attempts = await countAttempt(deps, answerId);
  const file =
    ctx.answer.mediaId === null
      ? undefined
      : (await deps.db.select().from(media).where(eq(media.id, ctx.answer.mediaId)).limit(1))[0];
  if (file === undefined || file.kind !== "audio") {
    deps.logger.warn("answer_media_not_audio", { answerId, kind: ctx.answer.kind });
    return;
  }
  const audio = await loadAudio(deps, ctx, file);
  if (audio === null) {
    await endAttemptUnresolved(deps, ctx, attempts);
    return;
  }
  const transcription = await deps.stt.transcribe({
    audio: audio.body,
    mime: audio.mime,
    languageHint: ctx.member.language,
  });
  await logAiCall(deps, ctx, transcription.record, {
    language: transcription.language,
    confidence: transcription.confidence,
  });
  const text = transcription.text.trim();
  if (!transcription.ok || text.length === 0) {
    deps.logger.warn("transcription_failed", {
      answerId,
      attempts,
      error: transcription.record.error ?? "empty",
    });
    await endAttemptUnresolved(deps, ctx, attempts);
    return;
  }
  await deps.db
    .update(answers)
    .set({ transcript: text, transcriptLang: transcription.language ?? ctx.member.language })
    .where(eq(answers.id, answerId));
  await deps.queues.understand.send({ type: "understand_answer", answerId });
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = Object.hasOwn(payload, key) ? payload[key] : undefined;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function hasTranscript(answer: Answer): boolean {
  return answer.transcript !== null && answer.transcript.trim().length > 0;
}

/**
 * The kinds whose words are in her language and so are translated for the family and posted under
 * the answer post: what she wrote, said, or captioned, and a chip, which is drafted in her language.
 * A vote option is the family's own words, and the "I'm fine", heart, and photo labels say nothing
 * the light line does not already say in the family's language.
 */
const WORDS_IN_HER_LANGUAGE: ReadonlySet<AnswerKind> = new Set<AnswerKind>([
  "text",
  "voice",
  "photo",
  "sticker",
  "other",
  "chip",
]);

/**
 * Her answer as words for the model: her text or transcript, the option she tapped, or the button
 * she pressed in her language. Null when there is nothing to read (a photo without a caption).
 */
function wordsOf(ctx: AnswerContext): string | null {
  const { answer, member } = ctx;
  const lang = member.language;
  switch (answer.kind) {
    case "voice":
      return hasTranscript(answer) ? answer.transcript : null;
    case "fine":
      return t(lang, "button.fine");
    case "heart":
      return t(lang, "button.heart");
    case "chip":
    case "vote":
      return stringField(answer.payload, "choice");
    case "photo_pick": {
      const index = Object.hasOwn(answer.payload, "index") ? answer.payload.index : undefined;
      return typeof index === "number" ? t(lang, "button.choice", { n: index + 1 }) : null;
    }
    default:
      return stringField(answer.payload, "text");
  }
}

function weekdayName(date: LocalDate): Weekday {
  const name = WEEKDAYS[weekdayOf(date)];
  if (name === undefined) {
    throw new RangeError(`no weekday for ${date}`);
  }
  return name;
}

/** Her last three summary lines before this answer, oldest first. */
async function recentSummaries(deps: Deps, ctx: AnswerContext): Promise<string[]> {
  const rows = await deps.db
    .select({ summary: answers.summary })
    .from(answers)
    .where(
      and(
        eq(answers.memberId, ctx.member.id),
        ne(answers.id, ctx.answer.id),
        isNotNull(answers.summary),
        lte(answers.receivedAt, ctx.answer.receivedAt),
      ),
    )
    .orderBy(desc(answers.receivedAt))
    .limit(3);
  return rows.flatMap((row) => (row.summary === null ? [] : [row.summary])).reverse();
}

/**
 * A detected away becomes a period from `away.from` (never before her answer's date), unless an
 * unended one from an answer already starts that day, and is confirmed to her once, keyed by the
 * answer. Her scheduler decides again: the away suppresses today's repeat and quiet.
 */
async function setAwayFromAnswer(
  deps: Deps,
  ctx: AnswerContext,
  away: NonNullable<Understanding["away"]>,
  now: Date,
): Promise<void> {
  const { answer, member, family, exchange } = ctx;
  const link = await channelLinkOfMember(deps.db, member.id, answer.channel);
  const inserted = await deps.db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: awayPeriods.id })
      .from(awayPeriods)
      .where(
        and(
          eq(awayPeriods.memberId, member.id),
          eq(awayPeriods.fromDate, away.from),
          eq(awayPeriods.source, "answer"),
          isNull(awayPeriods.endedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return false;
    }
    await tx.insert(awayPeriods).values({
      memberId: member.id,
      fromDate: away.from,
      toDate: away.until,
      source: "answer",
      createdAt: now,
    });
    await recordEvent(
      tx,
      {
        name: "away_set",
        familyId: family.id,
        memberId: member.id,
        exchangeId: exchange.id,
        props: { source: "answer", open: away.until === null },
      },
      now,
    );
    await markWakeDue(tx, member.id, now);
    if (link !== null && link.blockedAt === null) {
      const lang = member.language;
      await enqueueOutbound(deps, tx, {
        kind: "system",
        idempotencyKey: outboundKey("system", {
          conversationId: link.externalId,
          suffix: `away:${answer.id}`,
        }),
        memberId: member.id,
        channel: link.channel,
        conversationId: link.externalId,
        exchangeId: exchange.id,
        lang,
        text:
          away.until === null
            ? t(lang, "away.confirmed_open")
            : t(lang, "away.confirmed", { date: formatAwayDate(away.until, lang) }),
      });
    }
    return true;
  });
  if (inserted) {
    await deps.scheduler.wakeAt(member.id, now);
  }
}

/**
 * A flag reaches each organiser with her words verbatim (flows §3.10), and the founder with the
 * family's name and a link, never her words (ADR-21). The quote is the model's excerpt when it kept
 * an exact one, and otherwise everything she said: the AI layer drops an excerpt that is not exactly
 * hers but keeps the flag, because a missed signal is the expensive failure, so the notice must not
 * depend on the excerpt. Both are `flag` rows keyed by the exchange, the reader's conversation, and
 * the answer; the event is recorded once, with them.
 */
async function raiseFlag(
  deps: Deps,
  ctx: AnswerContext,
  flag: FlagResult,
  words: string,
  now: Date,
): Promise<void> {
  const { answer, member, family, exchange } = ctx;
  const quote = flag.evidenceQuote ?? words;
  await deps.db.transaction(async (tx) => {
    let inserted = false;
    const organisers = await activeOrganisersWithLinks(tx, family.id, answer.channel);
    for (const organiser of organisers) {
      const lang = organiser.member.language;
      const result = await enqueueOutbound(deps, tx, {
        kind: "flag",
        idempotencyKey: outboundKey("flag", {
          exchangeId: exchange.id,
          conversationId: organiser.link.externalId,
          suffix: answer.id,
        }),
        memberId: organiser.member.id,
        channel: organiser.link.channel,
        conversationId: organiser.link.externalId,
        exchangeId: exchange.id,
        lang,
        text: fitMessageText(t(lang, "flag.notice", { name: member.displayName, quote })),
      });
      inserted ||= "outboundId" in result;
    }
    const admin = deps.config.adminConversationId;
    if (admin !== null) {
      const result = await enqueueOutbound(deps, tx, {
        kind: "flag",
        idempotencyKey: outboundKey("flag", {
          exchangeId: exchange.id,
          conversationId: admin,
          suffix: answer.id,
        }),
        memberId: member.id,
        channel: ADMIN_CHANNEL,
        conversationId: admin,
        exchangeId: exchange.id,
        lang: ADMIN_LANG,
        text: t(ADMIN_LANG, "admin.flag", {
          family: family.name,
          link: adminLink(deps.config, family.id),
        }),
      });
      inserted ||= "outboundId" in result;
    }
    if (inserted) {
      await recordEvent(
        tx,
        {
          name: "flag_raised",
          familyId: family.id,
          memberId: member.id,
          exchangeId: exchange.id,
          props: {
            category: flag.category,
            severity: flag.severity,
            excerpt: flag.evidenceQuote !== null,
          },
        },
        now,
      );
    }
  });
}

/**
 * Her words in the family's language when it differs from hers: the stored translation when one
 * exists (a re-run), otherwise one `ai.translate` call whose result is kept per answer and language.
 */
async function translateWords(
  deps: Deps,
  ctx: AnswerContext,
  words: string,
): Promise<string | null> {
  const { answer, member, family } = ctx;
  if (family.language === member.language) {
    return null;
  }
  const [existing] = await deps.db
    .select({ text: translations.text })
    .from(translations)
    .where(
      and(
        eq(translations.objectType, "answer"),
        eq(translations.objectId, answer.id),
        eq(translations.lang, family.language),
      ),
    )
    .limit(1);
  if (existing !== undefined) {
    return existing.text;
  }
  const outcome = await deps.ai.translate({
    text: words,
    from: member.language,
    to: family.language,
    speaker: {
      name: member.displayName,
      ageBand: member.ageBand ?? "elder",
      addressForm: member.addressForm,
    },
    listener: { name: family.name, ageBand: "adult", addressForm: null },
    relationship: "a family elder to the family group that keeps a light on for them",
  });
  await logAiCall(deps, ctx, outcome.record, outcome.value);
  if (!outcome.ok) {
    deps.logger.warn("translation_failed", { answerId: answer.id, error: outcome.error });
    return null;
  }
  await deps.db
    .insert(translations)
    .values({
      objectType: "answer",
      objectId: answer.id,
      lang: family.language,
      text: outcome.value.text,
      provider: `claude:${outcome.record.promptVersion}`,
      createdAt: deps.clock.now(),
    })
    .onConflictDoNothing();
  return outcome.value.text;
}

/**
 * Removes her copy of a summary that is being rewritten. `understandAnswer` calls it in the
 * transaction that writes the new summary, so no read finds the old translation next to the new
 * summary, and a job that stops before the new one is translated cannot leave the old one behind.
 */
async function dropSummaryForHer(tx: Queryable, ctx: AnswerContext): Promise<void> {
  const { answer, member, family } = ctx;
  if (family.language === member.language) {
    return;
  }
  await tx
    .delete(translations)
    .where(
      and(
        eq(translations.objectType, "answer"),
        eq(translations.objectId, answer.id),
        eq(translations.lang, member.language),
      ),
    );
}

/**
 * The summary line in her language, for "what does the family see" (flows §3.13): `ai.understand`
 * writes it in the family's language, so when hers differs it is translated and kept as the
 * answer's `translations` row in her language. That row can only be the summary, since her words
 * are in her language already (their translation is the row in the family's). A re-run that keeps
 * the summary keeps the row; one that rewrites it has already removed the row with the summary
 * write (`dropSummaryForHer`) and stores the new translation here, so she never reads a summary the
 * family no longer has. A failed translation stores nothing, and she reads the summary as the
 * family does.
 */
async function translateSummaryForHer(
  deps: Deps,
  ctx: AnswerContext,
  summary: string,
): Promise<void> {
  const { answer, member, family } = ctx;
  if (family.language === member.language) {
    return;
  }
  if (answer.summary === summary) {
    const kept = await summariesForHer(deps.db, [answer.id], member.language);
    if (kept.has(answer.id)) {
      return;
    }
  }
  const outcome = await deps.ai.translate({
    text: summary,
    from: family.language,
    to: member.language,
    speaker: { name: family.name, ageBand: "adult", addressForm: null },
    listener: {
      name: member.displayName,
      ageBand: member.ageBand ?? "elder",
      addressForm: member.addressForm,
    },
    relationship: "the family's one-line note on the listener's answer, shown to her",
  });
  await logAiCall(deps, ctx, outcome.record, outcome.value);
  if (!outcome.ok) {
    deps.logger.warn("summary_translation_failed", { answerId: answer.id, error: outcome.error });
    return;
  }
  const row = {
    text: outcome.value.text,
    provider: `claude:${outcome.record.promptVersion}`,
    createdAt: deps.clock.now(),
  };
  await deps.db
    .insert(translations)
    .values({ objectType: "answer", objectId: answer.id, lang: member.language, ...row })
    .onConflictDoUpdate({
      target: [translations.objectType, translations.objectId, translations.lang],
      set: row,
    });
}

/**
 * Her answers' summaries in her language, by answer id: the `translations` row in her language that
 * `understandAnswer` writes for the summary when the family writes in another. An answer without
 * one (the languages match, the translation failed, or retention removed it after 30 days) is
 * missing from the map, and its summary is read as stored.
 */
export async function summariesForHer(
  db: Queryable,
  answerIds: readonly string[],
  lang: Lang,
): Promise<Map<string, string>> {
  if (answerIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ answerId: translations.objectId, text: translations.text })
    .from(translations)
    .where(
      and(
        eq(translations.objectType, "answer"),
        inArray(translations.objectId, [...answerIds]),
        eq(translations.lang, lang),
      ),
    );
  return new Map(rows.map((row) => [row.answerId, row.text]));
}

/** The platform id of the sent answer post, so the transcript can reply to it; null until sent. */
async function answerPostMessageId(deps: Deps, ctx: AnswerContext): Promise<string | null> {
  const [row] = await deps.db
    .select({ externalId: outbound.externalId })
    .from(outbound)
    .where(
      and(
        eq(
          outbound.idempotencyKey,
          outboundKey("answer_post", { exchangeId: ctx.exchange.id, suffix: ctx.answer.id }),
        ),
        eq(outbound.status, "sent"),
      ),
    )
    .limit(1);
  return row?.externalId ?? null;
}

/**
 * The transcript of a voice answer, with its translation, or the translation alone of a written
 * one, as a reply to the answer post: one `answer_post` keyed by the exchange and `<answer>:transcript`.
 */
async function postWordsToGroup(
  deps: Deps,
  ctx: AnswerContext,
  words: string,
  translation: string | null,
): Promise<void> {
  const { answer, member, family, exchange } = ctx;
  const lang = family.language;
  const name = member.displayName;
  const lines: string[] = [];
  if (answer.kind === "voice") {
    lines.push(t(lang, "group.answer_transcript", { name, text: words }));
    if (translation !== null) {
      lines.push(translation);
    }
  } else if (translation !== null) {
    lines.push(t(lang, "group.answer_text", { name, text: translation }));
  }
  if (lines.length === 0) {
    return;
  }
  const group = await linkedGroupOfFamily(deps.db, family.id, answer.channel);
  if (group === null) {
    return;
  }
  const replyTo = await answerPostMessageId(deps, ctx);
  await enqueueOutbound(deps, deps.db, {
    kind: "answer_post",
    idempotencyKey: outboundKey("answer_post", {
      exchangeId: exchange.id,
      suffix: `${answer.id}:transcript`,
    }),
    memberId: member.id,
    channel: answer.channel,
    conversationId: group.conversationId,
    exchangeId: exchange.id,
    lang,
    text: fitMessageText(lines.join("\n")),
    replyToMessageId: replyTo ?? undefined,
    ref: { purpose: "answer_post", exchangeId: exchange.id, memberId: member.id },
  });
}

/**
 * `understand_answer` (flows §3.10). `understood_at` is set only when `ai.understand` and `ai.flag`
 * both returned ok; a failed translation does not hold it back. An answer with nothing to read (a
 * photo without words) is understood at once, so it is never re-run.
 */
export async function understandAnswer(deps: Deps, answerId: string): Promise<void> {
  const ctx = await loadAnswer(deps, answerId);
  if (ctx === null) {
    return;
  }
  if (ctx.answer.understoodAt !== null) {
    // A redelivered job: the model is not asked twice, and every message it could produce is
    // already keyed out.
    deps.logger.info("understand_already_done", { answerId });
    return;
  }
  const attempts = await countAttempt(deps, answerId);
  const { answer, member, family, exchange, asker } = ctx;
  const now = deps.clock.now();
  const words = wordsOf(ctx);
  if (words === null) {
    if (answer.kind === "voice") {
      // Understanding follows a transcript; without one, ingestion is the job to re-run.
      deps.logger.warn("understand_without_transcript", { answerId, attempts });
      return;
    }
    await deps.db.update(answers).set({ understoodAt: now }).where(eq(answers.id, answerId));
    return;
  }

  const today = localDateOf(answer.receivedAt, member.tz);
  const addressForm = member.addressForm ?? member.displayName;
  const ask =
    exchange.type === "hello"
      ? null
      : { askerName: asker?.displayName ?? family.name, type: exchange.type, text: exchange.text };
  const content = { kind: answer.kind, text: words };
  const summaries = await recentSummaries(deps, ctx);

  const understanding = await deps.ai.understand({
    lang: member.language,
    summaryLang: family.language,
    addressForm,
    today,
    todayWeekday: weekdayName(today),
    ask,
    answer: content,
    recentSummaries: summaries,
  });
  await logAiCall(deps, ctx, understanding.record, understanding.value);
  const flag = await deps.ai.flag({
    lang: member.language,
    addressForm,
    ask,
    answer: content,
    recentSummaries: summaries,
  });
  await logAiCall(deps, ctx, flag.record, flag.value);

  const understood = understanding.ok && flag.ok;
  const summaryChanged = understanding.ok && understanding.value.summary !== answer.summary;
  await deps.db.transaction(async (tx) => {
    await tx
      .update(answers)
      .set({
        ...(understanding.ok
          ? {
              summary: understanding.value.summary,
              moodWords: understanding.value.moodWords,
              mentions: understanding.value.mentions,
              awayUntil: understanding.value.away?.until ?? null,
            }
          : {}),
        ...(flag.ok
          ? {
              flag: flag.value.flag,
              flagReason: flag.value.flag
                ? `${flag.value.category ?? "unspecified"}:${flag.value.severity ?? "concern"}`
                : null,
            }
          : {}),
        ...(understood ? { understoodAt: now } : {}),
      })
      .where(eq(answers.id, answerId));
    if (summaryChanged) {
      await dropSummaryForHer(tx, ctx);
    }
  });

  if (understanding.ok && understanding.value.away !== null) {
    await setAwayFromAnswer(deps, ctx, understanding.value.away, now);
  }
  if (flag.ok && flag.value.flag) {
    await raiseFlag(deps, ctx, flag.value, words, now);
  }
  if (WORDS_IN_HER_LANGUAGE.has(answer.kind)) {
    const translation = await translateWords(deps, ctx, words);
    await postWordsToGroup(deps, ctx, words, translation);
  }
  // After the family's post, which matters more than her copy of the summary.
  if (understanding.ok) {
    await translateSummaryForHer(deps, ctx, understanding.value.summary);
  }

  if (!understood) {
    deps.logger.warn("understanding_incomplete", {
      answerId,
      attempts,
      understand: understanding.ok,
      flag: flag.ok,
    });
    await endAttemptUnresolved(deps, ctx, attempts);
  }
}
