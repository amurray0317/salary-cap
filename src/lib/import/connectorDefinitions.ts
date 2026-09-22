/**
 * Import-type definitions for REAL-DATA CONNECTOR datasets. These run through
 * the same gated pipeline as CSV uploads (preview → explicit approval →
 * commit) but are produced server-side by a connector, never uploaded, so
 * they are `connectorOnly`.
 *
 * Every non-identity field is optional: a value the source did not report
 * stays blank → NULL. Nothing is estimated (TOI in particular). Field
 * descriptions name the source column each value came from.
 *
 * Fields whose key starts with `m_` are stored in the row's `metrics` JSON
 * under the remaining name (e.g. m_ev_goals → metrics.ev_goals).
 */
import type { FieldDef } from "@/lib/import/definitions";

export const CONNECTOR_IMPORT_TYPES = [
  "nhl_players",
  "nhl_roster",
  "nhl_player_seasons",
  "nhl_skater_stats",
  "nhl_goalie_stats",
  "nhl_team_stats",
  "nhl_draft_picks",
  "nhl_draft_rankings",
  "moneypuck_skaters",
  "moneypuck_goalies",
  "moneypuck_teams",
  "ep_players",
] as const;
export type ConnectorImportType = (typeof CONNECTOR_IMPORT_TYPES)[number];

export type ExtTable =
  | "ext_players"
  | "ext_roster"
  | "ext_player_seasons"
  | "ext_team_seasons"
  | "ext_draft_picks"
  | "ext_draft_rankings";

/* ------------------------------------------------------------------ */
/* Field builders                                                      */
/* ------------------------------------------------------------------ */

const optional = (fn: (v: string) => string | null) => (v: string) => (v === "" ? null : fn(v));

function text(key: string, label: string, description: string, required = false): FieldDef {
  return {
    key,
    label,
    required,
    description,
    validate: (v) => (required && v.length === 0 ? "is required" : v.length > 300 ? "is longer than 300 characters" : null),
  };
}

function intField(key: string, label: string, description: string, opts: { min?: number; max?: number; required?: boolean } = {}): FieldDef {
  return {
    key,
    label,
    required: opts.required ?? false,
    description,
    validate: optional((v) => {
      const n = Number(v);
      if (!Number.isInteger(n)) return "must be a whole number";
      if (opts.min !== undefined && n < opts.min) return `must be ≥ ${opts.min}`;
      if (opts.max !== undefined && n > opts.max) return `must be ≤ ${opts.max}`;
      return null;
    }),
  };
}

function numField(key: string, label: string, description: string, opts: { min?: number; max?: number } = {}): FieldDef {
  return {
    key,
    label,
    required: false,
    description,
    validate: optional((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return "must be a number";
      if (opts.min !== undefined && n < opts.min) return `must be ≥ ${opts.min}`;
      if (opts.max !== undefined && n > opts.max) return `must be ≤ ${opts.max}`;
      return null;
    }),
  };
}

/** A 0–1 fraction (the sources report percentages as fractions: .915 save %). */
const fraction = (key: string, label: string, description: string) => numField(key, label, description, { min: 0, max: 1 });
const count = (key: string, label: string, description: string) => intField(key, label, description, { min: 0 });

function dateField(key: string, label: string, description: string): FieldDef {
  return {
    key,
    label,
    required: false,
    description,
    validate: optional((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? null : "must be YYYY-MM-DD")),
  };
}

function enumField(key: string, label: string, allowed: string[], description: string, required = false): FieldDef {
  return {
    key,
    label,
    required,
    description,
    validate: (v) => {
      if (v === "") return required ? "is required" : null;
      return allowed.includes(v) ? null : `must be one of: ${allowed.join(", ")}`;
    },
  };
}

const seasonField = (source: string): FieldDef => ({
  key: "season",
  label: "Season",
  required: true,
  description: `Season label derived from ${source}`,
  validate: (v) => (/^\d{4}-\d{2}$/.test(v) ? null : "must look like 2024-25"),
});
const gameTypeField = (source: string) => enumField("game_type", "Game type", ["regular", "playoffs"], `From ${source}`, true);
const positionField = (source: string) => enumField("position", "Position", ["C", "LW", "RW", "D", "G"], `${source} (L/R relabeled LW/RW)`);
const situationField = enumField("situation", "Situation", ["all", "5on5", "5on4", "4on5", "other"], "MoneyPuck `situation`", true);
const playerIdField = (source: string) => text("external_player_id", "NHL player id", source, true);

/* ------------------------------------------------------------------ */
/* Definitions                                                         */
/* ------------------------------------------------------------------ */

export interface ConnectorDatasetDef {
  type: ConnectorImportType;
  connectorKey: "nhl_api" | "moneypuck" | "eliteprospects";
  table: ExtTable;
  /** Value of the `source` column written on committed rows. */
  sourceTag: string;
  label: string;
  description: string;
  fields: FieldDef[];
  /** Deterministic natural key (in-file duplicate detection + upsert target). */
  rowKey: (v: Record<string, string>) => string;
}

const bioFields = (src: string): FieldDef[] => [
  text("external_id", "External id", `${src} player id`, true),
  text("full_name", "Full name", `${src} first + last name`, true),
  text("first_name", "First name", src),
  text("last_name", "Last name", src),
  positionField(src),
  enumField("shoots_catches", "Shoots/catches", ["L", "R"], src),
  dateField("date_of_birth", "Date of birth", src),
  intField("height_cm", "Height (cm)", `${src} (as reported in cm)`, { min: 120, max: 230 }),
  intField("weight_kg", "Weight (kg)", `${src} (as reported in kg)`, { min: 40, max: 160 }),
  text("birth_city", "Birth city", src),
  text("birth_country", "Birth country", src),
];

export const CONNECTOR_DEFINITIONS: Record<ConnectorImportType, ConnectorDatasetDef> = {
  nhl_players: {
    type: "nhl_players",
    connectorKey: "nhl_api",
    table: "ext_players",
    sourceTag: "nhl",
    label: "NHL API · player bios",
    description: "Player identity, bio, and draft details from api-web.nhle.com /v1/player/{id}/landing.",
    fields: [
      ...bioFields("NHL landing"),
      text("current_team_abbrev", "Current team", "NHL landing `currentTeamAbbrev` (blank for inactive players)"),
      enumField("is_active", "Active", ["true", "false"], "NHL landing `isActive`"),
      intField("draft_year", "Draft year", "NHL landing `draftDetails.year`", { min: 1963, max: 2100 }),
      intField("draft_round", "Draft round", "`draftDetails.round`", { min: 1, max: 30 }),
      intField("draft_pick_in_round", "Pick in round", "`draftDetails.pickInRound`", { min: 1 }),
      intField("draft_overall", "Overall pick", "`draftDetails.overallPick`", { min: 1 }),
      text("draft_team_abbrev", "Drafting team", "`draftDetails.teamAbbrev`"),
    ],
    rowKey: (v) => v.external_id ?? "",
  },

  nhl_roster: {
    type: "nhl_roster",
    connectorKey: "nhl_api",
    table: "ext_roster",
    sourceTag: "nhl",
    label: "NHL API · team roster",
    description: "Season roster (forwards, defensemen, goalies) from api-web.nhle.com /v1/roster/{team}/{season}. Also upserts each player's bio.",
    fields: [
      text("team_abbrev", "Team", "Requested team tri-code", true),
      seasonField("the requested season id"),
      ...bioFields("NHL roster"),
      intField("sweater_number", "Sweater #", "NHL roster `sweaterNumber`", { min: 0, max: 99 }),
    ],
    rowKey: (v) => `${v.team_abbrev}|${v.season}|${v.external_id}`,
  },

  nhl_player_seasons: {
    type: "nhl_player_seasons",
    connectorKey: "nhl_api",
    table: "ext_player_seasons",
    sourceTag: "nhl_career",
    label: "NHL API · player career seasons",
    description:
      "Every season line (all leagues, one row per team stint) from the player landing's `seasonTotals`. TOI is included only where the source reports it (NHL seasons); junior/minor lines have none and stay blank.",
    fields: [
      playerIdField("NHL landing `playerId`"),
      text("player_name", "Player", "NHL landing first + last name"),
      seasonField("`season`"),
      gameTypeField("`gameTypeId` (2 regular, 3 playoffs)"),
      text("league", "League", "`leagueAbbrev`"),
      text("team_name", "Team", "`teamName.default`"),
      intField("m_sequence", "Source sequence", "`sequence` (the source's row discriminator)", { min: 0, required: true }),
      text("situation", "Situation", "Always `all` for NHL totals", true),
      count("games_played", "GP", "`gamesPlayed`"),
      count("goals", "G", "`goals`"),
      count("assists", "A", "`assists`"),
      count("points", "P", "`points`"),
      intField("plus_minus", "+/-", "`plusMinus`"),
      count("penalty_minutes", "PIM", "`pim`"),
      count("shots", "Shots", "`shots`"),
      count("pp_goals", "PPG", "`powerPlayGoals`"),
      count("pp_points", "PPP", "`powerPlayPoints`"),
      count("sh_goals", "SHG", "`shorthandedGoals`"),
      count("sh_points", "SHP", "`shorthandedPoints`"),
      count("gw_goals", "GWG", "`gameWinningGoals`"),
      fraction("faceoff_pct", "FO%", "`faceoffWinningPctg`"),
      fraction("shooting_pct", "Sh%", "`shootingPctg`"),
      numField("toi_per_game_seconds", "TOI/GP (s)", "`avgToi` mm:ss → seconds; blank when not reported", { min: 0, max: 3600 }),
      count("games_started", "GS", "`gamesStarted` (goalies)"),
      count("wins", "W", "`wins` (goalies)"),
      count("losses", "L", "`losses` (goalies)"),
      count("ot_losses", "OTL", "`otLosses` (goalies)"),
      count("shots_against", "SA", "`shotsAgainst` (goalies)"),
      count("goals_against", "GA", "`goalsAgainst` (goalies)"),
      fraction("save_pct", "SV%", "`savePctg` (goalies; a 0 reported without shotsAgainst is treated as missing)"),
      numField("gaa", "GAA", "`goalsAgainstAvg` (goalies)", { min: 0, max: 30 }),
      count("shutouts", "SO", "`shutouts` (goalies)"),
      count("toi_seconds", "TOI (s)", "`timeOnIce` mm:ss → seconds (goalies); blank when not reported"),
    ],
    rowKey: (v) => `${v.external_player_id}|${v.season}|${v.game_type}|${v.league}|${v.m_sequence}`,
  },

  nhl_skater_stats: {
    type: "nhl_skater_stats",
    connectorKey: "nhl_api",
    table: "ext_player_seasons",
    sourceTag: "nhl_stats",
    label: "NHL API · league skater stats",
    description: "League-wide skater season summary from api.nhle.com/stats/rest/en/skater/summary (one aggregate row per player; traded players list every team).",
    fields: [
      playerIdField("stats `playerId`"),
      text("player_name", "Player", "`skaterFullName`"),
      seasonField("`seasonId`"),
      gameTypeField("the requested gameTypeId"),
      text("league", "League", "Always NHL"),
      text("team_name", "Team(s)", "`teamAbbrevs` (comma-separated when traded)"),
      text("situation", "Situation", "Always `all`", true),
      positionField("`positionCode`"),
      count("games_played", "GP", "`gamesPlayed`"),
      count("goals", "G", "`goals`"),
      count("assists", "A", "`assists`"),
      count("points", "P", "`points`"),
      intField("plus_minus", "+/-", "`plusMinus`"),
      count("penalty_minutes", "PIM", "`penaltyMinutes`"),
      count("shots", "Shots", "`shots`"),
      count("pp_goals", "PPG", "`ppGoals`"),
      count("pp_points", "PPP", "`ppPoints`"),
      count("sh_goals", "SHG", "`shGoals`"),
      count("sh_points", "SHP", "`shPoints`"),
      count("gw_goals", "GWG", "`gameWinningGoals`"),
      count("m_ev_goals", "EVG", "`evGoals`"),
      count("m_ev_points", "EVP", "`evPoints`"),
      count("m_ot_goals", "OTG", "`otGoals`"),
      fraction("faceoff_pct", "FO%", "`faceoffWinPct` (blank for players with no faceoffs)"),
      fraction("shooting_pct", "Sh%", "`shootingPct`"),
      numField("toi_per_game_seconds", "TOI/GP (s)", "`timeOnIcePerGame` (seconds)", { min: 0, max: 3600 }),
    ],
    rowKey: (v) => `${v.external_player_id}|${v.season}|${v.game_type}`,
  },

  nhl_goalie_stats: {
    type: "nhl_goalie_stats",
    connectorKey: "nhl_api",
    table: "ext_player_seasons",
    sourceTag: "nhl_stats",
    label: "NHL API · league goalie stats",
    description: "League-wide goalie season summary from api.nhle.com/stats/rest/en/goalie/summary.",
    fields: [
      playerIdField("stats `playerId`"),
      text("player_name", "Player", "`goalieFullName`"),
      seasonField("`seasonId`"),
      gameTypeField("the requested gameTypeId"),
      text("league", "League", "Always NHL"),
      text("team_name", "Team(s)", "`teamAbbrevs`"),
      text("situation", "Situation", "Always `all`", true),
      text("position", "Position", "Always G"),
      count("games_played", "GP", "`gamesPlayed`"),
      count("games_started", "GS", "`gamesStarted`"),
      count("wins", "W", "`wins`"),
      count("losses", "L", "`losses`"),
      count("ot_losses", "OTL", "`otLosses`"),
      count("shots_against", "SA", "`shotsAgainst`"),
      count("saves", "Saves", "`saves`"),
      count("goals_against", "GA", "`goalsAgainst`"),
      fraction("save_pct", "SV%", "`savePct`"),
      numField("gaa", "GAA", "`goalsAgainstAverage`", { min: 0, max: 30 }),
      count("shutouts", "SO", "`shutouts`"),
      count("toi_seconds", "TOI (s)", "`timeOnIce` (seconds)"),
      count("goals", "G", "`goals`"),
      count("assists", "A", "`assists`"),
      count("points", "P", "`points`"),
      count("penalty_minutes", "PIM", "`penaltyMinutes`"),
    ],
    rowKey: (v) => `${v.external_player_id}|${v.season}|${v.game_type}`,
  },

  nhl_team_stats: {
    type: "nhl_team_stats",
    connectorKey: "nhl_api",
    table: "ext_team_seasons",
    sourceTag: "nhl_stats",
    label: "NHL API · team season stats",
    description: "Team season summary from api.nhle.com/stats/rest/en/team/summary; tri-codes resolved via /stats/rest/en/team.",
    fields: [
      text("team_abbrev", "Team", "`triCode` from /team matched on `teamId` (blank if unmatched)"),
      text("team_name", "Team name", "`teamFullName`", true),
      seasonField("`seasonId`"),
      gameTypeField("the requested gameTypeId"),
      text("situation", "Situation", "Always `all`", true),
      count("games_played", "GP", "`gamesPlayed`"),
      count("wins", "W", "`wins`"),
      count("losses", "L", "`losses`"),
      count("ot_losses", "OTL", "`otLosses`"),
      count("points", "PTS", "`points`"),
      count("goals_for", "GF", "`goalsFor`"),
      count("goals_against", "GA", "`goalsAgainst`"),
      numField("shots_for_per_game", "SF/GP", "`shotsForPerGame`", { min: 0 }),
      numField("shots_against_per_game", "SA/GP", "`shotsAgainstPerGame`", { min: 0 }),
      fraction("pp_pct", "PP%", "`powerPlayPct`"),
      fraction("pk_pct", "PK%", "`penaltyKillPct`"),
      fraction("faceoff_pct", "FO%", "`faceoffWinPct`"),
      fraction("m_point_pct", "Point %", "`pointPct`"),
      count("m_regulation_and_ot_wins", "ROW", "`regulationAndOtWins`"),
      fraction("m_pp_net_pct", "PP net %", "`powerPlayNetPct`"),
      fraction("m_pk_net_pct", "PK net %", "`penaltyKillNetPct`"),
    ],
    rowKey: (v) => `${v.team_abbrev || v.team_name}|${v.season}|${v.game_type}|all`,
  },

  nhl_draft_picks: {
    type: "nhl_draft_picks",
    connectorKey: "nhl_api",
    table: "ext_draft_picks",
    sourceTag: "nhl",
    label: "NHL API · draft history",
    description: "NHL Entry Draft selections from api-web.nhle.com /v1/draft/picks/{year}/{round|all}. The source provides no player id; height/weight stay in the source's inches/pounds.",
    fields: [
      intField("draft_year", "Draft year", "`draftYear`", { min: 1963, max: 2100, required: true }),
      intField("round", "Round", "`round`", { min: 1, max: 30, required: true }),
      intField("pick_in_round", "Pick", "`pickInRound`", { min: 1 }),
      intField("overall_pick", "Overall", "`overallPick`", { min: 1, required: true }),
      text("team_abbrev", "Team", "`teamAbbrev`"),
      text("team_pick_history", "Pick history", "`teamPickHistory` (e.g. FLA-TOR)"),
      text("player_name", "Player", "`firstName` + `lastName`", true),
      positionField("`positionCode`"),
      text("country_code", "Country", "`countryCode`"),
      intField("height_inches", "Height (in)", "`height`", { min: 48, max: 90 }),
      intField("weight_pounds", "Weight (lb)", "`weight`", { min: 90, max: 350 }),
      text("amateur_club", "Amateur club", "`amateurClubName`"),
      text("amateur_league", "Amateur league", "`amateurLeague`"),
    ],
    rowKey: (v) => `${v.draft_year}|${v.overall_pick}`,
  },

  nhl_draft_rankings: {
    type: "nhl_draft_rankings",
    connectorKey: "nhl_api",
    table: "ext_draft_rankings",
    sourceTag: "nhl_central_scouting",
    label: "NHL Central Scouting · draft rankings",
    description: "NHL Central Scouting rankings from api-web.nhle.com /v1/draft/rankings/{year}/{category}. Midterm and final ranks are kept separate; a rank the source omits stays blank.",
    fields: [
      intField("draft_year", "Draft year", "`draftYear`", { min: 2008, max: 2100, required: true }),
      intField("category_id", "Category", "`categoryId` (1 NA skater · 2 Intl skater · 3 NA goalie · 4 Intl goalie)", { min: 1, max: 4, required: true }),
      text("category_key", "Category key", "`categoryKey`", true),
      text("player_name", "Player", "`firstName` + `lastName`", true),
      positionField("`positionCode`"),
      enumField("shoots_catches", "Shoots/catches", ["L", "R"], "`shootsCatches`"),
      intField("height_inches", "Height (in)", "`heightInInches`", { min: 48, max: 90 }),
      intField("weight_pounds", "Weight (lb)", "`weightInPounds`", { min: 90, max: 350 }),
      dateField("birth_date", "Birth date", "`birthDate`"),
      text("birth_city", "Birth city", "`birthCity`"),
      text("birth_state_province", "Birth state/prov.", "`birthStateProvince`"),
      text("birth_country", "Birth country", "`birthCountry`"),
      text("last_amateur_club", "Amateur club", "`lastAmateurClub`"),
      text("last_amateur_league", "Amateur league", "`lastAmateurLeague`"),
      intField("midterm_rank", "Midterm rank", "`midtermRank`", { min: 1 }),
      intField("final_rank", "Final rank", "`finalRank`", { min: 1 }),
    ],
    rowKey: (v) => `${v.draft_year}|${v.category_id}|${v.player_name}|${v.birth_date}`,
  },

  moneypuck_skaters: {
    type: "moneypuck_skaters",
    connectorKey: "moneypuck",
    table: "ext_player_seasons",
    sourceTag: "moneypuck",
    label: "MoneyPuck · skater season summary",
    description: "MoneyPuck skater season summary CSV (one row per player per situation). Data: MoneyPuck.com.",
    fields: [
      playerIdField("MoneyPuck `playerId` (NHL player id)"),
      text("player_name", "Player", "`name`"),
      seasonField("`season` (start year)"),
      gameTypeField("the requested file (regular/playoffs)"),
      text("league", "League", "Always NHL"),
      text("team_name", "Team", "`team`"),
      positionField("`position`"),
      situationField,
      count("games_played", "GP", "`games_played`"),
      count("toi_seconds", "TOI (s)", "`icetime` (seconds)"),
      count("goals", "G", "`I_F_goals`"),
      count("m_primary_assists", "A1", "`I_F_primaryAssists`"),
      count("m_secondary_assists", "A2", "`I_F_secondaryAssists`"),
      count("points", "P", "`I_F_points`"),
      count("shots", "SOG", "`I_F_shotsOnGoal`"),
      count("penalty_minutes", "PIM", "`penalityMinutes`"),
      numField("x_goals", "ixG", "`I_F_xGoals`", { min: 0 }),
      fraction("on_ice_xg_pct", "On-ice xG%", "`onIce_xGoalsPercentage`"),
      fraction("on_ice_corsi_pct", "On-ice CF%", "`onIce_corsiPercentage`"),
      fraction("on_ice_fenwick_pct", "On-ice FF%", "`onIce_fenwickPercentage`"),
      numField("game_score", "Game score", "`gameScore`"),
      count("m_shifts", "Shifts", "`shifts`"),
      count("m_shot_attempts", "iCF", "`I_F_shotAttempts`"),
      count("m_high_danger_shots", "HD shots", "`I_F_highDangerShots`"),
      count("m_high_danger_goals", "HD goals", "`I_F_highDangerGoals`"),
      numField("m_high_danger_xgoals", "HD xG", "`I_F_highDangerxGoals`", { min: 0 }),
      count("m_hits", "Hits", "`I_F_hits`"),
      count("m_takeaways", "Takeaways", "`I_F_takeaways`"),
      count("m_giveaways", "Giveaways", "`I_F_giveaways`"),
      count("m_blocked_shots", "Blocks", "`shotsBlockedByPlayer`"),
      count("m_faceoffs_won", "FOW", "`faceoffsWon`"),
      count("m_faceoffs_lost", "FOL", "`faceoffsLost`"),
      count("m_penalties_drawn", "Pen. drawn", "`penaltiesDrawn`"),
      numField("m_on_ice_xgoals_for", "On-ice xGF", "`OnIce_F_xGoals`", { min: 0 }),
      numField("m_on_ice_xgoals_against", "On-ice xGA", "`OnIce_A_xGoals`", { min: 0 }),
      count("m_on_ice_goals_for", "On-ice GF", "`OnIce_F_goals`"),
      count("m_on_ice_goals_against", "On-ice GA", "`OnIce_A_goals`"),
    ],
    rowKey: (v) => `${v.external_player_id}|${v.season}|${v.game_type}|${v.situation}`,
  },

  moneypuck_goalies: {
    type: "moneypuck_goalies",
    connectorKey: "moneypuck",
    table: "ext_player_seasons",
    sourceTag: "moneypuck",
    label: "MoneyPuck · goalie season summary",
    description: "MoneyPuck goalie season summary CSV (one row per goalie per situation). Data: MoneyPuck.com.",
    fields: [
      playerIdField("MoneyPuck `playerId` (NHL player id)"),
      text("player_name", "Player", "`name`"),
      seasonField("`season` (start year)"),
      gameTypeField("the requested file (regular/playoffs)"),
      text("league", "League", "Always NHL"),
      text("team_name", "Team", "`team`"),
      text("position", "Position", "`position` (G)"),
      situationField,
      count("games_played", "GP", "`games_played`"),
      count("toi_seconds", "TOI (s)", "`icetime` (seconds)"),
      count("goals_against", "GA", "`goals`"),
      numField("x_goals", "xGA", "`xGoals` (expected goals against)", { min: 0 }),
      count("shots_against", "SA", "`ongoal` (shots on goal against)"),
      count("m_unblocked_shot_attempts", "Fenwick against", "`unblocked_shot_attempts`"),
      count("m_rebounds", "Rebounds", "`rebounds`"),
      numField("m_x_rebounds", "xRebounds", "`xRebounds`", { min: 0 }),
      count("m_low_danger_shots", "LD shots", "`lowDangerShots`"),
      count("m_medium_danger_shots", "MD shots", "`mediumDangerShots`"),
      count("m_high_danger_shots", "HD shots", "`highDangerShots`"),
      count("m_low_danger_goals", "LD goals", "`lowDangerGoals`"),
      count("m_medium_danger_goals", "MD goals", "`mediumDangerGoals`"),
      count("m_high_danger_goals", "HD goals", "`highDangerGoals`"),
      numField("m_low_danger_xgoals", "LD xG", "`lowDangerxGoals`", { min: 0 }),
      numField("m_medium_danger_xgoals", "MD xG", "`mediumDangerxGoals`", { min: 0 }),
      numField("m_high_danger_xgoals", "HD xG", "`highDangerxGoals`", { min: 0 }),
    ],
    rowKey: (v) => `${v.external_player_id}|${v.season}|${v.game_type}|${v.situation}`,
  },

  moneypuck_teams: {
    type: "moneypuck_teams",
    connectorKey: "moneypuck",
    table: "ext_team_seasons",
    sourceTag: "moneypuck",
    label: "MoneyPuck · team season summary",
    description: "MoneyPuck team season summary CSV (one row per team per situation). Data: MoneyPuck.com.",
    fields: [
      text("team_abbrev", "Team", "`team`", true),
      text("team_name", "Team name", "`name`"),
      seasonField("`season` (start year)"),
      gameTypeField("the requested file (regular/playoffs)"),
      situationField,
      count("games_played", "GP", "`games_played`"),
      count("ice_time_seconds", "TOI (s)", "`iceTime` (seconds)"),
      count("goals_for", "GF", "`goalsFor`"),
      count("goals_against", "GA", "`goalsAgainst`"),
      numField("x_goals_for", "xGF", "`xGoalsFor`", { min: 0 }),
      numField("x_goals_against", "xGA", "`xGoalsAgainst`", { min: 0 }),
      fraction("x_goals_pct", "xGF%", "`xGoalsPercentage`"),
      fraction("corsi_pct", "CF%", "`corsiPercentage`"),
      fraction("fenwick_pct", "FF%", "`fenwickPercentage`"),
      count("m_shots_on_goal_for", "SF", "`shotsOnGoalFor`"),
      count("m_shots_on_goal_against", "SA", "`shotsOnGoalAgainst`"),
      count("m_shot_attempts_for", "CF", "`shotAttemptsFor`"),
      count("m_shot_attempts_against", "CA", "`shotAttemptsAgainst`"),
      count("m_high_danger_shots_for", "HDSF", "`highDangerShotsFor`"),
      count("m_high_danger_shots_against", "HDSA", "`highDangerShotsAgainst`"),
      numField("m_high_danger_xgoals_for", "HDxGF", "`highDangerxGoalsFor`", { min: 0 }),
      numField("m_high_danger_xgoals_against", "HDxGA", "`highDangerxGoalsAgainst`", { min: 0 }),
    ],
    rowKey: (v) => `${v.team_abbrev}|${v.season}|${v.game_type}|${v.situation}`,
  },

  ep_players: {
    type: "ep_players",
    connectorKey: "eliteprospects",
    table: "ext_players",
    sourceTag: "eliteprospects",
    label: "EliteProspects · player search",
    description:
      "Player identities from the official EliteProspects API (/v1/players). Disabled until an API key is configured; the parser only accepts the documented response envelope and rejects anything else.",
    fields: [
      ...bioFields("EliteProspects"),
    ],
    rowKey: (v) => v.external_id ?? "",
  },
};

export function isConnectorImportType(v: string): v is ConnectorImportType {
  return (CONNECTOR_IMPORT_TYPES as readonly string[]).includes(v);
}
