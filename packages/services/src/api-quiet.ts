import {
  type ApiMutationResponse,
  ApiQuietNotice,
  ApiQuietState,
  QuietAction,
} from "@vela/contracts";
import { TUNING } from "@vela/core";
import {
  answers,
  exchanges,
  type Member,
  type QuietEvent,
  quietEvents,
  type VelaTransaction,
} from "@vela/db";
import { desc, eq } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { insertOutbound } from "./gateway.ts";
import { resolveQuietAsFine, usualAnswerTime, waitOnQuiet } from "./quiet.ts";
import {
  consentedNearbyContacts,
  familyHasEnded,
  memberById,
  type Queryable,
  recentAnswerTimes,
} from "./repo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The notice as the sheet reads it, from rows the caller may see. Facts only, never her words. */
async function noticeOf(db: Queryable, quiet: QuietEvent, her: Member): Promise<ApiQuietNotice> {
  const [exchange] = await db
    .select()
    .from(exchanges)
    .where(eq(exchanges.id, quiet.exchangeId))
    .limit(1);
  const [lastAnswer] = await db
    .select({ at: answers.receivedAt })
    .from(answers)
    .where(eq(answers.memberId, her.id))
    .orderBy(desc(answers.receivedAt), desc(answers.id))
    .limit(1);
  const resolver = quiet.resolvedBy === null ? null : await memberById(db, quiet.resolvedBy);
  const contacts = await consentedNearbyContacts(db, her.id);
  return ApiQuietNotice.parse({
    quiet_event_id: quiet.id,
    member_id: her.id,
    member_name: her.displayName,
    delivered_at: exchange?.deliveredAt?.toISOString() ?? null,
    repeated_at: exchange?.repeatedAt?.toISOString() ?? null,
    usual_time: usualAnswerTime(await recentAnswerTimes(db, her.id, TUNING.minSamples), her.tz),
    last_answered_at: lastAnswer?.at.toISOString() ?? null,
    opened_at: quiet.openedAt.toISOString(),
    wait_until: quiet.waitUntil?.toISOString() ?? null,
    resolved:
      quiet.resolvedAt === null
        ? null
        : {
            outcome: quiet.outcome ?? "resolved",
            at: quiet.resolvedAt.toISOString(),
            by_name: resolver?.displayName ?? null,
          },
    contacts: contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      relation: contact.relation,
      phone: contact.phone,
    })),
  });
}

/**
 * The quiet notice for the app's sheet (`GET /v1/quiet/:quietEventId`, API contract §5, spec A11).
 * For the family's organisers only, as the Telegram notice is: it carries the numbers of the people
 * nearby who said yes, which are given to the ones the notice is for. Anyone else, and an event that
 * does not exist, gets null.
 */
export async function loadApiQuiet(
  db: Queryable,
  identity: SessionIdentity,
  quietEventId: string,
): Promise<ApiQuietNotice | null> {
  if (!UUID.test(quietEventId)) return null;
  const [quiet] = await db
    .select()
    .from(quietEvents)
    .where(eq(quietEvents.id, quietEventId))
    .limit(1);
  const her = quiet === undefined ? null : await memberById(db, quiet.memberId);
  if (quiet === undefined || her === null) return null;
  const access = await authorizeFamilyAccess(db, identity, her.familyId, "organiser");
  if (access.kind !== "granted") return null;
  return noticeOf(db, quiet, her);
}

/** The event under its row lock, with her, when the caller may act on it; otherwise a 404. */
async function lockForOrganiser(
  tx: VelaTransaction,
  identity: SessionIdentity,
  quietEventId: string,
): Promise<{ quiet: QuietEvent; her: Member; organiser: Member }> {
  const [quiet] = await tx
    .select()
    .from(quietEvents)
    .where(eq(quietEvents.id, quietEventId))
    .for("update");
  const her = quiet === undefined ? null : await memberById(tx, quiet.memberId);
  if (quiet === undefined || her === null || (await familyHasEnded(tx, her.familyId))) {
    throw new VelaError("not_found", "Quiet event not found");
  }
  const access = await authorizeFamilyAccess(tx, identity, her.familyId, "organiser");
  const organiser = access.kind === "granted" ? await memberById(tx, access.access.memberId) : null;
  if (organiser === null) throw new VelaError("not_found", "Quiet event not found");
  return { quiet, her, organiser };
}

/**
 * "She's fine" or "wait 2 hours" from the app (`POST /v1/quiet/:quietEventId/fine` and `/wait`,
 * API contract §5, spec A11): the Telegram buttons' own effects, through the same functions
 * (`resolveQuietAsFine`, `waitOnQuiet`), so the two surfaces cannot close or delay a quiet event
 * differently.
 *
 * The family is read from the event under its row lock in `authorize`, which runs on every attempt
 * including a replay; only the family's organisers may act, as only they are sent the notice. An
 * event already resolved is answered as it stands, not refused: a tap that lost a race with her
 * answer has nothing left to do, and says so by showing it resolved.
 *
 * The messages "she's fine" sends to the others who were told are written as rows and handed to the
 * queue after the commit, and "wait" wakes her scheduler after it, both through the returned
 * `AfterCommit` — on the first attempt only, since a replay changes nothing.
 */
export async function resolveApiQuiet(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  quietEventId: string,
  action: "fine" | "wait",
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  if (!QuietAction.safeParse(input).success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(quietEventId)) throw new VelaError("not_found", "Quiet event not found");
  const now = deps.clock.now();
  const after = nothingAfterCommit();

  const result = await runApiMutation(
    deps,
    identity,
    {
      key,
      operation: action === "fine" ? "quiet.fine:v1" : "quiet.wait:v1",
      input: { quiet_event_id: quietEventId.toLowerCase() },
    },
    {
      authorize: async (tx) => {
        await lockForOrganiser(tx, identity, quietEventId);
      },
      mutate: async (tx) => {
        const { quiet, her, organiser } = await lockForOrganiser(tx, identity, quietEventId);
        if (quiet.resolvedAt === null) {
          if (action === "fine") {
            await resolveQuietAsFine(
              tx,
              now,
              { quiet, her, resolver: organiser },
              async (request) => {
                const written = await insertOutbound(deps, tx, request);
                if ("outboundId" in written) after.outboundIds.push(written.outboundId);
              },
            );
          } else {
            await waitOnQuiet(tx, now, { quiet, her });
            after.wakeMemberIds.push(her.id);
          }
        }
        const [current] = await tx.select().from(quietEvents).where(eq(quietEvents.id, quiet.id));
        if (current === undefined) throw new Error("quiet event vanished under its own lock");
        // Without the contacts: this answer is kept a day to replay, and a number must not outlive
        // the yes that let the family have it.
        const { contacts: _contacts, ...state } = await noticeOf(tx, current, her);
        return { status: 200, body: ApiQuietState.parse(state) };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}
