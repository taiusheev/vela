/**
 * Whose turn it is to ask tomorrow (spec §7): round robin over the family's turn holders in the
 * order they joined.
 */

export interface TurnHolder {
  memberId: string;
  joinedAt: Date;
}

/** Join order; the member id breaks ties so two people added in the same instant keep one order. */
function compare(a: TurnHolder, b: TurnHolder): number {
  const byTime = a.joinedAt.getTime() - b.joinedAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
}

/**
 * The holder after `previousHolderId` in join order, wrapping to the first; the first holder when
 * there was no previous turn; `null` when nobody holds turns.
 *
 * When the previous holder has left they are no longer among `holders`, and their place in the
 * order is only known from when they joined. Given `previousJoinedAt`, the turn passes to whoever
 * joined next after them, so nobody waiting behind them loses a turn. Without it the rotation
 * restarts from the first holder, which is still deterministic for the same input.
 */
export function nextTurnHolder(
  holders: TurnHolder[],
  previousHolderId: string | null,
  previousJoinedAt: Date | null = null,
): string | null {
  const ordered = [...holders].sort(compare);
  const first = ordered[0];
  if (first === undefined) {
    return null;
  }
  if (previousHolderId === null) {
    return first.memberId;
  }
  const previous =
    ordered.find((holder) => holder.memberId === previousHolderId) ??
    (previousJoinedAt === null
      ? undefined
      : { memberId: previousHolderId, joinedAt: previousJoinedAt });
  if (previous === undefined) {
    return first.memberId;
  }
  const next = ordered.find((holder) => compare(holder, previous) > 0);
  return (next ?? first).memberId;
}
