CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"permission" text NOT NULL,
	"quiet_channel_blocked" boolean DEFAULT false NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_installation_id_key" UNIQUE("installation_id"),
	CONSTRAINT "push_devices_token_key" UNIQUE("token"),
	CONSTRAINT "push_devices_platform_check" CHECK ("platform" in ('ios', 'android')),
	CONSTRAINT "push_devices_permission_check" CHECK ("permission" in ('granted', 'denied', 'provisional'))
);
--> statement-breakpoint
CREATE TABLE "push_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"token_sha256" text NOT NULL,
	"outbound_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tickets_token_sha256_check" CHECK ("token_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "one_moment_a_day" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_device_id_push_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."push_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_outbound_id_outbound_id_fk" FOREIGN KEY ("outbound_id") REFERENCES "public"."outbound"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_tickets_created_idx" ON "push_tickets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "push_tickets_device_idx" ON "push_tickets" USING btree ("device_id");