/**
 * RosterIQ valuation models, version 0.1.
 *
 * These are TRANSPARENT, deterministic, rules-based estimators intended for
 * demonstration and workflow validation. They are NOT scientifically
 * validated pricing models, and every output must be presented as an
 * estimate with model version, confidence, and assumptions attached
 * (see docs/MODELS.md for governance).
 */

export const PERFORMANCE_MODEL_VERSION = "riq-perf-v0.1";
export const MARKET_MODEL_VERSION = "riq-market-v0.1";

export const MODEL_DISCLAIMER =
  "Model-generated estimate for planning purposes only. Not an official figure, not a prediction of any actual negotiation outcome.";

export interface PerformanceInputs {
  projectedGar: number;
  projectedAvailability: number; // 0..1 expected share of season available
  position: string;
  age: number | null;
  leagueMinSalary: number;
  /** League-wide estimated market price of one goal above replacement. */
  dollarsPerGar: number;
}

export interface PerformanceValueResult {
  modelVersion: string;
  performanceValue: number;
  components: Array<{ label: string; amount: number; formula: string }>;
  assumptions: string[];
}

/**
 * Performance value = replacement cost (league minimum) + market price of
 * projected goals above replacement, discounted by projected availability,
 * with a mild positional scarcity adjustment.
 */
export function estimatePerformanceValue(inp: PerformanceInputs): PerformanceValueResult {
  const positionFactor = inp.position === "G" ? 0.9 : inp.position === "D" ? 1.05 : 1.0;
  const garValue = Math.round(
    inp.projectedGar * inp.dollarsPerGar * inp.projectedAvailability * positionFactor,
  );
  const performanceValue = Math.max(inp.leagueMinSalary, inp.leagueMinSalary + garValue);

  return {
    modelVersion: PERFORMANCE_MODEL_VERSION,
    performanceValue,
    components: [
      {
        label: "Replacement-level cost",
        amount: inp.leagueMinSalary,
        formula: "league minimum salary (a replacement player costs at least this)",
      },
      {
        label: "Value above replacement",
        amount: garValue,
        formula: `projected GAR ${inp.projectedGar.toFixed(1)} × $/GAR $${inp.dollarsPerGar.toLocaleString()} × availability ${(inp.projectedAvailability * 100).toFixed(0)}% × position factor ${positionFactor}`,
      },
    ],
    assumptions: [
      `$/GAR is a league-wide estimate of $${inp.dollarsPerGar.toLocaleString()} derived from seeded demonstration data`,
      "Projected GAR comes from the stored projection row (model version on the projection)",
      "Positional factor: G 0.90, D 1.05, F 1.00 (transparent heuristic, v0.1)",
    ],
  };
}

export interface ComparableRecord {
  id: string;
  playerName: string;
  position: string;
  ageAtSigning: number;
  platformPoints: number;
  aav: number;
  termYears: number;
  signingSeason: string;
}

export interface MarketInputs {
  playerName: string;
  position: string;
  age: number | null;
  platformPoints: number;
  performanceValue: number;
  freeAgentStatus: "under_contract" | "rfa" | "ufa" | "unsigned_prospect";
  comparables: ComparableRecord[];
  /** Annual cap-growth assumption used to inflate older comparables. */
  capInflationPct: number;
  leagueMinSalary: number;
}

export interface MarketValueResult {
  modelVersion: string;
  estimatedAav: number;
  lowEstimate: number;
  highEstimate: number;
  estimatedTermYears: number;
  estimatedTotalValue: number;
  confidence: number; // 0..1
  comparablesUsed: ComparableRecord[];
  assumptions: string[];
  disclaimer: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (sorted.length % 2 === 0 && lo !== undefined && hi !== undefined) {
    return (lo + hi) / 2;
  }
  return sorted[mid] ?? 0;
}

/** Expected contract term by age band (transparent heuristic, v0.1). */
export function estimateTermYears(age: number | null, freeAgentStatus: string): number {
  if (age === null) return 3;
  if (age <= 23) return freeAgentStatus === "rfa" ? 3 : 4;
  if (age <= 26) return 5;
  if (age <= 29) return 4;
  if (age <= 32) return 3;
  if (age <= 34) return 2;
  return 1;
}

/**
 * Market value blends the performance-value estimate with the median AAV of
 * the closest comparables (same position, nearest by age and platform points),
 * inflated to the current season by the cap-growth assumption.
 */
export function estimateMarketValue(inp: MarketInputs): MarketValueResult {
  const assumptions: string[] = [
    `Cap-inflation assumption: ${(inp.capInflationPct * 100).toFixed(1)}% per season`,
    "Comparables restricted to the same position, ranked by |Δage| and |Δplatform points|",
    "Estimate = 50% performance-value component + 50% comparable-market component when comparables exist",
  ];

  const sameCohort = inp.comparables
    .filter((c) => c.position === inp.position)
    .map((c) => ({
      comp: c,
      distance:
        Math.abs((inp.age ?? c.ageAtSigning) - c.ageAtSigning) * 4 +
        Math.abs(inp.platformPoints - c.platformPoints),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((x) => x.comp);

  // Inflate comparable AAVs: assume each comparable signed ~2 seasons ago on
  // average in the seeded pool; a fuller model would use signing-season deltas.
  const inflatedAavs = sameCohort.map((c) => Math.round(c.aav * (1 + inp.capInflationPct) ** 2));
  const compComponent = median(inflatedAavs);

  let estimatedAav: number;
  let confidence: number;
  if (sameCohort.length >= 3) {
    estimatedAav = Math.round(0.5 * inp.performanceValue + 0.5 * compComponent);
    confidence = 0.6 + Math.min(sameCohort.length, 5) * 0.04;
  } else if (sameCohort.length > 0) {
    estimatedAav = Math.round(0.65 * inp.performanceValue + 0.35 * compComponent);
    confidence = 0.5;
    assumptions.push("Fewer than 3 comparables found; estimate leans on the performance component");
  } else {
    estimatedAav = inp.performanceValue;
    confidence = 0.35;
    assumptions.push("No positional comparables found; estimate equals the performance value");
  }

  // RFA discount: restricted players typically sign below open-market price.
  if (inp.freeAgentStatus === "rfa") {
    estimatedAav = Math.round(estimatedAav * 0.85);
    assumptions.push("RFA discount applied: ×0.85 (restricted negotiating leverage, v0.1 heuristic)");
  }

  estimatedAav = Math.max(inp.leagueMinSalary, estimatedAav);

  const spread = 1 - confidence; // wider band when less confident
  const lowEstimate = Math.max(inp.leagueMinSalary, Math.round(estimatedAav * (1 - 0.35 * spread - 0.1)));
  const highEstimate = Math.round(estimatedAav * (1 + 0.35 * spread + 0.1));
  const estimatedTermYears = estimateTermYears(inp.age, inp.freeAgentStatus);

  return {
    modelVersion: MARKET_MODEL_VERSION,
    estimatedAav,
    lowEstimate,
    highEstimate,
    estimatedTermYears,
    estimatedTotalValue: estimatedAav * estimatedTermYears,
    confidence: Math.min(confidence, 0.85),
    comparablesUsed: sameCohort,
    assumptions,
    disclaimer: MODEL_DISCLAIMER,
  };
}

export interface SurplusResult {
  performanceValue: number;
  capHit: number;
  surplusValue: number;
  modelVersion: string;
}

/** Expected Surplus Value = Estimated Performance Value − Actual Cap Cost. */
export function calculateSurplusValue(performanceValue: number, capHit: number): SurplusResult {
  return {
    performanceValue,
    capHit,
    surplusValue: performanceValue - capHit,
    modelVersion: PERFORMANCE_MODEL_VERSION,
  };
}
