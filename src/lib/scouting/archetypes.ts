/**
 * Role archetype catalog and default metric weights (model riq-role-v0.1).
 * This file is the SEED source; at runtime the engine reads archetypes and
 * weights from the database (role_archetypes / role_metric_weights) so
 * organizations can tune them without code changes.
 *
 * Metric keys refer to position-relative percentiles computed by
 * percentiles.ts. Weights are transparent heuristics for the demonstration
 * dataset — not validated models (see docs/MODELS.md).
 */

export const ROLE_MODEL_VERSION = "riq-role-v0.1";
export const TREND_MODEL_VERSION = "riq-trend-v0.1";
export const FIT_MODEL_VERSION = "riq-fit-v0.2";

export interface ArchetypeSeed {
  key: string;
  label: string;
  positionGroup: "F" | "D" | "G";
  description: string;
  /** metric percentile key → weight (weights need not sum to 1; normalized). */
  weights: Record<string, number>;
}

/**
 * Percentile metric keys available to weights:
 *  ppg, goalsPerGame, assistsPerGame, shotsPerGame, shootingPct,
 *  ppShare (PP points / points), faceoffPct, pimPerGame (inverted),
 *  ageAdjustedPpg, teamRelativePpg
 */
export const ARCHETYPE_SEEDS: ArchetypeSeed[] = [
  // Forwards
  { key: "play_driving_center", label: "Play-driving center", positionGroup: "F", description: "Drives possession and scoring through the middle of the ice.", weights: { ppg: 0.3, assistsPerGame: 0.25, shotsPerGame: 0.15, teamRelativePpg: 0.2, faceoffPct: 0.1 } },
  { key: "two_way_center", label: "Two-way center", positionGroup: "F", description: "Trusted in all situations; balanced production and defensive detail.", weights: { ppg: 0.2, faceoffPct: 0.3, teamRelativePpg: 0.2, pimDiscipline: 0.15, assistsPerGame: 0.15 } },
  { key: "defensive_center", label: "Defensive center", positionGroup: "F", description: "Matchup center; faceoffs and defensive-zone reliability over scoring.", weights: { faceoffPct: 0.45, pimDiscipline: 0.25, teamRelativePpg: 0.15, ppg: 0.15 } },
  { key: "transition_center", label: "Transition center", positionGroup: "F", description: "Moves the puck up ice; assists and pace over finishing.", weights: { assistsPerGame: 0.4, ppg: 0.2, shotsPerGame: 0.2, ageAdjustedPpg: 0.2 } },
  { key: "offensive_zone_creator", label: "Offensive-zone creator", positionGroup: "F", description: "Creates chances off sustained zone time.", weights: { assistsPerGame: 0.35, ppg: 0.3, ppShare: 0.15, shotsPerGame: 0.2 } },
  { key: "rush_attacker", label: "Rush attacker", positionGroup: "F", description: "Generates offense off the rush; shot volume and speed.", weights: { shotsPerGame: 0.35, goalsPerGame: 0.3, ageAdjustedPpg: 0.2, ppg: 0.15 } },
  { key: "playmaking_winger", label: "Playmaking winger", positionGroup: "F", description: "Distributes from the wing; assist-tilted production.", weights: { assistsPerGame: 0.45, ppg: 0.25, ppShare: 0.15, teamRelativePpg: 0.15 } },
  { key: "shooting_winger", label: "Shooting winger", positionGroup: "F", description: "Volume shooter and finisher from the wing.", weights: { goalsPerGame: 0.35, shotsPerGame: 0.3, shootingPct: 0.2, ppg: 0.15 } },
  { key: "net_front_finisher", label: "Net-front finisher", positionGroup: "F", description: "Converts at the crease; efficiency over volume.", weights: { shootingPct: 0.4, goalsPerGame: 0.35, ppShare: 0.15, ppg: 0.1 } },
  { key: "power_forward", label: "Power forward", positionGroup: "F", description: "Size, physical play, and interior scoring.", weights: { goalsPerGame: 0.3, physicality: 0.3, shotsPerGame: 0.2, ppg: 0.2 } },
  { key: "forechecking_winger", label: "Forechecking winger", positionGroup: "F", description: "Pressure on retrievals; energy role with secondary scoring.", weights: { physicality: 0.35, shotsPerGame: 0.25, pimDiscipline: 0.15, ppg: 0.25 } },
  { key: "puck_retrieval_winger", label: "Puck-retrieval winger", positionGroup: "F", description: "Wins pucks back and extends possessions.", weights: { physicality: 0.3, assistsPerGame: 0.25, teamRelativePpg: 0.25, ppg: 0.2 } },
  { key: "bottom_six_checker", label: "Bottom-six checking forward", positionGroup: "F", description: "Reliable depth checker; discipline and defensive detail.", weights: { pimDiscipline: 0.35, faceoffPct: 0.2, physicality: 0.25, ppg: 0.2 } },
  { key: "pk_specialist_forward", label: "Penalty-kill specialist", positionGroup: "F", description: "Short-handed usage profile; defensive-first forward.", weights: { shGoals: 0.35, pimDiscipline: 0.25, faceoffPct: 0.2, teamRelativePpg: 0.2 } },
  { key: "pp_half_wall", label: "Power-play half-wall", positionGroup: "F", description: "Runs the power play from the flank.", weights: { ppShare: 0.45, assistsPerGame: 0.3, ppg: 0.25 } },
  { key: "pp_bumper", label: "Power-play bumper", positionGroup: "F", description: "Middle-ice PP release option.", weights: { ppShare: 0.35, shootingPct: 0.3, goalsPerGame: 0.35 } },
  { key: "net_front_pp", label: "Net-front power-play player", positionGroup: "F", description: "Screens and rebounds on the power play.", weights: { ppShare: 0.4, shootingPct: 0.3, physicality: 0.3 } },
  // Defensemen
  { key: "puck_moving_d", label: "Puck-moving defenseman", positionGroup: "D", description: "First-pass and breakout value; assist-driven.", weights: { assistsPerGame: 0.4, ppg: 0.25, teamRelativePpg: 0.2, ageAdjustedPpg: 0.15 } },
  { key: "transition_d", label: "Transition defenseman", positionGroup: "D", description: "Skates and passes the team out of trouble.", weights: { assistsPerGame: 0.35, ppg: 0.25, shotsPerGame: 0.2, ageAdjustedPpg: 0.2 } },
  { key: "offensive_d", label: "Offensive defenseman", positionGroup: "D", description: "Four-man rush threat; produces at even strength and PP.", weights: { ppg: 0.35, shotsPerGame: 0.25, ppShare: 0.2, goalsPerGame: 0.2 } },
  { key: "pp_quarterback", label: "Power-play quarterback", positionGroup: "D", description: "Runs the top unit from the blue line.", weights: { ppShare: 0.45, assistsPerGame: 0.3, ppg: 0.25 } },
  { key: "two_way_d", label: "Two-way defenseman", positionGroup: "D", description: "Plays both sides of the puck at even strength.", weights: { ppg: 0.25, teamRelativePpg: 0.25, pimDiscipline: 0.25, assistsPerGame: 0.25 } },
  { key: "shutdown_d", label: "Shutdown defenseman", positionGroup: "D", description: "Defensive matchup profile; low event, high discipline.", weights: { pimDiscipline: 0.4, physicality: 0.3, teamRelativePpg: 0.3 } },
  { key: "rush_defender", label: "Rush defender", positionGroup: "D", description: "Kills entries with gap and skating.", weights: { pimDiscipline: 0.35, teamRelativePpg: 0.3, assistsPerGame: 0.35 } },
  { key: "retrieval_breakout_d", label: "Retrieval and breakout defenseman", positionGroup: "D", description: "First on pucks; clean exits.", weights: { assistsPerGame: 0.35, pimDiscipline: 0.3, teamRelativePpg: 0.35 } },
  { key: "physical_defensive_d", label: "Physical defensive defenseman", positionGroup: "D", description: "Hard to play against; physical interior defense.", weights: { physicality: 0.45, pimDiscipline: 0.2, teamRelativePpg: 0.35 } },
  { key: "pk_d", label: "Penalty-kill defenseman", positionGroup: "D", description: "Short-handed minutes eater.", weights: { pimDiscipline: 0.35, shGoals: 0.25, physicality: 0.4 } },
  { key: "third_pair_specialist", label: "Third-pair specialist", positionGroup: "D", description: "Sheltered depth role with a defined specialty.", weights: { pimDiscipline: 0.3, ppg: 0.3, physicality: 0.4 } },
  // Goalies (statistical inference is weak without save data — low confidence by design)
  { key: "projected_pro_starter", label: "Projected professional starter", positionGroup: "G", description: "Workload and results profile of a future pro starter.", weights: { gamesShare: 0.6, teamRelativePpg: 0.4 } },
  { key: "tandem_goalie", label: "Tandem goaltender", positionGroup: "G", description: "Splits starts effectively.", weights: { gamesShare: 0.7, teamRelativePpg: 0.3 } },
  { key: "developmental_goalie", label: "Developmental goaltender", positionGroup: "G", description: "Tools over results; needs reps.", weights: { gamesShare: 0.5, ageAdjustedPpg: 0.5 } },
  { key: "athletic_reaction_goalie", label: "Athletic reaction goaltender", positionGroup: "G", description: "Athleticism-first profile (scout-input dependent).", weights: { gamesShare: 1 } },
  { key: "technical_positional_goalie", label: "Technical positional goaltender", positionGroup: "G", description: "Structure-first profile (scout-input dependent).", weights: { gamesShare: 1 } },
  { key: "puck_handling_goalie", label: "Puck-handling goaltender", positionGroup: "G", description: "Third-defenseman puck skills (scout-input dependent).", weights: { assistsPerGame: 0.6, gamesShare: 0.4 } },
];

/** Metric keys the percentile engine can produce (used for validation). */
export const PERCENTILE_METRICS = [
  "ppg",
  "goalsPerGame",
  "assistsPerGame",
  "shotsPerGame",
  "shootingPct",
  "ppShare",
  "faceoffPct",
  "pimDiscipline",
  "physicality",
  "shGoals",
  "ageAdjustedPpg",
  "teamRelativePpg",
  "gamesShare",
] as const;

export type PercentileMetric = (typeof PERCENTILE_METRICS)[number];
