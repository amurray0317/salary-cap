/**
 * Derived NCAA statistics, position-relative percentiles, and age adjustment.
 * Pure functions; every derived/estimated figure is labeled by the caller.
 * Per-60 rates are intentionally NOT computed here unless TOI exists —
 * fabricating time-on-ice is forbidden (see docs/SCOUTING.md).
 */
import type { PercentileMetric } from "./archetypes";

export interface SeasonLine {
  prospectId: string;
  seasonName: string;
  position: string; // C | LW | RW | D | G
  positionGroup: "F" | "D" | "G";
  age: number | null; // age at season start; null = unknown
  gamesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  penaltyMinutes: number;
  powerPlayGoals: number;
  powerPlayAssists: number;
  shortHandedGoals: number;
  faceoffWins: number;
  faceoffAttempts: number;
  timeOnIceSeconds: number | null;
  teamGoalsFor: number | null;
  teamGamesPlayed?: number | null;
}

export interface DerivedStats {
  points: number;
  ppg: number | null;
  goalsPerGame: number | null;
  assistsPerGame: number | null;
  shotsPerGame: number | null;
  shootingPct: number | null;
  ppPoints: number;
  ppShare: number | null; // share of points scored on the PP
  faceoffPct: number | null;
  pimPerGame: number | null;
  pointsPer60: number | null; // ONLY when TOI is present
  teamRelativePpg: number | null; // player points share of team goals, per game
  missing: string[]; // which inputs were unavailable
}

export function deriveStats(line: SeasonLine): DerivedStats {
  const missing: string[] = [];
  const gp = line.gamesPlayed;
  const points = line.goals + line.assists;
  const per = (v: number) => (gp > 0 ? v / gp : null);
  if (gp === 0) missing.push("games_played");

  const shootingPct = line.shots > 0 ? line.goals / line.shots : null;
  if (line.shots === 0) missing.push("shots");

  const faceoffPct = line.faceoffAttempts > 0 ? line.faceoffWins / line.faceoffAttempts : null;
  if (line.faceoffAttempts === 0) missing.push("faceoffs");

  const ppPoints = line.powerPlayGoals + line.powerPlayAssists;
  const ppShare = points > 0 ? ppPoints / points : null;

  let pointsPer60: number | null = null;
  if (line.timeOnIceSeconds !== null && line.timeOnIceSeconds > 0) {
    pointsPer60 = (points / (line.timeOnIceSeconds / 3600)) * 1;
  } else {
    missing.push("time_on_ice");
  }

  let teamRelativePpg: number | null = null;
  if (line.teamGoalsFor !== null && line.teamGoalsFor > 0 && gp > 0) {
    // Share of the team's scoring the player was on the scoresheet for,
    // normalized per game — a scoring-environment adjustment.
    teamRelativePpg = points / line.teamGoalsFor;
  } else {
    missing.push("team_goals_for");
  }

  return {
    points,
    ppg: per(points),
    goalsPerGame: per(line.goals),
    assistsPerGame: per(line.assists),
    shotsPerGame: per(line.shots),
    shootingPct,
    ppPoints,
    ppShare,
    faceoffPct,
    pimPerGame: per(line.penaltyMinutes),
    pointsPer60,
    teamRelativePpg,
    missing,
  };
}

/**
 * Age-adjusted points per game (ESTIMATE): production is scaled by a factor
 * favoring younger players relative to the NCAA median age of ~21.
 * +8% credit per year younger, −8% per year older, clamped ±30%.
 */
export function ageAdjustedPpg(ppg: number | null, age: number | null): number | null {
  if (ppg === null) return null;
  if (age === null) return ppg; // unknown age → no adjustment, flagged upstream
  const factor = Math.min(1.3, Math.max(0.7, 1 + (21 - age) * 0.08));
  return ppg * factor;
}

export interface MetricSample {
  prospectId: string;
  value: number;
}

/**
 * Percentile of a value within same-position-group samples (0..100).
 * Returns null when the pool is too small to be meaningful (< 8 peers).
 */
export function percentileRank(value: number, pool: number[]): number | null {
  if (pool.length < 8) return null;
  let below = 0;
  let equal = 0;
  for (const v of pool) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return Math.round(((below + equal / 2) / pool.length) * 100);
}

export interface PercentileSet {
  values: Partial<Record<PercentileMetric, number | null>>; // raw metric values
  percentiles: Partial<Record<PercentileMetric, number | null>>;
  poolSize: number;
  missing: string[];
}

/**
 * Builds a prospect's metric values and position-relative percentiles against
 * a peer pool of same-position-group season lines (same season).
 */
export function buildPercentiles(subject: SeasonLine, peers: SeasonLine[]): PercentileSet {
  const subjectDerived = deriveStats(subject);
  const subjectValues: Partial<Record<PercentileMetric, number | null>> = {
    ppg: subjectDerived.ppg,
    goalsPerGame: subjectDerived.goalsPerGame,
    assistsPerGame: subjectDerived.assistsPerGame,
    shotsPerGame: subjectDerived.shotsPerGame,
    shootingPct: subjectDerived.shootingPct,
    ppShare: subjectDerived.ppShare,
    faceoffPct: subjectDerived.faceoffPct,
    // Discipline: fewer penalty minutes per game scores higher → invert.
    pimDiscipline: subjectDerived.pimPerGame === null ? null : -subjectDerived.pimPerGame,
    // Physicality proxy without tracking data: PIM per game (labeled estimate).
    physicality: subjectDerived.pimPerGame,
    shGoals: subject.gamesPlayed > 0 ? subject.shortHandedGoals / subject.gamesPlayed : null,
    ageAdjustedPpg: ageAdjustedPpg(subjectDerived.ppg, subject.age),
    teamRelativePpg: subjectDerived.teamRelativePpg,
    gamesShare:
      subject.teamGamesPlayed && subject.teamGamesPlayed > 0
        ? subject.gamesPlayed / subject.teamGamesPlayed
        : null,
  };

  const peerPool = peers.filter(
    (p) => p.positionGroup === subject.positionGroup && p.prospectId !== subject.prospectId && p.gamesPlayed >= 5,
  );

  const poolFor = (metric: PercentileMetric): number[] => {
    const out: number[] = [];
    for (const p of peerPool) {
      const d = deriveStats(p);
      const v: number | null = (() => {
        switch (metric) {
          case "ppg": return d.ppg;
          case "goalsPerGame": return d.goalsPerGame;
          case "assistsPerGame": return d.assistsPerGame;
          case "shotsPerGame": return d.shotsPerGame;
          case "shootingPct": return d.shootingPct;
          case "ppShare": return d.ppShare;
          case "faceoffPct": return d.faceoffPct;
          case "pimDiscipline": return d.pimPerGame === null ? null : -d.pimPerGame;
          case "physicality": return d.pimPerGame;
          case "shGoals": return p.gamesPlayed > 0 ? p.shortHandedGoals / p.gamesPlayed : null;
          case "ageAdjustedPpg": return ageAdjustedPpg(d.ppg, p.age);
          case "teamRelativePpg": return d.teamRelativePpg;
          case "gamesShare":
            return p.teamGamesPlayed && p.teamGamesPlayed > 0 ? p.gamesPlayed / p.teamGamesPlayed : null;
        }
      })();
      if (v !== null && Number.isFinite(v)) out.push(v);
    }
    return out;
  };

  const percentiles: PercentileSet["percentiles"] = {};
  const missing: string[] = [...subjectDerived.missing];
  for (const metric of Object.keys(subjectValues) as PercentileMetric[]) {
    const value = subjectValues[metric];
    if (value === null || value === undefined) {
      percentiles[metric] = null;
      continue;
    }
    percentiles[metric] = percentileRank(value, poolFor(metric));
  }

  return { values: subjectValues, percentiles, poolSize: peerPool.length, missing };
}
