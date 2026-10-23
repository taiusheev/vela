CREATE TABLE "weekly_support_permissions" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" uuid NOT NULL,
	"owner_revision" uuid NOT NULL,
	"version" text NOT NULL,
	"notice_version" text NOT NULL,
	"text_sha256" text NOT NULL,
	"state" text NOT NULL,
	"audience" jsonb NOT NULL,
	"given_at" timestamp with time zone NOT NULL,
	CONSTRAINT "weekly_support_permissions_state_check" CHECK ("weekly_support_permissions"."state" in ('yes', 'no', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "weekly_support_presentations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"owner_revision" uuid NOT NULL,
	"text_sha256" text NOT NULL,
	"permission_revision" uuid,
	"audience" jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weekly_support_selections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"permission_revision" uuid NOT NULL,
	"source_digest" text NOT NULL,
	"template_version" text NOT NULL,
	"kind" text NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reviewer_revision" uuid NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "weekly_support_member_answer_key" UNIQUE("member_id","answer_id"),
	CONSTRAINT "weekly_support_selections_kind_check" CHECK ("weekly_support_selections"."kind" in ('shared_interest', 'company', 'practical_help'))
);
--> statement-breakpoint
ALTER TABLE "weekly_support_permissions" ADD CONSTRAINT "weekly_support_permissions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_permissions" ADD CONSTRAINT "weekly_support_permissions_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_permissions" ADD CONSTRAINT "weekly_support_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_presentations" ADD CONSTRAINT "weekly_support_presentations_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_presentations" ADD CONSTRAINT "weekly_support_presentations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_presentations" ADD CONSTRAINT "weekly_support_presentations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_selections" ADD CONSTRAINT "weekly_support_selections_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_selections" ADD CONSTRAINT "weekly_support_selections_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_selections" ADD CONSTRAINT "weekly_support_selections_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_support_selections" ADD CONSTRAINT "weekly_support_selections_reviewer_id_members_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_support_presentations_expiry_idx" ON "weekly_support_presentations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "weekly_support_selection_expiry_idx" ON "weekly_support_selections" USING btree ("expires_at");