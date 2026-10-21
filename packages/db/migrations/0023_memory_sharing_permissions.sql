CREATE TABLE "memory_shares" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"keep_id" uuid NOT NULL,
	"recipient_member_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"recipient_membership_revision" uuid NOT NULL,
	"sharing_revision" uuid NOT NULL,
	"presentation_id" uuid,
	"confirmation_version" text NOT NULL,
	"fingerprint" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "memory_shares_keep_recipient_key" UNIQUE("keep_id","recipient_member_id"),
	CONSTRAINT "memory_shares_fingerprint_check" CHECK ("memory_shares"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "memory_sharing_presentations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"keep_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"owner_membership_revision" uuid NOT NULL,
	"recipient_ids" uuid[] NOT NULL,
	"fingerprint" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "memory_sharing_presentations_fingerprint_check" CHECK ("memory_sharing_presentations"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "memory_sharing_presentations_audience_check" CHECK (cardinality("memory_sharing_presentations"."recipient_ids") between 1 and 50 and array_position("memory_sharing_presentations"."recipient_ids", null) is null),
	CONSTRAINT "memory_sharing_presentations_timing_check" CHECK ("memory_sharing_presentations"."expires_at" = "memory_sharing_presentations"."issued_at" + interval '5 minutes' and ("memory_sharing_presentations"."consumed_at" is null or ("memory_sharing_presentations"."consumed_at" >= "memory_sharing_presentations"."issued_at" and "memory_sharing_presentations"."consumed_at" < "memory_sharing_presentations"."expires_at")))
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "memory_membership_revision" uuid DEFAULT uuidv7() NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_keeps" ADD COLUMN "sharing_revision" uuid DEFAULT uuidv7() NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_shares" ADD CONSTRAINT "memory_shares_keep_id_memory_keeps_id_fk" FOREIGN KEY ("keep_id") REFERENCES "public"."memory_keeps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_shares" ADD CONSTRAINT "memory_shares_recipient_member_id_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_shares" ADD CONSTRAINT "memory_shares_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_shares" ADD CONSTRAINT "memory_shares_presentation_id_memory_sharing_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."memory_sharing_presentations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sharing_presentations" ADD CONSTRAINT "memory_sharing_presentations_keep_id_memory_keeps_id_fk" FOREIGN KEY ("keep_id") REFERENCES "public"."memory_keeps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sharing_presentations" ADD CONSTRAINT "memory_sharing_presentations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_shares_recipient_idx" ON "memory_shares" USING btree ("recipient_member_id");--> statement-breakpoint
CREATE INDEX "memory_shares_user_idx" ON "memory_shares" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "memory_shares_presentation_idx" ON "memory_shares" USING btree ("presentation_id");--> statement-breakpoint
CREATE INDEX "memory_sharing_presentations_keep_idx" ON "memory_sharing_presentations" USING btree ("keep_id");--> statement-breakpoint
CREATE INDEX "memory_sharing_presentations_owner_idx" ON "memory_sharing_presentations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "memory_sharing_presentations_recipients_idx" ON "memory_sharing_presentations" USING gin ("recipient_ids");--> statement-breakpoint
CREATE INDEX "memory_sharing_presentations_expiry_idx" ON "memory_sharing_presentations" USING btree ("expires_at");
--> statement-breakpoint
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
