CREATE TABLE "memory_keeps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"candidate_id" uuid,
	"source_answer_id" uuid NOT NULL,
	"discovery_consent_id" uuid NOT NULL,
	"keep_consent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"quote" text NOT NULL,
	"source_digest" text NOT NULL,
	"lang" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kept_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "memory_keeps_source_span_key" UNIQUE("source_answer_id","start_offset","end_offset"),
	CONSTRAINT "memory_keeps_candidate_key" UNIQUE("candidate_id"),
	CONSTRAINT "memory_keeps_kind_check" CHECK ("kind" in ('preference', 'story', 'humour', 'person', 'moment', 'follow_up')),
	CONSTRAINT "memory_keeps_offsets_check" CHECK ("memory_keeps"."start_offset" >= 0 and "memory_keeps"."end_offset" > "memory_keeps"."start_offset" and "memory_keeps"."end_offset" - "memory_keeps"."start_offset" <= 2000)
);
--> statement-breakpoint
ALTER TABLE "consents" DROP CONSTRAINT "consents_kind_check";--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "words_expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_candidates" ADD COLUMN "kept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memory_keeps" ADD CONSTRAINT "memory_keeps_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_keeps" ADD CONSTRAINT "memory_keeps_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_keeps" ADD CONSTRAINT "memory_keeps_candidate_id_memory_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."memory_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_keeps" ADD CONSTRAINT "memory_keeps_source_answer_id_answers_id_fk" FOREIGN KEY ("source_answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_keeps" ADD CONSTRAINT "memory_keeps_discovery_consent_id_consents_id_fk" FOREIGN KEY ("discovery_consent_id") REFERENCES "public"."consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_keeps" ADD CONSTRAINT "memory_keeps_keep_consent_id_consents_id_fk" FOREIGN KEY ("keep_consent_id") REFERENCES "public"."consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_keeps_family_page_idx" ON "memory_keeps" USING btree ("family_id","id");--> statement-breakpoint
CREATE INDEX "memory_keeps_member_idx" ON "memory_keeps" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "memory_keeps_discovery_consent_idx" ON "memory_keeps" USING btree ("discovery_consent_id");--> statement-breakpoint
CREATE INDEX "memory_keeps_keep_consent_idx" ON "memory_keeps" USING btree ("keep_consent_id");--> statement-breakpoint
CREATE INDEX "memory_keeps_removed_idx" ON "memory_keeps" USING btree ("removed_at");--> statement-breakpoint
CREATE INDEX "consents_kind_withdrawn_idx" ON "consents" USING btree ("kind","withdrawn_at");--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_kind_check" CHECK ("kind" in ('light', 'nearby', 'privacy_notice', 'pilot', 'health_words', 'rich_memories', 'memory_keep'));
--> statement-breakpoint
-- Explicit schema names also support the isolated Worker schema generator.
CREATE OR REPLACE FUNCTION "public"."invalidate_memory_keep_source"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Clearing non-health analysis does not change the chosen words (including existing book trim).
  IF NEW.mentions = '{}'::jsonb
     AND (OLD.mentions -> 'health' IS NULL OR OLD.mentions -> 'health' = '[]'::jsonb)
     AND ROW(NEW.payload, NEW.transcript, NEW.transcript_lang, NEW.member_id, NEW.exchange_id,
             NEW.kind, NEW.received_at, NEW.flag, NEW.words_expired_at)
       IS NOT DISTINCT FROM
         ROW(OLD.payload, OLD.transcript, OLD.transcript_lang, OLD.member_id, OLD.exchange_id,
             OLD.kind, OLD.received_at, OLD.flag, OLD.words_expired_at) THEN
    RETURN NEW;
  END IF;
  -- One narrowly defined retention transition, not permission to replace or erase words by hand.
  IF OLD.words_expired_at IS NULL AND NEW.words_expired_at IS NOT NULL
     AND NEW.words_expired_at >= OLD.received_at + interval '720 hours'
     AND NEW.payload = OLD.payload - ARRAY['text', 'choice']
     AND NEW.transcript IS NULL
     AND NEW.transcript_lang IS NOT DISTINCT FROM OLD.transcript_lang
     AND NEW.member_id = OLD.member_id AND NEW.exchange_id = OLD.exchange_id
     AND NEW.kind = OLD.kind AND NEW.received_at = OLD.received_at
     AND NEW.flag = OLD.flag AND NEW.mentions = '{}'::jsonb THEN
    RETURN NEW;
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.transcript IS DISTINCT FROM OLD.transcript
     OR NEW.transcript_lang IS DISTINCT FROM OLD.transcript_lang
     OR NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.exchange_id IS DISTINCT FROM OLD.exchange_id
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.flag IS DISTINCT FROM OLD.flag OR NEW.mentions IS DISTINCT FROM OLD.mentions
     OR NEW.words_expired_at IS DISTINCT FROM OLD.words_expired_at THEN
    DELETE FROM "public"."memory_keeps" WHERE source_answer_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memory_keep_source_guard BEFORE UPDATE ON "public"."answers"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_memory_keep_source"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."invalidate_memory_keep_permission"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'consents' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.kind = 'rich_memories' THEN
        -- Serialize a new consent against a keep using the member lock; a later yes is not a revival.
        PERFORM id FROM "public"."members" WHERE id = NEW.member_id FOR UPDATE;
        DELETE FROM "public"."memory_keeps" WHERE member_id = NEW.member_id
          AND discovery_consent_id <> NEW.id;
      END IF;
    ELSIF NEW.answer <> 'yes' OR NEW.withdrawn_at IS NOT NULL OR NEW.subject_deleted_at IS NOT NULL
       OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.member_id IS DISTINCT FROM OLD.member_id
       OR NEW.text_version IS DISTINCT FROM OLD.text_version OR NEW.given_at IS DISTINCT FROM OLD.given_at THEN
      DELETE FROM "public"."memory_keeps" WHERE removed_at IS NULL
        AND (discovery_consent_id = OLD.id OR keep_consent_id = OLD.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'members' THEN
    IF NEW.left_at IS NOT NULL OR NEW.status NOT IN ('active', 'paused') OR NEW.family_id <> OLD.family_id THEN
      DELETE FROM "public"."memory_keeps" WHERE member_id = OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'families' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      DELETE FROM "public"."memory_keeps" WHERE family_id = OLD.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'exchanges' THEN
    IF NEW.family_id IS DISTINCT FROM OLD.family_id THEN
      DELETE FROM "public"."memory_keeps" WHERE source_answer_id IN
        (SELECT id FROM "public"."answers" WHERE exchange_id = OLD.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memory_keep_consent_guard AFTER INSERT OR UPDATE ON "public"."consents"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_memory_keep_permission"();
--> statement-breakpoint
CREATE TRIGGER memory_keep_member_guard AFTER UPDATE ON "public"."members"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_memory_keep_permission"();
--> statement-breakpoint
CREATE TRIGGER memory_keep_family_guard AFTER UPDATE ON "public"."families"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_memory_keep_permission"();
--> statement-breakpoint
CREATE TRIGGER memory_keep_exchange_guard AFTER UPDATE OF family_id ON "public"."exchanges"
FOR EACH ROW EXECUTE FUNCTION "public"."invalidate_memory_keep_permission"();
