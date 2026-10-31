CREATE TABLE "photo_box" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"era" text NOT NULL,
	"caption" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_box_media_id_key" UNIQUE("media_id"),
	CONSTRAINT "photo_box_era_check" CHECK ("era" in ('new', 'old'))
);
--> statement-breakpoint
CREATE TABLE "photo_box_uses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"exchange_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"box_id" uuid,
	"local_day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_box" ADD CONSTRAINT "photo_box_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_box" ADD CONSTRAINT "photo_box_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_box" ADD CONSTRAINT "photo_box_added_by_members_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_box_uses" ADD CONSTRAINT "photo_box_uses_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_box_uses" ADD CONSTRAINT "photo_box_uses_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_box_uses" ADD CONSTRAINT "photo_box_uses_box_id_photo_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."photo_box"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_box_family_idx" ON "photo_box" USING btree ("family_id","created_at");--> statement-breakpoint
CREATE INDEX "photo_box_uses_member_day_idx" ON "photo_box_uses" USING btree ("member_id","local_day");--> statement-breakpoint
CREATE INDEX "photo_box_uses_box_idx" ON "photo_box_uses" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "photo_box_uses_exchange_idx" ON "photo_box_uses" USING btree ("exchange_id");