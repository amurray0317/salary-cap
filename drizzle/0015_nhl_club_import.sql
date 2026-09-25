ALTER TYPE "public"."free_agent_status" ADD VALUE 'unknown';--> statement-breakpoint
ALTER TYPE "public"."waiver_status" ADD VALUE 'unknown';--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "nhl_player_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "players_org_nhl_id" ON "players" USING btree ("organization_id","nhl_player_id");