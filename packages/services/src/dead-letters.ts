/**
 * Dead jobs (technical plan 2.7): a queue job that failed every retry reaches the environment's
 * dead-letter queue, whose consumer keeps it here, sealed, for 14 days. Most jobs name a row
 * reconcile drives again anyway, but a LINE inbound job is the only copy of her answer once LINE
 * has been answered, so nothing that reaches the dead-letter queue is dropped unseen: the founder's
 * hourly ops alert counts new ones (`ops.ts`), the admin overview lists them without their content,
 * and the founder can ask for one to be sent again. Only the pilot Worker holds every queue, so
 * the request is a mark, and its reconcile claims the marked jobs and sends each again once.
 */
import { DEAD_LETTER_JOB_TYPES, type DeadLetter, deadLetters } from "@vela/db";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Deps } from "./deps.ts";

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
  const kept = await deps.db
    .insert(deadLetters)
    .values({
      messageId: input.messageId,
      jobType: input.jobType,
      job: input.job as DeadLetter["job"],
      failedAt: deps.clock.now(),
    })
    .onConflictDoNothing({ target: deadLetters.messageId })
    .returning({ id: deadLetters.id });
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
  const due = deps.db
    .select({ id: deadLetters.id })
    .from(deadLetters)
    .where(and(isNotNull(deadLetters.replayRequestedAt), isNull(deadLetters.replayedAt)))
    .limit(20)
    .for("update", { skipLocked: true });
  const claimed = await deps.db
    .update(deadLetters)
    .set({ replayedAt: deps.clock.now() })
    .where(and(inArray(deadLetters.id, due), isNull(deadLetters.replayedAt)))
    .returning({ id: deadLetters.id, jobType: deadLetters.jobType, job: deadLetters.job });
  return claimed.map((row) => ({ id: row.id, jobType: row.jobType, job: row.job }));
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

/** New dead jobs since `from`, for the founder's hourly ops alert. */
export async function countDeadLettersSince(deps: Pick<Deps, "db">, from: Date): Promise<number> {
  const [row] = await deps.db
    .select({ count: sql<number>`count(*)::int` })
    .from(deadLetters)
    .where(sql`${deadLetters.failedAt} >= ${from}`);
  return row?.count ?? 0;
}
