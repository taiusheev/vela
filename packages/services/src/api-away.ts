/**
 * Away mode from the app (spec §8: "set by the organiser or any member"). A member of her family
 * says she is away from a day until a day, or until she is back; her arrivals continue, and repeats
 * and quiet notices stop for those days, as when she says so in an answer or the founder sets it.
 * Ending it brings them back. Each write is under her member row's lock, so two members setting the
 * same away at once store it once, and her schedule decides again after the commit.
 */
import { type ApiAway, type ApiMutationResponse, SetAway } from "@vela/contracts";
import { addDays, localDateOf } from "@vela/core";
import { awayPeriods, type Member, members, quietEvents, type VelaTransaction } from "@vela/db";
import { and, eq, isNull } from "drizzle-orm";
import { authorizeFamilyAccess, type SessionIdentity } from "./api-access.ts";
import { type AfterCommit, nothingAfterCommit } from "./api-after-commit.ts";
import { ApiIdempotencyError, runApiMutation } from "./api-idempotency.ts";
import type { Deps } from "./deps.ts";
import { VelaError } from "./errors.ts";
import { recordEvent } from "./events.ts";
import { insertOutbound } from "./gateway.ts";
import { resolveQuietAsAway } from "./quiet.ts";
import { markWakeDue } from "./repo.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How far ahead an away may start or end, as for one she says in an answer. */
export const AWAY_HORIZON_DAYS = 90;

/** An away the family cannot set: a day before her today, or past the horizon. */
export class AwayRefusedError extends Error {
  override readonly name = "AwayRefusedError";

  constructor() {
    super("Away refused: dates");
  }
}

function notFound(): VelaError {
  return new VelaError("not_found", "Member not found");
}

function isKeptLight(member: Member): boolean {
  return member.lightOn || member.lightConsentedAt !== null;
}

async function lockHer(tx: VelaTransaction, familyId: string, memberId: string): Promise<Member> {
  const [her] = await tx.select().from(members).where(eq(members.id, memberId)).for("update");
  if (her === undefined || her.familyId !== familyId || !isKeptLight(her)) throw notFound();
  return her;
}

/** Points her scheduler at now when she has a schedule, for the route to wake after the commit. */
async function decideAgain(tx: VelaTransaction, her: Member, at: Date, after: AfterCommit) {
  if (her.status !== "active") return;
  await markWakeDue(tx, her.id, at);
  after.wakeMemberIds.push(her.id);
}

/**
 * Sets her away (`POST /v1/families/:familyId/members/:memberId/away`): any live member of her
 * family; she must be its kept-light member, else 404. `from` from her today, both days within 90
 * days of it, else `AwayRefusedError`. The same open period again answers the one stored.
 */
export async function setApiAway(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
  input: unknown,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  const parsed = SetAway.safeParse(input);
  if (!parsed.success) throw new ApiIdempotencyError("invalid");
  if (!UUID.test(familyId) || !UUID.test(memberId)) throw notFound();
  const family = familyId.toLowerCase();
  const herId = memberId.toLowerCase();
  const now = deps.clock.now();
  const after = nothingAfterCommit();
  const result = await runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "away.set:v1",
      input: { member_id: herId, ...parsed.data },
      familyId: family,
      memberId: herId,
    },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family);
        if (access.kind !== "granted") throw notFound();
      },
      mutate: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family);
        if (access.kind !== "granted") throw notFound();
        // Her quiet morning first, then her row: the order her answer takes them in, so the two
        // cannot deadlock (`resolveQuietOnAnswer`).
        const [quiet] = await tx
          .select()
          .from(quietEvents)
          .where(and(eq(quietEvents.memberId, herId), isNull(quietEvents.resolvedAt)))
          .for("update");
        const her = await lockHer(tx, family, herId);
        const today = localDateOf(now, her.tz);
        const horizon = addDays(today, AWAY_HORIZON_DAYS);
        const { from, until } = parsed.data;
        if (from < today || from > horizon || (until !== null && until > horizon)) {
          throw new AwayRefusedError();
        }
        const [open] = await tx
          .select()
          .from(awayPeriods)
          .where(
            and(
              eq(awayPeriods.memberId, her.id),
              isNull(awayPeriods.endedAt),
              eq(awayPeriods.fromDate, from),
              until === null ? isNull(awayPeriods.toDate) : eq(awayPeriods.toDate, until),
            ),
          )
          .limit(1);
        const period =
          open ??
          (
            await tx
              .insert(awayPeriods)
              .values({
                memberId: her.id,
                fromDate: from,
                toDate: until,
                source: access.access.role === "organiser" ? "organiser" : "member",
                setBy: access.access.memberId,
                createdAt: now,
              })
              .returning()
          )[0];
        if (period === undefined) throw new Error("away period insert returned no row");
        if (open === undefined) {
          await recordEvent(
            tx,
            {
              name: "away_set",
              familyId: family,
              memberId: her.id,
              surface: "app",
              props: { source: period.source, from, until, set_by: access.access.memberId },
            },
            now,
          );
          await decideAgain(tx, her, now, after);
        }
        // Away from today closes a quiet morning that is open (spec §8), and tells who was told.
        if (quiet !== undefined && from <= today) {
          await resolveQuietAsAway(
            tx,
            now,
            { quiet, her, resolverId: access.access.memberId },
            async (request) => {
              const written = await insertOutbound(deps, tx, request);
              if ("outboundId" in written) after.outboundIds.push(written.outboundId);
            },
          );
        }
        const body: ApiAway = {
          id: period.id,
          member_id: her.id,
          from: period.fromDate,
          until: period.toDate,
          ended: false,
        };
        return { status: 201, body };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}

/**
 * "She's back" (`POST /v1/away/:awayId/end`): any live member of her family ends an away period,
 * whoever set it. One already ended answers as it stands; anyone else's family is 404.
 */
export async function endApiAway(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  awayId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  if (!UUID.test(awayId)) throw new VelaError("not_found", "Away not found");
  const id = awayId.toLowerCase();
  const [found] = await deps.db
    .select({ familyId: members.familyId, memberId: members.id })
    .from(awayPeriods)
    .innerJoin(members, eq(members.id, awayPeriods.memberId))
    .where(eq(awayPeriods.id, id))
    .limit(1);
  const now = deps.clock.now();
  const after = nothingAfterCommit();
  const result = await runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "away.end:v1",
      input: { away_id: id },
      ...(found === undefined ? {} : { familyId: found.familyId, memberId: found.memberId }),
    },
    {
      authorize: async (tx) => {
        if (found === undefined) throw new VelaError("not_found", "Away not found");
        const access = await authorizeFamilyAccess(tx, identity, found.familyId);
        if (access.kind !== "granted") throw new VelaError("not_found", "Away not found");
      },
      mutate: async (tx) => {
        if (found === undefined) throw new VelaError("not_found", "Away not found");
        const access = await authorizeFamilyAccess(tx, identity, found.familyId);
        if (access.kind !== "granted") throw new VelaError("not_found", "Away not found");
        const her = await lockHer(tx, found.familyId, found.memberId);
        const [period] = await tx.select().from(awayPeriods).where(eq(awayPeriods.id, id)).limit(1);
        if (period === undefined) throw new VelaError("not_found", "Away not found");
        if (period.endedAt === null) {
          await tx.update(awayPeriods).set({ endedAt: now }).where(eq(awayPeriods.id, id));
          await recordEvent(
            tx,
            {
              name: "away_ended",
              familyId: found.familyId,
              memberId: her.id,
              surface: "app",
              props: {
                source: period.source,
                from: period.fromDate,
                until: period.toDate,
                by: "member",
              },
            },
            now,
          );
          await decideAgain(tx, her, now, after);
        }
        const body: ApiAway = {
          id,
          member_id: her.id,
          from: period.fromDate,
          until: period.toDate,
          ended: true,
        };
        return { status: 200, body };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}

/**
 * She has died (spec §19, `POST /v1/families/:familyId/members/:memberId/deceased`): an organiser
 * of her family says so. The app offers no way to it yet: the founder decides how it is confirmed
 * and worded first (3 October 2026), and until then the founder marks it from the admin page. Her light goes off and her schedule is cleared, and from here
 * nothing is sent about her to anyone, as when the founder marks it (`markDeceased`). Saying it
 * again answers as it stands. It cannot be undone from the app.
 */
export async function markApiDeceased(
  deps: Pick<Deps, "db" | "clock">,
  identity: SessionIdentity,
  key: string,
  familyId: string,
  memberId: string,
): Promise<{ response: ApiMutationResponse; replayed: boolean; after: AfterCommit }> {
  if (!UUID.test(familyId) || !UUID.test(memberId)) throw notFound();
  const family = familyId.toLowerCase();
  const herId = memberId.toLowerCase();
  const now = deps.clock.now();
  const after = nothingAfterCommit();
  const result = await runApiMutation(
    deps,
    identity,
    {
      key,
      operation: "member.deceased:v1",
      input: { member_id: herId },
      familyId: family,
      memberId: herId,
    },
    {
      authorize: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
        if (access.kind !== "granted") throw notFound();
      },
      mutate: async (tx) => {
        const access = await authorizeFamilyAccess(tx, identity, family, "organiser");
        if (access.kind !== "granted") throw notFound();
        const her = await lockHer(tx, family, herId);
        if (her.status !== "deceased") {
          await tx
            .update(members)
            .set({ lightOn: false, status: "deceased", nextWakeAt: null })
            .where(eq(members.id, her.id));
          await recordEvent(
            tx,
            {
              name: "member_marked_deceased",
              familyId: family,
              memberId: her.id,
              surface: "app",
              props: { by: access.access.memberId },
            },
            now,
          );
          // Her alarm, if one is set, finds her deceased and does nothing more.
          after.wakeMemberIds.push(her.id);
        }
        return { status: 200, body: { member_id: her.id, status: "deceased" } };
      },
    },
  );
  return { ...result, after: result.replayed ? nothingAfterCommit() : after };
}
