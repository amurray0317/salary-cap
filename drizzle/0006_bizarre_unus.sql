CREATE TYPE "public"."cfa_relationship_status" AS ENUM('not_contacted', 'researching', 'initial_contact', 'active_communication', 'strong_interest', 'mutual_interest', 'offer_under_consideration', 'signed_elsewhere', 'signed_by_organization', 'no_longer_pursuing');--> statement-breakpoint
CREATE TABLE "board_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"board_kind" text NOT NULL,
	"board_id" uuid NOT NULL,
	"format" text DEFAULT 'csv' NOT NULL,
	"exported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_meeting_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"board_kind" text NOT NULL,
	"board_id" uuid NOT NULL,
	"author_id" uuid,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "college_free_agent_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "college_free_agent_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"priority_rank" integer NOT NULL,
	"nhl_rights_status" text DEFAULT 'unowned' NOT NULL,
	"remaining_eligibility" text,
	"expected_availability" date,
	"projected_ahl_role" text,
	"projected_nhl_role" text,
	"readiness" text,
	"fit_score" real,
	"market_competition" text,
	"agent_name" text,
	"relationship_status" "cfa_relationship_status" DEFAULT 'not_contacted' NOT NULL,
	"last_contact_date" date,
	"next_action" text,
	"next_action_date" date,
	"assigned_staff_id" uuid,
	"recommendation" text,
	"notes" text,
	"entry_status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "college_free_agent_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"field" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_board_rank_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"prospect_id" uuid,
	"field" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"previous_rank" integer,
	"new_rank" integer,
	"board_version" integer NOT NULL,
	"reason" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_board_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_board_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consensus_rankings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scout_rankings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "consensus_rankings" CASCADE;--> statement-breakpoint
DROP TABLE "scout_rankings" CASCADE;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "position_rank" integer;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "expected_round" integer;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "expected_range_start" integer;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "expected_range_end" integer;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "consensus_rank" real;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "fit_rank" integer;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "director_final_rank" integer;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "fit_score" real;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "floor" text;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "ceiling" text;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "viewing_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "report_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "last_viewed_at" date;--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "board_exports" ADD CONSTRAINT "board_exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_exports" ADD CONSTRAINT "board_exports_exported_by_users_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meeting_notes" ADD CONSTRAINT "board_meeting_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meeting_notes" ADD CONSTRAINT "board_meeting_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_free_agent_boards" ADD CONSTRAINT "college_free_agent_boards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_free_agent_boards" ADD CONSTRAINT "college_free_agent_boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_free_agent_entries" ADD CONSTRAINT "college_free_agent_entries_board_id_college_free_agent_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."college_free_agent_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_free_agent_entries" ADD CONSTRAINT "college_free_agent_entries_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_free_agent_entries" ADD CONSTRAINT "college_free_agent_entries_assigned_staff_id_users_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_free_agent_status_history" ADD CONSTRAINT "college_free_agent_status_history_entry_id_college_free_agent_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."college_free_agent_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "college_free_agent_status_history" ADD CONSTRAINT "college_free_agent_status_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_board_rank_history" ADD CONSTRAINT "draft_board_rank_history_board_id_draft_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."draft_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_board_rank_history" ADD CONSTRAINT "draft_board_rank_history_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_board_rank_history" ADD CONSTRAINT "draft_board_rank_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_board_snapshots" ADD CONSTRAINT "draft_board_snapshots_board_id_draft_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."draft_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_board_versions" ADD CONSTRAINT "draft_board_versions_board_id_draft_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."draft_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_board_versions" ADD CONSTRAINT "draft_board_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cfa_entry_unique" ON "college_free_agent_entries" USING btree ("board_id","prospect_id");--> statement-breakpoint
CREATE INDEX "cfa_history_idx" ON "college_free_agent_status_history" USING btree ("entry_id","created_at");--> statement-breakpoint
CREATE INDEX "board_rank_history_idx" ON "draft_board_rank_history" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "board_snapshot_unique" ON "draft_board_snapshots" USING btree ("board_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "board_version_unique" ON "draft_board_versions" USING btree ("board_id","version");--> statement-breakpoint
ALTER TABLE "draft_board_entries" ADD CONSTRAINT "draft_board_entries_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_boards" ADD CONSTRAINT "draft_boards_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;