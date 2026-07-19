CREATE TYPE "public"."assignment_status" AS ENUM('open', 'in_progress', 'complete', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."position_group" AS ENUM('F', 'D', 'G');--> statement-breakpoint
CREATE TYPE "public"."prospect_class" AS ENUM('freshman', 'sophomore', 'junior', 'senior', 'graduate');--> statement-breakpoint
CREATE TYPE "public"."scouting_report_status" AS ENUM('draft', 'submitted', 'final');--> statement-breakpoint
CREATE TYPE "public"."viewing_type" AS ENUM('live', 'video', 'crossover', 'analytics');--> statement-breakpoint
ALTER TYPE "public"."org_role" ADD VALUE 'scouting_director';--> statement-breakpoint
ALTER TYPE "public"."org_role" ADD VALUE 'scouting_asst_director';--> statement-breakpoint
ALTER TYPE "public"."org_role" ADD VALUE 'crossover_scout';--> statement-breakpoint
CREATE TABLE "amateur_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date,
	"position" text NOT NULL,
	"position_group" "position_group" DEFAULT 'F' NOT NULL,
	"shoots_catches" text,
	"height_cm" integer,
	"weight_kg" integer,
	"nationality" text,
	"school_id" uuid,
	"class_year" "prospect_class" DEFAULT 'freshman' NOT NULL,
	"previous_teams" text,
	"draft_year" integer,
	"nhl_draft_status" text DEFAULT 'undrafted' NOT NULL,
	"nhl_rights_holder" text,
	"college_free_agent_status" text DEFAULT 'not_eligible' NOT NULL,
	"scout_assigned_role_key" text,
	"projected_pro_role_key" text,
	"agent_name" text,
	"notes" text,
	"provenance" "data_provenance" DEFAULT 'user_entered' NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consensus_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"consensus_rank" integer NOT NULL,
	"model_rank" integer,
	"scout_rank" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_board_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"overall_rank" integer NOT NULL,
	"model_rank" integer,
	"scout_rank" integer,
	"risk" text,
	"recommendation" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"board_type" text DEFAULT 'draft' NOT NULL,
	"draft_year" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizational_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"position" text NOT NULL,
	"handedness" text,
	"target_role_key" text,
	"priority" integer DEFAULT 3 NOT NULL,
	"timeline_years" integer DEFAULT 3 NOT NULL,
	"preferred_acquisition" text DEFAULT 'draft' NOT NULL,
	"max_risk_tolerance" text DEFAULT 'medium' NOT NULL,
	"required_attributes" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"version" text NOT NULL,
	"notes" text,
	"trained_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "projection_models_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "prospect_comparables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"comparable_prospect_id" uuid,
	"comparable_name" text NOT NULL,
	"comparison_type" text DEFAULT 'statistical' NOT NULL,
	"similarity" real NOT NULL,
	"shared_traits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"differences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_period" text,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_fit_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"need_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"overall_score" real NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_game_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"season_name" text NOT NULL,
	"game_date" date NOT NULL,
	"opponent" text NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"penalty_minutes" integer DEFAULT 0 NOT NULL,
	"provenance" "data_provenance" DEFAULT 'user_entered' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"projected_nhl_role" text,
	"floor" text,
	"ceiling" text,
	"readiness" text,
	"confidence" real,
	"assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_role_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"archetype_id" uuid NOT NULL,
	"season_name" text NOT NULL,
	"model_version" text NOT NULL,
	"score" real NOT NULL,
	"confidence" real NOT NULL,
	"explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"season_name" text NOT NULL,
	"class_year" "prospect_class" NOT NULL,
	"school_id" uuid,
	"games_played" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"penalty_minutes" integer DEFAULT 0 NOT NULL,
	"plus_minus" integer DEFAULT 0 NOT NULL,
	"pp_goals" integer DEFAULT 0 NOT NULL,
	"pp_assists" integer DEFAULT 0 NOT NULL,
	"sh_goals" integer DEFAULT 0 NOT NULL,
	"faceoff_wins" integer DEFAULT 0 NOT NULL,
	"faceoff_attempts" integer DEFAULT 0 NOT NULL,
	"toi_seconds" integer,
	"team_goals_for" integer,
	"provenance" "data_provenance" DEFAULT 'user_entered' NOT NULL,
	"source_id" uuid
);
--> statement-breakpoint
CREATE TABLE "prospect_stat_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"requires_toi" boolean DEFAULT false NOT NULL,
	CONSTRAINT "prospect_stat_definitions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "prospect_tracking_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"season_name" text NOT NULL,
	"metric_key" text NOT NULL,
	"value" real NOT NULL,
	"provenance" "data_provenance" DEFAULT 'estimated' NOT NULL,
	"source_id" uuid
);
--> statement-breakpoint
CREATE TABLE "prospect_trends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"classification" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_video_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_watchlist_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_archetypes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"position_group" "position_group" NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "role_archetypes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_metric_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"archetype_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"weight" real NOT NULL,
	"model_version" text NOT NULL,
	"effective_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scout_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scout_id" uuid,
	"prospect_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"ranked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scout_viewings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scout_id" uuid,
	"prospect_id" uuid,
	"viewing_type" "viewing_type" DEFAULT 'live' NOT NULL,
	"game_date" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "scouting_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scout_id" uuid,
	"prospect_id" uuid,
	"region" text,
	"school_id" uuid,
	"assignment_type" text DEFAULT 'player' NOT NULL,
	"due_date" date,
	"status" "assignment_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scouting_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"scout_id" uuid,
	"viewing_type" "viewing_type" DEFAULT 'live' NOT NULL,
	"game_date" date,
	"opponent" text,
	"venue" text,
	"grading_scale" text DEFAULT '20-80' NOT NULL,
	"grades" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"strengths" text,
	"concerns" text,
	"development_priorities" text,
	"nhl_projection" text,
	"professional_floor" text,
	"professional_ceiling" text,
	"development_timeline" text,
	"risk" text,
	"recommendation" text,
	"confidence" real,
	"status" "scouting_report_status" DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amateur_prospects" ADD CONSTRAINT "amateur_prospects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amateur_prospects" ADD CONSTRAINT "amateur_prospects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amateur_prospects" ADD CONSTRAINT "amateur_prospects_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_rankings" ADD CONSTRAINT "consensus_rankings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_rankings" ADD CONSTRAINT "consensus_rankings_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD CONSTRAINT "draft_board_entries_board_id_draft_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."draft_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD CONSTRAINT "draft_board_entries_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD CONSTRAINT "draft_boards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD CONSTRAINT "draft_boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD CONSTRAINT "organizational_needs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD CONSTRAINT "organizational_needs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_model_versions" ADD CONSTRAINT "projection_model_versions_model_id_projection_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."projection_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_comparables" ADD CONSTRAINT "prospect_comparables_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_comparables" ADD CONSTRAINT "prospect_comparables_comparable_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("comparable_prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_fit_scores" ADD CONSTRAINT "prospect_fit_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_fit_scores" ADD CONSTRAINT "prospect_fit_scores_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_fit_scores" ADD CONSTRAINT "prospect_fit_scores_need_id_organizational_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."organizational_needs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_game_logs" ADD CONSTRAINT "prospect_game_logs_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_projections" ADD CONSTRAINT "prospect_projections_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_role_scores" ADD CONSTRAINT "prospect_role_scores_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_role_scores" ADD CONSTRAINT "prospect_role_scores_archetype_id_role_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."role_archetypes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_seasons" ADD CONSTRAINT "prospect_seasons_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_seasons" ADD CONSTRAINT "prospect_seasons_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_seasons" ADD CONSTRAINT "prospect_seasons_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_tracking_metrics" ADD CONSTRAINT "prospect_tracking_metrics_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_tracking_metrics" ADD CONSTRAINT "prospect_tracking_metrics_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_trends" ADD CONSTRAINT "prospect_trends_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_video_links" ADD CONSTRAINT "prospect_video_links_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_video_links" ADD CONSTRAINT "prospect_video_links_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_watchlist_members" ADD CONSTRAINT "prospect_watchlist_members_watchlist_id_prospect_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."prospect_watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_watchlist_members" ADD CONSTRAINT "prospect_watchlist_members_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_watchlist_members" ADD CONSTRAINT "prospect_watchlist_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_watchlists" ADD CONSTRAINT "prospect_watchlists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_watchlists" ADD CONSTRAINT "prospect_watchlists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_metric_weights" ADD CONSTRAINT "role_metric_weights_archetype_id_role_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."role_archetypes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_rankings" ADD CONSTRAINT "scout_rankings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_rankings" ADD CONSTRAINT "scout_rankings_scout_id_users_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_rankings" ADD CONSTRAINT "scout_rankings_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_viewings" ADD CONSTRAINT "scout_viewings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_viewings" ADD CONSTRAINT "scout_viewings_scout_id_users_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_viewings" ADD CONSTRAINT "scout_viewings_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scouting_assignments" ADD CONSTRAINT "scouting_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scouting_assignments" ADD CONSTRAINT "scouting_assignments_scout_id_users_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scouting_assignments" ADD CONSTRAINT "scouting_assignments_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scouting_assignments" ADD CONSTRAINT "scouting_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scouting_assignments" ADD CONSTRAINT "scouting_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scouting_reports" ADD CONSTRAINT "scouting_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scouting_reports" ADD CONSTRAINT "scouting_reports_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scouting_reports" ADD CONSTRAINT "scouting_reports_scout_id_users_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospects_org_idx" ON "amateur_prospects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "prospects_school_idx" ON "amateur_prospects" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_entry_unique" ON "draft_board_entries" USING btree ("board_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fit_score_unique" ON "prospect_fit_scores" USING btree ("prospect_id","need_id","model_version");--> statement-breakpoint
CREATE INDEX "game_logs_prospect_idx" ON "prospect_game_logs" USING btree ("prospect_id","game_date");--> statement-breakpoint
CREATE UNIQUE INDEX "role_score_unique" ON "prospect_role_scores" USING btree ("prospect_id","archetype_id","season_name","model_version");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_season_unique" ON "prospect_seasons" USING btree ("prospect_id","season_name");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_member_unique" ON "prospect_watchlist_members" USING btree ("watchlist_id","prospect_id");--> statement-breakpoint
CREATE INDEX "role_weights_arch_idx" ON "role_metric_weights" USING btree ("archetype_id","model_version");--> statement-breakpoint
CREATE INDEX "scouting_reports_org_idx" ON "scouting_reports" USING btree ("organization_id","prospect_id");