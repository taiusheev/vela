CREATE TABLE "book_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"family_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"exchange_id" uuid NOT NULL,
	"kept_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "book_entries_exchange_id_key" UNIQUE("exchange_id")
);
--> statement-breakpoint
ALTER TABLE "book_entries" ADD CONSTRAINT "book_entries_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_entries" ADD CONSTRAINT "book_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_entries" ADD CONSTRAINT "book_entries_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_entries" ADD CONSTRAINT "book_entries_removed_by_members_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_entries_family_idx" ON "book_entries" USING btree ("family_id","kept_at");