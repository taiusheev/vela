# Restore drill

18 September 2026 · architecture §13 (quarterly drill) · build plan 2.8 (drill #1) and 5.7 (drill #2) · done by the founder, because the restored copy holds real family data

## When to use it

- Quarterly, and drill #1 before the first Taiwanese families (sprint 2), drill #2 in sprint 5.
- After changing the Neon plan, the restore window or the database role setup.
- For real, when production data was destroyed or corrupted (last section).

Before starting, note the restore window: Neon's Free plan keeps at most 6 hours of history, Launch up to 7 days, Scale up to 30 days (Neon plans page, September 2026). A 6-hour window means a problem noticed the next morning cannot be undone; decide on the plan before the first family joins. The plan is the Neon organisation's, not one project's, so moving to Launch also bills `vela-staging` per compute hour (`infra/README.md`, section 2, step 8).

Every step runs in the Neon project `vela`, production's own project, on its default branch (database `neondb`; Neon names it `production` in a project created in the console), called the default branch below; staging has its own project, `vela-staging`, which this drill never touches (`infra/README.md`, section 2). The restored branch is a full copy of production. Only the founder connects to it, queries return counts and identifiers only, nothing is exported or screenshotted, and it is deleted the same day.

## Steps

1. **Record T0 and counts on the default branch.** In the Neon console, project `vela`, **SQL Editor**, the default branch:

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
2. **Wait 5 minutes**, then, in the same project, **Branches → New branch**: name `restore-drill-YYYY-MM-DD`, parent the default branch used in step 1 (record its actual name; do not assume it is `main`), "from a specific date and time" = T0, smallest compute. Start a timer.
3. **Run the same queries on the new branch**, and check the constraints the product depends on exist:

   ```sql
   SELECT indexname FROM pg_indexes
   WHERE indexname IN ('exchanges_one_per_day', 'outbound_budget_idx');
   ```

   **When the restored branch has sealed values after ADR-38's cutover:** the founder enters the branch's direct connection and that environment's saved `CONTENT_KEY_V1` through hidden Terminal prompts. Run `packages/db/scripts/seal-check.ts` with those values in the child process's environment, never command arguments or a local file. In particular, production connections and keys must never be saved in `.env.local`. The script prints only a result, never the words: `opens`, `does not open`, `no sealed value available`, or `restore check could not read the restored branch`. `opens` proves the backup and the stored key belong together; `does not open` means a candidate sealed value failed authentication or decoding and is a Sev 2 incident. A branch connection or query failure is reported separately and is not evidence of a bad key. `no sealed value available` is not a key proof. Production's pre-family drill may have no content to open; do not add synthetic content to production just to satisfy this check. The staging rehearsal below proves decryption against synthetic sealed data.
4. **Compare.** Counts must match. A difference can only come from a write that committed in the seconds around T0, or a retention deletion in the same minutes (visible as a `deletions` row); explain each one in the log.
5. **Check media.** On the branch, list up to five `storage_key` values of unkept media from the last 30 days. In the matching Cloudflare account's **R2 object storage**, open `vela-media-production` for the production drill or `vela-media-staging` for the staging rehearsal and confirm each listed object exists. R2 objects deleted after T0 cannot come back with the database; record how many are missing and why. If production has no media before its first family, record zero rows and `N/A — no pre-family media`; do not add production test media just to exercise this check.
6. **Stop the timer** and record the time to restore.
7. **Delete the branch** (**Branches → `restore-drill-…` → Delete**) and confirm it no longer appears.
8. **Restore local configuration.** Put back the original local `DATABASE_URL` and `CONTENT_KEY_V1`, or remove the temporary ignored `.env.local` if this drill created it. Do not leave development commands pointing at the restored branch or using another environment's key.
9. **Log it** in the table below. Record the latest migration and both constraint names from step 3, along with the exact `seal-check` result. For empty pre-family production, record `N/A — no sealed content` for key proof; staging must record `opens` against synthetic ciphertext. Keep connection strings, keys and content out of the log.

## How to know it worked

The log row is complete: counts matched or every difference is explained, the latest migration matches, both constraints were present, key proof is recorded (or the empty pre-family production exception is recorded), listed media keys resolved (or the zero-media pre-family case is recorded), the time to restore is recorded (target: under 1 hour), the branch was deleted the same day, and local configuration was restored.

## Private staging helper

On macOS, open [`../scripts/check-backup-recovery.command`](../scripts/check-backup-recovery.command). Keep the test app and bot idle. The founder privately supplies the verified direct staging connection and saved key; neither is written to disk. Engineering creates the recovery branch in `vela-staging` after the helper's five-minute wait. The default source branch is currently named `production`, but it belongs to the staging project.

Only one helper session can own the evidence at a time. Each attempt has a random `attemptId` and a unique Taipei-dated suggested branch name. Engineering writes `adr-38-staging-restore-branch.json`, binding that attempt, project, source branch, recovery point, name, and creation time. The helper waits automatically; the founder does not press Return to advance either verification gate. Branch verification must arrive within 30 minutes of baseline capture. Once creation has started, an overall 55-minute deadline includes private recovery-connection entry, target verification, and database/media checks. Timeout or interruption records incomplete work, clears private state, and releases the session lock. If the private session stops, archive that attempt and reopen the helper for a fresh recovery point.

The helper records a minute-aligned T0 to match Neon's time picker and a separate snapshot capture time. It compares all ten table counts, the latest migration hash/time, both unique index definitions and their valid/ready flags, and a restored sealed value. Concurrent commits or retention changes can still produce differences; each mismatch remains open for engineering review.

Engineering verifies the new branch's project, parent, recovery point, and compute identifier in Neon and writes `infra/load-tests/adr-38-staging-restore-target.json`, including the same `attemptId`. After both manifests match, the helper privately reuses the source role credentials on that independently verified child hostname. Source and child must differ, target verification must be no older than five minutes, and creation times must match. If the first child authentication rejects the password with PostgreSQL `28P01`, one hidden child-connection prompt is allowed; the saved protection key remains in memory. Other connection or query failures stop the attempt. A private fallback is revalidated against the exact child endpoint and a fresh target manifest before connection. Credentials are not written to a file or exposed to engineering. Neon normally inherits role passwords on children; [protected-parent children receive new passwords](https://neon.com/docs/guides/protected-branches#new-passwords-generated-for-postgres-roles-on-child-branches). This reduced-input flow has passed static checks; live operation remains pending. Connections accept only the verified endpoint, `neondb_owner`, `neondb`, port 5432 and the expected TLS options; driver query parameters cannot override those targets. The accepted URL is normalized to explicit port 5432 and canonical credentials, malformed password escaping is rejected, and inherited `PGOPTIONS` is refused before a database client is created. It checks up to five eligible files using Cloudflare's [metadata-only R2 listing](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/), with no file download. The saved receipt contains counts and statuses; media keys stay in memory. Missing files require investigation, and zero eligible files are recorded as unexercised.

`infra/load-tests/adr-38-staging-restore.json` remains incomplete until engineering records the actual temporary branch deletion, recovery duration, and configuration cleanup. A live key-check receipt or `database_verified` status alone is not a completed drill. The recovery timer includes all waiting after branch creation starts. If that wait exceeds one hour, retain the attempt and its actual elapsed time, complete its correctness checks, and repeat the timed rehearsal; never restart the timer on an existing copy to claim the target passed. [Neon branches are isolated copies](https://neon.com/docs/get-started-with-neon/workflow-primer); a copy created while T0 was within the history window remains available after the source's rolling window expires.

## Doing it for real

1. Declare a Sev 1 incident ([`incident.md`](incident.md)) and stop the cause first (roll back the release).
2. Find the last good moment from events and logs. Create a branch at that moment and compare before touching `main`.
3. Prefer copying back only the damaged rows from the branch. If that is not possible, use Neon's restore of `main` to the timestamp; Neon keeps the pre-restore state as a backup branch.
4. After a restore: confirm `/healthz` and the admin page; let reconciliation run; tell organisers whose answers or asks after the restore point were lost.
5. **Re-apply deletions.** Any data deleted after the restore point (retention jobs, a person's deletion request, a family deleted) has come back. Use the `deletions` rows on the backup branch after the restore point to delete it again, and run `applyRetention`. Before deleting a member or a nearby contact again, forget their consent rows ([`data-requests.md`](data-requests.md), "Forgetting before a deletion"), or the database refuses the delete; a restored `consents` row whose subject was deleted after the restore point holds the words again until it is forgotten.
6. Delete the backup branch within 7 days, once the restore is verified, because it holds data that may be past its retention.

## Drill log

**Drill #2 (build plan 5.7), status 5 October 2026: production drill still pending.** The drill runs on production's Neon project `vela`, which is not deployed. Drill #1 has not been logged either. Both run after production's first deploy and before its first family. If production has no sealed content yet, this drill cannot prove production-key decryption; the staging rehearsal must prove that against its own key and synthetic ciphertext. The founder is signed in to Neon. The staging helper recorded T0 `2026-10-04T17:02:00.000000Z` (5 October 01:02 Asia/Taipei), and engineering created `restore-drill-2026-10-05` (`br-lingering-glitter-b3usredd`) after the five-minute wait. Its 0.25 CU compute and staging host are verified. At `2026-10-05T02:07:19.468Z` (10:07 Asia/Taipei), all ten counts, migration metadata, both unique index definitions, and the sampled media keys matched; the restored key proof was `opens`. Both sampled R2 objects existed with valid metadata and matching sizes. The private process exited, its lock was released, and no local environment files were created. Actual recovery time was 8h 58m, including the overnight wait, so the under-hour target was missed. After the founder approved deletion, engineering removed the copy and verified the branch list contains only the original staging branch. Correctness and cleanup are recorded in `adr-38-staging-restore-completed-2026-10-05-slow.json`; the timed rehearsal must be repeated with a fresh recovery point. The first interrupted baseline is preserved as an incomplete attempt. Log the staging rehearsal separately from production.

**Fresh timed attempt, 5 October 10:18 Asia/Taipei:** attempt `386bb6c6-1adf-427a-89db-9bf7b8ef979f`, T0 `2026-10-05T02:18:00Z`. After the five-minute wait, engineering created `restore-drill-2026-10-05-386bb6c6` (`br-fragrant-shadow-b3ff17rn`), verified the staging parent and direct endpoint, and pinned compute to 0.25 CU. Creation timer began `2026-10-05T02:23:46Z`. Both manifests are bound to this attempt. The private session was interrupted before the recovery connection was supplied. Engineering verified that its process ended, the session lock was released, and no temporary environment files remain. The receipt and both manifests are archived with suffix `interrupted-386bb6c6.json`. No database comparison or timing pass is claimed. The founder approved deletion of this specific copy. Engineering deleted it and verified that only the original staging branch remains. A reduced-input connection handoff is prepared and statically checked; another live timed attempt remains pending. The old slow attempt remains recorded below.

| Date | Project and source branch | Plan and window | T0 | Counts matched | Differences explained | Migration and constraints | Key proof | Media keys resolved | Time to restore | Branch deleted | Local config restored | By |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-05 — correctness and cleanup complete; timing target missed | `vela-staging`, `production` (`br-odd-mud-b3lnl35f`) | Free, 6 hours | `2026-10-04T17:02:00Z` | Yes, all 10 tables | No differences | Hash `57e54df9d7cee33c61c595413d07a8b7f7e97a5f99712ed1e899a4b38997cd34`; `exchanges_one_per_day` and `outbound_budget_idx` definitions matched, both unique/valid/ready | `opens`, one restored value | 2/2 present; metadata and recorded sizes matched | 8h 58m (32,280 s), creation start `2026-10-04T17:09:19Z` to verification `2026-10-05T02:07:19.468Z`; target missed | Yes, same day; Neon branch list contains only the original staging branch | Verified: environment-only, helper exited, lock absent, no temporary environment files | Engineering; founder enters private credentials |
