CREATE TABLE "consensus_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"submissions" integer NOT NULL,
	"mean_rank" real NOT NULL,
	"median_rank" real NOT NULL,
	"best_rank" integer NOT NULL,
	"worst_rank" integer NOT NULL,
	"spread" integer NOT NULL,
	"stddev" real NOT NULL,
	"insufficient" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scout_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"scout_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consensus_rankings" ADD CONSTRAINT "consensus_rankings_board_id_draft_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."draft_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_rankings" ADD CONSTRAINT "consensus_rankings_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_rankings" ADD CONSTRAINT "scout_rankings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_rankings" ADD CONSTRAINT "scout_rankings_board_id_draft_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."draft_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_rankings" ADD CONSTRAINT "scout_rankings_prospect_id_amateur_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."amateur_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_rankings" ADD CONSTRAINT "scout_rankings_scout_id_users_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consensus_unique" ON "consensus_rankings" USING btree ("board_id","prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scout_ranking_unique" ON "scout_rankings" USING btree ("board_id","prospect_id","scout_id");