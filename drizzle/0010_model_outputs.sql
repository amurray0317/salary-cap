CREATE TABLE "ext_league_equivalencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"model_version" text NOT NULL,
	"league" text NOT NULL,
	"multiplier" real NOT NULL,
	"log_factor" real NOT NULL,
	"standard_error" real,
	"pairs" integer NOT NULL,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ext_prospect_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"model_version" text NOT NULL,
	"external_player_id" text NOT NULL,
	"player_name" text NOT NULL,
	"draft_year" integer NOT NULL,
	"overall_pick" integer NOT NULL,
	"round" integer,
	"position" text,
	"drafted_by" text,
	"birth_date" date,
	"age_at_draft" real,
	"height_inches" integer,
	"weight_pounds" integer,
	"d0_league" text,
	"d0_league_group" text,
	"d0_games_played" integer,
	"d0_points" integer,
	"d0_ppg" real,
	"d0_nhle_ppg" real,
	"dm1_league" text,
	"dm1_games_played" integer,
	"dm1_points" integer,
	"dm1_nhle_ppg" real,
	"p_nhl_regular" real NOT NULL,
	"baseline_p" real NOT NULL,
	"p_by_pick" real,
	"contributions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projection_kind" text NOT NULL,
	"label_mature" boolean NOT NULL,
	"nhl_regular" boolean,
	"nhl_gp_7" integer,
	"nhl_gp_to_date" integer,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ext_league_equivalencies" ADD CONSTRAINT "ext_league_equivalencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_league_equivalencies" ADD CONSTRAINT "ext_league_equivalencies_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_league_equivalencies" ADD CONSTRAINT "ext_league_equivalencies_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_prospect_projections" ADD CONSTRAINT "ext_prospect_projections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_prospect_projections" ADD CONSTRAINT "ext_prospect_projections_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_prospect_projections" ADD CONSTRAINT "ext_prospect_projections_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ext_league_equivalencies_unique" ON "ext_league_equivalencies" USING btree ("organization_id","source","league");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_prospect_projections_unique" ON "ext_prospect_projections" USING btree ("organization_id","source","external_player_id");--> statement-breakpoint
CREATE INDEX "ext_prospect_projections_draft_idx" ON "ext_prospect_projections" USING btree ("organization_id","draft_year","overall_pick");