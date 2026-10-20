/** Overlapping screen/focus/pull refreshes share the read already in flight, rather than cancel
 * and restart it. Explicit refresh still bypasses staleTime and updates the current account. */
export async function refreshReads(
  ...reads: ((options: { cancelRefetch: boolean }) => Promise<unknown>)[]
): Promise<void> {
  await Promise.all(reads.map((refetch) => refetch({ cancelRefetch: false })));
}
