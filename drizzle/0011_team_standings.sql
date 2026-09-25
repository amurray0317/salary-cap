CREATE TABLE "ext_team_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"row_key" text NOT NULL,
	"league" text DEFAULT 'NHL' NOT NULL,
	"team_abbrev" text NOT NULL,
	"team_name" text NOT NULL,
	"season" text NOT NULL,
	"game_type" text NOT NULL,
	"standings_date" date NOT NULL,
	"conference" text,
	"division" text,
	"games_played" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"ot_losses" integer NOT NULL,
	"points" integer NOT NULL,
	"point_pct" real,
	"regulation_wins" integer,
	"regulation_plus_ot_wins" integer,
	"goals_for" integer,
	"goals_against" integer,
	"league_rank" integer,
	"conference_rank" integer,
	"division_rank" integer,
	"wildcard_rank" integer,
	"clinch" text,
	"streak" text,
	"last_ten" text,
	"home_record" text,
	"road_record" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ext_team_standings" ADD CONSTRAINT "ext_team_standings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_team_standings" ADD CONSTRAINT "ext_team_standings_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_team_standings" ADD CONSTRAINT "ext_team_standings_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ext_team_standings_unique" ON "ext_team_standings" USING btree ("organization_id","source","row_key");