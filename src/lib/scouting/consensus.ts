/**
 * Scout-consensus math (pure). Disagreement is a first-class output —
 * the mean is never presented without the spread behind it.
 */

export const MIN_CONSENSUS_SUBMISSIONS = 3;

export interface ConsensusResult {
  submissions: number;
  meanRank: number;
  medianRank: number;
  bestRank: number;
  worstRank: number;
  /** worstRank − bestRank: the visible disagreement window. */
  spread: number;
  /** Population standard deviation of the submitted ranks. */
  stddev: number;
  /** True when submissions < MIN_CONSENSUS_SUBMISSIONS. */
  insufficient: boolean;
  warnings: string[];
}

export function computeConsensus(ranks: number[]): ConsensusResult | null {
  if (ranks.length === 0) return null;
  const sorted = [...ranks].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, r) => s + r, 0) / n;
  const median = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const best = sorted[0]!;
  const worst = sorted[n - 1]!;
  const variance = sorted.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const insufficient = n < MIN_CONSENSUS_SUBMISSIONS;
  const warnings: string[] = [];
  if (insufficient) {
    warnings.push(`Only ${n} scout ranking${n === 1 ? "" : "s"} submitted (minimum ${MIN_CONSENSUS_SUBMISSIONS} for a stable consensus)`);
  }
  if (worst - best >= 10) {
    warnings.push(`Scouts disagree by ${worst - best} spots (best ${best}, worst ${worst}) — review before relying on the mean`);
  }
  return {
    submissions: n,
    meanRank: Number(mean.toFixed(2)),
    medianRank: Number(median.toFixed(1)),
    bestRank: best,
    worstRank: worst,
    spread: worst - best,
    stddev: Number(Math.sqrt(variance).toFixed(2)),
    insufficient,
    warnings,
  };
}
