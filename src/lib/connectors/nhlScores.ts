/**
 * NHL scoreboard (api-web /v1/score/{date|now}) for the live Scores page.
 *
 * Display-only data: it is shown, never stored or used by models (final
 * results reach the models through the nightly pipeline). Parsed against
 * responses recorded in tests/fixtures/connectors/nhl/score-*.json; a
 * missing envelope throws instead of showing a partial board.
 */
import { ConnectorParseError, int, isObject, str } from "@/lib/connectors/util";
import { NHL_WEB } from "@/lib/connectors/nhl";

export type GameStatus = "scheduled" | "pregame" | "live" | "intermission" | "final" | "postponed" | "suspended" | "cancelled";

export interface ScoreTeam {
  abbrev: string;
  name: string;
  score: number | null;
  shots: number | null;
}

export interface ScoreGoal {
  period: string;
  time: string;
  team: string;
  scorer: string;
  scorerTotal: number | null;
  assists: string[];
  strength: string;
  emptyNet: boolean;
  awayScore: number | null;
  homeScore: number | null;
}

export interface ScoreGame {
  id: string;
  gameType: "preseason" | "regular" | "playoffs" | "other";
  status: GameStatus;
  startTimeUTC: string;
  venue: string;
  away: ScoreTeam;
  home: ScoreTeam;
  /** "1st", "OT", "SO", … (live and final games). */
  period: string | null;
  clock: string | null;
  /** Final games decided after regulation: "OT" or "SO". */
  finishedIn: "OT" | "SO" | null;
  goals: ScoreGoal[];
}

export interface Scoreboard {
  date: string;
  prevDate: string | null;
  nextDate: string | null;
  games: ScoreGame[];
}

export function scoreboardUrl(date: string): string {
  if (date !== "now" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ConnectorParseError("Scores date must be YYYY-MM-DD or now");
  return `${NHL_WEB}/score/${date}`;
}

const numOrNull = (v: unknown) => (int(v) === "" ? null : Number(int(v)));

export function periodLabel(d: unknown): string | null {
  if (!isObject(d)) return null;
  const type = str(d.periodType);
  const n = Number(int(d.number));
  if (type === "SO") return "SO";
  if (type === "OT") {
    const reg = Number(int(d.maxRegulationPeriods)) || 3;
    const ot = n - reg;
    return ot > 1 ? `${ot}OT` : "OT";
  }
  if (!Number.isFinite(n) || n < 1) return null;
  return ["1st", "2nd", "3rd"][n - 1] ?? `${n}th`;
}

function status(game: Record<string, unknown>): GameStatus {
  const sched = str(game.gameScheduleState);
  if (sched === "PPD") return "postponed";
  if (sched === "SUSP") return "suspended";
  if (sched === "CNCL") return "cancelled";
  const state = str(game.gameState);
  if (state === "LIVE" || state === "CRIT") {
    const clock = isObject(game.clock) ? game.clock : {};
    return clock.inIntermission === true ? "intermission" : "live";
  }
  if (state === "FINAL" || state === "OFF") return "final";
  if (state === "PRE") return "pregame";
  if (state === "FUT") return "scheduled";
  throw new ConnectorParseError(`Scores: unknown game state "${state}"`);
}

function team(t: unknown, which: string): ScoreTeam {
  if (!isObject(t) || str(t.abbrev) === "") throw new ConnectorParseError(`Scores: ${which} team missing`);
  return { abbrev: str(t.abbrev), name: str(t.name) || str(t.commonName) || str(t.abbrev), score: numOrNull(t.score), shots: numOrNull(t.sog) };
}

export function parseScoreboard(json: unknown): Scoreboard {
  if (!isObject(json) || !Array.isArray(json.games)) throw new ConnectorParseError("Scores: expected an object with a games array");
  const games = json.games.filter(isObject).map((g): ScoreGame => {
    const s = status(g);
    const clock = isObject(g.clock) ? g.clock : null;
    const type = Number(int(g.gameType));
    const last = isObject(g.gameOutcome) ? str(g.gameOutcome.lastPeriodType) : "";
    const goals = (Array.isArray(g.goals) ? g.goals : []).filter(isObject).map((x) => ({
      period: periodLabel(x.periodDescriptor) ?? str(x.period),
      time: str(x.timeInPeriod),
      team: str(x.teamAbbrev),
      scorer: str(x.name) || [str(x.firstName), str(x.lastName)].filter(Boolean).join(" "),
      scorerTotal: numOrNull(x.goalsToDate),
      assists: (Array.isArray(x.assists) ? x.assists : []).filter(isObject).map((a) => str(a.name)),
      strength: str(x.strength),
      emptyNet: str(x.goalModifier) === "empty-net",
      awayScore: numOrNull(x.awayScore),
      homeScore: numOrNull(x.homeScore),
    }));
    return {
      id: str(g.id) || String(int(g.id)),
      gameType: type === 1 ? "preseason" : type === 2 ? "regular" : type === 3 ? "playoffs" : "other",
      status: s,
      startTimeUTC: str(g.startTimeUTC),
      venue: str(g.venue),
      away: team(g.awayTeam, "away"),
      home: team(g.homeTeam, "home"),
      period: s === "live" || s === "intermission" || s === "final" ? periodLabel(g.periodDescriptor) : null,
      clock: (s === "live" || s === "intermission") && clock ? str(clock.timeRemaining) || null : null,
      finishedIn: s === "final" && (last === "OT" || last === "SO") ? last : null,
      goals,
    };
  });
  return {
    date: str(json.currentDate),
    prevDate: str(json.prevDate) || null,
    nextDate: str(json.nextDate) || null,
    games,
  };
}
