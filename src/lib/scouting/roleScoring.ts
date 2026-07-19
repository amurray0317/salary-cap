/**
 * Transparent role-scoring engine (model riq-role-v0.1).
 *
 * Inputs are position-relative percentiles; weights come from the database
 * (role_metric_weights) — never from components. Every score returns a full
 * explanation: inputs, weights, contributions, missing inputs, confidence.
 * Statistically inferred roles are advisory and always displayed alongside
 * (never instead of) scout-assigned roles.
 */
import type { PercentileMetric } from "./archetypes";
import type { PercentileSet } from "./stats";

export interface WeightRow {
  archetypeKey: string;
  archetypeLabel: string;
  positionGroup: "F" | "D" | "G";
  metric: string;
  weight: number;
  modelVersion: string;
}

export interface RoleContribution {
  metric: string;
  percentile: number | null;
  weight: number;
  contribution: number | null; // percentile × normalized weight
  missing: boolean;
}

export interface RoleScore {
  archetypeKey: string;
  archetypeLabel: string;
  positionGroup: "F" | "D" | "G";
  score: number | null; // 0..100; null when nothing computable
  confidence: number; // 0..1 — share of weight backed by real data × pool factor
  contributions: RoleContribution[];
  missingInputs: string[];
  contradictions: string[];
  modelVersion: string;
  poolSize: number;
}

/**
 * Scores one archetype. Weights are normalized over the metrics present in
 * the weight set; metrics with missing percentiles contribute nothing and
 * reduce confidence rather than being silently imputed.
 */
export function scoreArchetype(
  weights: WeightRow[],
  percentiles: PercentileSet,
): RoleScore | null {
  const first = weights[0];
  if (!first) return null;
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
  if (totalWeight <= 0) return null;

  const contributions: RoleContribution[] = [];
  const missingInputs: string[] = [];
  const contradictions: string[] = [];
  let weightedSum = 0;
  let coveredWeight = 0;

  for (const w of weights) {
    const pct = percentiles.percentiles[w.metric as PercentileMetric] ?? null;
    const norm = w.weight / totalWeight;
    if (pct === null) {
      contributions.push({ metric: w.metric, percentile: null, weight: norm, contribution: null, missing: true });
      missingInputs.push(w.metric);
      continue;
    }
    const contribution = pct * norm;
    weightedSum += contribution;
    coveredWeight += norm;
    contributions.push({ metric: w.metric, percentile: pct, weight: norm, contribution: Number(contribution.toFixed(1)), missing: false });
    if (norm >= 0.25 && pct <= 25) {
      contradictions.push(`${w.metric} sits in the ${pct}th percentile despite being a core metric for this role`);
    }
  }

  if (coveredWeight === 0) {
    return {
      archetypeKey: first.archetypeKey,
      archetypeLabel: first.archetypeLabel,
      positionGroup: first.positionGroup,
      score: null,
      confidence: 0,
      contributions,
      missingInputs,
      contradictions,
      modelVersion: first.modelVersion,
      poolSize: percentiles.poolSize,
    };
  }

  // Rescale by covered weight so missing metrics don't drag the score to 0,
  // then discount confidence for the coverage gap and small peer pools.
  const score = weightedSum / coveredWeight;
  const poolFactor = percentiles.poolSize >= 40 ? 1 : percentiles.poolSize >= 15 ? 0.8 : 0.5;
  const confidence = Number((coveredWeight * poolFactor).toFixed(2));

  return {
    archetypeKey: first.archetypeKey,
    archetypeLabel: first.archetypeLabel,
    positionGroup: first.positionGroup,
    score: Number(score.toFixed(1)),
    confidence: Math.min(confidence, 0.9), // statistical inference is never fully certain
    contributions,
    missingInputs,
    contradictions,
    modelVersion: first.modelVersion,
    poolSize: percentiles.poolSize,
  };
}

/**
 * Scores every archetype for the prospect's position group and returns them
 * ranked. Primary/secondary inferred roles are the top two by score.
 */
export function scoreAllArchetypes(
  positionGroup: "F" | "D" | "G",
  allWeights: WeightRow[],
  percentiles: PercentileSet,
): RoleScore[] {
  const byArchetype = new Map<string, WeightRow[]>();
  for (const w of allWeights) {
    if (w.positionGroup !== positionGroup) continue;
    const list = byArchetype.get(w.archetypeKey) ?? [];
    list.push(w);
    byArchetype.set(w.archetypeKey, list);
  }
  const scores: RoleScore[] = [];
  for (const rows of byArchetype.values()) {
    const s = scoreArchetype(rows, percentiles);
    if (s) scores.push(s);
  }
  return scores.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
