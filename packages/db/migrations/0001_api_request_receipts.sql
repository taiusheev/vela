CREATE TABLE "api_request_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_hash" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb,
	"family_id" uuid,
	"member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_request_receipts_actor_key_key" UNIQUE("actor_hash","key_hash"),
	CONSTRAINT "api_request_receipts_hashes_check" CHECK ("actor_hash" ~ '^[0-9a-f]{64}$' and "key_hash" ~ '^[0-9a-f]{64}$' and "request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_request_receipts_expiry_check" CHECK ("expires_at" > "created_at" and "expires_at" <= "created_at" + interval '24 hours'),
	CONSTRAINT "api_request_receipts_result_check" CHECK ("result" is null or jsonb_typeof("result") = 'object'),
	CONSTRAINT "api_request_receipts_member_scope_check" CHECK ("member_id" is null or "family_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "api_request_receipts" ADD CONSTRAINT "api_request_receipts_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_receipts" ADD CONSTRAINT "api_request_receipts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_request_receipts_expiry_idx" ON "api_request_receipts" USING btree ("expires_at");