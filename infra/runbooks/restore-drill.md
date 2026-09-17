# Restore drill

17 September 2026 · architecture §13 (quarterly drill) · build plan 2.8 (drill #1) and 5.7 (drill #2) · done by the founder, because the restored copy holds real family data

## When to use it

- Quarterly, and drill #1 before the first Taiwanese families (sprint 2), drill #2 in sprint 5.
- After changing the Neon plan, the restore window or the database role setup.
- For real, when production data was destroyed or corrupted (last section).

Before starting, note the restore window: Neon's Free plan keeps at most 6 hours of history, Launch up to 7 days, Scale up to 30 days (Neon plans page, September 2026). A 6-hour window means a problem noticed the next morning cannot be undone; decide on the plan before families beyond the founder's own join.

The restored branch is a full copy of production. Only the founder connects to it, queries return counts and identifiers only, nothing is exported or screenshotted, and it is deleted the same day.

## Steps

1. **Record T0 and counts on `main`.** In the Neon console, **SQL Editor**, branch `main`:

   ```sql
   SELECT now() AS t0;
   ```

   Copy the value, then run with that value in place of `<T0>`:

   ```sql
   SELECT 'families' AS t, count(*) FROM families WHERE created_at <= '<T0>'
   UNION ALL SELECT 'members', count(*) FROM members WHERE created_at <= '<T0>'
   UNION ALL SELECT 'exchanges', count(*) FROM exchanges WHERE created_at <= '<T0>'
   UNION ALL SELECT 'answers', count(*) FROM answers WHERE received_at <= '<T0>'
   UNION ALL SELECT 'replies', count(*) FROM replies WHERE created_at <= '<T0>'
   UNION ALL SELECT 'media', count(*) FROM media WHERE created_at <= '<T0>'
   UNION ALL SELECT 'consents', count(*) FROM consents WHERE given_at <= '<T0>'
   UNION ALL SELECT 'quiet_events', count(*) FROM quiet_events WHERE opened_at <= '<T0>'
   UNION ALL SELECT 'outbound', count(*) FROM outbound WHERE queued_at <= '<T0>'
   UNION ALL SELECT 'deletions', count(*) FROM deletions WHERE deleted_at <= '<T0>';
   ```

   Also note the latest applied migration (Drizzle's migrations table, by default `drizzle.__drizzle_migrations`).
2. **Wait 5 minutes**, then **Branches → New branch**: name `restore-drill-YYYY-MM-DD`, parent `main`, "from a specific date and time" = T0, smallest compute. Start a timer.
3. **Run the same queries on the new branch**, and check the constraints the product depends on exist:

   ```sql
   SELECT indexname FROM pg_indexes
   WHERE indexname IN ('exchanges_one_per_day', 'outbound_budget_idx');
   ```

4. **Compare.** Counts must match. A difference can only come from a write that committed in the seconds around T0, or a retention deletion in the same minutes (visible as a `deletions` row); explain each one in the log.
5. **Check media.** On the branch, list five `storage_key` values of unkept media from the last 30 days; in the "Vela" account's Cloudflare dashboard, on the **R2 object storage** page, open the bucket `vela-media-production` and confirm each object exists. R2 objects deleted after T0 cannot come back with the database; record how many are missing and why.
6. **Stop the timer** and record the time to restore.
7. **Delete the branch** (**Branches → `restore-drill-…` → Delete**) and confirm it no longer appears.
8. **Log it** in the table below.

## How to know it worked

The log row is complete: counts matched or every difference is explained, the constraints were present, media keys resolved, the time to restore is recorded (target: under 1 hour), and the branch was deleted the same day.

## Doing it for real

1. Declare a Sev 1 incident ([`incident.md`](incident.md)) and stop the cause first (roll back the release).
2. Find the last good moment from events and logs. Create a branch at that moment and compare before touching `main`.
3. Prefer copying back only the damaged rows from the branch. If that is not possible, use Neon's restore of `main` to the timestamp; Neon keeps the pre-restore state as a backup branch.
4. After a restore: confirm `/healthz` and the admin page; let reconciliation run; tell organisers whose answers or asks after the restore point were lost.
5. **Re-apply deletions.** Any data deleted after the restore point (retention jobs, a person's deletion request, a family deleted) has come back. Use the `deletions` rows on the backup branch after the restore point to delete it again, and run `applyRetention`. Before deleting a member or a nearby contact again, forget their consent rows ([`data-requests.md`](data-requests.md), "Forgetting before a deletion"), or the database refuses the delete; a restored `consents` row whose subject was deleted after the restore point holds the words again until it is forgotten.
6. Delete the backup branch within 7 days, once the restore is verified, because it holds data that may be past its retention.

## Drill log

| Date | Plan and window | T0 | Counts matched | Differences explained | Media keys resolved | Time to restore | Branch deleted | By |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
