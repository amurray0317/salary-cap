import { describe, it, expect } from "vitest";
import { calculateCap } from "@/lib/engine/capEngine";
import { RULE_KEYS, type CapInput, type EngineContractSeason, type RuleValue } from "@/lib/engine/types";
import { projectScenario } from "@/lib/scenario/projector";
import { scenarioPayloadSchema, type ScenarioPayload } from "@/lib/scenario/payloads";

function rule(key: string, numericValue: number): RuleValue {
  return { key, name: key, category: "cap", numericValue, textValue: null, version: 1, effectiveDate: "2025-07-01" };
}

function rules() {
  return new Map(
    Object.entries({
      [RULE_KEYS.capUpperLimit]: 90_000_000,
      [RULE_KEYS.capLowerLimit]: 66_000_000,
      [RULE_KEYS.buriedAllowance]: 1_150_000,
      [RULE_KEYS.minSalary]: 800_000,
      [RULE_KEYS.maxActiveRoster]: 23,
      [RULE_KEYS.minActiveRoster]: 20,
      [RULE_KEYS.maxContractSlots]: 50,
    }).map(([k, v]) => [k, rule(k, v)]),
  );
}

const CONTRACT_A = "5b3f0000-0000-4000-8000-000000000001";
const CONTRACT_B = "5b3f0000-0000-4000-8000-000000000002";

function cs(contractId: string, name: string, capHit: number): EngineContractSeason {
  return {
    contractId,
    playerId: contractId,
    playerName: name,
    position: "C",
    capHit,
    baseSalary: capHit,
    totalCash: capHit,
    performanceBonus: 0,
    minorLeagueSalary: null,
    isTwoWay: false,
    retainedByOthersPct: 0,
    rosterStatus: "pro_active",
  };
}

function seasonInput(name: string, contractSeasons: EngineContractSeason[]): CapInput {
  return {
    season: { id: name, name },
    team: { id: "t1", name: "Test Team" },
    rules: rules(),
    contractSeasons,
    obligations: [],
  };
}

function baseTwoSeasons() {
  return {
    seasons: [
      seasonInput("2025-26", [cs(CONTRACT_A, "Alpha", 6_000_000), cs(CONTRACT_B, "Bravo", 4_000_000)]),
      seasonInput("2026-27", [cs(CONTRACT_A, "Alpha", 6_000_000)]),
    ],
  };
}

function tx(payload: ScenarioPayload, label = "tx") {
  return { label, payload: scenarioPayloadSchema.parse(payload) };
}

describe("projectScenario — isolation", () => {
  it("never mutates the official base inputs", () => {
    const base = baseTwoSeasons();
    projectScenario(base, [
      tx({ kind: "trade_out", contractId: CONTRACT_A, retainedPct: 0.5 }),
      tx({
        kind: "sign_free_agent",
        playerName: "New Guy",
        position: "LW",
        isTwoWay: false,
        seasons: [{ seasonName: "2025-26", capHit: 3_000_000 }],
      }),
    ]);
    expect(base.seasons[0]?.contractSeasons).toHaveLength(2);
    expect(base.seasons[0]?.obligations).toHaveLength(0);
  });
});

describe("projectScenario — signing", () => {
  it("adds a proposed contract only to matching seasons and marks it hypothetical", () => {
    const { seasons, notes } = projectScenario(baseTwoSeasons(), [
      tx({
        kind: "sign_free_agent",
        playerName: "New Guy",
        position: "LW",
        isTwoWay: false,
        seasons: [
          { seasonName: "2025-26", capHit: 3_000_000 },
          { seasonName: "2027-28", capHit: 3_000_000 }, // outside window
        ],
      }),
    ]);
    const s1 = seasons[0]!;
    expect(s1.contractSeasons).toHaveLength(3);
    const added = s1.contractSeasons.find((c) => c.playerName === "New Guy");
    expect(added?.isHypothetical).toBe(true);
    expect(notes.some((n) => n.message.includes("outside the projection window"))).toBe(true);

    const cap = calculateCap(s1);
    expect(cap.totals.totalCapCharge).toBe(13_000_000);
  });
});

describe("projectScenario — trades with retention", () => {
  it("removes the traded contract in all seasons and adds retained obligations", () => {
    const { seasons } = projectScenario(baseTwoSeasons(), [
      tx({ kind: "trade_out", contractId: CONTRACT_A, retainedPct: 0.25 }),
    ]);
    const s1 = seasons[0]!;
    const s2 = seasons[1]!;
    expect(s1.contractSeasons.map((c) => c.playerName)).toEqual(["Bravo"]);
    expect(s1.obligations).toEqual([
      { obligationType: "retained", playerName: "Alpha", amount: 1_500_000, isHypothetical: true },
    ]);
    // Multi-season retention follows the contract into 2026-27.
    expect(s2.contractSeasons).toHaveLength(0);
    expect(s2.obligations[0]?.amount).toBe(1_500_000);

    const cap = calculateCap(s1);
    expect(cap.totals.totalCapCharge).toBe(4_000_000 + 1_500_000);
  });

  it("applies retained-by-others percentage on an incoming trade", () => {
    const { seasons } = projectScenario(baseTwoSeasons(), [
      tx({
        kind: "trade_in",
        playerName: "Import",
        position: "D",
        retainedByOthersPct: 0.5,
        seasons: [{ seasonName: "2025-26", capHit: 8_000_000 }],
      }),
    ]);
    const cap = calculateCap(seasons[0]!);
    // 6M + 4M + 8M×0.5
    expect(cap.totals.totalCapCharge).toBe(14_000_000);
  });

  it("warns instead of failing when the traded contract does not exist", () => {
    const { seasons, notes } = projectScenario(baseTwoSeasons(), [
      tx({ kind: "trade_out", contractId: "5b3f0000-0000-4000-8000-00000000dead", retainedPct: 0 }),
    ]);
    expect(seasons[0]?.contractSeasons).toHaveLength(2);
    expect(notes.some((n) => n.level === "warning")).toBe(true);
  });
});

describe("projectScenario — assignments and IR", () => {
  it("send_down buries the contract in the current season only", () => {
    const { seasons } = projectScenario(baseTwoSeasons(), [
      tx({ kind: "send_down", contractId: CONTRACT_B }),
    ]);
    const buried = seasons[0]!.contractSeasons.find((c) => c.contractId === CONTRACT_B);
    expect(buried?.rosterStatus).toBe("minor");
    const cap = calculateCap(seasons[0]!);
    // Bravo 4M buried above threshold 1.95M → 2.05M charge + Alpha 6M
    expect(cap.totals.totalCapCharge).toBe(8_050_000);
  });

  it("call_up restores a minor-league contract to the active roster", () => {
    const base = baseTwoSeasons();
    base.seasons[0]!.contractSeasons[1]!.rosterStatus = "minor";
    const { seasons } = projectScenario(base, [tx({ kind: "call_up", contractId: CONTRACT_B })]);
    expect(seasons[0]!.contractSeasons[1]?.rosterStatus).toBe("pro_active");
  });

  it("LTIR placement produces relief in the projection", () => {
    const { seasons } = projectScenario(baseTwoSeasons(), [
      tx({ kind: "ir_placement", contractId: CONTRACT_A, longTerm: true }),
    ]);
    const cap = calculateCap(seasons[0]!);
    expect(cap.totals.ltirRelief).toBe(6_000_000);
    expect(cap.totals.totalCapCharge).toBe(4_000_000);
  });
});

describe("projectScenario — extension and buyout", () => {
  it("extension adds future seasons without duplicating existing ones", () => {
    const { seasons, notes } = projectScenario(baseTwoSeasons(), [
      tx({
        kind: "extension",
        contractId: CONTRACT_A,
        seasons: [
          { seasonName: "2026-27", capHit: 7_000_000 }, // Alpha already has 2026-27
        ],
      }),
    ]);
    expect(seasons[1]!.contractSeasons).toHaveLength(1);
    expect(notes.some((n) => n.message.includes("already has a contract season"))).toBe(true);
  });

  it("extension fills seasons the contract does not yet cover", () => {
    const { seasons } = projectScenario(baseTwoSeasons(), [
      tx({
        kind: "extension",
        contractId: CONTRACT_B, // Bravo expires after 2025-26
        seasons: [{ seasonName: "2026-27", capHit: 4_500_000 }],
      }),
    ]);
    const extended = seasons[1]!.contractSeasons.find((c) => c.contractId === CONTRACT_B);
    expect(extended?.capHit).toBe(4_500_000);
    expect(extended?.isHypothetical).toBe(true);
  });

  it("buyout converts remaining seasons to dead cap", () => {
    const { seasons } = projectScenario(baseTwoSeasons(), [
      tx({ kind: "buyout", contractId: CONTRACT_A, deadCapFraction: 2 / 3 }),
    ]);
    const cap1 = calculateCap(seasons[0]!);
    expect(cap1.totals.deadCapTotal).toBe(4_000_000);
    expect(seasons[0]!.contractSeasons.some((c) => c.contractId === CONTRACT_A)).toBe(false);
  });
});

describe("scenario payload validation", () => {
  it("rejects malformed payloads", () => {
    expect(() =>
      scenarioPayloadSchema.parse({ kind: "trade_out", contractId: "not-a-uuid", retainedPct: 2 }),
    ).toThrow();
    expect(() => scenarioPayloadSchema.parse({ kind: "unknown" })).toThrow();
  });
});
