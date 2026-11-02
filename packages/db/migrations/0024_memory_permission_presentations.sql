CREATE TABLE "memory_permission_presentations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_revision" uuid NOT NULL,
	"text_version" text NOT NULL,
	"notice_version" text NOT NULL,
	"lang" text NOT NULL,
	"text_sha256" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "memory_permission_presentations_sha_check" CHECK ("memory_permission_presentations"."text_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "memory_permission_presentations_timing_check" CHECK ("memory_permission_presentations"."expires_at" = "memory_permission_presentations"."issued_at" + interval '5 minutes' and ("memory_permission_presentations"."consumed_at" is null or ("memory_permission_presentations"."consumed_at" >= "memory_permission_presentations"."issued_at" and "memory_permission_presentations"."consumed_at" < "memory_permission_presentations"."expires_at")))
);
--> statement-breakpoint
ALTER TABLE "memory_permission_presentations" ADD CONSTRAINT "memory_permission_presentations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_permission_presentations" ADD CONSTRAINT "memory_permission_presentations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_permission_presentations_member_idx" ON "memory_permission_presentations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "memory_permission_presentations_user_idx" ON "memory_permission_presentations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memory_permission_presentations_expiry_idx" ON "memory_permission_presentations" USING btree ("expires_at");