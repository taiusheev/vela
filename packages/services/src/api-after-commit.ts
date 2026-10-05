/**
 * What an API write leaves to be done after its commit.
 *
 * A `runApiMutation` callback may not send a message or wake a scheduler: its transaction can still
 * roll back, and a replay skips it (code design §8). So the callback writes what those effects are
 * made of — `queued` outbound rows (`insertOutbound`), and a member's `next_wake_at` marked due — and
 * the route carries them out once the write has committed, on the first attempt only. Nothing is
 * lost when that step fails or never runs: `reconcile` re-drives an outbound row still `queued` past
 * its time, and ticks a member whose wake has passed. The nudge only makes it prompt, and keeps those
 * safety nets from reporting a write that was never actually stranded.
 */
export interface AfterCommit {
  /** Outbound rows written by the mutation, to hand to the delivery queue. */
  outboundIds: string[];
  /** Kept-light members whose schedule must decide again now. */
  wakeMemberIds: string[];
}

export function nothingAfterCommit(): AfterCommit {
  return { outboundIds: [], wakeMemberIds: [] };
}

/** How the runtime carries an `AfterCommit` out: the queue, and her scheduler's alarm. */
export interface ApiNudges {
  deliver(outboundId: string): Promise<void>;
  wake(memberId: string, at: Date): Promise<void>;
}

/**
 * Carries out what a committed write left behind. Every failure is reported and none is thrown: the
 * write has already committed and been answered for, and `reconcile` finishes whatever this misses.
 */
export async function runAfterCommit(
  nudges: ApiNudges | undefined,
  after: AfterCommit,
  now: Date,
  report: (event: string, fields: Record<string, string>) => void,
): Promise<void> {
  if (nudges === undefined) return;
  for (const outboundId of after.outboundIds) {
    try {
      await nudges.deliver(outboundId);
    } catch {
      report("api_after_commit_deliver_failed", { outboundId });
    }
  }
  for (const memberId of after.wakeMemberIds) {
    try {
      await nudges.wake(memberId, now);
    } catch {
      report("api_after_commit_wake_failed", { memberId });
    }
  }
}
