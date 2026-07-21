/**
 * RosterIQ database schema (PostgreSQL via Drizzle ORM).
 *
 * Money convention: all monetary amounts are stored as whole US dollars in
 * `bigint` columns (mode "number"). Cap math never needs sub-dollar precision
 * and this avoids floating-point drift.
 *
 * Provenance convention: rows that can originate outside the app carry a
 * `sourceId` + `verificationStatus` so official / user-entered / estimated /
 * model-generated data stay distinguishable.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  date,
  boolean,
  integer,
  bigint,
  real,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const orgRole = pgEnum("org_role", [
  "league_admin",
  "org_admin",
  "general_manager",
  "assistant_gm",
  "analyst",
  "cap_analyst",
  "scout",
  "coach",
  "finance_admin",
  "college_admin",
  "nil_admin",
  "compliance_officer",
  "agent",
  "consultant",
  "viewer",
]);

export const dataProvenance = pgEnum("data_provenance", [
  "official",
  "user_entered",
  "estimated",
  "projected",
  "model_generated",
]);

export const verificationStatus = pgEnum("verification_status", [
  "unverified",
  "verified",
  "disputed",
  "stale",
]);

export const capSystem = pgEnum("cap_system", [
  "annual_hard_cap",
  "annual_soft_cap",
  "luxury_tax",
  "weekly_payroll",
  "daily_accounting",
  "custom_budget",
]);

export const contractType = pgEnum("contract_type", [
  "standard",
  "entry_level",
  "two_way",
  "one_way",
  "extension",
  "offer_sheet",
  "tryout",
  "minor_league",
]);

export const contractStatus = pgEnum("contract_status", [
  "draft",
  "active",
  "pending",
  "expired",
  "terminated",
  "bought_out",
  "traded",
]);

export const freeAgentStatus = pgEnum("free_agent_status", [
  "under_contract",
  "rfa",
  "ufa",
  "unsigned_prospect",
]);

export const waiverStatus = pgEnum("waiver_status", [
  "exempt",
  "required",
  "cleared",
  "claimed",
  "on_waivers",
]);

export const rosterStatus = pgEnum("roster_status", [
  "pro_active",
  "pro_scratch",
  "injured_reserve",
  "ltir",
  "minor",
  "juniors",
  "loaned",
  "suspended",
  "unsigned",
  "non_roster",
]);

export const scenarioStatus = pgEnum("scenario_status", [
  "draft",
  "active",
  "archived",
  "applied",
]);

export const transactionType = pgEnum("transaction_type", [
  "sign_free_agent",
  "re_sign",
  "extension",
  "trade",
  "waiver_claim",
  "waiver_assignment",
  "release",
  "termination",
  "buyout",
  "call_up",
  "send_down",
  "emergency_recall",
  "ir_placement",
  "ltir_placement",
  "ir_activation",
  "qualifying_offer",
  "arbitration_award",
  "offer_sheet",
  "retained_salary",
  "scholarship_commitment",
  "institutional_payment",
  "nil_commitment",
  "transfer_in",
  "transfer_out",
]);

export const severity = pgEnum("severity", [
  "info",
  "warning",
  "blocking",
  "requires_review",
]);

export const importStatus = pgEnum("import_status", [
  "pending",
  "validating",
  "awaiting_approval",
  "committed",
  "rejected",
  "failed",
]);

/* ------------------------------------------------------------------ */
/* Identity & tenancy                                                  */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  fullName: text("full_name").notNull(),
  authProvider: text("auth_provider").notNull().default("local"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  orgType: text("org_type").notNull().default("pro_team"), // pro_team | college | agency | league_office | consultancy
  settings: jsonb("settings").notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull().default("viewer"),
    invitedBy: uuid("invited_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("org_member_unique").on(t.organizationId, t.userId)],
);

/* ------------------------------------------------------------------ */
/* Leagues, seasons, rules                                             */
/* ------------------------------------------------------------------ */

export const leagues = pgTable("leagues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull(),
  sport: text("sport").notNull().default("hockey"),
  level: text("level").notNull().default("professional"), // professional | minor | junior | college
  capSystem: capSystem("cap_system").notNull().default("annual_hard_cap"),
  parentLeagueId: uuid("parent_league_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leagueSeasons = pgTable(
  "league_seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // e.g. "2025-26"
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    tradeDeadline: date("trade_deadline"),
    regularSeasonDays: integer("regular_season_days").notNull().default(186),
    isCurrent: boolean("is_current").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("league_season_unique").on(t.leagueId, t.name)],
);

/**
 * Versioned regulatory parameters. One row per (league, season, rule_key,
 * version). The engine only consumes rows with isActive = true; superseded
 * versions remain for audit/explainability.
 */
export const leagueRules = pgTable(
  "league_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => leagueSeasons.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(), // e.g. "cap.upper_limit"
    ruleName: text("rule_name").notNull(),
    ruleCategory: text("rule_category").notNull(), // cap | roster | contract | salary | waiver | scholarship | payment | custom
    numericValue: bigint("numeric_value", { mode: "number" }),
    textValue: text("text_value"),
    calculationMethod: text("calculation_method"),
    effectiveDate: date("effective_date").notNull(),
    expirationDate: date("expiration_date"),
    sourceId: uuid("source_id").references(() => dataSources.id),
    ruleVersion: integer("rule_version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("league_rules_lookup").on(t.leagueId, t.seasonId, t.ruleKey),
    uniqueIndex("league_rules_version_unique").on(t.seasonId, t.ruleKey, t.ruleVersion),
  ],
);

/** Immutable history of rule value changes (audit of the rules themselves). */
export const ruleVersions = pgTable("rule_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id").notNull().references(() => leagueRules.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  numericValue: bigint("numeric_value", { mode: "number" }),
  textValue: text("text_value"),
  changedBy: uuid("changed_by").references(() => users.id),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Convenience view-table of cap ceilings/floors per season (also expressible as rules). */
export const salaryCapPeriods = pgTable("salary_cap_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  leagueId: uuid("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id, { onDelete: "cascade" }),
  periodType: text("period_type").notNull().default("season"), // season | week | day
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  upperLimit: bigint("upper_limit", { mode: "number" }).notNull(),
  lowerLimit: bigint("lower_limit", { mode: "number" }),
  notes: text("notes"),
});

export const rosterLimits = pgTable("roster_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  leagueId: uuid("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id, { onDelete: "cascade" }),
  limitKey: text("limit_key").notNull(), // max_active | min_active | max_contracts | max_reserve_list ...
  limitValue: integer("limit_value").notNull(),
  appliesTo: text("applies_to").notNull().default("team"),
  notes: text("notes"),
});

/* ------------------------------------------------------------------ */
/* Teams & rosters                                                     */
/* ------------------------------------------------------------------ */

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  leagueId: uuid("league_id").notNull().references(() => leagues.id),
  name: text("name").notNull(),
  abbreviation: text("abbreviation").notNull(),
  city: text("city"),
  level: text("level").notNull().default("pro"), // pro | affiliate_aaa | affiliate_aa | college
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamAffiliations = pgTable("team_affiliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentTeamId: uuid("parent_team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  affiliateTeamId: uuid("affiliate_team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  affiliationType: text("affiliation_type").notNull().default("primary"),
  startDate: date("start_date"),
  endDate: date("end_date"),
});

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    preferredName: text("preferred_name"),
    dateOfBirth: date("date_of_birth"),
    position: text("position").notNull(), // C | LW | RW | D | G
    shootsCatches: text("shoots_catches"), // L | R
    heightCm: integer("height_cm"),
    weightKg: integer("weight_kg"),
    nationality: text("nationality"),
    draftYear: integer("draft_year"),
    draftRound: integer("draft_round"),
    draftOverall: integer("draft_overall"),
    currentTeamId: uuid("current_team_id").references(() => teams.id),
    rosterStatus: rosterStatus("roster_status").notNull().default("pro_active"),
    freeAgentStatus: freeAgentStatus("free_agent_status").notNull().default("under_contract"),
    waiverStatus: waiverStatus("waiver_status").notNull().default("required"),
    injuryStatus: text("injury_status"),
    proGamesPlayed: integer("pro_games_played").notNull().default(0),
    notes: text("notes"),
    sourceId: uuid("source_id").references(() => dataSources.id),
    provenance: dataProvenance("provenance").notNull().default("user_entered"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("players_org_idx").on(t.organizationId)],
);

export const rosters = pgTable("rosters", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id),
  name: text("name").notNull().default("Official"),
  isOfficial: boolean("is_official").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rosterMemberships = pgTable(
  "roster_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rosterId: uuid("roster_id").notNull().references(() => rosters.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    status: rosterStatus("status").notNull().default("pro_active"),
    slot: text("slot"), // depth-chart slot, e.g. "C1", "LD2"
    startDate: date("start_date"),
    endDate: date("end_date"),
  },
  (t) => [uniqueIndex("roster_member_unique").on(t.rosterId, t.playerId)],
);

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    leagueId: uuid("league_id").notNull().references(() => leagues.id),
    contractType: contractType("contract_type").notNull().default("standard"),
    contractStatus: contractStatus("contract_status").notNull().default("active"),
    signedDate: date("signed_date"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    totalValue: bigint("total_value", { mode: "number" }).notNull().default(0),
    averageAnnualValue: bigint("average_annual_value", { mode: "number" }).notNull().default(0),
    guaranteedValue: bigint("guaranteed_value", { mode: "number" }).notNull().default(0),
    minorLeagueValue: bigint("minor_league_value", { mode: "number" }),
    signingBonusTotal: bigint("signing_bonus_total", { mode: "number" }).notNull().default(0),
    performanceBonusTotal: bigint("performance_bonus_total", { mode: "number" }).notNull().default(0),
    noTradeClause: boolean("no_trade_clause").notNull().default(false),
    noMovementClause: boolean("no_movement_clause").notNull().default(false),
    modifiedTradeProtection: text("modified_trade_protection"),
    retainedSalaryPercentage: real("retained_salary_percentage").notNull().default(0),
    arbitrationStatus: text("arbitration_status").notNull().default("ineligible"),
    freeAgentStatus: freeAgentStatus("free_agent_status").notNull().default("under_contract"),
    waiverStatus: waiverStatus("waiver_status").notNull().default("required"),
    buyoutEligible: boolean("buyout_eligible").notNull().default(true),
    notes: text("notes"),
    sourceId: uuid("source_id").references(() => dataSources.id),
    provenance: dataProvenance("provenance").notNull().default("user_entered"),
    verificationStatus: verificationStatus("verification_status").notNull().default("unverified"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contracts_org_idx").on(t.organizationId),
    index("contracts_player_idx").on(t.playerId),
  ],
);

export const contractSeasons = pgTable(
  "contract_seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id),
    baseSalary: bigint("base_salary", { mode: "number" }).notNull().default(0),
    signingBonus: bigint("signing_bonus", { mode: "number" }).notNull().default(0),
    performanceBonus: bigint("performance_bonus", { mode: "number" }).notNull().default(0),
    totalCash: bigint("total_cash", { mode: "number" }).notNull().default(0),
    capHit: bigint("cap_hit", { mode: "number" }).notNull().default(0),
    minorLeagueSalary: bigint("minor_league_salary", { mode: "number" }),
    retainedSalary: bigint("retained_salary", { mode: "number" }).notNull().default(0),
    buriedAmount: bigint("buried_amount", { mode: "number" }).notNull().default(0),
    deadCapAmount: bigint("dead_cap_amount", { mode: "number" }).notNull().default(0),
    isOptionYear: boolean("is_option_year").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("contract_season_unique").on(t.contractId, t.seasonId)],
);

export const contractClauses = pgTable("contract_clauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  clauseType: text("clause_type").notNull(), // NTC | NMC | M-NTC | option | bonus_schedule ...
  seasonId: uuid("season_id").references(() => leagueSeasons.id),
  details: jsonb("details").notNull().default({}),
  notes: text("notes"),
});

/**
 * Retained-salary obligations and dead cap held by a team that are NOT part of
 * an active roster contract (e.g. retained in a past trade, buyout schedule).
 */
export const capObligations = pgTable("cap_obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id),
  obligationType: text("obligation_type").notNull(), // retained | buyout | termination | recapture
  playerName: text("player_name").notNull(),
  playerId: uuid("player_id").references(() => players.id),
  amount: bigint("amount", { mode: "number" }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Transactions & scenarios                                            */
/* ------------------------------------------------------------------ */

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id),
  seasonId: uuid("season_id").references(() => leagueSeasons.id),
  transactionType: transactionType("transaction_type").notNull(),
  transactionDate: date("transaction_date").notNull(),
  description: text("description"),
  isOfficial: boolean("is_official").notNull().default(true),
  payload: jsonb("payload").notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactionItems = pgTable("transaction_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").references(() => players.id),
  contractId: uuid("contract_id").references(() => contracts.id),
  itemType: text("item_type").notNull(), // player_out | player_in | pick | retained_slice | cash
  details: jsonb("details").notNull().default({}),
});

export const scenarios = pgTable(
  "scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    baseSeasonId: uuid("base_season_id").notNull().references(() => leagueSeasons.id),
    status: scenarioStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scenarios_org_idx").on(t.organizationId)],
);

/**
 * Ordered hypothetical transactions inside a scenario. These NEVER touch
 * official data; the scenario projector overlays them at read time.
 */
export const scenarioTransactions = pgTable(
  "scenario_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    transactionType: transactionType("transaction_type").notNull(),
    label: text("label").notNull(),
    /** Typed payload validated by zod schemas in src/lib/scenario/payloads.ts */
    payload: jsonb("payload").notNull().default({}),
    isEnabled: boolean("is_enabled").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scenario_tx_scenario_idx").on(t.scenarioId)],
);

/** Materialized scenario roster snapshots (optional cache of projector output). */
export const scenarioRosters = pgTable("scenario_rosters", {
  id: uuid("id").primaryKey().defaultRandom(),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id),
  snapshot: jsonb("snapshot").notNull().default({}),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Hypothetical contracts proposed inside a scenario (e.g. simulated signing). */
export const scenarioContracts = pgTable("scenario_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").references(() => players.id),
  playerName: text("player_name").notNull(),
  position: text("position").notNull().default("C"),
  contractType: contractType("contract_type").notNull().default("standard"),
  seasons: jsonb("seasons").notNull().default([]), // [{seasonId, capHit, baseSalary, ...}]
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Statistics, projections, valuation                                  */
/* ------------------------------------------------------------------ */

export const playerStatistics = pgTable(
  "player_statistics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id),
    leagueId: uuid("league_id").references(() => leagues.id),
    gamesPlayed: integer("games_played").notNull().default(0),
    goals: integer("goals").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    points: integer("points").notNull().default(0),
    timeOnIceMinutes: real("toi_minutes").notNull().default(0),
    goalsAboveReplacement: real("gar").notNull().default(0),
    winsAboveReplacement: real("war").notNull().default(0),
    expectedGoalsImpact: real("xg_impact").notNull().default(0),
    defensiveImpact: real("defensive_impact").notNull().default(0),
    provenance: dataProvenance("provenance").notNull().default("user_entered"),
    sourceId: uuid("source_id").references(() => dataSources.id),
  },
  (t) => [uniqueIndex("player_stat_unique").on(t.playerId, t.seasonId)],
);

export const playerProjections = pgTable(
  "player_projections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id),
    modelVersion: text("model_version").notNull(),
    projectedGamesPlayed: integer("projected_games_played").notNull().default(0),
    projectedGoals: real("projected_goals").notNull().default(0),
    projectedAssists: real("projected_assists").notNull().default(0),
    projectedPoints: real("projected_points").notNull().default(0),
    projectedTimeOnIce: real("projected_toi").notNull().default(0),
    projectedGar: real("projected_gar").notNull().default(0),
    projectedWar: real("projected_war").notNull().default(0),
    projectedAvailability: real("projected_availability").notNull().default(1),
    provenance: dataProvenance("provenance").notNull().default("projected"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("player_projection_unique").on(t.playerId, t.seasonId, t.modelVersion)],
);

export const playerValuations = pgTable("player_valuations", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id),
  modelVersion: text("model_version").notNull(),
  estimatedAav: bigint("estimated_aav", { mode: "number" }).notNull(),
  estimatedAavLow: bigint("estimated_aav_low", { mode: "number" }).notNull(),
  estimatedAavHigh: bigint("estimated_aav_high", { mode: "number" }).notNull(),
  estimatedTermYears: real("estimated_term_years").notNull(),
  estimatedTotalValue: bigint("estimated_total_value", { mode: "number" }).notNull(),
  performanceValue: bigint("performance_value", { mode: "number" }).notNull(),
  confidence: real("confidence").notNull(), // 0..1
  assumptions: jsonb("assumptions").notNull().default({}),
  inputDataDate: date("input_data_date"),
  provenance: dataProvenance("provenance").notNull().default("model_generated"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const comparableContracts = pgTable("comparable_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  playerName: text("player_name").notNull(), // fictional reference pool
  position: text("position").notNull(),
  ageAtSigning: real("age_at_signing").notNull(),
  platformPoints: real("platform_points").notNull().default(0),
  platformGar: real("platform_gar").notNull().default(0),
  aav: bigint("aav", { mode: "number" }).notNull(),
  termYears: integer("term_years").notNull(),
  signingSeason: text("signing_season").notNull(),
  capPctAtSigning: real("cap_pct_at_signing").notNull().default(0),
  provenance: dataProvenance("provenance").notNull().default("estimated"),
  sourceId: uuid("source_id").references(() => dataSources.id),
});

export const surplusValueRecords = pgTable("surplus_value_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => leagueSeasons.id),
  modelVersion: text("model_version").notNull(),
  performanceValue: bigint("performance_value", { mode: "number" }).notNull(),
  capHit: bigint("cap_hit", { mode: "number" }).notNull(),
  surplusValue: bigint("surplus_value", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Optimization (schema reserved; engine ships post-MVP)               */
/* ------------------------------------------------------------------ */

export const optimizationRuns = pgTable("optimization_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id),
  seasonId: uuid("season_id").references(() => leagueSeasons.id),
  objective: text("objective").notNull(),
  status: text("status").notNull().default("pending"),
  solver: text("solver"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const optimizationConstraints = pgTable("optimization_constraints", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => optimizationRuns.id, { onDelete: "cascade" }),
  constraintKey: text("constraint_key").notNull(),
  constraintValue: jsonb("constraint_value").notNull().default({}),
});

export const optimizationResults = pgTable("optimization_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => optimizationRuns.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull().default(1),
  objectiveValue: real("objective_value"),
  totalCapHit: bigint("total_cap_hit", { mode: "number" }),
  result: jsonb("result").notNull().default({}),
});

/* ------------------------------------------------------------------ */
/* College module (schema reserved; UI ships post-MVP)                 */
/* ------------------------------------------------------------------ */

export const conferences = pgTable("conferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  level: text("level").notNull().default("division_1"),
});

export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  conferenceId: uuid("conference_id").references(() => conferences.id),
});

export const academicYears = pgTable("academic_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // e.g. "2026-27"
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
});

export const collegeTeams = pgTable("college_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  sport: text("sport").notNull(),
  gender: text("gender"),
  rosterLimit: integer("roster_limit"),
});

export const athletes = pgTable("athletes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  collegeTeamId: uuid("college_team_id").references(() => collegeTeams.id),
  fullName: text("full_name").notNull(),
  position: text("position"),
  eligibilityYearsRemaining: integer("eligibility_years_remaining"),
  redshirtStatus: text("redshirt_status"),
  transferStatus: text("transfer_status"),
  retentionRisk: text("retention_risk"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scholarships = pgTable("scholarships", {
  id: uuid("id").primaryKey().defaultRandom(),
  collegeTeamId: uuid("college_team_id").notNull().references(() => collegeTeams.id, { onDelete: "cascade" }),
  academicYearId: uuid("academic_year_id").notNull().references(() => academicYears.id),
  totalEquivalents: real("total_equivalents").notNull().default(0),
  budget: bigint("budget", { mode: "number" }),
});

export const scholarshipAllocations = pgTable("scholarship_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  scholarshipId: uuid("scholarship_id").notNull().references(() => scholarships.id, { onDelete: "cascade" }),
  athleteId: uuid("athlete_id").notNull().references(() => athletes.id, { onDelete: "cascade" }),
  fraction: real("fraction").notNull().default(1), // 1 = full, 0.5 = half...
  annualValue: bigint("annual_value", { mode: "number" }),
  components: jsonb("components").notNull().default({}), // tuition, fees, room, board, COA...
});

export const institutionalPayments = pgTable("institutional_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  athleteId: uuid("athlete_id").notNull().references(() => athletes.id, { onDelete: "cascade" }),
  academicYearId: uuid("academic_year_id").notNull().references(() => academicYears.id),
  paymentType: text("payment_type").notNull().default("revenue_share"),
  annualValue: bigint("annual_value", { mode: "number" }).notNull(),
  guaranteedValue: bigint("guaranteed_value", { mode: "number" }),
  notes: text("notes"),
});

export const nilAgreements = pgTable("nil_agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  athleteId: uuid("athlete_id").notNull().references(() => athletes.id, { onDelete: "cascade" }),
  counterparty: text("counterparty").notNull(),
  category: text("category"),
  estimatedAnnualValue: bigint("estimated_annual_value", { mode: "number" }),
  guaranteedValue: bigint("guaranteed_value", { mode: "number" }),
  termMonths: integer("term_months"),
  deliverables: text("deliverables"),
  reportingStatus: text("reporting_status").notNull().default("unreported"),
  complianceStatus: text("compliance_status").notNull().default("pending"),
  provenance: dataProvenance("provenance").notNull().default("user_entered"),
});

export const nilValuations = pgTable("nil_valuations", {
  id: uuid("id").primaryKey().defaultRandom(),
  athleteId: uuid("athlete_id").notNull().references(() => athletes.id, { onDelete: "cascade" }),
  modelVersion: text("model_version").notNull(),
  estimatedAnnualValue: bigint("estimated_annual_value", { mode: "number" }).notNull(),
  lowEstimate: bigint("low_estimate", { mode: "number" }).notNull(),
  highEstimate: bigint("high_estimate", { mode: "number" }).notNull(),
  confidence: real("confidence").notNull(),
  drivers: jsonb("drivers").notNull().default({}),
  provenance: dataProvenance("provenance").notNull().default("model_generated"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Compliance, reporting, audit, imports                               */
/* ------------------------------------------------------------------ */

export const complianceRules = pgTable("compliance_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  leagueId: uuid("league_id").references(() => leagues.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  ruleName: text("rule_name").notNull(),
  description: text("description"),
  severity: severity("severity").notNull().default("warning"),
  isActive: boolean("is_active").notNull().default(true),
});

export const complianceResults = pgTable("compliance_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id),
  seasonId: uuid("season_id").references(() => leagueSeasons.id),
  scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  severity: severity("severity").notNull(),
  message: text("message").notNull(),
  affectedPlayerId: uuid("affected_player_id").references(() => players.id),
  financialImpact: bigint("financial_impact", { mode: "number" }),
  resolution: text("resolution"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  reportType: text("report_type").notNull(),
  title: text("title").notNull(),
  parameters: jsonb("parameters").notNull().default({}),
  modelVersions: jsonb("model_versions").notNull().default({}),
  generatedBy: uuid("generated_by").references(() => users.id),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  shareToken: text("share_token").unique(),
});

export const reportSections = pgTable("report_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  sectionType: text("section_type").notNull(), // table | chart | notes | disclaimer
  title: text("title"),
  content: jsonb("content").notNull().default({}),
});

export const savedViews = pgTable("saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  viewKey: text("view_key").notNull(),
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default({}),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(), // contract.create, scenario.apply, rule.update ...
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    previousValues: jsonb("previous_values"),
    newValues: jsonb("new_values"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_org_idx").on(t.organizationId, t.createdAt)],
);

export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
  effectiveDate: date("effective_date"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  confidence: real("confidence"),
  notes: text("notes"),
});

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  importType: text("import_type").notNull(), // players | contracts | contract_seasons | rules | stats ...
  fileName: text("file_name").notNull(),
  status: importStatus("status").notNull().default("pending"),
  rowCount: integer("row_count").notNull().default(0),
  committedCount: integer("committed_count").notNull().default(0),
  mapping: jsonb("mapping").notNull().default({}),
  /** Parsed CSV kept between upload and approval: { headers, rows }. */
  rawData: jsonb("raw_data").notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importErrors = pgTable("import_errors", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  columnName: text("column_name"),
  message: text("message").notNull(),
  rawRow: jsonb("raw_row"),
});
