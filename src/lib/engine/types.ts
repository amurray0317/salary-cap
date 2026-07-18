/**
 * Cap rules engine — type contracts.
 *
 * The engine is a pure function over plain data. It never touches the
 * database or React; services assemble a CapInput from persisted records and
 * pages render the CapResult.
 */

/** Roster statuses the engine reasons about (subset of DB enum). */
export type EngineRosterStatus =
  | "pro_active"
  | "pro_scratch"
  | "injured_reserve"
  | "ltir"
  | "minor"
  | "juniors"
  | "loaned"
  | "suspended"
  | "unsigned"
  | "non_roster";

/** A versioned regulatory parameter, as loaded from league_rules. */
export interface RuleValue {
  key: string;
  name: string;
  category: string;
  numericValue: number | null;
  textValue: string | null;
  version: number;
  effectiveDate: string;
  sourceName?: string;
}

/** Well-known rule keys the NHL-style engine consumes. */
export const RULE_KEYS = {
  capUpperLimit: "cap.upper_limit",
  capLowerLimit: "cap.lower_limit",
  buriedAllowance: "cap.buried_allowance",
  maxActiveRoster: "roster.max_active",
  minActiveRoster: "roster.min_active",
  minGoalies: "roster.min_goalies",
  maxContractSlots: "contract.max_slots",
  minSalary: "salary.min",
  maxIndividualPct: "salary.max_individual_pct",
} as const;

export type RuleSet = Map<string, RuleValue>;

/** One contract-season as the engine sees it. */
export interface EngineContractSeason {
  contractId: string;
  playerId: string | null;
  playerName: string;
  position: string;
  /** Full cap hit for this season before any retention held by other teams. */
  capHit: number;
  baseSalary: number;
  totalCash: number;
  performanceBonus: number;
  minorLeagueSalary: number | null;
  isTwoWay: boolean;
  /** Fraction (0..1) of this contract retained BY OTHER teams in past trades. */
  retainedByOthersPct: number;
  /** Where the player is slotted for this season. */
  rosterStatus: EngineRosterStatus;
  /** True when this row was proposed inside a scenario, not official data. */
  isHypothetical?: boolean;
}

/** Retained salary / dead cap the team carries for players no longer on it. */
export interface EngineObligation {
  obligationType: "retained" | "buyout" | "termination" | "recapture";
  playerName: string;
  amount: number;
  isHypothetical?: boolean;
}

export interface CapInput {
  season: { id: string; name: string };
  team: { id: string; name: string };
  rules: RuleSet;
  contractSeasons: EngineContractSeason[];
  obligations: EngineObligation[];
  /** Optional LTIR pool established by the team (simplified model). */
  ltirPool?: number;
}

export type ViolationSeverity = "info" | "warning" | "blocking" | "requires_review";

export interface CapViolation {
  severity: ViolationSeverity;
  ruleKey: string;
  ruleName: string;
  message: string;
  affectedPlayer?: string;
  financialImpact?: number;
  recommendedResolution?: string;
  ruleVersion?: number;
  effectiveDate?: string;
}

/** One explainable line of the cap calculation. */
export interface CapLineItem {
  id: string;
  label: string;
  category:
    | "active_roster"
    | "injured_reserve"
    | "buried"
    | "retained"
    | "dead_cap"
    | "ltir_relief"
    | "bonus";
  amount: number;
  formula: string;
  ruleKey?: string;
  isHypothetical?: boolean;
  records: Array<{ type: string; id: string; label: string }>;
}

export interface CapTotals {
  capUpperLimit: number;
  capLowerLimit: number;
  activeRosterCapHit: number;
  injuredReserveCapHit: number;
  buriedCapHit: number;
  retainedTotal: number;
  deadCapTotal: number;
  ltirRelief: number;
  totalCapCharge: number;
  capSpace: number;
  totalCashPayroll: number;
}

export interface CapCounts {
  activeRoster: number;
  injuredReserve: number;
  ltir: number;
  minors: number;
  goaliesActive: number;
  contractSlots: number;
}

export interface CapResult {
  season: { id: string; name: string };
  team: { id: string; name: string };
  totals: CapTotals;
  counts: CapCounts;
  lineItems: CapLineItem[];
  violations: CapViolation[];
  warnings: CapViolation[];
  appliedRules: RuleValue[];
  calculatedAt: string;
}
