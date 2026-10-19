/** Thirty minutes required by the runbook, plus fifteen minutes for migrations and both deploys. */
export const RELEASE_WINDOW_MINUTES = 45;

/** No names, identifiers, messages, addresses, or credentials are returned. */
export const RELEASE_WINDOW_QUERY = `
 select count(*)::int as active,
        count(*) filter (where m.next_wake_at is null)::int as unknown,
        count(*) filter (where m.next_wake_at <= now() + interval '45 minutes')::int as imminent
 from members m
 join families f on f.id = m.family_id
 where m.status = 'active' and m.left_at is null and f.deleted_at is null
   and m.light_on = true and m.light_consented_at is not null
`;

export function releaseWindowSafe(row: unknown): boolean {
  if (row === null || typeof row !== "object") return false;
  const counts = row as Record<string, unknown>;
  for (const key of ["active", "unknown", "imminent"]) {
    const value = counts[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return false;
  }
  return counts.unknown === 0 && counts.imminent === 0;
}
