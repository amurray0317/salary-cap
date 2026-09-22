CREATE TABLE "connector_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connector_key" text NOT NULL,
	"cache_key" text NOT NULL,
	"request_url" text NOT NULL,
	"http_status" integer NOT NULL,
	"content_type" text,
	"body" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_draft_picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"draft_year" integer NOT NULL,
	"round" integer NOT NULL,
	"pick_in_round" integer,
	"overall_pick" integer NOT NULL,
	"team_abbrev" text,
	"team_pick_history" text,
	"player_name" text NOT NULL,
	"position" text,
	"country_code" text,
	"height_inches" integer,
	"weight_pounds" integer,
	"amateur_club" text,
	"amateur_league" text,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_draft_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"draft_year" integer NOT NULL,
	"category_id" integer NOT NULL,
	"category_key" text NOT NULL,
	"row_key" text NOT NULL,
	"player_name" text NOT NULL,
	"position" text,
	"shoots_catches" text,
	"height_inches" integer,
	"weight_pounds" integer,
	"birth_date" date,
	"birth_city" text,
	"birth_state_province" text,
	"birth_country" text,
	"last_amateur_club" text,
	"last_amateur_league" text,
	"midterm_rank" integer,
	"final_rank" integer,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_player_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"row_key" text NOT NULL,
	"external_player_id" text NOT NULL,
	"player_name" text,
	"season" text NOT NULL,
	"game_type" text NOT NULL,
	"league" text,
	"team_name" text,
	"situation" text DEFAULT 'all' NOT NULL,
	"position" text,
	"games_played" integer,
	"goals" integer,
	"assists" integer,
	"points" integer,
	"plus_minus" integer,
	"penalty_minutes" integer,
	"shots" integer,
	"pp_goals" integer,
	"pp_points" integer,
	"sh_goals" integer,
	"sh_points" integer,
	"gw_goals" integer,
	"faceoff_pct" real,
	"shooting_pct" real,
	"toi_seconds" integer,
	"toi_per_game_seconds" real,
	"games_started" integer,
	"wins" integer,
	"losses" integer,
	"ot_losses" integer,
	"shots_against" integer,
	"saves" integer,
	"goals_against" integer,
	"save_pct" real,
	"gaa" real,
	"shutouts" integer,
	"x_goals" real,
	"on_ice_xg_pct" real,
	"on_ice_corsi_pct" real,
	"on_ice_fenwick_pct" real,
	"game_score" real,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"full_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"position" text,
	"shoots_catches" text,
	"date_of_birth" date,
	"height_cm" integer,
	"weight_kg" integer,
	"birth_city" text,
	"birth_country" text,
	"current_team_abbrev" text,
	"is_active" boolean,
	"draft_year" integer,
	"draft_round" integer,
	"draft_pick_in_round" integer,
	"draft_overall" integer,
	"draft_team_abbrev" text,
	"source_id" uuid,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_roster_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"team_abbrev" text NOT NULL,
	"season" text NOT NULL,
	"external_player_id" text NOT NULL,
	"player_name" text NOT NULL,
	"sweater_number" integer,
	"position" text,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_team_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"row_key" text NOT NULL,
	"team_abbrev" text,
	"team_name" text,
	"season" text NOT NULL,
	"game_type" text NOT NULL,
	"situation" text DEFAULT 'all' NOT NULL,
	"games_played" integer,
	"wins" integer,
	"losses" integer,
	"ot_losses" integer,
	"points" integer,
	"goals_for" integer,
	"goals_against" integer,
	"shots_for_per_game" real,
	"shots_against_per_game" real,
	"pp_pct" real,
	"pk_pct" real,
	"faceoff_pct" real,
	"x_goals_for" real,
	"x_goals_against" real,
	"x_goals_pct" real,
	"corsi_pct" real,
	"fenwick_pct" real,
	"ice_time_seconds" integer,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "effective_season" text;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "credit" text;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "terms_note" text;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "source_kind" text DEFAULT 'csv_upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "connector_key" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "source_meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_cache" ADD CONSTRAINT "connector_cache_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_draft_picks" ADD CONSTRAINT "ext_draft_picks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_draft_picks" ADD CONSTRAINT "ext_draft_picks_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_draft_picks" ADD CONSTRAINT "ext_draft_picks_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_draft_rankings" ADD CONSTRAINT "ext_draft_rankings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_draft_rankings" ADD CONSTRAINT "ext_draft_rankings_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_draft_rankings" ADD CONSTRAINT "ext_draft_rankings_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_player_seasons" ADD CONSTRAINT "ext_player_seasons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_player_seasons" ADD CONSTRAINT "ext_player_seasons_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_player_seasons" ADD CONSTRAINT "ext_player_seasons_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_players" ADD CONSTRAINT "ext_players_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_players" ADD CONSTRAINT "ext_players_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_players" ADD CONSTRAINT "ext_players_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_roster_entries" ADD CONSTRAINT "ext_roster_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_roster_entries" ADD CONSTRAINT "ext_roster_entries_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_roster_entries" ADD CONSTRAINT "ext_roster_entries_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_team_seasons" ADD CONSTRAINT "ext_team_seasons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_team_seasons" ADD CONSTRAINT "ext_team_seasons_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_team_seasons" ADD CONSTRAINT "ext_team_seasons_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_cache_unique" ON "connector_cache" USING btree ("organization_id","cache_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_draft_picks_unique" ON "ext_draft_picks" USING btree ("organization_id","source","draft_year","overall_pick");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_draft_rankings_unique" ON "ext_draft_rankings" USING btree ("organization_id","source","draft_year","category_id","row_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_player_seasons_unique" ON "ext_player_seasons" USING btree ("organization_id","source","row_key");--> statement-breakpoint
CREATE INDEX "ext_player_seasons_player_idx" ON "ext_player_seasons" USING btree ("organization_id","external_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_players_unique" ON "ext_players" USING btree ("organization_id","source","external_id");--> statement-breakpoint
CREATE INDEX "ext_players_name_idx" ON "ext_players" USING btree ("organization_id","full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_roster_unique" ON "ext_roster_entries" USING btree ("organization_id","source","team_abbrev","season","external_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_team_seasons_unique" ON "ext_team_seasons" USING btree ("organization_id","source","row_key");--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;