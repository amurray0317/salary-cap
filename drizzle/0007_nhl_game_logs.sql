CREATE TABLE "ext_player_game_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_player_id" text NOT NULL,
	"player_name" text,
	"game_id" text NOT NULL,
	"game_date" date NOT NULL,
	"season" text NOT NULL,
	"game_type" text NOT NULL,
	"team_abbrev" text,
	"opponent_abbrev" text,
	"home_road" text,
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
	"ot_goals" integer,
	"shifts" integer,
	"toi_seconds" integer,
	"games_started" integer,
	"decision" text,
	"shots_against" integer,
	"goals_against" integer,
	"save_pct" real,
	"shutouts" integer,
	"source_id" uuid,
	"import_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ext_player_game_logs" ADD CONSTRAINT "ext_player_game_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_player_game_logs" ADD CONSTRAINT "ext_player_game_logs_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ext_player_game_logs" ADD CONSTRAINT "ext_player_game_logs_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ext_game_logs_unique" ON "ext_player_game_logs" USING btree ("organization_id","source","external_player_id","game_id");--> statement-breakpoint
CREATE INDEX "ext_game_logs_player_idx" ON "ext_player_game_logs" USING btree ("organization_id","external_player_id","game_date");