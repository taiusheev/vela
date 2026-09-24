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
import { addDays, localDateOf, outboundKey } from "@vela/core";
import { exchanges, type Member, members, turns, type VelaTransaction } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
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

/** A kept-light member who can be asked today: the light is hers, and she is here to answer. */
function canBeAsked(member: Member, familyId: string): boolean {
  return (
    member.familyId === familyId &&
    member.leftAt === null &&
    member.status === "active" &&
    member.lightOn &&
    member.lightConsentedAt !== null
  );
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
 * not enqueue (code design §8), so unlike the Telegram path this composes no group confirmation.
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

        const today = localDateOf(now, locked.tz);
        const horizon = addDays(today, MAX_ASK_DAYS_AHEAD);
        const scheduledFor =
          ask.when === "whenever" ? null : ask.when === "tomorrow" ? addDays(today, 1) : ask.date;
        if (scheduledFor !== null && scheduledFor !== undefined) {
          if (scheduledFor <= today || scheduledFor > horizon) {
            throw new VelaError("invalid_payload", "That day is outside her next two weeks");
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
          })
          .returning();
        if (exchange === undefined) throw new Error("exchange insert returned no row");

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
              media: 0,
              queued: false,
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
