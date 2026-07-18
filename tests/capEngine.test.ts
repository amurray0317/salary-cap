import { describe, it, expect } from "vitest";
import { calculateCap, effectiveCapHit } from "@/lib/engine/capEngine";
import { RULE_KEYS, type CapInput, type EngineContractSeason, type RuleSet, type RuleValue } from "@/lib/engine/types";

function rule(key: string, numericValue: number, name = key): RuleValue {
  return {
    key,
    name,
    category: "cap",
    numericValue,
    textValue: null,
    version: 1,
    effectiveDate: "2025-07-01",
  };
}

function standardRules(overrides: Record<string, number> = {}): RuleSet {
  const defaults: Record<string, number> = {
    [RULE_KEYS.capUpperLimit]: 90_000_000,
    [RULE_KEYS.capLowerLimit]: 66_000_000,
    [RULE_KEYS.buriedAllowance]: 1_150_000,
    [RULE_KEYS.maxActiveRoster]: 23,
    [RULE_KEYS.minActiveRoster]: 20,
    [RULE_KEYS.minGoalies]: 2,
    [RULE_KEYS.maxContractSlots]: 50,
    [RULE_KEYS.minSalary]: 800_000,
    [RULE_KEYS.maxIndividualPct]: 20,
  };
  const merged = { ...defaults, ...overrides };
  return new Map(Object.entries(merged).map(([k, v]) => [k, rule(k, v)]));
}

let counter = 0;
function player(over: Partial<EngineContractSeason> = {}): EngineContractSeason {
  counter += 1;
  const capHit = over.capHit ?? 1_000_000;
  return {
    contractId: `c-${counter}`,
    playerId: `p-${counter}`,
    playerName: `Player ${counter}`,
    position: "C",
    capHit,
    baseSalary: over.baseSalary ?? capHit,
    totalCash: over.totalCash ?? capHit,
    performanceBonus: 0,
    minorLeagueSalary: null,
    isTwoWay: false,
    retainedByOthersPct: 0,
    rosterStatus: "pro_active",
    ...over,
  };
}

function input(contractSeasons: EngineContractSeason[], over: Partial<CapInput> = {}): CapInput {
  return {
    season: { id: "s1", name: "2025-26" },
    team: { id: "t1", name: "Test Team" },
    rules: standardRules(),
    contractSeasons,
    obligations: [],
    ...over,
  };
}

/** A legal 22-man roster: 12 F, 8 D, 2 G at even salaries. */
function legalRoster(perPlayerHit = 3_000_000): EngineContractSeason[] {
  const roster: EngineContractSeason[] = [];
  for (let i = 0; i < 12; i++) roster.push(player({ capHit: perPlayerHit, position: "C" }));
  for (let i = 0; i < 8; i++) roster.push(player({ capHit: perPlayerHit, position: "D" }));
  for (let i = 0; i < 2; i++) roster.push(player({ capHit: perPlayerHit, position: "G" }));
  return roster;
}

describe("calculateCap — totals", () => {
  it("sums active-roster cap hits and reports remaining space", () => {
    const res = calculateCap(input(legalRoster(3_000_000)));
    expect(res.totals.activeRosterCapHit).toBe(66_000_000);
    expect(res.totals.totalCapCharge).toBe(66_000_000);
    expect(res.totals.capSpace).toBe(24_000_000);
    expect(res.violations).toHaveLength(0);
  });

  it("flags a blocking violation when the cap is exceeded (negative space preserved)", () => {
    const res = calculateCap(input(legalRoster(4_200_000)));
    expect(res.totals.totalCapCharge).toBe(92_400_000);
    expect(res.totals.capSpace).toBe(-2_400_000);
    const v = res.violations.find((x) => x.ruleKey === RULE_KEYS.capUpperLimit);
    expect(v?.severity).toBe("blocking");
    expect(v?.financialImpact).toBe(2_400_000);
  });

  it("warns when payroll is below the salary floor", () => {
    const res = calculateCap(input(legalRoster(2_000_000)));
    expect(res.totals.totalCapCharge).toBe(44_000_000);
    const w = res.warnings.find((x) => x.ruleKey === RULE_KEYS.capLowerLimit);
    expect(w).toBeDefined();
    expect(w?.financialImpact).toBe(22_000_000);
  });

  it("handles an empty roster without crashing (missing-data edge)", () => {
    const res = calculateCap(input([]));
    expect(res.totals.totalCapCharge).toBe(0);
    expect(res.totals.capSpace).toBe(90_000_000);
    expect(res.warnings.some((w) => w.ruleKey === RULE_KEYS.minActiveRoster)).toBe(true);
  });

  it("warns when no cap upper-limit rule exists for the season", () => {
    const rules = standardRules();
    rules.delete(RULE_KEYS.capUpperLimit);
    const res = calculateCap(input(legalRoster(), { rules }));
    expect(res.warnings.some((w) => w.ruleKey === RULE_KEYS.capUpperLimit)).toBe(true);
  });
});

describe("calculateCap — retained salary and dead cap", () => {
  it("reduces a contract's hit by the share retained by other teams", () => {
    expect(effectiveCapHit(player({ capHit: 6_000_000, retainedByOthersPct: 0.5 }))).toBe(3_000_000);
  });

  it("adds retained-salary obligations to the cap charge", () => {
    const res = calculateCap(
      input(legalRoster(3_000_000), {
        obligations: [
          { obligationType: "retained", playerName: "Departed Star", amount: 2_500_000 },
          { obligationType: "buyout", playerName: "Bought Out", amount: 1_200_000 },
        ],
      }),
    );
    expect(res.totals.retainedTotal).toBe(2_500_000);
    expect(res.totals.deadCapTotal).toBe(1_200_000);
    expect(res.totals.totalCapCharge).toBe(66_000_000 + 3_700_000);
  });
});

describe("calculateCap — buried and LTIR", () => {
  it("buries minor-league assignments up to min salary + allowance", () => {
    const roster = [...legalRoster(3_000_000), player({ capHit: 4_000_000, rosterStatus: "minor" })];
    const res = calculateCap(input(roster));
    // threshold = 800k + 1.15M = 1.95M → charge 2.05M
    expect(res.totals.buriedCapHit).toBe(2_050_000);
  });

  it("fully buries a contract under the threshold", () => {
    const roster = [...legalRoster(3_000_000), player({ capHit: 1_500_000, rosterStatus: "minor" })];
    const res = calculateCap(input(roster));
    expect(res.totals.buriedCapHit).toBe(0);
  });

  it("grants LTIR relief up to the injured player's hit", () => {
    const roster = [...legalRoster(3_000_000), player({ capHit: 5_000_000, rosterStatus: "ltir" })];
    const res = calculateCap(input(roster));
    expect(res.totals.injuredReserveCapHit).toBe(5_000_000);
    expect(res.totals.ltirRelief).toBe(5_000_000);
    expect(res.totals.totalCapCharge).toBe(66_000_000);
  });

  it("keeps regular IR on the cap with no relief", () => {
    const roster = [...legalRoster(3_000_000), player({ capHit: 5_000_000, rosterStatus: "injured_reserve" })];
    const res = calculateCap(input(roster));
    expect(res.totals.ltirRelief).toBe(0);
    expect(res.totals.totalCapCharge).toBe(71_000_000);
  });
});

describe("calculateCap — roster and contract limits", () => {
  it("blocks a roster larger than the active maximum", () => {
    const roster = legalRoster(2_500_000);
    roster.push(player({}), player({})); // 24 skaters
    const res = calculateCap(input(roster));
    expect(res.violations.some((v) => v.ruleKey === RULE_KEYS.maxActiveRoster)).toBe(true);
  });

  it("warns when below the minimum active roster or goalie minimum", () => {
    const res = calculateCap(input([player({ position: "C", capHit: 70_000_000 })]));
    expect(res.warnings.some((v) => v.ruleKey === RULE_KEYS.minActiveRoster)).toBe(true);
    expect(res.warnings.some((v) => v.ruleKey === RULE_KEYS.minGoalies)).toBe(true);
  });

  it("blocks when contract slots exceed the limit", () => {
    const rules = standardRules({ [RULE_KEYS.maxContractSlots]: 10 });
    const roster = legalRoster(1_000_000); // 22 contracts
    const res = calculateCap(input(roster, { rules }));
    const v = res.violations.find((x) => x.ruleKey === RULE_KEYS.maxContractSlots);
    expect(v?.severity).toBe("blocking");
  });

  it("blocks an individual cap hit above the individual maximum", () => {
    const roster = [...legalRoster(1_000_000), player({ capHit: 19_000_000 })];
    const res = calculateCap(input(roster));
    const v = res.violations.find((x) => x.ruleKey === RULE_KEYS.maxIndividualPct);
    expect(v?.severity).toBe("blocking");
    expect(v?.financialImpact).toBe(1_000_000); // 19M − 18M (20% of 90M)
  });
});

describe("calculateCap — explainability", () => {
  it("emits a line item with formula and records for every cap charge", () => {
    const res = calculateCap(
      input([player({ capHit: 2_000_000, retainedByOthersPct: 0.25 })], {
        obligations: [{ obligationType: "retained", playerName: "Gone Guy", amount: 900_000 }],
      }),
    );
    const active = res.lineItems.find((l) => l.category === "active_roster");
    expect(active?.amount).toBe(1_500_000);
    expect(active?.formula).toContain("25% retained");
    expect(active?.records[0]?.type).toBe("contract");
    expect(res.appliedRules.some((r) => r.key === RULE_KEYS.capUpperLimit)).toBe(true);
  });
});
