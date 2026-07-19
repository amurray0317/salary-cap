/**
 * Organizational-fit engine (model riq-fit-v0.1).
 *
 * Explainable, component-based fit between one organizational need and one
 * prospect. Opportunity-path input connects to RosterIQ's existing contract
 * data: depth = players under active contract at the needed position and the
 * count expiring within the need's timeline. Pure function — the service
 * assembles the context.
 */
import { FIT_MODEL_VERSION } from "./archetypes";
import type { RoleScore } from "./roleScoring";

export interface NeedInput {
  position: string; // C | LW | RW | D | G | F (any forward)
  handedness: string | null; // L | R | null = any
  targetRoleKey: string | null;
  priority: number;
  timelineYears: number;
  maxRiskTolerance: string; // low | medium | high
}

export interface ProspectFitInput {
  position: string;
  positionGroup: "F" | "D" | "G";
  shootsCatches: string | null;
  classYear: "freshman" | "sophomore" | "junior" | "senior" | "graduate";
  age: number | null;
  primaryInferredRole: RoleScore | null;
  scoutAssignedRoleKey: string | null;
  roleScores: RoleScore[];
  latestTrendClassification: string | null;
  gamesPlayedLatest: number;
}

export interface DepthContext {
  /** Active contracts at the needed position across the org's pro teams. */
  contractsAtPosition: number;
  /** Of those, how many expire within the need's timeline. */
  expiringWithinTimeline: number;
}

export interface FitComponent {
  key: string;
  label: string;
  score: number | null; // 0..100
  weight: number;
  explanation: string;
}

export interface FitResult {
  overall: number | null;
  components: FitComponent[];
  warnings: string[];
  modelVersion: string;
}

/** Years until estimated pro availability by class year. */
const CLASS_TO_YEARS: Record<ProspectFitInput["classYear"], number> = {
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

export function calculateFit(need: NeedInput, prospect: ProspectFitInput, depth: DepthContext): FitResult {
  const components: FitComponent[] = [];
  const warnings: string[] = [];

  // Position fit
  const positionMatches =
    need.position === prospect.position ||
    (need.position === "F" && prospect.positionGroup === "F");
  components.push({
    key: "position",
    label: "Position fit",
    score: positionMatches ? 100 : prospect.positionGroup === (need.position === "D" ? "D" : need.position === "G" ? "G" : "F") ? 60 : 0,
    weight: 0.2,
    explanation: positionMatches
      ? `Plays the needed position (${prospect.position})`
      : `Plays ${prospect.position}; need is ${need.position}`,
  });

  // Handedness fit
  if (need.handedness === null) {
    components.push({ key: "handedness", label: "Handedness fit", score: 100, weight: 0.1, explanation: "Need accepts either handedness" });
  } else if (prospect.shootsCatches === null) {
    components.push({ key: "handedness", label: "Handedness fit", score: null, weight: 0.1, explanation: "Prospect handedness unknown" });
    warnings.push("Handedness missing on the prospect record");
  } else {
    const match = prospect.shootsCatches === need.handedness;
    components.push({
      key: "handedness",
      label: "Handedness fit",
      score: match ? 100 : 20,
      weight: 0.1,
      explanation: match ? `Matches required ${need.handedness} hand` : `Shoots ${prospect.shootsCatches}; need requires ${need.handedness}`,
    });
  }

  // Role fit: best of scout-assigned match (authoritative) or inferred score.
  let roleScore: number | null = null;
  let roleWhy = "No target role on the need";
  if (need.targetRoleKey === null) {
    roleScore = 70;
    roleWhy = "Need has no target role; neutral credit";
  } else if (prospect.scoutAssignedRoleKey === need.targetRoleKey) {
    roleScore = 100;
    roleWhy = "Scout-assigned role matches the target role";
  } else {
    const inferred = prospect.roleScores.find((r) => r.archetypeKey === need.targetRoleKey);
    if (inferred?.score != null) {
      roleScore = inferred.score;
      roleWhy = `Statistically inferred score for the target role is ${inferred.score} (confidence ${(inferred.confidence * 100).toFixed(0)}%)`;
      if (inferred.confidence < 0.5) warnings.push("Role-fit input has low model confidence");
    } else {
      roleWhy = "No role score available for the target role";
      warnings.push("Target-role score missing; role fit not computable");
    }
  }
  components.push({ key: "role", label: "Role fit", score: roleScore, weight: 0.25, explanation: roleWhy });

  // Timeline fit
  const yearsOut = CLASS_TO_YEARS[prospect.classYear];
  const timelineDiff = Math.abs(yearsOut - need.timelineYears);
  components.push({
    key: "timeline",
    label: "Timeline fit",
    score: Math.max(0, 100 - timelineDiff * 30),
    weight: 0.15,
    explanation: `Estimated ${yearsOut} year(s) to pro availability (${prospect.classYear}) vs. need timeline of ${need.timelineYears} year(s)`,
  });

  // Opportunity path from real contract data
  const opportunity =
    depth.contractsAtPosition <= 2
      ? 90
      : depth.contractsAtPosition <= 4
        ? 70
        : depth.expiringWithinTimeline >= 2
          ? 65
          : depth.expiringWithinTimeline >= 1
            ? 50
            : 30;
  components.push({
    key: "opportunity",
    label: "Opportunity-path fit",
    score: opportunity,
    weight: 0.15,
    explanation: `${depth.contractsAtPosition} active contract(s) at ${need.position}; ${depth.expiringWithinTimeline} expiring within ${need.timelineYears} season(s)`,
  });

  // Risk fit vs tolerance
  const risk = trendRisk(prospect.latestTrendClassification);
  const tolerance = RISK_RANK[need.maxRiskTolerance] ?? 1;
  const riskRank = RISK_RANK[risk.level] ?? 1;
  components.push({
    key: "risk",
    label: "Risk fit",
    score: riskRank <= tolerance ? 100 : riskRank - tolerance === 1 ? 45 : 10,
    weight: 0.15,
    explanation: `Prospect risk ${risk.level} (${risk.why}); need tolerates up to ${need.maxRiskTolerance}`,
  });
  if (prospect.gamesPlayedLatest < 10) {
    warnings.push(`Latest season sample is only ${prospect.gamesPlayedLatest} games`);
  }

  // Weighted overall over computable components.
  let sum = 0;
  let covered = 0;
  for (const c of components) {
    if (c.score === null) continue;
    sum += c.score * c.weight;
    covered += c.weight;
  }
  const overall = covered > 0 ? Number((sum / covered).toFixed(1)) : null;
  if (covered < 0.9) warnings.push("Overall fit computed from partial components; treat with caution");

  return { overall, components, warnings, modelVersion: FIT_MODEL_VERSION };
}
