/**
 * Display names for the RosterIQ model explanation groups. Keys mirror
 * analytics/rosteriq_models/xg/features.py (GROUPS) and
 * analytics/rosteriq_models/prospects/model.py (GROUPS_STATS).
 */
import { PROSPECT_GROUPS, XG_GROUPS } from "@/lib/import/connectorDefinitions";

export const XG_GROUP_LABELS: Record<(typeof XG_GROUPS)[number], string> = {
  distance: "Distance",
  angle: "Angle",
  shot_type: "Shot type",
  rebound: "Rebound",
  rush: "Rush",
  prev_event: "Play before the shot",
  strength: "Strength state",
  score: "Score state",
  off_wing: "Off-wing",
  position: "Shooter position",
  period: "Period",
  venue: "Home/away",
};

export const PROSPECT_GROUP_LABELS: Record<(typeof PROSPECT_GROUPS)[number], string> = {
  d0_scoring: "Draft-year scoring (NHLe)",
  dm1_scoring: "Scoring the year before",
  age: "Age at draft",
  size: "Size",
  position: "Position",
  league: "Draft-year league",
  games: "Games played",
};

/** The `n` largest contributions by absolute size, largest first. */
export function topReasons<K extends string>(
  values: Partial<Record<K, number>>,
  labels: Record<K, string>,
  n = 3,
): Array<{ key: K; label: string; value: number }> {
  return (Object.entries(values) as Array<[K, number]>)
    .filter(([k, v]) => k in labels && Number.isFinite(v))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, n)
    .map(([key, value]) => ({ key, label: labels[key], value }));
}

export const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
