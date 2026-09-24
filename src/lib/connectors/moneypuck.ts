/**
 * MoneyPuck season-summary connector.
 *
 * Source files: https://moneypuck.com/moneypuck/playerData/seasonSummary/
 *   {startYear}/{regular|playoffs}/{skaters|goalies|teams}.csv
 * These are the CSVs MoneyPuck publishes on its Data page — the connector
 * downloads those files; it never scrapes HTML pages.
 *
 * Terms (moneypuck.com/data.htm, checked 2026-09-22): free for
 * non-commercial use and ad-hoc journalism; MoneyPuck.com must be clearly
 * credited wherever the data is shown; other uses need MoneyPuck's approval.
 *
 * Column semantics recorded from the real files (tests/fixtures/connectors/
 * moneypuck/): `season` is the start year; `icetime`/`iceTime` are seconds;
 * one row per player (or team) per `situation` (all, 5on5, 5on4, 4on5,
 * other); the teams file repeats the `team` header, so columns resolve by
 * first occurrence.
 */
import { parseCsv, CsvParseError } from "@/lib/import/csvParse";
import {
  ConnectorParseError,
  int,
  normalizePosition,
  num,
  startYearSeasonLabel,
  str,
  type NormalizedRecord,
  type ParsedDataset,
} from "@/lib/connectors/util";

export const MONEYPUCK_BASE = "https://moneypuck.com/moneypuck/playerData/seasonSummary";
export const MONEYPUCK_CREDIT = "Data: MoneyPuck.com";
export const MONEYPUCK_TERMS =
  "MoneyPuck data is free for non-commercial use and ad-hoc journalism with clear credit to MoneyPuck.com; other uses require MoneyPuck's approval (moneypuck.com/data.htm).";

export const MONEYPUCK_SITUATIONS = ["all", "5on5", "5on4", "4on5", "other"] as const;
export type MoneyPuckSituation = (typeof MONEYPUCK_SITUATIONS)[number];
export type MoneyPuckDataset = "skaters" | "goalies" | "teams";

export function moneyPuckUrl(startYear: number, gameType: "regular" | "playoffs", dataset: MoneyPuckDataset): string {
  if (!Number.isInteger(startYear) || startYear < 2008 || startYear > 2100) {
    throw new ConnectorParseError("MoneyPuck season summaries start with the 2008 season");
  }
  return `${MONEYPUCK_BASE}/${startYear}/${gameType}/${dataset}.csv`;
}

const REQUIRED_COLUMNS: Record<MoneyPuckDataset, string[]> = {
  skaters: ["playerId", "season", "name", "team", "position", "situation", "games_played", "icetime"],
  goalies: ["playerId", "season", "name", "team", "position", "situation", "games_played", "icetime"],
  teams: ["team", "season", "name", "situation", "games_played", "iceTime"],
};

function readCsv(text: string, dataset: MoneyPuckDataset) {
  let parsed;
  try {
    parsed = parseCsv(text, { maxRows: 20000 });
  } catch (err) {
    if (err instanceof CsvParseError) throw new ConnectorParseError(`MoneyPuck ${dataset}: ${err.message}`);
    throw err;
  }
  const index = new Map<string, number>();
  parsed.headers.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i); // first occurrence wins (teams.csv repeats `team`)
  });
  const missing = REQUIRED_COLUMNS[dataset].filter((c) => !index.has(c));
  if (missing.length > 0) {
    throw new ConnectorParseError(`MoneyPuck ${dataset}: expected column(s) missing: ${missing.join(", ")}`);
  }
  const get = (row: string[], col: string): string => {
    const i = index.get(col);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  return { rows: parsed.rows, get, hasColumn: (c: string) => index.has(c) };
}

function filterSituations(situations: readonly string[]): Set<string> {
  const s = new Set(situations);
  for (const x of s) {
    if (!(MONEYPUCK_SITUATIONS as readonly string[]).includes(x)) throw new ConnectorParseError(`Unknown situation "${x}"`);
  }
  if (s.size === 0) throw new ConnectorParseError("Choose at least one situation");
  return s;
}

export function parseMoneyPuckSkaters(text: string, gameType: "regular" | "playoffs", situations: readonly string[]): ParsedDataset {
  const { rows, get } = readCsv(text, "skaters");
  const wanted = filterSituations(situations);
  const records: NormalizedRecord[] = [];
  for (const row of rows) {
    const situation = get(row, "situation");
    if (!wanted.has(situation)) continue;
    records.push({
      external_player_id: int(get(row, "playerId")),
      player_name: str(get(row, "name")),
      season: startYearSeasonLabel(get(row, "season")),
      game_type: gameType,
      league: "NHL",
      team_name: str(get(row, "team")),
      position: normalizePosition(get(row, "position")),
      situation,
      games_played: int(get(row, "games_played")),
      toi_seconds: int(get(row, "icetime")),
      goals: int(get(row, "I_F_goals")),
      m_primary_assists: int(get(row, "I_F_primaryAssists")),
      m_secondary_assists: int(get(row, "I_F_secondaryAssists")),
      points: int(get(row, "I_F_points")),
      shots: int(get(row, "I_F_shotsOnGoal")),
      penalty_minutes: int(get(row, "penalityMinutes")),
      x_goals: num(get(row, "I_F_xGoals")),
      on_ice_xg_pct: num(get(row, "onIce_xGoalsPercentage")),
      on_ice_corsi_pct: num(get(row, "onIce_corsiPercentage")),
      on_ice_fenwick_pct: num(get(row, "onIce_fenwickPercentage")),
      game_score: num(get(row, "gameScore")),
      m_shifts: int(get(row, "shifts")),
      m_shot_attempts: int(get(row, "I_F_shotAttempts")),
      m_high_danger_shots: int(get(row, "I_F_highDangerShots")),
      m_high_danger_goals: int(get(row, "I_F_highDangerGoals")),
      m_high_danger_xgoals: num(get(row, "I_F_highDangerxGoals")),
      m_hits: int(get(row, "I_F_hits")),
      m_takeaways: int(get(row, "I_F_takeaways")),
      m_giveaways: int(get(row, "I_F_giveaways")),
      m_blocked_shots: int(get(row, "shotsBlockedByPlayer")),
      m_faceoffs_won: int(get(row, "faceoffsWon")),
      m_faceoffs_lost: int(get(row, "faceoffsLost")),
      m_penalties_drawn: int(get(row, "penaltiesDrawn")),
      m_on_ice_xgoals_for: num(get(row, "OnIce_F_xGoals")),
      m_on_ice_xgoals_against: num(get(row, "OnIce_A_xGoals")),
      m_on_ice_goals_for: int(get(row, "OnIce_F_goals")),
      m_on_ice_goals_against: int(get(row, "OnIce_A_goals")),
    });
  }
  return finish(records, "skater");
}

export function parseMoneyPuckGoalies(text: string, gameType: "regular" | "playoffs", situations: readonly string[]): ParsedDataset {
  const { rows, get } = readCsv(text, "goalies");
  const wanted = filterSituations(situations);
  const records: NormalizedRecord[] = [];
  for (const row of rows) {
    const situation = get(row, "situation");
    if (!wanted.has(situation)) continue;
    records.push({
      external_player_id: int(get(row, "playerId")),
      player_name: str(get(row, "name")),
      season: startYearSeasonLabel(get(row, "season")),
      game_type: gameType,
      league: "NHL",
      team_name: str(get(row, "team")),
      position: str(get(row, "position")),
      situation,
      games_played: int(get(row, "games_played")),
      toi_seconds: int(get(row, "icetime")),
      goals_against: int(get(row, "goals")),
      x_goals: num(get(row, "xGoals")),
      shots_against: int(get(row, "ongoal")),
      m_unblocked_shot_attempts: int(get(row, "unblocked_shot_attempts")),
      m_rebounds: int(get(row, "rebounds")),
      m_x_rebounds: num(get(row, "xRebounds")),
      m_low_danger_shots: int(get(row, "lowDangerShots")),
      m_medium_danger_shots: int(get(row, "mediumDangerShots")),
      m_high_danger_shots: int(get(row, "highDangerShots")),
      m_low_danger_goals: int(get(row, "lowDangerGoals")),
      m_medium_danger_goals: int(get(row, "mediumDangerGoals")),
      m_high_danger_goals: int(get(row, "highDangerGoals")),
      m_low_danger_xgoals: num(get(row, "lowDangerxGoals")),
      m_medium_danger_xgoals: num(get(row, "mediumDangerxGoals")),
      m_high_danger_xgoals: num(get(row, "highDangerxGoals")),
    });
  }
  return finish(records, "goalie");
}

export function parseMoneyPuckTeams(text: string, gameType: "regular" | "playoffs", situations: readonly string[]): ParsedDataset {
  const { rows, get } = readCsv(text, "teams");
  const wanted = filterSituations(situations);
  const records: NormalizedRecord[] = [];
  for (const row of rows) {
    const situation = get(row, "situation");
    if (!wanted.has(situation)) continue;
    records.push({
      team_abbrev: str(get(row, "team")),
      team_name: str(get(row, "name")),
      season: startYearSeasonLabel(get(row, "season")),
      game_type: gameType,
      situation,
      games_played: int(get(row, "games_played")),
      ice_time_seconds: int(get(row, "iceTime")),
      goals_for: int(get(row, "goalsFor")),
      goals_against: int(get(row, "goalsAgainst")),
      x_goals_for: num(get(row, "xGoalsFor")),
      x_goals_against: num(get(row, "xGoalsAgainst")),
      x_goals_pct: num(get(row, "xGoalsPercentage")),
      corsi_pct: num(get(row, "corsiPercentage")),
      fenwick_pct: num(get(row, "fenwickPercentage")),
      m_shots_on_goal_for: int(get(row, "shotsOnGoalFor")),
      m_shots_on_goal_against: int(get(row, "shotsOnGoalAgainst")),
      m_shot_attempts_for: int(get(row, "shotAttemptsFor")),
      m_shot_attempts_against: int(get(row, "shotAttemptsAgainst")),
      m_high_danger_shots_for: int(get(row, "highDangerShotsFor")),
      m_high_danger_shots_against: int(get(row, "highDangerShotsAgainst")),
      m_high_danger_xgoals_for: num(get(row, "highDangerxGoalsFor")),
      m_high_danger_xgoals_against: num(get(row, "highDangerxGoalsAgainst")),
    });
  }
  return finish(records, "team");
}

function finish(records: NormalizedRecord[], noun: string): ParsedDataset {
  const seasons = [...new Set(records.map((r) => r.season).filter((s): s is string => !!s))].sort();
  const warnings: string[] = [];
  if (records.length === 0) warnings.push(`No ${noun} rows matched the selected situation(s).`);
  if (seasons.length > 1) warnings.push(`File contains multiple seasons: ${seasons.join(", ")}.`);
  return { records, effectiveSeason: seasons[seasons.length - 1] ?? null, warnings };
}
