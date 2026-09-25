/**
 * HockeyTech (LeagueStat) feeds: the stats platform behind the OHL, WHL,
 * QMJHL, USHL, AHL and ECHL websites (lscluster.hockeytech.com).
 *
 * This is the feed the leagues' own websites call; it is not a documented
 * public API. The per-league `key` below is the public site key those
 * websites send with every request (not a secret). Use it the way the
 * sites do: rate-limited (one request per 500 ms), cached, personal use.
 *
 * Every parser was written against responses recorded in
 * tests/fixtures/connectors/hockeytech/ and throws ConnectorParseError when
 * the envelope it relies on is missing.
 */
import { ConnectorParseError, isObject, str } from "@/lib/connectors/util";

export const HT_BASE = "https://lscluster.hockeytech.com/feed/index.php";

export interface HtLeague {
  /** Our code for the league. */
  code: "ohl" | "whl" | "qmjhl" | "ushl" | "ahl" | "echl";
  name: string;
  clientCode: string;
  key: string;
  leagueId: number;
}

export const HT_LEAGUES: Record<HtLeague["code"], HtLeague> = {
  ohl: { code: "ohl", name: "OHL", clientCode: "ohl", key: "2976319eb44abe94", leagueId: 1 },
  whl: { code: "whl", name: "WHL", clientCode: "whl", key: "41b145a848f4bd67", leagueId: 1 },
  qmjhl: { code: "qmjhl", name: "QMJHL", clientCode: "lhjmq", key: "f322673b6bcae299", leagueId: 1 },
  ushl: { code: "ushl", name: "USHL", clientCode: "ushl", key: "e828f89b243dc43f", leagueId: 1 },
  ahl: { code: "ahl", name: "AHL", clientCode: "ahl", key: "50c2cd9b5e18e390", leagueId: 4 },
  echl: { code: "echl", name: "ECHL", clientCode: "echl", key: "2c2b89ea7345cae8", leagueId: 1 },
};

const common = (l: HtLeague) => `key=${l.key}&client_code=${l.clientCode}&fmt=json&lang=en`;
const id = (v: number | string, what: string) => {
  const s = String(v);
  if (!/^\d{1,6}$/.test(s)) throw new ConnectorParseError(`Invalid ${what}`);
  return s;
};

export const htUrls = {
  seasons: (l: HtLeague) => `${HT_BASE}?feed=modulekit&view=seasons&${common(l)}`,
  teams: (l: HtLeague, seasonId: number | string) => `${HT_BASE}?feed=modulekit&view=teamsbyseason&season_id=${id(seasonId, "season id")}&${common(l)}`,
  roster: (l: HtLeague, teamId: number | string, seasonId: number | string) =>
    `${HT_BASE}?feed=modulekit&view=roster&team_id=${id(teamId, "team id")}&season_id=${id(seasonId, "season id")}&${common(l)}`,
  /** One player's profile: birth date, height, weight, position (fills bios missing from end-of-season rosters). */
  profile: (l: HtLeague, playerId: number | string) =>
    `${HT_BASE}?feed=modulekit&view=player&category=profile&player_id=${id(playerId, "player id")}&${common(l)}`,
  /** Every skater in a season, expanded stats, one request. */
  skaterStats: (l: HtLeague, seasonId: number | string) =>
    `${HT_BASE}?feed=statviewfeed&view=players&season=${id(seasonId, "season id")}&team=all&position=skaters&rookies=0&statsType=expanded` +
    `&rosterstatus=undefined&site_id=0&first=0&limit=5000&sort=points&league_id=${l.leagueId}&division=-1&conference=-1&${common(l)}`,
};

export interface HtSeason {
  seasonId: string;
  name: string;
  /** "2025-26" for a regular season starting in 2025. */
  label: string;
  startDate: string;
  endDate: string;
  regular: boolean;
  playoffs: boolean;
}

/** modulekit seasons → every season; `regular` = counted regular season (career=1, playoff=0). */
export function parseHtSeasons(json: unknown): HtSeason[] {
  const seasons = isObject(json) && isObject(json.SiteKit) ? json.SiteKit.Seasons : undefined;
  if (!Array.isArray(seasons)) throw new ConnectorParseError("HockeyTech seasons: missing SiteKit.Seasons");
  return seasons.filter(isObject).map((s) => {
    const start = str(s.start_date);
    const y = Number(start.slice(0, 4));
    return {
      seasonId: str(s.season_id),
      name: str(s.season_name),
      label: Number.isFinite(y) && y > 1900 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : "",
      startDate: start,
      endDate: str(s.end_date),
      regular: str(s.career) === "1" && str(s.playoff) === "0",
      playoffs: str(s.playoff) === "1",
    };
  });
}

export interface HtTeam {
  teamId: string;
  name: string;
  code: string;
  division: string;
}

export function parseHtTeams(json: unknown): HtTeam[] {
  const teams = isObject(json) && isObject(json.SiteKit) ? json.SiteKit.Teamsbyseason : undefined;
  if (!Array.isArray(teams)) throw new ConnectorParseError("HockeyTech teams: missing SiteKit.Teamsbyseason");
  return teams.filter(isObject).map((t) => ({ teamId: str(t.id), name: str(t.name), code: str(t.code), division: str(t.division_long_name) }));
}

export interface HtRosterPlayer {
  playerId: string;
  name: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  position: string;
  heightFtIn: string;
  weightLb: string;
  shoots: string;
}

/**
 * modulekit roster → players only. The feed appends team staff (coaches,
 * managers) as a nested list; those are dropped, never stored.
 */
export function parseHtRoster(json: unknown): HtRosterPlayer[] {
  const roster = isObject(json) && isObject(json.SiteKit) ? json.SiteKit.Roster : undefined;
  if (!Array.isArray(roster)) throw new ConnectorParseError("HockeyTech roster: missing SiteKit.Roster");
  return roster
    .filter((p): p is Record<string, unknown> => isObject(p) && str(p.player_id) !== "")
    .map((p) => ({
      playerId: str(p.player_id),
      // First + last: the QMJHL's `name` is "Last, First".
      name: [str(p.first_name), str(p.last_name)].filter(Boolean).join(" ") || str(p.name),
      firstName: str(p.first_name),
      lastName: str(p.last_name),
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(str(p.birthdate)) ? str(p.birthdate) : "",
      position: str(p.position),
      heightFtIn: str(p.height),
      weightLb: str(p.weight),
      shoots: str(p.shoots),
    }));
}

export interface HtSkaterLine {
  playerId: string;
  name: string;
  position: string;
  team: string;
  gp: number;
  goals: number;
  assists: number;
  points: number;
  ppGoals: number;
  ppAssists: number;
  shGoals: number;
  shAssists: number;
  shots: number | null;
  plusMinus: number | null;
  pim: number | null;
}

const n = (v: unknown): number | null => {
  const s = str(v);
  if (s === "" || s === "-") return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
};

/**
 * statviewfeed players (JSONP-wrapped JSON) → one line per player and team.
 * A player traded mid-season appears once per team. Rows missing games,
 * goals, assists or points throw (they are the minimum the models need).
 */
export function parseHtSkaterStats(body: string): HtSkaterLine[] {
  let t = body.trim();
  if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1);
  let json: unknown;
  try {
    json = JSON.parse(t);
  } catch {
    throw new ConnectorParseError("HockeyTech skater stats: response is not JSON");
  }
  const sections = Array.isArray(json) && isObject(json[0]) ? json[0].sections : undefined;
  const data = Array.isArray(sections) && isObject(sections[0]) ? sections[0].data : undefined;
  if (!Array.isArray(data)) throw new ConnectorParseError("HockeyTech skater stats: missing sections[0].data");
  return data.filter(isObject).map((d, i) => {
    const r = isObject(d.row) ? d.row : {};
    const prop = isObject(d.prop) ? d.prop : {};
    // QMJHL rows carry an abbreviated `shortname` ("M. Massé") and the full
    // name only under prop.shortname.seoName.
    const seoName = isObject(prop.shortname) ? str(prop.shortname.seoName) : "";
    const req = (k: string) => {
      const v = n(r[k]);
      if (v === null) throw new ConnectorParseError(`HockeyTech skater stats row ${i}: missing ${k}`);
      return v;
    };
    return {
      playerId: str(r.player_id),
      name: str(r.name) || seoName || str(r.shortname),
      position: str(r.position),
      team: str(r.team_code),
      gp: req("games_played"),
      goals: req("goals"),
      assists: req("assists"),
      points: req("points"),
      ppGoals: n(r.power_play_goals) ?? 0,
      ppAssists: n(r.power_play_assists) ?? 0,
      shGoals: n(r.short_handed_goals) ?? 0,
      shAssists: n(r.short_handed_assists) ?? 0,
      shots: n(r.shots),
      plusMinus: n(r.plus_minus),
      pim: n(r.penalty_minutes),
    };
  });
}

export const HT_CREDIT = "Data: league statistics via HockeyTech (lscluster.hockeytech.com), the feed behind the leagues' own websites";
export const HT_TERMS =
  "Not a documented public API: the public site feed each league's website uses. Rate-limited to one request per 500 ms, cached, personal use; stat lines only.";

const POSITIONS: Record<string, string> = { C: "C", LW: "LW", RW: "RW", L: "LW", R: "RW", D: "D", LD: "D", RD: "D", G: "G" };

/** The regular season with this label (e.g. "2026-27") in a league's season list. */
export function htRegularSeasonId(seasons: HtSeason[], label: string): string {
  const s = seasons.find((x) => x.regular && x.label === label);
  if (!s) throw new ConnectorParseError(`No ${label} regular season in this league's HockeyTech feed`);
  return s.seasonId;
}

/** Skater lines → ext_player_seasons records (external id `<league>:<HockeyTech player id>`). */
export function htSkaterRecords(lines: HtSkaterLine[], league: HtLeague, season: string): { records: Record<string, string>[]; warnings: string[] } {
  const warnings: string[] = [];
  const unknownPos = new Set<string>();
  const records = lines
    .filter((l) => l.playerId !== "")
    .map((l) => {
      const pos = POSITIONS[l.position.toUpperCase()] ?? "";
      if (!pos && l.position) unknownPos.add(l.position);
      const s = (v: number | null) => (v === null ? "" : String(v));
      return {
        external_player_id: `${league.code}:${l.playerId}`,
        player_name: l.name,
        season,
        game_type: "regular",
        league: league.name,
        team_name: l.team,
        situation: "all",
        position: pos,
        games_played: s(l.gp),
        goals: s(l.goals),
        assists: s(l.assists),
        points: s(l.points),
        plus_minus: s(l.plusMinus),
        penalty_minutes: s(l.pim),
        shots: s(l.shots),
        pp_goals: s(l.ppGoals),
        pp_points: s(l.ppGoals + l.ppAssists),
        sh_goals: s(l.shGoals),
        sh_points: s(l.shGoals + l.shAssists),
        m_es_points: s(l.points - l.ppGoals - l.ppAssists - l.shGoals - l.shAssists),
      };
    });
  if (unknownPos.size) warnings.push(`Position not recognised (left blank): ${[...unknownPos].join(", ")}`);
  if (records.some((r) => r.shots === "")) warnings.push("Some lines have no shots (not every league reports them); left blank.");
  return { records, warnings };
}
