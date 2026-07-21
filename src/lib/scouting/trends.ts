/**
 * Trend engine (model riq-trend-v0.1): season-over-season, split-half, and
 * recent-game trends with transparent classification thresholds. Thresholds
 * are documented constants — tune here, never in components.
 */
import { TREND_MODEL_VERSION } from "./archetypes";
import { deriveStats, type SeasonLine } from "./stats";

export interface GameLogLine {
  gameDate: string;
  goals: number;
  assists: number;
  shots: number;
}

export type TrendClassification =
  | "rapidly_ascending"
  | "steady_progression"
  | "breakout_season"
  | "stable_producer"
  | "role_expansion"
  | "production_decline"
  | "small_sample_spike"
  | "underlying_growth"
  | "over_age_dominance_concern"
  | "insufficient_sample";

export const TREND_LABELS: Record<TrendClassification, string> = {
  rapidly_ascending: "Rapidly ascending",
  steady_progression: "Steady progression",
  breakout_season: "Breakout season",
  stable_producer: "Stable producer",
  role_expansion: "Role expansion",
  production_decline: "Production decline",
  small_sample_spike: "Small-sample spike",
  underlying_growth: "Underlying growth",
  over_age_dominance_concern: "Over-age dominance concern",
  insufficient_sample: "Insufficient sample",
};

export interface Trend {
  kind: string;
  label: string;
  classification: TrendClassification | null;
  summary: string;
  detail: Record<string, number | string | null>;
  warnings: string[];
  modelVersion: string;
}

/* Classification thresholds (PPG deltas year-over-year). */
const T = {
  breakout: 0.35,
  rapid: 0.2,
  steady: 0.05,
  decline: -0.1,
  smallSampleGp: 15,
  minGp: 10,
  shotGrowth: 0.5, // shots/game increase for underlying growth
  ppShareGrowth: 0.12, // PP share increase for role expansion
  overAge: 23,
} as const;

function classifyYearOverYear(prev: SeasonLine, curr: SeasonLine): { classification: TrendClassification; why: string } {
  const p = deriveStats(prev);
  const c = deriveStats(curr);
  if (curr.gamesPlayed < T.minGp || prev.gamesPlayed < T.minGp) {
    return { classification: "insufficient_sample", why: `GP ${prev.gamesPlayed}→${curr.gamesPlayed} below the ${T.minGp}-game threshold` };
  }
  const dPpg = (c.ppg ?? 0) - (p.ppg ?? 0);
  const dShots = (c.shotsPerGame ?? 0) - (p.shotsPerGame ?? 0);
  const dPpShare = (c.ppShare ?? 0) - (p.ppShare ?? 0);

  if (curr.age !== null && curr.age >= T.overAge && (c.ppg ?? 0) >= 1.0) {
    return { classification: "over_age_dominance_concern", why: `Producing ${c.ppg?.toFixed(2)} PPG at age ${curr.age} against younger competition` };
  }
  if (dPpg >= T.breakout) {
    if (curr.gamesPlayed < T.smallSampleGp) {
      return { classification: "small_sample_spike", why: `PPG up ${dPpg.toFixed(2)} but only ${curr.gamesPlayed} GP` };
    }
    return { classification: "breakout_season", why: `PPG up ${dPpg.toFixed(2)} year over year` };
  }
  if (dPpg >= T.rapid) return { classification: "rapidly_ascending", why: `PPG up ${dPpg.toFixed(2)} year over year` };
  // Decline outranks PP-share growth: a shrinking point total inflates PP
  // share arithmetically and must never be read as role expansion.
  if (dPpg <= T.decline) return { classification: "production_decline", why: `PPG down ${Math.abs(dPpg).toFixed(2)} year over year` };
  if (dPpShare >= T.ppShareGrowth) return { classification: "role_expansion", why: `Power-play share of production up ${(dPpShare * 100).toFixed(0)} points` };
  if (dPpg >= T.steady) return { classification: "steady_progression", why: `PPG up ${dPpg.toFixed(2)} year over year` };
  if (dShots >= T.shotGrowth && dPpg < T.steady) {
    return { classification: "underlying_growth", why: `Shot volume up ${dShots.toFixed(1)}/game without an equivalent point increase` };
  }
  return { classification: "stable_producer", why: `PPG change ${dPpg >= 0 ? "+" : ""}${dPpg.toFixed(2)} within the stable band` };
}

/** Season-over-season trends (sorted seasons: oldest → newest). */
export function computeSeasonTrends(seasons: SeasonLine[]): Trend[] {
  const trends: Trend[] = [];
  const sorted = [...seasons].sort((a, b) => a.seasonName.localeCompare(b.seasonName));

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const p = deriveStats(prev);
    const c = deriveStats(curr);
    const { classification, why } = classifyYearOverYear(prev, curr);
    const warnings: string[] = [];
    if (p.missing.includes("team_goals_for") || c.missing.includes("team_goals_for")) {
      warnings.push("Team scoring environment missing for at least one season; team-relative change unavailable");
    }
    trends.push({
      kind: "year_over_year",
      label: `${prev.seasonName} → ${curr.seasonName}`,
      classification,
      summary: why,
      detail: {
        prevSeason: prev.seasonName,
        currSeason: curr.seasonName,
        prevGp: prev.gamesPlayed,
        currGp: curr.gamesPlayed,
        prevPpg: p.ppg,
        currPpg: c.ppg,
        ppgChange: c.ppg !== null && p.ppg !== null ? Number((c.ppg - p.ppg).toFixed(3)) : null,
        shotsPerGameChange:
          c.shotsPerGame !== null && p.shotsPerGame !== null
            ? Number((c.shotsPerGame - p.shotsPerGame).toFixed(2))
            : null,
        goalRateChange:
          c.goalsPerGame !== null && p.goalsPerGame !== null
            ? Number((c.goalsPerGame - p.goalsPerGame).toFixed(3))
            : null,
        assistRateChange:
          c.assistsPerGame !== null && p.assistsPerGame !== null
            ? Number((c.assistsPerGame - p.assistsPerGame).toFixed(3))
            : null,
        ppShareChange:
          c.ppShare !== null && p.ppShare !== null ? Number((c.ppShare - p.ppShare).toFixed(3)) : null,
        teamRelativeChange:
          c.teamRelativePpg !== null && p.teamRelativePpg !== null
            ? Number((c.teamRelativePpg - p.teamRelativePpg).toFixed(4))
            : null,
        classChange: `${prev.seasonName.slice(0, 4)}→${curr.seasonName.slice(0, 4)}`,
      },
      warnings,
      modelVersion: TREND_MODEL_VERSION,
    });
  }
  return trends;
}

/** Recent-game and split-half trends from game logs (current season). */
export function computeGameLogTrends(seasonName: string, logs: GameLogLine[]): Trend[] {
  const trends: Trend[] = [];
  const sorted = [...logs].sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  const ppgOf = (slice: GameLogLine[]) =>
    slice.length > 0 ? slice.reduce((s, g) => s + g.goals + g.assists, 0) / slice.length : null;
  const seasonPpg = ppgOf(sorted);

  for (const window of [5, 10] as const) {
    const slice = sorted.slice(-window);
    const recent = ppgOf(slice);
    const warnings: string[] = [];
    let classification: TrendClassification | null = null;
    if (slice.length < window) {
      classification = "insufficient_sample";
      warnings.push(`Only ${slice.length} games available for the last-${window} window`);
    } else if (recent !== null && seasonPpg !== null) {
      const delta = recent - seasonPpg;
      classification =
        delta >= 0.4 ? "small_sample_spike" : delta >= 0.15 ? "rapidly_ascending" : delta <= -0.3 ? "production_decline" : "stable_producer";
    }
    trends.push({
      kind: `last_${window}`,
      label: `Last ${window} games`,
      classification,
      summary:
        recent === null
          ? "No games available"
          : `${recent.toFixed(2)} PPG over the last ${slice.length} games (season ${seasonPpg?.toFixed(2) ?? "—"})`,
      detail: { seasonName, games: slice.length, recentPpg: recent, seasonPpg },
      warnings,
      modelVersion: TREND_MODEL_VERSION,
    });
  }

  if (sorted.length >= 12) {
    const mid = Math.floor(sorted.length / 2);
    const first = ppgOf(sorted.slice(0, mid));
    const second = ppgOf(sorted.slice(mid));
    const delta = first !== null && second !== null ? second - first : null;
    trends.push({
      kind: "first_second_half",
      label: "First half vs second half",
      classification:
        delta === null ? null : delta >= 0.2 ? "rapidly_ascending" : delta <= -0.2 ? "production_decline" : "stable_producer",
      summary:
        delta === null
          ? "Not enough games"
          : `${first!.toFixed(2)} PPG → ${second!.toFixed(2)} PPG (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`,
      detail: { seasonName, firstHalfPpg: first, secondHalfPpg: second, change: delta },
      warnings: [],
      modelVersion: TREND_MODEL_VERSION,
    });
  } else {
    trends.push({
      kind: "first_second_half",
      label: "First half vs second half",
      classification: "insufficient_sample",
      summary: `Needs 12+ logged games (${sorted.length} available)`,
      detail: { seasonName, games: sorted.length },
      warnings: [],
      modelVersion: TREND_MODEL_VERSION,
    });
  }

  return trends;
}
