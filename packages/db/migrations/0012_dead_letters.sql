CREATE TABLE "dead_letters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"message_id" text NOT NULL,
	"job_type" text NOT NULL,
	"job" jsonb NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replay_requested_at" timestamp with time zone,
	"replayed_at" timestamp with time zone,
	CONSTRAINT "dead_letters_message_id_key" UNIQUE("message_id"),
	CONSTRAINT "dead_letters_job_type_check" CHECK ("job_type" in ('deliver', 'ingest_answer_media', 'ingest_exchange_media', 'understand_answer', 'handle_inbound'))
);
--> statement-breakpoint
CREATE INDEX "dead_letters_failed_at_idx" ON "dead_letters" USING btree ("failed_at");