/**
 * Organizational-fit engine (model riq-fit-v0.2).
 *
 * Explainable, component-based fit between one organizational need and one
 * prospect. Fourteen components, each reporting its observed input, the
 * desired value, the raw 0–100 score, its weight (loaded from the database —
 * never hardcoded in UI code), the weighted contribution, penalties, missing
 * inputs, and a plain-language explanation.
 *
 * Missing data NEVER produces a low score: the component scores null, the
 * overall is computed over the covered weight only, a warning is surfaced,
 * and confidence drops. Pure function — the service assembles all context.
 */
import { FIT_MODEL_VERSION } from "./archetypes";
import type { RoleScore } from "./roleScoring";

export const FIT_COMPONENT_KEYS = [
  "position",
  "handedness",
  "stat_role",
  "scout_role",
  "timeline",
  "nhl_readiness",
  "ahl_opportunity",
  "roster_depth",
  "contract_expiry",
  "pool_scarcity",
  "special_teams",
  "scout_grades",
  "risk",
  "acquisition",
] as const;
export type FitComponentKey = (typeof FIT_COMPONENT_KEYS)[number];

export const FIT_COMPONENT_LABELS: Record<FitComponentKey, string> = {
  position: "Position fit",
  handedness: "Handedness fit",
  stat_role: "Statistical-role fit",
  scout_role: "Scout-role fit",
  timeline: "Timeline fit",
  nhl_readiness: "NHL-readiness fit",
  ahl_opportunity: "AHL-opportunity fit",
  roster_depth: "Roster-depth fit",
  contract_expiry: "Contract-expiry fit",
  pool_scarcity: "Pool-scarcity fit",
  special_teams: "Special-teams fit",
  scout_grades: "Scout-grade fit",
  risk: "Risk fit",
  acquisition: "Acquisition fit",
};

/** Default weights; the service loads the live set from fit_component_weights. */
export const DEFAULT_FIT_WEIGHTS: Record<FitComponentKey, number> = {
  position: 0.12,
  handedness: 0.06,
  stat_role: 0.14,
  scout_role: 0.08,
  timeline: 0.1,
  nhl_readiness: 0.06,
  ahl_opportunity: 0.05,
  roster_depth: 0.08,
  contract_expiry: 0.08,
  pool_scarcity: 0.07,
  special_teams: 0.04,
  scout_grades: 0.07,
  risk: 0.03,
  acquisition: 0.02,
};

export interface NeedInput {
  name: string;
  position: string; // C | LW | RW | D | G | F (any forward)
  secondaryPosition: string | null;
  handedness: string | null; // L | R | null = any
  targetRoleKey: string | null; // statistical role
  targetScoutRoleKey: string | null; // scout-defined role (separate)
  priority: number;
  timelineYears: number; // target arrival
  earliestArrivalYears: number;
  latestArrivalYears: number;
  preferredAcquisition: string; // draft | college_fa | trade | any
  maxRiskTolerance: string; // low | medium | high
  /** 20–80 grade floors keyed by report section (skating, hockey_sense, …). */
  minGrades: Record<string, number>;
  specialTeamsRequirement: string | null; // pp | pk | none | null
  nhlRosterNeed: boolean;
  ahlOpportunity: boolean;
}

export interface ProspectFitInput {
  position: string;
  positionGroup: "F" | "D" | "G";
  shootsCatches: string | null;
  classYear: "freshman" | "sophomore" | "junior" | "senior" | "graduate";
  age: number | null;
  scoutAssignedRoleKey: string | null;
  roleScores: RoleScore[];
  latestTrendClassification: string | null;
  gamesPlayedLatest: number;
  nhlDraftStatus: string; // drafted | undrafted
  nhlRightsHolder: string | null;
  collegeFreeAgentStatus: string; // not_eligible | watch | eligible | signed
  /** Latest scouting-report 20–80 grades keyed by section; null = no report. */
  reportGrades: Record<string, number> | null;
  /** Risk from the latest scouting report (low|medium|high), if any. */
  reportRisk: string | null;
  /** Power-play share of latest-season points (0..1); null when unknown. */
  ppShare: number | null;
  /** Short-handed goals in the latest season; null when unknown. */
  shGoals: number | null;
}

export interface DepthContext {
  /** Active contracts at the needed position across the org's pro teams. */
  contractsAtPosition: number;
  /** Of those, how many expire within the need's latest-arrival window. */
  expiringWithinWindow: number;
  /** Org players at the position with rosterStatus "minor" (AHL proxy). */
  minorLeagueAtPosition: number;
  /** Org NCAA prospects at the same position (pool depth). */
  prospectsAtPosition: number;
  /** Of those, prospects whose scout or primary inferred role matches the target. */
  prospectsAtTargetRole: number;
}

export interface FitComponent {
  key: FitComponentKey;
  label: string;
  inputValue: string; // observed value, human-readable
  desiredValue: string; // what the need asks for
  rawScore: number | null; // 0..100; null = not computable
  weight: number;
  weightedContribution: number | null;
  penalty: number;
  finalScore: number | null;
  missingInputs: string[];
  explanation: string;
}

export interface FitResult {
  overall: number | null; // 0..100
  confidence: number | null; // 0..1
  components: FitComponent[];
  warnings: string[];
  modelVersion: string;
  computedAt: string; // ISO timestamp
}

/** Years until estimated pro availability by class year. */
export const CLASS_TO_YEARS: Record<ProspectFitInput["classYear"], number> = {
  freshman: 3,
  sophomore: 2,
  junior: 1,
  senior: 0,
  graduate: 0,
};

const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

function trendRisk(classification: string | null): { level: string; why: string } {
  switch (classification) {
    case "breakout_season":
    case "rapidly_ascending":
    case "steady_progression":
    case "stable_producer":
      return { level: "low", why: `trend "${classification}" is a positive or stable signal` };
    case "role_expansion":
    case "underlying_growth":
      return { level: "medium", why: `trend "${classification}" is promising but unconverted` };
    case "small_sample_spike":
    case "over_age_dominance_concern":
    case "production_decline":
      return { level: "high", why: `trend "${classification}" is a risk signal` };
    default:
      return { level: "medium", why: "no trend signal available; defaulting to medium risk" };
  }
}

interface Raw {
  inputValue: string;
  desiredValue: string;
  rawScore: number | null;
  penalty?: number;
  missingInputs?: string[];
  explanation: string;
}

export function calculateFit(
  need: NeedInput,
  prospect: ProspectFitInput,
  depth: DepthContext,
  weights: Record<string, number> = DEFAULT_FIT_WEIGHTS,
): FitResult {
  const warnings: string[] = [];
  const raws = new Map<FitComponentKey, Raw>();

  /* -- 1. Position -- */
  {
    const primary =
      need.position === prospect.position ||
      (need.position === "F" && prospect.positionGroup === "F");
    const secondary =
      need.secondaryPosition !== null &&
      (need.secondaryPosition === prospect.position ||
        (need.secondaryPosition === "F" && prospect.positionGroup === "F"));
    const needGroup = need.position === "D" ? "D" : need.position === "G" ? "G" : "F";
    const sameGroup = prospect.positionGroup === needGroup;
    raws.set("position", {
      inputValue: prospect.position,
      desiredValue: need.secondaryPosition ? `${need.position} (or ${need.secondaryPosition})` : need.position,
      rawScore: primary ? 100 : secondary ? 75 : sameGroup ? 50 : 0,
      explanation: primary
        ? `Plays the needed position (${prospect.position})`
        : secondary
          ? `Plays the acceptable secondary position (${prospect.position})`
          : sameGroup
            ? `Same position group as the need but not the listed position`
            : `Plays ${prospect.position}; need is ${need.position}`,
    });
  }

  /* -- 2. Handedness -- */
  if (need.handedness === null) {
    raws.set("handedness", {
      inputValue: prospect.shootsCatches ?? "unknown",
      desiredValue: "any",
      rawScore: 100,
      explanation: "Need accepts either handedness",
    });
  } else if (prospect.shootsCatches === null) {
    raws.set("handedness", {
      inputValue: "unknown",
      desiredValue: need.handedness,
      rawScore: null,
      missingInputs: ["shoots_catches"],
      explanation: "Prospect handedness unknown — component excluded, confidence reduced",
    });
    warnings.push("Handedness missing on the prospect record");
  } else {
    const match = prospect.shootsCatches === need.handedness;
    raws.set("handedness", {
      inputValue: prospect.shootsCatches,
      desiredValue: need.handedness,
      rawScore: match ? 100 : 20,
      explanation: match
        ? `Matches required ${need.handedness} hand`
        : `Shoots ${prospect.shootsCatches}; need requires ${need.handedness}`,
    });
  }

  /* -- 3. Statistical role -- */
  if (need.targetRoleKey === null) {
    raws.set("stat_role", {
      inputValue: prospect.roleScores[0]?.archetypeKey ?? "none",
      desiredValue: "no target",
      rawScore: 70,
      explanation: "Need has no target statistical role; neutral credit",
    });
  } else {
    const inferred = prospect.roleScores.find((r) => r.archetypeKey === need.targetRoleKey);
    if (inferred?.score != null) {
      raws.set("stat_role", {
        inputValue: `${inferred.score}/100 for ${need.targetRoleKey}`,
        desiredValue: need.targetRoleKey,
        rawScore: inferred.score,
        explanation: `Statistically inferred score for the target role is ${inferred.score} (confidence ${(inferred.confidence * 100).toFixed(0)}%)`,
      });
      if (inferred.confidence < 0.5) warnings.push("Statistical-role input has low model confidence");
    } else {
      raws.set("stat_role", {
        inputValue: "no score",
        desiredValue: need.targetRoleKey,
        rawScore: null,
        missingInputs: ["role_score:" + need.targetRoleKey],
        explanation: "No statistical score available for the target role — excluded, confidence reduced",
      });
      warnings.push("Target statistical-role score missing");
    }
  }

  /* -- 4. Scout-defined role (kept separate from inference) -- */
  if (need.targetScoutRoleKey === null) {
    raws.set("scout_role", {
      inputValue: prospect.scoutAssignedRoleKey ?? "none",
      desiredValue: "no target",
      rawScore: 70,
      explanation: "Need has no target scout-defined role; neutral credit",
    });
  } else if (prospect.scoutAssignedRoleKey === null) {
    raws.set("scout_role", {
      inputValue: "not assigned",
      desiredValue: need.targetScoutRoleKey,
      rawScore: null,
      missingInputs: ["scout_assigned_role"],
      explanation: "No scout has assigned a role yet — excluded, confidence reduced",
    });
    warnings.push("Scout-assigned role missing; have a scout classify this prospect");
  } else {
    const match = prospect.scoutAssignedRoleKey === need.targetScoutRoleKey;
    raws.set("scout_role", {
      inputValue: prospect.scoutAssignedRoleKey,
      desiredValue: need.targetScoutRoleKey,
      rawScore: match ? 100 : 25,
      explanation: match ? "Scout-assigned role matches the target" : "Scout-assigned role differs from the target",
    });
  }

  /* -- 5. Timeline (arrival window) -- */
  {
    const yearsOut = CLASS_TO_YEARS[prospect.classYear];
    const { earliestArrivalYears: lo, latestArrivalYears: hi, timelineYears: target } = need;
    let score: number;
    let why: string;
    if (yearsOut >= lo && yearsOut <= hi) {
      score = Math.max(60, 100 - Math.abs(yearsOut - target) * 10);
      why = `Estimated ${yearsOut}y to pro availability (${prospect.classYear}) is inside the ${lo}–${hi}y window (target ${target}y)`;
    } else {
      const overshoot = yearsOut < lo ? lo - yearsOut : yearsOut - hi;
      score = Math.max(0, 50 - overshoot * 25);
      why = `Estimated ${yearsOut}y to pro availability is outside the ${lo}–${hi}y window by ${overshoot}y`;
    }
    raws.set("timeline", {
      inputValue: `${yearsOut}y (${prospect.classYear})`,
      desiredValue: `${lo}–${hi}y, target ${target}y`,
      rawScore: score,
      explanation: why,
    });
  }

  /* -- 6. NHL readiness -- */
  {
    const yearsOut = CLASS_TO_YEARS[prospect.classYear];
    if (!need.nhlRosterNeed) {
      raws.set("nhl_readiness", {
        inputValue: `${yearsOut}y out`,
        desiredValue: "no immediate NHL need",
        rawScore: 70,
        explanation: "Need does not require an NHL-ready player; neutral credit",
      });
    } else {
      const base = Math.max(10, 100 - yearsOut * 28);
      const positiveTrend = ["breakout_season", "rapidly_ascending", "steady_progression"].includes(
        prospect.latestTrendClassification ?? "",
      );
      raws.set("nhl_readiness", {
        inputValue: `${yearsOut}y out, trend ${prospect.latestTrendClassification ?? "unknown"}`,
        desiredValue: "NHL-ready as soon as possible",
        rawScore: Math.min(100, base + (positiveTrend ? 10 : 0)),
        explanation: `Need flags an NHL roster hole: ${yearsOut}y to availability${positiveTrend ? "; positive trend adds credit" : ""}`,
      });
    }
  }

  /* -- 7. AHL opportunity -- */
  {
    if (!need.ahlOpportunity) {
      raws.set("ahl_opportunity", {
        inputValue: `${depth.minorLeagueAtPosition} minor-league player(s) at position`,
        desiredValue: "AHL runway not required",
        rawScore: 70,
        explanation: "Need does not require AHL development runway; neutral credit",
      });
    } else {
      const n = depth.minorLeagueAtPosition;
      raws.set("ahl_opportunity", {
        inputValue: `${n} minor-league player(s) at position`,
        desiredValue: "open AHL development runway",
        rawScore: n <= 2 ? 90 : n <= 4 ? 70 : 45,
        explanation: `${n} org player(s) currently in the minors at ${need.position} — ${n <= 2 ? "clear" : n <= 4 ? "moderate" : "crowded"} AHL runway`,
      });
    }
  }

  /* -- 8. Current roster depth -- */
  {
    const n = depth.contractsAtPosition;
    raws.set("roster_depth", {
      inputValue: `${n} active contract(s)`,
      desiredValue: "thin current depth",
      rawScore: n <= 2 ? 95 : n <= 4 ? 75 : n <= 6 ? 55 : 35,
      explanation: `${n} active NHL contract(s) at ${need.position} — ${n <= 2 ? "thin" : n <= 4 ? "moderate" : "deep"} current depth`,
    });
  }

  /* -- 9. Future contract expirations -- */
  {
    const n = depth.expiringWithinWindow;
    raws.set("contract_expiry", {
      inputValue: `${n} expiring within ${need.latestArrivalYears}y`,
      desiredValue: "openings by arrival",
      rawScore: n >= 3 ? 95 : n === 2 ? 80 : n === 1 ? 60 : 35,
      explanation: `${n} contract(s) at ${need.position} expire within the ${need.latestArrivalYears}-season arrival window`,
    });
  }

  /* -- 10. Prospect-pool scarcity -- */
  {
    const n = need.targetRoleKey || need.targetScoutRoleKey ? depth.prospectsAtTargetRole : depth.prospectsAtPosition;
    const what = need.targetRoleKey || need.targetScoutRoleKey ? "pool prospects at the target role" : "pool prospects at the position";
    raws.set("pool_scarcity", {
      inputValue: `${n} ${what}`,
      desiredValue: "scarce in current pool",
      rawScore: n === 0 ? 95 : n <= 2 ? 75 : n <= 5 ? 55 : 35,
      explanation: `${n} ${what} already in the organization's pool — ${n === 0 ? "true scarcity" : n <= 2 ? "limited coverage" : "reasonable coverage"}`,
    });
  }

  /* -- 11. Special teams -- */
  {
    const req = need.specialTeamsRequirement;
    if (!req || req === "none") {
      raws.set("special_teams", {
        inputValue: "n/a",
        desiredValue: "none",
        rawScore: 70,
        explanation: "No special-teams requirement; neutral credit",
      });
    } else if (req === "pp") {
      if (prospect.ppShare === null) {
        raws.set("special_teams", {
          inputValue: "PP share unknown",
          desiredValue: "power-play contributor",
          rawScore: null,
          missingInputs: ["pp_share"],
          explanation: "Power-play share unavailable — excluded, confidence reduced",
        });
        warnings.push("Power-play data missing for special-teams requirement");
      } else {
        const s = prospect.ppShare;
        raws.set("special_teams", {
          inputValue: `${(s * 100).toFixed(0)}% of points on the PP`,
          desiredValue: "power-play contributor",
          rawScore: s >= 0.4 ? 90 : s >= 0.25 ? 70 : s > 0 ? 50 : 35,
          explanation: `${(s * 100).toFixed(0)}% of latest-season points came on the power play`,
        });
      }
    } else {
      // pk — only SH scoring is observable in NCAA data; a proxy, flagged as such.
      if (prospect.shGoals === null) {
        raws.set("special_teams", {
          inputValue: "SH data unknown",
          desiredValue: "penalty-kill contributor",
          rawScore: null,
          missingInputs: ["sh_goals"],
          explanation: "Short-handed data unavailable — excluded, confidence reduced",
        });
        warnings.push("Penalty-kill data missing for special-teams requirement");
      } else {
        raws.set("special_teams", {
          inputValue: `${prospect.shGoals} SH goal(s)`,
          desiredValue: "penalty-kill contributor",
          rawScore: prospect.shGoals > 0 ? 80 : 45,
          explanation: `PK usage is not tracked in NCAA data; short-handed scoring (${prospect.shGoals}) is a weak proxy`,
        });
        warnings.push("PK fit uses short-handed scoring as a proxy — no usage data exists");
      }
    }
  }

  /* -- 12. Scout grades vs minimums -- */
  {
    const mins = Object.entries(need.minGrades);
    if (mins.length === 0) {
      raws.set("scout_grades", {
        inputValue: prospect.reportGrades ? "report on file" : "no report",
        desiredValue: "no grade minimums",
        rawScore: 70,
        explanation: "Need sets no minimum grades; neutral credit",
      });
    } else if (prospect.reportGrades === null) {
      raws.set("scout_grades", {
        inputValue: "no scouting report",
        desiredValue: mins.map(([k, v]) => `${k}≥${v}`).join(", "),
        rawScore: null,
        missingInputs: ["scouting_report_grades"],
        explanation: "No scouting-report grades on file — excluded, confidence reduced (not scored low)",
      });
      warnings.push("No scouting report to evaluate grade minimums; file a report");
    } else {
      const shortfalls: string[] = [];
      const unknown: string[] = [];
      for (const [key, min] of mins) {
        const grade = prospect.reportGrades[key];
        if (grade === undefined) unknown.push(key);
        else if (grade < min) shortfalls.push(`${key} ${grade} < ${min}`);
      }
      const score = Math.max(10, 100 - shortfalls.length * 20 - unknown.length * 5);
      raws.set("scout_grades", {
        inputValue:
          mins.map(([k]) => `${k}=${prospect.reportGrades![k] ?? "?"}`).join(", "),
        desiredValue: mins.map(([k, v]) => `${k}≥${v}`).join(", "),
        rawScore: shortfalls.length === 0 && unknown.length === 0 ? 100 : score,
        penalty: 0,
        missingInputs: unknown.map((k) => `grade:${k}`),
        explanation:
          shortfalls.length === 0 && unknown.length === 0
            ? "All grade minimums met on the latest report"
            : [
                shortfalls.length > 0 ? `Below minimum: ${shortfalls.join("; ")}` : null,
                unknown.length > 0 ? `Ungraded sections: ${unknown.join(", ")}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
      });
      if (unknown.length > 0) warnings.push(`Report is missing grades for: ${unknown.join(", ")}`);
    }
  }

  /* -- 13. Risk vs tolerance -- */
  {
    const trendR = trendRisk(prospect.latestTrendClassification);
    // A scout's explicit risk call outranks the trend heuristic when present.
    const level = prospect.reportRisk ?? trendR.level;
    const source = prospect.reportRisk ? "scout-report risk" : trendR.why;
    const tolerance = RISK_RANK[need.maxRiskTolerance] ?? 1;
    const rank = RISK_RANK[level] ?? 1;
    raws.set("risk", {
      inputValue: level,
      desiredValue: `≤ ${need.maxRiskTolerance}`,
      rawScore: rank <= tolerance ? 100 : rank - tolerance === 1 ? 45 : 10,
      explanation: `Prospect risk ${level} (${source}); need tolerates up to ${need.maxRiskTolerance}`,
    });
    if (prospect.gamesPlayedLatest < 10) {
      warnings.push(`Latest season sample is only ${prospect.gamesPlayedLatest} games`);
    }
  }

  /* -- 14. Acquisition method -- */
  {
    const method = need.preferredAcquisition;
    const drafted = prospect.nhlDraftStatus === "drafted";
    let score: number;
    let why: string;
    if (method === "any") {
      score = 100;
      why = "Need accepts any acquisition path";
    } else if (method === "draft") {
      score = drafted ? 15 : 100;
      why = drafted
        ? `Already drafted${prospect.nhlRightsHolder ? ` (rights: ${prospect.nhlRightsHolder})` : ""} — not draft-acquirable`
        : "Undrafted and draft-acquirable";
    } else if (method === "college_fa") {
      score =
        prospect.collegeFreeAgentStatus === "eligible"
          ? 100
          : prospect.collegeFreeAgentStatus === "watch"
            ? 60
            : 25;
      why = `College free-agent status is "${prospect.collegeFreeAgentStatus}"`;
    } else {
      // trade: only drafted prospects whose rights another club holds are trade targets.
      score = drafted && prospect.nhlRightsHolder ? 80 : 30;
      why =
        drafted && prospect.nhlRightsHolder
          ? `Rights held by ${prospect.nhlRightsHolder} — acquirable via trade`
          : "No held rights to trade for";
    }
    raws.set("acquisition", {
      inputValue: drafted ? `drafted (${prospect.nhlRightsHolder ?? "rights held"})` : `undrafted, CFA ${prospect.collegeFreeAgentStatus}`,
      desiredValue: method,
      rawScore: score,
      explanation: why,
    });
  }

  /* -- Assemble: weights, contributions, overall, confidence -- */
  const components: FitComponent[] = FIT_COMPONENT_KEYS.map((key) => {
    const raw = raws.get(key)!;
    const weight = weights[key] ?? DEFAULT_FIT_WEIGHTS[key];
    const penalty = raw.penalty ?? 0;
    const finalScore = raw.rawScore === null ? null : Math.max(0, Math.min(100, raw.rawScore - penalty));
    return {
      key,
      label: FIT_COMPONENT_LABELS[key],
      inputValue: raw.inputValue,
      desiredValue: raw.desiredValue,
      rawScore: raw.rawScore,
      weight,
      weightedContribution: finalScore === null ? null : Number((finalScore * weight).toFixed(2)),
      penalty,
      finalScore,
      missingInputs: raw.missingInputs ?? [],
      explanation: raw.explanation,
    };
  });

  let sum = 0;
  let covered = 0;
  let total = 0;
  for (const c of components) {
    total += c.weight;
    if (c.finalScore === null) continue;
    sum += c.finalScore * c.weight;
    covered += c.weight;
  }
  const overall = covered > 0 ? Number((sum / covered).toFixed(1)) : null;
  // Confidence: share of model weight actually computable, minus a small
  // deduction per warning (capped) — missing data lowers confidence, not score.
  const coverage = total > 0 ? covered / total : 0;
  const confidence =
    overall === null ? null : Number(Math.max(0.1, coverage - Math.min(0.3, warnings.length * 0.05)).toFixed(2));
  if (coverage < 0.9) warnings.push("Overall fit computed from partial components; treat with caution");

  return {
    overall,
    confidence,
    components,
    warnings,
    modelVersion: FIT_MODEL_VERSION,
    computedAt: new Date().toISOString(),
  };
}
