ALTER TABLE "amateur_prospects" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "amateur_prospects" ADD COLUMN "draft_round" integer;--> statement-breakpoint
ALTER TABLE "amateur_prospects" ADD COLUMN "draft_overall" integer;--> statement-breakpoint
ALTER TABLE "conferences" ADD COLUMN "abbreviation" text;--> statement-breakpoint
ALTER TABLE "prospect_game_logs" ADD COLUMN "home_away" text;--> statement-breakpoint
ALTER TABLE "prospect_game_logs" ADD COLUMN "pp_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_game_logs" ADD COLUMN "faceoff_wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_game_logs" ADD COLUMN "faceoff_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_game_logs" ADD COLUMN "toi_seconds" integer;--> statement-breakpoint
ALTER TABLE "prospect_watchlist_members" ADD COLUMN "priority" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_watchlist_members" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "prospect_watchlist_members" ADD COLUMN "follow_up_date" date;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "abbreviation" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "country" text DEFAULT 'United States';--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "division" text DEFAULT 'division_1' NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;