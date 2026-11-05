/**
 * Dead jobs (technical plan 2.7): a queue job that failed every retry reaches the environment's
 * dead-letter queue, whose consumer keeps it here, sealed, for 14 days. Most jobs name a row
 * reconcile drives again anyway, but a LINE inbound job is the only copy of her answer once LINE
 * has been answered, so live subjects' messages are recoverable. Unowned or erased subjects are discarded; the founder's
 * hourly ops alert counts new ones (`ops.ts`), the admin overview lists them without their content,
 * and the founder can ask for one to be sent again. Only the pilot Worker holds every queue, so
 * the request is a mark, and its reconcile claims the marked jobs and sends each again once.
 */
import { InboundEvent } from "@vela/contracts";
import {
  accountLinkChallenges,
  channelLinks,
  DEAD_LETTER_JOB_TYPES,
  type DeadLetter,
  deadLetters,
  families,
  familyChannels,
  invites,
  members,
  nearbyContacts,
  onboardingSessions,
  users,
} from "@vela/db";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Deps } from "./deps.ts";
import { sha256Hex } from "./hash.ts";
import { inviteTokenHash } from "./invites.ts";
import type { Queryable } from "./repo.ts";

/** Recovery insert/replay takes no entity row locks. Erasing writers take this lock after any
 * API actor lock, before receipt/family/member/contact rows. A late delivery is either scrubbed by
 * erasure or reads the committed erasure and cannot recreate the recovery copy. */
export async function lockDeadLetters(tx: Queryable): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('vela:dead-letter-erasure:v1', 0))`,
  );
}

interface ForgottenSubjects {
  memberIds?: readonly string[];
  contactIds?: readonly string[];
  userIds?: readonly string[];
}

/** Unowned or deleted subjects' words are never retained just because a queue retried late. */
async function liveInbound(
  tx: Queryable,
  event: InboundEvent,
  forgotten: ForgottenSubjects,
  now: Date,
): Promise<boolean> {
  if (Date.parse(event.at) <= now.getTime() - 30 * DAY_MS) return false;
  const token = event.kind === "start" ? event.startParam?.trim() : undefined;
  // A link challenge belongs to the app account even when the messenger sender is still a
  // live family member. Never fall back to that membership after the challenge was erased.
  if (token?.startsWith("link_")) {
    const challengeId =
      /^link_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(token)?.[1];
    if (challengeId === undefined || event.conversation.kind !== "private") return false;
    const [challenge] = await tx
      .select({ user: users, challenge: accountLinkChallenges })
      .from(accountLinkChallenges)
      .innerJoin(users, eq(users.id, accountLinkChallenges.userId))
      .where(eq(accountLinkChallenges.id, challengeId));
    if (challenge === undefined) return false;
    const familyLive =
      challenge.challenge.familyId === null ||
      (
        await tx
          .select({ deletedAt: families.deletedAt })
          .from(families)
          .where(eq(families.id, challenge.challenge.familyId))
      )[0]?.deletedAt === null;
    return (
      familyLive &&
      !forgotten.memberIds?.includes(challenge.challenge.memberId ?? "") &&
      challenge.user.deletedAt === null &&
      !forgotten.userIds?.includes(challenge.user.id) &&
      challenge.challenge.expiresAt > now &&
      challenge.challenge.invalidatedAt === null
    );
  }
  const [person] = await tx
    .select({ member: members, family: families, linkedAt: channelLinks.linkedAt })
    .from(channelLinks)
    .innerJoin(members, eq(members.id, channelLinks.memberId))
    .innerJoin(families, eq(families.id, members.familyId))
    .where(
      and(
        eq(channelLinks.channel, event.channel),
        eq(channelLinks.externalId, event.sender.externalUserId),
      ),
    );
  if (event.conversation.kind !== "private") {
    const [group] = await tx
      .select({ family: families, linkedAt: familyChannels.linkedAt })
      .from(familyChannels)
      .innerJoin(families, eq(families.id, familyChannels.familyId))
      .where(
        and(
          eq(familyChannels.channel, event.channel),
          eq(familyChannels.conversationId, event.conversation.externalId),
          isNull(familyChannels.unlinkedAt),
        ),
      );
    return (
      group !== undefined &&
      group.family.deletedAt === null &&
      group.linkedAt <= new Date(event.at) &&
      (person === undefined ||
        (!forgotten.memberIds?.includes(person.member.id) &&
          person.member.status !== "left" &&
          person.member.status !== "deceased"))
    );
  }
  if (person !== undefined)
    return (
      person.family.deletedAt === null &&
      !forgotten.memberIds?.includes(person.member.id) &&
      person.member.status !== "left" &&
      person.member.status !== "deceased" &&
      person.linkedAt <= new Date(event.at)
    );

  const tokenHash = token === undefined ? undefined : await sha256Hex(token);
  const contacts = await tx
    .select({ contact: nearbyContacts, family: families, member: members })
    .from(nearbyContacts)
    .innerJoin(families, eq(families.id, nearbyContacts.familyId))
    .innerJoin(members, eq(members.id, nearbyContacts.memberId))
    .where(sql`(${nearbyContacts.channel} = ${event.channel} and ${nearbyContacts.externalId} = ${event.sender.externalUserId})
      or (${nearbyContacts.inviteTokenHash} = ${tokenHash ?? null})`);
  if (
    contacts.some(
      ({ contact, family, member }) =>
        family.deletedAt === null &&
        member.status !== "left" &&
        member.status !== "deceased" &&
        !forgotten.memberIds?.includes(member.id) &&
        !forgotten.contactIds?.includes(contact.id),
    )
  )
    return true;
  if (token !== undefined) {
    const [invitation] = await tx
      .select({ invite: invites, family: families })
      .from(invites)
      .innerJoin(families, eq(families.id, invites.familyId))
      .where(eq(invites.tokenHash, await inviteTokenHash(token)));
    if (
      invitation !== undefined &&
      invitation.family.deletedAt === null &&
      invitation.invite.expiresAt > now &&
      !forgotten.memberIds?.includes(invitation.invite.forMemberId ?? "") &&
      !forgotten.memberIds?.includes(invitation.invite.invitedBy)
    )
      return true;
  }
  // Before a family exists, an active setup conversation still owns its recovery copy.
  const [setup] = await tx
    .select({ expiresAt: onboardingSessions.expiresAt })
    .from(onboardingSessions)
    .where(
      and(
        eq(onboardingSessions.channel, event.channel),
        eq(onboardingSessions.conversationId, event.conversation.externalId),
        eq(onboardingSessions.externalUserId, event.sender.externalUserId),
      ),
    );
  return setup !== undefined && setup.expiresAt > now;
}

async function sanitiseJob(
  tx: Queryable,
  row: Pick<DeadLetter, "jobType" | "job">,
  now: Date,
  forgotten: ForgottenSubjects = {},
): Promise<DeadLetter["job"] | null> {
  if (row.jobType !== "handle_inbound") return row.job;
  if (!Array.isArray(row.job.events)) return null;
  const events: InboundEvent[] = [];
  for (const raw of row.job.events) {
    const event = InboundEvent.safeParse(raw);
    if (event.success && (await liveInbound(tx, event.data, forgotten, now)))
      events.push(event.data);
  }
  return events.length === 0 ? null : { type: "handle_inbound", events };
}

/** In the erasing caller's transaction, before its last identity links disappear. Mixed batches
 * keep only the other families' events. Also upgrades recovery copies written by older Workers. */
export async function scrubDeadLetters(
  tx: Queryable,
  now: Date,
  forgotten: ForgottenSubjects = {},
): Promise<number> {
  await lockDeadLetters(tx);
  const rows = await tx.select().from(deadLetters).where(eq(deadLetters.jobType, "handle_inbound"));
  let changed = 0;
  for (const row of rows) {
    const job = await sanitiseJob(tx, row, now, forgotten);
    if (job === null) {
      await tx.delete(deadLetters).where(eq(deadLetters.id, row.id));
      changed++;
    } else if (JSON.stringify(job) !== JSON.stringify(row.job)) {
      await tx.update(deadLetters).set({ job }).where(eq(deadLetters.id, row.id));
      changed++;
    }
  }
  return changed;
}

/** How long a dead job is kept; the nightly retention deletes older ones. */
export const DEAD_LETTER_RETENTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DeadLetterJobType = (typeof DEAD_LETTER_JOB_TYPES)[number];

export function isDeadLetterJobType(value: unknown): value is DeadLetterJobType {
  return (DEAD_LETTER_JOB_TYPES as readonly unknown[]).includes(value);
}

/**
 * Keeps one dead job. The queue's message id makes it idempotent: a dead-letter message the queue
 * delivers twice is kept once. Returns whether this call kept it.
 */
export async function keepDeadLetter(
  deps: Pick<Deps, "db" | "clock" | "logger">,
  input: { messageId: string; jobType: DeadLetterJobType; job: Record<string, unknown> },
): Promise<boolean> {
  const kept = await deps.db.transaction(async (tx) => {
    await lockDeadLetters(tx);
    const job = await sanitiseJob(
      tx,
      { jobType: input.jobType, job: input.job as DeadLetter["job"] },
      deps.clock.now(),
    );
    if (job === null) {
      deps.logger.warn("dead_letter_discarded", { type: input.jobType, reason: "no_live_subject" });
      return [];
    }
    return tx
      .insert(deadLetters)
      .values({
        messageId: input.messageId,
        jobType: input.jobType,
        job,
        failedAt: deps.clock.now(),
      })
      .onConflictDoNothing({ target: deadLetters.messageId })
      .returning({ id: deadLetters.id });
  });
  if (kept.length > 0) {
    deps.logger.error("dead_letter_kept", { type: input.jobType, id: kept[0]?.id ?? null });
  }
  return kept.length > 0;
}

/** A dead job as the admin overview shows it: never its content. */
export interface DeadLetterRow {
  readonly id: string;
  readonly jobType: DeadLetterJobType;
  readonly failedAt: Date;
  readonly replayRequestedAt: Date | null;
  readonly replayedAt: Date | null;
}

export async function loadDeadLetters(
  deps: Pick<Deps, "db">,
  limit = 50,
): Promise<DeadLetterRow[]> {
  return deps.db
    .select({
      id: deadLetters.id,
      jobType: deadLetters.jobType,
      failedAt: deadLetters.failedAt,
      replayRequestedAt: deadLetters.replayRequestedAt,
      replayedAt: deadLetters.replayedAt,
    })
    .from(deadLetters)
    .orderBy(desc(deadLetters.failedAt))
    .limit(limit);
}

export type ReplayRequest = "requested" | "already" | "not_found";

/** The founder asks for one dead job to be sent again; asking twice changes nothing. */
export async function requestDeadLetterReplay(
  deps: Pick<Deps, "db" | "clock" | "logger">,
  id: string,
): Promise<ReplayRequest> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return "not_found";
  const marked = await deps.db
    .update(deadLetters)
    .set({ replayRequestedAt: deps.clock.now() })
    .where(and(eq(deadLetters.id, id), isNull(deadLetters.replayRequestedAt)))
    .returning({ id: deadLetters.id });
  if (marked.length > 0) {
    deps.logger.info("dead_letter_replay_requested", { id });
    return "requested";
  }
  const [exists] = await deps.db
    .select({ id: deadLetters.id })
    .from(deadLetters)
    .where(eq(deadLetters.id, id));
  return exists === undefined ? "not_found" : "already";
}

/**
 * The marked jobs reconcile should send again, each claimed by setting `replayed_at` in the same
 * statement that selects it, so two reconciles never both send one. A job whose send then fails is
 * given back with `releaseDeadLetterReplay`.
 */
export async function claimDeadLetterReplays(
  deps: Pick<Deps, "db" | "clock">,
): Promise<{ id: string; jobType: DeadLetterJobType; job: Record<string, unknown> }[]> {
  return deps.db.transaction(async (tx) => {
    await scrubDeadLetters(tx, deps.clock.now());
    const due = tx
      .select({ id: deadLetters.id })
      .from(deadLetters)
      .where(and(isNotNull(deadLetters.replayRequestedAt), isNull(deadLetters.replayedAt)))
      .limit(20)
      .for("update", { skipLocked: true });
    const claimed = await tx
      .update(deadLetters)
      .set({ replayedAt: deps.clock.now() })
      .where(and(inArray(deadLetters.id, due), isNull(deadLetters.replayedAt)))
      .returning({ id: deadLetters.id, jobType: deadLetters.jobType, job: deadLetters.job });
    return claimed.map((row) => ({ id: row.id, jobType: row.jobType, job: row.job }));
  });
}

export async function releaseDeadLetterReplay(deps: Pick<Deps, "db">, id: string): Promise<void> {
  await deps.db.update(deadLetters).set({ replayedAt: null }).where(eq(deadLetters.id, id));
}

/** Nightly: dead jobs older than 14 days go. Returns how many. */
export async function deleteOldDeadLetters(deps: Pick<Deps, "db" | "clock">): Promise<number> {
  const cutoff = new Date(deps.clock.now().getTime() - DEAD_LETTER_RETENTION_DAYS * DAY_MS);
  const deleted = await deps.db
    .delete(deadLetters)
    .where(lt(deadLetters.failedAt, cutoff))
    .returning({ id: deadLetters.id });
  return deleted.length;
}

/** Dead jobs kept from `from` until before `to`, for the founder's hourly ops alert. */
export async function countDeadLettersSince(
  deps: Pick<Deps, "db">,
  from: Date,
  to: Date = new Date(8.64e15),
): Promise<number> {
  const [row] = await deps.db
    .select({ count: sql<number>`count(*)::int` })
    .from(deadLetters)
    .where(sql`${deadLetters.failedAt} >= ${from} and ${deadLetters.failedAt} < ${to}`);
  return row?.count ?? 0;
}
