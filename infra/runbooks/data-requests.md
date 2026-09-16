# Data requests and manual changes

Privacy notice ("Your rights", "How long we keep it") · `plan/materials/pilot/data-map.md` · done by the founder only, because every step reads or writes real family records; the co-founder keeps these queries true to the schema and tests them on synthetic data, and never runs them on `main`

`architecture/decisions.md` ADR-22 gives the admin page write actions (services module `admin.ts`; POST forms on `/admin` in the admin Worker `vela-admin`, at `https://vela-admin.vela-light.workers.dev/admin` in production, behind Cloudflare Access with a verified Access JWT and a same-origin check, ADR-26; `architecture/04-instrument-flows.md` §3.17), built with the sprint 1 services and worker (build plan 1.12). Until they ship, the founder makes these changes in the Neon console with the statements below. Once they ship, the admin action in the last column replaces a section's statements: it writes the `admin_access_log` row (with its `action`, and `member_id` when it is about one member) and the domain event itself, so nothing is logged by hand. Sections without an admin action stay console procedures.

## When to use it

| Section | When | Once the admin page's actions ship |
|---|---|---|
| A | The same day an organiser finishes Vela's setup; or the person's invite link has expired | A1 stays as a check after the first setups (onboarding stores every pilot family in `apac`, flows §3.1). A2 gives way to the contact actions in C and D (contacts are stored without consent, flows §3.1). A3 stays: no admin action makes an invite link |
| B | Recording the organiser's agreement and notice, the person's call, and other family members' notice | `record_consent` (kind `pilot` or `privacy_notice`) for each member |
| C | A nearby contact said yes | `record_contact_consent` (yes); `add_contact` first for a contact not given at setup |
| D | A nearby contact said no or withdrew, has no yes 14 days after being added, or the organiser removes one | `record_contact_consent` (no) for a no, then `remove_contact` |
| E | The organiser says the person will be away | `set_away` (source `organiser`); `end_away` to end it early |
| F | Someone left the family group, or asks to stop taking part | A member with role `member` who leaves the group is marked left by Vela (flows §3.16). Anyone else: `mark_left`. Naming a new organiser stays here |
| G | The person the light is for has died | `mark_deceased` |
| H | Someone asks to see or get a copy of what Vela holds about them | Stays here |
| I | Something is wrong: a name, a greeting, a wake time, a phone number | Stays here |
| J | A family member asks for their information to be deleted | Stays here (`mark_left` deletes only 30 days later) |
| K | A family ends the pilot without continuing, the person the light is for asks for deletion, or a family asks to be deleted | `delete_family`, once the retention job that deletes the family within 24 hours has shipped too (flows §3.15, build plan 2.8). Steps 6 to 8 stay |

## Rules

1. **Where.** Neon console → project `vela-apac` → **SQL Editor**, branch `main`. Run one statement at a time, in the order given. Each change is written so that running it twice does no harm, except the new invite link in A, which makes another link each time.
2. **Log first.** Before reading or changing anything, for each family the session touches:

   ```sql
   INSERT INTO admin_access_log (admin, family_id, member_id, action, what)
   VALUES ('<your admin sign-in email>', '<family id>', NULL, '<action>', 'console: <section letter and what, for example C add nearby contact>');
   ```

   `admin` is the email you sign in to the admin page with, which is what the page itself records (flows §3.17). `action` must be one of the admin actions (a CHECK enforces it): the one the section stands in for (B `record_consent`, C `record_contact_consent`, D `remove_contact`, E `set_away` or `end_away`, F `mark_left`, G `mark_deceased`, K `delete_family`), or `view` for A, H, I and J. When the change is about one member, put their id in quotes in place of `NULL`. `what` never holds message content, names or phone numbers. Take the family id from the admin page, whose views are logged already. If you have to search the console for it, log the search first with `NULL` as the family id, `'view'` as the action and `'console: find family'`.
3. **Look before you change.** Run the `SELECT` that comes before a change, and run the change only if it shows exactly the rows you expect.
4. **Values.** Replace everything in `<angle brackets>`, keeping the quotes around it. A single quote inside a value is written twice (`'O''Brien'`). Times carry their zone (`'2026-09-20 18:05+08'`); dates are `'YYYY-MM-DD'`.
5. **Deadlines.** Stopping is immediate (the person's own "stop" in the chat does it). Every other request is done within 7 days, and a nearby contact who says no or withdraws is removed within 7 days (pack decisions 3 and 7). Tell the person when it is done.
6. **Results stay in the console.** Never paste a result into a chat, an issue, a screenshot or the repository. A copy for someone (H) goes only to that person.
7. **Log the request** in the table at the end: dates and family code only.

## Every week

- Record `privacy_notice` for family members who joined the group since last week (B, last statement; `record_consent` once the admin page ships).
- Remove nearby contacts with no yes 14 days after they were added (D, first statement).
- Nothing to clear in your Telegram chat with the production bot (the admin conversation): it carries family and member names and admin-page links, never family content (ADR-21; `data-map.md` row 25). Read and act on the admin page, where every view is logged.

## Finding the ids

Finding the members of a family (the person the light is for is the member with a wake time):

```sql
SELECT id, display_name, role, status, light_on, wake_time, arrival_time, language, created_at
FROM members
WHERE family_id = '<family id>'
ORDER BY created_at;
```

## A. After each organiser's setup

1. **Region.** Every pilot family is `apac` (`infra/README.md`, Environments), and onboarding stores it so (flows §3.1: `Config.regions` lists only `apac`, and a country whose preferred region does not exist falls back to it). Check after the first setups; the update should change nothing, and if it changes a row, tell the co-founder:

   ```sql
   SELECT id, country, region FROM families WHERE id = '<family id>';
   ```
   ```sql
   UPDATE families SET region = 'apac' WHERE id = '<family id>' AND region <> 'apac';
   ```

2. **Nearby contacts given at setup** are stored without consent and appear in no quiet notice until their yes is recorded (flows §3.1, §3.12). List them, so the organiser sends each one text A; record each answer as it comes (C, or D for a no):

   ```sql
   SELECT id, name, created_at, consented_at, declined_at FROM nearby_contacts
   WHERE family_id = '<family id>';
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

Once the admin page ships: `record_consent` for each member and kind. Until then, the statements below.

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

**Other family members**, who received the notice in the group: through the link in Vela's first message there (`group.linked`, flows §3.3), or from the organiser if they were added later. Their member rows appear when they first reply there, so run this every week for each family:

```sql
INSERT INTO consents (member_id, kind, text_version, lang, channel, given_at, evidence)
SELECT m.id, 'privacy_notice', 'privacy-notice.v1', m.language, 'telegram', m.created_at,
       jsonb_build_object('shared_in', 'family group', 'recorded_by', 'founder')
FROM members AS m
WHERE m.family_id = '<family id>' AND m.role = 'member' AND m.id <> '<kept-light member id>'
  AND NOT EXISTS (SELECT 1 FROM consents AS c WHERE c.member_id = m.id AND c.kind = 'privacy_notice');
```

## C. Record a nearby contact's yes

Once the admin page ships: `record_contact_consent` with the yes (and `add_contact` first for a contact not given at setup). Until then, the statements below. For a no, go to D.

At most two per person:

```sql
SELECT id, name, phone, created_at, consented_at, declined_at FROM nearby_contacts WHERE member_id = '<kept-light member id>';
```

**A contact given at setup** (listed above, `consented_at` empty): the yes and their `nearby` consent row, in one statement:

```sql
WITH contact AS (
  UPDATE nearby_contacts AS n
  SET consented_at = '<when they said yes>'::timestamptz,
      consent_requested_at = coalesce(n.consent_requested_at, '<when text A was sent>'::timestamptz),
      relation = coalesce(n.relation, '<how they know the person>'),
      channel = coalesce(n.channel, '<sms, line, whatsapp or telegram>')
  WHERE n.id = '<contact id>' AND n.consented_at IS NULL AND n.declined_at IS NULL
  RETURNING n.id, n.channel, n.consented_at
)
INSERT INTO consents (contact_id, kind, text_version, lang, channel, given_at, evidence)
SELECT contact.id, 'nearby', 'nearby-consent.v1', '<en or zh-TW>', contact.channel, contact.consented_at,
       jsonb_build_object('words', '<their exact words>', 'forwarded_by', 'organiser', 'recorded_by', 'founder')
FROM contact;
```

**A contact not yet in Vela** (named after setup): the contact, their yes and their consent row, in one statement:

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

Within 7 days of a no or a withdrawal; 14 days after a contact was added without a yes; or when the organiser asks. Once the admin page ships: `record_contact_consent` with the no (for a no), then `remove_contact`. Until then, the statements below.

Contacts with no yes 14 days after they were added (the weekly check; log it first as a search, rule 2):

```sql
SELECT id, family_id, name, created_at FROM nearby_contacts
WHERE consented_at IS NULL AND created_at < now() - interval '14 days';
```

A family's contacts:

```sql
SELECT id, name, consented_at, declined_at FROM nearby_contacts WHERE member_id = '<kept-light member id>';
```
```sql
WITH gone AS (
  DELETE FROM nearby_contacts AS n WHERE n.id = '<contact id>' RETURNING n.*
)
INSERT INTO deletions (object_type, object_id, content_hash, reason)
SELECT 'nearby_contact', gone.id, encode(sha256(convert_to(gone::text, 'UTF8')), 'hex'), '<declined, withdrawn, no yes in 14 days, or removed by the organiser>'
FROM gone;
```

Their consent row goes with them. Quiet notices already sent stay in the organisers' Telegram chats: if the contact asks, ask the organisers to delete those messages.

## E. Pause the notes while the person is away

Once the admin page ships: `set_away`, and `end_away` to end it early. Until then, the statements below.

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

Once the sprint 1 services ship, a member with role `member` who leaves the family group is marked left by Vela, with `left_at`, and leaves the turn rotation (flows §3.16); nothing to do. When an organiser or the person the light is for leaves the group, Vela changes nothing and sends you `admin.member_left_group`: ask the family what it means (an organiser stepping back, for example). Use this section for anyone who stops taking part without leaving the group, or if Telegram did not report a departure. Once the admin page ships: `mark_left`. Until then, the statement below.

```sql
UPDATE members SET status = 'left', left_at = now(), turns_in = false
WHERE id = '<member id>' AND family_id = '<family id>' AND status <> 'left';
```

Turn prompts stop naming them, and the retention job deletes their information 30 days after `left_at` (if they asked for deletion now, use J instead). Ask the organiser to remove them from the group too, so their messages stop reaching Vela: a member with role `member` who asks, replies or reacts in the group again becomes active again, with `left_at` cleared and a place in the turns (flows §3.16).

If they were the family's only organiser, agree a new organiser with the family first, record that person's `pilot` consent (B), ask them to open the bot and tap **Start** so Vela can write to them privately, and then (no admin action does this):

```sql
UPDATE members SET role = 'organiser' WHERE id = '<new organiser member id>' AND family_id = '<family id>';
```

## G. When the person the light is for has died

Once the admin page ships: `mark_deceased`, which switches the light off, sets the status, clears the scheduler and records the event, and sends nothing (flows §3.17). Until then, the statements below.

```sql
UPDATE members SET status = 'deceased', light_on = false, next_wake_at = NULL
WHERE id = '<kept-light member id>' AND status <> 'deceased';
```
```sql
INSERT INTO events (name, family_id, member_id)
SELECT 'member_marked_deceased', m.family_id, m.id
FROM members AS m
WHERE m.id = '<kept-light member id>'
  AND NOT EXISTS (SELECT 1 FROM events AS e WHERE e.name = 'member_marked_deceased' AND e.member_id = m.id);
```

From then on no morning message, repeat, quiet notice or turn prompt is due for her: the scheduler acts only for an active member with the light on (`decideSchedule` in `@vela/core`), and an alarm already set finds nothing to do. A message already queued for the family, such as a retry or a quiet notice, is dropped by the gateway instead of sent, and asks, replies and reactions in the family group are ignored, so nothing automated reaches the family again (flows §3.5, §3.7). Vela sends the family nothing about it; write to the organiser yourself, the same day. Later, and gently, ask whether the family wants its information kept for now or deleted (K).

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
SELECT week_start, stats, lines, suggestion, sent_lines, sent_suggestion, sent_at FROM weekly_reads WHERE member_id = '<kept-light member id>' ORDER BY week_start;
SELECT at, action, what FROM admin_access_log WHERE family_id = '<family id>' ORDER BY at;
```

Voice notes and photos: list their keys, then download each from **Cloudflare ("Vela" account) → R2 object storage → `vela-media-production`**:

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

1. **Media they sent.** List the keys, and delete each object in **Cloudflare ("Vela" account) → R2 object storage → `vela-media-production`**:

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

5. **The member**, with a proof. Their links, replies, consents, suggestions, message references, delivery records and the invites they sent go with the row; turns they held and asks they made stay, with the holder and asker set to null:

   ```sql
   WITH gone AS (
     DELETE FROM members AS m WHERE m.id = '<member id>' AND m.family_id = '<family id>' RETURNING m.*
   )
   INSERT INTO deletions (object_type, object_id, content_hash, reason)
   SELECT 'member', gone.id, encode(sha256(convert_to(gone::text, 'UTF8')), 'hex'), 'deletion request'
   FROM gone;
   ```

6. **Tell them it is done**, and that messages in the Telegram group stay there until they delete them. Content-free events and daily counts, and the admin access log, keep their member id for up to 24 months; deleted rows can remain in Neon's restore history for up to 7 days.

## K. Delete a family

Within 30 days of the end of a family's pilot, or within 7 days of a request. If the family book exists by then, first offer the organiser the stories the family kept.

Once `delete_family` (build plan 1.12) and the retention job (build plan 2.8) have both shipped: `delete_family` sets `families.deleted_at`, and the retention job deletes the family within 24 hours (flows §3.15, §3.17). The next day, check that `SELECT id FROM families WHERE id = '<family id>';` returns nothing and that nothing is left under `families/<family id>/` in **Cloudflare ("Vela" account) → R2 object storage → `vela-media-production`**, then do steps 6 to 8. Until then, steps 1 to 8.

1. **Media files.** List the keys and delete every object under `families/<family id>/` in **Cloudflare ("Vela" account) → R2 object storage → `vela-media-production`**:

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

6. **The admin conversation.** In your Telegram chat with the production bot, delete the messages that name this family (`data-map.md` row 25).
7. **What stays**, as the notice says: content-free `events` and `metrics_daily` (24 months), `admin_access_log` (24 months), `deletions`, error reports (up to 90 days), and outside the database your notes under the family code (up to 12 months after the pilot) and the fee record. Deleted rows can remain in Neon's restore history for up to 7 days.
8. **Tell the organiser** it is done, that the family's Telegram chats stay theirs, and that they can now remove the Vela bot from the group (Vela ignores an unlinked group).

## How to know it worked

The `SELECT` before the change (or the admin page) shows the new state; every deletion wrote its `deletions` rows; the session's `admin_access_log` rows exist, written by the admin page or by hand; the person was told within the deadline; and the log below has a row.

## Request log

Dates and family codes only. Never names, contact details or content.

| Received | Family code | Section | From (person, organiser, contact) | Done | By |
|---|---|---|---|---|---|
| | | | | | |
