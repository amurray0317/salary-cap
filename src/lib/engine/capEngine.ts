/**
 * NHL-style annual salary-cap engine.
 *
 * Every figure the engine emits is backed by a CapLineItem carrying the
 * formula, the input records, and the rule (key + version) that governed it,
 * so the UI can answer "why is this number what it is?" for any total.
 *
 * Simplifications vs. a real CBA are documented in docs/LIMITATIONS.md:
 * season-long accounting (no daily proration), LTIR modeled as a relief pool
 * capped by the injured player's hit, performance bonuses charged in full in
 * the season they are scheduled.
 */
import {
  RULE_KEYS,
  type CapInput,
  type CapLineItem,
  type CapResult,
  type CapViolation,
  type EngineContractSeason,
  type RuleSet,
  type RuleValue,
} from "./types";

function ruleNum(rules: RuleSet, key: string): number | null {
  const r = rules.get(key);
  return r?.numericValue ?? null;
}

function requireRule(rules: RuleSet, key: string, fallback: number): { value: number; rule: RuleValue | undefined } {
  const rule = rules.get(key);
  return { value: rule?.numericValue ?? fallback, rule };
}

const COUNTS_AS_ACTIVE_ROSTER = new Set(["pro_active", "pro_scratch"]);
const BURIED_STATUSES = new Set(["minor", "loaned"]);
const OFF_CAP_STATUSES = new Set(["juniors", "unsigned", "non_roster"]);

/** Effective cap hit after removing the share retained by other teams. */
export function effectiveCapHit(cs: EngineContractSeason): number {
  const pct = Math.min(Math.max(cs.retainedByOthersPct, 0), 1);
  return Math.round(cs.capHit * (1 - pct));
}

export function calculateCap(input: CapInput): CapResult {
  const { rules } = input;
  const lineItems: CapLineItem[] = [];
  const violations: CapViolation[] = [];
  const warnings: CapViolation[] = [];
  const appliedRules = new Map<string, RuleValue>();

  const track = (key: string) => {
    const r = rules.get(key);
    if (r) appliedRules.set(key, r);
  };

  const upper = requireRule(rules, RULE_KEYS.capUpperLimit, 0);
  const lower = requireRule(rules, RULE_KEYS.capLowerLimit, 0);
  track(RULE_KEYS.capUpperLimit);
  track(RULE_KEYS.capLowerLimit);

  if (!upper.rule) {
    warnings.push({
      severity: "warning",
      ruleKey: RULE_KEYS.capUpperLimit,
      ruleName: "Salary cap upper limit",
      message: `No active cap upper-limit rule found for season ${input.season.name}; cap space cannot be computed reliably.`,
    });
  }

  const minSalary = requireRule(rules, RULE_KEYS.minSalary, 0);
  const buriedAllowance = requireRule(rules, RULE_KEYS.buriedAllowance, 0);
  const buriedThreshold = minSalary.value + buriedAllowance.value;
  track(RULE_KEYS.minSalary);
  track(RULE_KEYS.buriedAllowance);

  let activeRosterCapHit = 0;
  let injuredReserveCapHit = 0;
  let buriedCapHit = 0;
  let totalCashPayroll = 0;
  let ltirHitTotal = 0;

  let activeCount = 0;
  let irCount = 0;
  let ltirCount = 0;
  let minorsCount = 0;
  let goaliesActive = 0;

  for (const cs of input.contractSeasons) {
    const hit = effectiveCapHit(cs);
    const retainedNote =
      cs.retainedByOthersPct > 0
        ? ` × (1 − ${(cs.retainedByOthersPct * 100).toFixed(0)}% retained by others)`
        : "";
    const record = {
      type: cs.isHypothetical ? "scenario_contract" : "contract",
      id: cs.contractId,
      label: `${cs.playerName} (${cs.position})`,
    };

    if (OFF_CAP_STATUSES.has(cs.rosterStatus)) continue;

    totalCashPayroll += BURIED_STATUSES.has(cs.rosterStatus)
      ? (cs.isTwoWay ? (cs.minorLeagueSalary ?? cs.totalCash) : cs.totalCash)
      : cs.totalCash;

    if (COUNTS_AS_ACTIVE_ROSTER.has(cs.rosterStatus)) {
      activeRosterCapHit += hit;
      activeCount += 1;
      if (cs.position === "G") goaliesActive += 1;
      lineItems.push({
        id: `active:${cs.contractId}`,
        label: cs.playerName,
        category: "active_roster",
        amount: hit,
        formula: `cap hit $${cs.capHit.toLocaleString()}${retainedNote}`,
        isHypothetical: cs.isHypothetical,
        records: [record],
      });
      if (minSalary.rule && cs.baseSalary > 0 && cs.baseSalary < minSalary.value) {
        warnings.push({
          severity: "warning",
          ruleKey: RULE_KEYS.minSalary,
          ruleName: minSalary.rule.name,
          message: `${cs.playerName}'s base salary $${cs.baseSalary.toLocaleString()} is below the league minimum $${minSalary.value.toLocaleString()}.`,
          affectedPlayer: cs.playerName,
          ruleVersion: minSalary.rule.version,
          effectiveDate: minSalary.rule.effectiveDate,
        });
      }
    } else if (cs.rosterStatus === "injured_reserve") {
      injuredReserveCapHit += hit;
      irCount += 1;
      lineItems.push({
        id: `ir:${cs.contractId}`,
        label: `${cs.playerName} (IR)`,
        category: "injured_reserve",
        amount: hit,
        formula: `IR counts against the cap: cap hit $${cs.capHit.toLocaleString()}${retainedNote}`,
        isHypothetical: cs.isHypothetical,
        records: [record],
      });
    } else if (cs.rosterStatus === "ltir") {
      // LTIR: hit still counts, but contributes to available relief (simplified pool).
      injuredReserveCapHit += hit;
      ltirCount += 1;
      ltirHitTotal += hit;
      lineItems.push({
        id: `ltir:${cs.contractId}`,
        label: `${cs.playerName} (LTIR)`,
        category: "injured_reserve",
        amount: hit,
        formula: `LTIR cap hit $${cs.capHit.toLocaleString()}${retainedNote}; offset by LTIR relief line`,
        isHypothetical: cs.isHypothetical,
        records: [record],
      });
    } else if (BURIED_STATUSES.has(cs.rosterStatus)) {
      minorsCount += 1;
      const charge = Math.max(0, hit - buriedThreshold);
      if (charge > 0) {
        buriedCapHit += charge;
        lineItems.push({
          id: `buried:${cs.contractId}`,
          label: `${cs.playerName} (minors, buried)`,
          category: "buried",
          amount: charge,
          formula: `max(0, $${hit.toLocaleString()} − buried threshold $${buriedThreshold.toLocaleString()}) where threshold = min salary + buried allowance`,
          ruleKey: RULE_KEYS.buriedAllowance,
          isHypothetical: cs.isHypothetical,
          records: [record],
        });
      }
    } else if (cs.rosterStatus === "suspended") {
      // Suspended without pay: cap hit stays, cash reduced — modeled as full hit.
      activeRosterCapHit += hit;
      lineItems.push({
        id: `susp:${cs.contractId}`,
        label: `${cs.playerName} (suspended)`,
        category: "active_roster",
        amount: hit,
        formula: `suspended player's cap hit continues to count: $${cs.capHit.toLocaleString()}`,
        isHypothetical: cs.isHypothetical,
        records: [record],
      });
    }
  }

  let retainedTotal = 0;
  let deadCapTotal = 0;
  for (const ob of input.obligations) {
    const rec = { type: "cap_obligation", id: ob.playerName, label: ob.playerName };
    if (ob.obligationType === "retained") {
      retainedTotal += ob.amount;
      lineItems.push({
        id: `retained:${ob.playerName}:${ob.amount}`,
        label: `${ob.playerName} (retained salary)`,
        category: "retained",
        amount: ob.amount,
        formula: `retained share of traded player's cap hit: $${ob.amount.toLocaleString()}`,
        isHypothetical: ob.isHypothetical,
        records: [rec],
      });
    } else {
      deadCapTotal += ob.amount;
      lineItems.push({
        id: `dead:${ob.playerName}:${ob.amount}`,
        label: `${ob.playerName} (${ob.obligationType})`,
        category: "dead_cap",
        amount: ob.amount,
        formula: `${ob.obligationType} charge: $${ob.amount.toLocaleString()}`,
        isHypothetical: ob.isHypothetical,
        records: [rec],
      });
    }
  }

  // Simplified LTIR relief: pool = min(configured pool ?? LTIR hits, LTIR hits).
  const ltirRelief = Math.min(input.ltirPool ?? ltirHitTotal, ltirHitTotal);
  if (ltirRelief > 0) {
    lineItems.push({
      id: "ltir-relief",
      label: "LTIR relief",
      category: "ltir_relief",
      amount: -ltirRelief,
      formula: `min(LTIR pool, sum of LTIR cap hits) = −$${ltirRelief.toLocaleString()} (simplified LTIR model)`,
      records: [],
    });
  }

  const totalCapCharge =
    activeRosterCapHit + injuredReserveCapHit + buriedCapHit + retainedTotal + deadCapTotal - ltirRelief;
  const capSpace = upper.value - totalCapCharge;

  // Hypothetical contracts occupy slots too — a proposed signing must fit the limit.
  const contractSlots = input.contractSeasons.length;

  /* ---------------- Compliance checks ---------------- */

  if (upper.rule && totalCapCharge > upper.value) {
    violations.push({
      severity: "blocking",
      ruleKey: RULE_KEYS.capUpperLimit,
      ruleName: upper.rule.name,
      message: `Total cap charge $${totalCapCharge.toLocaleString()} exceeds the upper limit $${upper.value.toLocaleString()} by $${(totalCapCharge - upper.value).toLocaleString()}.`,
      financialImpact: totalCapCharge - upper.value,
      recommendedResolution: "Trade or assign salary, retain salary in a trade, or remove a proposed addition.",
      ruleVersion: upper.rule.version,
      effectiveDate: upper.rule.effectiveDate,
    });
  }

  if (lower.rule && totalCapCharge < lower.value) {
    violations.push({
      severity: "warning",
      ruleKey: RULE_KEYS.capLowerLimit,
      ruleName: lower.rule.name,
      message: `Total cap charge $${totalCapCharge.toLocaleString()} is below the salary floor $${lower.value.toLocaleString()} by $${(lower.value - totalCapCharge).toLocaleString()}.`,
      financialImpact: lower.value - totalCapCharge,
      recommendedResolution: "Add salary before the season begins to reach the floor.",
      ruleVersion: lower.rule.version,
      effectiveDate: lower.rule.effectiveDate,
    });
  }

  const maxActive = ruleNum(rules, RULE_KEYS.maxActiveRoster);
  track(RULE_KEYS.maxActiveRoster);
  if (maxActive !== null && activeCount > maxActive) {
    const r = rules.get(RULE_KEYS.maxActiveRoster);
    violations.push({
      severity: "blocking",
      ruleKey: RULE_KEYS.maxActiveRoster,
      ruleName: r?.name ?? "Maximum active roster",
      message: `Active roster has ${activeCount} players; the maximum is ${maxActive}.`,
      recommendedResolution: "Assign a player to the minors or place a player on injured reserve.",
      ruleVersion: r?.version,
    });
  }

  const minActive = ruleNum(rules, RULE_KEYS.minActiveRoster);
  track(RULE_KEYS.minActiveRoster);
  if (minActive !== null && activeCount < minActive) {
    const r = rules.get(RULE_KEYS.minActiveRoster);
    violations.push({
      severity: "warning",
      ruleKey: RULE_KEYS.minActiveRoster,
      ruleName: r?.name ?? "Minimum active roster",
      message: `Active roster has ${activeCount} players; the minimum is ${minActive}.`,
      recommendedResolution: "Recall a player or sign a free agent.",
      ruleVersion: r?.version,
    });
  }

  const minGoalies = ruleNum(rules, RULE_KEYS.minGoalies);
  track(RULE_KEYS.minGoalies);
  if (minGoalies !== null && goaliesActive < minGoalies) {
    const r = rules.get(RULE_KEYS.minGoalies);
    violations.push({
      severity: "warning",
      ruleKey: RULE_KEYS.minGoalies,
      ruleName: r?.name ?? "Minimum goaltenders",
      message: `Active roster carries ${goaliesActive} goaltender(s); the minimum is ${minGoalies}.`,
      recommendedResolution: "Recall or sign a goaltender.",
      ruleVersion: r?.version,
    });
  }

  const maxSlots = ruleNum(rules, RULE_KEYS.maxContractSlots);
  track(RULE_KEYS.maxContractSlots);
  if (maxSlots !== null && contractSlots > maxSlots) {
    const r = rules.get(RULE_KEYS.maxContractSlots);
    violations.push({
      severity: "blocking",
      ruleKey: RULE_KEYS.maxContractSlots,
      ruleName: r?.name ?? "Contract slot limit",
      message: `Organization holds ${contractSlots} contracts; the limit is ${maxSlots}.`,
      recommendedResolution: "Trade, release, or let a contract expire before adding another.",
      ruleVersion: r?.version,
    });
  }

  const maxIndividualPct = ruleNum(rules, RULE_KEYS.maxIndividualPct);
  track(RULE_KEYS.maxIndividualPct);
  if (maxIndividualPct !== null && upper.value > 0) {
    const maxIndividual = Math.round((maxIndividualPct / 100) * upper.value);
    for (const cs of input.contractSeasons) {
      if (cs.capHit > maxIndividual) {
        const r = rules.get(RULE_KEYS.maxIndividualPct);
        violations.push({
          severity: "blocking",
          ruleKey: RULE_KEYS.maxIndividualPct,
          ruleName: r?.name ?? "Maximum individual salary",
          message: `${cs.playerName}'s cap hit $${cs.capHit.toLocaleString()} exceeds the individual maximum $${maxIndividual.toLocaleString()} (${maxIndividualPct}% of the upper limit).`,
          affectedPlayer: cs.playerName,
          financialImpact: cs.capHit - maxIndividual,
          ruleVersion: r?.version,
        });
      }
    }
  }

  return {
    season: input.season,
    team: input.team,
    totals: {
      capUpperLimit: upper.value,
      capLowerLimit: lower.value,
      activeRosterCapHit,
      injuredReserveCapHit,
      buriedCapHit,
      retainedTotal,
      deadCapTotal,
      ltirRelief,
      totalCapCharge,
      capSpace,
      totalCashPayroll,
    },
    counts: {
      activeRoster: activeCount,
      injuredReserve: irCount,
      ltir: ltirCount,
      minors: minorsCount,
      goaliesActive,
      contractSlots,
    },
    lineItems,
    violations: violations.filter((v) => v.severity === "blocking" || v.severity === "requires_review"),
    warnings: [...warnings, ...violations.filter((v) => v.severity === "warning" || v.severity === "info")],
    appliedRules: [...appliedRules.values()],
    calculatedAt: new Date().toISOString(),
  };
}
