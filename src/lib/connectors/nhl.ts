/**
 * NHL API connector (api-web.nhle.com + api.nhle.com/stats/rest).
 *
 * The NHL API is public but undocumented; every parser here was written
 * against responses recorded in tests/fixtures/connectors/nhl/ and fails
 * loudly (ConnectorParseError) when the envelope it depends on is missing,
 * rather than importing a partial guess.
 */
import {
  ConnectorParseError,
  clockToSeconds,
  fullName,
  gameTypeLabel,
  int,
  isObject,
  nhlSeasonLabel,
  normalizePosition,
  num,
  str,
  type NormalizedRecord,
  type ParsedDataset,
} from "@/lib/connectors/util";

export const NHL_WEB = "https://api-web.nhle.com/v1";
export const NHL_STATS = "https://api.nhle.com/stats/rest/en";

export const NHL_CREDIT = "Data: NHL.com (public NHL API, api-web.nhle.com / api.nhle.com)";
export const NHL_TERMS =
  "Unofficial, undocumented public endpoints; formats can change without notice. NHL data is © NHL and subject to NHL.com terms of use.";
export const NHL_CS_CREDIT = "Rankings: NHL Central Scouting via the public NHL API (api-web.nhle.com)";

export const RANKING_CATEGORIES = [
  { id: 1, key: "north-american-skater", label: "North American skaters" },
  { id: 2, key: "international-skater", label: "International skaters" },
  { id: 3, key: "north-american-goalie", label: "North American goalies" },
  { id: 4, key: "international-goalie", label: "International goalies" },
] as const;

/* ------------------------------------------------------------------ */
/* URL builders (validated inputs only)                                */
/* ------------------------------------------------------------------ */

/** The 32 NHL clubs' tri-codes (2026-27). */
export const NHL_TEAMS = [
  "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NJD",
  "NSH", "NYI", "NYR", "OTT", "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH",
] as const;

export function assertTeam(team: string): string {
  const t = team.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(t)) throw new ConnectorParseError("Team must be a 3-letter NHL tri-code (e.g. CHI)");
  return t;
}

export function assertSeasonId(seasonId: string): string {
  if (!/^\d{8}$/.test(seasonId) || nhlSeasonLabel(seasonId) === "") {
    throw new ConnectorParseError("Season id must look like 20242025");
  }
  return seasonId;
}

export function assertPlayerId(id: string): string {
  const s = id.trim();
  if (!/^8\d{6}$/.test(s)) throw new ConnectorParseError(`"${id}" is not an NHL player id (7 digits starting with 8)`);
  return s;
}

const cayenne = (seasonId: string, gameTypeId: number) =>
  `cayenneExp=${encodeURIComponent(`seasonId=${assertSeasonId(seasonId)} and gameTypeId=${gameTypeId}`)}`;
const sortBy = (prop: string) => `sort=${encodeURIComponent(JSON.stringify([{ property: prop, direction: "ASC" }]))}`;

export const nhlUrls = {
  playerLanding: (id: string) => `${NHL_WEB}/player/${assertPlayerId(id)}/landing`,
  gameLog: (id: string, seasonId: string, gameTypeId: 2 | 3) =>
    `${NHL_WEB}/player/${assertPlayerId(id)}/game-log/${assertSeasonId(seasonId)}/${gameTypeId}`,
  roster: (team: string, seasonId: string) => `${NHL_WEB}/roster/${assertTeam(team)}/${assertSeasonId(seasonId)}`,
  draftPicks: (year: number, round: number | "all") => {
    if (!Number.isInteger(year) || year < 1963 || year > 2100) throw new ConnectorParseError("Invalid draft year");
    if (round !== "all" && !(Number.isInteger(round) && round >= 1 && round <= 7)) throw new ConnectorParseError("Round must be 1–7 or all");
    return `${NHL_WEB}/draft/picks/${year}/${round}`;
  },
  draftRankings: (year: number, category: number) => {
    if (!Number.isInteger(year) || year < 2008 || year > 2100) throw new ConnectorParseError("Rankings exist from the 2008 draft onward");
    if (![1, 2, 3, 4].includes(category)) throw new ConnectorParseError("Category must be 1–4");
    return `${NHL_WEB}/draft/rankings/${year}/${category}`;
  },
  skaterSummary: (seasonId: string, gameTypeId: 2 | 3) =>
    `${NHL_STATS}/skater/summary?isAggregate=false&isGame=false&start=0&limit=-1&${sortBy("playerId")}&${cayenne(seasonId, gameTypeId)}`,
  goalieSummary: (seasonId: string, gameTypeId: 2 | 3) =>
    `${NHL_STATS}/goalie/summary?isAggregate=false&isGame=false&start=0&limit=-1&${sortBy("playerId")}&${cayenne(seasonId, gameTypeId)}`,
  teamSummary: (seasonId: string, gameTypeId: 2 | 3) =>
    `${NHL_STATS}/team/summary?isAggregate=false&isGame=false&start=0&limit=-1&${cayenne(seasonId, gameTypeId)}`,
  teams: () => `${NHL_STATS}/team`,
  /** Standings as of a date (YYYY-MM-DD) or "now". */
  standings: (date: string) => {
    if (date !== "now" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ConnectorParseError("Standings date must be YYYY-MM-DD or now");
    return `${NHL_WEB}/standings/${date}`;
  },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function requireObject(json: unknown, what: string): Record<string, unknown> {
  if (!isObject(json)) throw new ConnectorParseError(`${what}: expected a JSON object`);
  return json;
}

function requireArray(obj: Record<string, unknown>, key: string, what: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) throw new ConnectorParseError(`${what}: expected "${key}" to be an array`);
  return v;
}

function latestSeason(labels: string[]): string | null {
  const sorted = labels.filter((l) => l !== "").sort();
  return sorted.length ? sorted[sorted.length - 1]! : null;
}

/* ------------------------------------------------------------------ */
/* Player landing                                                      */
/* ------------------------------------------------------------------ */

/** Bio + draft details → one nhl_players record. */
export function parsePlayerBio(json: unknown): NormalizedRecord {
  const d = requireObject(json, "Player landing");
  const id = int(d.playerId);
  if (id === "") throw new ConnectorParseError("Player landing: missing playerId");
  const draft = isObject(d.draftDetails) ? d.draftDetails : {};
  return {
    external_id: id,
    full_name: fullName(d.firstName, d.lastName),
    first_name: str(d.firstName),
    last_name: str(d.lastName),
    position: normalizePosition(d.position),
    shoots_catches: str(d.shootsCatches),
    date_of_birth: str(d.birthDate),
    height_cm: int(d.heightInCentimeters),
    weight_kg: int(d.weightInKilograms),
    birth_city: str(d.birthCity),
    birth_country: str(d.birthCountry),
    current_team_abbrev: str(d.currentTeamAbbrev),
    is_active: typeof d.isActive === "boolean" ? String(d.isActive) : "",
    draft_year: int(draft.year),
    draft_round: int(draft.round),
    draft_pick_in_round: int(draft.pickInRound),
    draft_overall: int(draft.overallPick),
    draft_team_abbrev: str(draft.teamAbbrev),
  };
}

export function parsePlayerBios(landings: unknown[]): ParsedDataset {
  return { records: landings.map(parsePlayerBio), effectiveSeason: null, warnings: [] };
}

/** `seasonTotals` → nhl_player_seasons records (one per season/league/team stint). */
export function parsePlayerCareer(json: unknown): ParsedDataset {
  const d = requireObject(json, "Player landing");
  const id = int(d.playerId);
  if (id === "") throw new ConnectorParseError("Player landing: missing playerId");
  const name = fullName(d.firstName, d.lastName);
  const totals = requireArray(d, "seasonTotals", "Player landing");
  const warnings: string[] = [];
  let zeroSvNoShots = 0;
  const records: NormalizedRecord[] = [];
  for (const raw of totals) {
    if (!isObject(raw)) continue;
    const gameType = gameTypeLabel(raw.gameTypeId);
    if (gameType === "") continue; // preseason / unknown game types are not imported
    // A save % of exactly 0 with no shotsAgainst is a placeholder in minor-league
    // rows (e.g. GAA 2.89 alongside SV% 0.000) — keep it missing, never 0.
    let savePct = num(raw.savePctg);
    if (savePct === "0" && raw.shotsAgainst === undefined) {
      savePct = "";
      zeroSvNoShots += 1;
    }
    records.push({
      external_player_id: id,
      player_name: name,
      season: nhlSeasonLabel(raw.season),
      game_type: gameType,
      league: str(raw.leagueAbbrev),
      team_name: str(raw.teamName),
      m_sequence: int(raw.sequence),
      situation: "all",
      games_played: int(raw.gamesPlayed),
      goals: int(raw.goals),
      assists: int(raw.assists),
      points: int(raw.points),
      plus_minus: int(raw.plusMinus),
      penalty_minutes: int(raw.pim),
      shots: int(raw.shots),
      pp_goals: int(raw.powerPlayGoals),
      pp_points: int(raw.powerPlayPoints),
      sh_goals: int(raw.shorthandedGoals),
      sh_points: int(raw.shorthandedPoints),
      gw_goals: int(raw.gameWinningGoals),
      faceoff_pct: num(raw.faceoffWinningPctg),
      shooting_pct: num(raw.shootingPctg),
      toi_per_game_seconds: clockToSeconds(raw.avgToi),
      games_started: int(raw.gamesStarted),
      wins: int(raw.wins),
      losses: int(raw.losses),
      ot_losses: int(raw.otLosses),
      shots_against: int(raw.shotsAgainst),
      goals_against: int(raw.goalsAgainst),
      save_pct: savePct,
      gaa: num(raw.goalsAgainstAvg),
      shutouts: int(raw.shutouts),
      toi_seconds: clockToSeconds(raw.timeOnIce),
    });
  }
  if (zeroSvNoShots > 0) {
    warnings.push(`${name}: ${zeroSvNoShots} season line(s) report save % 0 without shots against — stored as missing, not 0.`);
  }
  const noToi = records.filter((r) => r.toi_per_game_seconds === "" && r.toi_seconds === "").length;
  if (noToi > 0) warnings.push(`${name}: ${noToi} of ${records.length} season line(s) have no time-on-ice in the source — left blank.`);
  return { records, effectiveSeason: latestSeason(records.map((r) => r.season!)), warnings };
}

/* ------------------------------------------------------------------ */
/* Game logs                                                           */
/* ------------------------------------------------------------------ */

/**
 * `gameLog` → nhl_game_logs records. The game-log response carries no player
 * name, so the caller passes the player's landing (also used for position).
 * Goalie rows are recognized by the goalie-only `shotsAgainst` key.
 */
export function parseGameLog(json: unknown, playerId: string, landing?: unknown): ParsedDataset {
  const d = requireObject(json, "Game log");
  const games = requireArray(d, "gameLog", "Game log");
  const season = nhlSeasonLabel(d.seasonId);
  const gameType = gameTypeLabel(d.gameTypeId);
  if (season === "" || gameType === "") throw new ConnectorParseError("Game log: missing seasonId/gameTypeId");
  const name = isObject(landing) ? fullName(landing.firstName, landing.lastName) : "";
  const label = name || playerId;
  let noDecision = 0;
  const records: NormalizedRecord[] = [];
  for (const g of games) {
    if (!isObject(g)) continue;
    const goalie = "shotsAgainst" in g;
    if (goalie && g.decision === undefined) noDecision += 1;
    records.push({
      external_player_id: playerId,
      player_name: name,
      game_id: int(g.gameId),
      game_date: str(g.gameDate),
      season,
      game_type: gameType,
      team_abbrev: str(g.teamAbbrev),
      opponent_abbrev: str(g.opponentAbbrev),
      home_road: str(g.homeRoadFlag),
      goals: int(g.goals),
      assists: int(g.assists),
      points: int(g.points),
      plus_minus: int(g.plusMinus),
      penalty_minutes: int(g.pim),
      shots: int(g.shots),
      pp_goals: int(g.powerPlayGoals),
      pp_points: int(g.powerPlayPoints),
      sh_goals: int(g.shorthandedGoals),
      sh_points: int(g.shorthandedPoints),
      gw_goals: int(g.gameWinningGoals),
      ot_goals: int(g.otGoals),
      shifts: int(g.shifts),
      toi_seconds: clockToSeconds(g.toi),
      games_started: int(g.gamesStarted),
      decision: str(g.decision),
      shots_against: int(g.shotsAgainst),
      goals_against: int(g.goalsAgainst),
      save_pct: num(g.savePctg),
      shutouts: int(g.shutouts),
    });
  }
  const warnings: string[] = [];
  if (records.length === 0) warnings.push(`${label}: no ${gameType} games in ${season}.`);
  if (noDecision > 0) warnings.push(`${label}: ${noDecision} relief appearance(s) with no decision in the source (left blank).`);
  if (!name) warnings.push(`${playerId}: player name unavailable (landing not returned).`);
  return { records, effectiveSeason: season, warnings };
}

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

export function parseRoster(json: unknown, team: string, seasonId: string): ParsedDataset {
  const d = requireObject(json, "Roster");
  const season = nhlSeasonLabel(seasonId);
  const records: NormalizedRecord[] = [];
  for (const group of ["forwards", "defensemen", "goalies"]) {
    for (const raw of requireArray(d, group, "Roster")) {
      if (!isObject(raw)) continue;
      records.push({
        team_abbrev: assertTeam(team),
        season,
        external_id: int(raw.id),
        full_name: fullName(raw.firstName, raw.lastName),
        first_name: str(raw.firstName),
        last_name: str(raw.lastName),
        position: normalizePosition(raw.positionCode),
        shoots_catches: str(raw.shootsCatches),
        date_of_birth: str(raw.birthDate),
        height_cm: int(raw.heightInCentimeters),
        weight_kg: int(raw.weightInKilograms),
        birth_city: str(raw.birthCity),
        birth_country: str(raw.birthCountry),
        sweater_number: int(raw.sweaterNumber),
      });
    }
  }
  const warnings = records.length === 0 ? [`No roster returned for ${team} ${season}.`] : [];
  return { records, effectiveSeason: season, warnings };
}

/* ------------------------------------------------------------------ */
/* Stats REST (league-wide season summaries)                           */
/* ------------------------------------------------------------------ */

function statsData(json: unknown, what: string): { rows: Record<string, unknown>[]; warnings: string[] } {
  const d = requireObject(json, what);
  const rows = requireArray(d, "data", what).filter(isObject);
  const warnings: string[] = [];
  if (typeof d.total === "number" && d.total !== rows.length) {
    warnings.push(`${what}: the source reported ${d.total} rows but returned ${rows.length}.`);
  }
  return { rows, warnings };
}

export function parseSkaterSummary(json: unknown, gameTypeId: 2 | 3): ParsedDataset {
  const { rows, warnings } = statsData(json, "Skater summary");
  const records = rows.map((r) => ({
    external_player_id: int(r.playerId),
    player_name: str(r.skaterFullName),
    season: nhlSeasonLabel(r.seasonId),
    game_type: gameTypeLabel(gameTypeId),
    league: "NHL",
    team_name: str(r.teamAbbrevs),
    situation: "all",
    position: normalizePosition(r.positionCode),
    games_played: int(r.gamesPlayed),
    goals: int(r.goals),
    assists: int(r.assists),
    points: int(r.points),
    plus_minus: int(r.plusMinus),
    penalty_minutes: int(r.penaltyMinutes),
    shots: int(r.shots),
    pp_goals: int(r.ppGoals),
    pp_points: int(r.ppPoints),
    sh_goals: int(r.shGoals),
    sh_points: int(r.shPoints),
    gw_goals: int(r.gameWinningGoals),
    m_ev_goals: int(r.evGoals),
    m_ev_points: int(r.evPoints),
    m_ot_goals: int(r.otGoals),
    faceoff_pct: num(r.faceoffWinPct),
    shooting_pct: num(r.shootingPct),
    toi_per_game_seconds: num(r.timeOnIcePerGame),
  }));
  const traded = records.filter((r) => r.team_name.includes(",")).length;
  if (traded > 0) warnings.push(`${traded} player(s) appear once with all teams combined (e.g. "BOS,FLA"); per-team splits are not in this endpoint.`);
  return { records, effectiveSeason: latestSeason(records.map((r) => r.season)), warnings };
}

export function parseGoalieSummary(json: unknown, gameTypeId: 2 | 3): ParsedDataset {
  const { rows, warnings } = statsData(json, "Goalie summary");
  const records = rows.map((r) => ({
    external_player_id: int(r.playerId),
    player_name: str(r.goalieFullName),
    season: nhlSeasonLabel(r.seasonId),
    game_type: gameTypeLabel(gameTypeId),
    league: "NHL",
    team_name: str(r.teamAbbrevs),
    situation: "all",
    position: "G",
    games_played: int(r.gamesPlayed),
    games_started: int(r.gamesStarted),
    wins: int(r.wins),
    losses: int(r.losses),
    ot_losses: int(r.otLosses),
    shots_against: int(r.shotsAgainst),
    saves: int(r.saves),
    goals_against: int(r.goalsAgainst),
    save_pct: num(r.savePct),
    gaa: num(r.goalsAgainstAverage),
    shutouts: int(r.shutouts),
    toi_seconds: int(r.timeOnIce),
    goals: int(r.goals),
    assists: int(r.assists),
    points: int(r.points),
    penalty_minutes: int(r.penaltyMinutes),
  }));
  return { records, effectiveSeason: latestSeason(records.map((r) => r.season)), warnings };
}

/** /stats/rest/en/team → teamId → triCode. */
export function parseTeamIndex(json: unknown): Map<string, string> {
  const { rows } = statsData(json, "Team index");
  const map = new Map<string, string>();
  for (const r of rows) {
    const id = int(r.id);
    const tri = str(r.triCode);
    if (id !== "" && tri !== "") map.set(id, tri);
  }
  return map;
}

export function parseTeamSummary(json: unknown, gameTypeId: 2 | 3, teamIndex: Map<string, string>): ParsedDataset {
  const { rows, warnings } = statsData(json, "Team summary");
  const records = rows.map((r) => ({
    team_abbrev: teamIndex.get(int(r.teamId)) ?? "",
    team_name: str(r.teamFullName),
    season: nhlSeasonLabel(r.seasonId),
    game_type: gameTypeLabel(gameTypeId),
    situation: "all",
    games_played: int(r.gamesPlayed),
    wins: int(r.wins),
    losses: int(r.losses),
    ot_losses: int(r.otLosses),
    points: int(r.points),
    goals_for: int(r.goalsFor),
    goals_against: int(r.goalsAgainst),
    shots_for_per_game: num(r.shotsForPerGame),
    shots_against_per_game: num(r.shotsAgainstPerGame),
    pp_pct: num(r.powerPlayPct),
    pk_pct: num(r.penaltyKillPct),
    faceoff_pct: num(r.faceoffWinPct),
    m_point_pct: num(r.pointPct),
    m_regulation_and_ot_wins: int(r.regulationAndOtWins),
    m_pp_net_pct: num(r.powerPlayNetPct),
    m_pk_net_pct: num(r.penaltyKillNetPct),
  }));
  const unmatched = records.filter((r) => r.team_abbrev === "").length;
  if (unmatched > 0) warnings.push(`${unmatched} team(s) could not be matched to a tri-code; stored by full name only.`);
  return { records, effectiveSeason: latestSeason(records.map((r) => r.season)), warnings };
}

/* ------------------------------------------------------------------ */
/* Standings                                                           */
/* ------------------------------------------------------------------ */

const record = (w: unknown, l: unknown, otl: unknown) => {
  const parts = [int(w), int(l), int(otl)];
  return parts.every((p) => p !== "") ? parts.join("-") : "";
};

/**
 * /v1/standings/{date}: one row per team. Every row must carry the team,
 * season, game type and W/L/OTL/points; ranks, streak and splits are kept
 * when present. An empty list (a date before the season starts) throws, so
 * an import never replaces standings with nothing.
 */
export function parseStandings(json: unknown): ParsedDataset {
  const d = requireObject(json, "Standings");
  const rows = requireArray(d, "standings", "Standings").filter(isObject);
  if (rows.length === 0) throw new ConnectorParseError("Standings: no teams for this date (before the season started?)");
  const records = rows.map((r, i) => {
    const rec = {
      team_abbrev: str(r.teamAbbrev),
      team_name: str(r.teamName),
      season: nhlSeasonLabel(r.seasonId),
      game_type: gameTypeLabel(r.gameTypeId),
      standings_date: str(r.date),
      conference: str(r.conferenceName),
      division: str(r.divisionName),
      games_played: int(r.gamesPlayed),
      wins: int(r.wins),
      losses: int(r.losses),
      ot_losses: int(r.otLosses),
      points: int(r.points),
      point_pct: num(r.pointPctg),
      regulation_wins: int(r.regulationWins),
      regulation_plus_ot_wins: int(r.regulationPlusOtWins),
      goals_for: int(r.goalFor),
      goals_against: int(r.goalAgainst),
      league_rank: int(r.leagueSequence),
      conference_rank: int(r.conferenceSequence),
      division_rank: int(r.divisionSequence),
      wildcard_rank: int(r.wildcardSequence),
      clinch: str(r.clinchIndicator),
      streak: str(r.streakCode) !== "" && int(r.streakCount) !== "" ? `${str(r.streakCode)}${int(r.streakCount)}` : "",
      last_ten: record(r.l10Wins, r.l10Losses, r.l10OtLosses),
      home_record: record(r.homeWins, r.homeLosses, r.homeOtLosses),
      road_record: record(r.roadWins, r.roadLosses, r.roadOtLosses),
      m_shootout_wins: int(r.shootoutWins),
      m_shootout_losses: int(r.shootoutLosses),
    };
    for (const k of ["team_abbrev", "team_name", "season", "game_type", "standings_date", "games_played", "wins", "losses", "ot_losses", "points"] as const) {
      if (rec[k] === "") throw new ConnectorParseError(`Standings row ${i}: missing ${k}`);
    }
    return rec;
  });
  const dates = [...new Set(records.map((r) => r.standings_date))];
  const warnings = dates.length > 1 ? [`Rows carry ${dates.length} different dates (${dates.join(", ")}).`] : [];
  return { records, effectiveSeason: latestSeason(records.map((r) => r.season)), warnings };
}

/* ------------------------------------------------------------------ */
/* Draft                                                               */
/* ------------------------------------------------------------------ */

export function parseDraftPicks(json: unknown): ParsedDataset {
  const d = requireObject(json, "Draft picks");
  const year = int(d.draftYear);
  const warnings: string[] = [];
  if (str(d.state) !== "" && str(d.state) !== "over") {
    warnings.push(`Draft state is "${str(d.state)}" — selections may be incomplete.`);
  }
  const records = requireArray(d, "picks", "Draft picks")
    .filter(isObject)
    .map((p) => ({
      draft_year: year,
      round: int(p.round),
      pick_in_round: int(p.pickInRound),
      overall_pick: int(p.overallPick),
      team_abbrev: str(p.teamAbbrev),
      team_pick_history: str(p.teamPickHistory),
      player_name: fullName(p.firstName, p.lastName),
      position: normalizePosition(p.positionCode),
      country_code: str(p.countryCode),
      height_inches: int(p.height),
      weight_pounds: int(p.weight),
      amateur_club: str(p.amateurClubName),
      amateur_league: str(p.amateurLeague),
    }));
  return { records, effectiveSeason: year === "" ? null : `${year} NHL Draft`, warnings };
}

export function parseDraftRankings(json: unknown): ParsedDataset {
  const d = requireObject(json, "Draft rankings");
  const year = int(d.draftYear);
  const categoryId = int(d.categoryId);
  const categoryKey = str(d.categoryKey);
  if (year === "" || categoryId === "") throw new ConnectorParseError("Draft rankings: missing draftYear/categoryId");
  const records = requireArray(d, "rankings", "Draft rankings")
    .filter(isObject)
    .map((r) => ({
      draft_year: year,
      category_id: categoryId,
      category_key: categoryKey,
      player_name: fullName(r.firstName, r.lastName),
      position: normalizePosition(r.positionCode),
      shoots_catches: str(r.shootsCatches),
      height_inches: int(r.heightInInches),
      weight_pounds: int(r.weightInPounds),
      birth_date: str(r.birthDate),
      birth_city: str(r.birthCity),
      birth_state_province: str(r.birthStateProvince),
      birth_country: str(r.birthCountry),
      last_amateur_club: str(r.lastAmateurClub),
      last_amateur_league: str(r.lastAmateurLeague),
      midterm_rank: int(r.midtermRank),
      final_rank: int(r.finalRank),
    }));
  const warnings: string[] = [];
  const noFinal = records.filter((r) => r.final_rank === "").length;
  const noMid = records.filter((r) => r.midterm_rank === "").length;
  if (noFinal > 0) warnings.push(`${noFinal} player(s) have no final rank in the source (left blank).`);
  if (noMid > 0) warnings.push(`${noMid} player(s) have no midterm rank in the source (left blank).`);
  return { records, effectiveSeason: `${year} NHL Draft`, warnings };
}
