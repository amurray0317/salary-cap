import { describe, expect, it } from "vitest";
import { deriveStats, ageAdjustedPpg, percentileRank, buildPercentiles, type SeasonLine } from "@/lib/scouting/stats";
import { computeSeasonTrends, computeGameLogTrends, type GameLogLine } from "@/lib/scouting/trends";
import { scoreArchetype, scoreAllArchetypes, type WeightRow } from "@/lib/scouting/roleScoring";
import { calculateFit } from "@/lib/scouting/fit";

let counter = 0;
function season(over: Partial<SeasonLine> = {}): SeasonLine {
  counter += 1;
  return {
    prospectId: over.prospectId ?? `p-${counter}`,
    seasonName: "2025-26",
    position: "C",
    positionGroup: "F",
    age: 20,
    gamesPlayed: 34,
    goals: 12,
    assists: 18,
    shots: 100,
    penaltyMinutes: 20,
    powerPlayGoals: 4,
    powerPlayAssists: 6,
    shortHandedGoals: 0,
    faceoffWins: 300,
    faceoffAttempts: 600,
    timeOnIceSeconds: null,
    teamGoalsFor: 120,
    teamGamesPlayed: 36,
    ...over,
  };
}

describe("deriveStats", () => {
  it("computes rates and never fabricates per-60 without TOI", () => {
    const d = deriveStats(season());
    expect(d.points).toBe(30);
    expect(d.ppg).toBeCloseTo(30 / 34);
    expect(d.shootingPct).toBeCloseTo(0.12);
    expect(d.faceoffPct).toBeCloseTo(0.5);
    expect(d.ppShare).toBeCloseTo(10 / 30);
    expect(d.pointsPer60).toBeNull();
    expect(d.missing).toContain("time_on_ice");
  });

  it("computes per-60 only when TOI exists", () => {
    const d = deriveStats(season({ timeOnIceSeconds: 34 * 18 * 60 }));
    expect(d.pointsPer60).toBeCloseTo(30 / ((34 * 18 * 60) / 3600));
    expect(d.missing).not.toContain("time_on_ice");
  });

  it("flags missing inputs instead of guessing", () => {
    const d = deriveStats(season({ gamesPlayed: 0, shots: 0, faceoffAttempts: 0, teamGoalsFor: null }));
    expect(d.ppg).toBeNull();
    expect(d.shootingPct).toBeNull();
    expect(d.faceoffPct).toBeNull();
    expect(d.teamRelativePpg).toBeNull();
    expect(d.missing).toEqual(expect.arrayContaining(["games_played", "shots", "faceoffs", "team_goals_for"]));
  });
});

describe("age adjustment and percentiles", () => {
  it("boosts younger players and dampens older ones, clamped", () => {
    expect(ageAdjustedPpg(1, 20)!).toBeCloseTo(1.08);
    expect(ageAdjustedPpg(1, 24)!).toBeCloseTo(0.76);
    expect(ageAdjustedPpg(1, 10)!).toBeCloseTo(1.3); // clamp
    expect(ageAdjustedPpg(1, null)).toBe(1); // unknown age → no adjustment
    expect(ageAdjustedPpg(null, 20)).toBeNull();
  });

  it("percentileRank needs a minimum pool and ranks correctly", () => {
    expect(percentileRank(5, [1, 2, 3])).toBeNull(); // pool too small
    const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileRank(10, pool)).toBe(95);
    expect(percentileRank(1, pool)).toBe(5);
  });

  it("buildPercentiles restricts pools to the same position group", () => {
    const subject = season({ prospectId: "subject", goals: 20, assists: 25 });
    const forwards = Array.from({ length: 20 }, (_, i) =>
      season({ prospectId: `f-${i}`, goals: 5 + i, assists: 6 + i }),
    );
    const defensemen = Array.from({ length: 20 }, (_, i) =>
      season({ prospectId: `d-${i}`, position: "D", positionGroup: "D", goals: 2, assists: 4 }),
    );
    const set = buildPercentiles(subject, [...forwards, ...defensemen]);
    expect(set.poolSize).toBe(20); // defensemen excluded
    expect(set.percentiles.ppg).toBeGreaterThan(70);
    expect(set.values.ageAdjustedPpg).not.toBeNull();
  });
});

describe("trend engine", () => {
  it("classifies breakout, decline, and insufficient sample", () => {
    const prev = season({ prospectId: "x", seasonName: "2024-25", gamesPlayed: 34, goals: 8, assists: 9 });
    const breakout = season({ prospectId: "x", seasonName: "2025-26", gamesPlayed: 34, goals: 20, assists: 22 });
    const t1 = computeSeasonTrends([prev, breakout]);
    expect(t1[0]?.classification).toBe("breakout_season");
    expect(t1[0]?.detail.ppgChange).toBeGreaterThan(0.3);

    const decline = season({ prospectId: "x", seasonName: "2025-26", gamesPlayed: 34, goals: 4, assists: 6 });
    expect(computeSeasonTrends([prev, decline])[0]?.classification).toBe("production_decline");

    const tiny = season({ prospectId: "x", seasonName: "2025-26", gamesPlayed: 6, goals: 8, assists: 8 });
    expect(computeSeasonTrends([prev, tiny])[0]?.classification).toBe("insufficient_sample");
  });

  it("flags over-age dominance and underlying growth", () => {
    const prev = season({ prospectId: "y", seasonName: "2024-25", age: 23, goals: 15, assists: 16 });
    const curr = season({ prospectId: "y", seasonName: "2025-26", age: 24, goals: 20, assists: 20 });
    expect(computeSeasonTrends([prev, curr])[0]?.classification).toBe("over_age_dominance_concern");

    const flat = season({ prospectId: "z", seasonName: "2024-25", goals: 10, assists: 10, shots: 80 });
    const shotsUp = season({ prospectId: "z", seasonName: "2025-26", goals: 10, assists: 10, shots: 130 });
    expect(computeSeasonTrends([flat, shotsUp])[0]?.classification).toBe("underlying_growth");
  });

  it("computes last-5/last-10 and split-half trends with sample warnings", () => {
    const logs: GameLogLine[] = Array.from({ length: 20 }, (_, i) => ({
      gameDate: `2025-11-${String(i + 1).padStart(2, "0")}`,
      goals: i >= 15 ? 1 : 0, // hot finish
      assists: i >= 15 ? 1 : 0,
      shots: 3,
    }));
    const trends = computeGameLogTrends("2025-26", logs);
    const last5 = trends.find((t) => t.kind === "last_5");
    expect(last5?.detail.recentPpg).toBe(2);
    expect(last5?.classification).toBe("small_sample_spike");
    const half = trends.find((t) => t.kind === "first_second_half");
    expect(half?.classification).toBe("rapidly_ascending");

    const few = computeGameLogTrends("2025-26", logs.slice(0, 3));
    expect(few.find((t) => t.kind === "last_10")?.classification).toBe("insufficient_sample");
  });
});

describe("role scoring", () => {
  const weights: WeightRow[] = [
    { archetypeKey: "shooting_winger", archetypeLabel: "Shooting winger", positionGroup: "F", metric: "goalsPerGame", weight: 0.5, modelVersion: "riq-role-v0.1" },
    { archetypeKey: "shooting_winger", archetypeLabel: "Shooting winger", positionGroup: "F", metric: "shotsPerGame", weight: 0.3, modelVersion: "riq-role-v0.1" },
    { archetypeKey: "shooting_winger", archetypeLabel: "Shooting winger", positionGroup: "F", metric: "faceoffPct", weight: 0.2, modelVersion: "riq-role-v0.1" },
  ];

  function mkPercentiles(p: Record<string, number | null>, poolSize = 50) {
    return { values: {}, percentiles: p, poolSize, missing: [] };
  }

  it("weights contributions and explains them", () => {
    const s = scoreArchetype(weights, mkPercentiles({ goalsPerGame: 90, shotsPerGame: 80, faceoffPct: 50 }));
    expect(s?.score).toBeCloseTo(90 * 0.5 + 80 * 0.3 + 50 * 0.2, 0);
    expect(s?.contributions).toHaveLength(3);
    expect(s?.confidence).toBeGreaterThan(0.8);
    expect(s?.missingInputs).toHaveLength(0);
  });

  it("handles missing metrics by rescaling and cutting confidence, never imputing", () => {
    const s = scoreArchetype(weights, mkPercentiles({ goalsPerGame: 90, shotsPerGame: 80, faceoffPct: null }));
    expect(s?.score).toBeCloseTo((90 * 0.5 + 80 * 0.3) / 0.8, 0);
    expect(s?.missingInputs).toEqual(["faceoffPct"]);
    expect(s?.confidence).toBeLessThan(0.85);
  });

  it("returns null score when nothing is computable", () => {
    const s = scoreArchetype(weights, mkPercentiles({ goalsPerGame: null, shotsPerGame: null, faceoffPct: null }));
    expect(s?.score).toBeNull();
    expect(s?.confidence).toBe(0);
  });

  it("surfaces contradicting evidence for weak core metrics", () => {
    const s = scoreArchetype(weights, mkPercentiles({ goalsPerGame: 10, shotsPerGame: 85, faceoffPct: 60 }));
    expect(s?.contradictions.length).toBeGreaterThan(0);
  });

  it("small peer pools reduce confidence", () => {
    const big = scoreArchetype(weights, mkPercentiles({ goalsPerGame: 80, shotsPerGame: 80, faceoffPct: 80 }, 50));
    const small = scoreArchetype(weights, mkPercentiles({ goalsPerGame: 80, shotsPerGame: 80, faceoffPct: 80 }, 10));
    expect(small!.confidence).toBeLessThan(big!.confidence);
  });

  it("ranks archetypes within the position group only", () => {
    const all: WeightRow[] = [
      ...weights,
      { archetypeKey: "pp_qb", archetypeLabel: "PP QB", positionGroup: "D", metric: "ppShare", weight: 1, modelVersion: "riq-role-v0.1" },
    ];
    const ranked = scoreAllArchetypes("F", all, mkPercentiles({ goalsPerGame: 90, shotsPerGame: 80, faceoffPct: 50, ppShare: 99 }));
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.archetypeKey).toBe("shooting_winger");
  });
});

describe("fit engine", () => {
  const need = {
    position: "D",
    handedness: "R",
    targetRoleKey: "puck_moving_d",
    priority: 1,
    timelineYears: 2,
    maxRiskTolerance: "medium",
  };
  const prospect = {
    position: "D",
    positionGroup: "D" as const,
    shootsCatches: "R",
    classYear: "sophomore" as const,
    age: 20,
    primaryInferredRole: null,
    scoutAssignedRoleKey: null,
    roleScores: [
      { archetypeKey: "puck_moving_d", archetypeLabel: "Puck-moving defenseman", positionGroup: "D" as const, score: 82, confidence: 0.8, contributions: [], missingInputs: [], contradictions: [], modelVersion: "riq-role-v0.1", poolSize: 50 },
    ],
    latestTrendClassification: "steady_progression",
    gamesPlayedLatest: 34,
  };
  const depth = { contractsAtPosition: 6, expiringWithinTimeline: 2 };

  it("produces an explainable overall with all components", () => {
    const fit = calculateFit(need, prospect, depth);
    expect(fit.overall).toBeGreaterThan(70);
    expect(fit.components.map((c) => c.key)).toEqual(["position", "handedness", "role", "timeline", "opportunity", "risk"]);
    for (const c of fit.components) expect(c.explanation.length).toBeGreaterThan(5);
  });

  it("scout-assigned role beats inferred score; wrong hand hurts", () => {
    const withScoutRole = calculateFit(need, { ...prospect, scoutAssignedRoleKey: "puck_moving_d" }, depth);
    expect(withScoutRole.components.find((c) => c.key === "role")?.score).toBe(100);
    const wrongHand = calculateFit(need, { ...prospect, shootsCatches: "L" }, depth);
    expect(wrongHand.components.find((c) => c.key === "handedness")?.score).toBe(20);
    expect(wrongHand.overall!).toBeLessThan(withScoutRole.overall!);
  });

  it("risk beyond tolerance and missing data are surfaced, not hidden", () => {
    const risky = calculateFit(
      { ...need, maxRiskTolerance: "low" },
      { ...prospect, latestTrendClassification: "small_sample_spike", gamesPlayedLatest: 8, shootsCatches: null },
      depth,
    );
    expect(risky.components.find((c) => c.key === "risk")?.score).toBeLessThan(50);
    expect(risky.components.find((c) => c.key === "handedness")?.score).toBeNull();
    expect(risky.warnings.join(" ")).toMatch(/Handedness missing/);
    expect(risky.warnings.join(" ")).toMatch(/8 games/);
  });

  it("uses contract depth for the opportunity path", () => {
    const thin = calculateFit(need, prospect, { contractsAtPosition: 2, expiringWithinTimeline: 0 });
    const crowded = calculateFit(need, prospect, { contractsAtPosition: 8, expiringWithinTimeline: 0 });
    const thinScore = thin.components.find((c) => c.key === "opportunity")!.score!;
    const crowdedScore = crowded.components.find((c) => c.key === "opportunity")!.score!;
    expect(thinScore).toBeGreaterThan(crowdedScore);
  });
});
