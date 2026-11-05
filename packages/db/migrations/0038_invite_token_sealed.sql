-- Invite tokens stop being readable in the database (ADR-38). Each existing invite keeps working by
-- the SHA-256 of its token, the same hex digest the services compute; its readable copy is emptied,
-- and only new invites store a sealed one. An open invite made before this shows the organiser a
-- fresh link next time, and the link already sent still opens.
-- reviewed: production holds no invites; in the seconds between this migration and the deploy, an
-- invite the old code makes fails visibly on the missing hash, and the organiser makes it again.
-- The token's own unique constraint goes first: every emptied token is the same ''.
ALTER TABLE "invites" DROP CONSTRAINT "invites_token_key";--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "token_hash" text;--> statement-breakpoint
UPDATE "invites" SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex'), "token" = '';--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_token_hash_key" UNIQUE("token_hash");
