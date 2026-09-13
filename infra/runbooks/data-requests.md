# Data requests and manual changes

Privacy notice ("Your rights", "How long we keep it") · `plan/materials/pilot/data-map.md` · done by the founder only, because every step reads or writes real family records; the co-founder keeps these queries true to the schema and tests them on synthetic data, and never runs them on `main`

The Telegram instrument has no admin write path: the admin page is read-only (code design §9) and no flow records the founder's consent rows, nearby contacts, organiser-set away dates, a death, or someone leaving. Until admin actions exist, the founder makes these changes in the Neon console with the statements below.

## When to use it

| Section | When |
|---|---|
| A | The same day an organiser finishes Vela's setup; or the person's invite link has expired |
| B | Recording the organiser's agreement and notice, the person's call, and other family members' notice |
| C | A nearby contact said yes |
| D | A nearby contact withdrew, or the organiser removes one |
| E | The organiser says the person will be away |
| F | Someone left the family group, or asks to stop taking part |
| G | The person the light is for has died |
| H | Someone asks to see or get a copy of what Vela holds about them |
| I | Something is wrong: a name, a greeting, a wake time, a phone number |
| J | A family member asks for their information to be deleted |
| K | A family ends the pilot without continuing, the person the light is for asks for deletion, or a family asks to be deleted |

## Rules

1. **Where.** Neon console → project `vela-apac` → **SQL Editor**, branch `main`. Run one statement at a time, in the order given. Each change is written so that running it twice does no harm, except the new invite link in A, which makes another link each time.
2. **Log first.** Before reading or changing anything, for each family the session touches:

   ```sql
   INSERT INTO admin_access_log (admin, family_id, what)
   VALUES ('founder', '<family id>', 'console: <section letter and what, for example C add nearby contact>');
   ```

   Take the family id from the admin page, whose reads are logged already. If you have to search the console for it, log the search first with `NULL` as the family id and `'console: find family'`.
3. **Look before you change.** Run the `SELECT` that comes before a change, and run the change only if it shows exactly the rows you expect.
4. **Values.** Replace everything in `<angle brackets>`, keeping the quotes around it. A single quote inside a value is written twice (`'O''Brien'`). Times carry their zone (`'2026-09-20 18:05+08'`); dates are `'YYYY-MM-DD'`.
5. **Deadlines.** Stopping is immediate (the person's own "stop" in the chat does it). Every other request is done within 7 days, and a withdrawn nearby contact is removed within 7 days (pack decision 7). Tell the person when it is done.
6. **Results stay in the console.** Never paste a result into a chat, an issue, a screenshot or the repository. A copy for someone (H) goes only to that person.
7. **Log the request** in the table at the end: dates and family code only.

## Every week

- Record `privacy_notice` for family members who joined the group since last week (B, last statement).
- In your Telegram chat with the production bot (the admin conversation), delete every flag notice and weekly-read draft older than 30 days, choosing to delete them for the bot too where Telegram offers it (pack decision 6; `data-map.md` row 25). This chat is not in `admin_access_log`, so keep it closed except to act on a flag or edit a read.

## Finding the ids

Finding the members of a family (the person the light is for is the member with a wake time):

```sql
SELECT id, display_name, role, status, light_on, wake_time, arrival_time, language, created_at
FROM members
WHERE family_id = '<family id>'
ORDER BY created_at;
```

## A. After each organiser's setup

1. **Region.** Every pilot family is `apac` (`infra/README.md`, Environments). Flows §3.1 may have set `us` or `eu` from the country:

   ```sql
   SELECT id, country, region FROM families WHERE id = '<family id>';
   ```
   ```sql
   UPDATE families SET region = 'apac' WHERE id = '<family id>' AND region <> 'apac';
   ```

2. **Nearby contacts typed at setup.** The organiser should have tapped Skip. Any contact without a yes is deleted the same day, with a deletion proof; the organiser then sends text A and you add the contact after the yes (C):

   ```sql
   SELECT id, name, consented_at FROM nearby_contacts
   WHERE family_id = '<family id>' AND consented_at IS NULL;
   ```
   ```sql
   WITH gone AS (
     DELETE FROM nearby_contacts AS n
     WHERE n.family_id = '<family id>' AND n.consented_at IS NULL
     RETURNING n.*
   )
   INSERT INTO deletions (object_type, object_id, content_hash, reason)
   SELECT 'nearby_contact', gone.id, encode(sha256(convert_to(gone::text, 'UTF8')), 'hex'), 'added before consent'
   FROM gone;
   ```

3. **A new invite link**, when the person has not accepted and the link from setup has expired (after 7 days) or is lost. This creates a new single-use link that works for 7 days:

   ```sql
   INSERT INTO invites (family_id, invited_by, for_member_id, token, expires_at)
   SELECT k.family_id, o.id, k.id, replace(gen_random_uuid()::text, '-', ''), now() + interval '7 days'
   FROM members AS k
   JOIN members AS o ON o.family_id = k.family_id AND o.role = 'organiser'
   WHERE k.id = '<kept-light member id>' AND k.status = 'invited'
   LIMIT 1
   RETURNING token;
   ```

   Send the organiser `https://t.me/<bot username>?start=<token>` from your own Telegram account. It is a one-time link for the person, not a secret, but send it only to the organiser.

## B. Consent rows the founder records

The organiser agreed before their member row existed (pack step 1), so their rows are written once their setup is finished, with the date they actually agreed.

**The organiser** (`pilot` and `privacy_notice`):

```sql
INSERT INTO consents (member_id, kind, text_version, lang, channel, given_at, evidence)
SELECT m.id, v.kind, v.text_version, '<en or zh-TW>', '<telegram, line, email or call>', '<when they agreed>'::timestamptz,
       jsonb_build_object('words', '<their words>', 'recorded_by', 'founder')
FROM members AS m
CROSS JOIN (VALUES ('pilot', 'organiser-agreement.v1'), ('privacy_notice', 'privacy-notice.v1')) AS v (kind, text_version)
WHERE m.id = '<organiser member id>' AND m.role = 'organiser'
  AND NOT EXISTS (
    SELECT 1 FROM consents AS c
    WHERE c.member_id = m.id AND c.kind = v.kind AND c.text_version = v.text_version
  );
```

**The person the light is for**, after the call (`privacy_notice`, channel `call`; the evidence points to your note, it does not copy it):

```sql
INSERT INTO consents (member_id, kind, text_version, lang, channel, given_at, evidence)
SELECT m.id, 'privacy_notice', 'privacy-notice.v1', '<en or zh-TW>', 'call', '<call time>'::timestamptz,
       jsonb_build_object('note', '<family code> <call date>', 'script', 'consent-script.v1', 'recorded_by', 'founder')
FROM members AS m
WHERE m.id = '<kept-light member id>'
  AND NOT EXISTS (SELECT 1 FROM consents AS c WHERE c.member_id = m.id AND c.kind = 'privacy_notice');
```

**Other family members**, who received the notice when the organiser shared it in the group. Their member rows appear when they first reply there, so run this every week for each family:

```sql
INSERT INTO consents (member_id, kind, text_version, lang, channel, given_at, evidence)
SELECT m.id, 'privacy_notice', 'privacy-notice.v1', m.language, 'telegram', m.created_at,
       jsonb_build_object('shared_by', 'organiser', 'recorded_by', 'founder')
FROM members AS m
WHERE m.family_id = '<family id>' AND m.role = 'member' AND m.id <> '<kept-light member id>'
  AND NOT EXISTS (SELECT 1 FROM consents AS c WHERE c.member_id = m.id AND c.kind = 'privacy_notice');
```

## C. Add a nearby contact after their yes

At most two per person:

```sql
SELECT id, name, phone, consented_at FROM nearby_contacts WHERE member_id = '<kept-light member id>';
```

The contact and their `nearby` consent row, in one statement:

```sql
WITH contact AS (
  INSERT INTO nearby_contacts (family_id, member_id, name, relation, phone, channel, consent_requested_at, consented_at)
  SELECT m.family_id, m.id, '<name>', '<how they know the person>', '<phone with country code>', '<sms, line, whatsapp or telegram>',
         '<when text A was sent>'::timestamptz, '<when they said yes>'::timestamptz
  FROM members AS m
  WHERE m.id = '<kept-light member id>'
    AND (SELECT count(*) FROM nearby_contacts AS n WHERE n.member_id = m.id) < 2
    AND NOT EXISTS (SELECT 1 FROM nearby_contacts AS n WHERE n.member_id = m.id AND n.phone = '<phone with country code>')
  RETURNING id, channel, consented_at
)
INSERT INTO consents (contact_id, kind, text_version, lang, channel, given_at, evidence)
SELECT contact.id, 'nearby', 'nearby-consent.v1', '<en or zh-TW>', contact.channel, contact.consented_at,
       jsonb_build_object('words', '<their exact words>', 'forwarded_by', 'organiser', 'recorded_by', 'founder')
FROM contact;
```

The next quiet notice lists them.

## D. Remove a nearby contact

```sql
SELECT id, name FROM nearby_contacts WHERE member_id = '<kept-light member id>';
```
```sql
WITH gone AS (
  DELETE FROM nearby_contacts AS n WHERE n.id = '<contact id>' RETURNING n.*
)
INSERT INTO deletions (object_type, object_id, content_hash, reason)
SELECT 'nearby_contact', gone.id, encode(sha256(convert_to(gone::text, 'UTF8')), 'hex'), '<withdrawn, or removed by the organiser>'
FROM gone;
```

Their consent row goes with them. Quiet notices already sent stay in the organisers' Telegram chats: if the contact asks, ask the organisers to delete those messages.

## E. Pause the notes while the person is away

Morning messages keep coming; on those days no repeat and no quiet notice are sent. For "until they answer again", write `NULL` in place of `'<last day away>'`.

```sql
INSERT INTO away_periods (member_id, from_date, to_date, source, set_by)
SELECT '<kept-light member id>'::uuid, '<first day away>'::date, '<last day away>'::date, 'organiser', '<organiser member id>'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM away_periods AS a
  WHERE a.member_id = '<kept-light member id>' AND a.from_date = '<first day away>' AND a.ended_at IS NULL
);
```

Ending it early:

```sql
UPDATE away_periods SET ended_at = now()
WHERE member_id = '<kept-light member id>' AND source = 'organiser' AND ended_at IS NULL;
```

Tell the organiser the dates you set.

## F. Remove a family member who left

Vela receives nothing when someone leaves a group, so a member stays in the turn rotation until this is done.

```sql
UPDATE members SET status = 'left', left_at = now(), turns_in = false
WHERE id = '<member id>' AND family_id = '<family id>' AND status <> 'left';
```

Turn prompts stop naming them, and the retention job deletes their information 30 days after `left_at` (if they asked for deletion now, use J instead). Ask the organiser to remove them from the group too, so their messages stop reaching Vela.

If they were the family's only organiser, agree a new organiser with the family first, record that person's `pilot` consent (B), ask them to open the bot and tap **Start** so Vela can write to them privately, and then:

```sql
UPDATE members SET role = 'organiser' WHERE id = '<new organiser member id>' AND family_id = '<family id>';
```

## G. When the person the light is for has died

```sql
UPDATE members SET status = 'deceased', next_wake_at = NULL
WHERE id = '<kept-light member id>' AND status <> 'deceased';
```
```sql
INSERT INTO events (name, family_id, member_id)
SELECT 'member_marked_deceased', m.family_id, m.id
FROM members AS m
WHERE m.id = '<kept-light member id>'
  AND NOT EXISTS (SELECT 1 FROM events AS e WHERE e.name = 'member_marked_deceased' AND e.member_id = m.id);
```

From then on no morning message, repeat, quiet notice or turn prompt is due for her: the scheduler acts only for an active member with the light on (`decideSchedule` in `@vela/core`), and an alarm already set finds nothing to do. Vela sends the family nothing about it; write to the organiser yourself, the same day. Later, and gently, ask whether the family wants its information kept for now or deleted (K).

## H. A copy of someone's information

After the identity question in the notice ("How"), run the queries for that person and send the results only to them. For the person the light is for, add the second group.

```sql
SELECT display_name, address_form, role, language, tz, country, status, wake_time, arrival_time, created_at, left_at
FROM members WHERE id = '<member id>';
SELECT channel, external_id, display_name, linked_at, blocked_at FROM channel_links WHERE member_id = '<member id>';
SELECT kind, text_version, lang, channel, given_at, withdrawn_at, evidence FROM consents WHERE member_id = '<member id>';
SELECT created_at, scheduled_for, type, text, on_behalf_of, state FROM exchanges WHERE asker_id = '<member id>' ORDER BY created_at;
SELECT created_at, kind, text FROM replies WHERE member_id = '<member id>' ORDER BY created_at;
```

The person the light is for:

```sql
SELECT received_at, kind, payload, transcript, summary, mood_words, mentions, flag, flag_reason, away_until
FROM answers WHERE member_id = '<kept-light member id>' ORDER BY received_at;
SELECT from_date, to_date, source, created_at, ended_at FROM away_periods WHERE member_id = '<kept-light member id>';
SELECT opened_at, notify_count, resolved_at, outcome FROM quiet_events WHERE member_id = '<kept-light member id>' ORDER BY opened_at;
SELECT week_start, lines FROM weekly_reads WHERE member_id = '<kept-light member id>' ORDER BY week_start;
SELECT at, what FROM admin_access_log WHERE family_id = '<family id>' ORDER BY at;
```

Voice notes and photos: list their keys, then download each from **Cloudflare ("Vela" account) → R2 → `vela-media-apac`**:

```sql
SELECT md.storage_key FROM media AS md
WHERE md.storage_key IS NOT NULL
  AND (md.uploaded_by = '<member id>'
    OR md.id IN (SELECT a.media_id FROM answers AS a WHERE a.member_id = '<member id>')
    OR md.id IN (SELECT r.media_id FROM replies AS r WHERE r.member_id = '<member id>')
    OR md.id IN (SELECT unnest(e.media_ids) FROM exchanges AS e WHERE e.asker_id = '<member id>'));
```

Nearby contacts' details are theirs, not the person's: give them only to the contact, or to an organiser, who already sees them.

## I. Correct something

```sql
UPDATE members SET display_name = '<name>' WHERE id = '<member id>';
UPDATE members SET address_form = '<greeting>' WHERE id = '<member id>';
UPDATE nearby_contacts SET phone = '<phone with country code>' WHERE id = '<contact id>';
```

A new wake time also moves the arrival (setup sets it 30 minutes after waking). Clearing `next_wake_at` makes reconciliation re-plan her schedule within 5 minutes; if today's morning message has already gone, the new time applies from tomorrow:

```sql
UPDATE members SET wake_time = '<HH:MM>', arrival_time = '<HH:MM, 30 minutes later>', next_wake_at = NULL
WHERE id = '<kept-light member id>';
```

## J. Delete a family member's information

For anyone except the person the light is for (for her, use K: everything Vela holds is about her). Statements in this order:

1. **Media they sent.** List the keys, and delete each object in **Cloudflare ("Vela" account) → R2 → `vela-media-apac`**:

   ```sql
   SELECT md.storage_key FROM media AS md
   WHERE md.storage_key IS NOT NULL
     AND (md.uploaded_by = '<member id>'
       OR md.id IN (SELECT r.media_id FROM replies AS r WHERE r.member_id = '<member id>')
       OR md.id IN (SELECT unnest(e.media_ids) FROM exchanges AS e WHERE e.asker_id = '<member id>')
       OR md.id IN (SELECT e.voice_hello_id FROM exchanges AS e WHERE e.asker_id = '<member id>'));
   ```

   Then the rows, with proofs:

   ```sql
   WITH gone AS (
     DELETE FROM media AS md
     WHERE md.uploaded_by = '<member id>'
        OR md.id IN (SELECT r.media_id FROM replies AS r WHERE r.member_id = '<member id>')
        OR md.id IN (SELECT unnest(e.media_ids) FROM exchanges AS e WHERE e.asker_id = '<member id>')
        OR md.id IN (SELECT e.voice_hello_id FROM exchanges AS e WHERE e.asker_id = '<member id>')
     RETURNING md.id, md.storage_key, md.provider_file_id
   )
   INSERT INTO deletions (object_type, object_id, content_hash, reason)
   SELECT 'media', gone.id, encode(sha256(convert_to(coalesce(gone.storage_key, gone.provider_file_id), 'UTF8')), 'hex'), 'deletion request'
   FROM gone;
   ```

2. **Translations of their asks and replies** (translations have no foreign key, so nothing else removes them):

   ```sql
   DELETE FROM translations AS t
   WHERE (t.object_type = 'exchange' AND t.object_id IN (SELECT e.id FROM exchanges AS e WHERE e.asker_id = '<member id>'))
      OR (t.object_type = 'reply' AND t.object_id IN (SELECT r.id FROM replies AS r WHERE r.member_id = '<member id>'));
   ```

3. **Their asks.** An ask not yet delivered is withdrawn; every ask they made loses its words:

   ```sql
   UPDATE exchanges SET state = 'withdrawn'
   WHERE asker_id = '<member id>' AND state IN ('composed', 'scheduled');
   ```
   ```sql
   UPDATE exchanges SET text = NULL, options = NULL, on_behalf_of = NULL, media_ids = '{}', voice_hello_id = NULL
   WHERE asker_id = '<member id>';
   ```

4. **Their words in delivery records and AI output.** These are cleared for the whole family, which the 30-day rule would do anyway; queued messages keep theirs so they can still be sent:

   ```sql
   UPDATE outbound SET payload = '{}'::jsonb
   WHERE member_id IN (SELECT m.id FROM members AS m WHERE m.family_id = '<family id>')
     AND status <> 'queued' AND payload <> '{}'::jsonb;
   ```
   ```sql
   UPDATE ai_calls SET output = NULL WHERE family_id = '<family id>' AND output IS NOT NULL;
   ```

5. **The member**, with a proof. Their links, replies, consents, turns, suggestions and message references go with the row:

   ```sql
   WITH gone AS (
     DELETE FROM members AS m WHERE m.id = '<member id>' AND m.family_id = '<family id>' RETURNING m.*
   )
   INSERT INTO deletions (object_type, object_id, content_hash, reason)
   SELECT 'member', gone.id, encode(sha256(convert_to(gone::text, 'UTF8')), 'hex'), 'deletion request'
   FROM gone;
   ```

6. **Tell them it is done**, and that messages in the Telegram group stay there until they delete them. Content-free events and daily counts keep their member id for up to 24 months; deleted rows can remain in Neon's restore history for up to 7 days.

## K. Delete a family

Within 30 days of the end of a family's pilot, or within 7 days of a request. If the family book exists by then, first offer the organiser the stories the family kept.

1. **Media files.** List the keys and delete every object under `families/<family id>/` in **Cloudflare ("Vela" account) → R2 → `vela-media-apac`**:

   ```sql
   SELECT storage_key FROM media WHERE family_id = '<family id>' AND storage_key IS NOT NULL;
   ```

2. **Proofs for the media rows** (the rows themselves go with the family in step 5):

   ```sql
   INSERT INTO deletions (object_type, object_id, content_hash, reason)
   SELECT 'media', md.id, encode(sha256(convert_to(coalesce(md.storage_key, md.provider_file_id), 'UTF8')), 'hex'), '<end of pilot, or deletion request>'
   FROM media AS md
   WHERE md.family_id = '<family id>'
     AND NOT EXISTS (SELECT 1 FROM deletions AS d WHERE d.object_id = md.id);
   ```

3. **Translations** (no foreign key):

   ```sql
   DELETE FROM translations AS t
   WHERE t.object_id IN (
     SELECT e.id FROM exchanges AS e WHERE e.family_id = '<family id>'
     UNION ALL SELECT a.id FROM answers AS a JOIN exchanges AS e ON e.id = a.exchange_id WHERE e.family_id = '<family id>'
     UNION ALL SELECT r.id FROM replies AS r JOIN exchanges AS e ON e.id = r.exchange_id WHERE e.family_id = '<family id>'
     UNION ALL SELECT w.id FROM weekly_reads AS w WHERE w.family_id = '<family id>'
   );
   ```

4. **The AI call log** keeps its cost and timing without names or output:

   ```sql
   UPDATE ai_calls SET output = NULL, family_id = NULL, member_id = NULL
   WHERE family_id = '<family id>'
      OR member_id IN (SELECT m.id FROM members AS m WHERE m.family_id = '<family id>');
   ```

5. **The family**, with a proof. Members, links, the group link, invites, nearby contacts and their consents, media rows, exchanges, answers, replies, turns, quiet days, away periods, weekly reads, delivery records and message references all go with it:

   ```sql
   WITH gone AS (
     DELETE FROM families AS f WHERE f.id = '<family id>' RETURNING f.*
   )
   INSERT INTO deletions (object_type, object_id, content_hash, reason)
   SELECT 'family', gone.id, encode(sha256(convert_to(gone::text, 'UTF8')), 'hex'), '<end of pilot, or deletion request>'
   FROM gone;
   ```

6. **What stays**, as the notice says: content-free `events` and `metrics_daily` (24 months), `admin_access_log` (24 months), `deletions`, error reports (up to 90 days), and outside the database your notes under the family code (up to 12 months after the pilot) and the fee record. Deleted rows can remain in Neon's restore history for up to 7 days.
7. **Tell the organiser** it is done, that the family's Telegram chats stay theirs, and that they can now remove the Vela bot from the group (Vela ignores an unlinked group).

## How to know it worked

The `SELECT` before the change shows the new state when run again; every deletion wrote its `deletions` rows; the session's `admin_access_log` rows exist; the person was told within the deadline; and the log below has a row.

## Request log

Dates and family codes only. Never names, contact details or content.

| Received | Family code | Section | From (person, organiser, contact) | Done | By |
|---|---|---|---|---|---|
| | | | | | |
