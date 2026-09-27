import {
  type ApiAskConflict,
  ApiComposedAsk,
  type ApiMutationResponse,
  ComposeAsk,
  type ExchangeType,
  type LocalDate,
  MAX_ASK_DAYS_AHEAD,
} from "@vela/contracts";
import { t } from "@vela/copy";
import { addDays, localDateOf, outboundKey, zonedInstant } from "@vela/core";
import { exchanges, media, members, suggestions, turns, type VelaTransaction } from "@vela/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import { sharedWith } from "./api-media.ts";
import { canBeAsked } from "./askable.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { insertOutbound } from "./gateway.ts";
import {
  familyById,
  familyHasEnded,
  linkedGroupOfFamily,
  lockExchangeForLocalDate,
  memberById,
} from "./repo.ts";

/** The family group the app's asks are told to: the Telegram one, as the pilot's arrivals are. */
const GROUP_CHANNEL = "telegram" as const;

/**
 * That morning is already someone's (spec §14.1 A7: "the screen says so and offers the day after or
 * whenever"). It carries who holds it and the next morning nobody does, which is all the screen
 * needs to offer the choice; both are things the caller can already see on Today.
 */
export class AskDayTakenError extends Error {
  override readonly name = "AskDayTakenError";
  readonly conflict: ApiAskConflict;

  constructor(conflict: ApiAskConflict) {
    super("That day already has an ask");
    this.conflict = conflict;
  }
}

/**
 * A photo the ask names cannot be shown to her on its morning (ADR-33): it is unknown, another
 * family's, not an image, an upload of someone else's that the family does not share yet, or it
 * is deleted before her morning is over. The app asks for it to be chosen again.
 */
export class AskPhotoMissingError extends Error {
  override readonly name = "AskPhotoMissingError";

  constructor() {
    super("That photo is no longer here");
  }
}

/**
 * Takes the photos an ask names, `for share`, and refuses the ask unless each can be shown to her
 * (`AskPhotoMissingError`). The share lock is what keeps retention off them until the ask commits:
 * retention takes a photo's row `for update` before it removes the id from every exchange, so
 * either it waits for this ask and then finds it, or this ask waits for retention and finds the row
 * gone; retention (`deleteMedia`) is the only code that deletes a photo. Lock order: her member
 * row, then the photos, then her exchanges (code design §8), as retention takes the photo before
 * the exchanges.
 *
 * A photo is the asker's to ask with when they uploaded it or the family already shares it, as the
 * read route decides (`sharedWith`). It must be kept, or not deleted before `until`: her morning
 * and the day after it, when a pick is still resolved against it.
 */
async function lockAskPhotos(
  tx: VelaTransaction,
  familyId: string,
  askerId: string,
  ids: readonly string[],
  until: Date,
): Promise<void> {
  const rows = await tx
    .select({ id: media.id, kind: media.kind, kept: media.kept, expiresAt: media.expiresAt })
    .from(media)
    .where(
      and(
        eq(media.familyId, familyId),
        inArray(media.id, [...ids]),
        sharedWith(tx, familyId, askerId),
      ),
    )
    .for("share");
  const usable = new Set(
    rows
      .filter(
        (row) =>
          row.kind === "image" &&
          (row.kept || (row.expiresAt !== null && row.expiresAt.getTime() > until.getTime())),
      )
      .map((row) => row.id.toLowerCase()),
  );
  if (!ids.every((id) => usable.has(id.toLowerCase()))) throw new AskPhotoMissingError();
}

/**
 * Marks the suggestion an ask was composed from as used, and says whether it did. Only her unused
 * suggestion in this family is marked: an id that is stale, already used or not hers composes the
 * ask all the same and marks nothing, so a stale Today never blocks a send, and an id from
 * elsewhere tells the caller nothing. The first use keeps its time.
 */
async function markSuggestionUsed(
  tx: VelaTransaction,
  suggestionId: string,
  familyId: string,
  recipientId: string,
  now: Date,
): Promise<boolean> {
  const marked = await tx
    .update(suggestions)
    .set({ usedAt: now })
    .where(
      and(
        eq(suggestions.id, suggestionId),
        eq(suggestions.familyId, familyId),
        eq(suggestions.aboutMemberId, recipientId),
        isNull(suggestions.usedAt),
      ),
    )
    .returning({ id: suggestions.id });
  return marked.length > 0;
}

/**
 * The first morning in her own days that nobody has claimed, or null when the window holds none.
 * The search is bounded by the same ceiling a caller may ask for, so it cannot walk forever.
 */
async function nextFreeDate(
  tx: VelaTransaction,
  recipientId: string,
  from: LocalDate,
  until: LocalDate,
): Promise<LocalDate | null> {
  let date = from;
  for (let day = 0; day <= MAX_ASK_DAYS_AHEAD && date <= until; day += 1) {
    if ((await lockExchangeForLocalDate(tx, recipientId, date)) === null) return date;
    date = addDays(date, 1);
  }
  return null;
}

/** Who holds a morning, for the conflict: the asker's name, and Vela's when it is her own hello. */
async function holderOf(tx: VelaTransaction, askerId: string | null): Promise<string> {
  const asker = askerId === null ? null : await memberById(tx, askerId);
  return asker?.displayName ?? "Vela";
}

/**
 * Compose an ask (`POST /v1/families/:familyId/exchanges`, API contract §4, spec §14.1 A7).
 *
 * The one-ask-per-day rule is held by the recipient's member row, locked `for update` as the first
 * statement of the mutation, which is the same lock `prepareDay` and the Telegram compose path take
 * (`asks.ts`, `arrivals.ts`): `exchanges_one_per_day` stays a backstop whose firing is an incident,
 * never a control path. Every date is the recipient's own local day, so an ask composed from
 * another time zone still lands on her morning.
 *
 * The mutation writes only on its transaction and sends nothing: `runApiMutation`'s callback may
 * not enqueue (code design §8), so the family group's line is written as an outbound row and handed
 * to the queue after the commit (`after`).
 *
 * An ask composed from tomorrow's suggestion names it (`suggestion_id`), and the suggestion is
 * marked used in the same transaction, after the morning is known to be free: a 409 marks nothing.
 *
 * A photo ask names the photos the app uploaded (`media_ids`, ADR-33), which are taken and checked
 * after her member row and before her morning (`lockAskPhotos`); one she cannot be shown is
 * `AskPhotoMissingError`, 404 `photo_missing`.
 */
export async function composeApiAsk(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  const parsed = ComposeAsk.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  const ask = parsed.data;
  const now = deps.clock.now();
  let askerId = "";
  const after = nothingAfterCommit();

  const result = await runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "exchange.compose:v1",
      input: ask,
      familyId,
      memberId: ask.recipient_id,
    },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, familyId);
        if (access.kind !== "granted") throw new VelaError("not_found", "Family not found");
        askerId = access.access.memberId;
        // `runApiMutation` checks the same pairing next, and a mismatch there is an error the API
        // can only answer 500 to. A recipient who is not of this family is this route's own 404,
        // so it is answered here, and that check stays the backstop it was meant to be.
        const [recipient] = await tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.id, ask.recipient_id), eq(members.familyId, familyId)))
          .limit(1);
        if (recipient === undefined) throw new VelaError("not_found", "Recipient not found");
      },
      mutate: async (tx) => {
        const [locked] = await tx
          .select()
          .from(members)
          .where(eq(members.id, ask.recipient_id))
          .for("update");
        if (locked === undefined || !canBeAsked(locked, familyId)) {
          throw new VelaError("not_found", "Recipient not found");
        }
        if (await familyHasEnded(tx, familyId)) {
          throw new VelaError("not_found", "Family not found");
        }
        const asker = await memberById(tx, askerId);
        if (asker === null) throw new VelaError("not_found", "Asker not found");
        // The contract refuses photos on a whenever ask; this only keeps it from reaching the insert.
        if (ask.media_ids !== undefined && ask.when === "whenever") {
          throw new VelaError("invalid_payload", "A photo ask names its morning");
        }

        const today = localDateOf(now, locked.tz);
        const horizon = addDays(today, MAX_ASK_DAYS_AHEAD);
        const scheduledFor =
          ask.when === "whenever" ? null : ask.when === "tomorrow" ? addDays(today, 1) : ask.date;
        if (scheduledFor !== null && scheduledFor !== undefined) {
          if (scheduledFor <= today || scheduledFor > horizon) {
            throw new VelaError("invalid_payload", "That day is outside her next two weeks");
          }
          if (ask.media_ids !== undefined) {
            const until = zonedInstant(addDays(scheduledFor, 2), "00:00", locked.tz);
            await lockAskPhotos(tx, familyId, asker.id, ask.media_ids, until);
          }
          const taken = await lockExchangeForLocalDate(tx, locked.id, scheduledFor);
          if (taken !== null) {
            throw new AskDayTakenError({
              taken_by: await holderOf(tx, taken.askerId),
              date_alternative: await nextFreeDate(
                tx,
                locked.id,
                addDays(scheduledFor, 1),
                horizon,
              ),
            });
          }
        }

        const type: ExchangeType = ask.type;
        const [exchange] = await tx
          .insert(exchanges)
          .values({
            familyId,
            recipientId: locked.id,
            askerId: asker.id,
            onBehalfOf: ask.on_behalf_of ?? null,
            type,
            state: "composed",
            text: ask.text,
            textLang: asker.language,
            // `arrivals.ts` reads a vote's options from this one key; anything else delivers empty.
            options: ask.vote_options === undefined ? {} : { vote_options: ask.vote_options },
            whenRule: ask.when,
            scheduledFor: scheduledFor ?? null,
            createdAt: now,
            // In the order she is shown them: a photo choice's pick resolves by this index.
            mediaIds: ask.media_ids ?? [],
          })
          .returning();
        if (exchange === undefined) throw new Error("exchange insert returned no row");
        const fromSuggestion =
          ask.suggestion_id !== undefined &&
          (await markSuggestionUsed(tx, ask.suggestion_id, familyId, locked.id, now));

        if (scheduledFor !== null && scheduledFor !== undefined) {
          // The turn row exists only once the 19:00 prompt has run, so this stamps or does nothing.
          await tx
            .update(turns)
            .set({ actedAt: now })
            .where(
              and(
                eq(turns.familyId, familyId),
                eq(turns.localDay, scheduledFor),
                eq(turns.recipientId, locked.id),
                isNull(turns.actedAt),
              ),
            );
        }

        await recordEvent(
          tx,
          {
            name: "ask_composed",
            familyId,
            memberId: asker.id,
            exchangeId: exchange.id,
            surface: "app",
            props: {
              type,
              when_rule: ask.when,
              source: "app",
              media: ask.media_ids?.length ?? 0,
              queued: false,
              from_suggestion: fromSuggestion,
            },
          },
          now,
        );

        // Tomorrow's morning is taken, so the family group hears who took it — never the words,
        // which are hers to hear first — as it does when someone asks there. Written as a row and
        // handed to the queue after the commit; a family with no group has nobody to tell.
        const group = await linkedGroupOfFamily(tx, familyId, GROUP_CHANNEL);
        const family = await familyById(tx, familyId);
        if (group !== null && family !== null && scheduledFor === addDays(today, 1)) {
          const written = await insertOutbound(deps, tx, {
            kind: "system",
            idempotencyKey: outboundKey("system", {
              conversationId: group.conversationId,
              suffix: `app-ask:${exchange.id}`,
            }),
            memberId: asker.id,
            channel: GROUP_CHANNEL,
            conversationId: group.conversationId,
            exchangeId: exchange.id,
            lang: family.language,
            text: t(family.language, "group.ask_from_app", {
              asker: asker.displayName,
              name: locked.displayName,
            }),
            ref: { purpose: "ask_confirmation", exchangeId: exchange.id },
          });
          if ("outboundId" in written) after.outboundIds.push(written.outboundId);
        }

        return {
          status: 201,
          body: ApiComposedAsk.parse({
            id: exchange.id,
            family_id: familyId,
            recipient_id: locked.id,
            recipient_name: locked.displayName,
            asker_name: asker.displayName,
            on_behalf_of: exchange.onBehalfOf,
            type: exchange.type,
            ask: exchange.text,
            when_rule: exchange.whenRule,
            scheduled_for: exchange.scheduledFor,
            state: exchange.state,
          }),
        };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}
