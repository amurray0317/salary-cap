CREATE TABLE "fit_calculation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"need_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"prospects_evaluated" integer DEFAULT 0 NOT NULL,
	"scored_count" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fit_component_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fit_component_definitions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "fit_component_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_version_id" uuid NOT NULL,
	"component_key" text NOT NULL,
	"weight" real NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fit_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"version" text NOT NULL,
	"effective_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "fit_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fit_models_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "organizational_depth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid,
	"position" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizational_need_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"requirement_type" text NOT NULL,
	"key" text NOT NULL,
	"min_value" integer,
	"text_value" text
);
--> statement-breakpoint
CREATE TABLE "organizational_need_roster_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"link_type" text NOT NULL,
	"contract_id" uuid,
	"player_id" uuid,
	"prospect_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_fit_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fit_score_id" uuid NOT NULL,
	"component_key" text NOT NULL,
	"label" text NOT NULL,
	"input_value" text,
	"desired_value" text,
	"raw_score" real,
	"weight" real NOT NULL,
	"weighted_contribution" real,
	"penalty" real DEFAULT 0 NOT NULL,
	"final_score" real,
	"missing_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_pool_depth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid,
	"position" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "name" text DEFAULT 'Unnamed need' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "secondary_position" text;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "target_scout_role_key" text;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "earliest_arrival_years" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "latest_arrival_years" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "target_arrival_season" text;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "size_preference" text;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "special_teams_requirement" text;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "nhl_roster_need" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "ahl_opportunity" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizational_needs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_fit_scores" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "prospect_fit_scores" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "fit_calculation_runs" ADD CONSTRAINT "fit_calculation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_calculation_runs" ADD CONSTRAINT "fit_calculation_runs_need_id_organizational_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."organizational_needs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_calculation_runs" ADD CONSTRAINT "fit_calculation_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_component_weights" ADD CONSTRAINT "fit_component_weights_model_version_id_fit_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."fit_model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fit_model_versions" ADD CONSTRAINT "fit_model_versions_model_id_fit_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."fit_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_depth_snapshots" ADD CONSTRAINT "organizational_depth_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_depth_snapshots" ADD CONSTRAINT "organizational_depth_snapshots_run_id_fit_calculation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fit_calculation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_need_requirements" ADD CONSTRAINT "organizational_need_requirements_need_id_organizational_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."organizational_needs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_need_roster_links" ADD CONSTRAINT "organizational_need_roster_links_need_id_organizational_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."organizational_needs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_need_roster_links" ADD CONSTRAINT "organizational_need_roster_links_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_need_roster_links" ADD CONSTRAINT "organizational_need_roster_links_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizational_need_roster_links" ADD CONSTRAINT "organizational_need_roster_links_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_fit_components" ADD CONSTRAINT "prospect_fit_components_fit_score_id_prospect_fit_scores_id_fk" FOREIGN KEY ("fit_score_id") REFERENCES "public"."prospect_fit_scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_pool_depth_snapshots" ADD CONSTRAINT "prospect_pool_depth_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_pool_depth_snapshots" ADD CONSTRAINT "prospect_pool_depth_snapshots_run_id_fit_calculation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fit_calculation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fit_runs_org_idx" ON "fit_calculation_runs" USING btree ("organization_id","need_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fit_weight_unique" ON "fit_component_weights" USING btree ("model_version_id","component_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fit_model_version_unique" ON "fit_model_versions" USING btree ("model_id","version");--> statement-breakpoint
CREATE INDEX "depth_snapshots_org_idx" ON "organizational_depth_snapshots" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "need_requirement_unique" ON "organizational_need_requirements" USING btree ("need_id","requirement_type","key");--> statement-breakpoint
CREATE INDEX "need_roster_links_need_idx" ON "organizational_need_roster_links" USING btree ("need_id");--> statement-breakpoint
CREATE INDEX "fit_components_score_idx" ON "prospect_fit_components" USING btree ("fit_score_id");--> statement-breakpoint
CREATE INDEX "pool_snapshots_org_idx" ON "prospect_pool_depth_snapshots" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "prospect_fit_scores" ADD CONSTRAINT "prospect_fit_scores_run_id_fit_calculation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fit_calculation_runs"("id") ON DELETE set null ON UPDATE no action;