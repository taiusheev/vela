/**
 * Memory and reminders (spec §12, build plan 5.3). Understanding keeps what she said will happen on
 * a known day as a dated memory fact (`pipeline.ts`, `keepDatedPlans`). Each family member is offered
 * the coming ones as "Remind me to ask", and a reminder exists only after that tap. On the day after
 * hers, the reminder asks the member to ask her how it went. Nothing here ever reaches her: it
 * appears to her only as a person asking.
 */
import type { ApiMutationResponse, ApiReminder, ApiReminders } from "@vela/contracts";
import { CreateReminder } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { members, memoryFacts, reminders } from "@vela/db";
import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import type { Queryable } from "./repo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fact the reminder cannot be made from: unknown, not of the family, past, or the caller's own. */
export class FactMissingError extends Error {
  override readonly name = "FactMissingError";

  constructor() {
    super("Reminder refused: fact_missing");
  }
}

function nameOf(member: { addressForm: string | null; displayName: string }): string {
  return member.addressForm ?? member.displayName;
}

/**
 * The caller's reminders and suggestions in one family (`GET /v1/families/:familyId/reminders`):
 * the coming dated facts of anyone in the family but the caller, from her today on, that the caller
 * has no reminder for; and the caller's own reminders not yet done. Null for anyone not a live
 * member of the family.
 */
export async function loadApiReminders(
  db: Queryable,
  identity: SessionIdentity,
  familyId: string,
  now: Date,
): Promise<ApiReminders | null> {
  if (!UUID.test(familyId)) return null;
  const found = await authorizeFamilyAccess(db, identity, familyId);
  if (found.kind !== "granted") return null;
  const viewer = found.access.memberId;
  const facts = await db
    .select({ fact: memoryFacts, her: members })
    .from(memoryFacts)
    .innerJoin(members, eq(members.id, memoryFacts.memberId))
    .where(
      and(
        eq(memoryFacts.familyId, found.access.familyId),
        eq(memoryFacts.kind, "date"),
        ne(memoryFacts.memberId, viewer),
        gt(memoryFacts.expiresAt, now),
      ),
    )
    .orderBy(asc(memoryFacts.onDate), asc(memoryFacts.id));
  const mine = await db
    .select({ reminder: reminders, her: members })
    .from(reminders)
    .innerJoin(members, eq(members.id, reminders.aboutMemberId))
    .where(and(eq(reminders.memberId, viewer), isNull(reminders.doneAt)))
    .orderBy(asc(reminders.dueDate), asc(reminders.id));
  const reminded = new Set(mine.map(({ reminder }) => reminder.factId));
  const done = await db
    .select({ factId: reminders.factId })
    .from(reminders)
    .where(eq(reminders.memberId, viewer));
  for (const row of done) reminded.add(row.factId);
  return {
    suggestions: facts.flatMap(({ fact, her }) =>
      fact.onDate === null || reminded.has(fact.id) || fact.onDate < localDateOf(now, her.tz)
        ? []
        : [
            {
              fact_id: fact.id,
              about_member_id: her.id,
              about_name: nameOf(her),
              what: fact.text,
              on: fact.onDate,
            },
          ],
    ),
    reminders: mine.map(
      ({ reminder, her }): ApiReminder => ({
        id: reminder.id,
        about_member_id: her.id,
        about_name: nameOf(her),
        what: reminder.text,
        due_date: reminder.dueDate,
        done: false,
      }),
    ),
  };
}

/**
 * "Remind me to ask" (`POST /v1/families/:familyId/reminders`): the caller's reminder for one of the
 * family's coming facts, due the day after it. One per member and fact: a second tap, or two at
 * once under different keys, answers with the first (`reminders_one_per_fact`). 404 `fact_missing`
 * for a fact the caller cannot be reminded of.
 */
export async function createApiReminder(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  const parsed = CreateReminder.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(familyId)) throw new VelaError("not_found", "Family not found");
  const factId = parsed.data.fact_id.toLowerCase();
  const now = deps.clock.now();
  return runApiMutation(
    deps,
    identity,
    { key, operation: "reminder.create:v1", input: { family_id: familyId, fact_id: factId } },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, familyId);
        if (access.kind !== "granted") throw new VelaError("not_found", "Family not found");
      },
      mutate: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, familyId);
        if (access.kind !== "granted") throw new VelaError("not_found", "Family not found");
        const viewer = access.access.memberId;
        const [row] = await tx
          .select({ fact: memoryFacts, her: members })
          .from(memoryFacts)
          .innerJoin(members, eq(members.id, memoryFacts.memberId))
          .where(
            and(
              eq(memoryFacts.id, factId),
              eq(memoryFacts.familyId, access.access.familyId),
              eq(memoryFacts.kind, "date"),
              gt(memoryFacts.expiresAt, now),
            ),
          )
          .limit(1);
        const on = row?.fact.onDate ?? null;
        if (
          row === undefined ||
          on === null ||
          row.her.id === viewer ||
          on < localDateOf(now, row.her.tz)
        ) {
          throw new FactMissingError();
        }
        await tx
          .insert(reminders)
          .values({
            familyId: access.access.familyId,
            memberId: viewer,
            aboutMemberId: row.her.id,
            text: row.fact.text,
            dueDate: addDays(on, 1),
            factId,
          })
          .onConflictDoNothing();
        const [reminder] = await tx
          .select()
          .from(reminders)
          .where(and(eq(reminders.memberId, viewer), eq(reminders.factId, factId)))
          .limit(1);
        if (reminder === undefined) throw new Error("reminder vanished after its insert");
        const body: ApiReminder = {
          id: reminder.id,
          about_member_id: row.her.id,
          about_name: nameOf(row.her),
          what: reminder.text,
          due_date: reminder.dueDate,
          done: reminder.doneAt !== null,
        };
        return { status: 201, body };
      },
    },
  );
}

/**
 * "Done" (`POST /v1/reminders/:reminderId/done`): the caller's own reminder, finished. Retention
 * deletes it two days after it was due. Anyone else's reminder, or an unknown one, is 404.
 */
export async function finishApiReminder(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  reminderId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean }> {
  if (!UUID.test(reminderId)) throw new VelaError("not_found", "Reminder not found");
  const id = reminderId.toLowerCase();
  const [found] = await deps.db
    .select({ familyId: reminders.familyId })
    .from(reminders)
    .where(eq(reminders.id, id))
    .limit(1);
  const now = deps.clock.now();
  const own = async (tx: Queryable) => {
    if (found === undefined) throw new VelaError("not_found", "Reminder not found");
    const access = await authorizeFamilyAccess(tx, identity, found.familyId);
    if (access.kind !== "granted") throw new VelaError("not_found", "Reminder not found");
    const [reminder] = await tx
      .select()
      .from(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.memberId, access.access.memberId)))
      .for("update")
      .limit(1);
    if (reminder === undefined) throw new VelaError("not_found", "Reminder not found");
    return reminder;
  };
  return runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "reminder.done:v1",
      input: { reminder_id: id },
      ...(found === undefined ? {} : { familyId: found.familyId }),
    },
    {
      authorize: async (tx) => {
        await own(tx);
      },
      mutate: async (tx) => {
        const reminder = await own(tx);
        if (reminder.doneAt === null) {
          await tx.update(reminders).set({ doneAt: now }).where(eq(reminders.id, reminder.id));
        }
        return { status: 200, body: { id: reminder.id, done: true } };
      },
    },
  );
}
