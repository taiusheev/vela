-- Scope and lifecycle guards for optional, private question drafting profiles.
CREATE FUNCTION question_profiles_check_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM members a
    JOIN members r ON r.id = NEW.recipient_id AND r.family_id = a.family_id
    JOIN families f ON f.id = a.family_id AND f.deleted_at IS NULL
    JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL
    WHERE a.id = NEW.author_id AND a.family_id = NEW.family_id AND u.id = NEW.owner_user_id
      AND a.left_at IS NULL AND a.status IN ('active', 'paused')
      AND (r.user_id IS NULL OR EXISTS (SELECT 1 FROM users ru WHERE ru.id = r.user_id AND ru.deleted_at IS NULL))
      AND (NEW.data IS NULL OR (a.status = 'active' AND r.status = 'active' AND r.left_at IS NULL
        AND r.light_on AND r.light_consented_at IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Question profile scope is invalid' USING ERRCODE = '23514', CONSTRAINT = 'question_profiles_scope';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER question_profiles_scope_guard BEFORE INSERT OR UPDATE ON question_profiles
FOR EACH ROW EXECUTE FUNCTION question_profiles_check_scope();
--> statement-breakpoint
CREATE FUNCTION question_profiles_member_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.family_id IS DISTINCT FROM OLD.family_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.left_at IS NOT NULL OR NEW.status IN ('left', 'deceased')
    OR (OLD.light_on AND NOT NEW.light_on)
    OR NEW.light_consented_at IS DISTINCT FROM OLD.light_consented_at THEN
    DELETE FROM question_profiles WHERE author_id = OLD.id OR recipient_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER question_profiles_member_cleanup AFTER UPDATE OF family_id, user_id, left_at, status, light_on, light_consented_at ON members
FOR EACH ROW EXECUTE FUNCTION question_profiles_member_changed();
--> statement-breakpoint
CREATE FUNCTION question_profiles_account_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.auth_subject IS DISTINCT FROM OLD.auth_subject THEN
    DELETE FROM question_profiles WHERE owner_user_id = OLD.id
      OR author_id IN (SELECT id FROM members WHERE user_id = OLD.id)
      OR recipient_id IN (SELECT id FROM members WHERE user_id = OLD.id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER question_profiles_account_cleanup AFTER UPDATE OF deleted_at, auth_subject ON users
FOR EACH ROW EXECUTE FUNCTION question_profiles_account_changed();
--> statement-breakpoint
CREATE FUNCTION question_profiles_family_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN DELETE FROM question_profiles WHERE family_id = OLD.id; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER question_profiles_family_cleanup AFTER UPDATE OF deleted_at ON families
FOR EACH ROW EXECUTE FUNCTION question_profiles_family_changed();
