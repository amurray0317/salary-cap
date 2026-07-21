import { describe, expect, it } from "vitest";
import { deriveStats, ageAdjustedPpg, percentileRank, buildPercentiles, type SeasonLine } from "@/lib/scouting/stats";
import { computeSeasonTrends, computeGameLogTrends, type GameLogLine } from "@/lib/scouting/trends";
import { scoreArchetype, scoreAllArchetypes, type WeightRow } from "@/lib/scouting/roleScoring";
import { calculateFit, DEFAULT_FIT_WEIGHTS, FIT_COMPONENT_KEYS } from "@/lib/scouting/fit";

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

describe("fit engine (riq-fit-v0.2)", () => {
  const need = {
    name: "RHD transition",
    position: "D",
    secondaryPosition: null,
    handedness: "R",
    targetRoleKey: "puck_moving_d",
    targetScoutRoleKey: null,
    priority: 1,
    timelineYears: 2,
    earliestArrivalYears: 1,
    latestArrivalYears: 4,
    preferredAcquisition: "draft",
    maxRiskTolerance: "medium",
    minGrades: {} as Record<string, number>,
    specialTeamsRequirement: null,
    nhlRosterNeed: false,
    ahlOpportunity: true,
  };
  const prospect = {
    position: "D",
    positionGroup: "D" as const,
    shootsCatches: "R",
    classYear: "sophomore" as const,
    age: 20,
    scoutAssignedRoleKey: null,
    roleScores: [
      { archetypeKey: "puck_moving_d", archetypeLabel: "Puck-moving defenseman", positionGroup: "D" as const, score: 82, confidence: 0.8, contributions: [], missingInputs: [], contradictions: [], modelVersion: "riq-role-v0.1", poolSize: 50 },
    ],
    latestTrendClassification: "steady_progression",
    gamesPlayedLatest: 34,
    nhlDraftStatus: "undrafted",
    nhlRightsHolder: null,
    collegeFreeAgentStatus: "not_eligible",
    reportGrades: null as Record<string, number> | null,
    reportRisk: null as string | null,
    ppShare: 0.3,
    shGoals: 1,
  };
  const depth = {
    contractsAtPosition: 6,
    expiringWithinWindow: 2,
    minorLeagueAtPosition: 2,
    prospectsAtPosition: 4,
    prospectsAtTargetRole: 1,
  };

  it("produces all 14 components with inputs, weights, contributions, and explanations", () => {
    const fit = calculateFit(need, prospect, depth);
    expect(fit.components).toHaveLength(14);
    expect(fit.components.map((c) => c.key)).toEqual([...FIT_COMPONENT_KEYS]);
    expect(fit.overall).toBeGreaterThan(60);
    expect(fit.confidence).toBeGreaterThan(0.9);
    expect(fit.modelVersion).toBe("riq-fit-v0.2");
    expect(fit.computedAt).toMatch(/^\d{4}-/);
    for (const c of fit.components) {
      expect(c.explanation.length).toBeGreaterThan(5);
      expect(c.inputValue.length).toBeGreaterThan(0);
      expect(c.desiredValue.length).toBeGreaterThan(0);
      if (c.finalScore !== null) {
        expect(c.weightedContribution).toBeCloseTo(c.finalScore * c.weight, 1);
      }
    }
  });

  it("position: primary > secondary > same-group > other", () => {
    const primary = calculateFit(need, prospect, depth).components.find((c) => c.key === "position")!;
    expect(primary.finalScore).toBe(100);
    const secondary = calculateFit(
      { ...need, position: "G", secondaryPosition: "D" },
      prospect,
      depth,
    ).components.find((c) => c.key === "position")!;
    expect(secondary.finalScore).toBe(75);
    const other = calculateFit({ ...need, position: "G" }, prospect, depth).components.find((c) => c.key === "position")!;
    expect(other.finalScore).toBe(0);
  });

  it("handedness: match 100, mismatch 20, unknown null + warning (never zero)", () => {
    expect(calculateFit(need, prospect, depth).components.find((c) => c.key === "handedness")!.finalScore).toBe(100);
    expect(
      calculateFit(need, { ...prospect, shootsCatches: "L" }, depth).components.find((c) => c.key === "handedness")!.finalScore,
    ).toBe(20);
    const unknown = calculateFit(need, { ...prospect, shootsCatches: null }, depth);
    expect(unknown.components.find((c) => c.key === "handedness")!.finalScore).toBeNull();
    expect(unknown.warnings.join(" ")).toMatch(/Handedness missing/);
  });

  it("statistical role uses the inferred target-role score; scout role stays separate", () => {
    const fit = calculateFit(need, prospect, depth);
    expect(fit.components.find((c) => c.key === "stat_role")!.finalScore).toBe(82);
    // Scout-role target unset -> neutral 70, NOT the stat score.
    expect(fit.components.find((c) => c.key === "scout_role")!.finalScore).toBe(70);
    const scoutTarget = calculateFit(
      { ...need, targetScoutRoleKey: "transition_d" },
      { ...prospect, scoutAssignedRoleKey: "transition_d" },
      depth,
    );
    expect(scoutTarget.components.find((c) => c.key === "scout_role")!.finalScore).toBe(100);
    const scoutMismatch = calculateFit(
      { ...need, targetScoutRoleKey: "transition_d" },
      { ...prospect, scoutAssignedRoleKey: "shutdown_d" },
      depth,
    );
    expect(scoutMismatch.components.find((c) => c.key === "scout_role")!.finalScore).toBe(25);
  });

  it("timeline scores inside the arrival window and penalizes outside it", () => {
    const inside = calculateFit(need, prospect, depth).components.find((c) => c.key === "timeline")!; // 2y out, window 1-4
    expect(inside.finalScore).toBe(100);
    const outside = calculateFit(
      { ...need, earliestArrivalYears: 0, latestArrivalYears: 1, timelineYears: 0 },
      { ...prospect, classYear: "freshman" }, // 3y out
      depth,
    ).components.find((c) => c.key === "timeline")!;
    expect(outside.finalScore).toBeLessThan(50);
  });

  it("NHL readiness rewards near-ready prospects only when the need wants them", () => {
    const noNeed = calculateFit(need, prospect, depth).components.find((c) => c.key === "nhl_readiness")!;
    expect(noNeed.finalScore).toBe(70); // neutral
    const wants = { ...need, nhlRosterNeed: true };
    const senior = calculateFit(wants, { ...prospect, classYear: "senior" as const }, depth).components.find((c) => c.key === "nhl_readiness")!;
    const freshman = calculateFit(wants, { ...prospect, classYear: "freshman" as const }, depth).components.find((c) => c.key === "nhl_readiness")!;
    expect(senior.finalScore!).toBeGreaterThan(freshman.finalScore!);
  });

  it("depth, expiry, and scarcity fits reward thin depth and openings", () => {
    const thin = calculateFit(need, prospect, {
      ...depth, contractsAtPosition: 2, expiringWithinWindow: 3, prospectsAtTargetRole: 0,
    });
    const crowded = calculateFit(need, prospect, {
      ...depth, contractsAtPosition: 8, expiringWithinWindow: 0, prospectsAtTargetRole: 6,
    });
    for (const key of ["roster_depth", "contract_expiry", "pool_scarcity"] as const) {
      expect(thin.components.find((c) => c.key === key)!.finalScore!).toBeGreaterThan(
        crowded.components.find((c) => c.key === key)!.finalScore!,
      );
    }
    // AHL opportunity: fewer minor-league players at the position = more runway.
    const openAhl = calculateFit(need, prospect, { ...depth, minorLeagueAtPosition: 0 });
    const crowdedAhl = calculateFit(need, prospect, { ...depth, minorLeagueAtPosition: 6 });
    expect(openAhl.components.find((c) => c.key === "ahl_opportunity")!.finalScore!).toBeGreaterThan(
      crowdedAhl.components.find((c) => c.key === "ahl_opportunity")!.finalScore!,
    );
  });

  it("special teams: PP uses PP share; PK is a flagged proxy; missing data excluded", () => {
    const pp = calculateFit({ ...need, specialTeamsRequirement: "pp" }, { ...prospect, ppShare: 0.45 }, depth);
    expect(pp.components.find((c) => c.key === "special_teams")!.finalScore).toBe(90);
    const ppMissing = calculateFit({ ...need, specialTeamsRequirement: "pp" }, { ...prospect, ppShare: null }, depth);
    expect(ppMissing.components.find((c) => c.key === "special_teams")!.finalScore).toBeNull();
    const pk = calculateFit({ ...need, specialTeamsRequirement: "pk" }, prospect, depth);
    expect(pk.warnings.join(" ")).toMatch(/proxy/);
  });

  it("scout grades: minimums met = 100, shortfalls penalized, no report = null + warning", () => {
    const withMins = { ...need, minGrades: { skating: 55, hockey_sense: 55 } };
    const meets = calculateFit(withMins, { ...prospect, reportGrades: { skating: 60, hockey_sense: 55 } }, depth);
    expect(meets.components.find((c) => c.key === "scout_grades")!.finalScore).toBe(100);
    const below = calculateFit(withMins, { ...prospect, reportGrades: { skating: 45, hockey_sense: 60 } }, depth);
    const belowComp = below.components.find((c) => c.key === "scout_grades")!;
    expect(belowComp.finalScore).toBeLessThan(100);
    expect(belowComp.explanation).toMatch(/skating 45 < 55/);
    const noReport = calculateFit(withMins, { ...prospect, reportGrades: null }, depth);
    expect(noReport.components.find((c) => c.key === "scout_grades")!.finalScore).toBeNull();
    expect(noReport.warnings.join(" ")).toMatch(/No scouting report/);
  });

  it("risk: scout-report risk outranks the trend heuristic", () => {
    const trendRisky = calculateFit(
      { ...need, maxRiskTolerance: "low" },
      { ...prospect, latestTrendClassification: "small_sample_spike" },
      depth,
    );
    expect(trendRisky.components.find((c) => c.key === "risk")!.finalScore).toBeLessThan(50);
    const scoutSaysLow = calculateFit(
      { ...need, maxRiskTolerance: "low" },
      { ...prospect, latestTrendClassification: "small_sample_spike", reportRisk: "low" },
      depth,
    );
    expect(scoutSaysLow.components.find((c) => c.key === "risk")!.finalScore).toBe(100);
  });

  it("acquisition method: draft wants undrafted; CFA wants eligible; trade wants held rights", () => {
    const draft = calculateFit(need, prospect, depth).components.find((c) => c.key === "acquisition")!;
    expect(draft.finalScore).toBe(100);
    const drafted = { ...prospect, nhlDraftStatus: "drafted", nhlRightsHolder: "Rival Club" };
    expect(calculateFit(need, drafted, depth).components.find((c) => c.key === "acquisition")!.finalScore).toBe(15);
    expect(
      calculateFit({ ...need, preferredAcquisition: "trade" }, drafted, depth).components.find((c) => c.key === "acquisition")!.finalScore,
    ).toBe(80);
    expect(
      calculateFit({ ...need, preferredAcquisition: "college_fa" }, { ...prospect, collegeFreeAgentStatus: "eligible" }, depth)
        .components.find((c) => c.key === "acquisition")!.finalScore,
    ).toBe(100);
    expect(
      calculateFit({ ...need, preferredAcquisition: "any" }, prospect, depth).components.find((c) => c.key === "acquisition")!.finalScore,
    ).toBe(100);
  });

  it("missing data reduces confidence but never the score itself", () => {
    const complete = calculateFit(need, prospect, depth);
    const sparse = calculateFit(
      { ...need, minGrades: { skating: 55 }, specialTeamsRequirement: "pp", targetScoutRoleKey: "transition_d" },
      { ...prospect, shootsCatches: null, reportGrades: null, ppShare: null, scoutAssignedRoleKey: null },
      depth,
    );
    expect(sparse.confidence!).toBeLessThan(complete.confidence!);
    for (const c of sparse.components) {
      if (c.missingInputs.length > 0) expect(c.finalScore).toBeNull(); // excluded, not zeroed
    }
    expect(sparse.overall).not.toBeNull(); // still computable over covered weight
    expect(sparse.warnings.join(" ")).toMatch(/partial components/);
  });

  it("weights come from the caller (database), not hardcoded UI values", () => {
    const heavyRole: Record<string, number> = { ...DEFAULT_FIT_WEIGHTS, stat_role: 0.9, position: 0.01 };
    const light: Record<string, number> = { ...DEFAULT_FIT_WEIGHTS, stat_role: 0.01 };
    const lowRole = { ...prospect, roleScores: [{ ...prospect.roleScores[0]!, score: 10 }] };
    const heavy = calculateFit(need, lowRole, depth, heavyRole);
    const lite = calculateFit(need, lowRole, depth, light);
    expect(heavy.overall!).toBeLessThan(lite.overall!);
    expect(heavy.components.find((c) => c.key === "stat_role")!.weight).toBe(0.9);
  });
});
