/**
 * Memories the family keeps (ADR-50; privacy-notice v8 draft). The family book (ADR-39) keeps her
 * stories by default; here an organiser also keeps any ordinary answer of hers with "Keep" in the
 * app, and Vela may suggest one worth keeping. She is told, not asked: the first time an answer of
 * hers is kept, Vela tells her in her chat, and "memories off" there removes what was kept and stops
 * new keeping and suggestions until "memories on".
 *
 * Keeping is a `book_entries` row with `kept_by`, so retention's existing book rule is what keeps
 * the answer past 30 days; nothing is copied. An answer that was flagged, names a health mention, or
 * holds a sensitive word is never kept with "Keep" and never sent for a suggestion.
 *
 * Off unless `book` is on; suggestions also need `memoryDiscovery`. Both are off in production.
 */
import type { AiOutcome, FlagResult, Understanding } from "@vela/ai";
import type { ApiMutationResponse, InboundEvent } from "@vela/contracts";
import { t } from "@vela/copy";
import { outboundKey } from "@vela/core";
import {
  type Answer,
  answers,
  bookEntries,
  type Exchange,
  exchanges,
  families,
  keepSuggestions,
  type Member,
  media,
  members,
} from "@vela/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { runApiMutation } from "./api-idempotency.ts";
import { arrivalChannelOf } from "./arrivals.ts";
import { keptFiles } from "./book.ts";
import type { Deps } from "./deps.ts";
import { errorLabel, VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { insertOutbound, type OutboundRequest } from "./gateway.ts";
import { hasSensitiveWords, screenForMemories } from "./memory-discovery.ts";
import { channelLinkOfMember, isMessenger, memberByChannelUser, type Queryable } from "./repo.ts";
import { sourceWords } from "./rich-memories.ts";
import { weaveStories } from "./stories.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUGGESTION_DAYS = 30;
/** A moment after the keep, so the note is not the first thing she sees of a busy morning. */
const TOLD_DELAY_SECONDS = 20;

/** Whether her answers may be kept at all: the book is on and she has not said "memories off". */
export function keepingAllowed(
  deps: Pick<Deps, "config">,
  member: Pick<Member, "memoriesOffAt">,
): boolean {
  return deps.config.book && member.memoriesOffAt === null;
}

function healthMentioned(answer: Answer): boolean {
  const health = (answer.mentions as { health?: unknown }).health;
  return Array.isArray(health) && health.length > 0;
}

/**
 * Whether one answer may be kept with "Keep": not flagged, no health mention, its words not yet
 * cleared, and no sensitive word in them. A voice note not yet written out cannot be checked, so it
 * waits; a photo with no words is fine.
 */
export function answerKeepable(answer: Answer): boolean {
  if (answer.flag || healthMentioned(answer) || answer.wordsExpiredAt !== null) return false;
  const words = sourceWords(answer);
  if (words === null) return answer.kind !== "voice" && answer.kind !== "text";
  return !hasSensitiveWords(words.text);
}

export type KeepRefusal = "not_kept" | "memories_off" | "sensitive" | "no_answer";

/**
 * The organiser's "Keep" on one of her answered exchanges (`POST /v1/book/:exchangeId/keep`),
 * through `runApiMutation` under her member row, which her "memories off" also takes. A refusal is
 * answered as `kept: false` with its reason. The first keep of hers also writes the note that tells
 * her, for the route to hand to the queue after the commit.
 */
export async function keepApiAnswer(
  deps: Pick<Deps, "db" | "clock"> & { config: Pick<Deps["config"], "book"> },
  identity: SessionIdentity,
  key: string,
  exchangeId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  if (!UUID.test(exchangeId) || !deps.config.book) throw new VelaError("not_found", "Not found");
  const id = exchangeId.toLowerCase();
  const [found] = await deps.db
    .select({ familyId: exchanges.familyId, memberId: exchanges.recipientId })
    .from(exchanges)
    .where(eq(exchanges.id, id))
    .limit(1);
  const now = deps.clock.now();
  const after = nothingAfterCommit();
  const result = await runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "book.keep:v1",
      input: { exchange_id: id },
      ...(found === undefined ? {} : { familyId: found.familyId, memberId: found.memberId }),
    },
    {
      authorize: async (tx) => {
        if (found === undefined) throw new VelaError("not_found", "Not found");
        const access = await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
        if (access.kind !== "granted") throw new VelaError("not_found", "Not found");
      },
      mutate: async (tx) => {
        const access =
          found === undefined
            ? null
            : await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
        if (found === undefined || access === null || access.kind !== "granted") {
          throw new VelaError("not_found", "Not found");
        }
        const refuse = (reason: KeepRefusal) => ({
          status: 200 as const,
          body: { exchange_id: id, kept: false, reason },
        });
        // Her row first, as "memories off" takes it: a keep and her "memories off" never cross.
        const [her] = await tx
          .select()
          .from(members)
          .where(and(eq(members.id, found.memberId), eq(members.familyId, found.familyId)))
          .for("update");
        if (her === undefined || her.leftAt !== null || !["active", "paused"].includes(her.status))
          throw new VelaError("not_found", "Not found");
        if (her.memoriesOffAt !== null) return refuse("memories_off");
        const [exchange] = await tx
          .select()
          .from(exchanges)
          .where(eq(exchanges.id, id))
          .for("key share");
        const said = await tx
          .select()
          .from(answers)
          .where(and(eq(answers.exchangeId, id), eq(answers.memberId, her.id)))
          .for("key share");
        if (exchange === undefined || said.length === 0) return refuse("no_answer");
        if (!said.every(answerKeepable)) return refuse("sensitive");
        const [entry] = await tx
          .select()
          .from(bookEntries)
          .where(eq(bookEntries.exchangeId, id))
          .for("update");
        if (entry !== undefined && entry.removedAt === null) {
          return { status: 200, body: { exchange_id: id, kept: true } };
        }
        // Her own "don't keep that one" or "memories off" is final for this answer.
        if (entry !== undefined && entry.removedBy === her.id) return refuse("not_kept");
        if (entry === undefined) {
          await tx.insert(bookEntries).values({
            familyId: found.familyId,
            memberId: her.id,
            exchangeId: id,
            keptAt: now,
            keptBy: access.access.memberId,
          });
        } else {
          await tx
            .update(bookEntries)
            .set({ removedAt: null, removedBy: null, keptAt: now, keptBy: access.access.memberId })
            .where(eq(bookEntries.id, entry.id));
        }
        await tx.delete(keepSuggestions).where(eq(keepSuggestions.exchangeId, id));
        // Her files are kept with the answer. A recording from her phone stays under its own
        // prefix for now: moving it out of the bucket's 32-day rule is a follow-up (ADR-50).
        const files = said.flatMap((answer) => keptFiles(exchange, answer.mediaId));
        if (files.length > 0) {
          await tx
            .update(media)
            .set({ kept: true })
            .where(and(eq(media.familyId, found.familyId), inArray(media.id, files)));
        }
        await recordEvent(
          tx,
          {
            name: "story_saved",
            familyId: found.familyId,
            memberId: her.id,
            exchangeId: id,
            surface: "app",
            props: { kept: true, by: "organiser" },
          },
          now,
        );
        const note = await toldNote(tx, her, access.access.memberId);
        if (note !== null) {
          const written = await insertOutbound(deps, tx, note);
          if ("outboundId" in written) after.outboundIds.push(written.outboundId);
        }
        return { status: 200, body: { exchange_id: id, kept: true } };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}

/**
 * The note that tells her, once, in her chat, that her family kept an answer and how to stop it:
 * keyed by her member, so a later keep's insert is a duplicate and says nothing more. Null when she
 * has no messenger chat Vela can reach.
 */
async function toldNote(
  tx: Queryable,
  her: Member,
  keeperId: string,
): Promise<OutboundRequest | null> {
  const channel = arrivalChannelOf(her);
  if (!isMessenger(channel)) return null;
  const link = await channelLinkOfMember(tx, her.id, channel);
  if (link === null || link.blockedAt !== null) return null;
  const [keeper] = await tx
    .select({ name: members.displayName })
    .from(members)
    .where(eq(members.id, keeperId))
    .limit(1);
  const lang = her.language;
  return {
    kind: "system",
    idempotencyKey: outboundKey("system", {
      conversationId: link.externalId,
      suffix: `memory_told:${her.id}`,
    }),
    memberId: her.id,
    channel: link.channel,
    conversationId: link.externalId,
    lang,
    text: t(lang, "memory.told", { organiser: keeper?.name ?? "" }),
    delaySeconds: TOLD_DELAY_SECONDS,
  };
}

/** "Not this one" on a suggestion (`POST /v1/book/:exchangeId/dismiss`): any organiser. */
export async function dismissApiSuggestion(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  exchangeId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!UUID.test(exchangeId)) throw new VelaError("not_found", "Not found");
  const id = exchangeId.toLowerCase();
  const [found] = await deps.db
    .select({ familyId: keepSuggestions.familyId, memberId: keepSuggestions.memberId })
    .from(keepSuggestions)
    .where(eq(keepSuggestions.exchangeId, id))
    .limit(1);
  const now = deps.clock.now();
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "book.dismiss:v1",
      input: { exchange_id: id },
      ...(found === undefined ? {} : { familyId: found.familyId, memberId: found.memberId }),
    },
    {
      authorize: async (tx) => {
        if (found === undefined) throw new VelaError("not_found", "Not found");
        const access = await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
        if (access.kind !== "granted") throw new VelaError("not_found", "Not found");
      },
      mutate: async (tx) => {
        const access =
          found === undefined
            ? null
            : await authorizeFamilyAccess(tx, identity, found.familyId, "organiser");
        if (found === undefined || access === null || access.kind !== "granted") {
          throw new VelaError("not_found", "Not found");
        }
        await tx
          .update(keepSuggestions)
          .set({ dismissedAt: now, dismissedBy: access.access.memberId })
          .where(and(eq(keepSuggestions.exchangeId, id), isNull(keepSuggestions.dismissedAt)));
        return { status: 200, body: { exchange_id: id, dismissed: true } };
      },
    },
  );
}

/** What the understanding step saw, read before anything was wiped for lack of consent. */
export interface SuggestionScreen {
  understanding: AiOutcome<Understanding>;
  flag: AiOutcome<FlagResult>;
}

/**
 * Suggests her answer to the organisers when the memory model finds a phrase worth keeping. Only an
 * ordinary answer goes to the model: understood, not flagged, no health mention, no sensitive word
 * (`screenForMemories`). Code keeps only a phrase found word for word in her answer. Never throws,
 * and logs only counts and reasons, never her words.
 */
export async function suggestKeeping(
  deps: Deps,
  ctx: { answer: Answer; member: Member; exchange: Exchange },
  screen: SuggestionScreen,
): Promise<boolean> {
  const { answer, member, exchange } = ctx;
  try {
    if (!keepingAllowed(deps, member) || deps.config.memoryDiscovery !== true) return false;
    const skip = screenForMemories(answer, screen);
    if (skip !== null || !answerKeepable(answer)) {
      deps.logger.info("keep_suggestion_skipped", {
        answerId: answer.id,
        reason: skip ?? "sensitive",
      });
      return false;
    }
    const [already] = await deps.db
      .select({ id: bookEntries.id })
      .from(bookEntries)
      .where(eq(bookEntries.exchangeId, exchange.id))
      .limit(1);
    if (already !== undefined) return false;
    const words = sourceWords(answer);
    if (words === null) return false;
    const picked = await deps.ai.memoryPick({
      lang: member.language,
      addressForm: member.addressForm ?? member.displayName,
      ask: exchange.text,
      answer: words.text,
    });
    if (!picked.ok) {
      deps.logger.warn("keep_suggestion_failed", { answerId: answer.id });
      return false;
    }
    for (const pick of picked.value.picks) {
      const quote = pick.quote.trim();
      // Code, not the model, decides what her words are: only an exact phrase of hers is shown.
      const start = words.text.indexOf(quote);
      if (quote.length < 3 || start === -1 || hasSensitiveWords(quote)) continue;
      const now = deps.clock.now();
      const inserted = await deps.db
        .insert(keepSuggestions)
        .values({
          familyId: exchange.familyId,
          memberId: member.id,
          exchangeId: exchange.id,
          answerId: answer.id,
          start,
          end: start + quote.length,
          kind: pick.kind,
          expiresAt: new Date(answer.receivedAt.getTime() + SUGGESTION_DAYS * 86_400_000),
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: keepSuggestions.id });
      deps.logger.info("keep_suggestion", { answerId: answer.id, made: inserted.length });
      // A new memory may complete a story she has been telling across mornings (ADR-51).
      if (inserted.length > 0) await weaveStories(deps, member);
      return inserted.length > 0;
    }
    deps.logger.info("keep_suggestion", { answerId: answer.id, made: 0 });
    return false;
  } catch (error) {
    deps.logger.error("keep_suggestion_error", { answerId: answer.id, error: errorLabel(error) });
    return false;
  }
}

/** One suggestion, as the organisers read it beside the family book. */
export interface ApiKeepSuggestion {
  exchange_id: string;
  member_id: string;
  member_name: string;
  question: string | null;
  quote: string;
  at: string;
}

/**
 * The family's live suggestions, newest first: not dismissed, not expired, not already kept, her
 * memories not off, and the phrase still in her words. For organisers only.
 */
export async function liveSuggestions(
  db: Queryable,
  familyId: string,
  now: Date,
): Promise<ApiKeepSuggestion[]> {
  const rows = await db
    .select({ suggestion: keepSuggestions, answer: answers, exchange: exchanges, her: members })
    .from(keepSuggestions)
    .innerJoin(answers, eq(answers.id, keepSuggestions.answerId))
    .innerJoin(exchanges, eq(exchanges.id, keepSuggestions.exchangeId))
    .innerJoin(members, eq(members.id, keepSuggestions.memberId))
    .innerJoin(families, eq(families.id, keepSuggestions.familyId))
    .where(
      and(
        eq(keepSuggestions.familyId, familyId),
        isNull(keepSuggestions.dismissedAt),
        isNull(members.memoriesOffAt),
        isNull(members.leftAt),
        isNull(families.deletedAt),
      ),
    );
  const kept = new Set(
    (
      await db
        .select({ exchangeId: bookEntries.exchangeId })
        .from(bookEntries)
        .where(and(eq(bookEntries.familyId, familyId), isNull(bookEntries.removedAt)))
    ).map((row) => row.exchangeId),
  );
  return rows
    .filter(
      ({ suggestion, answer }) =>
        suggestion.expiresAt.getTime() > now.getTime() &&
        !kept.has(suggestion.exchangeId) &&
        answerKeepable(answer),
    )
    .flatMap(({ suggestion, answer, exchange, her }) => {
      const words = sourceWords(answer);
      const quote = words?.text.slice(suggestion.start, suggestion.end).trim() ?? "";
      if (quote.length === 0) return [];
      return [
        {
          exchange_id: exchange.id,
          member_id: her.id,
          member_name: her.displayName,
          question: exchange.text,
          quote,
          at: answer.receivedAt.toISOString(),
        },
      ];
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * A tap on a button from the retired memory messages in her chat (the question and the offers of
 * 23 October 2026, before ADR-50): those buttons do nothing now. Her buttons close, and she is told
 * once there is nothing for her to do.
 */
export async function handleRetiredMemoryButton(deps: Deps, event: InboundEvent): Promise<void> {
  const adapter = deps.channels.get(event.channel);
  await adapter.acknowledgeButton(event);
  if (event.messageId !== undefined) {
    await adapter.closeButtons(event.conversation.externalId, event.messageId);
  }
  const sender = await memberByChannelUser(deps.db, event.channel, event.sender.externalUserId);
  if (sender === null || event.conversation.kind !== "private") return;
  const lang = sender.member.language;
  try {
    await adapter.send({
      kind: "system",
      idempotencyKey: outboundKey("system", {
        conversationId: event.conversation.externalId,
        suffix: `memory_gone:${sender.member.id}`,
      }),
      lang,
      to: { channel: event.channel, conversationId: event.conversation.externalId },
      text: t(lang, "memory.gone"),
    });
  } catch (error) {
    deps.logger.warn("memory_gone_reply_failed", { error: errorLabel(error) });
  }
}
