-- No quote/name copies. These guards invalidate both live grants and pending choices.
CREATE OR REPLACE FUNCTION "public"."invalidate_memory_sharing_member"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "public"."memory_sharing_presentations" WHERE recipient_ids @> ARRAY[OLD.id];
    RETURN OLD;
  END IF;
  binding_changed := NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.family_id IS DISTINCT FROM OLD.family_id
    OR NEW.left_at IS DISTINCT FROM OLD.left_at
    OR (NEW.status IN ('active', 'paused')) IS DISTINCT FROM (OLD.status IN ('active', 'paused'))
    OR NEW.memory_membership_revision IS DISTINCT FROM OLD.memory_membership_revision;
  IF binding_changed THEN
    NEW.memory_membership_revision := uuidv7();
    DELETE FROM "public"."memory_sharing_presentations" WHERE recipient_ids @> ARRAY[OLD.id];
    DELETE FROM "public"."memory_shares" WHERE recipient_member_id = OLD.id;
    -- A replacement account must not inherit the author's private kept words or shared choices.
    DELETE FROM "public"."memory_keeps" WHERE member_id = OLD.id;
  ELSIF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    DELETE FROM "public"."memory_sharing_presentations" WHERE recipient_ids @> ARRAY[OLD.id]
      AND consumed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memory_sharing_member_guard BEFORE UPDATE OR DELETE ON "public"."members"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_memory_sharing_member"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."invalidate_memory_sharing_user"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.auth_subject IS DISTINCT FROM OLD.auth_subject OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    -- Do not update member rows before account deletion takes its ordered organiser locks.
    -- Sharing locks the bound user rows first, so a concurrent share cannot survive this purge.
    DELETE FROM "public"."memory_sharing_presentations" WHERE owner_user_id = OLD.id
      OR recipient_ids && ARRAY(SELECT id FROM "public"."members" WHERE user_id = OLD.id);
    DELETE FROM "public"."memory_shares" WHERE recipient_user_id = OLD.id;
    DELETE FROM "public"."memory_keeps" WHERE member_id IN
      (SELECT id FROM "public"."members" WHERE user_id = OLD.id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memory_sharing_user_guard BEFORE UPDATE OF auth_subject, deleted_at ON "public"."users"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_memory_sharing_user"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."invalidate_memory_sharing_keep"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.removed_at IS NOT NULL OR NEW.sharing_revision IS DISTINCT FROM OLD.sharing_revision THEN
    DELETE FROM "public"."memory_sharing_presentations" WHERE keep_id = OLD.id;
    DELETE FROM "public"."memory_shares" WHERE keep_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memory_sharing_keep_guard BEFORE UPDATE OF removed_at, sharing_revision ON "public"."memory_keeps"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_memory_sharing_keep"();
